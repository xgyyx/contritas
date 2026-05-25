#!/bin/bash
# Postgres 备份 → Oracle Object Storage（Always Free 含 20GB 标准桶）
#
# 前置：
#   1. 已 oci setup config（参见 docs/deployment/oracle-free-tier.md §10）
#   2. 已在 OCI 控制台创建 bucket，名字传入 BACKUP_BUCKET 环境变量
#   3. 已 chmod +x backup.sh
#
# cron 示例（每天 03:17，避开整点）：
#   17 3 * * * BACKUP_BUCKET=contritas-backup /home/ubuntu/contritas/backup.sh >> /home/ubuntu/backup.log 2>&1

set -euo pipefail

BUCKET="${BACKUP_BUCKET:?BACKUP_BUCKET must be set, e.g. contritas-backup}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
COMPOSE_DIR="$(cd "$(dirname "$0")" && pwd)"

cd "$COMPOSE_DIR"

TS=$(date +%Y%m%d-%H%M)
FILE="db-${TS}.sql.gz"
TMP="/tmp/${FILE}"

echo "[$(date -Is)] backup start → ${FILE}"

# pg_dump 走 docker compose exec，避免 host 安装 psql
docker compose exec -T postgres pg_dump -U postgres contritas | gzip > "$TMP"

# 上传到 Object Storage
oci os object put -bn "$BUCKET" --file "$TMP" --force --name "$FILE" >/dev/null

rm -f "$TMP"

# 清理 30 天前的备份
CUTOFF_DATE=$(date -d "${RETENTION_DAYS} days ago" +%Y%m%d)
CUTOFF_NAME="db-${CUTOFF_DATE}"

oci os object list -bn "$BUCKET" --query 'data[*].name' --raw-output 2>/dev/null \
  | jq -r '.[]?' \
  | awk -v c="$CUTOFF_NAME" '$0 < c {print}' \
  | while read -r old; do
      echo "[$(date -Is)] prune old backup: $old"
      oci os object delete -bn "$BUCKET" --name "$old" --force >/dev/null
    done

echo "[$(date -Is)] backup done"
