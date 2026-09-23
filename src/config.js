import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Default HTTP port for local and container deployments.
const DEFAULT_PORT = 3000

// Supported aircraft-data providers. The value selects both client and query
// geometry; it is intentionally independent of credentials.
const AIRCRAFT_PROVIDER_OPENSKY = 'opensky'
const AIRCRAFT_PROVIDER_ADSB_FI = 'adsbfi'
const DEFAULT_AIRCRAFT_DATA_PROVIDER = AIRCRAFT_PROVIDER_ADSB_FI

// Default adsb.fi point query around Songshan Airport. Distance is nautical
// miles; five NM covers departure paths while keeping each result bounded.
const DEFAULT_ADSB_FI_LATITUDE = 25.07
const DEFAULT_ADSB_FI_LONGITUDE = 121.555
const DEFAULT_ADSB_FI_DISTANCE_NM = 5

// Collector schedule defaults use local wall-clock time in the configured zone.
const DEFAULT_COLLECTOR_ACTIVE_TIME_ZONE = 'Asia/Taipei'
const DEFAULT_COLLECTOR_ACTIVE_START = '06:30'
const DEFAULT_COLLECTOR_ACTIVE_END = '21:00'

// Departure-detail modes control whether exact track coordinates leave the
// server. Summary is safe for public deployments; precise is for private use.
const DEPARTURE_DETAILS_MODE_SUMMARY = 'summary'
const DEPARTURE_DETAILS_MODE_PRECISE = 'precise'
const DEFAULT_DEPARTURE_DETAILS_MODE = DEPARTURE_DETAILS_MODE_SUMMARY

// Static snapshot export is opt-in; output can be bind-mounted to a host publisher.
const DEFAULT_STATIC_PUBLISH_ENABLED = false
const DEFAULT_STATIC_SNAPSHOT_PATH = path.resolve('./runtime/pages/status.json')
const DEFAULT_STATIC_PUBLISH_HEARTBEAT_MINUTES = 30

// Bundled operator names are the local-development default. Deployments may
// point this at a read-only mounted catalog to update names without rebuilding.
const DEFAULT_OPERATOR_CATALOG_PATH = path.join(
    __dirname,
    '..',
    'config',
    'operators.json'
)

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

function timeSetting (value, name) {
    const valid = value.length === 5 &&
        /^(?:[01][0-9]|2[0-3]):[0-5][0-9]/.test(value)
    if (!valid) {
        throw new Error(name + ' must use HH:MM in 24-hour time')
    }
    return value
}

function timezoneSetting (value, name) {
    try {
        new Intl.DateTimeFormat('en', { timeZone: value }).format()
    } catch {
        throw new Error(name + ' must be a valid IANA timezone')
    }
    return value
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

function departureDetailsMode (value) {
    const mode = (value || DEFAULT_DEPARTURE_DETAILS_MODE).toLowerCase()
    if (mode !== DEPARTURE_DETAILS_MODE_SUMMARY &&
        mode !== DEPARTURE_DETAILS_MODE_PRECISE) {
        throw new Error(
            'DEPARTURE_DETAILS_MODE must be summary or precise'
        )
    }
    return mode
}

function loadConfig (env = process.env) {
    const port = positiveInteger(env.PORT || String(DEFAULT_PORT), 'PORT')
    const databasePath = path.resolve(
        env.DATABASE_PATH || './data/dazhi.sqlite'
    )
    const providerArchivePath = path.resolve(
        env.PROVIDER_ARCHIVE_PATH ||
            path.join(path.dirname(databasePath), 'provider-archive')
    )
    const operatorCatalogPath = path.resolve(
        env.OPERATOR_CATALOG_PATH || DEFAULT_OPERATOR_CATALOG_PATH
    )

    return {
        port,
        databasePath,
        providerArchivePath,
        operatorCatalogPath,
        timezone: env.TZ || 'Asia/Taipei',
        apiBearerToken: env.API_BEARER_TOKEN || null,
        webEnabled: booleanSetting(env.WEB_ENABLED, 'WEB_ENABLED', true),
        staticPublishEnabled: booleanSetting(
            env.STATIC_PUBLISH_ENABLED, 'STATIC_PUBLISH_ENABLED',
            DEFAULT_STATIC_PUBLISH_ENABLED
        ),
        staticSnapshotPath: path.resolve(
            env.STATIC_SNAPSHOT_PATH || DEFAULT_STATIC_SNAPSHOT_PATH
        ),
        staticPublishHeartbeatMinutes: positiveInteger(
            env.STATIC_PUBLISH_HEARTBEAT_MINUTES ||
                String(DEFAULT_STATIC_PUBLISH_HEARTBEAT_MINUTES),
            'STATIC_PUBLISH_HEARTBEAT_MINUTES'
        ),
        apiEnabled: booleanSetting(env.API_ENABLED, 'API_ENABLED', true),
        departureDetailsMode: departureDetailsMode(
            env.DEPARTURE_DETAILS_MODE
        ),
        aircraftDataProvider: aircraftDataProvider(
            env.AIRCRAFT_DATA_PROVIDER
        ),
        openskyClientId: env.OPENSKY_CLIENT_ID || null,
        openskyClientSecret: env.OPENSKY_CLIENT_SECRET || null,
        collectorIntervalMs: positiveInteger(
            env.COLLECTOR_INTERVAL_MS || '30000',
            'COLLECTOR_INTERVAL_MS'
        ),
        collectorActiveTimeZone: timezoneSetting(
            env.COLLECTOR_ACTIVE_TIME_ZONE ||
                DEFAULT_COLLECTOR_ACTIVE_TIME_ZONE,
            'COLLECTOR_ACTIVE_TIME_ZONE'
        ),
        collectorActiveStart: timeSetting(
            env.COLLECTOR_ACTIVE_START || DEFAULT_COLLECTOR_ACTIVE_START,
            'COLLECTOR_ACTIVE_START'
        ),
        collectorActiveEnd: timeSetting(
            env.COLLECTOR_ACTIVE_END || DEFAULT_COLLECTOR_ACTIVE_END,
            'COLLECTOR_ACTIVE_END'
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

export {
    AIRCRAFT_PROVIDER_ADSB_FI,
    AIRCRAFT_PROVIDER_OPENSKY,
    DEPARTURE_DETAILS_MODE_PRECISE,
    DEPARTURE_DETAILS_MODE_SUMMARY,
    DEFAULT_COLLECTOR_ACTIVE_END,
    DEFAULT_COLLECTOR_ACTIVE_START,
    DEFAULT_COLLECTOR_ACTIVE_TIME_ZONE,
    DEFAULT_OPERATOR_CATALOG_PATH,
    DEFAULT_STATIC_PUBLISH_ENABLED,
    DEFAULT_STATIC_SNAPSHOT_PATH,
    DEFAULT_STATIC_PUBLISH_HEARTBEAT_MINUTES,
    aircraftDataProvider,
    departureDetailsMode,
    loadConfig
}
