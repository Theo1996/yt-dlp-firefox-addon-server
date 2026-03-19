# yt-dlp-firefox-addon-server
server files and extension files for the FF addon to connect to and download videos with yt-dlp with one click from inside the browser

**Prerequisites:**

-installed yt-dlp, and added to the PATH Envirnoment variable in windows

https://github.com/yt-dlp/yt-dlp


-python3.8 with pip and flask

`pip install Flask`

**Set up:**

1 Put this wherever you like

2 Create a basic task with task scheduler to start server.pyw on startup.

3. download this addon : https://addons.mozilla.org/en-US/firefox/addon/yt-dlp-dl/

5. start.pyw should detect your python location automatically

Or just make it start automatically however you want.

   
**Extra**
The .zip is the "yt-dlp extension" folder,that can be renamed to `.xpi` and installed with  `user_pref("xpinstall.signatures.required", = 	false);` in `about:config`
