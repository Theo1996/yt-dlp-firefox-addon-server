import subprocess, os, sys, winreg

def find_python():
    # 1. Check PATH first
    for name in ('python', 'python3'):
        try:
            result = subprocess.run(
                [name, '--version'],
                capture_output=True, text=True,
                creationflags=subprocess.CREATE_NO_WINDOW
            )
            if result.returncode == 0:
                version = result.stdout.strip() or result.stderr.strip()
                # Extract major.minor
                parts = version.replace('Python ', '').split('.')
                major, minor = int(parts[0]), int(parts[1])
                if (major, minor) >= (3, 8):
                    return name
        except Exception:
            pass

    # 2. Check Windows Registry for installed Python versions
    candidates = []
    for root in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        for base in (r'SOFTWARE\Python\PythonCore', r'SOFTWARE\WOW6432Node\Python\PythonCore'):
            try:
                key = winreg.OpenKey(root, base)
                i = 0
                while True:
                    try:
                        ver_name = winreg.EnumKey(key, i)
                        parts = ver_name.split('.')
                        major, minor = int(parts[0]), int(parts[1])
                        if (major, minor) >= (3, 8):
                            install_key = winreg.OpenKey(key, ver_name + r'\InstallPath')
                            path = winreg.QueryValue(install_key, '')
                            exe  = os.path.join(path.strip(), 'python.exe')
                            if os.path.exists(exe):
                                candidates.append(((major, minor), exe))
                        i += 1
                    except OSError:
                        break
            except OSError:
                pass

    if candidates:
        # Pick the newest version
        candidates.sort(reverse=True)
        return candidates[0][1]

    # 3. Common install locations as fallback
    common = [
        r'C:\Python3{}\python.exe'.format(minor) for minor in range(13, 7, -1)
    ] + [
        r'C:\Program Files\Python3{}\python.exe'.format(minor) for minor in range(13, 7, -1)
    ] + [
        os.path.expanduser(r'~\AppData\Local\Programs\Python\Python3{}\python.exe'.format(minor))
        for minor in range(13, 7, -1)
    ]
    for path in common:
        if os.path.exists(path):
            return path

    return None

# Kill anything already running on port 9876
try:
    result = subprocess.run(
        ['netstat', '-ano'],
        capture_output=True, text=True,
        creationflags=subprocess.CREATE_NO_WINDOW
    )
    for line in result.stdout.splitlines():
        if ':9876' in line and 'LISTENING' in line:
            pid = line.strip().split()[-1]
            subprocess.run(
                ['taskkill', '/F', '/PID', pid],
                creationflags=subprocess.CREATE_NO_WINDOW
            )
except Exception:
    pass

# Find Python
python = find_python()

if not python:
    import ctypes
    ctypes.windll.user32.MessageBoxW(
        0,
        'Could not find Python 3.8 or newer.\nPlease install Python from python.org and try again.',
        'YT-DLP Server',
        0x10  # MB_ICONERROR
    )
    sys.exit(1)

# Start the server
server_py = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'server.py')

subprocess.Popen(
    [python, server_py],
    creationflags=subprocess.CREATE_NO_WINDOW
)
#```

#---

## How the error flow works
#```
#yt-dlp fails
#     
#      server writes yt-dlp-error.log to Desktop
#      state.error_text saved in memory
#      badge -> ERR (red, stays forever)
#      popup set to error.html
#
#User clicks ERR badge
#     
#     error.html opens -> fetches /error -> shows filtered yt-dlp output
#              
#         [Dismiss] clicked
#              
#               badge cleared
#               popup unset (next click starts a new download)