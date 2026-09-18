// Converts HH:MM wall-clock values into minutes after local midnight.
const MINUTES_PER_HOUR = 60

// Schedule transitions are minute-aligned; the search covers two days so a
// daylight-saving transition cannot hide the next active minute.
const MILLISECONDS_PER_MINUTE = 60 * 1000
const MAX_SCHEDULE_SEARCH_MINUTES = 48 * MINUTES_PER_HOUR

function timeToMinutes (value) {
    const [hour, minute] = value.split(':').map(Number)
    return hour * MINUTES_PER_HOUR + minute
}

function createLocalTimeFormatter (timezone) {
    return new Intl.DateTimeFormat('en', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    })
}

function formattedTimeMinutes (date, formatter) {
    const parts = formatter.formatToParts(date)
    const values = Object.fromEntries(parts
        .filter(part => part.type !== 'literal')
        .map(part => [part.type, Number(part.value)]))
    return values.hour * MINUTES_PER_HOUR + values.minute
}

function localTimeMinutes (date, timezone) {
    return formattedTimeMinutes(date, createLocalTimeFormatter(timezone))
}

function scheduleIsActive (currentMinutes, startMinutes, endMinutes) {
    if (startMinutes < endMinutes) {
        return currentMinutes >= startMinutes && currentMinutes < endMinutes
    }

    return currentMinutes >= startMinutes || currentMinutes < endMinutes
}

function isWithinActiveWindow ({ date, timezone, start, end }) {
    return scheduleIsActive(
        localTimeMinutes(date, timezone),
        timeToMinutes(start),
        timeToMinutes(end)
    )
}

function nextActiveWindowStart ({ date, timezone, start, end }) {
    if (isWithinActiveWindow({ date, timezone, start, end })) return null

    const startMinutes = timeToMinutes(start)
    const endMinutes = timeToMinutes(end)
    const formatter = createLocalTimeFormatter(timezone)
    const firstCandidate = Math.floor(
        date.getTime() / MILLISECONDS_PER_MINUTE
    ) * MILLISECONDS_PER_MINUTE + MILLISECONDS_PER_MINUTE

    for (let offset = 0;
        offset <= MAX_SCHEDULE_SEARCH_MINUTES;
        offset++) {
        const candidate = new Date(
            firstCandidate + offset * MILLISECONDS_PER_MINUTE
        )
        if (scheduleIsActive(
            formattedTimeMinutes(candidate, formatter),
            startMinutes,
            endMinutes
        )) {
            return candidate.toISOString()
        }
    }

    throw new Error('Unable to find the next collector active window')
}

function startScheduler ({ task, intervalMs }) {
    let activePromise = null
    let stopped = false

    const tick = () => {
        if (stopped || activePromise) return activePromise

        activePromise = Promise.resolve()
            .then(task)
            .finally(() => {
                activePromise = null
            })
        return activePromise
    }

    const timer = setInterval(tick, intervalMs)
    timer.unref?.()

    return {
        tick,
        stop: async () => {
            stopped = true
            clearInterval(timer)
            await activePromise
        }
    }
}

export {
    isWithinActiveWindow,
    nextActiveWindowStart,
    localTimeMinutes,
    startScheduler,
    timeToMinutes
}
