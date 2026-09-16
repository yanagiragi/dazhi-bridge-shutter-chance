// Minimum longitude displacement used as direct evidence of direction (degrees).
// Expected domain: non-negative; 0.005 degrees is roughly 500 m near Taipei.
const MIN_DIRECTION_DELTA = 0.005

// True-track windows used when longitude displacement is unavailable (degrees, 0-360).
const EASTBOUND_TRACK_MIN = 60
const EASTBOUND_TRACK_MAX = 130
const WESTBOUND_TRACK_MIN = 230
const WESTBOUND_TRACK_MAX = 310

// OpenSky vertical rate thresholds (metres per second).
const CLIMBING_VERTICAL_RATE_MIN = 1
const DESCENDING_VERTICAL_RATE_MAX = -1

// Altitude limits for low-altitude takeoff evidence (metres above mean sea level).
const MAX_INITIAL_ALTITUDE = 1500
const MAX_CANDIDATE_ALTITUDE = 2000

// A gap longer than this starts a new track segment (seconds).
const MAX_TRACK_GAP_SECONDS = 120

// Sample-count thresholds; all are positive integers.
const MIN_STATES_FOR_DIRECTION = 2
const INITIAL_DIRECTION_SAMPLE_LIMIT = 4
const MIN_DEPARTURE_SAMPLES = 2
const HIGH_CONFIDENCE_SAMPLE_LIMIT = 3

// Songshan runway designators associated with the inferred direction.
const EASTBOUND_RUNWAY = '10'
const WESTBOUND_RUNWAY = '28'

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
                Date.parse(previous.observedAt)) / 1000
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

    if (directionStates.length === 0) directionStates = positioned
    const { direction, longitudeDelta } = directionFromStates(directionStates)

    return {
        icao24: states[0].icao24,
        callsign: states.find(state => state.callsign)?.callsign ?? null,
        samples: states.length,
        directionSamples: directionStates.length,
        directionObservedAt: directionStates[0]?.observedAt ?? null,
        firstSeen: states[0].observedAt,
        lastSeen: states.at(-1).observedAt,
        initialAltitude: directionStates[0]
            ? directionStates[0].geoAltitude ?? directionStates[0].baroAltitude
            : null,
        minimumAltitude: altitudes.length ? Math.min(...altitudes) : null,
        maximumAltitude: altitudes.length ? Math.max(...altitudes) : null,
        medianVerticalRate,
        longitudeDelta,
        direction,
        movement
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

function detectDepartures (states) {
    return detectTracks(states)
        .filter(track =>
            track.samples >= MIN_DEPARTURE_SAMPLES &&
            track.movement === 'climbing' &&
            track.minimumAltitude !== null &&
            track.minimumAltitude <= MAX_CANDIDATE_ALTITUDE &&
            track.direction !== 'unknown'
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
        'SELECT 1 FROM departures WHERE icao24 = ? AND detected_at = ? LIMIT 1'
    )
    const now = new Date().toISOString()
    const insertMany = database.transaction(items => {
        for (const departure of items) {
            if (exists.get(departure.icao24, departure.directionObservedAt)) {
                continue
            }
            insert.run({
                icao24: departure.icao24,
                callsign: departure.callsign,
                detectedAt: departure.directionObservedAt,
                direction: departure.direction,
                runwayEstimate: departure.direction === 'eastbound' ? EASTBOUND_RUNWAY : WESTBOUND_RUNWAY,
                confidence: departure.detectionConfidence,
                evidence: JSON.stringify(departure),
                source,
                createdAt: now
            })
        }
    })
    insertMany(departures)
}

module.exports = {
    detectDepartures,
    detectTracks,
    directionFromStates,
    splitTracks,
    summarizeTrack,
    storeDepartures
}
