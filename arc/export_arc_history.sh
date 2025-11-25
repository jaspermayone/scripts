#!/bin/bash

# Set the database path for Arc browser history
ARC_DB_PATH="$HOME/Library/Application Support/Arc/User Data/Default/History"

# Set output file path - using current date in filename
OUTPUT_FILE="arc_history_$(date +%Y%m%d).txt"

# Check if the database file exists
if [ ! -f "$ARC_DB_PATH" ]; then
    echo "Error: Arc browser history database not found at $ARC_DB_PATH"
    exit 1
fi

# Create a temporary copy of the database since it might be locked
TMP_DB="/tmp/arc_history_temp.db"
cp "$ARC_DB_PATH" "$TMP_DB"

# Query the history database and write to output file
echo "Exporting Arc browser history to $OUTPUT_FILE..."
sqlite3 "$TMP_DB" <<EOF > "$OUTPUT_FILE"
SELECT 
    datetime(last_visit_time/1000000-11644473600, 'unixepoch', 'localtime') as visit_time,
    url,
    title
FROM urls
ORDER BY last_visit_time DESC;
EOF

# Check if the export was successful
if [ $? -eq 0 ]; then
    echo "Export completed successfully!"
    echo "History saved to: $OUTPUT_FILE"
else
    echo "Error occurred during export"
    rm "$TMP_DB"
    exit 1
fi

# Clean up temporary database
rm "$TMP_DB"
