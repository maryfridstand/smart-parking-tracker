# Architecture decisions

Short explanations of *why* we built it this way. Useful for the Code Review.

## 1. Nginx as a reverse proxy for the API

The browser calls `/api/cars` on the **same address** as the dashboard
(`localhost:8080`). Nginx forwards `/api/*` to `http://api:3000`.

- No CORS problems (same origin).
- The API container doesn't publish a port, so it can't be reached from outside
  directly. Only Nginx is exposed.
- `api` is resolved by Docker's internal DNS: every Compose service name is a
  hostname on the Compose network.

## 2. Node.js + Express for the API

Small, quick to write, and the same language as the dashboard JavaScript.
The official `redis` npm client is well supported.

## 3. Redis data model

- **Sorted set `parked`** (plate → entry timestamp): checking whether a car is
  inside, counting cars (`ZCARD`) and listing them ordered by entry time are all
  single commands.
- **List `history`**: `LPUSH` + `LTRIM` keeps only the last 50 exits.
- **Counters** (`INCR` / `INCRBY`) for total entries and revenue.
- Entry and exit use `MULTI` (a transaction), so the car and the counters
  always change together.

## 4. Persistence: AOF + named volume

`redis-server --appendonly yes` logs every write to `appendonly.aof`.
We chose AOF over the default RDB snapshots because RDB only saves every few
minutes, so a crash could lose the latest cars. With AOF we lose at most about
1 second.

The file is in `/data`, mounted on the named volume `redis-data`. Volumes are
managed by Docker and are not deleted by `docker compose down`.

## 5. Healthchecks + `depends_on: condition: service_healthy`

Startup order is `redis` → `api` → `web`, and each one waits until the previous
one is actually **ready**, not just "started":

- Redis is healthy when `redis-cli ping` answers.
- The API is healthy when `/api/health` answers, which also pings Redis.
- Nginx starts last. This matters because Nginx looks up the `api` hostname
  when it starts.

## 6. Polling instead of WebSockets

The dashboard calls `GET /api/cars` every 2 seconds. That's simple, works
through any proxy, and is more than fast enough for a parking lot.
WebSockets would be the upgrade for many dashboards / very frequent updates.

## 7. Dockerfile choices

- **`node:22-alpine` / `nginx:1.27-alpine`:** small images.
- **Copy `package*.json` and run `npm ci` before copying the code:** Docker caches
  the dependency layer, so rebuilding after a code change is fast.
- **`npm ci --omit=dev`:** exact versions from the lock file, no dev packages.
- **`USER node`:** the API doesn't run as root inside the container.

## 8. Security basics

- Plates are validated on the server (`^[A-Z0-9-]{4,12}$`).
- The dashboard inserts data with `textContent`, never `innerHTML`, so a
  malicious "plate" can't inject HTML/JS (XSS).
- GHCR login uses the automatic `GITHUB_TOKEN`; no secrets are stored in the repo.
