// Converts HH:MM wall-clock values into minutes after local midnight.
const MINUTES_PER_HOUR = 60

function timeToMinutes (value) {
    const [hour, minute] = value.split(':').map(Number)
    return hour * MINUTES_PER_HOUR + minute
}

function localTimeMinutes (date, timezone) {
    const parts = new Intl.DateTimeFormat('en', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(date)
    const values = Object.fromEntries(parts
        .filter(part => part.type !== 'literal')
        .map(part => [part.type, Number(part.value)]))
    return values.hour * MINUTES_PER_HOUR + values.minute
}

function isWithinActiveWindow ({ date, timezone, start, end }) {
    const currentMinutes = localTimeMinutes(date, timezone)
    const startMinutes = timeToMinutes(start)
    const endMinutes = timeToMinutes(end)

    if (startMinutes < endMinutes) {
        return currentMinutes >= startMinutes && currentMinutes < endMinutes
    }

    return currentMinutes >= startMinutes || currentMinutes < endMinutes
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

module.exports = {
    isWithinActiveWindow,
    localTimeMinutes,
    startScheduler,
    timeToMinutes
}
