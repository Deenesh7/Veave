// Runs a preview compile off the main thread so a large project never blocks API requests.
const { parentPort, workerData } = require('node:worker_threads');
const { compileOffline } = require('./offlineCompile');

compileOffline(workerData.files, workerData.options)
  .then((html) => parentPort.postMessage({ ok: true, html }))
  .catch((error) => parentPort.postMessage({ ok: false, error: { message: error.message, filePath: error.filePath || null } }));
