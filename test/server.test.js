import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { openDatabase } from '../src/database.js'
import { createServer } from '../src/server.js'

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
    assert.equal(payload.schemaVersion, 3)
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
            detection_confidence, evidence_json, source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        'abc123', null, '2026-09-16T03:59:00.000Z', 'westbound',
        '28', 'high', JSON.stringify({
            firstSeen: '2026-09-16T03:59:00.000Z',
            lastSeen: '2026-09-16T03:59:30.000Z',
            samples: 2,
            directionSamples: 2,
            initialAltitude: 300,
            maximumAltitude: 500,
            altitudeGain: 200,
            medianVerticalRate: 6,
            longitudeDelta: -0.02,
            movement: 'climbing'
        }), 'test', now.toISOString()
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
        aircraftDataProvider: 'opensky',
        departureDetailsMode: 'summary'
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
    assert.deepEqual(payload.advice.collectionSchedule, {
        timezone: 'Asia/Taipei',
        start: '06:30',
        end: '21:00',
        date: '2026-09-16',
        nextStartAt: null
    })
    assert.equal('icao24' in payload.advice.recentDepartures[0], false)
    assert.equal(
        payload.advice.recentDepartures[0].details.altitude_gain,
        200
    )
    assert.equal(
        'track' in payload.advice.recentDepartures[0].details,
        false
    )
    assert.equal(
        'latitude' in payload.advice.recentDepartures[0].details,
        false
    )

    const configResponse = await fetch(
        'http://127.0.0.1:' + server.address().port +
        '/web-config.json'
    )
    assert.deepEqual(await configResponse.json(), {
        aircraftDataProvider: 'opensky',
        departureDetailsMode: 'summary'
    })
})

test('dashboard data supports a private historical time parameter', async t => {
    const directory = mkdtempSync(join(tmpdir(), 'dazhi-http-'))
    const opened = openDatabase(join(directory, 'dazhi.sqlite'))
    opened.database.prepare('INSERT INTO departures (icao24, callsign, detected_at, direction, runway_estimate, detection_confidence, evidence_json, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        'abc123',
        'B31988',
        '2026-09-16T03:30:00.000Z',
        'eastbound',
        '10',
        'high',
        JSON.stringify({ samples: 2, directionSamples: 2 }),
        'test',
        '2026-09-16T03:30:00.000Z'
    )
    const server = createServer({
        ...opened,
        now: () => new Date('2026-09-20T08:00:00.000Z')
    })

    t.after(() => {
        server.close()
        opened.database.close()
        rmSync(directory, { recursive: true, force: true })
    })
    await new Promise(resolve => server.listen(0, resolve))
    const baseUrl = 'http://127.0.0.1:' + server.address().port
    const historical = await fetch(
        baseUrl + '/dashboard-data.json?at=2026-09-16T04:00:00.000Z'
    )
    assert.equal(historical.status, 200)
    const payload = await historical.json()
    assert.equal(payload.advice.date, '2026-09-16')
    assert.equal(payload.advice.today.total, 1)
    assert.equal(payload.advice.recentDepartures[0].callsign, 'B31988')

    const invalid = await fetch(baseUrl + '/dashboard-data.json?at=invalid')
    assert.equal(invalid.status, 400)
})


test('status API reports the next collection time outside schedule', async t => {
    const directory = mkdtempSync(join(tmpdir(), 'dazhi-http-'))
    const opened = openDatabase(join(directory, 'dazhi.sqlite'))
    opened.database.prepare(`
        UPDATE collector_runs
        SET state = 'outside_schedule'
        WHERE id = 1
    `).run()
    const server = createServer({
        ...opened,
        now: () => new Date('2026-09-17T13:15:00.000Z'),
        collectorActiveTimeZone: 'Asia/Taipei',
        collectorActiveStart: '06:30',
        collectorActiveEnd: '21:00'
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
    const payload = await response.json()

    assert.equal(payload.advice.freshness, 'outside_schedule')
    assert.equal(
        payload.advice.collectionSchedule.nextStartAt,
        '2026-09-17T22:30:00.000Z'
    )
})

test('precise mode includes stored track points', async t => {
    const directory = mkdtempSync(join(tmpdir(), 'dazhi-http-'))
    const opened = openDatabase(join(directory, 'dazhi.sqlite'))
    const detectedAt = '2026-09-16T03:59:00.000Z'
    const result = opened.database.prepare(`
        INSERT INTO departures (
            icao24, callsign, detected_at, direction, runway_estimate,
            detection_confidence, evidence_json, source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        'abc123', 'TEST123', detectedAt, 'westbound', '28', 'medium',
        JSON.stringify({
            firstSeen: detectedAt,
            lastSeen: '2026-09-16T03:59:30.000Z',
            samples: 2,
            directionSamples: 2,
            altitudeGain: 200,
            longitudeDelta: -0.02,
            movement: 'climbing'
        }),
        'test', detectedAt
    )
    opened.database.prepare(`
        INSERT INTO departure_track_points (
            departure_id, sequence, observed_at, latitude, longitude, altitude
        ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        Number(result.lastInsertRowid), 0, detectedAt, 25.07, 121.56, 300
    )
    const server = createServer({
        ...opened,
        departureDetailsMode: 'precise',
        now: () => new Date('2026-09-16T04:00:00.000Z')
    })

    t.after(() => {
        server.close()
        opened.database.close()
        rmSync(directory, { recursive: true, force: true })
    })
    await new Promise(resolve => server.listen(0, resolve))
    const response = await fetch(
        'http://127.0.0.1:' + server.address().port + '/api/v1/status'
    )
    const departure = (await response.json()).advice.recentDepartures[0]

    assert.equal(departure.details.track.length, 1)
    assert.deepEqual(departure.details.track[0], {
        observed_at: detectedAt,
        latitude: 25.07,
        longitude: 121.56,
        altitude: 300
    })
    assert.equal('icao24' in departure, false)
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

test('dashboard data remains available when API bearer auth is enabled', async t => {
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
    const baseUrl = 'http://127.0.0.1:' + server.address().port

    const dashboard = await fetch(baseUrl + '/dashboard-data.json')
    assert.equal(dashboard.status, 200)
    assert.equal(typeof (await dashboard.json()).advice, 'object')
    assert.equal((await fetch(baseUrl + '/api/v1/status')).status, 401)
    assert.equal((await fetch(baseUrl + '/api/v1/status', {
        headers: { authorization: 'Bearer telegram-secret' }
    })).status, 200)
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
    assert.match(html, /Dazhi Bridge Shutter Chance/)
    assert.match(html, /id="adsb-fi-attribution" hidden/)
    assert.match(html, /id="theme"/)
    assert.match(html, /id="collection-status"/)
    assert.match(html, /rel="icon" href="\.\/favicon-snapshot\.svg"/)
    assert.doesNotMatch(html, /data-i18n="live"/)

    const assetBaseUrl = 'http://127.0.0.1:' + server.address().port
    const stylesResponse = await fetch(assetBaseUrl + '/styles.css')
    const styles = await stylesResponse.text()
    assert.match(styles, /data-theme=.dark./)
    assert.match(styles, /--color-page-background/)
    assert.match(styles, /track-diagram/)
    assert.match(styles, /color-status-active/)
    assert.match(styles, /departure-details-heading/)
    assert.match(
        styles,
        /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/
    )
    assert.doesNotMatch(styles, /departure-metric/)

    const scriptResponse = await fetch(assetBaseUrl + '/app.js')
    const script = await scriptResponse.text()
    assert.match(script, /createTrackDiagram/)
    assert.match(script, /departure-details/)
    assert.match(script, /hour12: true/)
    assert.match(script, /NUMERIC_CALLSIGN_PATTERN/)
    assert.match(script, /formatCollectionStatus/)
    assert.match(script, /formatScheduleRange/)
    assert.match(script, /appendCompassIndicator/)
    assert.match(
        script,
        /eastLabelX = TRACK_VIEWBOX_WIDTH - TRACK_VIEWBOX_PADDING/
    )
    assert.match(
        script,
        /x = eastLabelX - TRACK_COMPASS_LABEL_OFFSET/
    )
    assert.match(script, /flightradar24Url/)
    assert.match(script, /www\.flightradar24\.com\/data\/flights\//)
    assert.match(script, /FLIGHTRADAR24_CALLSIGN_BASE_URL/)
    assert.doesNotMatch(script, /details\.icaoOperatorCode/)
    assert.doesNotMatch(
        script,
        /details\.(?:adsbIdentifier|airline|flightInformation|runway)/
    )
    assert.ok(
        script.indexOf("'details.samples'") <
        script.indexOf("'details.observedPeriod'")
    )

    const operatorsResponse = await fetch(assetBaseUrl + '/operators.json')
    assert.equal(operatorsResponse.status, 200)
    const catalog = await operatorsResponse.json()
    assert.equal(catalog.version, 1)
    assert.equal(
        catalog.operators.some(operator => operator.code === 'CCA'),
        true
    )

    const faviconResponse = await fetch(assetBaseUrl + '/favicon-summary.svg')
    assert.equal(faviconResponse.status, 200)
    assert.equal(faviconResponse.headers.get('content-type'), 'image/svg+xml')
    const favicon = await faviconResponse.text()
    assert.match(favicon, /class="aircraft"/)
    assert.match(favicon, /rotate\(45 32 32\)/)

    const faviconModes = [
        ['favicon-summary.svg', '#dc7b81'],
        ['favicon-precise.svg', '#69b7ff'],
        ['favicon-snapshot.svg', '#A6A6A6']
    ]
    for (const [asset, color] of faviconModes) {
        const modeResponse = await fetch(assetBaseUrl + '/' + asset)
        assert.equal(modeResponse.status, 200)
        assert.match(await modeResponse.text(), new RegExp(color))
    }

    const configResponse = await fetch(
        'http://127.0.0.1:' + server.address().port +
        '/web-config.json'
    )
    assert.deepEqual(await configResponse.json(), {
        aircraftDataProvider: 'adsbfi',
        departureDetailsMode: 'summary'
    })

    const localeResponse = await fetch(
        `http://127.0.0.1:${server.address().port}/locales/zh-TW.json`
    )
    assert.equal(localeResponse.status, 200)
    assert.equal(
        (await localeResponse.json()).title,
        '大直橋拍攝機會'
    )

    const englishLocaleResponse = await fetch(
        assetBaseUrl + '/locales/en.json'
    )
    const englishLocale = await englishLocaleResponse.json()
    assert.equal(englishLocale['theme.dark'], 'Dark')
    assert.equal(englishLocale['theme.light'], 'Light')
    assert.equal(
        Object.hasOwn(englishLocale, 'details.flightInformation'),
        false
    )
    assert.equal(
        englishLocale['details.evidence'],
        'Detection evidence'
    )
    assert.equal(
        Object.hasOwn(englishLocale, 'details.adsbIdentifier'),
        false
    )
    assert.equal(
        Object.hasOwn(englishLocale, 'details.airline'),
        false
    )
    assert.equal(
        Object.hasOwn(englishLocale, 'details.runway'),
        false
    )
    assert.equal(englishLocale['details.track'], 'Simplified takeoff track')
    assert.equal(englishLocale['details.confidence'], 'Detection confidence')
    assert.equal(
        englishLocale['details.verifyOnFlightradar24'],
        'Flightradar24'
    )
    assert.equal(
        englishLocale['flight.unidentified'],
        'Unidentified aircraft'
    )
    assert.equal(
        englishLocale['collection.ended'],
        'Collection ended for today'
    )
    assert.equal(
        englishLocale['collection.collecting'],
        'Collecting now'
    )
    assert.equal(englishLocale['collection.hours'], 'Collection hours:')
})

test('operator catalog updates are served without restarting', async t => {
    const directory = mkdtempSync(join(tmpdir(), 'dazhi-http-'))
    const operatorCatalogPath = join(directory, 'operators.json')
    const opened = openDatabase(join(directory, 'dazhi.sqlite'))
    const catalog = name => ({
        version: 1,
        operators: [{
            code: 'ESR',
            iataCode: 'ES',
            locales: {
                en: { short: 'ESR', name },
                'zh-TW': { short: 'ESR', name: '測試航空' }
            }
        }]
    })
    writeFileSync(operatorCatalogPath, JSON.stringify(catalog('First name')))
    const server = createServer({ ...opened, operatorCatalogPath })

    t.after(() => {
        server.close()
        opened.database.close()
        rmSync(directory, { recursive: true, force: true })
    })
    await new Promise(resolve => server.listen(0, resolve))
    const url = `http://127.0.0.1:${server.address().port}/operators.json`

    const first = await (await fetch(url)).json()
    assert.equal(first.operators[0].locales.en.name, 'First name')

    writeFileSync(operatorCatalogPath, JSON.stringify(catalog('Updated name')))
    const updated = await (await fetch(url)).json()
    assert.equal(updated.operators[0].locales.en.name, 'Updated name')
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
    assert.equal((await fetch(baseUrl + '/dashboard-data.json')).status, 404)
    assert.equal((await fetch(`${baseUrl}/api/v1/status`)).status, 200)
})
