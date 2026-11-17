#!/usr/bin/env node
/**
 * Gives (or removes) the ADMIN role of an existing account.
 *
 *   node scripts/promote-admin.cjs someone@example.com           # make admin
 *   node scripts/promote-admin.cjs someone@example.com --remove  # back to a normal user
 *
 * This is how the first administrator is created. Afterwards admins can manage each other in the dashboard (Admin Management).
 * The very first administrator of a database becomes the ROOT administrator; after that this script needs --break-glass.
 * ADMIN_EMAILS only bootstraps an empty database (its first email); it never adds administrators later.
 */
require('../src/config/loadEnv');
const mongoose = require('mongoose');
const User = require('../src/models/User');
const AdminAuditLog = require('../src/models/AdminAuditLog');

(async () => {
  const args = process.argv.slice(2);
  const breakGlass = args.includes('--break-glass');
  const [email, flag] = args.filter((item) => item !== '--break-glass');
  if (!email) { console.error('Usage: node scripts/promote-admin.cjs <email> [--remove]'); process.exit(1); }
  await mongoose.connect(process.env.MONGODB_URI);
  // After the root administrator exists, administrators are managed from the portal. This is emergency access only.
  const hasRoot = await User.exists({ isRootAdmin: true });
  if (hasRoot && !breakGlass) {
    console.error('A root administrator already exists. Manage administrators from the admin portal (Admin Management), or add --break-glass in an emergency.');
    await mongoose.disconnect(); process.exit(1);
  }
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) { console.error(`No account with the email ${email}.`); await mongoose.disconnect(); process.exit(1); }
  const role = flag === '--remove' ? 'USER' : 'ADMIN';
  if (role === 'USER' && user.role === 'ADMIN' && (await User.countDocuments({ role: 'ADMIN', _id: { $ne: user._id } })) < 1) {
    console.error('This is the last administrator; promote someone else first.'); await mongoose.disconnect(); process.exit(1);
  }
  const before = user.role || 'USER';
  if (user.isRootAdmin && role === 'USER') { console.error('The root administrator cannot be demoted with this script.'); await mongoose.disconnect(); process.exit(1); }
  user.role = role;
  if (role === 'ADMIN' && !hasRoot) user.isRootAdmin = true;
  await user.save();
  await AdminAuditLog.create({ actorId: user._id, actorEmail: 'command line', action: 'USER_ROLE_CHANGED', resourceType: 'user', resourceId: String(user._id), before: { role: before }, after: { role }, meta: { via: 'scripts/promote-admin.cjs', email: user.email, breakGlass } });
  console.log(`${user.email}: ${before} -> ${role}`);
  await mongoose.disconnect();
})().catch((error) => { console.error(error); process.exit(1); });
