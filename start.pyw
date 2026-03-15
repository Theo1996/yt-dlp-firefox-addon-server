import subprocess, sys, os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
subprocess.Popen(
    [sys.executable, 'server.py'],
    creationflags=subprocess.CREATE_NO_WINDOW
)
#```

#---

## How the error flow works
#```
#yt-dlp fails
#     │
#     ├─► server writes yt-dlp-error.log to Desktop
#     ├─► state.error_text saved in memory
#     ├─► badge → ERR (red, stays forever)
#     └─► popup set to error.html
#
#User clicks ERR badge
#     │
#     └─► error.html opens → fetches /error → shows filtered yt-dlp output
#              │
#         [Dismiss] clicked
#              │
#              ├─► badge cleared
#              └─► popup unset (next click starts a new download)