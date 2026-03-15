import subprocess

p = subprocess.Popen(
    ['K:\\python\\Python38\\python.exe', 'C:\\Users\\f\\Documents\\server\\server.py'],
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
