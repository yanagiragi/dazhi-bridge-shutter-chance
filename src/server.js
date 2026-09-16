// HTTP response codes used by the built-in server.
const HTTP_OK = 200
const HTTP_NOT_FOUND = 404

const http = require('node:http')
const { loadConfig } = require('./config')
const { openDatabase } = require('./database')
const { OpenSkyClient } = require('./opensky')
const { Collector } = require('./collector')
const { startScheduler } = require('./scheduler')

function json (response, statusCode, payload) {
    const body = JSON.stringify(payload)

    response.writeHead(statusCode, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(body)
    })
    response.end(body)
}

function createServer ({ schemaVersion, now = () => new Date() }) {
    return http.createServer((request, response) => {
        const requestUrl = new URL(request.url, 'http://localhost')

        if (request.method === 'GET' && requestUrl.pathname === '/healthz') {
            return json(response, HTTP_OK, {
                status: 'ok',
                database: 'ok',
                schemaVersion,
                checkedAt: now().toISOString()
            })
        }

        return json(response, HTTP_NOT_FOUND, {
            error: 'not_found'
        })
    })
}

function createCollector (config, database) {
    const provider = new OpenSkyClient({
        clientId: config.openskyClientId,
        clientSecret: config.openskyClientSecret
    })

    return new Collector({
        database,
        provider
    })
}

function start (config = loadConfig()) {
    const opened = openDatabase(config.databasePath)
    const server = createServer(opened)
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
        server.close(() => {
            opened.database.close()
        })
    }

    process.once('SIGINT', () => shutdown('SIGINT'))
    process.once('SIGTERM', () => shutdown('SIGTERM'))

    return {
        server,
        database: opened.database,
        scheduler
    }
}

if (require.main === module) {
    start()
}

module.exports = {
    createServer,
    start
}
