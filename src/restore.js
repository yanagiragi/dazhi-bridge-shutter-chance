import { copyFileSync, existsSync, rmSync, renameSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadConfig } from './config.js'

const config = loadConfig()
const source = process.argv[2]

if (!source) {
    throw new Error('Usage: npm run restore -- <backup.sqlite>')
}

const resolvedSource = resolve(source)
if (!existsSync(resolvedSource)) {
    throw new Error('Backup file does not exist')
}
if (resolvedSource === config.databasePath) {
    throw new Error('Backup source must differ from DATABASE_PATH')
}

let previousDatabase = null
if (existsSync(config.databasePath)) {
    const timestamp = new Date().toISOString().replaceAll(':', '-')
    previousDatabase = config.databasePath + '.pre-restore-' + timestamp
    renameSync(config.databasePath, previousDatabase)
}
rmSync(config.databasePath + '-wal', { force: true })
rmSync(config.databasePath + '-shm', { force: true })
copyFileSync(resolvedSource, config.databasePath)

console.log(JSON.stringify({
    event: 'database-restore-complete',
    databasePath: config.databasePath,
    source: resolvedSource,
    previousDatabase
}))
