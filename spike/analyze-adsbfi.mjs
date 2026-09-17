#!/usr/bin/env node

import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import process from 'node:process'

const require = createRequire(import.meta.url)
const { normalizeAdsbFiAircraft } = require('../src/adsbfi')
const { detectDepartures } = require('../src/detector')

const RADII_NM = Object.freeze([3, 5, 10, 25])
const LOW_ALTITUDE_FEET = 5000

function median (values) {
    if (values.length === 0) return null
    const sorted = [...values].sort((left, right) => left - right)
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2
}

function positionedWithin (samples, radiusNm) {
    return samples.flatMap(sample => (sample.aircraft || [])
        .filter(aircraft => Number(aircraft.dst) <= radiusNm)
        .map(aircraft => ({ aircraft, observedAt: sample.collectedAt })))
}

function fieldCoverage (observations) {
    const present = selector => observations.filter(selector).length
    return {
        observations: observations.length,
        icao24: present(({ aircraft }) => Boolean(aircraft.hex)),
        callsign: present(({ aircraft }) => Boolean(aircraft.flight?.trim())),
        position: present(({ aircraft }) =>
            Number.isFinite(aircraft.lat) && Number.isFinite(aircraft.lon)
        ),
        altitude: present(({ aircraft }) =>
            Number.isFinite(aircraft.alt_baro) ||
            Number.isFinite(aircraft.alt_geom) ||
            aircraft.alt_baro === 'ground'
        ),
        groundSpeed: present(({ aircraft }) => Number.isFinite(aircraft.gs)),
        trueTrack: present(({ aircraft }) => Number.isFinite(aircraft.track)),
        verticalRate: present(({ aircraft }) =>
            Number.isFinite(aircraft.baro_rate) ||
            Number.isFinite(aircraft.geom_rate)
        ),
        positionAgeSeconds: {
            median: median(observations
                .map(({ aircraft }) => aircraft.seen_pos)
                .filter(Number.isFinite)),
            maximum: Math.max(0, ...observations
                .map(({ aircraft }) => aircraft.seen_pos)
                .filter(Number.isFinite))
        }
    }
}

function analyzeRadius (samples, radiusNm) {
    const observations = positionedWithin(samples, radiusNm)
    const states = observations.map(({ aircraft, observedAt }) => ({
        ...normalizeAdsbFiAircraft(aircraft),
        observedAt
    }))
    const lowObservations = observations.filter(({ aircraft }) => {
        const altitude = aircraft.alt_geom ?? aircraft.alt_baro
        return altitude === 'ground' ||
            (Number.isFinite(altitude) && altitude <= LOW_ALTITUDE_FEET)
    })

    return {
        radiusNm,
        uniqueAircraft: new Set(observations
            .map(({ aircraft }) => aircraft.hex)
            .filter(Boolean)).size,
        fieldCoverage: fieldCoverage(observations),
        lowAltitudeObservations: lowObservations.length,
        lowAltitudeAircraft: [...new Set(lowObservations
            .map(({ aircraft }) => aircraft.flight?.trim() || aircraft.hex)
            .filter(Boolean))],
        detectedDepartures: detectDepartures(states).map(departure => ({
            icao24: departure.icao24,
            callsign: departure.callsign,
            direction: departure.direction,
            initialAltitude: departure.initialAltitude,
            confidence: departure.detectionConfidence
        }))
    }
}

async function main () {
    const inputPath = process.argv[2]
    if (!inputPath || inputPath === '--help') {
        console.log('Usage: node spike/analyze-adsbfi.mjs <observations.jsonl>')
        process.exit(inputPath ? 0 : 1)
    }

    const contents = await readFile(inputPath, 'utf8')
    const samples = contents.split('\n').filter(Boolean).map(JSON.parse)
    const successfulSamples = samples.filter(sample =>
        Array.isArray(sample.aircraft)
    )
    const responseTimes = successfulSamples
        .map(sample => sample.responseMs)
        .filter(Number.isFinite)

    console.log(JSON.stringify({
        inputPath,
        sampleCount: samples.length,
        successfulSamples: successfulSamples.length,
        failedSamples: samples.length - successfulSamples.length,
        firstSampleAt: samples[0]?.collectedAt ?? null,
        lastSampleAt: samples.at(-1)?.collectedAt ?? null,
        responseMs: {
            median: median(responseTimes),
            maximum: Math.max(0, ...responseTimes)
        },
        radii: RADII_NM.map(radiusNm =>
            analyzeRadius(successfulSamples, radiusNm)
        )
    }, null, 2))
}

main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
})
