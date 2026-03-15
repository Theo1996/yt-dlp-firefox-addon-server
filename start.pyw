import subprocess, os

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

# Start the server
subprocess.Popen(
    [r'K:\python\Python38\python.exe', r'C:\Users\f\Documents\server\server.py'],
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