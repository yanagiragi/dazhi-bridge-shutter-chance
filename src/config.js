// Default HTTP port for local and container deployments.
const DEFAULT_PORT = 3000

// Supported aircraft-data providers. The value selects both client and query
// geometry; it is intentionally independent of credentials.
const AIRCRAFT_PROVIDER_OPENSKY = 'opensky'
const AIRCRAFT_PROVIDER_ADSB_FI = 'adsbfi'
const DEFAULT_AIRCRAFT_DATA_PROVIDER = AIRCRAFT_PROVIDER_OPENSKY

// Default adsb.fi point query around Songshan Airport. Distance is nautical
// miles; five NM covers departure paths while keeping each result bounded.
const DEFAULT_ADSB_FI_LATITUDE = 25.07
const DEFAULT_ADSB_FI_LONGITUDE = 121.555
const DEFAULT_ADSB_FI_DISTANCE_NM = 5

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

function finiteNumber (value, name) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
        throw new Error(`${name} must be a finite number`)
    }
    return parsed
}

function aircraftDataProvider (value) {
    const provider = (value || DEFAULT_AIRCRAFT_DATA_PROVIDER).toLowerCase()
    if (provider !== AIRCRAFT_PROVIDER_OPENSKY &&
        provider !== AIRCRAFT_PROVIDER_ADSB_FI) {
        throw new Error(
            'AIRCRAFT_DATA_PROVIDER must be opensky or adsbfi'
        )
    }
    return provider
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
        aircraftDataProvider: aircraftDataProvider(
            env.AIRCRAFT_DATA_PROVIDER
        ),
        openskyClientId: env.OPENSKY_CLIENT_ID || null,
        openskyClientSecret: env.OPENSKY_CLIENT_SECRET || null,
        collectorIntervalMs: positiveInteger(
            env.COLLECTOR_INTERVAL_MS || '30000',
            'COLLECTOR_INTERVAL_MS'
        ),
        openskyBounds: {
            lamin: finiteNumber(env.OPENSKY_LAMIN || '25.06', 'OPENSKY_LAMIN'),
            lamax: finiteNumber(env.OPENSKY_LAMAX || '25.08', 'OPENSKY_LAMAX'),
            lomin: finiteNumber(env.OPENSKY_LOMIN || '121.54', 'OPENSKY_LOMIN'),
            lomax: finiteNumber(env.OPENSKY_LOMAX || '121.57', 'OPENSKY_LOMAX')
        },
        adsbFiPoint: {
            latitude: finiteNumber(
                env.ADSB_FI_LATITUDE || String(DEFAULT_ADSB_FI_LATITUDE),
                'ADSB_FI_LATITUDE'
            ),
            longitude: finiteNumber(
                env.ADSB_FI_LONGITUDE || String(DEFAULT_ADSB_FI_LONGITUDE),
                'ADSB_FI_LONGITUDE'
            ),
            distanceNm: positiveInteger(
                env.ADSB_FI_DISTANCE_NM || String(DEFAULT_ADSB_FI_DISTANCE_NM),
                'ADSB_FI_DISTANCE_NM'
            )
        }
    }
}

module.exports = {
    AIRCRAFT_PROVIDER_ADSB_FI,
    AIRCRAFT_PROVIDER_OPENSKY,
    aircraftDataProvider,
    loadConfig
}
