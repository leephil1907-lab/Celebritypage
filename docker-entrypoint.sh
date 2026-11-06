#!/bin/sh
# docker-entrypoint.sh — start as root only long enough to make the mounted disk usable, then drop
# privileges.
#
# Why this exists: a persistent disk is mounted over the image's directory, so the directory the image
# created and chowned for the `node` user is replaced by a mount owned by root. The container then
# starts as `node`, cannot create `data/`, and dies on its first write — the classic "works locally,
# EACCES on the host" deploy. Dropping privileges *after* taking ownership keeps both properties:
# the app never runs as root, and the disk is writable.
#
# Everything here is idempotent and skipped when the process is already unprivileged (docker run --user,
# Kubernetes securityContext, a host that pre-chowns the mount).
set -eu

APP_USER="${APP_USER:-node}"
DATA_DIR="${DATA_DIR:-/app/data}"
UPLOAD_DIR="${UPLOAD_DIR:-/app/uploads}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR" "$UPLOAD_DIR"
  # only touch ownership when it is actually wrong: a big upload tree should not be walked every boot
  for d in "$DATA_DIR" "$UPLOAD_DIR"; do
    owner="$(stat -c '%U' "$d" 2>/dev/null || echo '?')"
    if [ "$owner" != "$APP_USER" ]; then
      chown -R "$APP_USER:$APP_USER" "$d" 2>/dev/null || \
        echo "[entrypoint] could not chown $d (read-only or foreign mount) — the app will report it" >&2
    fi
  done
  if id "$APP_USER" >/dev/null 2>&1; then
    if command -v setpriv >/dev/null 2>&1; then
      exec setpriv --reuid="$APP_USER" --regid="$APP_USER" --init-groups "$@"
    elif command -v gosu >/dev/null 2>&1; then
      exec gosu "$APP_USER" "$@"
    elif command -v su-exec >/dev/null 2>&1; then
      exec su-exec "$APP_USER:$APP_USER" "$@"
    fi
    echo "[entrypoint] no privilege-dropping tool found — continuing as root" >&2
  fi
fi

exec "$@"
