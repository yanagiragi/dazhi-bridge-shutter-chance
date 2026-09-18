// Maximum number of newest departures returned to callers (positive integer).
const RECENT_DEPARTURE_LIMIT = 10

// Freshness thresholds: fresh up to 15 minutes; stale up to 60 minutes. Values are milliseconds.
const FRESH_DATA_MAX_AGE_MS = 15 * 60 * 1000
const STALE_DATA_MAX_AGE_MS = 60 * 60 * 1000

// Recommendation trend uses the newest three departures from today's history.
const RECOMMENDATION_TREND_LIMIT = 3
// Medium confidence needs a prior directional sample in addition to the latest one.
const MEDIUM_CONFIDENCE_MIN_DIRECTIONAL_DEPARTURES = 2


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

function freshnessFor (lastSuccessAt, now, collectorState = null) {
    if (collectorState === 'outside_schedule') return 'outside_schedule'
    if (!lastSuccessAt) return 'unknown'
    const age = now.getTime() - Date.parse(lastSuccessAt)
    if (!Number.isFinite(age) || age < 0) return 'unknown'
    if (age <= FRESH_DATA_MAX_AGE_MS) return 'fresh'
    if (age <= STALE_DATA_MAX_AGE_MS) return 'stale'
    return 'expired'
}

function recommendationFor ({ recentDepartures, freshness }) {
    if (freshness !== 'fresh' || recentDepartures.length === 0) {
        return {
            recommendation: 'insufficient-data',
            confidence: 'insufficient',
            reason: 'The collector is not fresh or has no departure data today'
        }
    }

    const trend = recentDepartures.slice(0, RECOMMENDATION_TREND_LIMIT)
    const allRecentDeparturesAreWestbound =
        trend.length === RECOMMENDATION_TREND_LIMIT &&
        trend.every(item => item.direction === 'westbound')
    if (allRecentDeparturesAreWestbound) {
        return {
            recommendation: 'good-opportunity',
            confidence: 'high',
            reason: 'The latest three departures were westbound'
        }
    }

    const directionalDepartureCount = recentDepartures.filter(item =>
        item.direction === 'eastbound' || item.direction === 'westbound'
    ).length
    if (recentDepartures[0].direction === 'westbound' &&
        directionalDepartureCount >= MEDIUM_CONFIDENCE_MIN_DIRECTIONAL_DEPARTURES) {
        return {
            recommendation: 'possible-opportunity',
            confidence: 'medium',
            reason: 'The latest departure was westbound'
        }
    }

    return {
        recommendation: 'low-opportunity',
        confidence: 'low',
        reason: 'The latest departure was not westbound or there is only one directional sample'
    }
}

function buildAdvice ({
    departures = [],
    lastSuccessAt = null,
    now = new Date(),
    timezone = 'Asia/Taipei',
    collectorState = null,
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
    const recentDepartures = sortNewestFirst(todayDepartures)
        .slice(0, recentLimit)
    const westboundCount = todayDepartures.filter(departure =>
        departure.direction === 'westbound'
    ).length
    const freshness = freshnessFor(lastSuccessAt, now, collectorState)
    const recommendation = recommendationFor({
        recentDepartures,
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

export {
    buildAdvice,
    freshnessFor,
    localDateKey,
    recommendationFor
}
