const PORT = 9876;
const HOST = 'http://127.0.0.1';

const params = new URLSearchParams(window.location.search);
const tabId  = parseInt(params.get('tab_id')) || 0;

fetch(`${HOST}:${PORT}/error?tab_id=${tabId}`)
  .then(r => r.json())
  .then(data => {
    const box  = document.getElementById('error-box');
    const text = data.error_text?.trim();
    if (!text) { box.textContent = 'No error details were captured.'; return; }
    const lines     = text.split('\n').filter(l => l.trim());
    const important = lines.filter(l => /error|warning|unable|failed/i.test(l));
    box.textContent = (important.length > 0 ? important : lines.slice(-15)).join('\n');
  })
  .catch(() => {
    document.getElementById('error-box').textContent = 'Could not reach bridge server.';
  });

document.getElementById('dismiss').addEventListener('click', () => {
  browser.runtime.sendMessage({ type: 'DISMISS_ERROR', tabId });
  window.close();
});