const archiver = require('archiver');
const { Writable } = require('stream');
const { scaffoldReactProject } = require('./reactScaffolder');
const { validateFilePaths, formatDiagnostics } = require('../ai/generationPipeline');

const generateExport = async (project) => {
  // Export the tested manifest, lockfile and config exactly once. Older projects
  // without a manifest still need the original React scaffold on export.
  const source = (project.files || []).map(({ path, content, language, encoding }) => ({ path, content, language, encoding }));
  const files = source.some((file) => file.path === 'package.json')
    ? source : scaffoldReactProject(source, { projectName: project.name });
  const errors = validateFilePaths(files);
  if (errors.length) throw new Error(formatDiagnostics(errors));
  return new Promise((resolve, reject) => {
    const chunks = [];
    const stream = new Writable({ write(chunk, encoding, callback) { chunks.push(chunk); callback(); } });
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', reject);
    stream.on('error', reject);
    stream.on('finish', () => resolve(Buffer.concat(chunks)));
    archive.pipe(stream);
    for (const file of files) archive.append(file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : file.content, { name: file.path });
    archive.finalize().catch(reject);
  });
};

module.exports = { generateExport };
