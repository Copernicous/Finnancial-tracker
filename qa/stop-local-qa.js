const fs = require('fs');
const path = require('path');
const { readConfig, ensureQaDirectories } = require('./lib/qa-env');

function stopPid(pid, label) {
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`Stopped ${label}, PID ${pid}`);
  } catch (err) {
    console.log(`${label} PID ${pid} was not running (${err.message})`);
  }
}

const config = readConfig();
ensureQaDirectories(config);

[
  ['backend.pid', 'QA backend'],
  ['https-proxy.pid', 'QA HTTPS proxy']
].forEach(([fileName, label]) => {
  const filePath = path.join(config.pidsDir, fileName);
  if (!fs.existsSync(filePath)) {
    console.log(`${label}: no PID file`);
    return;
  }

  const pid = Number(fs.readFileSync(filePath, 'utf8').trim());
  if (Number.isFinite(pid)) stopPid(pid, label);
  fs.rmSync(filePath, { force: true });
});
