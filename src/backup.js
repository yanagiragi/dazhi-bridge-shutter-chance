const { existsSync, mkdirSync } = require('node:fs')
const { dirname, resolve } = require('node:path')
const { loadConfig } = require('./config')
const { openDatabase } = require('./database')

const config = loadConfig()
const destination = process.argv[2]

if (!destination) {
    throw new Error('Usage: npm run backup -- <destination.sqlite>')
}

if (!existsSync(config.databasePath)) {
    throw new Error('DATABASE_PATH does not exist')
}

const resolvedDestination = resolve(destination)
if (resolvedDestination === config.databasePath) {
    throw new Error('Backup destination must differ from DATABASE_PATH')
}

mkdirSync(dirname(resolvedDestination), { recursive: true })
const opened = openDatabase(config.databasePath)

opened.database.backup(resolvedDestination)
    .then(() => {
        console.log(JSON.stringify({
            event: 'database-backup-complete',
            databasePath: config.databasePath,
            destination: resolvedDestination
        }))
    })
    .finally(() => opened.database.close())
