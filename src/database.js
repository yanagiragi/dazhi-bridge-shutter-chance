// SQLite waits briefly for another writer before returning SQLITE_BUSY (milliseconds).
const SQLITE_BUSY_TIMEOUT_MS = 5000

const Database = require('better-sqlite3')
const { dirname } = require('node:path')
const { mkdirSync } = require('node:fs')
const { applyMigrations } = require('./migrations')

function openDatabase (filename) {
    mkdirSync(dirname(filename), { recursive: true })

    const database = new Database(filename)
    database.pragma('journal_mode = WAL')
    database.pragma('foreign_keys = ON')
    database.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`)
    const schemaVersion = applyMigrations(database)

    return {
        database,
        schemaVersion
    }
}

module.exports = {
    openDatabase
}
