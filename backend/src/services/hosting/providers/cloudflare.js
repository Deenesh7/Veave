// Cloudflare DNS through a customer's API token. The token should be a scoped one ("Zone / DNS / Edit" for the one zone):
// that is all Veave needs, and a token like that can do nothing else on the account. Records are written DNS-only (not proxied),
// because Veave proves the address a domain resolves to and issues its HTTPS certificate itself.
const defaultHttp = require('./http');

const BASE = 'https://api.cloudflare.com/client/v4';

function createCloudflareAdapter({ token, http = defaultHttp.request }) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const zoneIds = new Map();
  const call = (method, path, extra = {}) => http({ method, url: `${BASE}${path}`, headers, ...extra });
  const messageOf = (data) => (data?.errors || []).map((error) => error.message).filter(Boolean).slice(0, 2).join('; ');

  async function zoneId(zone) {
    if (zoneIds.has(zone)) return zoneIds.get(zone);
    const { status, data } = await call('GET', '/zones', { params: { name: zone, per_page: 1 } });
    if (status === 401 || status === 403) throw Object.assign(new Error('This Cloudflare token cannot read zones.'), { denied: true });
    const found = data?.result?.[0];
    if (!found) throw Object.assign(new Error(`The zone ${zone} is not in the Cloudflare account this token belongs to.`), { missing: true });
    zoneIds.set(zone, found.id);
    return found.id;
  }

  const fqdn = (zone, name) => (name === '@' || name === '' ? zone : `${name}.${zone}`);
  const relative = (zone, name) => { const n = String(name).toLowerCase(); return n === zone ? '@' : n.endsWith(`.${zone}`) ? n.slice(0, -(zone.length + 1)) : n; };
  const unquote = (value) => String(value).replace(/^"(.*)"$/s, '$1');

  async function all(zone, params = {}) {
    const id = await zoneId(zone);
    const out = [];
    for (let page = 1; page <= 30; page += 1) {
      const { status, data } = await call('GET', `/zones/${id}/dns_records`, { params: { per_page: 100, page, ...params } });
      if (status !== 200 || !data?.success) throw new Error(`Cloudflare could not list the records${messageOf(data) ? `: ${messageOf(data)}` : ''}.`);
      out.push(...data.result);
      if (page >= (data.result_info?.total_pages || 1)) break;
    }
    return out;
  }

  return {
    id: 'cloudflare',
    label: 'Cloudflare',

    /** Is the token valid at all? (Used when the owner saves it.) */
    async verifyToken() {
      const { status, data } = await call('GET', '/user/tokens/verify');
      if (status === 200 && data?.success && data.result?.status === 'active') return { ok: true };
      return { ok: false, reason: status === 401 || status === 403 || data?.result?.status === 'disabled' ? 'Cloudflare rejected this token. Check that it is correct and active.' : (messageOf(data) || `Cloudflare answered ${status}.`) };
    },

    /** May this token change this zone? */
    async isAuthorized(zone) {
      try {
        const id = await zoneId(zone);
        const { status, data } = await call('GET', `/zones/${id}/dns_records`, { params: { per_page: 1 } });
        if (status === 200 && data?.success) return { ok: true };
        return { ok: false, reason: `The Cloudflare token cannot read the DNS records of ${zone}. It needs the "Zone / DNS / Edit" permission for this zone.` };
      } catch (error) {
        if (error.denied || error.missing) return { ok: false, reason: error.message };
        if (error.transient) return { ok: false, transient: true, reason: 'Cloudflare is not reachable right now; Veave will try again.' };
        return { ok: false, reason: error.message };
      }
    },

    async listRecords(zone) {
      return (await all(zone)).map((record) => ({ type: record.type, name: relative(zone, record.name), data: record.type === 'TXT' ? unquote(record.content) : record.content, ttl: record.ttl === 1 ? null : record.ttl }));
    },

    async setRecord(zone, { type, name, data, ttl = 600 }) {
      const id = await zoneId(zone);
      const host = fqdn(zone, name);
      const same = (await all(zone, { type, name: host })).filter((record) => record.type === type);
      const keep = same.find((record) => (type === 'TXT' ? unquote(record.content) : record.content).replace(/\.$/, '').toLowerCase() === String(data).replace(/\.$/, '').toLowerCase());
      if (keep) { for (const extra of same.filter((record) => record !== keep && type !== 'TXT')) await this._delete(id, extra.id); return { changed: false }; }
      const body = { type, name: host, content: data, ttl: Math.max(60, ttl), proxied: false };
      // A, AAAA and CNAME have one value at a name: repoint the first record and remove the others. TXT may have many: add.
      if (type !== 'TXT' && same.length) {
        const result = await call('PUT', `/zones/${id}/dns_records/${same[0].id}`, { data: body });
        if (result.status !== 200 || !result.data?.success) throw new Error(`Cloudflare did not accept the ${type} record${messageOf(result.data) ? `: ${messageOf(result.data)}` : ''}.`);
        for (const extra of same.slice(1)) await this._delete(id, extra.id);
        return { changed: true };
      }
      const result = await call('POST', `/zones/${id}/dns_records`, { data: body });
      if (result.status !== 200 || !result.data?.success) throw new Error(`Cloudflare did not accept the ${type} record${messageOf(result.data) ? `: ${messageOf(result.data)}` : ''}.`);
      return { changed: true };
    },

    async deleteRecord(zone, { type, name }) {
      const id = await zoneId(zone);
      for (const record of (await all(zone, { type, name: fqdn(zone, name) })).filter((item) => item.type === type)) await this._delete(id, record.id);
    },

    async _delete(zoneIdValue, recordId) {
      const { status, data } = await call('DELETE', `/zones/${zoneIdValue}/dns_records/${recordId}`);
      if (status !== 200 || !data?.success) throw new Error(`Cloudflare did not remove the record${messageOf(data) ? `: ${messageOf(data)}` : ''}.`);
    }
  };
}

module.exports = { createCloudflareAdapter };
