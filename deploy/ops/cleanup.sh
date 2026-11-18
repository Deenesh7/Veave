#!/usr/bin/env bash
# Weekly disk cleanup for the 28 GiB host. Install: /etc/cron.d/veave-cleanup -> 0 4 * * 0 root /var/www/veave/deploy/ops/cleanup.sh
set -u
# Unused Docker images/containers/build cache older than 3 days (never touches running containers or the validator image in use).
docker system prune -af --filter "until=72h" >/dev/null 2>&1 || true
# Leftover scratch directories from builds older than a day.
find "${TMPDIR:-/tmp}" -maxdepth 1 \( -name 'veave-*' \) -mtime +1 -exec rm -rf {} + 2>/dev/null || true
# Old systemd journal entries.
journalctl --vacuum-time=14d >/dev/null 2>&1 || true
df -h / | tail -1
