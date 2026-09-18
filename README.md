# Dazhi Bridge Shutter Chance

This repository contains the Songshan Airport takeoff-direction service described
in [PLANS.md](PLANS.md).

## Current status

The collector supports OpenSky and adsb.fi behind a common aircraft-data interface.
The selected provider writes the same normalized SQLite observations, so the
departure detector remains provider-independent.

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
- `AIRCRAFT_DATA_PROVIDER`: `adsbfi` (default) or `opensky`
- `COLLECTOR_INTERVAL_MS`: polling interval, default `30000`
- `COLLECTOR_ACTIVE_TIME_ZONE`: active-window timezone, default `Asia/Taipei`
- `COLLECTOR_ACTIVE_START`: inclusive local start time, default `06:30`
- `COLLECTOR_ACTIVE_END`: exclusive local end time, default `21:00`
- `OBSERVATION_RETENTION_DAYS`: local raw-observation retention, default `7`
- `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET`: optional OpenSky OAuth credentials; used only with `opensky`
- `OPENSKY_LAMIN`, `OPENSKY_LAMAX`, `OPENSKY_LOMIN`, `OPENSKY_LOMAX`: OpenSky bounding box
- `ADSB_FI_LATITUDE`, `ADSB_FI_LONGITUDE`, `ADSB_FI_DISTANCE_NM`: adsb.fi point query; defaults to Songshan and 5 NM

By default, the collector uses adsb.fi. Its
altitude, speed, and climb-rate values are converted from feet, knots, and
feet per minute to the project’s metre and metre-per-second data model. Set
`AIRCRAFT_DATA_PROVIDER=opensky` to switch providers manually.

adsb.fi permits personal, non-commercial API use and requires attribution with a
link to its home page. The dashboard displays that attribution whenever adsb.fi is
the configured provider. Raw observations remain local and are not intended for
public redistribution.

The SQLite database is created automatically. The initialization enables WAL mode
and applies idempotent numbered migrations. The database and all parent directories
are local runtime data and should not be committed.

## Docker Compose

Copy `.env.example` to `.env` if you need to override defaults, then run:

```sh
docker compose up --build
```

The database is stored in the named `dazhi-data` volume. The container exposes port
3000 and has a health check at `/healthz`. Compose gives shutdown 30 seconds to
finish an in-flight request and rotates JSON logs at three 10 MB files.

The collector polls only during the configured local active window. The default
window is 06:30 inclusive through 21:00 exclusive in `Asia/Taipei`. Outside the
window it performs no provider requests and reports `outside_schedule`; the first
scheduler tick after the start boundary polls immediately. Windows crossing
midnight are also supported.

Start and inspect the service with:

```sh
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 app
curl http://127.0.0.1:3000/healthz
curl http://127.0.0.1:3000/api/v1/status
```

A normal provider failure is recorded as `error` and retried on the next scheduled
poll. `outside_schedule` is expected downtime, not a provider failure. After
changing configuration or updating the checkout, run `docker compose up -d --build`
again; the named volume and migration history are preserved.

### SQLite backup and restore

Create a consistent online backup inside the persistent volume, then copy it to
the host:

```sh
docker compose exec app npm run backup -- /data/backups/dazhi-2026-09-17.sqlite
docker compose cp app:/data/backups/dazhi-2026-09-17.sqlite ./dazhi-backup.sqlite
```

To restore on the same host, keep the backup inside `/data/backups`, stop the app,
run the restore command in a one-off container, and start the service again:

```sh
docker compose stop app
docker compose run --rm app npm run restore -- /data/backups/dazhi-2026-09-17.sqlite
docker compose up -d
```

The restore command renames the previous main database to a timestamped
`.pre-restore-*` file before copying the backup, and removes stale WAL/SHM files.
Never restore while the app container is running. After verification, old
`.pre-restore-*` files may be removed manually.

For a VPS migration: export the backup to the old host, clone this repository on
the VPS, create `.env`, and run `docker compose up -d` once to create the app
container and named volume. Copy the backup into the volume with
`docker compose cp ./dazhi-backup.sqlite app:/data/backups/restore.sqlite`, then
use the stop, restore, and start sequence above. Verify `/healthz`, schema
migrations, `/api/v1/status`, and the dashboard before retiring the old host.

## Verification

```sh
npm test
npm run lint
docker compose config
```

## API

- `GET /api/v1/status`: today summary, recommendation, freshness and collector state.
- Public departure responses omit ICAO24 and raw observations; they expose only the approved minimal departure fields.
- `GET /api/v1/departures?limit=10`: recent departures with the same recommendation payload. `limit` accepts 1-50.
- Set `API_BEARER_TOKEN` to require `Authorization: Bearer <token>` on API routes. `/healthz` remains public.
- `WEB_ENABLED` and `API_ENABLED` independently enable the public dashboard and API (both default to `true`).

## Web dashboard

Open `http://127.0.0.1:3000/` for the mobile-first dashboard. The interface supports Traditional Chinese and English; use the language button in the header. It reads the same `/api/v1/status` result as the Telegram integration.
