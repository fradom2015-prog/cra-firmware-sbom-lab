#!/bin/sh
# Backup giornaliero di database e foto. Da cron, es.: 15 3 * * * /opt/aste/aste/deploy/backup.sh
# Copia poi la cartella fuori dal server (es. rclone verso uno storage diverso): un backup sullo
# stesso disco non protegge da un guasto del server.
set -eu
cd "$(dirname "$0")"
DIR="${BACKUP_DIR:-/var/backups/aste}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M)"
mkdir -p "$DIR"
umask 077

docker compose exec -T postgres pg_dump -U aste -Fc aste > "$DIR/db-$STAMP.dump"
docker compose exec -T app tar czf - -C /data uploads > "$DIR/uploads-$STAMP.tgz"

find "$DIR" -type f \( -name 'db-*.dump' -o -name 'uploads-*.tgz' \) -mtime +"$KEEP_DAYS" -delete
echo "Backup completato: $DIR (db-$STAMP.dump, uploads-$STAMP.tgz)"
