#!/usr/bin/env bash
# Swap the closing plate. Usage: scripts/set-endcard.sh <path-to-image>
#
# Nearest-neighbour on purpose: the art is pixel art, and a smooth resample of
# pixel art is just a blur of pixel art.
set -euo pipefail
SRC="${1:?usage: set-endcard.sh <image>}"
ffmpeg -y -v error -i "$SRC" -vf "scale=1600:-2:flags=neighbor" -q:v 3 public/film/endcard.jpg
ffmpeg -y -v error -i "$SRC" -vf "scale=1600:-2:flags=neighbor" -c:v libwebp -quality 90 public/film/endcard.webp
ls -la public/film/endcard.* | awk '{printf "%-30s %6.0fKB\n", $9, $5/1024}'
