const PORT = 9876;

fetch(`http://localhost:${PORT}/error`)
  .then(r => r.json())
  .then(data => {
    const box  = document.getElementById('error-box');
    const text = data.error_text?.trim();

    if (!text) {
      box.textContent = 'No error details were captured.';
      return;
    }

    const lines     = text.split('\n').filter(l => l.trim());
    const important = lines.filter(l => /error|warning|unable|failed/i.test(l));
    box.textContent = (important.length > 0 ? important : lines.slice(-15)).join('\n');
  })
  .catch(() => {
    document.getElementById('error-box').textContent = 'Could not reach bridge server.';
  });

document.getElementById('dismiss').addEventListener('click', () => {
  browser.runtime.sendMessage({ type: 'DISMISS_ERROR' });
  window.close();
});
