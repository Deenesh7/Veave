// GoDaddy DNS through a customer's API key and secret ("key:secret"). GoDaddy's production API is only available to accounts
// that GoDaddy has enabled for it (for example accounts with enough domains); a rejected key is reported as such.
const defaultHttp = require('./http');

const BASE = 'https://api.godaddy.com/v1';
const MIN_TTL = 600;

function createGoDaddyAdapter({ token, http = defaultHttp.request }) {
  const headers = { Authorization: `sso-key ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' };
  const call = (method, path, extra = {}) => http({ method, url: `${BASE}${path}`, headers, ...extra });
  const messageOf = (data) => String(data?.message || data?.code || '').slice(0, 200);
  const slot = (name) => encodeURIComponent(name === '' ? '@' : name);

  return {
    id: 'godaddy',
    label: 'GoDaddy',

    async verifyToken() {
      const { status, data } = await call('GET', '/domains', { params: { limit: 1 } });
      if (status === 200) return { ok: true };
      if (status === 401) return { ok: false, reason: 'GoDaddy rejected this key and secret. Check that they are correct and are production (not test) keys.' };
      if (status === 403) return { ok: false, reason: 'GoDaddy does not allow this key to use the DNS API. GoDaddy only enables it for some accounts.' };
      return { ok: false, reason: messageOf(data) || `GoDaddy answered ${status}.` };
    },

    async isAuthorized(zone) {
      try {
        const { status, data } = await call('GET', `/domains/${encodeURIComponent(zone)}`);
        if (status === 200 && (!data?.status || data.status === 'ACTIVE')) return { ok: true };
        if (status === 404) return { ok: false, reason: `${zone} is not in the GoDaddy account these keys belong to.` };
        if (status === 401 || status === 403) return { ok: false, reason: 'GoDaddy does not allow these keys to manage this domain.' };
        return { ok: false, reason: data?.status ? `${zone} is ${String(data.status).toLowerCase()} at GoDaddy, so its DNS cannot be changed.` : (messageOf(data) || `GoDaddy answered ${status}.`) };
      } catch (error) {
        if (error.transient) return { ok: false, transient: true, reason: 'GoDaddy is not reachable right now; Veave will try again.' };
        return { ok: false, reason: error.message };
      }
    },

    async listRecords(zone) {
      const { status, data } = await call('GET', `/domains/${encodeURIComponent(zone)}/records`);
      if (status !== 200 || !Array.isArray(data)) throw new Error(`GoDaddy could not list the records${messageOf(data) ? `: ${messageOf(data)}` : ''}.`);
      return data.map((record) => ({ type: record.type, name: record.name === '' ? '@' : record.name, data: record.data, ttl: record.ttl }));
    },

    // GoDaddy replaces ALL records of this type and name with what is sent, so the planner's decision is applied exactly.
    async setRecord(zone, { type, name, data, ttl = MIN_TTL }) {
      const current = await this.listRecords(zone);
      const same = current.filter((record) => record.type === type && record.name === (name || '@'));
      if (same.length === 1 && String(same[0].data).replace(/\.$/, '').toLowerCase() === String(data).replace(/\.$/, '').toLowerCase()) return { changed: false };
      // A TXT name can hold several values (SPF, other verifications): keep the ones that are not ours.
      const keep = type === 'TXT' ? same.filter((record) => !String(record.data).startsWith('veave-site-verification=')).map((record) => ({ data: record.data, ttl: Math.max(MIN_TTL, record.ttl || MIN_TTL) })) : [];
      const { status, data: body } = await call('PUT', `/domains/${encodeURIComponent(zone)}/records/${type}/${slot(name)}`, { data: [...keep, { data, ttl: Math.max(MIN_TTL, ttl) }] });
      if (status !== 200) throw new Error(`GoDaddy did not accept the ${type} record${messageOf(body) ? `: ${messageOf(body)}` : ''}.`);
      return { changed: true };
    },

    async deleteRecord(zone, { type, name }) {
      const { status, data } = await call('DELETE', `/domains/${encodeURIComponent(zone)}/records/${type}/${slot(name)}`);
      if (status !== 204 && status !== 200 && status !== 404) throw new Error(`GoDaddy did not remove the record${messageOf(data) ? `: ${messageOf(data)}` : ''}.`);
    }
  };
}

module.exports = { createGoDaddyAdapter };
