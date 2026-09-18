import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
import Database from 'better-sqlite3'
import { loadOperatorCatalog } from '../src/operator-catalog.js'
import { resolveOperatorCandidates } from '../src/operator-resolver.js'

const DEFAULT_DATABASE_PATH = join(__dirname, '..', 'data', 'dazhi.sqlite')
const DEFAULT_OPERATOR_CATALOG_PATH = join(
    __dirname,
    '..',
    'config',
    'operators.json'
)

// A candidate must have an ICAO-style three-letter prefix followed by at
// least one alphanumeric character. This intentionally excludes numeric-only
// values and common registration-shaped identifiers from automatic mapping.
const AIRLINE_CALLSIGN_PATTERN = /^([A-Z]{3})[A-Z0-9]+$/

function extractOperatorCandidate (callsign) {
    if (typeof callsign !== 'string') return null

    const match = callsign.trim().toUpperCase().match(
        AIRLINE_CALLSIGN_PATTERN
    )
    return match?.[1] ?? null
}

function findUnknownOperatorCandidates (rows, knownCodes) {
    const counts = new Map()

    for (const row of rows) {
        const code = extractOperatorCandidate(row.callsign)
        if (!code || knownCodes.has(code)) continue
        counts.set(code, (counts.get(code) || 0) + row.occurrences)
    }

    return [...counts.entries()]
        .map(([code, occurrences]) => ({ code, occurrences }))
        .sort((left, right) =>
            right.occurrences - left.occurrences ||
            left.code.localeCompare(right.code)
        )
}

function loadOperatorCodes (catalogPath) {
    const catalog = loadOperatorCatalog(catalogPath)
    return new Set(catalog.operators.map(operator => operator.code))
}

function auditDatabase (databasePath, catalogPath) {
    const database = new Database(databasePath, {
        readonly: true,
        fileMustExist: true
    })

    try {
        const rows = database.prepare(`
            SELECT callsign, COUNT(*) AS occurrences
            FROM departures
            WHERE callsign IS NOT NULL
            GROUP BY callsign
        `).all()
        return findUnknownOperatorCandidates(
            rows,
            loadOperatorCodes(catalogPath)
        )
    } finally {
        database.close()
    }
}

function resolveRequested (args) {
    const unknown = args.filter(argument => argument !== '--resolve')
    if (unknown.length > 0) {
        throw new Error(`Unknown argument: ${unknown[0]}`)
    }
    return args.includes('--resolve')
}

async function main () {
    const databasePath = process.env.DATABASE_PATH || DEFAULT_DATABASE_PATH
    const catalogPath = process.env.OPERATOR_CATALOG_PATH ||
        DEFAULT_OPERATOR_CATALOG_PATH
    const candidates = auditDatabase(databasePath, catalogPath)
    const shouldResolve = resolveRequested(process.argv.slice(2))

    if (candidates.length === 0) {
        console.log('No unknown airline operator candidates found.')
        return
    }

    if (shouldResolve) {
        console.log(JSON.stringify(
            await resolveOperatorCandidates(candidates),
            null,
            2
        ))
        return
    }

    console.log('Unknown airline operator candidates:')
    for (const candidate of candidates) {
        console.log(`${candidate.code}\t${candidate.occurrences}`)
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        console.error(`Callsign audit failed: ${error.message}`)
        process.exitCode = 1
    })
}

export {
    extractOperatorCandidate,
    findUnknownOperatorCandidates,
    resolveRequested
}
