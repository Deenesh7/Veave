// Loads backend/.env.<NODE_ENV> (development unless NODE_ENV=production), then a plain backend/.env if one exists.
// Variables already set in the real environment always win.
const path = require('node:path');
const dotenv = require('dotenv');

const mode = process.env.NODE_ENV === 'production' ? 'production' : 'development';
const root = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(root, `.env.${mode}`) });
dotenv.config({ path: path.join(root, '.env') });

// Safety: development must never point at a remote/production database by accident.
if (mode === 'development' && process.env.ALLOW_REMOTE_DB_IN_DEV !== 'true') {
  const uri = String(process.env.MONGODB_URI || '');
  const host = (uri.match(/^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/) || [])[1] || '';
  if (host && !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::27017)?$/.test(host)) {
    console.error(`Refusing to start: development MONGODB_URI points at "${host}", not the local database (localhost:27017). Fix backend/.env.development, or set ALLOW_REMOTE_DB_IN_DEV=true to override.`);
    process.exit(1);
  }
}
module.exports = { mode };
