const http = require('node:http')
const { loadConfig } = require('./config')
const { openDatabase } = require('./database')
const { OpenSkyClient } = require('./opensky')
const { Collector } = require('./collector')
const { startScheduler } = require('./scheduler')
const { buildAdvice } = require('./advice')

// HTTP status codes returned by the JSON API.
const HTTP_OK = 200
const HTTP_BAD_REQUEST = 400
const HTTP_UNAUTHORIZED = 401
const HTTP_NOT_FOUND = 404

// Query limits are positive integers; callers may request at most 50 rows.
const DEFAULT_DEPARTURE_QUERY_LIMIT = 10
const MAX_DEPARTURE_QUERY_LIMIT = 50

// Fetch enough history for advice statistics while keeping each request bounded.
const DEPARTURE_QUERY_FETCH_LIMIT = 500

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

function querySnapshot (database, now, timezone, limit) {
    const departures = database.prepare(`
        SELECT icao24, callsign, detected_at, direction,
               runway_estimate, detection_confidence, source
        FROM departures
        WHERE detected_at <= ?
        ORDER BY detected_at DESC
        LIMIT ?
    `).all(now.toISOString(), DEPARTURE_QUERY_FETCH_LIMIT)
    const collectorRun = database.prepare(`
        SELECT last_success_at, last_failure_at, last_http_status,
               remaining_credits, last_error, updated_at
        FROM collector_runs
        WHERE id = 1
    `).get()

    return {
        advice: buildAdvice({
            departures,
            lastSuccessAt: collectorRun?.last_success_at ?? null,
            now,
            timezone,
            recentLimit: limit
        }),
        collector: collectorRun ?? null
    }
}

function createServer ({
    schemaVersion,
    database,
    timezone = 'Asia/Taipei',
    apiToken = null,
    now = () => new Date()
}) {
    return http.createServer((request, response) => {
        const requestUrl = new URL(request.url, 'http://localhost')
        const isApiRequest = requestUrl.pathname.startsWith('/api/v1/')

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
                    DEFAULT_DEPARTURE_QUERY_LIMIT
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
                    limit
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
    const provider = new OpenSkyClient({
        clientId: config.openskyClientId,
        clientSecret: config.openskyClientSecret
    })
    return new Collector({ database, provider })
}

function start (config = loadConfig()) {
    const opened = openDatabase(config.databasePath)
    const server = createServer({
        ...opened,
        database: opened.database,
        timezone: config.timezone,
        apiToken: config.apiBearerToken
    })
    const collector = createCollector(config, opened.database)
    const scheduler = startScheduler({
        intervalMs: config.collectorIntervalMs,
        task: () => collector.runOnce(config.openskyBounds)
            .catch(error => console.error(JSON.stringify({
                event: 'collector-error',
                message: error.message
            })))
    })

    server.on('error', error => {
        console.error(JSON.stringify({
            event: 'server-error',
            message: error.message
        }))
    })
    server.listen(config.port, () => {
        console.log(JSON.stringify({
            event: 'server-started',
            port: config.port,
            databasePath: config.databasePath,
            schemaVersion: opened.schemaVersion,
            timezone: config.timezone
        }))
    })

    function shutdown (signal) {
        console.log(JSON.stringify({ event: 'shutdown', signal }))
        scheduler.stop()
        server.close(() => opened.database.close())
    }

    process.once('SIGINT', () => shutdown('SIGINT'))
    process.once('SIGTERM', () => shutdown('SIGTERM'))
    return { server, database: opened.database, scheduler }
}

if (require.main === module) start()

module.exports = {
    createServer,
    start,
    parseLimit,
    querySnapshot
}
