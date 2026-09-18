// SQLite waits briefly for another writer before returning SQLITE_BUSY (milliseconds).
const SQLITE_BUSY_TIMEOUT_MS = 5000

import Database from 'better-sqlite3'
import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { applyMigrations } from './migrations.js'

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

export {
    openDatabase
}
