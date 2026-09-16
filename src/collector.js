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

function normalizeAircraft (aircraft, observedAt) {
    return {
        observedAt,
        icao24: String(aircraft.icao24 || '').toLowerCase(),
        callsign: aircraft.callsign ?? null,
        longitude: aircraft.longitude ?? null,
        latitude: aircraft.latitude ?? null,
        baroAltitude: aircraft.baroAltitude ?? null,
        onGround: aircraft.onGround ? 1 : 0,
        velocity: aircraft.velocity ?? null,
        trueTrack: aircraft.trueTrack ?? null,
        verticalRate: aircraft.verticalRate ?? null,
        geoAltitude: aircraft.geoAltitude ?? null
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
        const result = await this.provider.getAircraft(params)

        const insertMany = this.database.transaction(aircraft => {
            return aircraft
                .filter(item => item && item.icao24)
                .map(item => this.insertObservation.run({
                    ...normalizeAircraft(item, observedAt),
                    source: this.source
                }))
        })

        insertMany(result.aircraft)
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
            count: result.aircraft.length,
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
    normalizeAircraft
}
