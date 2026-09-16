// Default HTTP port for local and container deployments.
const DEFAULT_PORT = 3000

const path = require('node:path')

function booleanSetting (value, name, fallback) {
    if (value === undefined || value === '') return fallback
    if (value === 'true' || value === '1') return true
    if (value === 'false' || value === '0') return false
    throw new Error(`${name} must be true or false`)
}

function positiveInteger (value, name) {
    const parsed = Number(value)

    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${name} must be a positive integer`)
    }

    return parsed
}

function loadConfig (env = process.env) {
    const port = positiveInteger(env.PORT || String(DEFAULT_PORT), 'PORT')
    const databasePath = path.resolve(
        env.DATABASE_PATH || './data/dazhi.sqlite'
    )

    return {
        port,
        databasePath,
        timezone: env.TZ || 'Asia/Taipei',
        apiBearerToken: env.API_BEARER_TOKEN || null,
        webEnabled: booleanSetting(env.WEB_ENABLED, 'WEB_ENABLED', true),
        apiEnabled: booleanSetting(env.API_ENABLED, 'API_ENABLED', true),
        openskyClientId: env.OPENSKY_CLIENT_ID || null,
        openskyClientSecret: env.OPENSKY_CLIENT_SECRET || null,
        collectorIntervalMs: positiveInteger(env.COLLECTOR_INTERVAL_MS || '30000', 'COLLECTOR_INTERVAL_MS'),
        openskyBounds: {
            lamin: Number(env.OPENSKY_LAMIN || '25.06'),
            lamax: Number(env.OPENSKY_LAMAX || '25.08'),
            lomin: Number(env.OPENSKY_LOMIN || '121.54'),
            lomax: Number(env.OPENSKY_LOMAX || '121.57')
        }
    }
}

module.exports = {
    loadConfig
}
