#!/usr/bin/env bash
# Encrypted backup of the panel data directory.
# Usage: PANEL_BACKUP_PASSWORD=... ./backup.sh [app-dir] [output-dir]
# Restore: openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
#            -pass env:PANEL_BACKUP_PASSWORD < backup.tar.gz.enc \
#          | tar -C /opt/token-panel -xzf -
set -euo pipefail

app_dir=${1:-/opt/token-panel}
out_dir=${2:-$app_dir/backups}
: "${PANEL_BACKUP_PASSWORD:?set PANEL_BACKUP_PASSWORD to encrypt the archive}"

if [ ! -d "$app_dir/data" ]; then
  echo "no data directory at $app_dir/data" >&2
  exit 2
fi

mkdir -p "$out_dir"
chmod 700 "$out_dir"
stamp=$(date +%Y%m%d-%H%M%S)
file="$out_dir/token-panel-$stamp.tar.gz.enc"

umask 077
tar -C "$app_dir" -czf - data \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:PANEL_BACKUP_PASSWORD \
  > "$file"
chmod 600 "$file"

echo "$file"
echo "restore with the openssl command in this script header; the data-key inside is required to read accounts.json"
