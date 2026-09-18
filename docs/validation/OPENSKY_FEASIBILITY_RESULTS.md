# Phase 1 OpenSky feasibility results

Status: **conditionally passed; awaiting review before phase 2**

Observation date: 2026-09-16  
Observation window: 12:59:57–14:30:52 Asia/Taipei  
Primary source: [OpenSky REST API](https://openskynetwork.github.io/opensky-api/rest.html)
`/api/states/all` (anonymous)  
Reference sources:
[Songshan domestic departures](https://www.tsa.gov.tw/flights/domestic/today?culture=1)
and
[Songshan international departures](https://www.tsa.gov.tw/flights/international/today?culture=1)

## Method

The collector queried this bounding box every 30 seconds:

| Parameter | Value |
| --- | ---: |
| `lamin` | 24.98 |
| `lamax` | 25.15 |
| `lomin` | 121.42 |
| `lomax` | 121.72 |

Collection was deliberately bounded. The first run stopped normally after 120
samples. The second run was stopped after 59 samples when the tenth independent
departure had four direction samples.

Raw JSONL is kept locally under `data/validation/` and is ignored by Git. It contains
no OpenSky credentials.

## Collection results

| Metric | Result |
| --- | ---: |
| Successful samples | 179 / 179 |
| Failed requests | 0 |
| Polling interval | 30 seconds |
| Aircraft state rows | 445 |
| Unique ICAO24 identifiers | 40 |
| Independent departure events | 10 |
| Anonymous `/states` credits used by the recorded run | 179 |
| Remaining anonymous `/states` credits after the run | 219 |

OpenSky returned all fields needed for the feasibility decision: position,
barometric/geometric altitude, ground state, velocity, true track, vertical rate,
callsign and timestamps. Some successful snapshots contained zero aircraft; an
empty state list must not be treated as an API outage.

## Manually reviewed departures

Times below are the first low-altitude climbing point selected for direction
analysis. All times use Asia/Taipei.

| Observed | OpenSky callsign | ICAO24 | Official flight match | Initial track | Result |
| --- | --- | --- | --- | ---: | --- |
| 13:25:02 | `MDA217` | `8990a1` | `AE217` | 93.88° | eastbound |
| 13:28:06 | `UIA8795` | `899143` | `B78795` | 91.05° | eastbound |
| 13:36:48 | `CSH820` | `780e6e` | `FM820` | 94.32° | eastbound |
| 13:41:55 | `UIA8725` | `899142` | `B78725` | 91.55° | eastbound |
| 13:51:39 | `B54111` | `899127` | No matching public scheduled flight | 92.49° | eastbound |
| 14:03:14 | `MDA371` | `89914d` | `AE371` | 93.26° | eastbound |
| 14:05:47 | `TWB668` | `71c737` | `TW668` | 94.40° | eastbound |
| 14:07:20 | `UIA8617` | `89906e` | `B78617` | 91.53° | eastbound |
| 14:23:12 | `MDA1271` | `89914a` | `AE1271` | 91.02° | eastbound |
| 14:29:20 | `JAL98` | `86e7c4` | `JL098` | 92.81° | eastbound |

Each event had at least four usable direction points. Manual review of position,
altitude, vertical rate and track classified all ten as unambiguous eastbound
departures.

Nine unique scheduled flights in the official Songshan departure data had a
corresponding departure during the observation window, and all nine were found
in OpenSky. `B54111` behaved as a valid runway departure but had no matching
public scheduled flight, so the system must permit registration-like or
non-scheduled callsigns.

The official site's “actual departure” time preceded the first observed airborne
point by varying amounts. It is suitable for matching a flight but not for
deciding the takeoff instant or direction.

## Findings that change the production detector

1. **Use the runway-exit segment, not the whole route.** `MDA371` and
   `MDA1271` departed eastbound and later turned west. Whole-track start/end
   analysis would produce the wrong answer for photography.
2. **Split repeated flights for the same ICAO24.** An aircraft can land, remain
   on the ground and later depart again. Grouping an entire day by ICAO24 merges
   different events.
3. **Ground transition is helpful but not mandatory.** Several events included
   `onGround=true` before departure; all ten had low-altitude climbing points
   sufficient to recover direction even if the transition were missed.
4. **A 30-second interval is viable.** Every reviewed departure produced at
   least four useful initial-direction points in this bounding box.
5. **Calls sign data is not a commercial flight database.** Callsigns may use
   ICAO airline prefixes, registration-like values, or have no direct public
   schedule match.
6. **HTTP health and traffic presence are separate.** A successful empty response
   is normal and must not lower source-health status by itself.
7. **Historical flight endpoints need authentication.** The anonymous
   `/flights/departure` request returned HTTP 403; the live anonymous states
   endpoint was sufficient for this spike.

## Accuracy and limitations

- Observed direction review: 10/10 internally consistent, or 100% for this sample.
- Reference scheduled-flight coverage: 9/9 matching operated scheduled flights
  were detected during the window.
- All observed departures used the eastbound runway configuration.
- The target photography condition is westbound, so this run does **not** prove
  westbound detection with real samples.
- The sample covers about 91 minutes on one day and should not be interpreted as
  a long-term OpenSky availability guarantee.

## Decision

OpenSky live state vectors are feasible as the initial production data source.
The 30-second interval and proposed bounding box provide enough low-altitude
points to distinguish departures from arrivals and determine the initial runway
direction.

Recommendation: proceed to phase 2 after review, while carrying one mandatory
follow-up acceptance item into phase 4:

> Collect and manually review a real westbound operating session before the
> production detector is considered complete.

No alternative ADS-B provider or private receiver is required at this point.

## Reproduction

```sh
node scripts/validation/collect-opensky.js --samples 20 --interval 30 \
  --output data/validation/observations.jsonl

node scripts/validation/analyze-observations.js data/validation/observations.jsonl

node --test test/validation/analyze-observations.test.js
```

The analyzer is still a feasibility tool. Its thresholds and event segmentation
are evidence for the future production implementation, not production code.
