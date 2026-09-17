const test = require('node:test')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const { applyMigrations } = require('../src/migrations')
const { detectDepartures, storeDepartures } = require('../src/detector')

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
    const database = new Database(':memory:'); applyMigrations(database); const [departure] = detectDepartures(departureStates({ direction: 'westbound' })); storeDepartures(database, [departure]); storeDepartures(database, [departure]); const row = database.prepare('SELECT direction, runway_estimate, detection_confidence FROM departures').get(); assert.deepEqual(row, { direction: 'westbound', runway_estimate: '28', detection_confidence: 'high' }); database.close()
})
