const PORT = 9876;
let polling = false;

async function poll() {
  if (!polling) return;

  try {
    const res  = await fetch(`http://localhost:${PORT}/progress`);
    const data = await res.json();

    if (data.status === 'downloading') {
      const pct = Math.round(data.progress);
      browser.action.setBadgeText({ text: `${pct}%` });
      browser.action.setBadgeBackgroundColor({ color: '#cc0000' });

    } else if (data.status === 'done') {
      browser.action.setBadgeText({ text: 'OK' });
      browser.action.setBadgeBackgroundColor({ color: '#4caf50' });
      polling = false;
      return;

    } else if (data.status === 'error') {
      browser.action.setBadgeText({ text: 'ERR' });
      browser.action.setBadgeBackgroundColor({ color: '#ff4444' });
      browser.action.setPopup({ popup: 'error.html' });
      polling = false;
      return;

    } else {
      polling = false;
      browser.action.setBadgeText({ text: '' });
      return;
    }
  } catch {
    // server unreachable, keep trying
  }

  setTimeout(poll, 1000);
}

browser.action.onClicked.addListener(async (tab) => {
  const url = tab.url || '';

  if (!url.includes('youtube.com/watch')) {
    browser.action.setBadgeText({ text: '?' });
    browser.action.setBadgeBackgroundColor({ color: '#888888' });
    return;
  }

  if (polling) return;

  try {
    const params = new URLSearchParams({ url, audio: false });
    const res = await fetch(`http://localhost:${PORT}/download?${params}`);

    if (res.ok) {
      polling = true;
      browser.action.setBadgeText({ text: '...' });
      browser.action.setBadgeBackgroundColor({ color: '#cc0000' });
      poll();
    } else {
      browser.action.setBadgeText({ text: 'ERR' });
      browser.action.setBadgeBackgroundColor({ color: '#ff4444' });
      browser.action.setPopup({ popup: 'error.html' });
    }
  } catch {
    browser.action.setBadgeText({ text: 'OFF' });
    browser.action.setBadgeBackgroundColor({ color: '#888888' });
  }
});

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'DISMISS_ERROR') {
    browser.action.setPopup({ popup: '' });
    browser.action.setBadgeText({ text: '' });
  }
});
