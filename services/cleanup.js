const fs = require('fs');
const path = require('path');

/**
 * Scans the uploads directory and deletes files older than maxAgeMs.
 * @param {string} directory - Path to the directory to scan.
 * @param {number} maxAgeMs - Maximum age of files in milliseconds.
 */
function scanAndDelete(directory, maxAgeMs) {
    fs.readdir(directory, (err, files) => {
        if (err) {
            console.error(`[Cleanup] Error reading directory ${directory}:`, err);
            return;
        }

        const now = Date.now();
        let deletedCount = 0;

        files.forEach(file => {
            const filePath = path.join(directory, file);

            fs.stat(filePath, (err, stats) => {
                if (err) {
                    console.error(`[Cleanup] Error stating file ${filePath}:`, err);
                    return;
                }

                if (stats.isFile()) {
                    const age = now - stats.mtimeMs;
                    if (age > maxAgeMs) {
                        fs.unlink(filePath, err => {
                            if (err) {
                                console.error(`[Cleanup] Error deleting file ${filePath}:`, err);
                            } else {
                                console.log(`[Cleanup] Deleted old file: ${file} (Age: ${(age / 3600000).toFixed(2)} hours)`);
                                deletedCount++;
                            }
                        });
                    }
                }
            });
        });
    });
}

/**
 * Starts the cleanup service interval.
 * @param {number} intervalMs - How often to run the check (default 1 hour).
 * @param {number} maxAgeMs - Max age of files to keep (default 6 hours).
 */
function startCleanupService(intervalMs = 3600000, maxAgeMs = 21600000) {
    const uploadDir = path.join(__dirname, '../uploads');

    // Ensure upload directory exists
    if (!fs.existsSync(uploadDir)) {
        console.log('[Cleanup] Uploads directory not found, skipping cleanup.');
        return;
    }

    console.log(`[Cleanup] Service started. Checking every ${intervalMs / 60000} mins for files older than ${maxAgeMs / 3600000} hours.`);

    // Run immediately on startup
    scanAndDelete(uploadDir, maxAgeMs);

    // Set interval
    setInterval(() => {
        console.log('[Cleanup] Running scheduled cleanup...');
        scanAndDelete(uploadDir, maxAgeMs);
    }, intervalMs);
}

module.exports = { startCleanupService };
