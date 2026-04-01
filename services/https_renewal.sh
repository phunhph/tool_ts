#!/bin/bash

# Log file location
LOG_FILE="/var/log/certbot-renewal.log"

while true; do
    echo "$(date): Checking for certificate renewal..." >> "$LOG_FILE"
    
    # Run certbot renew
    # --quiet: Silence output unless there are errors
    # --deploy-hook: Reload nginx/web server if renewal succeeds (optional but good practice)
    # Since I don't know the exact command to reload the web server (nginx command failed earlier), 
    # I will just run renew for now. If nginx were present, I'd add --deploy-hook "systemctl reload nginx"
    
    # Note: earlier 'nginx' command not found, so assuming maybe running differently or just want certbot standalone for now.
    # User asked for "checking and automatically renewal https if it has expired".
    
    certbot renew >> "$LOG_FILE" 2>&1
    
    # Check exit code
    if [ $? -eq 0 ]; then
        echo "$(date): Renewal check completed successfully." >> "$LOG_FILE"
    else
        echo "$(date): ERROR: Renewal check failed." >> "$LOG_FILE"
    fi
    
    # Sleep for 12 hours (43200 seconds)
    echo "$(date): Sleeping for 12 hours..." >> "$LOG_FILE"
    sleep 43200
done
