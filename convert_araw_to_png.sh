#!/bin/zsh

CORES=$(sysctl -n hw.ncpu)
find . -maxdepth 1 -type f \( -iname "*.arw" \) | \
  while read -r f; do
    out="pngs/$(basename "${f%.*}").png"
    [ -f "$out" ] && continue
    echo "$f"
  done | xargs -I{} -P "$CORES" sh -c '
    fname=$(basename "{}")
    out="pngs/${fname%.*}.png"
    echo "Converting $fname..."
    if magick "{}" "$out"; then
      echo "Successfully converted $fname"
    else
      echo "Failed to convert $fname"
    fi
  '

osascript -e 'display notification "ARW to PNG conversion complete!" with title "Batch Conversion"'
