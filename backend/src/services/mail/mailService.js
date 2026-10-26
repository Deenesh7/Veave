const nodemailer = require('nodemailer');
const logger = require('../../utils/logger');

/**
 * Outgoing email over SMTP (any provider: Gmail app password, SendGrid, Resend, Mailgun, SES SMTP, ...).
 *
 *   SMTP_HOST, SMTP_PORT (587), SMTP_SECURE (true for 465), SMTP_USER, SMTP_PASS, MAIL_FROM ("Veave <no-reply@veave.net>")
 *
 * When SMTP is not configured nothing is sent and the caller is told so; the feature that needed the email keeps working.
 */
let transport = null;
let testTransport = null;
let testFetch = null;

const apiConfigured = () => !!(String(process.env.EMAIL_API_URL || '').trim() && process.env.EMAIL_CLIENT_ID && process.env.EMAIL_CLIENT_SECRET);
const smtpConfigured = () => !!String(process.env.SMTP_HOST || '').trim();
const isConfigured = () => !!testTransport || apiConfigured() || smtpConfigured();

function fromAddress() {
  if (process.env.EMAIL_FROM_ADDRESS) {
    const name = String(process.env.EMAIL_FROM_NAME || '').replace(/["<>]/g, '').trim();
    return name ? `"${name}" <${process.env.EMAIL_FROM_ADDRESS}>` : process.env.EMAIL_FROM_ADDRESS;
  }
  return process.env.MAIL_FROM || process.env.SMTP_USER || 'Veave <no-reply@localhost>';
}

// The hosted email API: one authenticated JSON POST per message.
async function sendViaApi({ to, subject, text, html }) {
  const response = await (testFetch || fetch)(process.env.EMAIL_API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-id': process.env.EMAIL_CLIENT_ID, 'x-client-secret': process.env.EMAIL_CLIENT_SECRET },
    body: JSON.stringify({ from: fromAddress(), to, subject, text, html }),
    signal: AbortSignal.timeout(15000)
  });
  const raw = await response.text();
  let body = null;
  try { body = JSON.parse(raw); } catch { /* not JSON */ }
  if (!response.ok || body?.error) {
    const reason = String(body?.error || body?.message || `HTTP ${response.status}`).slice(0, 200);
    throw new Error(`email API rejected the message: ${reason}`);
  }
}

function getTransport() {
  if (testTransport) return testTransport;
  if (!transport) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number.parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
      ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } } : {}),
      connectionTimeout: 10000,
      socketTimeout: 15000
    });
  }
  return transport;
}

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** @returns {Promise<{sent:boolean, reason?:string}>} never throws */
async function sendMail({ to, subject, text, html }) {
  if (!isConfigured()) {
    logger.warn(`Email not sent to ${to}: no email provider is configured (EMAIL_API_URL or SMTP_HOST).`);
    return { sent: false, reason: 'Email is not configured on the server.' };
  }
  try {
    if (testTransport) await testTransport.sendMail({ from: fromAddress(), to, subject, text, html });
    else if (apiConfigured()) await sendViaApi({ to, subject, text, html });
    else await getTransport().sendMail({ from: fromAddress(), to, subject, text, html });
    return { sent: true };
  } catch (error) {
    logger.error(`Email to ${to} failed: ${error.message}`);
    return { sent: false, reason: 'The email could not be delivered.' };
  }
}

function appUrl(pathname = '') {
  const base = String(process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim().replace(/\/+$/, '');
  return `${base}${pathname}`;
}

function sendGroupInvitation({ to, inviterName, groupName, groupDescription, role, expiresAt, isRegistered }) {
  const link = appUrl('/invitations');
  const signup = appUrl(`/register?redirect=${encodeURIComponent('/invitations')}`);
  const expires = new Date(expiresAt).toDateString();
  const action = isRegistered ? `Open ${link} to accept or decline.` : `Create a free account with this email address at ${signup}, then open ${link} to accept.`;
  const text = `${inviterName} invited you to join "${groupName}" on Veave as ${role === 'admin' ? 'an admin' : 'a member'}.\n${groupDescription ? `\n${groupDescription}\n` : ''}\n${action}\n\nThis invitation expires on ${expires}. If you do not know ${inviterName}, ignore this email.`;
  const button = (href, label) => `<a href="${esc(href)}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:10px">${esc(label)}</a>`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111827">
<h2 style="margin:0 0 12px;font-size:18px">You're invited to ${esc(groupName)}</h2>
<p style="font-size:14px;line-height:1.6;margin:0 0 12px"><b>${esc(inviterName)}</b> invited you to join <b>${esc(groupName)}</b> on Veave as ${role === 'admin' ? 'an admin' : 'a member'}.</p>
${groupDescription ? `<p style="font-size:13px;color:#52525b;margin:0 0 16px">${esc(groupDescription)}</p>` : ''}
<p style="margin:20px 0">${isRegistered ? button(link, 'View invitation') : button(signup, 'Create account & join')}</p>
${isRegistered ? '' : `<p style="font-size:12px;color:#52525b">Already have an account? ${button(link, 'View invitation').replace('background:#18181b;color:#fff', 'background:#fff;color:#18181b;border:1px solid #e2e5e8')}</p>`}
<p style="font-size:12px;color:#71717a;margin-top:20px">This invitation expires on ${esc(expires)}. If you do not know ${esc(inviterName)}, you can ignore this email.</p></div>`;
  return sendMail({ to, subject: `${inviterName} invited you to ${groupName} on Veave`, text, html });
}

function layout({ heading, body, href, label }) {
  const button = `<a href="${esc(href)}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:10px">${esc(label)}</a>`;
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111827"><h2 style="margin:0 0 12px;font-size:18px">${esc(heading)}</h2><div style="font-size:14px;line-height:1.6">${body}</div><p style="margin:20px 0">${button}</p><p style="font-size:12px;color:#71717a">You get this email because you started this build on Veave.</p></div>`;
}

// "Your plan is ready - approve it to start building."
function sendPlanReady({ to, name, summary, href }) {
  const link = href || appUrl('/');
  return sendMail({
    to,
    subject: 'Your Veave plan is ready for approval',
    text: `Hi ${name || 'there'},\n\nYour plan is ready. Nothing is built until you approve it.\n${summary ? `\n${summary}\n` : ''}\nReview and approve it: ${link}`,
    html: layout({ heading: 'Your plan is ready', body: `<p>Hi ${esc(name || 'there')}, your plan is ready. Nothing is built until you approve it.</p>${summary ? `<p style="color:#52525b">${esc(summary)}</p>` : ''}`, href: link, label: 'Review and approve' })
  });
}

// "Your project is ready."
function sendProjectReady({ to, name, projectName, summary, href }) {
  const link = href || appUrl('/');
  return sendMail({
    to,
    subject: `Your project "${projectName || 'Untitled'}" is ready`,
    text: `Hi ${name || 'there'},\n\nYour project "${projectName || 'Untitled'}" has finished building and passed verification.\n${summary ? `\n${summary}\n` : ''}\nOpen it: ${link}`,
    html: layout({ heading: 'Your project is ready', body: `<p>Hi ${esc(name || 'there')}, <b>${esc(projectName || 'your project')}</b> has finished building and passed verification.</p>${summary ? `<p style="color:#52525b">${esc(summary)}</p>` : ''}`, href: link, label: 'Open project' })
  });
}

module.exports = { sendPlanReady, sendProjectReady, sendMail, sendGroupInvitation, isConfigured, appUrl, setTransportForTests: (value) => { testTransport = value; }, setFetchForTests: (value) => { testFetch = value; } };
