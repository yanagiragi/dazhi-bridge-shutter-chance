// OpenSky state-vector indexes (defined by the REST API response schema).
const STATE_ICAO24 = 0
const STATE_CALLSIGN = 1
const STATE_LONGITUDE = 5
const STATE_LATITUDE = 6
const STATE_BARO_ALTITUDE = 7
const STATE_ON_GROUND = 8
const STATE_VELOCITY = 9
const STATE_TRUE_TRACK = 10
const STATE_VERTICAL_RATE = 11
const STATE_GEO_ALTITUDE = 13

// Retry policy and status codes: finite retries with a short linear backoff.
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_RETRY_DELAY_MS = 250
const HTTP_OK = 200
const HTTP_TOO_MANY_REQUESTS = 429
const HTTP_SERVER_ERROR_MIN = 500
const MAX_RECORDED_ERROR_LENGTH = 500

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
        icao24: String(state[STATE_ICAO24] || '').toLowerCase(),
        callsign: state[STATE_CALLSIGN] ? String(state[STATE_CALLSIGN]).trim() || null : null,
        longitude: state[STATE_LONGITUDE] ?? null,
        latitude: state[STATE_LATITUDE] ?? null,
        baroAltitude: state[STATE_BARO_ALTITUDE] ?? null,
        onGround: state[STATE_ON_GROUND] ? 1 : 0,
        velocity: state[STATE_VELOCITY] ?? null,
        trueTrack: state[STATE_TRUE_TRACK] ?? null,
        verticalRate: state[STATE_VERTICAL_RATE] ?? null,
        geoAltitude: state[STATE_GEO_ALTITUDE] ?? null
    }
}

class Collector {
    constructor ({
        database,
        provider,
        now = () => new Date(),
        maxRetries = DEFAULT_MAX_RETRIES,
        retryDelayMs = DEFAULT_RETRY_DELAY_MS,
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
                .filter(state => state && state[STATE_ICAO24])
                .map(state => this.insertObservation.run({
                    ...normalizeState(state, observedAt),
                    source: this.source
                }))
        })

        insertMany(result.states)
        this.updateRun.run({
            success: observedAt,
            failure: null,
            status: HTTP_OK,
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
            error.status === HTTP_TOO_MANY_REQUESTS ||
            error.status >= HTTP_SERVER_ERROR_MIN

        return retryable && attempt < this.maxRetries
    }

    recordFailure (error) {
        const failedAt = this.now().toISOString()
        this.updateRun.run({
            success: null,
            failure: failedAt,
            status: error.status || null,
            credits: null,
            error: error.message.slice(0, MAX_RECORDED_ERROR_LENGTH),
            updated: failedAt
        })
    }
}

module.exports = {
    Collector,
    normalizeState
}
