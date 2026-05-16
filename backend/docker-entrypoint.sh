#!/bin/bash
set -e

echo "==> Running database migrations..."
for f in /app/migrations/[0-9]*.py; do
    echo "    → $(basename $f)"
    python "$f" || echo "    WARNING: $f exited non-zero (may already be applied)"
done

echo "==> Starting server..."
exec "$@"
