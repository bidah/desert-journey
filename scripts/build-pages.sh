#!/usr/bin/env bash
# Builds the Cloudflare Pages site into out/: a static export of the app. The
# droid intro video is over Pages' 25 MiB asset limit, so it is served from R2:
#   npx wrangler r2 object put personal/desert-journey/intro.mp4 \
#     --file public/droid/intro.mp4 --content-type video/mp4 --remote
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf out
PAGES_EXPORT=1 \
  NEXT_PUBLIC_INTRO_VIDEO_URL=https://pub-a0a1cbf0ebbb4f43ae376851b6c8e8fe.r2.dev/desert-journey/intro.mp4 \
  npx next build
rm out/droid/intro.mp4

if find out -type f -size +"$((25 * 1024 * 1024))c" | grep -q .; then
  echo "Files still over 25 MiB:" >&2
  find out -type f -size +"$((25 * 1024 * 1024))c" >&2
  exit 1
fi
