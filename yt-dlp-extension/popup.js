const PORT   = 9876;
const HOST   = 'http://127.0.0.1';
const params = new URLSearchParams(window.location.search);
const tabId  = parseInt(params.get('tab_id')) || 0;

const log           = document.getElementById('log');
const pill          = document.getElementById('status-pill');
const bar           = document.getElementById('progress-bar');
const statPct       = document.getElementById('stat-pct');
const statSpeed     = document.getElementById('stat-speed');
const statEta       = document.getElementById('stat-eta');
const statFile      = document.getElementById('stat-file');
const footerMsg     = document.getElementById('footer-msg');
const cancelBtn     = document.getElementById('cancel-btn');
const settingsBtn   = document.getElementById('settings-btn');
const mainView      = document.getElementById('main-view');
const settingsPanel = document.getElementById('settings-panel');
const dirInput      = document.getElementById('dir-input');
const dirStatus     = document.getElementById('dir-status');
const saveDirBtn    = document.getElementById('save-dir-btn');

let since           = 0;
let autoScroll      = true;
let done            = false;
let lastLineCount   = 0;
let showingSettings = false;

// --- Settings toggle ---
settingsBtn.addEventListener('click', () => {
  showingSettings = !showingSettings;
  if (showingSettings) {
    mainView.style.display = 'none';
    settingsPanel.classList.add('visible');
    settingsBtn.textContent = '✕';
    fetch(`${HOST}:${PORT}/getdir`)
      .then(r => r.json())
      .then(d => { dirInput.value = d.path; })
      .catch(() => {});
  } else {
    mainView.style.display = 'flex';
    settingsPanel.classList.remove('visible');
    settingsBtn.textContent = '⚙';
  }
});

saveDirBtn.addEventListener('click', async () => {
  const path = dirInput.value.trim();
  if (!path) return;
  try {
    const res = await fetch(`${HOST}:${PORT}/setdir`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ path })
    });
    if (res.ok) {
      dirStatus.textContent = '✓ Saved!';
      dirStatus.className   = 'ok';
    } else {
      const msg = await res.text();
      dirStatus.textContent = `✗ ${msg}`;
      dirStatus.className   = 'err';
    }
  } catch {
    dirStatus.textContent = '✗ Could not reach server';
    dirStatus.className   = 'err';
  }
  setTimeout(() => { dirStatus.textContent = ''; }, 3000);
});

// --- Log ---
log.addEventListener('scroll', () => {
  autoScroll = log.scrollTop + log.clientHeight >= log.scrollHeight - 10;
});

cancelBtn.addEventListener('click', () => {
  cancelBtn.disabled    = true;
  cancelBtn.textContent = 'Stopping...';
  browser.runtime.sendMessage({ type: 'CANCEL', tabId });
});

function classForLine(line) {
  if (line.startsWith('[stderr]'))        return 'stderr';
  if (/\[Merger\]|\[ffmpeg\]/.test(line)) return 'merge';
  if (/\d+\.?\d*%/.test(line))           return 'progress';
  if (/^\[download\]/.test(line))         return 'progress';
  return 'info';
}

function appendLines(lines) {
  lines.forEach(line => {
    const div = document.createElement('div');
    div.className   = `line ${classForLine(line)}`;
    div.textContent = line;
    log.appendChild(div);
  });
  if (autoScroll) log.scrollTop = log.scrollHeight;
}

function setPill(status) {
  pill.textContent = status;
  pill.className   = status;
}

async function fetchProgress() {
  try {
    const res  = await fetch(`${HOST}:${PORT}/progress?tab_id=${tabId}`);
    const data = await res.json();
    if (data.progress > 0) {
      bar.style.width     = `${data.progress}%`;
      statPct.textContent = `${data.progress.toFixed(1)}%`;
    }
    if (data.speed)    statSpeed.textContent = data.speed;
    if (data.eta)      statEta.textContent   = data.eta;
    if (data.filename) statFile.textContent  = data.filename.length > 24
      ? data.filename.slice(0, 22) + '…'
      : data.filename;
  } catch {}
}

async function fetchOutput() {
  if (done) return;

  try {
    const res  = await fetch(`${HOST}:${PORT}/output?tab_id=${tabId}&since=${since}`);
    const data = await res.json();

    if (data.lines.length > 0) {
      appendLines(data.lines);
      since = data.total;
    }

    setPill(data.status);
    await fetchProgress();

    if (['done', 'error', 'exists'].includes(data.status)) {
      done = true;
      cancelBtn.classList.add('hidden');
      bar.style.width = data.status === 'done' ? '100%' : bar.style.width;

      if (data.status === 'done') {
        footerMsg.textContent = '✓ Download complete — you can close this';
        footerMsg.style.color = '#4caf50';
      } else if (data.status === 'exists') {
        footerMsg.textContent = '⊘ Already downloaded';
        footerMsg.style.color = '#ff9800';
      } else {
        footerMsg.textContent = '✗ Error — check the ERR badge for details';
        footerMsg.style.color = '#ff4444';
      }
      return;
    }

    if (data.status === 'cancelled') {
      cancelBtn.classList.add('hidden');
      footerMsg.textContent = '⊘ Stopping — waiting for yt-dlp to exit...';
      footerMsg.style.color = '#888';
      if (data.lines.length === 0 && since === lastLineCount) {
        done = true;
        footerMsg.textContent = '⊘ Cancelled';
        return;
      }
      lastLineCount = since;
    }

  } catch {
    setPill('offline');
  }

  setTimeout(fetchOutput, 500);
}

fetchOutput();