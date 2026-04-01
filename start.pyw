import subprocess, os, sys, winreg, ctypes

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
                version = (result.stdout or result.stderr).strip()
                parts = version.replace('Python ', '').split('.')
                major, minor = int(parts[0]), int(parts[1])
                if (major, minor) >= (3, 8):
                    return name
        except Exception:
            pass

    # 2. Registry
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
                            exe = os.path.join(path.strip(), 'python.exe')
                            if os.path.exists(exe):
                                candidates.append(((major, minor), exe))
                        i += 1
                    except OSError:
                        break
            except OSError:
                pass
    if candidates:
        candidates.sort(reverse=True)
        return candidates[0][1]

    # 3. Common locations
    common = [
        rf'C:\Python3{minor}\python.exe' for minor in range(13, 7, -1)
    ] + [
        rf'C:\Program Files\Python3{minor}\python.exe' for minor in range(13, 7, -1)
    ] + [
        os.path.expanduser(rf'~\AppData\Local\Programs\Python\Python3{minor}\python.exe')
        for minor in range(13, 7, -1)
    ]
    for path in common:
        if os.path.exists(path):
            return path
    return None

# === Kill old server on port 9876 ===
try:
    result = subprocess.run(['netstat', '-ano'], capture_output=True, text=True,
                            creationflags=subprocess.CREATE_NO_WINDOW)
    for line in result.stdout.splitlines():
        if ':9876' in line and 'LISTENING' in line:
            pid = line.strip().split()[-1]
            subprocess.run(['taskkill', '/F', '/PID', pid],
                           creationflags=subprocess.CREATE_NO_WINDOW)
except Exception:
    pass

# === Find Python ===
python = find_python()
if not python:
    ctypes.windll.user32.MessageBoxW(
        0, 'Could not find Python 3.8 or newer.\nPlease install from python.org',
        'YT-DLP Server', 0x10)
    sys.exit(1)

# === Locate server.py (same folder as this launcher) ===
launcher_dir = os.path.dirname(os.path.abspath(__file__))
server_py = os.path.join(launcher_dir, 'server.py')

if not os.path.exists(server_py):
    ctypes.windll.user32.MessageBoxW(
        0, f'Could not find server.py\nExpected here:\n{server_py}',
        'YT-DLP Server - Error', 0x10)
    sys.exit(1)

# === Launch server (still hidden) ===
try:
    subprocess.Popen(
        [python, server_py],
        creationflags=subprocess.CREATE_NO_WINDOW,
        # Optional: you can capture output if you want to debug later
        # stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
except Exception as e:
    ctypes.windll.user32.MessageBoxW(
        0, f'Failed to start server:\n{str(e)}', 'YT-DLP Server - Error', 0x10)
    sys.exit(1)

# Optional: small success message so you know it worked
# ctypes.windll.user32.MessageBoxW(0, 'YT-DLP Server started successfully!', 'YT-DLP Server', 0x40)