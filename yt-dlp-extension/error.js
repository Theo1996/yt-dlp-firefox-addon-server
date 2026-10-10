const PORT = 9876;
const HOST = 'http://127.0.0.1';

const params = new URLSearchParams(window.location.search);
const tabId  = parseInt(params.get('tab_id')) || 0;

const $ = id => document.getElementById(id);
let info = null, version = '', report = '', showFull = false;

function openLink(a, url) {
  a.textContent = url;
  a.addEventListener('click', e => {
    e.preventDefault();
    if (/^https?:\/\//i.test(url)) browser.tabs.create({ url });
  });
}

function mk(tag, cls, text) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (text !== undefined) d.textContent = text;
  return d;
}

function failLines(info) {
  const src = info.lines && info.lines.length ? info.lines : (info.errorText || '').split('\n');
  return src.map(l => String(l)).filter(l => l.trim());
}

function renderBox() {
  const lines = info ? failLines(info) : [];
  const important = lines.filter(l => /error|warning|unable|failed/i.test(l));
  const shown = showFull ? lines.slice(-300) : (important.length ? important : lines.slice(-15));
  $('error-box').textContent = shown.length ? shown.join('\n') : 'No yt-dlp output captured.';
  $('toggle').textContent = showFull ? 'show errors only' : 'show full';
}

function buildReport() {
  const L = [];
  L.push('YT Downloader error report');
  L.push(`Extension: v${version}`);
  L.push(`Time: ${info.time || new Date().toLocaleString()}`);
  L.push(`Browser: ${navigator.userAgent}`);
  L.push(`Requested URL: ${info.url || 'unknown'}`);
  L.push(`Bridge: ${HOST}:${PORT}`);
  if (info.command)  L.push(`Command: ${info.command}`);
  if (info.exitCode !== undefined && info.exitCode !== null) L.push(`Exit code: ${info.exitCode}`);
  if (info.logDir)   L.push(`Server logs folder: ${info.logDir}`);
  if (info.kind === 'server') {
    L.push(`Server response: HTTP ${info.httpStatus}`);
    L.push(`Server message: ${info.message}`);
  }
  (info.problems || []).forEach(p => L.push(`Extension problem: ${p}`));
  L.push('');
  L.push(`Failed items: ${info.failures.length}`);
  info.failures.forEach((f, i) => {
    L.push(`${i + 1}) ${[f.item && 'item ' + f.item, f.extractor, f.id].filter(Boolean).join(' | ') || 'unknown item'}`);
    L.push(`   URL:    ${f.url || 'unknown'}`);
    L.push(`   Reason: ${f.reason}`);
    if (f.logFile) L.push(`   Log:    ${f.logFile}`);
    if (f.hint) L.push(`   Hint:   ${f.hint}`);
  });
  const lines = failLines(info);
  L.push('');
  L.push(`--- yt-dlp output (last ${Math.min(lines.length, 300)} of ${lines.length} lines) ---`);
  L.push(...lines.slice(-300));
  return L.join('\n') + '\n';
}

function render() {
  $('url').textContent = '';
  const a = mk('a');
  openLink(a, info.url || 'unknown');
  $('url').append(a, mk('div', '', `${info.time || ''}${version ? '  ·  v' + version : ''}`));

  const box = $('failures');
  box.textContent = '';
  if (info.kind === 'server') {
    const d = mk('div', 'fail');
    d.append(mk('div', 'meta', 'Bridge server rejected the request'));
    d.append(mk('div', 'why', `HTTP ${info.httpStatus}: ${info.message}`));
    box.append(d);
  }
  info.failures.forEach((f, i) => {
    const d = mk('div', 'fail');
    d.append(mk('div', 'meta', `#${i + 1}  ${[f.item && 'item ' + f.item, f.extractor, f.id].filter(Boolean).join('  ·  ')}`));
    if (f.url) { const l = mk('a'); openLink(l, f.url); d.append(l); }
    d.append(mk('div', 'why', f.reason));
    if (f.logFile) d.append(mk('div', 'meta', 'Log: ' + f.logFile));
    if (f.hint) d.append(mk('div', 'hint', 'Hint: ' + f.hint));
    box.append(d);
  });
  if (!box.children.length) box.append(mk('div', 'fail', 'No failure details captured.'));

  (info.problems || []).forEach(p => box.append(mk('div', 'fail', 'Extension problem: ' + p)));
  renderBox();
  $('logpath').textContent = info.logDir || 'not written (see problems above)';
  report = buildReport();
}

async function load() {
  try {
    const resp = await browser.runtime.sendMessage({ type: 'GET_ERROR_INFO', tabId });
    info = resp && resp.info;
    version = (resp && resp.version) || '';
  } catch (e) {
    info = null;
    $('url').textContent = 'Could not get error info from background: ' + e.message;
  }
  if (!info) {
    info = { kind: 'ytdlp', time: new Date().toLocaleString(), url: '', lines: [], errorText: '', failures: [], problems: ['No error info available'] };
    try {
      const r = await fetch(`${HOST}:${PORT}/error?tab_id=${tabId}`);
      info.errorText = (await r.json()).error_text || '';
    } catch (e) { info.problems.push('Bridge unreachable: ' + e.message); }
  }
  render();
}

$('toggle').addEventListener('click', () => { showFull = !showFull; renderBox(); });

$('copy').addEventListener('click', async () => {
  const btn = $('copy');
  try { await navigator.clipboard.writeText(report); }
  catch {
    const t = document.createElement('textarea');
    t.value = report; document.body.append(t); t.select();
    document.execCommand('copy'); t.remove();
  }
  btn.textContent = 'Copied ✓';
  setTimeout(() => { btn.textContent = 'Copy report'; }, 1500);
});

$('save').addEventListener('click', () => {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const name = `yt-dlp-error-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.txt`;
  const url = URL.createObjectURL(new Blob([report], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  $('save').textContent = 'Saved to Downloads ✓';
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});

$('dismiss').addEventListener('click', () => {
  browser.runtime.sendMessage({ type: 'DISMISS_ERROR', tabId });
  window.close();
});

load();
