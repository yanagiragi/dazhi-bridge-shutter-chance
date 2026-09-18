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
    assert.equal(payload.schemaVersion, 2)
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


test('status API returns advice and collector state', async t => {
    const directory = mkdtempSync(join(tmpdir(), 'dazhi-http-'))
    const opened = openDatabase(join(directory, 'dazhi.sqlite'))
    const now = new Date('2026-09-16T04:00:00.000Z')
    opened.database.prepare(`
        INSERT INTO departures (
            icao24, callsign, detected_at, direction, runway_estimate,
            detection_confidence, source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        'abc123', null, '2026-09-16T03:59:00.000Z', 'westbound',
        '28', 'high', 'test', now.toISOString()
    )
    opened.database.prepare(`
        UPDATE collector_runs
        SET last_success_at = ?, remaining_credits = ?, state = ?
        WHERE id = 1
    `).run('2026-09-16T03:59:30.000Z', 99, 'ok')
    const server = createServer({
        ...opened,
        timezone: 'Asia/Taipei',
        now: () => now,
        aircraftDataProvider: 'opensky'
    })

    t.after(() => {
        server.close()
        opened.database.close()
        rmSync(directory, { recursive: true, force: true })
    })
    await new Promise(resolve => server.listen(0, resolve))
    const response = await fetch(
        `http://127.0.0.1:${server.address().port}/api/v1/status`
    )

    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.advice.today.westbound, 1)
    assert.equal(payload.advice.confidence, 'low')
    assert.equal(payload.collector.remaining_credits, 99)
    assert.equal(payload.collector.state, 'ok')
    assert.equal('icao24' in payload.advice.recentDepartures[0], false)

    const configResponse = await fetch(
        'http://127.0.0.1:' + server.address().port +
            '/web-config.json'
    )
    assert.deepEqual(await configResponse.json(), {
        aircraftDataProvider: 'opensky'
    })
})

test('departures API validates limit and bearer token', async t => {
    const directory = mkdtempSync(join(tmpdir(), 'dazhi-http-'))
    const opened = openDatabase(join(directory, 'dazhi.sqlite'))
    const server = createServer({
        ...opened,
        apiToken: 'telegram-secret'
    })

    t.after(() => {
        server.close()
        opened.database.close()
        rmSync(directory, { recursive: true, force: true })
    })
    await new Promise(resolve => server.listen(0, resolve))
    const baseUrl = `http://127.0.0.1:${server.address().port}`
    const unauthorized = await fetch(`${baseUrl}/api/v1/departures`)
    assert.equal(unauthorized.status, 401)
    const invalid = await fetch(`${baseUrl}/api/v1/departures?limit=0`, {
        headers: { authorization: 'Bearer telegram-secret' }
    })
    assert.equal(invalid.status, 400)
    assert.deepEqual(await invalid.json(), {
        error: 'bad_request',
        message: 'limit must be a positive integer'
    })
})


test('dashboard serves the localized web shell', async t => {
    const directory = mkdtempSync(join(tmpdir(), 'dazhi-http-'))
    const opened = openDatabase(join(directory, 'dazhi.sqlite'))
    const server = createServer(opened)

    t.after(() => {
        server.close()
        opened.database.close()
        rmSync(directory, { recursive: true, force: true })
    })
    await new Promise(resolve => server.listen(0, resolve))
    const response = await fetch(
        `http://127.0.0.1:${server.address().port}/`
    )
    assert.equal(response.status, 200)
    const html = await response.text()
    assert.match(html, /Dazhi Bridge Flight Watch/)
    assert.match(html, /id="adsb-fi-attribution" hidden/)

    const configResponse = await fetch(
        'http://127.0.0.1:' + server.address().port +
            '/web-config.json'
    )
    assert.deepEqual(await configResponse.json(), {
        aircraftDataProvider: 'adsbfi'
    })

    const localeResponse = await fetch(
        `http://127.0.0.1:${server.address().port}/locales/zh-TW.json`
    )
    assert.equal(localeResponse.status, 200)
    assert.equal(
        (await localeResponse.json()).title,
        '大直橋拍攝機會'
    )
})


test('web and API can be disabled independently', async t => {
    const directory = mkdtempSync(join(tmpdir(), 'dazhi-http-'))
    const opened = openDatabase(join(directory, 'dazhi.sqlite'))
    const server = createServer({
        ...opened,
        webEnabled: false,
        apiEnabled: true
    })

    t.after(() => {
        server.close()
        opened.database.close()
        rmSync(directory, { recursive: true, force: true })
    })
    await new Promise(resolve => server.listen(0, resolve))
    const baseUrl = `http://127.0.0.1:${server.address().port}`
    assert.equal((await fetch(`${baseUrl}/`)).status, 404)
    assert.equal((await fetch(`${baseUrl}/api/v1/status`)).status, 200)
})
