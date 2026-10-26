// Tracks the newest server revision seen for each project. Saves send it back as `baseRevision`, so the backend can
// refuse a save that would overwrite a teammate's newer changes on a shared project.
const revisions = new Map();

export function noteRevision(project) {
  const id = project && (project._id || project.id);
  if (!id || !Number.isInteger(project.revision)) return;
  const key = String(id);
  revisions.set(key, Math.max(revisions.get(key) ?? -1, project.revision));
}

export function getKnownRevision(projectId) {
  const value = revisions.get(String(projectId));
  return value === undefined ? null : value;
}

export function looksLikeProject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && value._id && Number.isInteger(value.revision) && ('files' in value || 'settings' in value || 'name' in value);
}

export function noteRevisionsFromResponseBody(body) {
  if (!body || typeof body !== 'object') return;
  for (const candidate of [body.data, body.project, body.data?.project, body]) {
    if (looksLikeProject(candidate)) noteRevision(candidate);
  }
}

// Which write requests must carry the revision they were based on.
const WRITE_URL = /^\/?(?:projects\/([a-f0-9]{24})(?:\/files)?|history\/projects\/([a-f0-9]{24})\/history)\/?$/i;

export function projectIdForRevisionedWrite(method, url) {
  const m = String(method || '').toLowerCase();
  const match = WRITE_URL.exec(String(url || '').split('?')[0]);
  if (!match) return null;
  if (match[1] && m === 'patch') return match[1];
  if (match[2] && m === 'post') return match[2];
  return null;
}
