/**
 * Indian Standard Time (IST, UTC+05:30) as readable text.
 * MongoDB keeps every Date in UTC (that is what makes sorting, expiry and renewals correct everywhere), so the real timestamp is never
 * changed. These strings are a companion copy for people reading the database directly: "2026-11-17 14:53:49 IST".
 */
const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});

function toIST(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const part = Object.fromEntries(formatter.formatToParts(date).map((item) => [item.type, item.value]));
  return `${part.year}-${part.month}-${part.day} ${part.hour}:${part.minute}:${part.second} IST`;
}

module.exports = { toIST };
