#!/usr/bin/env bash
# Rebuilds the cerms PostgreSQL database inside WSL (used by wd.bat).
# Destructive: drops and recreates the cerms database.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${PGPASSWORD:-}" ]; then
  read -rsp "Password for PostgreSQL user 'postgres': " PGPASSWORD
  echo
  export PGPASSWORD
fi

echo "Recreating database cerms..."
psql -h localhost -U postgres -v ON_ERROR_STOP=1 -q \
  -c "DROP DATABASE IF EXISTS cerms WITH (FORCE)" -c "CREATE DATABASE cerms"

# Order matters: workflow and guest_lecture must run after rbac.
for f in schema views booking_logic analytics procedures seed rbac workflow guest_lecture; do
  echo "Applying db/sql/$f.sql"
  psql -h localhost -U postgres -d cerms -v ON_ERROR_STOP=1 -q -f "db/sql/$f.sql"
done

echo "PostgreSQL setup complete. (rbac.sql prints 5 expected ERROR lines.)"
