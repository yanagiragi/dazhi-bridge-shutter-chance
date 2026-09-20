import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDatabase } from '../src/database.js'
import { loadConfig } from '../src/config.js'
import { querySnapshot } from '../src/server.js'
import { buildPublicSnapshot, validatePublicSnapshot } from '../src/snapshot.js'

const DEFAULT_OUTPUT_PATH = './runtime/pages/status.json'

function exportSnapshot ({
    databasePath,
    outputPath = DEFAULT_OUTPUT_PATH,
    now = new Date(),
    provider = null,
    timezone = 'Asia/Taipei',
    collectorActiveTimeZone = timezone,
    collectorActiveStart = '06:30',
    collectorActiveEnd = '21:00'
} = {}) {
    const opened = openDatabase(databasePath)
    try {
        const serviceSnapshot = querySnapshot(
            opened.database,
            now,
            timezone,
            10,
            'summary',
            {
                timezone: collectorActiveTimeZone,
                start: collectorActiveStart,
                end: collectorActiveEnd
            }
        )
        const snapshot = validatePublicSnapshot(buildPublicSnapshot({
            serviceSnapshot,
            generatedAt: now.toISOString(),
            provider
        }))
        const absolutePath = resolve(outputPath)
        mkdirSync(dirname(absolutePath), { recursive: true })
        const serialized = JSON.stringify(snapshot, null, 2) + '\n'
        const previous = (() => {
            try {
                return readFileSync(absolutePath, 'utf8')
            } catch {
                return null
            }
        })()
        if (serialized !== previous) writeFileSync(absolutePath, serialized)
        return { changed: serialized !== previous, path: absolutePath, snapshot }
    } finally {
        opened.database.close()
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    const config = loadConfig()
    const outputPath = process.env.STATIC_SNAPSHOT_PATH || DEFAULT_OUTPUT_PATH
    const result = exportSnapshot({
        databasePath: config.databasePath,
        outputPath,
        provider: config.aircraftDataProvider,
        timezone: config.timezone,
        collectorActiveTimeZone: config.collectorActiveTimeZone,
        collectorActiveStart: config.collectorActiveStart,
        collectorActiveEnd: config.collectorActiveEnd
    })
    console.log(JSON.stringify({
        event: 'snapshot-exported',
        changed: result.changed,
        path: result.path,
        generatedAt: result.snapshot.generatedAt
    }))
}

export { DEFAULT_OUTPUT_PATH, exportSnapshot }
