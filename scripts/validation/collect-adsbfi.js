#!/usr/bin/env node

import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'

const MINIMUM_INTERVAL_SECONDS = 1

const DEFAULTS = Object.freeze({
    samples: 360,
    intervalSeconds: 5,
    output: 'data/validation/adsbfi-observations.jsonl',
    latitude: 25.069722,
    longitude: 121.5525,
    radiusNm: 25
})

function usage () {
    console.log(`Usage:
  node scripts/validation/collect-adsbfi.js [options]

Options:
  --samples <count>       Number of polls (default: ${DEFAULTS.samples})
  --interval <seconds>    Delay between polls (default: ${DEFAULTS.intervalSeconds})
  --radius <nm>           Query radius (default: ${DEFAULTS.radiusNm})
  --output <path>         JSONL destination (default: ${DEFAULTS.output})
  --help                  Show this help
`)
}

function positiveNumber (value, name, integer = false) {
    const parsed = Number(value)

    if (!Number.isFinite(parsed) || parsed <= 0 ||
        (integer && !Number.isInteger(parsed))) {
        throw new Error(
            `${name} must be a positive ${integer ? 'integer' : 'number'}`
        )
    }

    return parsed
}

function parseArgs (argv) {
    const options = { ...DEFAULTS }

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index]
        const value = argv[index + 1]

        if (argument === '--help') {
            usage()
            process.exit(0)
        } else if (argument === '--samples') {
            options.samples = positiveNumber(value, argument, true)
            index += 1
        } else if (argument === '--interval') {
            options.intervalSeconds = positiveNumber(value, argument)
            index += 1
        } else if (argument === '--radius') {
            options.radiusNm = positiveNumber(value, argument)
            index += 1
        } else if (argument === '--output') {
            if (!value) throw new Error('--output requires a path')
            options.output = value
            index += 1
        } else {
            throw new Error(`Unknown argument: ${argument}`)
        }
    }

    if (options.intervalSeconds < MINIMUM_INTERVAL_SECONDS) {
        throw new Error(
            `--interval must be at least ${MINIMUM_INTERVAL_SECONDS} second`
        )
    }

    return options
}

function buildUrl (options) {
    return new URL(
        `https://opendata.adsb.fi/api/v3/lat/${options.latitude}` +
        `/lon/${options.longitude}/dist/${options.radiusNm}`
    )
}

async function collectSample (url) {
    const startedAt = Date.now()
    const response = await fetch(url, {
        signal: AbortSignal.timeout(15000)
    })
    const payload = await response.json()

    if (!response.ok) {
        const error = new Error(
            `adsb.fi request failed with HTTP ${response.status}`
        )
        error.status = response.status
        throw error
    }

    if (!Array.isArray(payload.ac)) {
        throw new Error('adsb.fi response missing ac array')
    }

    return {
        collectedAt: new Date().toISOString(),
        httpStatus: response.status,
        responseMs: Date.now() - startedAt,
        serverTime: payload.now ?? null,
        aircraft: payload.ac
    }
}

async function main () {
    const options = parseArgs(process.argv.slice(2))
    const outputPath = resolve(options.output)
    const url = buildUrl(options)

    await mkdir(dirname(outputPath), { recursive: true })

    for (let index = 0; index < options.samples; index += 1) {
        const pollStartedAt = Date.now()

        try {
            const sample = await collectSample(url)
            await appendFile(outputPath, `${JSON.stringify(sample)}\n`)
            console.log(JSON.stringify({
                sample: index + 1,
                collectedAt: sample.collectedAt,
                aircraft: sample.aircraft.length,
                responseMs: sample.responseMs
            }))
        } catch (error) {
            await appendFile(outputPath, `${JSON.stringify({
                collectedAt: new Date().toISOString(),
                error: error.message,
                httpStatus: error.status ?? null
            })}\n`)
            console.error(error.message)
        }

        const elapsedMs = Date.now() - pollStartedAt
        const remainingMs = options.intervalSeconds * 1000 - elapsedMs
        if (index < options.samples - 1 && remainingMs > 0) {
            await delay(remainingMs)
        }
    }

    console.log(JSON.stringify({ complete: true, outputPath }))
}

main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
})
