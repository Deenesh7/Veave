#!/usr/bin/env node
/**
 * Creates an ADMIN account with an email and password (or promotes the account if the email already exists).
 *
 *   node scripts/create-admin.cjs admin@example.com                 # random password is generated and printed
 *   node scripts/create-admin.cjs admin@example.com "MyPassw0rd!"   # your own password (min 8 characters)
 */
require('../src/config/loadEnv');
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../src/models/User');
const AdminAuditLog = require('../src/models/AdminAuditLog');

(async () => {
  const args = process.argv.slice(2);
  const breakGlass = args.includes('--break-glass');
  const [emailArg, passArg] = args.filter((item) => item !== '--break-glass');
  if (!emailArg) { console.error('Usage: node scripts/create-admin.cjs <email> [password]'); process.exit(1); }
  const email = emailArg.toLowerCase();
  const password = passArg || crypto.randomBytes(9).toString('base64url');
  if (password.length < 8) { console.error('Password must be at least 8 characters.'); process.exit(1); }

  await mongoose.connect(process.env.MONGODB_URI);
  // Once a root administrator exists, all other administrators are created from the admin portal by the root. This script then refuses,
  // unless you pass --break-glass (emergency access with server access only; it is written to the audit log).
  const hasRoot = await User.exists({ isRootAdmin: true });
  if (hasRoot && !breakGlass) {
    console.error('A root administrator already exists. Create administrators from the admin portal (Admin Management).\nIf you are locked out, run this again with --break-glass.');
    await mongoose.disconnect(); process.exit(1);
  }
  let user = await User.findOne({ email });
  const before = user ? (user.role || 'USER') : null;
  if (user) { user.role = 'ADMIN'; user.status = 'active'; user.password = password; }
  else user = new User({ name: 'Admin', email, password, role: 'ADMIN' });
  if (!hasRoot) user.isRootAdmin = true; // the first administrator of a database is the root
  await user.save();
  await AdminAuditLog.create({ actorId: user._id, actorEmail: 'command line', action: 'USER_ROLE_CHANGED', resourceType: 'user', resourceId: String(user._id), before: { role: before }, after: { role: 'ADMIN' }, meta: { via: 'scripts/create-admin.cjs', email, breakGlass, root: !hasRoot } });
  console.log(`${before ? 'Updated' : 'Created'} admin\n  email:    ${email}\n  password: ${password}`);
  await mongoose.disconnect();
})().catch((error) => { console.error(error); process.exit(1); });
