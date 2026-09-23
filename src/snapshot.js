const PUBLIC_SNAPSHOT_SCHEMA_VERSION = 1

const FORBIDDEN_KEYS = new Set([
    'icao24',
    'evidence_json',
    'last_failure_at',
    'last_error',
    'remaining_credits',
    'track',
    'latitude',
    'longitude',
    'altitude'
])

function publicCollectorStatus (collector) {
    if (!collector) return 'unknown'
    if (collector.state === 'outside_schedule') return 'outside_schedule'
    if (collector.state === 'error') return 'error'
    if (collector.state === 'ok') return 'active'
    return collector.state || 'unknown'
}

function sanitizeDeparture (departure) {
    const details = departure.details || {}
    return {
        callsign: departure.callsign ?? null,
        detected_at: departure.detected_at,
        direction: departure.direction,
        runway_estimate: departure.runway_estimate,
        detection_confidence: departure.detection_confidence,
        source: departure.source,
        details: {
            observed_from: details.observed_from ?? null,
            observed_to: details.observed_to ?? null,
            samples: details.samples ?? null,
            direction_samples: details.direction_samples ?? null,
            initial_altitude: details.initial_altitude ?? null,
            maximum_altitude: details.maximum_altitude ?? null,
            altitude_gain: details.altitude_gain ?? null,
            median_vertical_rate: details.median_vertical_rate ?? null,
            longitude_delta: details.longitude_delta ?? null,
            movement: details.movement ?? null
        }
    }
}

function buildPublicSnapshot ({
    serviceSnapshot,
    generatedAt = new Date().toISOString(),
    provider = null
} = {}) {
    if (!serviceSnapshot?.advice) {
        throw new Error('serviceSnapshot.advice is required')
    }

    const advice = serviceSnapshot.advice
    const collector = serviceSnapshot.collector
    const recentDepartures = advice.recentDepartures.map(sanitizeDeparture)
    const schedule = advice.collectionSchedule

    return {
        schemaVersion: PUBLIC_SNAPSHOT_SCHEMA_VERSION,
        generatedAt,
        collectorLastSuccessAt: advice.lastSuccessAt,
        collectorStatus: publicCollectorStatus(collector),
        activeWindow: {
            start: schedule.start,
            end: schedule.end,
            timeZone: schedule.timezone
        },
        statistics: serviceSnapshot.statistics,
        nextCollectionAt: schedule.nextStartAt,
        provider,
        advice: {
            date: advice.date,
            timezone: advice.timezone,
            freshness: advice.freshness,
            recommendation: advice.recommendation,
            confidence: advice.confidence,
            reason: advice.reason,
            lastSuccessAt: advice.lastSuccessAt,
            collectionSchedule: advice.collectionSchedule,
            today: advice.today,
            recentDepartures
        },
        today: advice.today,
        recentDepartures
    }
}

function containsForbiddenKey (value) {
    if (Array.isArray(value)) return value.some(containsForbiddenKey)
    if (!value || typeof value !== 'object') return false
    return Object.entries(value).some(([key, nested]) =>
        FORBIDDEN_KEYS.has(key) || containsForbiddenKey(nested)
    )
}

function validatePublicSnapshot (snapshot) {
    if (!snapshot || snapshot.schemaVersion !== PUBLIC_SNAPSHOT_SCHEMA_VERSION) {
        throw new Error('Unsupported public snapshot schema')
    }
    if (!snapshot.generatedAt || !snapshot.advice ||
        !Array.isArray(snapshot.recentDepartures)) {
        throw new Error('Public snapshot is missing required fields')
    }
    if (containsForbiddenKey(snapshot)) {
        throw new Error('Public snapshot contains a forbidden field')
    }
    return snapshot
}

export {
    PUBLIC_SNAPSHOT_SCHEMA_VERSION,
    buildPublicSnapshot,
    sanitizeDeparture,
    validatePublicSnapshot
}
