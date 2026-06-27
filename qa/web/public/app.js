const buttons = document.querySelectorAll('[data-task]');
const qaUrl = document.getElementById('qa-url');
const openSite = document.getElementById('openSite');
const openSiteHero = document.getElementById('openSiteHero');
const statusOutput = document.getElementById('statusOutput');
const jobOutput = document.getElementById('jobOutput');
const jobMeta = document.getElementById('jobMeta');
const jobBadge = document.getElementById('jobBadge');
const resultSummary = document.getElementById('resultSummary');
const logOutput = document.getElementById('logOutput');
const fortigateUrl = document.getElementById('fortigateUrl');
const openFortigate = document.getElementById('openFortigate');

let pollTimer = null;
let qaToken = '';

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.method && options.method !== 'GET') headers['x-qa-token'] = qaToken;
  if (Object.keys(headers).length) options.headers = headers;
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed: ${response.status}`);
  return body;
}

function setButtonsDisabled(disabled) {
  buttons.forEach(button => {
    button.disabled = disabled && button.dataset.task !== 'stop';
  });
}

function updateReport(report) {
  if (!report) return;
  document.getElementById('passed').textContent = report.passed ?? '-';
  document.getElementById('failed').textContent = report.failed ?? '-';
  document.getElementById('errors').textContent = Array.isArray(report.errors) ? report.errors.length : '-';
  document.getElementById('skipped').textContent = Array.isArray(report.skipped) ? report.skipped.length : '-';
  resultSummary.textContent = `Generated ${report.generatedAt || 'unknown'} against ${report.baseURL || 'unknown URL'} using DB ${report.database || 'unknown DB'}.`;
}

function updateJob(job) {
  if (!job) return;
  jobOutput.textContent = job.output || 'No task output yet.';
  jobOutput.scrollTop = jobOutput.scrollHeight;
  jobMeta.textContent = `${job.title || 'Task'} ${job.startedAt ? `started ${job.startedAt}` : ''}${job.finishedAt ? `, finished ${job.finishedAt}` : ''}`;
  jobBadge.className = 'badge';
  if (job.running) {
    jobBadge.textContent = 'Running';
    jobBadge.classList.add('running');
    setButtonsDisabled(true);
  } else if (job.exitCode === 0) {
    jobBadge.textContent = 'Passed';
    jobBadge.classList.add('ok');
    setButtonsDisabled(false);
  } else if (job.exitCode !== null && job.exitCode !== undefined) {
    jobBadge.textContent = 'Failed';
    jobBadge.classList.add('fail');
    setButtonsDisabled(false);
  } else {
    jobBadge.textContent = 'Idle';
    setButtonsDisabled(false);
  }
}

async function refreshStatus() {
  const data = await api('/api/status');
  statusOutput.textContent = data.output || 'No status output.';
  updateReport(data.report);
  updateJob(data.job);
}

async function pollJob() {
  const job = await api('/api/job');
  updateJob(job);
  if (!job.running) {
    clearInterval(pollTimer);
    pollTimer = null;
    await refreshStatus().catch(console.error);
  }
}

async function runTask(task) {
  try {
    const options = { method: 'POST' };
    if (task === 'smoke-fortigate') {
      const baseURL = fortigateUrl.value.trim();
      if (!baseURL) {
        alert('Paste the current FortiGate URL first.');
        fortigateUrl.focus();
        return;
      }
      options.headers = { 'content-type': 'application/json' };
      options.body = JSON.stringify({ baseURL });
    }
    const job = await api(`/api/run/${task}`, options);
    updateJob(job);
    if (!pollTimer) pollTimer = setInterval(() => pollJob().catch(console.error), 1200);
  } catch (err) {
    alert(err.message);
  }
}

async function loadConfig() {
  const config = await api('/api/config');
  qaToken = config.qaToken || '';
  qaUrl.textContent = config.qaBaseURL;
  openSite.href = config.qaBaseURL;
  openSite.textContent = `Open QA site: ${config.qaBaseURL}`;
  openSiteHero.href = config.qaBaseURL;
}

async function loadLog(name) {
  const response = await fetch(`/api/logs/${name}`);
  logOutput.textContent = await response.text();
}

buttons.forEach(button => {
  button.addEventListener('click', () => runTask(button.dataset.task));
});

document.getElementById('refreshStatus').addEventListener('click', () => {
  refreshStatus().catch(err => alert(err.message));
});

document.querySelectorAll('[data-log]').forEach(button => {
  button.addEventListener('click', () => loadLog(button.dataset.log).catch(err => alert(err.message)));
});

openFortigate.addEventListener('click', () => {
  const url = fortigateUrl.value.trim();
  if (!url) {
    alert('Paste the current FortiGate URL first.');
    fortigateUrl.focus();
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
});

loadConfig().catch(console.error);
refreshStatus().catch(console.error);
loadLog('backend').catch(console.error);
