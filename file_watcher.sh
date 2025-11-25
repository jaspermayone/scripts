#!/bin/bash

# File watcher and renamer
# This script watches a folder and automatically renames new files to an 8-digit UUID format

# Check if folder path is provided
if [ $# -ne 1 ]; then
    echo "Usage: $0 <folder_path>"
    exit 1
fi

WATCH_DIR="$1"

# Check if the directory exists
if [ ! -d "$WATCH_DIR" ]; then
    echo "Error: Directory '$WATCH_DIR' does not exist."
    exit 1
fi

# Function to generate an 8-digit UUID
generate_uuid() {
    # Generate a random 8-digit hexadecimal string
    uuid=$(openssl rand -hex 4)
    echo "${uuid:0:8}"
}

# Function to check if filename already matches our pattern (8 hexadecimal digits + extension)
is_compliant() {
    local filename=$(basename "$1")
    local name_without_ext="${filename%.*}"

    # Check if the name (without extension) is exactly 8 characters and only contains hexadecimal digits
    if [[ $name_without_ext =~ ^[0-9a-f]{8}$ ]]; then
        return 0  # Compliant
    else
        return 1  # Not compliant
    fi
}

# Function to rename a file with an 8-digit UUID
rename_file() {
    local filepath="$1"
    local dir=$(dirname "$filepath")
    local filename=$(basename "$filepath")
    local extension="${filename##*.}"

    # If file has no extension, don't add a dot
    if [ "$extension" = "$filename" ]; then
        extension=""
    else
        extension=".$extension"
    fi

    # Generate a new UUID
    local new_uuid=$(generate_uuid)
    local new_name="${new_uuid}${extension}"
    local new_path="${dir}/${new_name}"

    # Check if new filename already exists, if so, generate a new one
    while [ -e "$new_path" ]; do
        new_uuid=$(generate_uuid)
        new_name="${new_uuid}${extension}"
        new_path="${dir}/${new_name}"
    done

    # Rename the file
    mv "$filepath" "$new_path"
    echo "Renamed: $filename -> $new_name"
}

# Process existing files first
echo "Checking existing files in $WATCH_DIR..."
find "$WATCH_DIR" -type f -not -path "*/\.*" | while read file; do
    if ! is_compliant "$file"; then
        rename_file "$file"
    fi
done

# Start monitoring the directory for changes
echo "Watching $WATCH_DIR for new files..."
fswatch -0 "$WATCH_DIR" | while read -d "" event; do
    # Skip hidden files and directories
    if [[ $(basename "$event") == .* ]]; then
        continue
    fi

    # Only process files, not directories
    if [ -f "$event" ]; then
        # If the file is not compliant, rename it
        if ! is_compliant "$event"; then
            rename_file "$event"
        fi
    fi
done