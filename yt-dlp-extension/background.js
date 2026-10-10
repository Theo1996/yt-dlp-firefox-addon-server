const PORT = 9876;
const HOST = 'http://127.0.0.1';

const tabStates = {};

function getTabState(tabId) {
  if (!tabStates[tabId]) {
    tabStates[tabId] = { polling: false, url: '' };
  }
  return tabStates[tabId];
}

const VERSION = browser.runtime.getManifest().version;

// ---- server update check (compares local server's /version with SERVER_VERSION in server.py on GitHub)
const SERVER_REPO_URL = 'https://github.com/Theo1996/yt-dlp-firefox-addon-server/tree/main';
const SERVER_RAW_URL  = 'https://raw.githubusercontent.com/Theo1996/yt-dlp-firefox-addon-server/main/server.py';
const CHECK_EVERY  = 12 * 3600 * 1000;
const REMIND_EVERY = 3 * 24 * 3600 * 1000;
let updateInfo = null;

function cmpVer(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n) || 0);
  const pb = String(b).split('.').map(n => parseInt(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

async function checkServerUpdate() {
  try {
    const st = await browser.storage.local.get(['updateCheck', 'lastRemoteCheck', 'remoteVersion', 'notified']);
    if (st.updateCheck === false) { updateInfo = null; return; }

    let local;
    try {
      const r = await fetch(`${HOST}:${PORT}/version`);
      local = r.ok ? String((await r.json()).version) : '0';   // old server without /version
    } catch { return; }                                        // server offline: retry later

    let remote = st.remoteVersion;
    if (!remote || Date.now() - (st.lastRemoteCheck || 0) > CHECK_EVERY) {
      try {
        const r = await fetch(SERVER_RAW_URL, { cache: 'no-store' });
        const m = r.ok && (await r.text()).match(/SERVER_VERSION\s*=\s*['"]([\d.]+)['"]/);
        if (m) {
          remote = m[1];
          await browser.storage.local.set({ remoteVersion: remote, lastRemoteCheck: Date.now() });
        }
      } catch {}                                               // keep cached value
    }
    if (!remote) return;

    if (cmpVer(remote, local) > 0) {
      updateInfo = { local: local === '0' ? 'old (no version info)' : 'v' + local, remote, url: SERVER_REPO_URL };
      const n = st.notified || {};
      if (n.version !== remote || Date.now() - (n.time || 0) > REMIND_EVERY) {
        browser.notifications.create('server-update', {
          type: 'basic',
          iconUrl: 'icon.png',
          title: 'YT Downloader: new server version',
          message: `Server v${remote} is available (installed: ${updateInfo.local}). Click to open the download page.`
        });
        await browser.storage.local.set({ notified: { version: remote, time: Date.now() } });
      }
    } else {
      updateInfo = null;
    }
  } catch {}
}

browser.notifications.onClicked.addListener(id => {
  if (id === 'server-update') {
    browser.tabs.create({ url: SERVER_REPO_URL });
    browser.notifications.clear(id);
  }
});

setTimeout(checkServerUpdate, 8000);
setInterval(checkServerUpdate, 3600 * 1000);

function shortUrl(u, n = 70) {
  return !u ? 'unknown' : (u.length > n ? u.slice(0, n - 1) + '…' : u);
}

const HINTS = [
  [/sign in to confirm|not a bot|cookies/i,            'YouTube requires login / bot check. Retry later or use browser cookies in yt-dlp.'],
  [/private video|video is private/i,                                  'Video is private. Needs an account with access.'],
  [/members-only|join this channel/i,                   'Members-only video. Needs login cookies.'],
  [/age[- ]restricted|confirm your age/i,               'Age-restricted. Needs login cookies.'],
  [/video unavailable|has been removed|no longer available|does not exist/i, 'Video removed or unavailable.'],
  [/not available in your country|geo|blocked it in your country/i, 'Region-blocked.'],
  [/premiere|live event will begin|is upcoming/i,       'Not released yet / live stream not started.'],
  [/HTTP Error 403/i,                                   'HTTP 403: blocked by site. Update yt-dlp.'],
  [/HTTP Error 429|too many requests/i,                 'HTTP 429: rate limited. Wait and retry.'],
  [/HTTP Error 404/i,                                   'HTTP 404: not found.'],
  [/requested format is not available/i,                'No matching format. Update yt-dlp.'],
  [/ffmpeg|ffprobe/i,                                   'ffmpeg/ffprobe missing or failing. Check it is installed and in PATH.'],
  [/unsupported url/i,                                  'Page is not supported by yt-dlp.'],
  [/unable to extract|nsig|signature/i,                 'Extractor broke. Update yt-dlp.'],
  [/timed out|timeout|getaddrinfo|connection|ssl/i,     'Network problem between the PC and the site.'],
  [/permission denied|errno 13|access is denied/i,      'Cannot write to the save folder. Check path/permissions.'],
  [/no space left|errno 28/i,                           'Disk full.']
];

function hintFor(text) {
  for (const [re, h] of HINTS) if (re.test(text)) return h;
  return '';
}

const SKIP_EXTRACTORS = new Set(['download', 'info', 'debug', 'Merger', 'ffmpeg', 'ExtractAudio', 'Metadata', 'FixupM3u8', 'FixupM4a']);

// parses yt-dlp output lines into [{item, extractor, id, url, reason, hint}]
function parseYtdlp(lines, pageUrl) {
  const out = [];
  let item = '', curUrl = '', curId = '', curExt = '', m;
  for (const raw of lines) {
    const line = String(raw).replace(/^\[stderr\]\s*/, '').trim();
    if ((m = line.match(/Downloading (?:item|video) (\d+) of (\d+)/i))) { item = `${m[1]}/${m[2]}`; curUrl = ''; curId = ''; curExt = ''; continue; }
    if ((m = line.match(/^\[([\w:+-]+)\]\s+Extracting URL:\s*(\S+)/))) { curUrl = m[2]; curExt = m[1]; continue; }
    if ((m = line.match(/^\[([\w:+-]+)\]\s+([\w-]{6,}):\s+(?:Downloading|Downloaded|Extracting|Getting|Fetching)/)) && !SKIP_EXTRACTORS.has(m[1])) { curExt = m[1]; curId = m[2]; continue; }
    if ((m = line.match(/^ERROR:\s*(.*)$/))) {
      let body = m[1], ext = curExt, id = curId, reason = body;
      const m2 = body.match(/^\[([^\]]+)\]\s+([^:\s]+):\s*(.*)$/);
      if (m2) { ext = m2[1]; id = m2[2]; reason = m2[3]; }
      else {
        const m3 = body.match(/^\[([^\]]+)\]\s*(.*)$/);
        if (m3) { ext = m3[1]; reason = m3[2]; }
      }
      const found = body.match(/https?:\/\/[^\s'"]+/);
      let url = found ? found[0] : '';
      if (!url && /^youtube/i.test(ext) && id) url = `https://www.youtube.com/watch?v=${id}`;
      if (!url) url = curUrl || pageUrl || '';
      const f = { item, extractor: ext, id, url, reason: reason.trim(), hint: hintFor(body) };
      const last = out[out.length - 1];
      if (!last || last.reason !== f.reason || last.url !== f.url) out.push(f);
    }
  }
  return out;
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

function errorTooltip(ts) {
  const info = ts.errorInfo;
  let body = '';
  if (info && info.kind === 'server') {
    body = `Server error: HTTP ${info.httpStatus}\n${info.message}\nURL: ${shortUrl(info.url)}\n`;
  } else if (info && info.failures && info.failures.length) {
    const f = info.failures[0];
    body = (f.item ? `Item:   ${f.item}\n` : '') +
           `Video:  ${shortUrl(f.url)}\n` +
           `Why:    ${f.reason}\n` +
           (f.hint ? `Hint:   ${f.hint}\n` : '') +
           (info.failures.length > 1 ? `(+${info.failures.length - 1} more failed)\n` : '');
  } else if (ts.url) {
    body = `URL: ${shortUrl(ts.url)}\n`;
  }
  return HDR + `Status:  Error!\n` + body + `─────────────────\nClick icon for full error details`;
}

async function collectError(tabId) {
  const ts = getTabState(tabId);
  let url = ts.url;
  if (!url) {
    try { url = (await browser.tabs.get(tabId)).url || ''; } catch {}
  }
  const info = { kind: 'ytdlp', time: new Date().toLocaleString(), url, lines: [], errorText: '', failures: [], problems: [] };
  try {
    const r = await fetch(`${HOST}:${PORT}/output?tab_id=${tabId}&since=0`);
    const d = await r.json();
    info.lines = d.lines || [];
  } catch (e) { info.problems.push(`GET /output failed: ${e.message}`); }
  try {
    const r = await fetch(`${HOST}:${PORT}/error?tab_id=${tabId}`);
    const d = await r.json();
    info.errorText = d.error_text || '';
    info.logPath   = d.log_path || '';
    info.logDir    = d.log_dir || '';
    info._srvFailures = d.failures || [];
    info.exitCode  = d.returncode;
    info.command   = d.cmd || '';
    if (d.log_error) info.problems.push(d.log_error);
  } catch (e) { info.problems.push(`GET /error failed: ${e.message}`); }

  const src = info.lines.length ? info.lines : info.errorText.split('\n');
  info.failures = parseYtdlp(src, url);
  if (!info.failures.length) {
    const cand = src.map(l => String(l).replace(/^\[stderr\]\s*/, '').trim()).filter(l => /error|fail|unable|exception|denied/i.test(l));
    const last = cand[cand.length - 1] || src.map(l => String(l).trim()).filter(Boolean).pop() || '';
    if (last) info.failures.push({ item: '', extractor: '', id: '', url: url || '', reason: last, hint: hintFor(last) });
  }
  info.failures.forEach((f, i) => {
    const sf = info._srvFailures[i];
    if (sf && sf.reason === f.reason && sf.log_file) f.logFile = sf.log_file;
  });
  delete info._srvFailures;
  ts.errorInfo = info;
  if (ts.url === '' || ts.url === undefined) ts.url = url;
  setTooltip(tabId, errorTooltip(ts));
  return info;
}

function ensureErrorInfo(tabId) {
  const ts = getTabState(tabId);
  if (!ts.errPromise) ts.errPromise = collectError(tabId);
  return ts.errPromise;
}

async function startDownload(tabId, url) {
  const ts = getTabState(tabId);
  ts.url   = url;
  ts.errorInfo = null;
  ts.errPromise = null;
  ts.pollFails = 0;

  setTooltip(tabId, `YT-DLP Downloader\n─────────────────\nContacting server...`);

  try {
    const params = new URLSearchParams({ url, audio: false, tab_id: tabId });
    const res    = await fetch(`${HOST}:${PORT}/download?${params}`);

    if (res.ok) {
      checkServerUpdate();
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
      const errText = (await res.text()).trim();
      ts.errorInfo = {
        kind: 'server', time: new Date().toLocaleString(), url,
        httpStatus: `${res.status} ${res.statusText}`.trim(),
        message: errText || '(empty response body)',
        lines: [], errorText: errText, failures: [], problems: []
      };
      ts.errPromise = Promise.resolve(ts.errorInfo);
      setbadge(tabId, 'ERR', '#ff4444');
      setTooltip(tabId, errorTooltip(ts));
      setPopup(tabId, `error.html?tab_id=${tabId}`);
    }
  } catch (e) {
    setbadge(tabId, 'OFF', '#888888');
    setTooltip(tabId,
      `YT-DLP Downloader\n` +
      `─────────────────\n` +
      `Status:  Server offline\n` +
      `Error:   ${e && e.message ? e.message : e}\n` +
      `URL:     ${shortUrl(url)}\n` +
      `Time:    ${new Date().toLocaleTimeString()}\n` +
      `Run server.py to start the bridge\n` +
      `Expected at: 127.0.0.1:${PORT}`
    );
  }
}

const HDR = 'YT-DLP Downloader\n─────────────────\n';

// returns true if status was recognised and rendered; false for idle/unknown
function render(tabId, data) {
  const ts = getTabState(tabId);

  switch (data.status) {
    case 'downloading': {
      const pct = Math.round(data.progress);
      const pl  = data.playlist_total > 0;
      const showPlaylist = pl && Math.floor(Date.now() / 2000) % 2 === 0;
      setbadge(tabId,
        showPlaylist ? `${data.playlist_cur}/${data.playlist_total}` : (pct === 0 ? '...' : `${pct}%`),
        '#4caf50');
      setTooltip(tabId, HDR +
        `Status:    Downloading\n` +
        (pl ? `Playlist:  ${data.playlist_cur} of ${data.playlist_total}\n` : '') +
        `Progress:  ${data.progress.toFixed(1)}%\n` +
        `Speed:     ${data.speed || 'calculating...'}\n` +
        `ETA:       ${data.eta || 'calculating...'}\n` +
        `File:      ${data.filename || 'unknown'}\n` +
        `─────────────────\nClick icon to open monitor / cancel`);
      setPopup(tabId, `popup.html?tab_id=${tabId}`);
      return true;
    }
    case 'done':
      setbadge(tabId, 'OK', '#4caf50');
      setTooltip(tabId, HDR +
        `Status:   Done!\nFile:     ${data.filename || 'unknown'}\nSaved to: Desktop\n` +
        `─────────────────\nClick to download another`);
      setPopup(tabId, '');
      ts.polling = false;
      return true;
    case 'cancelled':
      setbadge(tabId, 'STOP', '#888888');
      setTooltip(tabId, HDR + `Download cancelled.\nClick to start again`);
      setPopup(tabId, '');
      ts.polling = false;
      return true;
    case 'exists':
      setbadge(tabId, 'HAS', '#ff9800');
      setTooltip(tabId, HDR +
        `Already downloaded!\nFile: ${data.filename || 'unknown'}\n` +
        `─────────────────\nFile is already on your Desktop`);
      setPopup(tabId, '');
      ts.polling = false;
      return true;
    case 'error':
      setbadge(tabId, 'ERR', '#ff4444');
      setTooltip(tabId, errorTooltip(ts));
      setPopup(tabId, `error.html?tab_id=${tabId}`);
      ts.polling = false;
      ensureErrorInfo(tabId);
      return true;
  }
  return false;
}

async function poll(tabId) {
  const ts = getTabState(tabId);
  if (!ts.polling) return;

  try {
    const res  = await fetch(`${HOST}:${PORT}/progress?tab_id=${tabId}`);
    const data = await res.json();
    ts.pollFails = 0;

    if (!ts.polling) return;               // stopped (cancel/close) while fetching: drop stale reply

    if (!render(tabId, data)) {            // idle/unknown
      ts.polling = false;
      setPopup(tabId, '');
      setbadge(tabId, '', '#888888');
      setTooltip(tabId, HDR + 'Click on a page to download media');
      return;
    }
    if (!ts.polling) return;               // terminal status rendered
  } catch (e) {
    ts.pollFails = (ts.pollFails || 0) + 1;
    setTooltip(tabId, HDR +
      `Status:  Server unreachable\n` +
      `Error:   ${e && e.message ? e.message : e}\n` +
      `Failed polls in a row: ${ts.pollFails}\n` +
      `Downloading: ${shortUrl(ts.url)}\n` +
      `Make sure server.py is running`);
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

  } catch (e) {
    setbadge(tabId, 'OFF', '#888888');
    setTooltip(tabId,
      `YT-DLP Downloader\n` +
      `─────────────────\n` +
      `Status:  Server offline\n` +
      `Error:   ${e && e.message ? e.message : e}\n` +
      `URL:     ${shortUrl(url)}\n` +
      `Time:    ${new Date().toLocaleTimeString()}\n` +
      `Run server.py to start the bridge\n` +
      `Expected at: 127.0.0.1:${PORT}`
    );
    return;
  }

  // Non-playlist — start immediately
  await startDownload(tabId, url);
});

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'GET_UPDATE_INFO') {
    return Promise.resolve(updateInfo);
  }

  if (msg.type === 'CHECK_UPDATE_NOW') {
    return checkServerUpdate().then(() => updateInfo);
  }

  if (msg.type === 'GET_ERROR_INFO') {
    const tabId = msg.tabId;
    return ensureErrorInfo(tabId).then(info => ({ version: VERSION, info, url: getTabState(tabId).url }));
  }

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

async function syncTab(tabId) {
  const ts = getTabState(tabId);
  try {
    const res  = await fetch(`${HOST}:${PORT}/progress?tab_id=${tabId}`);
    const data = await res.json();

    if (data.status === 'downloading' && !ts.polling) {
      ts.polling = true;
      poll(tabId);
    } else if (!render(tabId, data)) {     // idle: only refresh popup for playlist detection
      ts.polling = false;
      const tab = await browser.tabs.get(tabId);
      await updatePopupForTab(tabId, tab.url || '');
    }
  } catch {}
}

browser.tabs.onActivated.addListener(({ tabId }) => syncTab(tabId));

browser.tabs.onRemoved.addListener((tabId) => {
  if (tabStates[tabId]) tabStates[tabId].polling = false;
  delete tabStates[tabId];
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    const ts = getTabState(tabId);
    if (!ts.polling) {
      await updatePopupForTab(tabId, changeInfo.url);
    }
  }
});
