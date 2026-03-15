from flask import Flask, request, jsonify
import subprocess, threading, re, os

app = Flask(__name__)

DESKTOP = os.path.join(os.path.expanduser('~'), 'Desktop')

state = {
    'status':     'idle',
    'progress':   0.0,
    'error_text': ''
}

def run_download(cmd):
    state['status']     = 'downloading'
    state['progress']   = 0.0
    state['error_text'] = ''

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

        stdout_lines = []
        stderr_lines = []

        def read_stdout():
            for line in proc.stdout:
                stdout_lines.append(line)
                m = re.search(r'(\d+\.?\d*)%', line)
                if m:
                    state['progress'] = float(m.group(1))

        def read_stderr():
            for line in proc.stderr:
                stderr_lines.append(line)

        t1 = threading.Thread(target=read_stdout)
        t2 = threading.Thread(target=read_stderr)
        t1.start(); t2.start()
        t1.join();  t2.join()
        proc.wait()

        if proc.returncode == 0:
            state['status'] = 'done'
        else:
            error_text          = ''.join(stderr_lines) or ''.join(stdout_lines)
            state['status']     = 'error'
            state['error_text'] = error_text
            with open(os.path.join(DESKTOP, 'yt-dlp-error.log'), 'w', encoding='utf-8') as f:
                f.write(error_text)

    except Exception as e:
        state['status']     = 'error'
        state['error_text'] = str(e)
        with open(os.path.join(DESKTOP, 'yt-dlp-error.log'), 'w', encoding='utf-8') as f:
            f.write(str(e))

@app.route('/download')
def download():
    if state['status'] == 'downloading':
        return 'Already downloading', 429

    url   = request.args.get('url', '')
    audio = request.args.get('audio', 'false').lower() == 'true'

    if not url or 'youtube.com' not in url:
        return 'Invalid URL', 400

    out_tmpl = os.path.join(DESKTOP, '%(title)s.%(ext)s')
    cmd = ['yt-dlp', '-o', out_tmpl, '--no-colors']

    if audio:
        cmd += ['-x', '--audio-format', 'mp3']
    else:
        cmd += ['-f', 'bestvideo+bestaudio', '--merge-output-format', 'mp4']

    cmd.append(url)

    threading.Thread(target=run_download, args=(cmd,), daemon=True).start()
    return 'Download started!'

@app.route('/progress')
def progress():
    return jsonify({'status': state['status'], 'progress': state['progress']})

@app.route('/error')
def error():
    return jsonify({'error_text': state['error_text']})

if __name__ == '__main__':
    app.run(host='127.0.0.1', port=9876)