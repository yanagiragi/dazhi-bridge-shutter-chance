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

## Summarize observed tracks

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
