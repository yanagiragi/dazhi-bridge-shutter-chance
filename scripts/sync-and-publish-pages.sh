#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
PROJECT_ROOT=$(cd -- "${SCRIPT_DIR}/.." && pwd)
LOCK_FILE=${PAGES_LOCK_FILE:-"${PROJECT_ROOT}/runtime/pages-publish.lock"}
WORKTREE_PATH=${PAGES_WORKTREE_PATH:-"${PROJECT_ROOT}/worktree-pages"}
SNAPSHOT_PATH=${SNAPSHOT_PATH:-"${PROJECT_ROOT}/runtime/pages/status.json"}
ASKPASS_PATH=${PAGES_ASKPASS_PATH:-}

mkdir -p "$(dirname -- "${LOCK_FILE}")"
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
    echo 'Another Pages sync is already running; exiting.'
    exit 0
fi

remote_url=$(git -C "${PROJECT_ROOT}" remote get-url origin)
case "${remote_url}" in
    https://github.com/*)
        ;;
    *)
        echo 'Pages auto-publish requires an HTTPS GitHub origin for the PAT.' >&2
        exit 1
        ;;
esac
if [[ "${remote_url}" == *'@'* ]]; then
    echo 'The GitHub origin must not contain credentials in its URL.' >&2
    exit 1
fi

if [[ -n "${ASKPASS_PATH}" ]]; then
    export GIT_ASKPASS="${ASKPASS_PATH}"
fi
export GIT_TERMINAL_PROMPT=0
export PAGES_WORKTREE_PATH="${WORKTREE_PATH}"
export SNAPSHOT_PATH="${SNAPSHOT_PATH}"

cd "${PROJECT_ROOT}"
npm run pages:sync

PAGES_WORKTREE_PATH="${WORKTREE_PATH}" \
SNAPSHOT_PATH="${SNAPSHOT_PATH}" \
STATIC_SNAPSHOT_PATH="${SNAPSHOT_PATH}" \
PAGES_PUSH=true \
npm run pages:publish

PAGES_WORKTREE_PATH="${WORKTREE_PATH}" npm run pages:verify
