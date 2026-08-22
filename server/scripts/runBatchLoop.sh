#!/bin/bash
# Run batch UID scraper in a loop with resume support
# Each run processes UIDs for up to 9 minutes, then restarts
# Progress is saved between runs

cd "$(dirname "$0")/../.."

START=${1:-1}
END=${2:-100000}
PROGRESS=${3:-"batch-uid-progress-all.json"}

echo "Batch loop: UIDs $START to $END"
echo "Progress: server/data/$PROGRESS"
echo "Will run repeatedly until all UIDs processed"
echo ""

while true; do
    # Check if all UIDs are processed
    DONE=$(node -e "
    const fs = require('fs');
    const path = 'server/data/$PROGRESS';
    try {
        const p = JSON.parse(fs.readFileSync(path, 'utf8'));
        const processed = Object.keys(p.processed).length;
        const total = $END - $START + 1;
        console.log(processed >= total ? 'ALL_DONE' : 'CONTINUE');
    } catch { console.log('CONTINUE'); }
    " 2>/dev/null)

    if [ "$DONE" = "ALL_DONE" ]; then
        echo "All UIDs processed!"
        break
    fi

    echo "[$(date)] Starting batch run..."
    timeout 540 node server/scripts/batchUidScrape.js --start=$START --end=$END --progress=$PROGRESS 2>&1
    EXIT_CODE=$?

    if [ $EXIT_CODE -eq 0 ]; then
        echo "[$(date)] Script completed normally"
        break
    elif [ $EXIT_CODE -eq 124 ]; then
        echo "[$(date)] Timeout reached, restarting..."
    else
        echo "[$(date)] Script exited with code $EXIT_CODE, restarting in 10s..."
        sleep 10
    fi
done

echo "Done. Final stats:"
node -e "
const p = JSON.parse(require('fs').readFileSync('server/data/$PROGRESS', 'utf8'));
console.log('Success:', p.stats.success);
console.log('No comments:', p.stats.noComments);
console.log('Errors:', p.stats.errors);
console.log('Blocked:', p.stats.blocked);
console.log('Total processed:', Object.keys(p.processed).length);
" 2>/dev/null
