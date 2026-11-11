// Runtime settings come from frontend/.env.development and frontend/.env.production (Vite reads VITE_* variables).
const API_URL = String(import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

if (!API_URL) {
  throw new Error('VITE_API_URL is not set. Add it to frontend/.env.development (and .env.production).');
}

export { API_URL };
