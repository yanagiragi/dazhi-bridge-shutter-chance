const { setTimeout: delay } = require('node:timers/promises')

const INSERT_OBSERVATION_SQL = `
    INSERT INTO aircraft_observations (
        observed_at, icao24, callsign, latitude, longitude,
        baro_altitude, geo_altitude, velocity, true_track,
        vertical_rate, on_ground, source
    ) VALUES (
        @observedAt, @icao24, @callsign, @latitude, @longitude,
        @baroAltitude, @geoAltitude, @velocity, @trueTrack,
        @verticalRate, @onGround, @source
    )
`

const UPDATE_RUN_SQL = `
    UPDATE collector_runs
    SET last_success_at = COALESCE(@success, last_success_at),
        last_failure_at = @failure,
        last_http_status = @status,
        remaining_credits = @credits,
        last_error = @error,
        updated_at = @updated
    WHERE id = 1
`

function normalizeState (state, observedAt) {
    return {
        observedAt,
        icao24: String(state[0] || '').toLowerCase(),
        callsign: state[1] ? String(state[1]).trim() || null : null,
        longitude: state[5] ?? null,
        latitude: state[6] ?? null,
        baroAltitude: state[7] ?? null,
        onGround: state[8] ? 1 : 0,
        velocity: state[9] ?? null,
        trueTrack: state[10] ?? null,
        verticalRate: state[11] ?? null,
        geoAltitude: state[13] ?? null
    }
}

class Collector {
    constructor ({
        database,
        provider,
        now = () => new Date(),
        maxRetries = 2,
        retryDelayMs = 250,
        source = 'opensky'
    }) {
        this.database = database
        this.provider = provider
        this.now = now
        this.maxRetries = maxRetries
        this.retryDelayMs = retryDelayMs
        this.source = source
        this.insertObservation = database.prepare(INSERT_OBSERVATION_SQL)
        this.updateRun = database.prepare(UPDATE_RUN_SQL)
    }

    async runOnce (params = {}) {
        let lastError

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                return await this.collect(params)
            } catch (error) {
                lastError = error
                if (!this.shouldRetry(error, attempt)) {
                    break
                }
                await delay(this.retryDelayMs * (attempt + 1))
            }
        }

        this.recordFailure(lastError)
        throw lastError
    }

    async collect (params) {
        const observedAt = this.now().toISOString()
        const result = await this.provider.getStates(params)

        const insertMany = this.database.transaction(states => {
            return states
                .filter(state => state && state[0])
                .map(state => this.insertObservation.run({
                    ...normalizeState(state, observedAt),
                    source: this.source
                }))
        })

        insertMany(result.states)
        this.updateRun.run({
            success: observedAt,
            failure: null,
            status: 200,
            credits: result.remainingCredits,
            error: null,
            updated: observedAt
        })

        return {
            observedAt,
            count: result.states.length,
            remainingCredits: result.remainingCredits
        }
    }

    shouldRetry (error, attempt) {
        const retryable = !error.status ||
            error.status === 429 ||
            error.status >= 500

        return retryable && attempt < this.maxRetries
    }

    recordFailure (error) {
        const failedAt = this.now().toISOString()
        this.updateRun.run({
            success: null,
            failure: failedAt,
            status: error.status || null,
            credits: null,
            error: error.message.slice(0, 500),
            updated: failedAt
        })
    }
}

module.exports = {
    Collector,
    normalizeState
}
