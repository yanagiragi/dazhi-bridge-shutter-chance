// Default HTTP port for local and container deployments.
const DEFAULT_PORT = 3000

const path = require('node:path')

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
        timezone: env.TZ || 'Asia/Taipei'
    }
}

module.exports = {
    loadConfig
}
