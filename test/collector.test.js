const test = require('node:test')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const { AdsbFiClient } = require('../src/adsbfi')
const { applyMigrations } = require('../src/migrations')
const { Collector } = require('../src/collector')
const { loadConfig } = require('../src/config')
const { OpenSkyClient } = require('../src/opensky')
const { collectionParams } = require('../src/server')

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
})

test('scheduler never overlaps tasks', async () => {
    const { startScheduler } = require('../src/scheduler')
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
    scheduler.stop()

    assert.equal(max, 1)
})
