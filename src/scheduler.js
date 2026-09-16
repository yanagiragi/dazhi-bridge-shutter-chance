function startScheduler ({ task, intervalMs }) {
    let running = false

    const tick = async () => {
        if (running) return

        running = true
        try {
            await task()
        } finally {
            running = false
        }
    }

    const timer = setInterval(tick, intervalMs)
    timer.unref?.()

    return {
        tick,
        stop: () => clearInterval(timer)
    }
}

module.exports = {
    startScheduler
}
