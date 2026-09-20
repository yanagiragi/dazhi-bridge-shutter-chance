# Dazhi Bridge Shutter Chance

This repository contains the Songshan Airport takeoff-direction service described
in [PLANS.md](docs/PLANS.md).

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
- `DEPARTURE_DETAILS_MODE`: `summary` (public-safe default) or `precise` (private deployments only)
- `OPERATOR_CATALOG_PATH`: operator-name catalog, default `./config/operators.json` locally and `/config/operators.json` in Compose
- `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET`: optional OpenSky OAuth credentials; used only with `opensky`
- `OPENSKY_LAMIN`, `OPENSKY_LAMAX`, `OPENSKY_LOMIN`, `OPENSKY_LOMAX`: OpenSky bounding box
- `ADSB_FI_LATITUDE`, `ADSB_FI_LONGITUDE`, `ADSB_FI_DISTANCE_NM`: adsb.fi point query; defaults to Songshan and 5 NM

By default, the collector uses adsb.fi. Its
altitude, speed, and climb-rate values are converted from feet, knots, and
feet per minute to the project’s metre and metre-per-second data model. Set
`AIRCRAFT_DATA_PROVIDER=opensky` to switch providers manually.

The adsb.fi Open Data terms permit personal, non-commercial API use, prohibit
licensing or selling the data or service, and require attribution with a link to
the [adsb.fi home page](https://adsb.fi/). The dashboard displays that attribution
whenever adsb.fi is configured. The terms do not expressly grant a right to
republish position points, so this project conservatively keeps precise tracks in
private deployments. Public snapshots must use `summary` unless adsb.fi gives
written permission. See the [official API terms](https://github.com/adsbfi/opendata/blob/main/README.md#terms).

The dashboard preserves each raw ADS-B callsign as an "ADS-B identifier". If its
three-letter prefix is in `config/operators.json`, it also displays a neutral,
localized airline-name badge. It does not infer an IATA flight number; numeric,
registration-like, and unknown identifiers remain unchanged without a badge.
For cataloged airlines, the operator's verified IATA code converts the ADS-B
callsign to a Flightradar24 flight-history URL. For example, `EVA192` becomes
`https://www.flightradar24.com/data/flights/br192`. A cataloged operator without
an assigned IATA code falls back to its ICAO callsign, so `VJT719` becomes
`https://www.flightradar24.com/data/flights/vjt719`. The service does not guess
an IATA code for unknown operators or a flight-instance URL.

### Maintaining operator names

The operator catalog is one versioned JSON file shared by the audit command,
server, and dashboard. To handle an unknown identifier such as `ESR888`:

1. Find candidates in the database:

```sh
npm run audit:callsigns
docker compose exec app npm run audit:callsigns
```

   The Compose command reads `/data/dazhi.sqlite` from the existing named volume;
   the database does not need to be copied out of the container. Add
   `-- --resolve` locally, or append `--resolve` to the Compose command, to query
   the FAA designator list and Wikidata for reviewable candidate fields:

```sh
npm run audit:callsigns -- --resolve
docker compose exec app npm run audit:callsigns -- --resolve
```

   Resolution is read-only: it prints JSON with source URLs, source records,
   review notes, and a `suggestedFields` object using the same shape as one
   `operators.json` entry so it can be reviewed and copied directly. It never
   edits `operators.json`. FAA is
   the current-designator source; CC0-licensed Wikidata supplements IATA codes
   and localized names. Conflicting or missing records remain explicitly marked
   for human review.
2. Treat `ESR` as a candidate, not `ESR888` as an allowlist entry. Verify the
   three-letter designator and operator name against an authoritative ICAO or
   national aviation source. Leave an unconfirmed value on the unknown fallback.
3. Add one `ESR` object to the `operators` array in `config/operators.json`. Supply
   its verified two-character `iataCode`, or `null` when the operator has no
   assigned IATA designator, plus non-empty `short` and `name` values for both
   `en` and `zh-TW`.
4. Run `npm test` and `npm run lint`, then commit the catalog change so its history
   and rollback remain in Git.
5. With Docker Compose, reload the browser. The host catalog is mounted read-only
   at `/config/operators.json`, and the server validates and reads it for each
   catalog request, so no image rebuild or container restart is required.

Keep a normal repository or host backup before editing. To roll back, restore the
previous valid JSON from Git and reload the page. A malformed, duplicate,
or incompletely translated catalog is rejected instead of being partially served.

Compose intentionally mounts only the catalog, not all of `public/`, so a host
directory cannot hide the image's frontend assets. A standalone `docker run` uses
the catalog bundled in the image and therefore requires an image rebuild after a
catalog change unless an alternate file is mounted read-only and selected with
`OPERATOR_CATALOG_PATH`.

Departure detail responses default to `summary`, which contains detector evidence
but no exact coordinates. The detector stores the same track points in SQLite in
both modes; the mode controls only whether the HTTP response and dashboard expose
those coordinates.
Use `DEPARTURE_DETAILS_MODE=precise` only on a private LAN, VPN, or access-controlled
deployment. Future GitHub Pages snapshots must remain on the summary allowlist and
must never publish precise tracks without written provider permission.

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
changing application configuration or updating source code, run
`docker compose up -d --build` again; the named volume and migration history are
preserved. Operator-catalog-only changes are the exception described above and do
not require rebuilding.

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

- `GET /api/v1/status`: today summary, recommendation, freshness, collector state, and the configured collection schedule. Outside collection hours, `advice.collectionSchedule.nextStartAt` contains the next active-window start as an ISO timestamp.
- Public departure responses omit ICAO24 and raw observations; they expose only the approved minimal departure fields.
- `GET /api/v1/departures?limit=10`: recent departures with the same recommendation payload. `limit` accepts 1-50.
- Set `API_BEARER_TOKEN` to require `Authorization: Bearer <token>` on `/api/v1/*` routes. The dashboard data endpoint and `/healthz` remain outside this API authentication boundary.
- `WEB_ENABLED` and `API_ENABLED` independently enable the public dashboard and API (both default to `true`).

## Web dashboard

Open `http://127.0.0.1:3000/` for the mobile-first dashboard. The interface supports Traditional Chinese and English; use the language button in the header. It reads `/dashboard-data.json`, while integrations such as a Telegram bot use the separately protected `/api/v1/*` routes.

`summary` uses a rose aircraft favicon (`#dc7b81`), `precise` uses blue (`#69b7ff`), and GitHub Pages `snapshot` uses gray (`#A6A6A6`). The aircraft silhouette is identical in all modes.

`/dashboard-data.json` is enabled only with `WEB_ENABLED=true` and follows `DEPARTURE_DETAILS_MODE`. A `precise` self-hosted dashboard must therefore be protected as a whole by a reverse proxy, VPN, or private network; use `summary` for a publicly reachable dashboard.

## GitHub Pages snapshot

The Pages deployment is a static snapshot and does not expose the private HTTP API. Enable snapshot export only when a host publisher is configured:

```sh
STATIC_PUBLISH_ENABLED=true
STATIC_SNAPSHOT_PATH=/export/status.json
STATIC_PUBLISH_HEARTBEAT_MINUTES=30
docker compose up -d --build
docker compose exec app npm run pages:snapshot
```

The collector writes only the summary projection to the bind-mounted `runtime/pages/status.json`. It never receives a GitHub credential. Create a gh-pages worktree on the host, then run:

```sh
PAGES_WORKTREE_PATH=./worktree-pages npm run pages:setup
PAGES_WORKTREE_PATH=./worktree-pages \
STATIC_SNAPSHOT_PATH=./runtime/pages/status.json \
PAGES_PUSH=true npm run publish:pages
PAGES_WORKTREE_PATH=./worktree-pages npm run pages:verify
```

The publisher validates the schema, copies the frontend and operator catalog, writes snapshot web-config.json, and commits only when output changes. It uses git pull --ff-only and never force-pushes. Configure GitHub Pages to deploy the gh-pages branch root at the repository URL. If GitHub is unavailable, SQLite collection continues and a later publish can retry.

Pages always publishes summary; exact track coordinates remain private. The snapshot contains only today departures observed no later than its generation time, advice, active-window status, and minimal departure evidence.

### Automated Pages sync and push

For unattended publishing, use `pages:sync-and-publish`. It acquires a host lock, requires an HTTPS GitHub remote, runs the database backup and snapshot verification, then commits and pushes only through the existing publisher. It never puts a PAT in the command line or repository. Configure `PAGES_ASKPASS_PATH` to a root-readable-only Git askpass helper that reads the PAT from a separate `0600` file.

The current repository remote is SSH. Change it once yourself if PAT authentication is desired:

```sh
git remote set-url origin https://github.com/yanagiragi/dazhi-bridge-shutter-chance.git
```

Example cron entry (every 30 minutes):

```cron
*/30 * * * * PAGES_ASKPASS_PATH=/home/rayark/bin/github-pages-askpass /home/rayark/Projects/dazhi-bridge-shutter-chance/scripts/sync-and-publish-pages.sh >> /home/rayark/Projects/dazhi-bridge-shutter-chance/runtime/pages-cron.log 2>&1
```

`PAGES_LOCK_FILE` can override the lock location. Set the askpass helper and PAT file permissions so only the service user can read them. `GIT_TERMINAL_PROMPT=0` makes missing credentials fail promptly instead of hanging cron. If GitHub is unavailable, the SQLite backup and local snapshot remain available and the next scheduled run can retry.
