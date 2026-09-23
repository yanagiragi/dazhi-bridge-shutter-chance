import { setTimeout as delay } from 'node:timers/promises'

import { detectDepartures, storeDepartures } from './detector.js'

// Recent observations are reprocessed to detect a newly completed departure.
const DEPARTURE_LOOKBACK_MS = 15 * 60 * 1000
// Retry policy and status codes: finite retries with a short linear backoff.
const DEFAULT_MAX_RETRIES = 2
const DEFAULT_RETRY_DELAY_MS = 250
const HTTP_OK = 200
const HTTP_TOO_MANY_REQUESTS = 429
const HTTP_SERVER_ERROR_MIN = 500
const MAX_RECORDED_ERROR_LENGTH = 500

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
        state = @state,
        updated_at = @updated
    WHERE id = 1
`

const INSERT_REQUEST_HISTORY_SQL = `
    INSERT INTO collector_request_history (
        requested_at, completed_at, source, state, aircraft_count,
        stored_departures, http_status, remaining_credits, error, archive_path
    ) VALUES (
        @requestedAt, @completedAt, @source, @state, @aircraftCount,
        @storedDepartures, @httpStatus, @remainingCredits, @error, @archivePath
    )
`

function recordedError (error) {
    return String(error?.message || error)
        .slice(0, MAX_RECORDED_ERROR_LENGTH)
}

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
        source = 'opensky',
        providerArchive = null
    }) {
        this.database = database
        this.provider = provider
        this.providerArchive = providerArchive
        this.now = now
        this.maxRetries = maxRetries
        this.retryDelayMs = retryDelayMs
        this.source = source
        this.insertObservation = database.prepare(INSERT_OBSERVATION_SQL)
        this.updateRun = database.prepare(UPDATE_RUN_SQL)
        this.insertRequestHistory = database.prepare(
            INSERT_REQUEST_HISTORY_SQL
        )
        this.selectRecentObservations = database.prepare(
            'SELECT observed_at AS observedAt, icao24, callsign, ' +
            'latitude, longitude, baro_altitude AS baroAltitude, ' +
            'geo_altitude AS geoAltitude, velocity, ' +
            'true_track AS trueTrack, vertical_rate AS verticalRate, ' +
            'on_ground AS onGround FROM aircraft_observations ' +
            'WHERE observed_at >= ? AND source = ? ' +
            'ORDER BY observed_at ASC'
        )
    }

    async runOnce (params = {}) {
        let lastError

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            const requestedAt = this.now().toISOString()
            try {
                const result = await this.collect(params, requestedAt)
                this.recordRequest({
                    ...result,
                    state: 'ok',
                    httpStatus: HTTP_OK,
                    error: null
                })
                return result
            } catch (error) {
                lastError = error
                this.recordRequest({
                    requestedAt,
                    completedAt: this.now().toISOString(),
                    state: 'error',
                    aircraftCount: null,
                    storedDepartures: null,
                    httpStatus: error.status || null,
                    remainingCredits: null,
                    error: recordedError(error),
                    archivePath: null
                })
                if (!this.shouldRetry(error, attempt)) {
                    break
                }
                await delay(this.retryDelayMs * (attempt + 1))
            }
        }

        this.recordFailure(lastError)
        throw lastError
    }

    async collect (params, requestedAt = this.now().toISOString()) {
        const result = await this.provider.getAircraft(params)
        const completedAt = this.now().toISOString()
        const archivePath = result.rawResponse && this.providerArchive
            ? this.providerArchive.write({
                source: this.source,
                requestedAt,
                completedAt,
                payload: result.rawResponse
            })
            : null

        const insertMany = this.database.transaction(aircraft => {
            return aircraft
                .filter(item => item && item.icao24)
                .map(item => this.insertObservation.run({
                    ...normalizeAircraft(item, requestedAt),
                    source: this.source
                }))
        })

        insertMany(result.aircraft)
        const storedDepartures = this.processDepartures(requestedAt)
        this.updateRun.run({
            success: completedAt,
            failure: null,
            status: HTTP_OK,
            credits: result.remainingCredits,
            error: null,
            state: 'ok',
            updated: completedAt
        })

        return {
            requestedAt,
            completedAt,
            observedAt: requestedAt,
            aircraftCount: result.aircraft.length,
            count: result.aircraft.length,
            storedDepartures,
            remainingCredits: result.remainingCredits,
            archivePath
        }
    }

    processDepartures (observedAt) {
        const cutoff = new Date(
            Date.parse(observedAt) - DEPARTURE_LOOKBACK_MS
        ).toISOString()
        const states = this.selectRecentObservations.all(cutoff, this.source)
        return storeDepartures(
            this.database,
            detectDepartures(states, { observedAt }),
            this.source
        )
    }

    recordRequest ({
        requestedAt, completedAt, state, aircraftCount, storedDepartures,
        httpStatus, remainingCredits, error, archivePath
    }) {
        this.insertRequestHistory.run({
            requestedAt,
            completedAt,
            source: this.source,
            state,
            aircraftCount,
            storedDepartures,
            httpStatus,
            remainingCredits,
            error,
            archivePath
        })
    }

    recordOutsideSchedule () {
        const updatedAt = this.now().toISOString()
        this.updateRun.run({
            success: null,
            failure: null,
            status: null,
            credits: null,
            error: null,
            state: 'outside_schedule',
            updated: updatedAt
        })
        return updatedAt
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
            error: recordedError(error),
            state: 'error',
            updated: failedAt
        })
    }
}

export {
    Collector,
    normalizeAircraft
}
