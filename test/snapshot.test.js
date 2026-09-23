import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPublicSnapshot, validatePublicSnapshot } from '../src/snapshot.js'

test('public snapshot keeps only allowlisted summary fields', () => {
    const snapshot = buildPublicSnapshot({
        provider: 'adsbfi',
        generatedAt: '2026-09-20T04:00:00.000Z',
        serviceSnapshot: {
            advice: {
                date: '2026-09-20', timezone: 'Asia/Taipei',
                freshness: 'fresh', recommendation: 'low-opportunity',
                confidence: 'low', reason: 'test',
                lastSuccessAt: '2026-09-20T03:59:00.000Z',
                today: { total: 1, eastbound: 1, westbound: 0, unknown: 0 },
                collectionSchedule: { timezone: 'Asia/Taipei', start: '06:30', end: '21:00', nextStartAt: null },
                recentDepartures: [{ callsign: 'CAL123', detected_at: '2026-09-20T03:58:00.000Z', direction: 'eastbound', runway_estimate: '10', detection_confidence: 'high', source: 'adsbfi', details: { track: [{ latitude: 1 }] } }]
            },
            collector: { state: 'ok' },
            statistics: {
                timezone: 'Asia/Taipei',
                ranges: {
                    '30': { totals: { westbound: 1 } },
                    '90': { totals: { westbound: 1 } },
                    all: { totals: { westbound: 1 } }
                }
            }
        }
    })
    validatePublicSnapshot(snapshot)
    assert.equal(snapshot.collectorStatus, 'active')
    assert.equal(snapshot.recentDepartures[0].details.track, undefined)
    assert.equal(snapshot.advice.recentDepartures[0].details.altitude_gain, null)
    assert.equal(snapshot.provider, 'adsbfi')
    assert.equal(snapshot.statistics.ranges.all.totals.westbound, 1)
})

test('public snapshot validator rejects private fields', () => {
    assert.throws(() => validatePublicSnapshot({
        schemaVersion: 1, generatedAt: '2026-09-20T04:00:00.000Z',
        advice: {}, recentDepartures: [], icao24: 'private'
    }), /forbidden field/)
})
