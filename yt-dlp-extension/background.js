const PORT = 9876;
const HOST = 'http://127.0.0.1';

const tabStates = {};

function getTabState(tabId) {
  if (!tabStates[tabId]) {
    tabStates[tabId] = { polling: false, url: '' };
  }
  return tabStates[tabId];
}

function setbadge(tabId, text, color) {
  browser.browserAction.setBadgeText({ text, tabId });
  browser.browserAction.setBadgeBackgroundColor({ color, tabId });
}

function setTooltip(tabId, text) {
  browser.browserAction.setTitle({ title: text, tabId });
}

function setPopup(tabId, page) {
  browser.browserAction.setPopup({ popup: page, tabId });
}

async function poll(tabId) {
  const ts = getTabState(tabId);
  if (!ts.polling) return;

  try {
    const res  = await fetch(`${HOST}:${PORT}/progress?tab_id=${tabId}`);
    const data = await res.json();

    if (data.status === 'downloading') {
  const pct = Math.round(data.progress);
  if (pct === 0) {
    setbadge(tabId, '. . .', '#4caf50');
  } else {
    setbadge(tabId, `${pct}%`, '#4caf50');
  }
  setTooltip(tabId,
    `YT-DLP Downloader\n` +
    `─────────────────\n` +
    `Status:    Downloading\n` +
    `Progress:  ${data.progress.toFixed(1)}%\n` +
    `Speed:     ${data.speed || 'calculating...'}\n` +
    `ETA:       ${data.eta || 'calculating...'}\n` +
    `File:      ${data.filename || 'unknown'}\n` +
    `─────────────────\n` +
    `Click icon to open monitor / cancel`
  );

    } else if (data.status === 'done') {
      setbadge(tabId, 'OK', '#4caf50');
      setTooltip(tabId,
        `YT-DLP Downloader\n` +
        `─────────────────\n` +
        `Status:   Done!\n` +
        `File:     ${data.filename || 'unknown'}\n` +
        `Saved to: Desktop\n` +
        `─────────────────\n` +
        `Click to download another`
      );
      setPopup(tabId, '');
      ts.polling = false;
      return;

    } else if (data.status === 'cancelled') {
      setbadge(tabId, 'STOP', '#888888');
      setTooltip(tabId,
        `YT-DLP Downloader\n` +
        `─────────────────\n` +
        `Download cancelled.\n` +
        `Click to start again`
      );
      setPopup(tabId, '');
      ts.polling = false;
      return;

    } else if (data.status === 'exists') {
      setbadge(tabId, 'HAS', '#ff9800');
      setTooltip(tabId,
        `YT-DLP Downloader\n` +
        `─────────────────\n` +
        `Already downloaded!\n` +
        `File: ${data.filename || 'unknown'}\n` +
        `─────────────────\n` +
        `File is already on your Desktop`
      );
      setPopup(tabId, '');
      ts.polling = false;
      return;

    } else if (data.status === 'error') {
      setbadge(tabId, 'ERR', '#ff4444');
      setTooltip(tabId,
        `YT-DLP Downloader\n` +
        `─────────────────\n` +
        `Status:  Error!\n` +
        `─────────────────\n` +
        `Click to see error details`
      );
      setPopup(tabId, `error.html?tab_id=${tabId}`);
      ts.polling = false;
      return;

    } else {
      setPopup(tabId, '');
      ts.polling = false;
      setbadge(tabId, '', '#888888');
      setTooltip(tabId, 'YT-DLP Downloader\n─────────────────\nClick on a YouTube video to download it');
      return;
    }
  } catch {
    setTooltip(tabId,
      `YT-DLP Downloader\n` +
      `─────────────────\n` +
      `Status:  Server unreachable\n` +
      `Make sure server.py is running`
    );
  }

  setTimeout(() => poll(tabId), 1000);
}

browser.browserAction.onClicked.addListener(async (tab) => {
  const tabId = tab.id;
  const url   = tab.url || '';
  const ts    = getTabState(tabId);
  ts.url      = url;

  // onClicked only fires when popup is '' (i.e. not downloading)
  // so this is always a "start new download" action

  // Reset any previous popup/state
  setPopup(tabId, '');
  ts.polling = false;

  setTooltip(tabId, `YT-DLP Downloader\n─────────────────\nContacting server...`);

  try {
    const params = new URLSearchParams({ url, audio: false, tab_id: tabId });
    const res    = await fetch(`${HOST}:${PORT}/download?${params}`);

    if (res.ok) {
      ts.polling = true;
      setbadge(tabId, '...', '#4caf50');
      setTooltip(tabId,
        `YT-DLP Downloader\n` +
        `─────────────────\n` +
        `Status:  Starting...\n` +
        `URL: ${url}`
      );
      // Set popup so next click opens the monitor
      setPopup(tabId, `popup.html?tab_id=${tabId}`);
      poll(tabId);
    } else {
      const errText = await res.text();
      setbadge(tabId, 'ERR', '#ff4444');
      setTooltip(tabId,
        `YT-DLP Downloader\n` +
        `─────────────────\n` +
        `Server error: ${errText}`
      );
    }
  } catch {
    setbadge(tabId, 'OFF', '#888888');
    setTooltip(tabId,
      `YT-DLP Downloader\n` +
      `─────────────────\n` +
      `Status:  Server offline\n` +
      `Run server.py to start the bridge\n` +
      `Expected at: 127.0.0.1:${PORT}`
    );
  }
});

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'DISMISS_ERROR') {
    const tabId = msg.tabId;
    setPopup(tabId, '');
    setbadge(tabId, '', '#888888');
    setTooltip(tabId, 'YT-DLP Downloader\n─────────────────\nClick on a YouTube video to download it');
  }
  if (msg.type === 'CANCEL') {
    const tabId = msg.tabId;
    fetch(`${HOST}:${PORT}/cancel?tab_id=${tabId}`)
      .then(() => {
        getTabState(tabId).polling = false;
        setPopup(tabId, '');
        setbadge(tabId, 'STOP', '#888888');
        setTooltip(tabId, 'YT-DLP Downloader\n─────────────────\nCancelled.\nClick to start again');
      })
      .catch(() => {});
  }
});