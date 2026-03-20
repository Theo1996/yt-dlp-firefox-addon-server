<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 340px;
      background: #0f0f0f;
      color: #d4d4d4;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 12px;
      padding: 16px;
    }
    h3 {
      color: #4caf50;
      font-size: 13px;
      margin-bottom: 6px;
    }
    .subtitle {
      color: #555;
      font-size: 11px;
      margin-bottom: 16px;
      line-height: 1.5;
    }
    .url-box {
      background: #1a1a1a;
      border: 1px solid #222;
      border-radius: 4px;
      padding: 8px 10px;
      font-size: 10px;
      color: #666;
      word-break: break-all;
      margin-bottom: 16px;
      line-height: 1.5;
    }
    .btn {
      width: 100%;
      padding: 10px 14px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 12px;
      font-family: inherit;
      text-align: left;
      margin-bottom: 8px;
      border: 1px solid transparent;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .btn-title { font-weight: bold; }
    .btn-sub   { font-size: 10px; opacity: 0.7; }
    #btn-video {
      background: #1a3a1a;
      color: #4caf50;
      border-color: #4caf5033;
    }
    #btn-video:hover { background: #1f4a1f; border-color: #4caf5066; }
    #btn-playlist {
      background: #1a1a2a;
      color: #569cd6;
      border-color: #569cd633;
    }
    #btn-playlist:hover { background: #1f1f3a; border-color: #569cd666; }
    #btn-video:disabled, #btn-playlist:disabled {
      opacity: 0.4; cursor: default;
    }
    #status {
      font-size: 11px;
      color: #555;
      min-height: 16px;
      margin-top: 4px;
      text-align: center;
    }
  </style>
</head>
<body>
  <h3>⬇ Playlist detected</h3>
  <p class="subtitle">This URL is part of a playlist. What would you like to download?</p>
  <div class="url-box" id="url-display"></div>

  <button class="btn" id="btn-video">
    <span class="btn-title">▶ This video only</span>
    <span class="btn-sub">Downloads just the current video</span>
  </button>

  <button class="btn" id="btn-playlist">
    <span class="btn-title">≡ Entire playlist</span>
    <span class="btn-sub">Downloads all videos in the playlist</span>
  </button>

  <div id="status"></div>
  <script src="choice.js"></script>
</body>
</html>