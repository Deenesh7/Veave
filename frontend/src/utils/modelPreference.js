// The AI model is no longer picked in the home composer; it is a saved preference edited in Settings.
const KEY = 'veave_preferred_model';
export const DEFAULT_MODEL = 'Veave AI';

// There is a single model; any older saved choice is ignored.
export function getPreferredModel() {
  return DEFAULT_MODEL;
}

export function setPreferredModel() {
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}
