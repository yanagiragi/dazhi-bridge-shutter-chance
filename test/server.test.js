const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')
const { openDatabase } = require('../src/database')
const { createServer } = require('../src/server')

test('health endpoint reports database and schema status', async t => {
    const directory = mkdtempSync(join(tmpdir(), 'dazhi-http-'))
    const opened = openDatabase(join(directory, 'dazhi.sqlite'))
    const server = createServer(opened)

    t.after(() => {
        server.close()
        opened.database.close()
        rmSync(directory, { recursive: true, force: true })
    })

    await new Promise(resolve => server.listen(0, resolve))
    const address = server.address()
    const response = await fetch(`http://127.0.0.1:${address.port}/healthz`)

    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.status, 'ok')
    assert.equal(payload.database, 'ok')
    assert.equal(payload.schemaVersion, 1)
    assert.match(payload.checkedAt, /^\d{4}-\d{2}-\d{2}T/)
})

test('unknown endpoint returns JSON 404', async t => {
    const directory = mkdtempSync(join(tmpdir(), 'dazhi-http-'))
    const opened = openDatabase(join(directory, 'dazhi.sqlite'))
    const server = createServer(opened)

    t.after(() => {
        server.close()
        opened.database.close()
        rmSync(directory, { recursive: true, force: true })
    })

    await new Promise(resolve => server.listen(0, resolve))
    const address = server.address()
    const response = await fetch(`http://127.0.0.1:${address.port}/unknown`)

    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), { error: 'not_found' })
})
