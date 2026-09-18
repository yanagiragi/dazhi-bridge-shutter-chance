#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import process from 'node:process'

function usage () {
    console.log('Usage: node scripts/validation/analyze-observations.js <observations.jsonl>')
}

function median (values) {
    if (values.length === 0) {
        return null
    }

    const sorted = [...values].sort((left, right) => left - right)
    const middle = Math.floor(sorted.length / 2)

    if (sorted.length % 2 === 1) {
        return sorted[middle]
    }

    return (sorted[middle - 1] + sorted[middle]) / 2
}

function directionFromStates (states) {
    const longitudeDelta = states.length >= 2
        ? states.at(-1).longitude - states[0].longitude
        : null

    if (longitudeDelta !== null && Math.abs(longitudeDelta) >= 0.005) {
        return {
            direction: longitudeDelta > 0 ? 'eastbound' : 'westbound',
            longitudeDelta
        }
    }

    const medianTrack = median(
        states.map(state => state.trueTrack).filter(Number.isFinite)
    )

    if (medianTrack !== null && medianTrack >= 60 && medianTrack <= 130) {
        return { direction: 'eastbound', longitudeDelta }
    }

    if (medianTrack !== null && medianTrack >= 230 && medianTrack <= 310) {
        return { direction: 'westbound', longitudeDelta }
    }

    return { direction: 'unknown', longitudeDelta }
}

function summarizeTrack (states) {
    const positioned = states.filter(state =>
        state.latitude !== null && state.longitude !== null
    )
    const altitudes = positioned
        .map(state => state.geoAltitude ?? state.baroAltitude)
        .filter(Number.isFinite)
    const verticalRates = positioned
        .map(state => state.verticalRate)
        .filter(Number.isFinite)
    const medianVerticalRate = median(verticalRates)
    let movement = 'undetermined'

    if (medianVerticalRate !== null && medianVerticalRate >= 1) {
        movement = 'climbing'
    } else if (medianVerticalRate !== null && medianVerticalRate <= -1) {
        movement = 'descending'
    } else if (positioned.some(state => state.onGround)) {
        movement = 'ground-or-level'
    }

    let directionStates = positioned

    if (movement === 'climbing') {
        directionStates = positioned
            .filter(state =>
                state.verticalRate >= 1 &&
                (state.geoAltitude ?? state.baroAltitude) <= 1500
            )
            .slice(0, 4)
    } else if (movement === 'descending') {
        directionStates = positioned
            .filter(state =>
                state.verticalRate <= -1 &&
                (state.geoAltitude ?? state.baroAltitude) <= 1500
            )
            .slice(-4)
    }

    if (directionStates.length === 0) {
        directionStates = positioned
    }

    const { direction, longitudeDelta } = directionFromStates(directionStates)

    return {
        icao24: states[0].icao24,
        callsigns: [...new Set(states.map(state => state.callsign).filter(Boolean))],
        samples: states.length,
        directionSamples: directionStates.length,
        directionObservedAt: directionStates[0]?.observedAt ?? null,
        firstSeen: states[0].observedAt,
        lastSeen: states.at(-1).observedAt,
        initialAltitude: directionStates[0]
            ? directionStates[0].geoAltitude ?? directionStates[0].baroAltitude
            : null,
        initialTrueTrack: directionStates[0]?.trueTrack ?? null,
        minimumAltitude: altitudes.length ? Math.min(...altitudes) : null,
        maximumAltitude: altitudes.length ? Math.max(...altitudes) : null,
        medianVerticalRate,
        longitudeDelta,
        direction,
        movement
    }
}

function splitTracks (states) {
    const segments = []
    let current = []
    let hasAirborneState = false
    let hasLanded = false

    function finishCurrent () {
        if (current.length > 0) {
            segments.push(current)
        }

        current = []
        hasAirborneState = false
        hasLanded = false
    }

    for (const state of states) {
        const previous = current.at(-1)
        const gapSeconds = previous
            ? (Date.parse(state.observedAt) - Date.parse(previous.observedAt)) / 1000
            : 0

        if (gapSeconds > 120 || (hasLanded && !state.onGround)) {
            finishCurrent()
        }

        current.push(state)

        if (!state.onGround) {
            hasAirborneState = true
        } else if (hasAirborneState) {
            hasLanded = true
        }
    }

    finishCurrent()

    return segments
}

async function main () {
    const inputPath = process.argv[2]

    if (!inputPath || inputPath === '--help') {
        usage()
        process.exit(inputPath ? 0 : 1)
    }

    const contents = await readFile(inputPath, 'utf8')
    const lines = contents.split('\n').filter(Boolean)
    const samples = lines.map(line => JSON.parse(line))
    const aircraft = new Map()

    for (const sample of samples) {
        for (const state of sample.states) {
            const states = aircraft.get(state.icao24) || []
            states.push({
                ...state,
                observedAt: sample.collectedAt
            })
            aircraft.set(state.icao24, states)
        }
    }

    const tracks = [...aircraft.values()]
        .flatMap(splitTracks)
        .map(summarizeTrack)
        .sort((left, right) => left.firstSeen.localeCompare(right.firstSeen))
    const candidateTracks = tracks.filter(track =>
        track.samples >= 2 &&
        track.minimumAltitude !== null &&
        track.minimumAltitude <= 2000 &&
        track.direction !== 'unknown' &&
        ['climbing', 'descending'].includes(track.movement)
    )

    console.log(JSON.stringify({
        inputPath,
        sampleCount: samples.length,
        firstSampleAt: samples[0]?.collectedAt ?? null,
        lastSampleAt: samples.at(-1)?.collectedAt ?? null,
        uniqueAircraft: aircraft.size,
        candidateTrackCount: candidateTracks.length,
        candidateTracks
    }, null, 2))
}

main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
})
