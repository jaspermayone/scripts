#!/bin/zsh

# Set paths
NEW_MAC_DB="$HOME/Library/Application Support/Arc/User Data/Default/History"
BACKUP_DIR="$HOME/arc_history_backup_$(date +%Y%m%d_%H%M%S)"
REMOTE_HOST="jasper@10.10.11.127"
TEMP_DIR="/tmp/arc_history_merge_$(date +%Y%m%d_%H%M%S)"
TEMP_NEW_DB="$TEMP_DIR/new_history"
TEMP_OLD_DB="$TEMP_DIR/old_history"

# Create directories
mkdir -p "$BACKUP_DIR"
mkdir -p "$TEMP_DIR"

# Create backup of current history
echo "Creating backup of current Arc history..."
cp "$NEW_MAC_DB" "$BACKUP_DIR/History.backup"
if [ $? -ne 0 ]; then
    echo "Failed to create backup. Aborting."
    exit 1
fi

# Copy the remote history database
echo "Copying history from old Mac (Albus)..."
scp "$REMOTE_HOST:~/Library/Application Support/Arc/User\ Data/Default/History" "$TEMP_OLD_DB"
if [ $? -ne 0 ]; then
    echo "Failed to copy remote history. Aborting."
    rm -rf "$TEMP_DIR"
    exit 1
fi

echo "Please completely quit Arc browser (Cmd+Q) and press Enter to continue..."
read

# Copy current database to temp location
cp "$NEW_MAC_DB" "$TEMP_NEW_DB"

# Function to wait for database to be unlocked
wait_for_db() {
    local db=$1
    local attempts=0
    local max_attempts=5
    
    while [ $attempts -lt $max_attempts ]; do
        if sqlite3 "$db" "SELECT 1;" >/dev/null 2>&1; then
            return 0
        fi
        echo "Database locked, waiting..."
        sleep 2
        attempts=$((attempts + 1))
    done
    return 1
}

# Merge the databases using temporary copies
echo "Merging histories..."
if ! wait_for_db "$TEMP_NEW_DB"; then
    echo "Database remained locked. Aborting."
    rm -rf "$TEMP_DIR"
    exit 1
fi

sqlite3 "$TEMP_NEW_DB" <<EOF
ATTACH '$TEMP_OLD_DB' AS old_db;

-- Begin transaction
BEGIN TRANSACTION;

-- Create temporary table for merged URLs
CREATE TEMPORARY TABLE merged_urls AS
SELECT * FROM urls
UNION ALL
SELECT * FROM old_db.urls;

-- Update the urls table with combined visit counts and latest timestamps
INSERT OR REPLACE INTO urls (url, title, visit_count, typed_count, last_visit_time, hidden)
SELECT 
    url,
    MAX(title),
    SUM(visit_count),
    SUM(typed_count),
    MAX(last_visit_time),
    MAX(hidden)
FROM merged_urls
GROUP BY url;

-- For visits, insert all records except exact duplicates
INSERT INTO visits (url, visit_time, from_visit, transition, segment_id, visit_duration, incremented_omnibox_typed_score)
SELECT DISTINCT url, visit_time, from_visit, transition, segment_id, visit_duration, incremented_omnibox_typed_score
FROM old_db.visits v1
WHERE NOT EXISTS (
    SELECT 1 FROM visits v2 
    WHERE v2.url = v1.url 
    AND v2.visit_time = v1.visit_time
);

-- Commit transaction
COMMIT;

-- Detach old database
DETACH old_db;

-- Vacuum the database
VACUUM;
EOF

if [ $? -eq 0 ]; then
    echo "History merge completed successfully!"
    echo "Moving merged database into place..."
    mv "$TEMP_NEW_DB" "$NEW_MAC_DB"
    echo "Backup saved at: $BACKUP_DIR/History.backup"
else
    echo "Error occurred during merge. Restoring backup..."
    cp "$BACKUP_DIR/History.backup" "$NEW_MAC_DB"
    echo "Backup restored."
fi

# Cleanup
rm -rf "$TEMP_DIR"

echo "You can now restart Arc browser."
