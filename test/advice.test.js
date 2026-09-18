const test = require('node:test')
const assert = require('node:assert/strict')
const { buildAdvice } = require('../src/advice')

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
            departure(2, 'westbound'),
            departure(3, 'eastbound')
        ]
    })
    assert.equal(advice.recommendation, 'possible-opportunity')
    assert.equal(advice.confidence, 'medium')
})

test('returns low confidence when westbound departures are uncommon', () => {
    const advice = buildAdvice({
        now: NOW,
        lastSuccessAt: RECENT_SUCCESS,
        departures: [
            departure(1, 'eastbound'),
            departure(2, 'eastbound'),
            departure(3, 'westbound')
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
