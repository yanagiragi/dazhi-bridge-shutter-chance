# Dazhi Bridge Shutter Chance

This repository contains the Songshan Airport takeoff-direction service described
in [PLANS.md](PLANS.md).

## Current status

Phase 3 includes the OpenSky collector, bounded polling, OAuth token caching,
retry handling and collector run status. Departure detection, web dashboard and
Telegram-facing API are not implemented yet. A westbound operating
session remains a required phase 4 acceptance item.

## Local setup

Requires Node.js 22 or newer.

```sh
npm ci
npm test
npm run migrate
npm start
```

The server listens on port 3000 by default. Check it with:

```sh
curl http://127.0.0.1:3000/healthz
```

Configuration is supplied through environment variables:

- `PORT`: HTTP port, default `3000`
- `DATABASE_PATH`: SQLite file path, default `./data/dazhi.sqlite`
- `TZ`: display and operating timezone, default `Asia/Taipei`
- `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET`: optional OpenSky OAuth credentials
- `COLLECTOR_INTERVAL_MS`: polling interval, default `30000`
- `OPENSKY_LAMIN`, `OPENSKY_LAMAX`, `OPENSKY_LOMIN`, `OPENSKY_LOMAX`: Songshan bounding box

The SQLite database is created automatically. The initialization enables WAL mode
and applies idempotent numbered migrations. The database and all parent directories
are local runtime data and should not be committed.

## Docker Compose

Copy `.env.example` to `.env` if you need to override defaults, then run:

```sh
docker compose up --build
```

The database is stored in the named `dazhi-data` volume. The container exposes port
3000 and has a health check at `/healthz`.

## Verification

```sh
npm test
npm run lint
docker compose config
```

## API

- `GET /api/v1/status`: today summary, recommendation, freshness and collector state.
- `GET /api/v1/departures?limit=10`: recent departures with the same recommendation payload. `limit` accepts 1-50.
- Set `API_BEARER_TOKEN` to require `Authorization: Bearer <token>` on both API routes. `/healthz` remains public.
