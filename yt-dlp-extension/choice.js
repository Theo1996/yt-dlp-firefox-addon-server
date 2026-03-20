const params  = new URLSearchParams(window.location.search);
const tabId   = parseInt(params.get('tab_id')) || 0;
const fullUrl = decodeURIComponent(params.get('url') || '');

document.getElementById('url-display').textContent = fullUrl;

function videoOnlyUrl(url) {
  try {
    const u = new URL(url);
    const v = u.searchParams.get('v');
    return `https://www.youtube.com/watch?v=${v}`;
  } catch { return url; }
}

function pick(url) {
  document.getElementById('btn-video').disabled    = true;
  document.getElementById('btn-playlist').disabled = true;
  document.getElementById('status').textContent    = 'Starting download...';
  browser.runtime.sendMessage({ type: 'START_DOWNLOAD', tabId, url });
  setTimeout(() => window.close(), 500);
}

document.getElementById('btn-video').addEventListener('click', () => {
  pick(videoOnlyUrl(fullUrl));
});

document.getElementById('btn-playlist').addEventListener('click', () => {
  pick(fullUrl);
});