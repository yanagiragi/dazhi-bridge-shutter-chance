import test from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { applyMigrations } from '../src/migrations.js'
import { buildHistoricalStatistics } from '../src/statistics.js'

function insertDeparture (database, detectedAt, direction) {
    database.prepare(`
        INSERT INTO departures (
            icao24, callsign, detected_at, direction, detection_confidence,
            source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('abc123', 'TEST1', detectedAt, direction, 'high', 'adsbfi', detectedAt)
}

function insertRequest (database, completedAt, state = 'ok') {
    database.prepare(`
        INSERT INTO collector_request_history (
            requested_at, completed_at, source, state
        ) VALUES (?, ?, ?, ?)
    `).run(completedAt, completedAt, 'adsbfi', state)
}

test('historical statistics aggregate ranges, days, and local clock hours', () => {
    const database = new Database(':memory:')
    applyMigrations(database)

    insertDeparture(database, '2026-09-23T06:30:00.000Z', 'westbound')
    insertDeparture(database, '2026-09-23T06:40:00.000Z', 'eastbound')
    insertDeparture(database, '2026-09-23T07:00:00.000Z', 'unknown')
    insertDeparture(database, '2026-09-22T06:30:00.000Z', 'westbound')
    insertDeparture(database, '2026-06-01T06:30:00.000Z', 'eastbound')
    insertRequest(database, '2026-09-23T06:00:00.000Z')
    insertRequest(database, '2026-09-22T06:00:00.000Z')
    insertRequest(database, '2026-09-23T07:00:00.000Z', 'error')

    const statistics = buildHistoricalStatistics({
        database,
        now: new Date('2026-09-23T08:00:00.000Z'),
        timezone: 'Asia/Taipei',
        schedule: { start: '06:30', end: '21:00' }
    })

    assert.deepEqual(statistics.ranges['7'].totals, {
        westbound: 2,
        eastbound: 1,
        unknown: 1,
        total: 4,
        directional: 3,
        westboundPercentage: 66.7
    })
    assert.deepEqual(statistics.ranges['7'].opportunityDays, {
        westbound: 2,
        observed: 2,
        percentage: 100
    })
    assert.equal(statistics.ranges['30'].totals.westbound, 2)
    assert.equal(statistics.ranges.all.totals.eastbound, 2)
    assert.equal(statistics.ranges['7'].daily[0].date, '2026-09-23')
    const twoPm = statistics.ranges['7'].hourly.find(item => item.hour === 14)
    assert.equal(twoPm.start, '14:00')
    assert.equal(twoPm.westbound, 2)
    assert.equal(twoPm.eastbound, 1)
    assert.equal(statistics.ranges['7'].hourly[0].start, '06:30')

    database.close()
})
