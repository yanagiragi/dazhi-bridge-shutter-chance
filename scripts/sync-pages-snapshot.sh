#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PROJECT_ROOT=$(cd -- "${SCRIPT_DIR}/.." && pwd)

BACKUP_NAME=${BACKUP_NAME:-gh-pages-sync.sqlite}
CONTAINER_BACKUP_PATH="/data/backups/${BACKUP_NAME}"
HOST_BACKUP_DIR=${HOST_BACKUP_DIR:-"${PROJECT_ROOT}/runtime/backup"}
HOST_BACKUP_PATH="${HOST_BACKUP_DIR}/${BACKUP_NAME}"
SNAPSHOT_PATH=${SNAPSHOT_PATH:-"${PROJECT_ROOT}/runtime/pages/status.json"}
PAGES_WORKTREE_PATH=${PAGES_WORKTREE_PATH:-"${PROJECT_ROOT}/worktree-pages"}
COMPOSE_SERVICE=${COMPOSE_SERVICE:-app}

mkdir -p "${HOST_BACKUP_DIR}"

echo "[1/4] Backing up SQLite from Docker service: ${COMPOSE_SERVICE}"
docker compose exec -T "${COMPOSE_SERVICE}" \
    npm run backup -- "${CONTAINER_BACKUP_PATH}"

echo "[2/4] Copying backup to host: ${HOST_BACKUP_PATH}"
docker compose cp \
    "${COMPOSE_SERVICE}:${CONTAINER_BACKUP_PATH}" \
    "${HOST_BACKUP_PATH}"

echo "[3/4] Exporting public summary snapshot: ${SNAPSHOT_PATH}"
(
    cd "${PROJECT_ROOT}"
    DATABASE_PATH="${HOST_BACKUP_PATH}" \
    STATIC_SNAPSHOT_PATH="${SNAPSHOT_PATH}" \
    node scripts/export-snapshot.js
)

echo "[4/4] Updating and verifying Pages worktree: ${PAGES_WORKTREE_PATH}"
mkdir -p "${PAGES_WORKTREE_PATH}/data"
cp -- "${SNAPSHOT_PATH}" "${PAGES_WORKTREE_PATH}/data/status.json"
(
    cd "${PROJECT_ROOT}"
    PAGES_WORKTREE_PATH="${PAGES_WORKTREE_PATH}" \
    npm run pages:verify
)

echo
echo "Snapshot sync complete. No Git command was executed."
echo "Review the result, then commit and push the Pages worktree manually."
