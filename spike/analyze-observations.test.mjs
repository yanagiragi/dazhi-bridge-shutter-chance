import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const analyzerPath = fileURLToPath(
    new URL('./analyze-observations.mjs', import.meta.url)
)

function state ({
    onGround,
    longitude,
    altitude,
    trueTrack,
    verticalRate
}) {
    return {
        icao24: 'abc123',
        callsign: 'TEST123',
        longitude,
        latitude: 25.07,
        baroAltitude: altitude,
        geoAltitude: altitude,
        onGround,
        velocity: onGround ? 5 : 80,
        trueTrack,
        verticalRate
    }
}

test('splits a landing from a later departure and uses initial departure direction', t => {
    const directory = mkdtempSync(join(tmpdir(), 'dazhi-spike-'))
    const inputPath = join(directory, 'observations.jsonl')
    const observations = [
        {
            collectedAt: '2026-09-16T00:00:00.000Z',
            states: [state({
                onGround: false,
                longitude: 121.50,
                altitude: 300,
                trueTrack: 90,
                verticalRate: -3
            })]
        },
        {
            collectedAt: '2026-09-16T00:00:30.000Z',
            states: [state({
                onGround: true,
                longitude: 121.55,
                altitude: null,
                trueTrack: 90,
                verticalRate: null
            })]
        },
        {
            collectedAt: '2026-09-16T00:01:00.000Z',
            states: [state({
                onGround: true,
                longitude: 121.54,
                altitude: null,
                trueTrack: 270,
                verticalRate: null
            })]
        },
        {
            collectedAt: '2026-09-16T00:01:30.000Z',
            states: [state({
                onGround: false,
                longitude: 121.56,
                altitude: 100,
                trueTrack: 92,
                verticalRate: 8
            })]
        },
        {
            collectedAt: '2026-09-16T00:02:00.000Z',
            states: [state({
                onGround: false,
                longitude: 121.58,
                altitude: 400,
                trueTrack: 94,
                verticalRate: 8
            })]
        },
        {
            collectedAt: '2026-09-16T00:02:30.000Z',
            states: [state({
                onGround: false,
                longitude: 121.60,
                altitude: 700,
                trueTrack: 96,
                verticalRate: 8
            })]
        },
        {
            collectedAt: '2026-09-16T00:03:00.000Z',
            states: [state({
                onGround: false,
                longitude: 121.62,
                altitude: 1000,
                trueTrack: 98,
                verticalRate: 8
            })]
        },
        {
            collectedAt: '2026-09-16T00:03:30.000Z',
            states: [state({
                onGround: false,
                longitude: 121.55,
                altitude: 1300,
                trueTrack: 270,
                verticalRate: 5
            })]
        }
    ]

    t.after(() => rmSync(directory, { recursive: true, force: true }))
    writeFileSync(
        inputPath,
        observations.map(observation => JSON.stringify(observation)).join('\n')
    )

    const output = execFileSync(
        process.execPath,
        [analyzerPath, inputPath],
        { encoding: 'utf8' }
    )
    const analysis = JSON.parse(output)
    const arrival = analysis.candidateTracks.find(
        track => track.movement === 'descending'
    )
    const departure = analysis.candidateTracks.find(
        track => track.movement === 'climbing'
    )

    assert.equal(analysis.candidateTrackCount, 2)
    assert.equal(arrival.direction, 'eastbound')
    assert.equal(departure.direction, 'eastbound')
    assert.equal(departure.directionSamples, 4)
    assert.equal(
        departure.directionObservedAt,
        '2026-09-16T00:01:30.000Z'
    )
})
