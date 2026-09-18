import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAdvice } from '../src/advice.js'

function departure (minutesAgo, direction) {
    const detectedAt = new Date(
        Date.parse('2026-09-16T04:00:00.000Z') - minutesAgo * 60 * 1000
    ).toISOString()
    return {
        icao24: `test${minutesAgo}`,
        detected_at: detectedAt,
        direction,
        detection_confidence: 'high'
    }
}

const NOW = new Date('2026-09-16T04:00:00.000Z')
const RECENT_SUCCESS = '2026-09-16T03:59:30.000Z'

test('returns high-confidence opportunity for consistent westbound departures', () => {
    const advice = buildAdvice({
        now: NOW,
        lastSuccessAt: RECENT_SUCCESS,
        departures: [
            departure(1, 'westbound'),
            departure(2, 'westbound'),
            departure(3, 'westbound'),
            departure(4, 'westbound'),
            departure(5, 'westbound')
        ]
    })
    assert.equal(advice.recommendation, 'good-opportunity')
    assert.equal(advice.confidence, 'high')
    assert.equal(advice.today.westbound, 5)
})

test('returns medium confidence for a mixed but westbound-leaning day', () => {
    const advice = buildAdvice({
        now: NOW,
        lastSuccessAt: RECENT_SUCCESS,
        departures: [
            departure(1, 'westbound'),
            departure(2, 'eastbound'),
            departure(3, 'eastbound')
        ]
    })
    assert.equal(advice.recommendation, 'possible-opportunity')
    assert.equal(advice.confidence, 'medium')
})

test('returns low confidence when recent departures have no westbound direction', () => {
    const advice = buildAdvice({
        now: NOW,
        lastSuccessAt: RECENT_SUCCESS,
        departures: [
            departure(1, 'eastbound'),
            departure(2, 'eastbound'),
            departure(3, 'eastbound')
        ]
    })
    assert.equal(advice.recommendation, 'low-opportunity')
    assert.equal(advice.confidence, 'low')
})

test('returns insufficient data when the collector is stale or has no departures', () => {
    const stale = buildAdvice({
        now: NOW,
        lastSuccessAt: '2026-09-16T02:00:00.000Z',
        departures: [departure(1, 'westbound')]
    })
    const empty = buildAdvice({
        now: NOW,
        lastSuccessAt: RECENT_SUCCESS,
        departures: []
    })
    assert.equal(stale.confidence, 'insufficient')
    assert.equal(empty.recommendation, 'insufficient-data')
})

test('returns low immediately when the latest departure turns eastbound', () => {
    const advice = buildAdvice({
        now: NOW,
        lastSuccessAt: RECENT_SUCCESS,
        departures: [
            departure(1, 'eastbound'),
            departure(2, 'westbound'),
            departure(3, 'westbound')
        ]
    })
    assert.equal(advice.recommendation, 'low-opportunity')
    assert.equal(advice.confidence, 'low')
})

test("uses recent trend instead of today's cumulative ratio", () => {
    const advice = buildAdvice({
        now: NOW,
        lastSuccessAt: RECENT_SUCCESS,
        departures: [
            departure(1, 'westbound'),
            departure(2, 'westbound'),
            departure(3, 'westbound'),
            departure(30, 'eastbound'),
            departure(31, 'eastbound'),
            departure(32, 'eastbound'),
            departure(33, 'eastbound'),
            departure(34, 'eastbound')
        ]
    })
    assert.equal(advice.recommendation, 'good-opportunity')
    assert.equal(advice.confidence, 'high')
})

test('returns low confidence when only one valid departure exists', () => {
    const advice = buildAdvice({
        now: NOW,
        lastSuccessAt: RECENT_SUCCESS,
        departures: [departure(91, 'westbound')]
    })
    assert.equal(advice.recommendation, 'low-opportunity')
    assert.equal(advice.confidence, 'low')
})

test('keeps high confidence while the latest three departures remain westbound', () => {
    const advice = buildAdvice({
        now: NOW,
        lastSuccessAt: RECENT_SUCCESS,
        departures: [
            departure(91, 'westbound'),
            departure(92, 'westbound'),
            departure(93, 'westbound')
        ]
    })
    assert.equal(advice.recommendation, 'good-opportunity')
    assert.equal(advice.confidence, 'high')
})

test('reports outside schedule without treating it as a collector failure', () => {
    const advice = buildAdvice({
        now: NOW,
        lastSuccessAt: '2026-09-15T12:00:00.000Z',
        collectorState: 'outside_schedule',
        departures: [departure(1, 'westbound')]
    })

    assert.equal(advice.freshness, 'outside_schedule')
    assert.equal(advice.recommendation, 'insufficient-data')
    assert.equal(advice.confidence, 'insufficient')
})

test('uses Taipei date when UTC crosses midnight', () => {
    const advice = buildAdvice({
        now: new Date('2026-09-16T16:05:00.000Z'),
        lastSuccessAt: '2026-09-16T16:04:30.000Z',
        departures: [{
            ...departure(1, 'westbound'),
            detected_at: '2026-09-16T15:00:00.000Z'
        }]
    })
    assert.equal(advice.date, '2026-09-17')
    assert.equal(advice.today.total, 0)
})


test('ignores departures scheduled after the current time', () => {
    const advice = buildAdvice({
        now: NOW,
        lastSuccessAt: RECENT_SUCCESS,
        departures: [
            departure(1, 'eastbound'),
            {
                ...departure(0, 'westbound'),
                detected_at: '2026-09-16T04:01:00.000Z'
            }
        ]
    })
    assert.equal(advice.today.total, 1)
    assert.equal(advice.today.westbound, 0)
    assert.equal(advice.recentDepartures.length, 1)
})


test('excludes previous Taipei-day departures from recent results', () => {
    const advice = buildAdvice({
        now: new Date('2026-09-18T01:13:00.000Z'),
        lastSuccessAt: '2026-09-18T01:12:30.000Z',
        departures: [{
            icao24: 'previous',
            detected_at: '2026-09-17T11:52:00.000Z',
            direction: 'eastbound',
            detection_confidence: 'high'
        }]
    })

    assert.equal(advice.date, '2026-09-18')
    assert.equal(advice.today.total, 0)
    assert.deepEqual(advice.recentDepartures, [])
    assert.equal(advice.recommendation, 'insufficient-data')
})
