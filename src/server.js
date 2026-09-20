import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import http from 'node:http'
import {
    AIRCRAFT_PROVIDER_ADSB_FI,
    AIRCRAFT_PROVIDER_OPENSKY,
    DEPARTURE_DETAILS_MODE_PRECISE,
    DEFAULT_COLLECTOR_ACTIVE_END,
    DEFAULT_COLLECTOR_ACTIVE_START,
    DEFAULT_COLLECTOR_ACTIVE_TIME_ZONE,
    DEFAULT_OPERATOR_CATALOG_PATH,
    loadConfig
} from './config.js'
import { openDatabase } from './database.js'
import { OpenSkyClient } from './opensky.js'
import { AdsbFiClient } from './adsbfi.js'
import { Collector } from './collector.js'
import {
    isWithinActiveWindow,
    nextActiveWindowStart,
    startScheduler
} from './scheduler.js'
import { buildAdvice, localDateKey } from './advice.js'
import { loadOperatorCatalog } from './operator-catalog.js'
import { buildPublicSnapshot, validatePublicSnapshot } from './snapshot.js'

// HTTP status codes returned by the JSON API.
const HTTP_OK = 200
const HTTP_BAD_REQUEST = 400
const HTTP_UNAUTHORIZED = 401
const HTTP_NOT_FOUND = 404
const HTTP_INTERNAL_SERVER_ERROR = 500

// Query limits are positive integers; callers may request at most 50 rows.
const DEFAULT_DEPARTURE_QUERY_LIMIT = 10
const MAX_DEPARTURE_QUERY_LIMIT = 50

// Fetch enough history for advice statistics while keeping each request bounded.
const DEPARTURE_QUERY_FETCH_LIMIT = 500
// Static dashboard directory and its unauthenticated same-origin endpoints.
const PUBLIC_ROOT = join(fileURLToPath(new URL('../public', import.meta.url)))
const WEB_CONFIG_PATH = '/web-config.json'
const DASHBOARD_DATA_PATH = '/dashboard-data.json'

function json (response, statusCode, payload) {
    const body = JSON.stringify(payload)
    response.writeHead(statusCode, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(body)
    })
    response.end(body)
}

function parseLimit (requestUrl) {
    const raw = requestUrl.searchParams.get('limit')
    if (raw === null) return DEFAULT_DEPARTURE_QUERY_LIMIT
    if (!/^[1-9][0-9]*$/.test(raw)) {
        throw new Error('limit must be a positive integer')
    }
    const limit = Number(raw)
    if (limit > MAX_DEPARTURE_QUERY_LIMIT) {
        throw new Error(`limit must be at most ${MAX_DEPARTURE_QUERY_LIMIT}`)
    }
    return limit
}

function authorized (request, apiToken) {
    if (!apiToken) return true
    return request.headers.authorization === `Bearer ${apiToken}`
}

function parseEvidence (value) {
    if (!value) return {}

    try {
        return JSON.parse(value)
    } catch {
        return {}
    }
}

function evidenceNumber (value) {
    return Number.isFinite(value) ? value : null
}

function serializeDeparture (database, row, detailsMode) {
    const evidence = parseEvidence(row.evidence_json)
    const details = {
        observed_from: evidence.firstSeen ?? null,
        observed_to: evidence.lastSeen ?? null,
        samples: evidenceNumber(evidence.samples),
        direction_samples: evidenceNumber(evidence.directionSamples),
        initial_altitude: evidenceNumber(evidence.initialAltitude),
        maximum_altitude: evidenceNumber(evidence.maximumAltitude),
        altitude_gain: evidenceNumber(evidence.altitudeGain),
        median_vertical_rate: evidenceNumber(evidence.medianVerticalRate),
        longitude_delta: evidenceNumber(evidence.longitudeDelta),
        movement: evidence.movement ?? null
    }

    if (detailsMode === DEPARTURE_DETAILS_MODE_PRECISE) {
        details.track = database.prepare(`
            SELECT observed_at, latitude, longitude, altitude
            FROM departure_track_points
            WHERE departure_id = ?
            ORDER BY sequence
        `).all(row.id)
    }

    return {
        callsign: row.callsign,
        detected_at: row.detected_at,
        direction: row.direction,
        runway_estimate: row.runway_estimate,
        detection_confidence: row.detection_confidence,
        source: row.source,
        details
    }
}

function querySnapshot (
    database,
    now,
    timezone,
    limit,
    detailsMode,
    collectorSchedule
) {
    const departures = database.prepare(`
        SELECT id, callsign, detected_at, direction, runway_estimate,
               detection_confidence, evidence_json, source
        FROM departures
        WHERE detected_at <= ?
        ORDER BY detected_at DESC
        LIMIT ?
    `).all(now.toISOString(), DEPARTURE_QUERY_FETCH_LIMIT)
    const publicDepartures = departures.map(row =>
        serializeDeparture(database, row, detailsMode)
    )
    const collectorRun = database.prepare(`
        SELECT last_success_at, last_failure_at, last_http_status,
               remaining_credits, last_error, state, updated_at
        FROM collector_runs
        WHERE id = 1
    `).get()

    const advice = buildAdvice({
        departures: publicDepartures,
        lastSuccessAt: collectorRun?.last_success_at ?? null,
        now,
        timezone,
        collectorState: collectorRun?.state ?? null,
        recentLimit: limit
    })
    const nextStartAt = advice.freshness === 'outside_schedule'
        ? nextActiveWindowStart({
            date: now,
            ...collectorSchedule
        })
        : null

    return {
        advice: {
            ...advice,
            collectionSchedule: {
                ...collectorSchedule,
                date: localDateKey(now, collectorSchedule.timezone),
                nextStartAt
            }
        },
        collector: collectorRun ?? null
    }
}

function createServer ({
    schemaVersion,
    database,
    timezone = 'Asia/Taipei',
    apiToken = null,
    webEnabled = true,
    apiEnabled = true,
    aircraftDataProvider = AIRCRAFT_PROVIDER_ADSB_FI,
    departureDetailsMode = 'summary',
    collectorActiveTimeZone = DEFAULT_COLLECTOR_ACTIVE_TIME_ZONE,
    collectorActiveStart = DEFAULT_COLLECTOR_ACTIVE_START,
    collectorActiveEnd = DEFAULT_COLLECTOR_ACTIVE_END,
    operatorCatalogPath = DEFAULT_OPERATOR_CATALOG_PATH,
    now = () => new Date()
}) {
    const collectorSchedule = {
        timezone: collectorActiveTimeZone,
        start: collectorActiveStart,
        end: collectorActiveEnd
    }

    return http.createServer((request, response) => {
        const requestUrl = new URL(request.url, 'http://localhost')
        const isApiRequest = requestUrl.pathname.startsWith('/api/v1/')
        const staticAssets = {
            '/': ['index.html', 'text/html; charset=utf-8'],
            '/index.html': ['index.html', 'text/html; charset=utf-8'],
            '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
            '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
            '/favicon-summary.svg': ['favicon-summary.svg', 'image/svg+xml'],
            '/favicon-precise.svg': ['favicon-precise.svg', 'image/svg+xml'],
            '/favicon-snapshot.svg': ['favicon-snapshot.svg', 'image/svg+xml'],
            '/locales/en.json': [
                'locales/en.json',
                'application/json; charset=utf-8'
            ],
            '/locales/zh-TW.json': [
                'locales/zh-TW.json',
                'application/json; charset=utf-8'
            ]
        }
        const staticAsset = staticAssets[requestUrl.pathname]
        if (webEnabled && request.method === 'GET' &&
            requestUrl.pathname === WEB_CONFIG_PATH) {
            return json(response, HTTP_OK, {
                aircraftDataProvider,
                departureDetailsMode
            })
        }

        if (webEnabled && request.method === 'GET' &&
            requestUrl.pathname === '/operators.json') {
            try {
                return json(
                    response,
                    HTTP_OK,
                    loadOperatorCatalog(operatorCatalogPath)
                )
            } catch {
                return json(response, HTTP_INTERNAL_SERVER_ERROR, {
                    error: 'operator_catalog_unavailable'
                })
            }
        }

        if (webEnabled && request.method === 'GET' &&
            requestUrl.pathname === DASHBOARD_DATA_PATH) {
            try {
                const snapshot = querySnapshot(
                    database,
                    now(),
                    timezone,
                    DEFAULT_DEPARTURE_QUERY_LIMIT,
                    departureDetailsMode,
                    collectorSchedule
                )
                return json(response, HTTP_OK, snapshot)
            } catch (error) {
                return json(response, HTTP_BAD_REQUEST, {
                    error: 'bad_request',
                    message: error.message
                })
            }
        }

        if (webEnabled && request.method === 'GET' && staticAsset) {
            const body = readFileSync(join(PUBLIC_ROOT, staticAsset[0]))
            response.writeHead(HTTP_OK, {
                'content-type': staticAsset[1],
                'cache-control': 'no-cache'
            })
            response.end(body)
            return
        }


        if (isApiRequest && !apiEnabled) {
            return json(response, HTTP_NOT_FOUND, { error: 'not_found' })
        }

        if (isApiRequest && !authorized(request, apiToken)) {
            return json(response, HTTP_UNAUTHORIZED, {
                error: 'unauthorized',
                message: 'A valid bearer token is required'
            })
        }

        if (request.method === 'GET' && requestUrl.pathname === '/healthz') {
            return json(response, HTTP_OK, {
                status: 'ok',
                database: 'ok',
                schemaVersion,
                checkedAt: now().toISOString()
            })
        }

        if (request.method === 'GET' &&
            requestUrl.pathname === '/api/v1/status') {
            try {
                const snapshot = querySnapshot(
                    database,
                    now(),
                    timezone,
                    DEFAULT_DEPARTURE_QUERY_LIMIT,
                    departureDetailsMode,
                    collectorSchedule
                )
                return json(response, HTTP_OK, snapshot)
            } catch (error) {
                return json(response, HTTP_BAD_REQUEST, {
                    error: 'bad_request',
                    message: error.message
                })
            }
        }

        if (request.method === 'GET' &&
            requestUrl.pathname === '/api/v1/departures') {
            try {
                const limit = parseLimit(requestUrl)
                const snapshot = querySnapshot(
                    database,
                    now(),
                    timezone,
                    limit,
                    departureDetailsMode,
                    collectorSchedule
                )
                return json(response, HTTP_OK, {
                    ...snapshot.advice,
                    recentDepartures: snapshot.advice.recentDepartures
                })
            } catch (error) {
                return json(response, HTTP_BAD_REQUEST, {
                    error: 'bad_request',
                    message: error.message
                })
            }
        }

        return json(response, HTTP_NOT_FOUND, {
            error: 'not_found',
        })
    })
}

function createCollector (config, database) {
    let provider

    if (config.aircraftDataProvider === AIRCRAFT_PROVIDER_OPENSKY) {
        provider = new OpenSkyClient({
            clientId: config.openskyClientId,
            clientSecret: config.openskyClientSecret
        })
    } else if (config.aircraftDataProvider === AIRCRAFT_PROVIDER_ADSB_FI) {
        provider = new AdsbFiClient()
    }

    return new Collector({
        database,
        provider,
        source: config.aircraftDataProvider,
        observationRetentionDays: config.observationRetentionDays
    })
}

function collectionParams (config) {
    return config.aircraftDataProvider === AIRCRAFT_PROVIDER_ADSB_FI
        ? config.adsbFiPoint
        : config.openskyBounds
}

function structuredLog (event, details = {}) {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        event,
        ...details
    }))
}

function writeStaticSnapshot ({ database, config, now = new Date() }) {
    const serviceSnapshot = querySnapshot(
        database,
        now,
        config.timezone,
        DEFAULT_DEPARTURE_QUERY_LIMIT,
        'summary',
        {
            timezone: config.collectorActiveTimeZone,
            start: config.collectorActiveStart,
            end: config.collectorActiveEnd
        }
    )
    const snapshot = validatePublicSnapshot(buildPublicSnapshot({
        serviceSnapshot,
        generatedAt: now.toISOString(),
        provider: config.aircraftDataProvider
    }))
    mkdirSync(dirname(config.staticSnapshotPath), { recursive: true })
    const serialized = JSON.stringify(snapshot, null, 2) + '\n'
    writeFileSync(config.staticSnapshotPath, serialized)
    return snapshot
}

function createCollectionTask ({
    collector,
    config,
    now = () => new Date(),
    logger = structuredLog
}) {
    let wasActive = null

    return async () => {
        const currentTime = now()
        const active = isWithinActiveWindow({
            date: currentTime,
            timezone: config.collectorActiveTimeZone,
            start: config.collectorActiveStart,
            end: config.collectorActiveEnd
        })

        if (!active) {
            if (wasActive !== false) {
                const updatedAt = collector.recordOutsideSchedule()
                logger('collector-outside-schedule', { updatedAt })
            }
            wasActive = false
            return { state: 'outside_schedule' }
        }

        if (wasActive !== true) {
            logger('collector-active')
        }
        wasActive = true

        try {
            const result = await collector.runOnce(collectionParams(config))
            logger('collector-success', result)
            return { state: 'ok', ...result }
        } catch (error) {
            logger('collector-error', {
                message: error.message,
                status: error.status ?? null
            })
            return { state: 'error', error }
        }
    }
}

function start (config = loadConfig()) {
    const opened = openDatabase(config.databasePath)
    const server = createServer({
        ...opened,
        database: opened.database,
        timezone: config.timezone,
        apiToken: config.apiBearerToken,
        webEnabled: config.webEnabled,
        apiEnabled: config.apiEnabled,
        aircraftDataProvider: config.aircraftDataProvider,
        departureDetailsMode: config.departureDetailsMode,
        operatorCatalogPath: config.operatorCatalogPath,
        collectorActiveTimeZone: config.collectorActiveTimeZone,
        collectorActiveStart: config.collectorActiveStart,
        collectorActiveEnd: config.collectorActiveEnd
    })
    const collector = createCollector(config, opened.database)
    const collectionTask = createCollectionTask({ collector, config })
    const scheduler = startScheduler({
        intervalMs: config.collectorIntervalMs,
        task: collectionTask
    })
    let staticSnapshotTimer = null
    if (config.staticPublishEnabled) {
        const publishSnapshot = () => {
            try {
                writeStaticSnapshot({ database: opened.database, config })
            } catch (error) {
                structuredLog('snapshot-export-error', { message: error.message })
            }
        }
        publishSnapshot()
        staticSnapshotTimer = setInterval(
            publishSnapshot,
            config.staticPublishHeartbeatMinutes * 60 * 1000
        )
    }
    let shuttingDown = false

    server.on('error', error => {
        structuredLog('server-error', { message: error.message })
    })
    server.listen(config.port, () => {
        structuredLog('server-started', {
            port: config.port,
            databasePath: config.databasePath,
            operatorCatalogPath: config.operatorCatalogPath,
            schemaVersion: opened.schemaVersion,
            timezone: config.timezone,
            provider: config.aircraftDataProvider,
            activeTimeZone: config.collectorActiveTimeZone,
            activeStart: config.collectorActiveStart,
            activeEnd: config.collectorActiveEnd
        })
    })
    void scheduler.tick()

    async function shutdown (signal) {
        if (shuttingDown) return
        shuttingDown = true
        structuredLog('shutdown-started', { signal })
        await scheduler.stop()
        if (staticSnapshotTimer) clearInterval(staticSnapshotTimer)
        await new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve())
        })
        opened.database.close()
        structuredLog('shutdown-complete', { signal })
    }

    const handleSignal = signal => {
        shutdown(signal).catch(error => {
            structuredLog('shutdown-error', {
                signal,
                message: error.message
            })
            process.exitCode = 1
        })
    }
    process.once('SIGINT', () => handleSignal('SIGINT'))
    process.once('SIGTERM', () => handleSignal('SIGTERM'))
    return {
        server,
        database: opened.database,
        scheduler,
        shutdown
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) start()

export {
    createServer,
    createCollectionTask,
    start,
    parseLimit,
    querySnapshot,
    createCollector,
    collectionParams,
    writeStaticSnapshot
}
