const { loadConfig } = require('./config')
const { openDatabase } = require('./database')

const config = loadConfig()
const opened = openDatabase(config.databasePath)

console.log(JSON.stringify({
    event: 'migrations-applied',
    databasePath: config.databasePath,
    schemaVersion: opened.schemaVersion
}))

opened.database.close()
