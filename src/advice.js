// Maximum number of newest departures returned to callers (positive integer).
const RECENT_DEPARTURE_LIMIT = 10

// Freshness thresholds: fresh up to 15 minutes; stale up to 60 minutes. Values are milliseconds.
const FRESH_DATA_MAX_AGE_MS = 15 * 60 * 1000
const STALE_DATA_MAX_AGE_MS = 60 * 60 * 1000

// Minimum departure counts required for the high and medium confidence tiers.
const HIGH_CONFIDENCE_MIN_SAMPLES = 5
const MEDIUM_CONFIDENCE_MIN_SAMPLES = 3

// Westbound share thresholds, expressed as ratios in the inclusive range [0, 1].
const HIGH_WESTBOUND_RATIO = 0.6
const MEDIUM_WESTBOUND_RATIO = 0.5
// Percentage conversion used only for human-readable reason text.
const PERCENT_SCALE = 100


function localDateKey (date, timezone) {
    // en-CA gives a stable ISO-like year/month/day representation.
    // The supplied timeZone, not the locale, determines the local calendar date.
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date)
    const values = Object.fromEntries(
        parts
            .filter(part => part.type !== 'literal')
            .map(part => [part.type, part.value])
    )
    return `${values.year}-${values.month}-${values.day}`
}

function sortNewestFirst (departures) {
    return [...departures].sort((left, right) =>
        Date.parse(right.detected_at) - Date.parse(left.detected_at)
    )
}

function freshnessFor (lastSuccessAt, now) {
    if (!lastSuccessAt) return 'unknown'
    const age = now.getTime() - Date.parse(lastSuccessAt)
    if (!Number.isFinite(age) || age < 0) return 'unknown'
    if (age <= FRESH_DATA_MAX_AGE_MS) return 'fresh'
    if (age <= STALE_DATA_MAX_AGE_MS) return 'stale'
    return 'expired'
}

function recommendationFor ({ westboundCount, totalCount, freshness }) {
    if (freshness === 'unknown' || freshness === 'expired' || totalCount === 0) {
        return {
            recommendation: 'insufficient-data',
            confidence: 'insufficient',
            reason: 'Not enough fresh departure data for today'
        }
    }

    const ratio = westboundCount / totalCount
    if (totalCount >= HIGH_CONFIDENCE_MIN_SAMPLES &&
        ratio >= HIGH_WESTBOUND_RATIO) {
        return {
            recommendation: 'good-opportunity',
            confidence: 'high',
            reason: `Today westbound share is ${Math.round(ratio * PERCENT_SCALE)}%`
        }
    }

    if (totalCount >= MEDIUM_CONFIDENCE_MIN_SAMPLES &&
        ratio >= MEDIUM_WESTBOUND_RATIO) {
        return {
            recommendation: 'possible-opportunity',
            confidence: 'medium',
            reason: `Recent westbound share is ${Math.round(ratio * PERCENT_SCALE)}%`
        }
    }

    return {
        recommendation: 'low-opportunity',
        confidence: 'low',
        reason: 'Recent westbound share is low'
    }
}

function buildAdvice ({
    departures = [],
    lastSuccessAt = null,
    now = new Date(),
    timezone = 'Asia/Taipei',
    recentLimit = RECENT_DEPARTURE_LIMIT
} = {}) {
    const today = localDateKey(now, timezone)
    const currentTimestamp = now.getTime()
    const pastDepartures = departures.filter(departure => {
        const detectedTimestamp = Date.parse(departure.detected_at)
        return Number.isFinite(detectedTimestamp) &&
            detectedTimestamp <= currentTimestamp
    })
    const todayDepartures = pastDepartures.filter(departure =>
        localDateKey(new Date(departure.detected_at), timezone) === today
    )
    const recentDepartures = sortNewestFirst(pastDepartures)
        .slice(0, recentLimit)
    const westboundCount = todayDepartures.filter(departure =>
        departure.direction === 'westbound'
    ).length
    const freshness = freshnessFor(lastSuccessAt, now)
    const recommendation = recommendationFor({
        westboundCount,
        totalCount: todayDepartures.length,
        freshness
    })

    return {
        date: today,
        timezone,
        freshness,
        lastSuccessAt,
        today: {
            total: todayDepartures.length,
            eastbound: todayDepartures.filter(item =>
                item.direction === 'eastbound'
            ).length,
            westbound: westboundCount,
            unknown: todayDepartures.filter(item =>
                item.direction === 'unknown'
            ).length
        },
        recentDepartures,
        ...recommendation
    }
}

module.exports = {
    buildAdvice,
    freshnessFor,
    localDateKey,
    recommendationFor
}
