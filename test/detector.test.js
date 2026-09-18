import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { applyMigrations } from '../src/migrations.js'
import { detectDepartures, storeDepartures } from '../src/detector.js'

function state ({
    time,
    longitude,
    altitude,
    trueTrack,
    verticalRate,
    onGround = false
}) {
    return {
        icao24: 'abc123',
        callsign: 'TEST123',
        observedAt: `2026-09-16T00:0${time}:00.000Z`,
        longitude,
        latitude: 25.07,
        baroAltitude: altitude,
        geoAltitude: altitude,
        onGround,
        trueTrack,
        verticalRate
    }
}

function departureStates ({ direction }) {
    const west = direction === 'westbound'
    const longitudes = west ? [121.60, 121.58, 121.56, 121.54] : [121.54, 121.56, 121.58, 121.60]
    const track = west ? 270 : 90
    return longitudes.map((longitude, index) => state({
        time: index,
        longitude,
        altitude: 300 + index * 300,
        trueTrack: track,
        verticalRate: 8
    }))
}

function cal261State ({
    observedAt, latitude, longitude, altitude, trueTrack, verticalRate
}) {
    return {
        icao24: '8990a1',
        callsign: 'CAL261',
        observedAt,
        latitude,
        longitude,
        baroAltitude: altitude,
        geoAltitude: altitude,
        velocity: 73,
        trueTrack,
        verticalRate,
        onGround: false
    }
}

const cal261LandingStates = [
    cal261State({
        observedAt: '2026-09-17T07:09:48.444Z',
        latitude: 25.071592,
        longitude: 121.496818,
        altitude: 274.32,
        trueTrack: 92.4,
        verticalRate: -4.22656
    }),
    cal261State({
        observedAt: '2026-09-17T07:10:18.436Z',
        latitude: 25.070801,
        longitude: 121.518739,
        altitude: 160.02,
        trueTrack: 92.45,
        verticalRate: -3.57632
    }),
    cal261State({
        observedAt: '2026-09-17T07:10:48.440Z',
        latitude: 25.070382,
        longitude: 121.530554,
        altitude: 91.44,
        trueTrack: 92.82,
        verticalRate: -2.92608
    }),
    cal261State({
        observedAt: '2026-09-17T07:11:18.441Z',
        latitude: 25.069748,
        longitude: 121.547902,
        altitude: 22.86,
        trueTrack: 92.82,
        verticalRate: 5.52704
    }),
    cal261State({
        observedAt: '2026-09-17T07:11:48.447Z',
        latitude: 25.069748,
        longitude: 121.547902,
        altitude: 22.86,
        trueTrack: null,
        verticalRate: 5.52704
    })
]

test('does not reinterpret the CAL261 landing as the window advances', () => {
    for (let startIndex = 0; startIndex < cal261LandingStates.length; startIndex++) {
        const states = cal261LandingStates.slice(startIndex)
        const observedAt = states.at(-1).observedAt

        assert.equal(
            detectDepartures(states, { observedAt }).length,
            0,
            'window starting at sample '
        )
    }
})

test('does not process a stale departure candidate', () => {
    const states = departureStates({ direction: 'eastbound' })

    assert.equal(detectDepartures(states, {
        observedAt: '2026-09-16T00:06:00.000Z'
    }).length, 0)
})

test('detects eastbound departure', () => {
    const [departure] = detectDepartures(departureStates({ direction: 'eastbound' }))
    assert.equal(departure.direction, 'eastbound')
    assert.equal(departure.detectionConfidence, 'high')
})

test('detects synthetic westbound departure using mirrored logic', () => {
    const [departure] = detectDepartures(departureStates({ direction: 'westbound' }))
    assert.equal(departure.direction, 'westbound')
    assert.equal(departure.detectionConfidence, 'high')
})

test('does not classify a climb first seen above the initial altitude limit', () => {
    const states = departureStates({ direction: 'westbound' })
        .map((item, index) => ({
            ...item,
            baroAltitude: 1600 + index * 100,
            geoAltitude: 1600 + index * 100
        }))

    assert.equal(detectDepartures(states).length, 0)
})

test('does not classify a descending overflight as departure', () => {
    const states = departureStates({ direction: 'westbound' })
        .map(item => ({ ...item, verticalRate: -4 }))
    assert.equal(detectDepartures(states).length, 0)
})

test('does not classify states without a climb rate as a departure', () => {
    const states = departureStates({ direction: 'eastbound' })
        .map(item => ({ ...item, verticalRate: null }))

    assert.equal(detectDepartures(states).length, 0)
})

test('does not classify states without positions as a departure', () => {
    const states = departureStates({ direction: 'eastbound' })
        .map(item => ({ ...item, latitude: null, longitude: null }))

    assert.equal(detectDepartures(states).length, 0)
})

test('splits a landing followed by departure', () => {
    const states = [
        ...departureStates({ direction: 'eastbound' }).map(item => ({
            ...item,
            observedAt: item.observedAt.replace('00:0', '00:1'),
            verticalRate: -4
        })),
        ...departureStates({ direction: 'westbound' })
    ]
    assert.equal(detectDepartures(states).length, 1)
    assert.equal(detectDepartures(states)[0].direction, 'westbound')
})

test('stores a departure once with runway estimate', () => {
    const database = new Database(':memory:')
    applyMigrations(database)
    const [departure] = detectDepartures(
        departureStates({ direction: 'westbound' })
    )

    assert.equal(storeDepartures(database, [departure]), 1)
    assert.equal(storeDepartures(database, [departure]), 0)
    const row = database.prepare(
        'SELECT direction, runway_estimate, detection_confidence ' +
        'FROM departures'
    ).get()
    assert.deepEqual(row, {
        direction: 'westbound',
        runway_estimate: '28',
        detection_confidence: 'high'
    })
    const points = database.prepare(`
        SELECT sequence, observed_at, latitude, longitude, altitude
        FROM departure_track_points
        ORDER BY sequence
    `).all()
    assert.equal(points.length, 4)
    assert.deepEqual(points[0], {
        sequence: 0,
        observed_at: '2026-09-16T00:00:00.000Z',
        latitude: 25.07,
        longitude: 121.6,
        altitude: 300
    })
    database.close()
})
