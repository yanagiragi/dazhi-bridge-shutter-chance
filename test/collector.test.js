import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { AdsbFiClient } from '../src/adsbfi.js'
import { applyMigrations } from '../src/migrations.js'
import { Collector } from '../src/collector.js'
import { loadConfig } from '../src/config.js'
import { OpenSkyClient } from '../src/opensky.js'
import {
    isWithinActiveWindow,
    nextActiveWindowStart,
    startScheduler
} from '../src/scheduler.js'
import { collectionParams, createCollectionTask } from '../src/server.js'

test('OpenSky client caches token and returns canonical aircraft', async () => {
    let calls = 0
    const client = new OpenSkyClient({
        clientId: 'id',
        clientSecret: 'secret',
        baseUrl: 'https://api.test',
        tokenUrl: 'https://auth.test/token',
        fetchImpl: async url => {
            calls++
            if (String(url) === 'https://auth.test/token') {
                return new Response(JSON.stringify({
                    access_token: 'token',
                    expires_in: 300
                }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' }
                })
            }
            return new Response(JSON.stringify({
                states: [[
                    'ABC123', ' TEST ', null, 1, null, 121.55, 25.07,
                    100, false, 200, 270, 2, null, 110
                ]]
            }), {
                status: 200,
                headers: { 'x-rate-limit-remaining': '42' }
            })
        }
    })

    const result = await client.getAircraft({ lamin: 25 })

    assert.equal(result.remainingCredits, 42)
    assert.deepEqual(result.aircraft[0], {
        icao24: 'abc123',
        callsign: 'TEST',
        longitude: 121.55,
        latitude: 25.07,
        baroAltitude: 100,
        geoAltitude: 110,
        velocity: 200,
        trueTrack: 270,
        verticalRate: 2,
        onGround: 0
    })
    assert.equal(calls, 2)
})

test('adsb.fi client queries a point and converts imperial values', async () => {
    let requestedUrl
    const client = new AdsbFiClient({
        baseUrl: 'https://api.test/v3',
        fetchImpl: async url => {
            requestedUrl = String(url)
            return new Response(JSON.stringify({
                ac: [{
                    hex: 'ABC123',
                    flight: ' TEST123 ',
                    lat: 25.07,
                    lon: 121.55,
                    alt_baro: 1000,
                    alt_geom: 1100,
                    gs: 100,
                    track: 270,
                    baro_rate: 600
                }, {
                    hex: 'DEF456',
                    alt_baro: 'ground'
                }]
            }), { status: 200 })
        }
    })

    const result = await client.getAircraft({
        latitude: 25.07,
        longitude: 121.555,
        distanceNm: 5
    })

    assert.equal(
        requestedUrl,
        'https://api.test/v3/lat/25.07/lon/121.555/dist/5'
    )
    assert.deepEqual(result.aircraft[0], {
        icao24: 'abc123',
        callsign: 'TEST123',
        longitude: 121.55,
        latitude: 25.07,
        baroAltitude: 304.8,
        geoAltitude: 335.28000000000003,
        velocity: 51.4444,
        trueTrack: 270,
        verticalRate: 3.048,
        onGround: 0
    })
    assert.deepEqual(result.aircraft[1], {
        icao24: 'def456',
        callsign: null,
        longitude: null,
        latitude: null,
        baroAltitude: null,
        geoAltitude: null,
        velocity: null,
        trueTrack: null,
        verticalRate: null,
        onGround: 1
    })
    assert.equal(result.rawResponse.ac.length, 2)
    assert.equal(result.rawResponse.ac[0].flight, ' TEST123 ')
})

test('collector retries 429 and records canonical observations', async () => {
    const database = new Database(':memory:')
    applyMigrations(database)
    let attempts = 0
    const provider = {
        async getAircraft () {
            attempts++
            if (attempts === 1) {
                const error = new Error('rate limited')
                error.status = 429
                throw error
            }
            return {
                aircraft: [{
                    icao24: 'abc',
                    callsign: 'CALL',
                    longitude: 121.55,
                    latitude: 25.07,
                    baroAltitude: 100,
                    geoAltitude: 110,
                    velocity: 200,
                    trueTrack: 280,
                    verticalRate: 3,
                    onGround: 1
                }],
                remainingCredits: 9
            }
        }
    }
    const collector = new Collector({
        database,
        provider,
        retryDelayMs: 1,
        now: () => new Date('2026-09-16T01:02:03Z')
    })

    const result = await collector.runOnce()

    assert.equal(result.count, 1)
    assert.equal(attempts, 2)
    assert.equal(
        database.prepare(
            'SELECT count(*) AS count FROM aircraft_observations'
        ).get().count,
        1
    )
    assert.equal(
        database.prepare(
            'SELECT remaining_credits FROM collector_runs'
        ).get().remaining_credits,
        9
    )
    const history = database.prepare(`
        SELECT state, http_status
        FROM collector_request_history
        ORDER BY id
    `).all()
    assert.deepEqual(history, [
        { state: 'error', http_status: 429 },
        { state: 'ok', http_status: 200 }
    ])
    database.close()
})

test('collector detects departures and retains old observations', async () => {
    const database = new Database(':memory:')
    applyMigrations(database)
    database.prepare(
        'INSERT INTO aircraft_observations ' +
        '(observed_at, icao24, on_ground, source) VALUES (?, ?, ?, ?)'
    ).run('2026-09-01T00:00:00.000Z', 'old001', 0, 'adsbfi')

    let currentTime = new Date('2026-09-16T04:00:00.000Z')
    let sample = 0
    const provider = {
        async getAircraft () {
            const longitude = 121.54 + sample * 0.01
            const altitude = 300 + sample * 200
            sample++
            return {
                aircraft: [{
                    icao24: 'abc123',
                    callsign: 'TEST123',
                    latitude: 25.07,
                    longitude,
                    baroAltitude: altitude,
                    geoAltitude: altitude,
                    velocity: 80,
                    trueTrack: 90,
                    verticalRate: 5,
                    onGround: 0
                }],
                remainingCredits: null
            }
        }
    }
    const collector = new Collector({
        database,
        provider,
        source: 'adsbfi',
        now: () => currentTime,
        logger: () => {}
    })

    await collector.runOnce()
    currentTime = new Date('2026-09-16T04:00:30.000Z')
    const second = await collector.runOnce()
    currentTime = new Date('2026-09-16T04:01:00.000Z')
    const third = await collector.runOnce()

    assert.equal(
        database.prepare('SELECT COUNT(*) AS count FROM aircraft_observations WHERE icao24 = ?')
            .get('old001').count,
        1
    )
    assert.equal(second.storedDepartures, 1)
    assert.equal(third.storedDepartures, 0)
    assert.equal(
        database.prepare('SELECT count(*) AS count FROM departures').get().count,
        1
    )
    const storedDeparture = database.prepare(
        'SELECT detection_confidence, evidence_json FROM departures'
    ).get()
    assert.equal(storedDeparture.detection_confidence, 'high')
    assert.equal(JSON.parse(storedDeparture.evidence_json).directionSamples, 3)
    assert.equal(
        database.prepare(
            'SELECT COUNT(*) AS count FROM departure_track_points'
        ).get().count,
        3
    )
    assert.equal(
        database.prepare('SELECT state FROM collector_runs').get().state,
        'ok'
    )
    database.close()
})

test('collector recovers from a provider failure on a later poll', async () => {
    const database = new Database(':memory:')
    applyMigrations(database)
    let failing = true
    const provider = {
        async getAircraft () {
            if (failing) {
                const error = new Error('temporary outage')
                error.status = 503
                throw error
            }
            return { aircraft: [], remainingCredits: null }
        }
    }
    const collector = new Collector({
        database,
        provider,
        maxRetries: 0
    })

    await assert.rejects(collector.runOnce(), /temporary outage/)
    assert.equal(
        database.prepare('SELECT state FROM collector_runs').get().state,
        'error'
    )

    failing = false
    await collector.runOnce()
    assert.equal(
        database.prepare('SELECT state FROM collector_runs').get().state,
        'ok'
    )
    database.close()
})

test('configuration selects provider-specific query geometry', () => {
    const defaultConfig = loadConfig({})
    const adsbFiConfig = loadConfig({
        AIRCRAFT_DATA_PROVIDER: 'adsbfi',
        ADSB_FI_LATITUDE: '25.1',
        ADSB_FI_LONGITUDE: '121.6',
        ADSB_FI_DISTANCE_NM: '3'
    })
    const openSkyConfig = loadConfig({ AIRCRAFT_DATA_PROVIDER: 'opensky' })

    assert.equal(defaultConfig.aircraftDataProvider, 'adsbfi')
    assert.equal(defaultConfig.collectorActiveTimeZone, 'Asia/Taipei')
    assert.equal(defaultConfig.collectorActiveStart, '06:30')
    assert.equal(defaultConfig.collectorActiveEnd, '21:00')
    assert.match(defaultConfig.providerArchivePath,
        /data\/provider-archive$/)
    assert.equal(defaultConfig.departureDetailsMode, 'summary')
    assert.match(defaultConfig.operatorCatalogPath, /config\/operators\.json$/)
    assert.equal(
        loadConfig({ OPERATOR_CATALOG_PATH: './custom-operators.json' })
            .operatorCatalogPath,
        join(process.cwd(), 'custom-operators.json')
    )
    assert.deepEqual(collectionParams(adsbFiConfig), {
        latitude: 25.1,
        longitude: 121.6,
        distanceNm: 3
    })
    assert.deepEqual(collectionParams(openSkyConfig), openSkyConfig.openskyBounds)
    assert.throws(
        () => loadConfig({ AIRCRAFT_DATA_PROVIDER: 'unknown' }),
        /must be opensky or adsbfi/
    )
    assert.throws(
        () => loadConfig({ COLLECTOR_ACTIVE_START: '6:30' }),
        /must use HH:MM/
    )
    assert.throws(
        () => loadConfig({ COLLECTOR_ACTIVE_TIME_ZONE: 'Mars/Base' }),
        /must be a valid IANA timezone/
    )
    assert.equal(
        loadConfig({ DEPARTURE_DETAILS_MODE: 'precise' })
            .departureDetailsMode,
        'precise'
    )
    assert.throws(
        () => loadConfig({ DEPARTURE_DETAILS_MODE: 'hidden' }),
        /must be summary or precise/
    )
})

test('active window uses Taipei time and excludes the end boundary', () => {
    const schedule = {
        timezone: 'Asia/Taipei',
        start: '06:30',
        end: '21:00'
    }

    assert.equal(isWithinActiveWindow({
        ...schedule,
        date: new Date('2026-09-16T22:29:00.000Z')
    }), false)
    assert.equal(isWithinActiveWindow({
        ...schedule,
        date: new Date('2026-09-16T22:30:00.000Z')
    }), true)
    assert.equal(isWithinActiveWindow({
        ...schedule,
        date: new Date('2026-09-17T13:00:00.000Z')
    }), false)
})

test('next active window supports daytime and overnight schedules', () => {
    assert.equal(nextActiveWindowStart({
        date: new Date('2026-09-17T13:00:00.000Z'),
        timezone: 'Asia/Taipei',
        start: '06:30',
        end: '21:00'
    }), '2026-09-17T22:30:00.000Z')
    assert.equal(nextActiveWindowStart({
        date: new Date('2026-09-17T04:00:00.000Z'),
        timezone: 'Asia/Taipei',
        start: '21:00',
        end: '06:30'
    }), '2026-09-17T13:00:00.000Z')
    assert.equal(nextActiveWindowStart({
        date: new Date('2026-09-17T14:00:00.000Z'),
        timezone: 'Asia/Taipei',
        start: '21:00',
        end: '06:30'
    }), null)
})

test('collection task polls immediately when active and records one pause transition', async () => {
    let currentTime = new Date('2026-09-16T22:29:00.000Z')
    let collections = 0
    let pauses = 0
    const collector = {
        recordOutsideSchedule () {
            pauses++
            return currentTime.toISOString()
        },
        async runOnce () {
            collections++
            return { count: 0 }
        }
    }
    const config = {
        collectorActiveTimeZone: 'Asia/Taipei',
        collectorActiveStart: '06:30',
        collectorActiveEnd: '21:00',
        aircraftDataProvider: 'adsbfi',
        adsbFiPoint: {}
    }
    const task = createCollectionTask({
        collector,
        config,
        now: () => currentTime,
        logger: () => {}
    })

    await task()
    await task()
    assert.equal(pauses, 1)
    assert.equal(collections, 0)

    currentTime = new Date('2026-09-16T22:30:00.000Z')
    await task()
    assert.equal(collections, 1)
})

test('scheduler never overlaps tasks', async () => {
    let active = 0
    let max = 0
    const scheduler = startScheduler({
        intervalMs: 5,
        task: async () => {
            active++
            max = Math.max(max, active)
            await new Promise(resolve => setTimeout(resolve, 20))
            active--
        }
    })

    await scheduler.tick()
    await new Promise(resolve => setTimeout(resolve, 30))
    await scheduler.stop()

    assert.equal(max, 1)
    assert.equal(active, 0)
})
