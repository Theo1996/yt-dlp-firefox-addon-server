from flask import Flask, request, jsonify
import subprocess, threading, re, os

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
    }

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
                    downloads[tab_id]['output'].append(f'[stderr] {line}')

        t1 = threading.Thread(target=read_stdout)
        t2 = threading.Thread(target=read_stderr)
        t1.start(); t2.start()
        t1.join();  t2.join()
        proc.wait()

        with downloads_lock:
            downloads[tab_id]['proc'] = None
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
                with open(os.path.join(config['save_dir'], f'yt-dlp-error-{tab_id}.log'), 'w', encoding='utf-8') as f:
                    f.write(error_text)

    except Exception as e:
        with downloads_lock:
            downloads[tab_id]['status']     = 'error'
            downloads[tab_id]['error_text'] = str(e)
            downloads[tab_id]['proc']       = None
        with open(os.path.join(config['save_dir'], f'yt-dlp-error-{tab_id}.log'), 'w', encoding='utf-8') as f:
            f.write(str(e))

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
    out_tmpl = os.path.join(config['save_dir'], '%(title)s.%(ext)s')
    cmd = ['yt-dlp', '-o', out_tmpl, '--no-colors', url]
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
    return jsonify({'error_text': s['error_text']})

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=9876)