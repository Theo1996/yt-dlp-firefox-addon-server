from flask import Flask, request, jsonify
import subprocess, threading, re, os, time, traceback
from datetime import datetime

SERVER_VERSION = '1.1.0'   # bump on every release; the extension compares this with the copy on GitHub

app = Flask(__name__)

config = {
    'save_dir': os.path.join(os.path.expanduser('~'), 'Desktop')
}

downloads = {}
downloads_lock = threading.Lock()

def make_state():
    return {
        'status':         'idle',
        'progress':       0.0,
        'speed':          '',
        'eta':            '',
        'filename':       '',
        'error_text':     '',
        'output':         [],
        'proc':           None,
        'playlist_cur':   0,
        'playlist_total': 0,
        'url':            '',
        'cmd':            '',
        'started':        0.0,
        'returncode':     None,
        'full_log':       [],
        'log_path':       '',
        'log_dir':        '',
        'log_error':      '',
        'failures':       [],
    }

HINTS = [(re.compile(p, re.I), h) for p, h in [
    (r'private video|video is private',                  'Video is private. Needs an account with access.'),
    (r'sign in to confirm|not a bot|cookies',            'YouTube requires login / bot check. Retry later or use browser cookies in yt-dlp.'),
    (r'members-only|join this channel',                  'Members-only video. Needs login cookies.'),
    (r'age[- ]restricted|confirm your age',              'Age-restricted. Needs login cookies.'),
    (r'video unavailable|has been removed|no longer available|does not exist', 'Video removed or unavailable.'),
    (r'not available in your country|geo|blocked it in your country', 'Region-blocked.'),
    (r'premiere|live event will begin|is upcoming',      'Not released yet / live stream not started.'),
    (r'HTTP Error 403',                                  'HTTP 403: blocked by site. Update yt-dlp.'),
    (r'HTTP Error 429|too many requests',                'HTTP 429: rate limited. Wait and retry.'),
    (r'HTTP Error 404',                                  'HTTP 404: not found.'),
    (r'requested format is not available',               'No matching format. Update yt-dlp.'),
    (r'ffmpeg|ffprobe',                                  'ffmpeg/ffprobe missing or failing. Check it is installed and in PATH.'),
    (r'unsupported url',                                 'Page is not supported by yt-dlp.'),
    (r'unable to extract|nsig|signature',                'Extractor broke. Update yt-dlp.'),
    (r'timed out|timeout|getaddrinfo|connection|ssl',    'Network problem between the PC and the site.'),
    (r'permission denied|errno 13|access is denied',     'Cannot write to the save folder. Check path/permissions.'),
    (r'no space left|errno 28',                          'Disk full.'),
    (r'winerror 2|no such file or directory|cannot find the file', 'yt-dlp not found. Check it is installed and in PATH.'),
]]

SKIP_EXT = {'download', 'info', 'debug', 'Merger', 'ffmpeg', 'ExtractAudio', 'Metadata', 'FixupM3u8', 'FixupM4a'}

def hint_for(text):
    for rx, h in HINTS:
        if rx.search(text):
            return h
    return ''

def parse_failures(lines, page_url):
    out = []
    item = cur_url = cur_id = cur_ext = ''
    seg_start = 0
    item_idx = []
    for idx, raw in enumerate(lines):
        line = re.sub(r'^\[stderr\]\s*', '', str(raw)).strip()
        m = re.search(r'Downloading (?:item|video) (\d+) of (\d+)', line, re.I)
        if m:
            item = f'{m.group(1)}/{m.group(2)}'; cur_url = cur_id = cur_ext = ''
            seg_start = idx; item_idx.append(idx); continue
        m = re.match(r'^\[([\w:+-]+)\]\s+Extracting URL:\s*(\S+)', line)
        if m:
            cur_ext, cur_url = m.group(1), m.group(2); continue
        m = re.match(r'^\[([\w:+-]+)\]\s+([\w-]{6,}):\s+(?:Downloading|Downloaded|Extracting|Getting|Fetching)', line)
        if m and m.group(1) not in SKIP_EXT:
            cur_ext, cur_id = m.group(1), m.group(2); continue
        m = re.match(r'^ERROR:\s*(.*)$', line)
        if m:
            body = m.group(1)
            ext, vid, reason = cur_ext, cur_id, body
            m2 = re.match(r'^\[([^\]]+)\]\s+([^:\s]+):\s*(.*)$', body)
            if m2:
                ext, vid, reason = m2.group(1), m2.group(2), m2.group(3)
            else:
                m3 = re.match(r'^\[([^\]]+)\]\s*(.*)$', body)
                if m3:
                    ext, reason = m3.group(1), m3.group(2)
            found = re.search(r'https?://[^\s\'"]+', body)
            url = found.group(0) if found else ''
            if not url and re.match(r'youtube', ext or '', re.I) and vid:
                url = f'https://www.youtube.com/watch?v={vid}'
            if not url:
                url = cur_url or page_url or ''
            f = {'item': item, 'extractor': ext, 'id': vid, 'url': url, 'reason': reason.strip(), 'hint': hint_for(body), 'seg_start': seg_start}
            if not out or out[-1]['reason'] != f['reason'] or out[-1]['url'] != f['url']:
                out.append(f)
    for f in out:
        nxt = [x for x in item_idx if x > f['seg_start']]
        f['seg_end'] = nxt[0] if nxt else len(lines)
    return out

_ytdlp_ver = None
def ytdlp_version():
    global _ytdlp_ver
    if _ytdlp_ver is None:
        try:
            kw = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
            r = subprocess.run(['yt-dlp', '--version'], capture_output=True, text=True, timeout=10, **kw)
            _ytdlp_ver = r.stdout.strip() or 'unknown'
        except Exception as e:
            _ytdlp_ver = f'unavailable ({e})'
    return _ytdlp_ver

def _safe(name):
    return re.sub(r'[^\w.-]', '_', str(name))[:60] or 'x'

def write_error_log(tab_id, exc_text=''):
    """One log file per failed video in <save_dir>/yt-dlp-error-logs/ plus summary.log. Call without holding downloads_lock."""
    with downloads_lock:
        s = downloads[tab_id]
        url, cmd, started, rc = s['url'], s['cmd'], s['started'], s['returncode']
        full_log   = list(s['full_log'])
        error_text = s['error_text']
    src = full_log or error_text.split('\n')
    failures = parse_failures(src, url)
    if not failures:
        reason = (exc_text.strip().splitlines() or error_text.strip().splitlines() or [''])[-1]
        failures = [{'item': '', 'extractor': '', 'id': '', 'url': url, 'reason': reason,
                     'hint': hint_for(exc_text + ' ' + error_text), 'seg_start': 0, 'seg_end': len(src)}]
    now   = datetime.now()
    stamp = now.strftime('%Y%m%d-%H%M%S')
    when  = now.strftime('%Y-%m-%d %H:%M:%S')
    log_dir = os.path.join(config['save_dir'], 'yt-dlp-error-logs')
    common = [f'Tab:          {tab_id}',
              f'Requested URL: {url or "unknown"}',
              f'Command:      {cmd}',
              f'Exit code:    {rc if rc is not None else "n/a (exception before exit)"}',
              (f'Duration:     {time.time() - started:.1f}s' if started else 'Duration:     unknown'),
              f"Save dir:     {config['save_dir']}",
              f'yt-dlp:       {ytdlp_version()}']
    problems = []
    try:
        os.makedirs(log_dir, exist_ok=True)
    except Exception as e:
        problems.append(f'Could not create {log_dir}: {e}')

    for i, f in enumerate(failures, 1):
        label = f['id'] or (('item' + f['item'].split('/')[0]) if f['item'] else 'error')
        path  = os.path.join(log_dir, f'{stamp}_{i:02d}_{_safe(label)}.log')
        seg   = src[f['seg_start']:f['seg_end']]
        L = [f'[{when}] yt-dlp download FAILED  (failure {i} of {len(failures)})',
             f'Video URL:    {f["url"] or "unknown"}',
             f'Item:         {f["item"] or "n/a"}',
             f'Extractor/ID: {f["extractor"] or "?"} / {f["id"] or "?"}',
             f'Reason:       {f["reason"]}']
        if f['hint']:
            L.append(f'Hint:         {f["hint"]}')
        L += common
        if exc_text:
            L += ['', '--- Python exception ---', exc_text.rstrip()]
        L += ['', f'--- yt-dlp output for this video (log lines {f["seg_start"] + 1}-{f["seg_end"]} of {len(src)}) ---'] + seg + ['']
        try:
            with open(path, 'a', encoding='utf-8') as fh:
                fh.write('\n'.join(L))
            f['log_file'] = path
        except Exception as e:
            f['log_file'] = ''
            problems.append(f'Could not write {path}: {e}')

    summary = os.path.join(log_dir, 'summary.log')
    S = ['=' * 70, f'[{when}] yt-dlp download FAILED - {len(failures)} failed item(s)'] + common
    for i, f in enumerate(failures, 1):
        S += [f'  {i}) {f["item"] or "-"} | {f["id"] or "?"} | {f["url"] or "unknown"}',
              f'     Reason: {f["reason"]}',
              f'     Log:    {f.get("log_file") or "(not written)"}']
    S.append('')
    try:
        with open(summary, 'a', encoding='utf-8') as fh:
            fh.write('\n'.join(S) + '\n')
    except Exception as e:
        summary = ''
        problems.append(f'Could not write summary.log: {e}')

    with downloads_lock:
        d = downloads[tab_id]
        d['failures']  = [{k: v for k, v in f.items() if k not in ('seg_start', 'seg_end')} for f in failures]
        d['log_dir']   = log_dir
        d['log_path']  = summary
        d['log_error'] = '; '.join(problems)

def run_download(tab_id, cmd):
    with downloads_lock:
        s = downloads[tab_id]
        s['status']     = 'downloading'
        s['progress']   = 0.0
        s['speed']      = ''
        s['eta']        = ''
        s['filename']   = ''
        s['error_text'] = ''
        s['output']     = []
        s['full_log']   = []
        s['started']    = time.time()
        s['returncode'] = None
        s['log_path']   = ''
        s['log_dir']    = ''
        s['log_error']  = ''
        s['failures']   = []

    try:
        kwargs = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8',
            errors='replace',
            **kwargs
        )

        with downloads_lock:
            downloads[tab_id]['proc'] = proc

        stdout_lines = []
        stderr_lines = []

        def read_stdout():
            for line in proc.stdout:
                line = line.rstrip()
                stdout_lines.append(line)
                with downloads_lock:
                    downloads[tab_id]['full_log'].append(line)
                    downloads[tab_id]['output'].append(line)
                    if len(downloads[tab_id]['output']) > 200:
                        downloads[tab_id]['output'].pop(0)

                if 'has already been downloaded' in line:
                    if downloads[tab_id]['playlist_total'] == 0:
                        downloads[tab_id]['status'] = 'exists'
                    f = re.search(r'\[download\] (.+) has already been downloaded', line)
                    if f:
                        downloads[tab_id]['filename'] = os.path.basename(f.group(1).strip())

                m = re.search(r'(\d+\.?\d*)%.*?at\s+([\d\.\w/]+)\s+ETA\s+([\d:]+)', line)
                if m:
                    downloads[tab_id]['progress'] = float(m.group(1))
                    downloads[tab_id]['speed']    = m.group(2)
                    downloads[tab_id]['eta']      = m.group(3)

                f = re.search(r'\[download\] Destination: (.+)', line)
                if f:
                    downloads[tab_id]['filename'] = os.path.basename(f.group(1).strip())

                pl = re.search(r'Downloading item (\d+) of (\d+)', line)
                if pl:
                    downloads[tab_id]['playlist_cur']   = int(pl.group(1))
                    downloads[tab_id]['playlist_total'] = int(pl.group(2))

        def read_stderr():
            for line in proc.stderr:
                line = line.rstrip()
                stderr_lines.append(line)
                with downloads_lock:
                    downloads[tab_id]['full_log'].append(f'[stderr] {line}')
                    downloads[tab_id]['output'].append(f'[stderr] {line}')

        t1 = threading.Thread(target=read_stdout)
        t2 = threading.Thread(target=read_stderr)
        t1.start(); t2.start()
        t1.join();  t2.join()
        proc.wait()

        failed = False
        with downloads_lock:
            downloads[tab_id]['proc'] = None
            downloads[tab_id]['returncode'] = proc.returncode
            if downloads[tab_id]['status'] == 'exists':
                pass
            elif downloads[tab_id]['status'] == 'cancelled':
                pass
            elif proc.returncode == 0:
                downloads[tab_id]['status'] = 'done'
            else:
                error_text = '\n'.join(stderr_lines) or '\n'.join(stdout_lines)
                downloads[tab_id]['status']     = 'error'
                downloads[tab_id]['error_text'] = error_text
                failed = True
        if failed:
            write_error_log(tab_id)

    except Exception as e:
        exc_text = traceback.format_exc()
        with downloads_lock:
            downloads[tab_id]['status']     = 'error'
            downloads[tab_id]['error_text'] = f'{type(e).__name__}: {e}'
            downloads[tab_id]['proc']       = None
        write_error_log(tab_id, exc_text)

@app.route('/download')
def download():
    url    = request.args.get('url', '')
    tab_id = request.args.get('tab_id', 'default')
    if not url:
        return 'Invalid URL', 400
    with downloads_lock:
        if tab_id in downloads and downloads[tab_id]['status'] == 'downloading':
            return 'Already downloading', 429
        downloads[tab_id] = make_state()
        downloads[tab_id]['url'] = url
    out_tmpl = os.path.join(config['save_dir'], '%(title)s.%(ext)s')
    cmd = ['yt-dlp', '-o', out_tmpl, '--no-colors', url]
    with downloads_lock:
        downloads[tab_id]['cmd'] = subprocess.list2cmdline(cmd)
    threading.Thread(target=run_download, args=(tab_id, cmd), daemon=True).start()
    return 'Download started!'

@app.route('/cancel')
def cancel():
    tab_id = request.args.get('tab_id', 'default')
    with downloads_lock:
        s = downloads.get(tab_id)
        if s and s['proc']:
            try:
                if os.name == 'nt':
                    subprocess.run(
                        ['taskkill', '/F', '/T', '/PID', str(s['proc'].pid)],
                        creationflags=subprocess.CREATE_NO_WINDOW
                    )
                else:
                    s['proc'].kill()
            except Exception:
                pass
            s['status'] = 'cancelled'
            s['proc']   = None
            return 'Cancelled'
    return 'Nothing to cancel', 400

@app.route('/setdir', methods=['POST'])
def setdir():
    data = request.get_json()
    path = data.get('path', '').strip()
    if not path:
        return 'No path provided', 400
    if not os.path.isdir(path):
        try:
            os.makedirs(path, exist_ok=True)
        except Exception as e:
            return f'Invalid path: {e}', 400
    config['save_dir'] = path
    return 'OK'

@app.route('/version')
def version():
    return jsonify({'version': SERVER_VERSION})

@app.route('/getdir')
def getdir():
    return jsonify({'path': config['save_dir']})

@app.route('/progress')
def progress():
    tab_id = request.args.get('tab_id', 'default')
    with downloads_lock:
        s = downloads.get(tab_id, make_state())
    return jsonify({
        'status':         s['status'],
        'progress':       s['progress'],
        'speed':          s['speed'],
        'eta':            s['eta'],
        'filename':       s['filename'],
        'playlist_cur':   s['playlist_cur'],
        'playlist_total': s['playlist_total'],
    })

@app.route('/output')
def output():
    tab_id = request.args.get('tab_id', 'default')
    since  = int(request.args.get('since', 0))
    with downloads_lock:
        s     = downloads.get(tab_id, make_state())
        lines = s['output'][since:]
        total = len(s['output'])
    return jsonify({'lines': lines, 'total': total, 'status': s['status']})

@app.route('/error')
def error():
    tab_id = request.args.get('tab_id', 'default')
    with downloads_lock:
        s = downloads.get(tab_id, make_state())
    return jsonify({
        'error_text': s['error_text'],
        'log_path':   s['log_path'],
        'log_dir':    s['log_dir'],
        'failures':   s['failures'],
        'log_error':  s['log_error'],
        'returncode': s['returncode'],
        'cmd':        s['cmd'],
        'url':        s['url'],
    })

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=9876)
