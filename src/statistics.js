// Historical departure statistics are independent from today's advice.
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000
const MINUTES_PER_HOUR = 60
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR
const PERCENTAGE_PRECISION = 1
const STATISTIC_RANGES = Object.freeze([7, 30, null])

function localParts (value, timezone) {
    // en-CA requests stable numeric calendar parts; timezone determines the
    // date and hour used by statistics.
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(new Date(value))
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

function buildRange ({ departures, requests, now, timezone, schedule, days }) {
    const cutoff = cutoffDateKey(now, timezone, days)
    const daily = new Map()
    const hourly = new Map(activeHourBuckets(schedule).map(bucket => [
        bucket.hour,
        {
            ...bucket,
            ...emptyCounts(),
            successfulRequests: 0,
            failedRequests: 0
        }
    ]))
    const totals = emptyCounts()

    function dayEntry (date) {
        if (!daily.has(date)) {
            daily.set(date, {
                date,
                ...emptyCounts(),
                successfulRequests: 0,
                failedRequests: 0
            })
        }
        return daily.get(date)
    }

    for (const departure of departures) {
        const parts = localParts(departure.detected_at, timezone)
        if (!withinRange(parts.date, cutoff)) continue
        addDirection(totals, departure.direction)
        addDirection(dayEntry(parts.date), departure.direction)
        const hour = hourly.get(parts.hour)
        if (hour) addDirection(hour, departure.direction)
    }

    for (const request of requests) {
        const parts = localParts(request.completed_at, timezone)
        if (!withinRange(parts.date, cutoff)) continue
        const day = dayEntry(parts.date)
        const hour = hourly.get(parts.hour)
        const key = request.state === 'ok'
            ? 'successfulRequests'
            : 'failedRequests'
        day[key]++
        if (hour) hour[key]++
    }

    const daysWithCoverage = [...daily.values()].filter(day =>
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
        requestedDays: days,
        observedFrom: coverageDates[0] ?? null,
        observedTo: coverageDates.at(-1) ?? null,
        totals: summarizeCounts(totals),
        opportunityDays: {
            westbound: daysWithWestbound,
            observed: daysWithCoverage.length,
            percentage: percentage(daysWithWestbound, daysWithCoverage.length)
        },
        daily: [...daily.values()]
            .map(day => ({ ...day, ...summarizeCounts(day) }))
            .sort((left, right) => right.date.localeCompare(left.date)),
        hourly: [...hourly.values()]
            .map(hour => ({ ...hour, ...summarizeCounts(hour) }))
    }
}

function buildHistoricalStatistics ({
    database,
    now = new Date(),
    timezone = 'Asia/Taipei',
    schedule = { start: '06:30', end: '21:00' }
}) {
    const until = now.toISOString()
    const departures = database.prepare(`
        SELECT detected_at, direction
        FROM departures
        WHERE detected_at <= ?
        ORDER BY detected_at
    `).all(until)
    const requests = database.prepare(`
        SELECT completed_at, state
        FROM collector_request_history
        WHERE completed_at <= ?
        ORDER BY completed_at
    `).all(until)
    const ranges = Object.fromEntries(STATISTIC_RANGES.map(days => [
        days === null ? 'all' : String(days),
        buildRange({ departures, requests, now, timezone, schedule, days })
    ]))

    return { timezone, ranges }
}

export {
    activeHourBuckets,
    buildHistoricalStatistics
}
