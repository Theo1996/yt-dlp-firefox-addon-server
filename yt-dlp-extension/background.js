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
  browser.browserAction.setBadgeText({ text: text ? text + ' ' : '', tabId });
  browser.browserAction.setBadgeBackgroundColor({ color, tabId });
}

function setTooltip(tabId, text) {
  browser.browserAction.setTitle({ title: text, tabId });
}

function setPopup(tabId, page) {
  browser.browserAction.setPopup({ popup: page, tabId });
}

function isPlaylist(url) {
  try {
    const u = new URL(url);
    return u.searchParams.has('v') && u.searchParams.has('list');
  } catch { return false; }
}

function videoOnlyUrl(url) {
  try {
    const u = new URL(url);
    const v = u.searchParams.get('v');
    return `https://www.youtube.com/watch?v=${v}`;
  } catch { return url; }
}

async function startDownload(tabId, url) {
  const ts = getTabState(tabId);
  ts.url   = url;

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
}

async function poll(tabId) {
  const ts = getTabState(tabId);
  if (!ts.polling) return;

  try {
    const res  = await fetch(`${HOST}:${PORT}/progress?tab_id=${tabId}`);
    const data = await res.json();

    if (data.status === 'downloading') {
      const pct        = Math.round(data.progress);
      const isPlaylist = data.playlist_total > 0;

      if (isPlaylist) {
        const showPlaylist = Math.floor(Date.now() / 2000) % 2 === 0;
        if (showPlaylist) {
          setbadge(tabId, `${data.playlist_cur}/${data.playlist_total}`, '#4caf50');
        } else {
          setbadge(tabId, pct === 0 ? '...' : `${pct}%`, '#4caf50');
        }
      } else {
        setbadge(tabId, pct === 0 ? '...' : `${pct}%`, '#4caf50');
      }

      setTooltip(tabId,
        `YT-DLP Downloader\n` +
        `─────────────────\n` +
        `Status:    Downloading\n` +
        (isPlaylist ? `Playlist:  ${data.playlist_cur} of ${data.playlist_total}\n` : '') +
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
      setTooltip(tabId, 'YT-DLP Downloader\n─────────────────\nClick on a page to download media');
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

async function updatePopupForTab(tabId, url) {
  try {
    const res  = await fetch(`${HOST}:${PORT}/progress?tab_id=${tabId}`);
    const data = await res.json();
    if (!['downloading', 'error'].includes(data.status)) {
      if (isPlaylist(url)) {
        const encoded = encodeURIComponent(url);
        setPopup(tabId, `choice.html?tab_id=${tabId}&url=${encoded}`);
      } else {
        setPopup(tabId, '');
      }
    }
  } catch {
    if (isPlaylist(url)) {
      const encoded = encodeURIComponent(url);
      setPopup(tabId, `choice.html?tab_id=${tabId}&url=${encoded}`);
    } else {
      setPopup(tabId, '');
    }
  }
}

browser.browserAction.onClicked.addListener(async (tab) => {
  const tabId = tab.id;
  const url   = tab.url || '';
  const ts    = getTabState(tabId);

  if (!url) {
    setbadge(tabId, '?', '#888888');
    setTooltip(tabId, `YT-DLP Downloader\n─────────────────\nNo URL found on this tab`);
    return;
  }

  try {
    const checkRes  = await fetch(`${HOST}:${PORT}/progress?tab_id=${tabId}`);
    const checkData = await checkRes.json();

    if (checkData.status === 'downloading') {
      const pct = Math.round(checkData.progress);
      setbadge(tabId, `${pct}%`, '#4caf50');
      setPopup(tabId, `popup.html?tab_id=${tabId}`);
      if (!ts.polling) {
        ts.polling = true;
        poll(tabId);
      }
      return;
    }

    if (['done', 'error', 'exists', 'cancelled'].includes(checkData.status)) {
      ts.polling = false;
      setPopup(tabId, '');
    }

  } catch {
    setbadge(tabId, 'OFF', '#888888');
    setTooltip(tabId,
      `YT-DLP Downloader\n` +
      `─────────────────\n` +
      `Status:  Server offline\n` +
      `Run server.py to start the bridge`
    );
    return;
  }

  // Non-playlist — start immediately
  await startDownload(tabId, url);
});

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'DISMISS_ERROR') {
    const tabId = msg.tabId;
    setPopup(tabId, '');
    setbadge(tabId, '', '#888888');
    setTooltip(tabId, 'YT-DLP Downloader\n─────────────────\nClick on a page to download media');
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

  if (msg.type === 'START_DOWNLOAD') {
    const { tabId, url } = msg;
    setPopup(tabId, '');
    startDownload(tabId, url);
  }
});

browser.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const res  = await fetch(`${HOST}:${PORT}/progress?tab_id=${tabId}`);
    const data = await res.json();
    const ts   = getTabState(tabId);

    if (data.status === 'downloading' && !ts.polling) {
      ts.polling = true;
      setPopup(tabId, `popup.html?tab_id=${tabId}`);
      poll(tabId);

    } else if (data.status === 'done') {
      ts.polling = false;
      setbadge(tabId, 'OK', '#4caf50');
      setPopup(tabId, '');

    } else if (data.status === 'exists') {
      ts.polling = false;
      setbadge(tabId, 'HAS', '#ff9800');
      setPopup(tabId, '');

    } else if (data.status === 'cancelled') {
      ts.polling = false;
      setbadge(tabId, 'STOP', '#888888');
      setPopup(tabId, '');

    } else if (data.status === 'error') {
      ts.polling = false;
      setbadge(tabId, 'ERR', '#ff4444');
      setPopup(tabId, `error.html?tab_id=${tabId}`);

    } else {
      ts.polling = false;
      setbadge(tabId, '', '#888888');
      const tab = await browser.tabs.get(tabId);
      await updatePopupForTab(tabId, tab.url || '');
    }
  } catch {}
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    const ts = getTabState(tabId);
    if (!ts.polling) {
      await updatePopupForTab(tabId, changeInfo.url);
    }
  }
});
