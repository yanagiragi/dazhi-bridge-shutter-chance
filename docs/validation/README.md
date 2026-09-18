# Provider validation tools and evidence

This directory documents the bounded validation tools used for provider coverage,
detector feasibility, and deployment verification. The tools under
`scripts/validation/` are intentionally independent from the production collector.

## Collect bounded samples

Anonymous collection:

```sh
node scripts/validation/collect-opensky.js --samples 20 --interval 30 \
  --output data/validation/observations.jsonl
```

Authenticated collection:

```sh
export OPENSKY_CLIENT_ID='...'
export OPENSKY_CLIENT_SECRET='...'
node scripts/validation/collect-opensky.js --samples 20 --interval 30 \
  --output data/validation/observations.jsonl
```

The program stops after the requested sample count. Credentials are read only from
the environment and are not written to disk. Raw JSONL files under `data/validation/`
are ignored by Git.

## Collect adsb.fi coverage samples

The adsb.fi validation collector defaults to a 25 NM query every five seconds so the analyzer can compare narrower radii without issuing additional API requests:

```sh
node scripts/validation/collect-adsbfi.js --samples 360 --interval 5 \
  --output data/validation/adsbfi-observations.jsonl
```

The interval must be at least one second to respect the public endpoint rate limit. Analyze field coverage, position age, low-altitude observations and detector output at 3, 5, 10 and 25 NM:

```sh
node scripts/validation/analyze-adsbfi.js data/validation/adsbfi-observations.jsonl
```

A detected departure is only a candidate until it has been matched with an actual Songshan departure. A wide radius can include Taoyuan traffic and produce false positives. See [ADSB_FI_RESULTS.md](ADSB_FI_RESULTS.md) for reviewed observations and remaining acceptance work.

## Summarize observed OpenSky tracks

```sh
node scripts/validation/analyze-observations.js data/validation/observations.jsonl
```

## Run the regression test

```sh
node --test test/validation/analyze-observations.test.js
```

See [OPENSKY_FEASIBILITY_RESULTS.md](OPENSKY_FEASIBILITY_RESULTS.md) for the reviewed phase 1 outcome and remaining limitation.
The analyzer is deliberately a coarse feasibility heuristic, not the production
departure detector. Candidate tracks still require manual validation before phase
1 can pass.

## Deployment soak test

See [STAGE8_RESULTS.md](STAGE8_RESULTS.md) for phase 8 Docker, restart, backup, schedule, and 24-hour soak-test evidence.
