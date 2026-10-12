// Historical departure statistics are independent from today's advice.
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000
const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR
const PERCENTAGE_PRECISION = 1
const STATISTIC_RANGES = Object.freeze([7, 30, null])

// Intl.DateTimeFormat is expensive to construct. Reuse one formatter for each
// configured timezone instead of constructing one for every database row.
const LOCAL_PARTS_FORMATTERS = new Map()

// Keep only the latest result for each database connection. Collector writes
// change the cache key, while the local date handles an otherwise idle midnight.
const STATISTICS_CACHE = new WeakMap()

function localPartsFormatter (timezone) {
    if (!LOCAL_PARTS_FORMATTERS.has(timezone)) {
        LOCAL_PARTS_FORMATTERS.set(timezone, new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            hourCycle: 'h23'
        }))
    }
    return LOCAL_PARTS_FORMATTERS.get(timezone)
}

function localParts (value, timezone) {
    // en-CA requests stable numeric calendar parts; timezone determines the
    // date and hour used by statistics.
    const parts = localPartsFormatter(timezone).formatToParts(new Date(value))
    const values = Object.fromEntries(parts
        .filter(part => part.type !== 'literal')
        .map(part => [part.type, part.value]))
    return {
        date: `${values.year}-${values.month}-${values.day}`,
        hour: Number(values.hour)
    }
}

function cutoffDateKey (now, timezone, days) {
    if (days === null) return null
    return localParts(
        new Date(now.getTime() - (days - 1) * MILLISECONDS_PER_DAY),
        timezone
    ).date
}

function emptyCounts () {
    return { westbound: 0, eastbound: 0, unknown: 0 }
}

function addDirection (counts, direction) {
    if (Object.hasOwn(counts, direction)) counts[direction]++
}

function percentage (numerator, denominator) {
    if (denominator === 0) return null
    const factor = 10 ** PERCENTAGE_PRECISION
    return Math.round((numerator / denominator) * 100 * factor) / factor
}

function summarizeCounts (counts) {
    const directional = counts.westbound + counts.eastbound
    return {
        ...counts,
        total: directional + counts.unknown,
        directional,
        westboundPercentage: percentage(counts.westbound, directional)
    }
}

function parseClockMinutes (value) {
    const [hour, minute] = value.split(':').map(Number)
    return hour * MINUTES_PER_HOUR + minute
}

function formatClockMinutes (value) {
    if (value === MINUTES_PER_DAY) return '24:00'
    const hour = Math.floor(value / MINUTES_PER_HOUR)
    const minute = value % MINUTES_PER_HOUR
    return String(hour).padStart(2, '0') + ':' +
        String(minute).padStart(2, '0')
}

function activeHourBuckets ({ start, end }) {
    const startMinute = parseClockMinutes(start)
    const endMinute = parseClockMinutes(end)
    const windows = startMinute < endMinute
        ? [[startMinute, endMinute]]
        : [[0, endMinute], [startMinute, MINUTES_PER_DAY]]
    const buckets = []

    for (let hour = 0; hour < 24; hour++) {
        const hourStart = hour * MINUTES_PER_HOUR
        const hourEnd = hourStart + MINUTES_PER_HOUR
        for (const [windowStart, windowEnd] of windows) {
            const bucketStart = Math.max(hourStart, windowStart)
            const bucketEnd = Math.min(hourEnd, windowEnd)
            if (bucketStart >= bucketEnd) continue
            buckets.push({
                hour,
                start: formatClockMinutes(bucketStart),
                end: formatClockMinutes(bucketEnd)
            })
        }
    }
    return buckets.sort((left, right) => {
        const leftOffset = (parseClockMinutes(left.start) - startMinute +
            MINUTES_PER_DAY) % MINUTES_PER_DAY
        const rightOffset = (parseClockMinutes(right.start) - startMinute +
            MINUTES_PER_DAY) % MINUTES_PER_DAY
        return leftOffset - rightOffset
    })
}

function withinRange (dateKey, cutoff) {
    return cutoff === null || dateKey >= cutoff
}

function createRange (now, timezone, schedule, days) {
    return {
        days,
        cutoff: cutoffDateKey(now, timezone, days),
        daily: new Map(),
        hourly: new Map(activeHourBuckets(schedule).map(bucket => [
            bucket.hour,
            {
                ...bucket,
                ...emptyCounts(),
                successfulRequests: 0,
                failedRequests: 0
            }
        ])),
        totals: emptyCounts()
    }
}

function dayEntry (range, date) {
    if (!range.daily.has(date)) {
        range.daily.set(date, {
            date,
            ...emptyCounts(),
            successfulRequests: 0,
            failedRequests: 0
        })
    }
    return range.daily.get(date)
}

function addDeparture (range, departure, parts) {
    if (!withinRange(parts.date, range.cutoff)) return
    addDirection(range.totals, departure.direction)
    addDirection(dayEntry(range, parts.date), departure.direction)
    const hour = range.hourly.get(parts.hour)
    if (hour) addDirection(hour, departure.direction)
}

function addRequest (range, request, parts) {
    if (!withinRange(parts.date, range.cutoff)) return
    const day = dayEntry(range, parts.date)
    const hour = range.hourly.get(parts.hour)
    const key = request.state === 'ok'
        ? 'successfulRequests'
        : 'failedRequests'
    day[key]++
    if (hour) hour[key]++
}

function finishRange (range) {
    const daysWithCoverage = [...range.daily.values()].filter(day =>
        day.successfulRequests > 0 ||
        day.westbound + day.eastbound + day.unknown > 0
    )
    const daysWithWestbound = daysWithCoverage.filter(day =>
        day.westbound > 0
    ).length
    const coverageDates = daysWithCoverage
        .map(day => day.date)
        .sort()

    return {
        requestedDays: range.days,
        observedFrom: coverageDates[0] ?? null,
        observedTo: coverageDates.at(-1) ?? null,
        totals: summarizeCounts(range.totals),
        opportunityDays: {
            westbound: daysWithWestbound,
            observed: daysWithCoverage.length,
            percentage: percentage(daysWithWestbound, daysWithCoverage.length)
        },
        daily: [...range.daily.values()]
            .map(day => ({ ...day, ...summarizeCounts(day) }))
            .sort((left, right) => right.date.localeCompare(left.date)),
        hourly: [...range.hourly.values()]
            .map(hour => ({ ...hour, ...summarizeCounts(hour) }))
    }
}

function databaseFingerprint (database) {
    const departures = database.prepare(`
        SELECT COUNT(*) AS count, COALESCE(MAX(id), 0) AS maximumId,
               MAX(detected_at) AS latestAt
        FROM departures
    `).get()
    const requests = database.prepare(`
        SELECT COUNT(*) AS count, COALESCE(MAX(id), 0) AS maximumId,
               MAX(completed_at) AS latestAt
        FROM collector_request_history
    `).get()
    const changes = database.prepare(`
        SELECT total_changes() AS count
    `).get()

    return { departures, requests, changes: changes.count }
}

function cacheKey ({ database, now, timezone, schedule }) {
    const fingerprint = databaseFingerprint(database)
    const until = now.toISOString()
    const latestAt = [
        fingerprint.departures.latestAt,
        fingerprint.requests.latestAt
    ].filter(Boolean).sort().at(-1)
    // Historical debug queries need their exact timestamp. A live query can be
    // reused until data changes or the configured timezone reaches a new day.
    const timeKey = latestAt && until < latestAt
        ? until
        : localParts(now, timezone).date

    return JSON.stringify({
        timezone,
        schedule,
        timeKey,
        departures: fingerprint.departures,
        requests: fingerprint.requests,
        changes: fingerprint.changes
    })
}

function buildHistoricalStatistics ({
    database,
    now = new Date(),
    timezone = 'Asia/Taipei',
    schedule = { start: '06:30', end: '21:00' }
}) {
    const key = cacheKey({ database, now, timezone, schedule })
    const cached = STATISTICS_CACHE.get(database)
    if (cached?.key === key) return cached.value

    const until = now.toISOString()
    const departures = database.prepare(`
        SELECT detected_at, direction
        FROM departures
        WHERE detected_at <= ?
    `).all(until)
    const requests = database.prepare(`
        SELECT completed_at, state
        FROM collector_request_history
        WHERE completed_at <= ?
    `).all(until)
    const ranges = STATISTIC_RANGES.map(days =>
        createRange(now, timezone, schedule, days)
    )

    // Convert each timestamp to local calendar parts once, then update all
    // requested time ranges in the same pass.
    for (const departure of departures) {
        const parts = localParts(departure.detected_at, timezone)
        for (const range of ranges) addDeparture(range, departure, parts)
    }
    for (const request of requests) {
        const parts = localParts(request.completed_at, timezone)
        for (const range of ranges) addRequest(range, request, parts)
    }

    const value = {
        timezone,
        ranges: Object.fromEntries(ranges.map(range => [
            range.days === null ? 'all' : String(range.days),
            finishRange(range)
        ]))
    }
    STATISTICS_CACHE.set(database, { key, value })
    return value
}

export {
    activeHourBuckets,
    buildHistoricalStatistics
}
