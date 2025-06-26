find . -maxdepth 1 -type f \( -iname "*.arw" \) | while read -r f; do
  out="pngs/$(basename "${f%.*}").png"
  if [ -f "$out" ]; then
    echo "Skipping $(basename "$f") (already converted)"
    continue
  fi
  echo "Converting $(basename "$f")..."
  if magick "$f" "$out"; then
    echo "Successfully converted $(basename "$f")"
  else
    echo "Failed to convert $(basename "$f")"
  fi
done
