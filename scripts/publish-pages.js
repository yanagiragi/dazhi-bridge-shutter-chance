import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validatePublicSnapshot } from '../src/snapshot.js'
import { loadOperatorCatalog } from '../src/operator-catalog.js'

const DEFAULT_WORKTREE_PATH = './worktree-pages'
const DEFAULT_SNAPSHOT_PATH = './runtime/pages/status.json'

function git (worktreePath, args) {
    return execFileSync('git', ['-C', worktreePath, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    }).trim()
}

function publishPages ({
    worktreePath = DEFAULT_WORKTREE_PATH,
    snapshotPath = DEFAULT_SNAPSHOT_PATH,
    publicPath = './public',
    operatorCatalogPath = './config/operators.json',
    commitMessage = 'chore: publish GitHub Pages snapshot',
    push = true
} = {}) {
    const worktree = resolve(worktreePath)
    const sourcePublic = resolve(publicPath)
    const sourceSnapshot = resolve(snapshotPath)
    if (!existsSync(sourceSnapshot)) throw new Error('Snapshot does not exist')
    const snapshot = validatePublicSnapshot(JSON.parse(
        readFileSync(sourceSnapshot, 'utf8')
    ))

    mkdirSync(worktree, { recursive: true })
    let hasCommit = true
    try {
        git(worktree, ['rev-parse', '--git-dir'])
        git(worktree, ['rev-parse', '--verify', 'HEAD'])
    } catch (error) {
        if (error.message.includes('verify')) {
            hasCommit = false
        } else {
            throw new Error('PAGES_WORKTREE_PATH must be a Git worktree')
        }
    }
    if (push && hasCommit) git(worktree, ['pull', '--ff-only'])
    cpSync(sourcePublic, worktree, { recursive: true, force: true })
    writeFileSync(
        join(worktree, 'operators.json'),
        JSON.stringify(loadOperatorCatalog(resolve(operatorCatalogPath)), null, 2) + '\n'
    )
    mkdirSync(join(worktree, 'data'), { recursive: true })
    writeFileSync(
        join(worktree, 'data', 'status.json'),
        JSON.stringify(snapshot, null, 2) + '\n'
    )
    writeFileSync(join(worktree, 'web-config.json'), JSON.stringify({
        dataSource: 'snapshot',
        aircraftDataProvider: snapshot.provider,
        departureDetailsMode: 'summary'
    }, null, 2) + '\n')

    const status = git(worktree, ['status', '--short'])
    if (!status) return { changed: false, snapshot }
    git(worktree, ['add', 'operators.json', 'data/status.json', 'web-config.json'])
    git(worktree, ['commit', '-m', commitMessage])
    if (push) git(worktree, ['push', 'origin', 'gh-pages'])
    return { changed: true, snapshot }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    const result = publishPages({
        worktreePath: process.env.PAGES_WORKTREE_PATH || DEFAULT_WORKTREE_PATH,
        snapshotPath: process.env.STATIC_SNAPSHOT_PATH || DEFAULT_SNAPSHOT_PATH,
        publicPath: process.env.PUBLIC_PATH || './public',
        operatorCatalogPath: process.env.OPERATOR_CATALOG_PATH || './config/operators.json',
        push: process.env.PAGES_PUSH !== 'false'
    })
    console.log(JSON.stringify({
        event: 'pages-published',
        changed: result.changed,
        generatedAt: result.snapshot.generatedAt
    }))
}

export { DEFAULT_SNAPSHOT_PATH, DEFAULT_WORKTREE_PATH, publishPages }
