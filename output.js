const PORT   = 9876;
const HOST   = 'http://127.0.0.1';
const params = new URLSearchParams(window.location.search);
const tabId  = params.get('tab_id') || 'default';

const log    = document.getElementById('log');
const pill   = document.getElementById('status-pill');
const footer = document.getElementById('footer');

let since     = 0;
let autoScroll = true;

log.addEventListener('scroll', () => {
  autoScroll = log.scrollTop + log.clientHeight >= log.scrollHeight - 10;
});

function classForLine(line) {
  if (line.startsWith('[stderr]'))    return 'stderr';
  if (/\d+\.?\d*%/.test(line))       return 'progress';
  if (line.startsWith('[download]'))  return 'progress';
  return 'info';
}

function appendLines(lines) {
  lines.forEach(line => {
    const div = document.createElement('div');
    div.className = `line ${classForLine(line)}`;
    div.textContent = line;
    log.appendChild(div);
  });
  if (autoScroll) log.scrollTop = log.scrollHeight;
}

function setPill(status) {
  pill.textContent = status;
  pill.className   = status;
}

async function fetchOutput() {
  try {
    const res  = await fetch(`${HOST}:${PORT}/output?tab_id=${tabId}&since=${since}`);
    const data = await res.json();

    if (data.lines.length > 0) {
      appendLines(data.lines);
      since = data.total;
    }

    setPill(data.status);

    if (['done', 'error', 'cancelled', 'exists'].includes(data.status)) {
      footer.textContent = data.status === 'done'
        ? '✓ Download complete'
        : data.status === 'cancelled'
          ? '⊘ Cancelled'
          : data.status === 'exists'
            ? '⊘ Already downloaded'
            : '✗ Error occurred — check the ERR badge';
      return; // stop polling
    }

  } catch {
    setPill('offline');
  }

  setTimeout(fetchOutput, 500);
}

fetchOutput();