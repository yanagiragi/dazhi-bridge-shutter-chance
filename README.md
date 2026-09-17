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
3000 and has a health check at `/healthz`.

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
