const Database = require('better-sqlite3')
const { dirname } = require('node:path')
const { mkdirSync } = require('node:fs')
const { applyMigrations } = require('./migrations')

function openDatabase (filename) {
    mkdirSync(dirname(filename), { recursive: true })

    const database = new Database(filename)
    database.pragma('journal_mode = WAL')
    database.pragma('foreign_keys = ON')
    database.pragma('busy_timeout = 5000')
    const schemaVersion = applyMigrations(database)

    return {
        database,
        schemaVersion
    }
}

module.exports = {
    openDatabase
}
