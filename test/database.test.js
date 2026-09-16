const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')
const { openDatabase } = require('../src/database')

test('database initialization applies migrations and enables WAL', t => {
    const directory = mkdtempSync(join(tmpdir(), 'dazhi-db-'))
    const filename = join(directory, 'nested', 'dazhi.sqlite')

    t.after(() => rmSync(directory, { recursive: true, force: true }))

    const first = openDatabase(filename)
    assert.equal(first.schemaVersion, 1)
    assert.equal(first.database.pragma('journal_mode', { simple: true }), 'wal')
    const migration = first.database.prepare(
        'SELECT version, name FROM schema_migrations'
    ).get()
    assert.equal(migration.version, 1)
    assert.equal(migration.name, 'initial_schema')
    assert.equal(
        first.database.prepare(
            'SELECT COUNT(*) AS count FROM collector_runs'
        ).get().count,
        1
    )
    first.database.close()

    const second = openDatabase(filename)
    assert.equal(second.schemaVersion, 1)
    assert.equal(
        second.database.prepare(
            'SELECT COUNT(*) AS count FROM schema_migrations'
        ).get().count,
        1
    )
    second.database.close()
})
