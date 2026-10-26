// Pure DNS planning: given what exists in the customer's zone and what the connection needs, decide exactly which records
// to create or change, which exist already, and which differences are conflicts. Nothing here touches the network.
//
// Rules that protect the customer's zone:
//  - only the records for the hostnames being connected are ever considered (never MX, SPF/DKIM TXT, other subdomains);
//  - a record that already has the right value is left alone (idempotent);
//  - registrar placeholders ("Parked", "www CNAME @") may be replaced silently, anything else only with confirmation;
//  - a conflict that cannot be solved by changing records (a CNAME next to MX/TXT) is reported, never forced.

const PARKED_VALUES = new Set(['parked', '@']);
const norm = (value) => String(value || '').trim().replace(/\.$/, '').toLowerCase();

function normalizeRecord(record) {
  const type = String(record.type || '').toUpperCase();
  let name = String(record.name ?? '@').trim().toLowerCase();
  if (name === '' || name === '@') name = '@';
  return { type, name, data: String(record.data ?? record.value ?? '').trim(), ttl: Number(record.ttl) || null };
}

/** The records a connection needs for routing (the ownership TXT is handled separately). */
function desiredRecords(connection, { ipv4 = null, ipv6 = null, cnameTarget = null }) {
  const out = [];
  const need = (record) => out.push({ ttl: 600, ...record });
  if (connection.kind === 'subdomain') {
    const label = connection.hostname.slice(0, -(connection.apex.length + 1));
    if (!cnameTarget && !ipv4) return { records: [], error: 'The hosting endpoint is not configured (PUBLISH_SERVER_IP / base domain).' };
    if (cnameTarget) need({ type: 'CNAME', name: label, data: cnameTarget, purpose: `Points ${connection.hostname} at your Veave site` });
    else need({ type: 'A', name: label, data: ipv4, purpose: `Points ${connection.hostname} at Veave` });
    return { records: out };
  }
  if (!ipv4) return { records: [], error: 'The hosting endpoint address is not configured (PUBLISH_SERVER_IP), so the root domain cannot be pointed automatically.' };
  need({ type: 'A', name: '@', data: ipv4, purpose: 'Points the root domain at Veave' });
  if (ipv6) need({ type: 'AAAA', name: '@', data: ipv6, purpose: 'IPv6 for the root domain' });
  if (connection.includeWww) {
    if (cnameTarget) need({ type: 'CNAME', name: 'www', data: cnameTarget, purpose: 'Points www at your Veave site' });
    else need({ type: 'A', name: 'www', data: ipv4, purpose: 'Points www at Veave' });
  }
  return { records: out };
}

function sameValue(a, b) { return norm(a) === norm(b); }

/**
 * @returns {{ actions: object[], satisfied: object[], conflicts: object[], blocked: boolean, manual: boolean, error?: string }}
 *   blocked: waiting for the user to confirm replacing existing records.
 *   manual:  something cannot be changed safely by software (the user must act in their DNS provider).
 */
function planDnsChanges(connection, existingInput, endpoint, { confirmReplace = false } = {}) {
  const { records: desired, error } = desiredRecords(connection, endpoint);
  if (error) return { actions: [], satisfied: [], conflicts: [], blocked: false, manual: true, error };
  const existing = existingInput.map(normalizeRecord);
  const at = (name) => existing.filter((record) => record.name === name);
  const actions = [];
  const satisfied = [];
  const conflicts = [];
  const handledStale = new Set();

  for (const want of desired) {
    const here = at(want.name);
    const sameType = here.filter((record) => record.type === want.type);
    if (sameType.length === 1 && sameValue(sameType[0].data, want.data) && !here.some((record) => record.type !== want.type && ['CNAME'].includes(want.type))) {
      satisfied.push(want);
      continue;
    }
    const others = here.filter((record) => record.type !== want.type);
    if (want.type === 'CNAME') {
      // A CNAME cannot share a name with any other record.
      const blockers = others.filter((record) => !['CNAME'].includes(record.type));
      const hardBlockers = blockers.filter((record) => !['A', 'AAAA'].includes(record.type));
      if (hardBlockers.length) {
        conflicts.push({ code: 'cname-coexistence', blocking: true, name: want.name, records: hardBlockers,
          message: `${want.name === '@' ? 'The root' : want.name} has ${hardBlockers.map((r) => r.type).join('/')} records, which cannot exist next to the CNAME that Veave needs. Move them or use a different hostname.` });
        continue;
      }
      for (const record of blockers) {
        actions.push({ op: 'delete', type: record.type, name: record.name, reason: `A ${record.type} record at ${record.name} cannot coexist with the required CNAME`, replacesExisting: true, existing: record });
      }
    }
    if (sameType.length) {
      const placeholder = sameType.every((record) => PARKED_VALUES.has(norm(record.data)));
      if (!placeholder) {
        conflicts.push({ code: 'replace-existing', blocking: false, name: want.name, type: want.type, records: sameType,
          message: `${want.name} already has ${want.type} record(s) (${sameType.map((r) => r.data).join(', ')}) that point somewhere else. Connecting the domain replaces them.` });
      }
      actions.push({ op: 'set', type: want.type, name: want.name, data: want.data, ttl: want.ttl, reason: placeholder ? 'replaces a registrar placeholder' : 'repoints the existing record', replacesExisting: !placeholder, existing: sameType });
    } else {
      actions.push({ op: 'set', type: want.type, name: want.name, data: want.data, ttl: want.ttl, reason: want.purpose, replacesExisting: false });
    }
    handledStale.add(`${want.name}`);
  }

  // A stale AAAA at the root sends IPv6 visitors to the old host once we have no IPv6 address of our own.
  if (connection.kind === 'apex' && !desired.some((record) => record.type === 'AAAA' && record.name === '@')) {
    const stale = at('@').filter((record) => record.type === 'AAAA');
    if (stale.length) {
      conflicts.push({ code: 'stale-aaaa', blocking: false, name: '@', type: 'AAAA', records: stale,
        message: `The root has an IPv6 (AAAA) record (${stale.map((r) => r.data).join(', ')}) that would still send some visitors to the old host. It will be removed.` });
      actions.push({ op: 'delete', type: 'AAAA', name: '@', reason: 'IPv6 record would bypass Veave', replacesExisting: true, existing: stale });
    }
  }

  const replaceActions = actions.filter((action) => action.replacesExisting);
  const needsConfirmation = replaceActions.length > 0 && !confirmReplace;
  const manual = conflicts.some((conflict) => conflict.blocking);
  return { actions, satisfied, conflicts, blocked: needsConfirmation && !manual, manual, replaces: replaceActions.length };
}

/** Manual instructions: every record the user would add by hand (routing records plus the ownership TXT). */
function manualInstructions(connection, endpoint, challenge) {
  const { records } = desiredRecords(connection, endpoint);
  return [...(challenge ? [{ ...challenge, ttl: 600 }] : []), ...records.map(({ type, name, data, ttl, purpose }) => ({ type, name, data, ttl, purpose }))];
}

module.exports = { desiredRecords, planDnsChanges, manualInstructions, normalizeRecord, PARKED_VALUES };
