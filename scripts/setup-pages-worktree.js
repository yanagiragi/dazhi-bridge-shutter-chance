import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_BRANCH = 'gh-pages'
const DEFAULT_WORKTREE_PATH = './worktree-pages'

function git (args, cwd = process.cwd()) {
    return execFileSync('git', ['-C', cwd, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    }).trim()
}

function remoteBranchExists (branch, cwd = process.cwd()) {
    try {
        git(['ls-remote', '--exit-code', '--heads', 'origin', branch], cwd)
        return true
    } catch {
        return false
    }
}

function localBranchExists (branch, cwd = process.cwd()) {
    try {
        git(['show-ref', '--verify', `refs/heads/${branch}`], cwd)
        return true
    } catch {
        return false
    }
}

function setupPagesWorktree ({
    branch = DEFAULT_BRANCH,
    worktreePath = DEFAULT_WORKTREE_PATH,
    cwd = process.cwd()
} = {}) {
    const path = resolve(cwd, worktreePath)
    if (existsSync(path)) {
        throw new Error(`Worktree path already exists: ${path}`)
    }

    git(['fetch', 'origin'], cwd)
    if (remoteBranchExists(branch, cwd) && !localBranchExists(branch, cwd)) {
        git(['worktree', 'add', path, '-b', branch, `origin/${branch}`], cwd)
        return { path, branch, initializedFromRemote: true }
    }

    if (localBranchExists(branch, cwd)) {
        git(['worktree', 'add', path, branch], cwd)
        return { path, branch, initializedFromRemote: false }
    }

    git(['worktree', 'add', '--orphan', path, '-b', branch], cwd)
    return { path, branch, initializedFromRemote: false }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
    const result = setupPagesWorktree({
        branch: process.env.PAGES_BRANCH || DEFAULT_BRANCH,
        worktreePath: process.env.PAGES_WORKTREE_PATH || DEFAULT_WORKTREE_PATH
    })
    console.log(JSON.stringify({ event: 'pages-worktree-ready', ...result }))
}

export {
    DEFAULT_BRANCH,
    DEFAULT_WORKTREE_PATH,
    remoteBranchExists,
    localBranchExists,
    setupPagesWorktree
}
