const PORT = 9876;
let pollTimer = null;

function setStatus(msg, cls = 'info') {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = cls;
}

function setProgress(pct) {
  const wrap = document.getElementById('progress-wrap');
  const bar  = document.getElementById('progress-bar');
  wrap.style.display = 'block';
  bar.style.width = `${pct}%`;
}

function setButtons(disabled) {
  document.getElementById('dl-btn').disabled = disabled;
  document.getElementById('dl-audio-btn').disabled = disabled;
}

async function pollProgress() {
  try {
    const res  = await fetch(`http://localhost:${PORT}/progress`);
    const data = await res.json();

    if (data.status === 'downloading') {
      setProgress(data.progress);
      setStatus(`Downloading… ${Math.round(data.progress)}%`, 'info');
      pollTimer = setTimeout(pollProgress, 1000);

    } else if (data.status === 'done') {
      setProgress(100);
      setStatus('✓ Done!', 'ok');
      setButtons(false);

    } else if (data.status === 'error') {
      setStatus('✗ Download failed.', 'err');
      setButtons(false);

    } else {
      // idle — clear up
      setButtons(false);
    }
  } catch {
    setStatus('✗ Server unreachable.', 'err');
    setButtons(false);
  }
}

async function startDownload(url, audioOnly) {
  setButtons(true);
  setStatus('Starting…', 'info');
  setProgress(0);

  try {
    const params = new URLSearchParams({ url, audio: audioOnly });
    const res = await fetch(`http://localhost:${PORT}/download?${params}`);
    if (!res.ok) throw new Error();
    // Tell background.js to start badge polling
    chrome.runtime.sendMessage({ type: 'DOWNLOAD_STARTED' });
    // Also poll in popup while it's open
    pollTimer = setTimeout(pollProgress, 1000);
  } catch {
    setStatus('✗ Server not running!', 'err');
    setButtons(false);
  }
}

// On open, check if a download is already running
async function checkOnOpen() {
  try {
    const res  = await fetch(`http://localhost:${PORT}/progress`);
    const data = await res.json();
    if (data.status === 'downloading') {
      setButtons(true);
      setProgress(data.progress);
      setStatus(`Already downloading… ${Math.round(data.progress)}%`, 'info');
      pollTimer = setTimeout(pollProgress, 1000);
    }
  } catch { /* server not running */ }
}

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  const url   = tab?.url || '';
  const isYT  = url.includes('youtube.com/watch');

  if (!isYT) {
    document.getElementById('content').style.display = 'none';
    document.getElementById('not-yt').style.display  = 'block';
    return;
  }

  document.getElementById('url-display').textContent = url;
  checkOnOpen();

  document.getElementById('dl-btn').addEventListener('click', () => {
    startDownload(url, false);
  });

  document.getElementById('dl-audio-btn').addEventListener('click', () => {
    startDownload(url, true);
  });
});
