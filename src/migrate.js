import { loadConfig } from './config.js'
import { openDatabase } from './database.js'

const config = loadConfig()
const opened = openDatabase(config.databasePath)

console.log(JSON.stringify({
    event: 'migrations-applied',
    databasePath: config.databasePath,
    schemaVersion: opened.schemaVersion
}))

opened.database.close()
