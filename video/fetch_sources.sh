#!/usr/bin/env bash
# Downloads the third-party news and protest clips the edit uses into src/ (not committed: ~800 MB).
set -euo pipefail
cd "$(dirname "$0")"; mkdir -p src
for id in P5v2cjU0FJ4 bojGVg3t0zg 9H3swo8JtBs sRAuhLh6AhU 42Z7KI3cbhQ; do
  [ -f "src/$id.mp4" ] || yt-dlp -f 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]' --merge-output-format mp4 -o "src/$id.mp4" "https://www.youtube.com/watch?v=$id"
done
