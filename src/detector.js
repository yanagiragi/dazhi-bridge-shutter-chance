// Minimum longitude displacement used as direct evidence of direction (degrees).
// Expected domain: non-negative; 0.005 degrees is roughly 500 m near Taipei.
const MIN_DIRECTION_DELTA = 0.005

// Minimum altitude gain required across takeoff-direction samples (metres).
// Expected domain: positive; 50 m rejects stationary or contradictory samples.
const MIN_CLIMB_ALTITUDE_GAIN = 50

// True-track windows used when longitude displacement is unavailable (degrees, 0-360).
const EASTBOUND_TRACK_MIN = 60
const EASTBOUND_TRACK_MAX = 130
const WESTBOUND_TRACK_MIN = 230
const WESTBOUND_TRACK_MAX = 310

// Canonical vertical-rate thresholds shared by all providers (metres per second).
const CLIMBING_VERTICAL_RATE_MIN = 1
const DESCENDING_VERTICAL_RATE_MAX = -1

// Altitude limits for low-altitude takeoff evidence (metres above mean sea level).
const MAX_INITIAL_ALTITUDE = 1500
const MAX_CANDIDATE_ALTITUDE = 2000

// Milliseconds in one second, used when comparing observation timestamps.
const MILLISECONDS_PER_SECOND = 1000

// A gap longer than this starts a new track segment (seconds).
const MAX_TRACK_GAP_SECONDS = 120

// A candidate older than one track-gap interval is stale reprocessed history.
// Expected domain: positive seconds; tied to the track segmentation boundary.
const MAX_DEPARTURE_CANDIDATE_AGE_SECONDS = MAX_TRACK_GAP_SECONDS

// Sample-count thresholds; all are positive integers.
const MIN_STATES_FOR_DIRECTION = 2
const INITIAL_DIRECTION_SAMPLE_LIMIT = 4
const MIN_DEPARTURE_SAMPLES = 2
const HIGH_CONFIDENCE_SAMPLE_LIMIT = 3

// Songshan runway designators associated with the inferred direction.
const EASTBOUND_RUNWAY = '10'
const WESTBOUND_RUNWAY = '28'
// Same-aircraft departures within this window are one event across reprocessing.
const DEPARTURE_DEDUP_WINDOW_MS = 30 * 60 * 1000

function median (values) {
    if (values.length === 0) return null
    const sorted = [...values].sort((left, right) => left - right)
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2
}

function directionFromStates (states) {
    const first = states[0]
    const last = states.at(-1)
    const longitudeDelta = states.length >= MIN_STATES_FOR_DIRECTION
        ? last.longitude - first.longitude
        : null

    if (longitudeDelta !== null && Math.abs(longitudeDelta) >= MIN_DIRECTION_DELTA) {
        return {
            direction: longitudeDelta > 0 ? 'eastbound' : 'westbound',
            longitudeDelta
        }
    }

    const tracks = states
        .map(state => state.trueTrack)
        .filter(Number.isFinite)
    const track = median(tracks)

    if (track !== null && track >= EASTBOUND_TRACK_MIN && track <= EASTBOUND_TRACK_MAX) {
        return { direction: 'eastbound', longitudeDelta }
    }

    if (track !== null && track >= WESTBOUND_TRACK_MIN && track <= WESTBOUND_TRACK_MAX) {
        return { direction: 'westbound', longitudeDelta }
    }

    return { direction: 'unknown', longitudeDelta }
}

function splitTracks (states) {
    const tracks = []
    let current = []
    let airborne = false
    let landed = false

    const finish = () => {
        if (current.length > 0) tracks.push(current)
        current = []
        airborne = false
        landed = false
    }

    for (const state of states) {
        const previous = current.at(-1)
        const gap = previous
            ? (Date.parse(state.observedAt) -
                Date.parse(previous.observedAt)) / MILLISECONDS_PER_SECOND
            : 0

        if (gap > MAX_TRACK_GAP_SECONDS || (landed && !state.onGround)) {
            finish()
        }

        current.push(state)
        if (!state.onGround) {
            airborne = true
        } else if (airborne) {
            landed = true
        }
    }

    finish()
    return tracks
}

function summarizeTrack (states) {
    const positioned = states.filter(state =>
        state.latitude !== null && state.longitude !== null
    )
    const altitudes = positioned
        .map(state => state.geoAltitude ?? state.baroAltitude)
        .filter(Number.isFinite)
    const verticalRates = positioned
        .map(state => state.verticalRate)
        .filter(Number.isFinite)
    const medianVerticalRate = median(verticalRates)
    let movement = 'undetermined'

    if (medianVerticalRate !== null && medianVerticalRate >= CLIMBING_VERTICAL_RATE_MIN) {
        movement = 'climbing'
    } else if (medianVerticalRate !== null && medianVerticalRate <= DESCENDING_VERTICAL_RATE_MAX) {
        movement = 'descending'
    } else if (positioned.some(state => state.onGround)) {
        movement = 'ground-or-level'
    }

    let directionStates = positioned
    if (movement === 'climbing') {
        directionStates = positioned
            .filter(state =>
                state.verticalRate >= CLIMBING_VERTICAL_RATE_MIN &&
                (state.geoAltitude ?? state.baroAltitude) <= MAX_INITIAL_ALTITUDE
            )
            .slice(0, INITIAL_DIRECTION_SAMPLE_LIMIT)
    }

    const firstDirectionState = directionStates[0]
    const lastDirectionState = directionStates.at(-1)
    const firstDirectionIndex = firstDirectionState
        ? positioned.indexOf(firstDirectionState)
        : -1
    const hasPriorDescent = firstDirectionIndex > 0 && positioned
        .slice(0, firstDirectionIndex)
        .some(state => state.verticalRate <= DESCENDING_VERTICAL_RATE_MAX)
    const initialAltitude = firstDirectionState
        ? firstDirectionState.geoAltitude ?? firstDirectionState.baroAltitude
        : null
    const finalAltitude = lastDirectionState
        ? lastDirectionState.geoAltitude ?? lastDirectionState.baroAltitude
        : null
    const altitudeGain = Number.isFinite(initialAltitude) && Number.isFinite(finalAltitude)
        ? finalAltitude - initialAltitude
        : null
    const { direction, longitudeDelta } = directionFromStates(directionStates)
    const trackPoints = directionStates.map(state => ({
        observedAt: state.observedAt,
        latitude: state.latitude,
        longitude: state.longitude,
        altitude: state.geoAltitude ?? state.baroAltitude ?? null
    }))

    return {
        icao24: states[0].icao24,
        callsign: states.find(state => state.callsign)?.callsign ?? null,
        samples: states.length,
        directionSamples: directionStates.length,
        directionObservedAt: firstDirectionState?.observedAt ?? null,
        firstSeen: states[0].observedAt,
        lastSeen: states.at(-1).observedAt,
        initialAltitude,
        minimumAltitude: altitudes.length ? Math.min(...altitudes) : null,
        maximumAltitude: altitudes.length ? Math.max(...altitudes) : null,
        medianVerticalRate,
        altitudeGain,
        hasPriorDescent,
        longitudeDelta,
        direction,
        movement,
        trackPoints
    }
}

function detectTracks (states) {
    const byAircraft = new Map()
    for (const state of states) {
        const aircraftStates = byAircraft.get(state.icao24) || []
        aircraftStates.push(state)
        byAircraft.set(state.icao24, aircraftStates)
    }

    return [...byAircraft.values()]
        .flatMap(aircraftStates =>
            splitTracks(aircraftStates.sort((left, right) =>
                left.observedAt.localeCompare(right.observedAt)
            ))
        )
        .map(summarizeTrack)
}

function departureCandidateIsFresh (track, observedAt) {
    if (!observedAt) return true

    const ageSeconds = (Date.parse(observedAt) - Date.parse(track.lastSeen)) / MILLISECONDS_PER_SECOND
    return Number.isFinite(ageSeconds) &&
        ageSeconds >= 0 &&
        ageSeconds <= MAX_DEPARTURE_CANDIDATE_AGE_SECONDS
}

function detectDepartures (states, { observedAt } = {}) {
    return detectTracks(states)
        .filter(track =>
            track.samples >= MIN_DEPARTURE_SAMPLES &&
            track.directionSamples >= MIN_STATES_FOR_DIRECTION &&
            track.movement === 'climbing' &&
            !track.hasPriorDescent &&
            track.minimumAltitude !== null &&
            track.minimumAltitude <= MAX_CANDIDATE_ALTITUDE &&
            track.altitudeGain !== null &&
            track.altitudeGain >= MIN_CLIMB_ALTITUDE_GAIN &&
            Number.isFinite(track.longitudeDelta) &&
            Math.abs(track.longitudeDelta) >= MIN_DIRECTION_DELTA &&
            track.direction !== 'unknown' &&
            departureCandidateIsFresh(track, observedAt)
        )
        .map(track => ({
            ...track,
            detectionConfidence: track.directionSamples >= HIGH_CONFIDENCE_SAMPLE_LIMIT
                ? 'high'
                : 'medium'
        }))
}

function storeDepartures (database, departures, source = 'opensky') {
    const insert = database.prepare(`
        INSERT INTO departures (
            icao24, callsign, detected_at, direction, runway_estimate,
            detection_confidence, evidence_json, source, created_at
        ) VALUES (
            @icao24, @callsign, @detectedAt, @direction, @runwayEstimate,
            @confidence, @evidence, @source, @createdAt
        )
    `)
    const exists = database.prepare(
        'SELECT id FROM departures WHERE icao24 = ? ' +
        'AND detected_at BETWEEN ? AND ? LIMIT 1'
    )
    const updateEvidence = database.prepare(`
        UPDATE departures
        SET callsign = COALESCE(@callsign, callsign),
            detection_confidence = @confidence,
            evidence_json = @evidence
        WHERE id = @id
    `)
    const countTrackPoints = database.prepare(
        'SELECT COUNT(*) AS count FROM departure_track_points ' +
        'WHERE departure_id = ?'
    )
    const deleteTrackPoints = database.prepare(
        'DELETE FROM departure_track_points WHERE departure_id = ?'
    )
    const insertTrackPoint = database.prepare(`
        INSERT INTO departure_track_points (
            departure_id, sequence, observed_at, latitude, longitude, altitude
        ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    const now = new Date().toISOString()

    function storeTrackPoints (departureId, trackPoints) {
        trackPoints.forEach((point, sequence) => {
            insertTrackPoint.run(
                departureId,
                sequence,
                point.observedAt,
                point.latitude,
                point.longitude,
                point.altitude
            )
        })
    }

    const insertMany = database.transaction(items => {
        let inserted = 0
        for (const departure of items) {
            const detectedAt = Date.parse(departure.directionObservedAt)
            const earliest = new Date(
                detectedAt - DEPARTURE_DEDUP_WINDOW_MS
            ).toISOString()
            const latest = new Date(
                detectedAt + DEPARTURE_DEDUP_WINDOW_MS
            ).toISOString()
            const existing = exists.get(departure.icao24, earliest, latest)
            const { trackPoints, ...evidence } = departure

            if (existing) {
                const storedPointCount = countTrackPoints.get(
                    existing.id
                ).count
                if (trackPoints.length > storedPointCount) {
                    updateEvidence.run({
                        id: existing.id,
                        callsign: departure.callsign,
                        confidence: departure.detectionConfidence,
                        evidence: JSON.stringify(evidence)
                    })
                    deleteTrackPoints.run(existing.id)
                    storeTrackPoints(existing.id, trackPoints)
                }
                continue
            }

            const result = insert.run({
                icao24: departure.icao24,
                callsign: departure.callsign,
                detectedAt: departure.directionObservedAt,
                direction: departure.direction,
                runwayEstimate: departure.direction === 'eastbound'
                    ? EASTBOUND_RUNWAY
                    : WESTBOUND_RUNWAY,
                confidence: departure.detectionConfidence,
                evidence: JSON.stringify(evidence),
                source,
                createdAt: now
            })
            storeTrackPoints(Number(result.lastInsertRowid), trackPoints)
            inserted++
        }
        return inserted
    })
    return insertMany(departures)
}

export {
    detectDepartures,
    detectTracks,
    directionFromStates,
    splitTracks,
    summarizeTrack,
    storeDepartures
}
