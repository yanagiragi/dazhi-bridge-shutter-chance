#!/usr/bin/env node

import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'

const DEFAULTS = Object.freeze({
    samples: 20,
    intervalSeconds: 30,
    output: 'data/validation/observations.jsonl',
    bounds: {
        lamin: 24.98,
        lomin: 121.42,
        lamax: 25.15,
        lomax: 121.72
    }
})

const RCSS = Object.freeze({
    latitude: 25.069722,
    longitude: 121.5525
})

const STATE_FIELDS = Object.freeze({
    icao24: 0,
    callsign: 1,
    originCountry: 2,
    timePosition: 3,
    lastContact: 4,
    longitude: 5,
    latitude: 6,
    baroAltitude: 7,
    onGround: 8,
    velocity: 9,
    trueTrack: 10,
    verticalRate: 11,
    geoAltitude: 13,
    squawk: 14,
    positionSource: 16
})

function usage () {
    console.log(`Usage:
  node scripts/validation/collect-opensky.js [options]

Options:
  --samples <count>       Number of polls (default: ${DEFAULTS.samples})
  --interval <seconds>    Delay between polls (default: ${DEFAULTS.intervalSeconds})
  --output <path>         JSONL destination (default: ${DEFAULTS.output})
  --help                  Show this help

Optional authentication:
  Set OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET together.
  Credentials are never written to the output file.
`)
}

function positiveNumber (value, name, integer = false) {
    const parsed = Number(value)

    if (!Number.isFinite(parsed) || parsed <= 0 || (integer && !Number.isInteger(parsed))) {
        throw new Error(`${name} must be a positive ${integer ? 'integer' : 'number'}`)
    }

    return parsed
}

function parseArgs (argv) {
    const options = {
        ...DEFAULTS,
        bounds: { ...DEFAULTS.bounds }
    }

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index]

        if (argument === '--help') {
            usage()
            process.exit(0)
        }

        const value = argv[index + 1]

        if (argument === '--samples') {
            options.samples = positiveNumber(value, '--samples', true)
            index += 1
        } else if (argument === '--interval') {
            options.intervalSeconds = positiveNumber(value, '--interval')
            index += 1
        } else if (argument === '--output') {
            if (!value) {
                throw new Error('--output requires a path')
            }
            options.output = value
            index += 1
        } else {
            throw new Error(`Unknown argument: ${argument}`)
        }
    }

    return options
}

function nullableNumber (value) {
    return Number.isFinite(value) ? value : null
}

function normalizeState (state) {
    const callsign = state[STATE_FIELDS.callsign]?.trim() || null

    return {
        icao24: state[STATE_FIELDS.icao24],
        callsign,
        originCountry: state[STATE_FIELDS.originCountry],
        timePosition: state[STATE_FIELDS.timePosition],
        lastContact: state[STATE_FIELDS.lastContact],
        longitude: nullableNumber(state[STATE_FIELDS.longitude]),
        latitude: nullableNumber(state[STATE_FIELDS.latitude]),
        baroAltitude: nullableNumber(state[STATE_FIELDS.baroAltitude]),
        geoAltitude: nullableNumber(state[STATE_FIELDS.geoAltitude]),
        onGround: state[STATE_FIELDS.onGround] === true,
        velocity: nullableNumber(state[STATE_FIELDS.velocity]),
        trueTrack: nullableNumber(state[STATE_FIELDS.trueTrack]),
        verticalRate: nullableNumber(state[STATE_FIELDS.verticalRate]),
        squawk: state[STATE_FIELDS.squawk] || null,
        positionSource: nullableNumber(state[STATE_FIELDS.positionSource])
    }
}

function toRadians (degrees) {
    return degrees * Math.PI / 180
}

function distanceFromRcssKm (state) {
    if (state.latitude === null || state.longitude === null) {
        return null
    }

    const earthRadiusKm = 6371
    const latitudeDelta = toRadians(state.latitude - RCSS.latitude)
    const longitudeDelta = toRadians(state.longitude - RCSS.longitude)
    const startLatitude = toRadians(RCSS.latitude)
    const endLatitude = toRadians(state.latitude)
    const haversine = Math.sin(latitudeDelta / 2) ** 2 +
        Math.cos(startLatitude) * Math.cos(endLatitude) *
        Math.sin(longitudeDelta / 2) ** 2

    return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

function directionFromTrack (trueTrack) {
    if (trueTrack === null) {
        return 'unknown'
    }

    if (trueTrack >= 60 && trueTrack <= 130) {
        return 'eastbound'
    }

    if (trueTrack >= 230 && trueTrack <= 310) {
        return 'westbound'
    }

    return 'unknown'
}

function candidateKind (state) {
    const altitude = state.geoAltitude ?? state.baroAltitude
    const distanceKm = distanceFromRcssKm(state)
    const direction = directionFromTrack(state.trueTrack)
    const isNearAndLow = distanceKm !== null && distanceKm <= 12 &&
        altitude !== null && altitude <= 2000
    const isMoving = state.velocity !== null && state.velocity >= 45

    if (state.onGround || !isNearAndLow || !isMoving || direction === 'unknown') {
        return null
    }

    if (state.verticalRate !== null && state.verticalRate >= 1) {
        return {
            kind: 'departure-candidate',
            direction,
            distanceKm: Number(distanceKm.toFixed(2))
        }
    }

    if (state.verticalRate !== null && state.verticalRate <= -1) {
        return {
            kind: 'arrival-candidate',
            direction,
            distanceKm: Number(distanceKm.toFixed(2))
        }
    }

    return null
}

async function getAccessToken () {
    const clientId = process.env.OPENSKY_CLIENT_ID
    const clientSecret = process.env.OPENSKY_CLIENT_SECRET

    if (!clientId && !clientSecret) {
        return null
    }

    if (!clientId || !clientSecret) {
        throw new Error('Set both OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET')
    }

    const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret
    })
    const response = await fetch(
        'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token',
        {
            method: 'POST',
            headers: {
                'content-type': 'application/x-www-form-urlencoded'
            },
            body,
            signal: AbortSignal.timeout(15000)
        }
    )

    if (!response.ok) {
        throw new Error(`OAuth request failed with HTTP ${response.status}`)
    }

    const payload = await response.json()

    return payload.access_token
}

function buildStatesUrl (bounds) {
    const url = new URL('https://opensky-network.org/api/states/all')

    for (const [name, value] of Object.entries(bounds)) {
        url.searchParams.set(name, String(value))
    }

    return url
}

async function collectSample (url, token) {
    const headers = token
        ? { authorization: `Bearer ${token}` }
        : {}
    const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(15000)
    })

    if (!response.ok) {
        const retryAfter = response.headers.get('x-rate-limit-retry-after-seconds')
        throw new Error(
            `States request failed with HTTP ${response.status}` +
            (retryAfter ? `; retry after ${retryAfter}s` : '')
        )
    }

    const payload = await response.json()
    const states = (payload.states || []).map(normalizeState)

    return {
        collectedAt: new Date().toISOString(),
        serverTime: payload.time,
        remainingCredits: response.headers.get('x-rate-limit-remaining'),
        states
    }
}

async function main () {
    const options = parseArgs(process.argv.slice(2))
    const outputPath = resolve(options.output)
    const url = buildStatesUrl(options.bounds)
    const token = await getAccessToken()
    let successfulSamples = 0
    let failedSamples = 0
    let stateCount = 0
    let departureCandidateCount = 0
    let arrivalCandidateCount = 0

    await mkdir(dirname(outputPath), { recursive: true })

    console.log(JSON.stringify({
        event: 'collection-started',
        authentication: token ? 'oauth' : 'anonymous',
        samples: options.samples,
        intervalSeconds: options.intervalSeconds,
        outputPath,
        bounds: options.bounds
    }))

    for (let index = 0; index < options.samples; index += 1) {
        try {
            const sample = await collectSample(url, token)
            const candidates = sample.states
                .map(state => ({ state, candidate: candidateKind(state) }))
                .filter(item => item.candidate !== null)

            await appendFile(outputPath, `${JSON.stringify(sample)}\n`)
            successfulSamples += 1
            stateCount += sample.states.length

            for (const { state, candidate } of candidates) {
                if (candidate.kind === 'departure-candidate') {
                    departureCandidateCount += 1
                } else {
                    arrivalCandidateCount += 1
                }

                console.log(JSON.stringify({
                    event: candidate.kind,
                    collectedAt: sample.collectedAt,
                    icao24: state.icao24,
                    callsign: state.callsign,
                    direction: candidate.direction,
                    distanceKm: candidate.distanceKm,
                    altitude: state.geoAltitude ?? state.baroAltitude,
                    velocity: state.velocity,
                    trueTrack: state.trueTrack,
                    verticalRate: state.verticalRate
                }))
            }

            console.log(JSON.stringify({
                event: 'sample-collected',
                sample: index + 1,
                stateCount: sample.states.length,
                candidateCount: candidates.length,
                remainingCredits: sample.remainingCredits
            }))
        } catch (error) {
            failedSamples += 1
            console.error(JSON.stringify({
                event: 'sample-failed',
                sample: index + 1,
                message: error.message
            }))
        }

        if (index + 1 < options.samples) {
            await delay(options.intervalSeconds * 1000)
        }
    }

    console.log(JSON.stringify({
        event: 'collection-finished',
        successfulSamples,
        failedSamples,
        stateCount,
        departureCandidateCount,
        arrivalCandidateCount,
        outputPath
    }))

    if (successfulSamples === 0) {
        process.exitCode = 1
    }
}

main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
})
