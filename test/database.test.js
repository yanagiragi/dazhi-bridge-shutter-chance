import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { openDatabase } from '../src/database.js'

test('database initialization applies migrations and enables WAL', t => {
    const directory = mkdtempSync(join(tmpdir(), 'dazhi-db-'))
    const filename = join(directory, 'nested', 'dazhi.sqlite')

    t.after(() => rmSync(directory, { recursive: true, force: true }))

    const first = openDatabase(filename)
    assert.equal(first.schemaVersion, 4)
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
    assert.equal(
        first.database.prepare(
            'SELECT state FROM collector_runs WHERE id = 1'
        ).get().state,
        'never'
    )
    first.database.close()

    const second = openDatabase(filename)
    assert.equal(second.schemaVersion, 4)
    assert.equal(
        second.database.prepare(
            'SELECT COUNT(*) AS count FROM schema_migrations'
        ).get().count,
        4
    )
    second.database.close()
})
