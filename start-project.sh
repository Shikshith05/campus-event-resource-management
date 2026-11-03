#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT_DIR"

fail() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "Docker Desktop and the Docker CLI are required."
command -v node >/dev/null 2>&1 || fail "Node.js 20.9 or newer is required."
command -v npm >/dev/null 2>&1 || fail "npm is required. Install it with Node.js."

docker version >/dev/null 2>&1 || fail "Docker Desktop is not ready. Start it, wait for it to show Running, then retry."

if [ ! -f app/.env.local ]; then
  printf 'Creating app/.env.local with a random local session secret...\n'
  node -e 'const fs=require("node:fs");const crypto=require("node:crypto");const example=fs.readFileSync("app/.env.example","utf8");const marker="SESSION_SECRET=replace-with-a-long-random-development-secret";if(!example.includes(marker)){console.error("SESSION_SECRET placeholder not found in app/.env.example");process.exit(1)}fs.writeFileSync("app/.env.local",example.replace(marker,"SESSION_SECRET="+crypto.randomBytes(48).toString("base64")));' \
    || fail "Could not create app/.env.local."
fi

printf 'Starting PostgreSQL and MongoDB...\n'
docker compose up -d || fail "Docker Compose could not start the databases."

printf 'Waiting for PostgreSQL...\n'
waited=0
until docker compose exec -T postgres pg_isready -h 127.0.0.1 -U cerms -d cerms >/dev/null 2>&1; do
  if [ "$waited" -ge 120 ]; then
    docker compose logs postgres
    fail "PostgreSQL did not become ready within 120 seconds."
  fi
  sleep 1
  waited=$((waited + 1))
done

printf 'Waiting for MongoDB...\n'
waited=0
until docker compose exec -T mongodb mongosh --quiet "mongodb://localhost:27017/cerms" --eval 'db.runCommand({ping:1})' >/dev/null 2>&1; do
  if [ "$waited" -ge 120 ]; then
    docker compose logs mongodb
    fail "MongoDB did not become ready within 120 seconds."
  fi
  sleep 1
  waited=$((waited + 1))
done

printf 'Loading approval workflow templates and demo workflows...\n'
docker compose exec -T mongodb mongosh "mongodb://localhost:27017/cerms" /db/mongo/load.js \
  || fail "Could not load MongoDB workflow templates."
docker compose exec -T mongodb mongosh "mongodb://localhost:27017/cerms" /db/mongo/seed_demo_workflows.js \
  || fail "Could not load MongoDB demo workflows."

if [ ! -d app/node_modules ]; then
  printf 'Installing web app dependencies...\n'
  (cd app && npm install) || fail "npm install failed."
fi

printf '\nCERMS is starting at http://localhost:3000/login\n'
printf 'Keep this terminal open while you use the app. Press Ctrl+C to stop the web server.\n\n'
cd app
DATABASE_URL=postgresql://cerms_app:cerms_app_dev@127.0.0.1:5433/cerms \
MONGODB_URI=mongodb://127.0.0.1:27017/cerms \
npm run dev
