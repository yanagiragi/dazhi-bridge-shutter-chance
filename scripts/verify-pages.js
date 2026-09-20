import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validatePublicSnapshot } from '../src/snapshot.js'

const REQUIRED_FILES = [
    'index.html',
    'app.js',
    'styles.css',
    'favicon-summary.svg',
    'favicon-precise.svg',
    'favicon-snapshot.svg',
    'web-config.json',
    'operators.json',
    'data/status.json',
    'locales/en.json',
    'locales/zh-TW.json'
]

const FORBIDDEN_FILE_PATTERNS = [
    /\.sqlite(?:-|$)/i,
    /\.env(?:\.|$)/i,
    /credentials?/i,
    /token/i,
    /secret/i
]

function listFiles (directory, prefix = '') {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const relative = join(prefix, entry.name)
        if (entry.isDirectory()) return listFiles(join(directory, entry.name), relative)
        return [relative]
    })
}

function verifyPages ({ worktreePath = './gh-pages' } = {}) {
    const directory = resolve(worktreePath)
    if (!existsSync(directory) || !statSync(directory).isDirectory()) {
        throw new Error(`Pages worktree does not exist: ${directory}`)
    }

    for (const relative of REQUIRED_FILES) {
        if (!existsSync(join(directory, relative))) {
            throw new Error(`Pages file is missing: ${relative}`)
        }
    }

    const files = listFiles(directory)
    const forbiddenFile = files.find(relative =>
        FORBIDDEN_FILE_PATTERNS.some(pattern => pattern.test(relative))
    )
    if (forbiddenFile) throw new Error(`Forbidden Pages file: ${forbiddenFile}`)

    const config = JSON.parse(readFileSync(join(directory, 'web-config.json')))
    if (config.dataSource !== 'snapshot' ||
        config.departureDetailsMode !== 'summary') {
        throw new Error('Pages web-config must use snapshot summary mode')
    }
    const snapshot = validatePublicSnapshot(JSON.parse(
        readFileSync(join(directory, 'data/status.json'))
    ))
    const assetText = ['index.html', 'app.js', 'styles.css'].map(relative =>
        readFileSync(join(directory, relative), 'utf8')
    ).join('\n')
    if (/\b(?:href|src)=['"]\//.test(assetText) ||
        /fetch\(['"]\//.test(assetText)) {
        throw new Error('Pages assets must use relative paths')
    }

    return {
        directory,
        fileCount: files.length,
        generatedAt: snapshot.generatedAt,
        departureCount: snapshot.recentDepartures.length
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    const result = verifyPages({
        worktreePath: process.env.PAGES_WORKTREE_PATH || './worktree-pages'
    })
    console.log(JSON.stringify({ event: 'pages-verified', ...result }))
}

export { REQUIRED_FILES, verifyPages }
