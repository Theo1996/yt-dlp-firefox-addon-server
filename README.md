# yt-dlp-firefox-addon-server
server files and extension files for the FF addon to connect to and download videos with yt-dlp with one click from inside the browser
**Prerequisites:**

-installed yt-dlp, and added to the PATH Envirnoment variable in windows

https://github.com/yt-dlp/yt-dlp

-python3.8 with flask

**Set up:**

1 Put this wherever you like

2 Create a basic task with task scheduler to start server.pyw on startup.

3. download this addon : [toadd]
4. in server.pyw change the directories to where YOUR "python.exe" is located
      # Start the server
      subprocess.Popen(
          [r'K:\python\Python38\python.exe', r'C:\Users\f\Documents\server\server.py'],
          creationflags=subprocess.CREATE_NO_WINDOW
      )
**Extra**
The .zip is the "yt-dlp extension" folder
