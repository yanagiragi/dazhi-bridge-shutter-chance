# OpenSky data feasibility spike

This directory belongs to phase 1 of `PLANS.md`. It is intentionally independent
from the future production application.

## Collect bounded samples

Anonymous collection:

```sh
node spike/collect-opensky.mjs --samples 20 --interval 30 \
  --output spike/data/observations.jsonl
```

Authenticated collection:

```sh
export OPENSKY_CLIENT_ID='...'
export OPENSKY_CLIENT_SECRET='...'
node spike/collect-opensky.mjs --samples 20 --interval 30 \
  --output spike/data/observations.jsonl
```

The program stops after the requested sample count. Credentials are read only from
the environment and are not written to disk. Raw JSONL files under `spike/data/`
are ignored by Git.

## Collect adsb.fi coverage samples

The adsb.fi spike defaults to a 25 NM query every five seconds so the analyzer can compare narrower radii without issuing additional API requests:

```sh
node spike/collect-adsbfi.mjs --samples 360 --interval 5 \
  --output spike/data/adsbfi-observations.jsonl
```

The interval must be at least one second to respect the public endpoint rate limit. Analyze field coverage, position age, low-altitude observations and detector output at 3, 5, 10 and 25 NM:

```sh
node spike/analyze-adsbfi.mjs spike/data/adsbfi-observations.jsonl
```

A detected departure is only a candidate until it has been matched with an actual Songshan departure. A wide radius can include Taoyuan traffic and produce false positives. See [ADSB_FI_RESULTS.md](ADSB_FI_RESULTS.md) for reviewed observations and remaining acceptance work.

## Summarize observed OpenSky tracks

```sh
node spike/analyze-observations.mjs spike/data/observations.jsonl
```

## Run the regression test

```sh
node --test spike/analyze-observations.test.mjs
```

See `RESULTS.md` for the reviewed phase 1 outcome and remaining limitation.
The analyzer is deliberately a coarse feasibility heuristic, not the production
departure detector. Candidate tracks still require manual validation before phase
1 can pass.

## Deployment soak test

See [STAGE8_RESULTS.md](STAGE8_RESULTS.md) for phase 8 Docker, restart, backup, schedule, and 24-hour soak-test evidence.
