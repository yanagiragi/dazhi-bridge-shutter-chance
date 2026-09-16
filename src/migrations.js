const MIGRATIONS = Object.freeze([
    {
        version: 1,
        name: 'initial_schema',
        sql: `
            CREATE TABLE IF NOT EXISTS aircraft_observations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                observed_at TEXT NOT NULL,
                icao24 TEXT NOT NULL,
                callsign TEXT,
                latitude REAL,
                longitude REAL,
                baro_altitude REAL,
                geo_altitude REAL,
                velocity REAL,
                true_track REAL,
                vertical_rate REAL,
                on_ground INTEGER NOT NULL CHECK (on_ground IN (0, 1)),
                source TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_observations_observed_at
                ON aircraft_observations (observed_at);

            CREATE INDEX IF NOT EXISTS idx_observations_aircraft_time
                ON aircraft_observations (icao24, observed_at);

            CREATE TABLE IF NOT EXISTS departures (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                icao24 TEXT NOT NULL,
                callsign TEXT,
                detected_at TEXT NOT NULL,
                direction TEXT NOT NULL CHECK (
                    direction IN ('eastbound', 'westbound', 'unknown')
                ),
                runway_estimate TEXT CHECK (
                    runway_estimate IN ('10', '28') OR runway_estimate IS NULL
                ),
                detection_confidence TEXT NOT NULL CHECK (
                    detection_confidence IN ('high', 'medium', 'low', 'unknown')
                ),
                evidence_json TEXT,
                source TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_departures_detected_at
                ON departures (detected_at);

            CREATE INDEX IF NOT EXISTS idx_departures_direction_time
                ON departures (direction, detected_at);

            CREATE TABLE IF NOT EXISTS collector_runs (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                last_success_at TEXT,
                last_failure_at TEXT,
                last_http_status INTEGER,
                remaining_credits INTEGER,
                last_error TEXT,
                updated_at TEXT NOT NULL
            );

            INSERT OR IGNORE INTO collector_runs (id, updated_at)
                VALUES (1, datetime('now'));
        `
    }
])

function applyMigrations (database) {
    database.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL
        )
    `)

    const applied = new Set(
        database.prepare('SELECT version FROM schema_migrations').all()
            .map(row => row.version)
    )

    const insertMigration = database.prepare(`
        INSERT INTO schema_migrations (version, name, applied_at)
        VALUES (?, ?, ?)
    `)
    const runMigrations = database.transaction(() => {
        for (const migration of MIGRATIONS) {
            if (applied.has(migration.version)) {
                continue
            }

            database.exec(migration.sql)
            insertMigration.run(
                migration.version,
                migration.name,
                new Date().toISOString()
            )
        }
    })

    runMigrations()

    return MIGRATIONS.at(-1)?.version ?? 0
}

module.exports = {
    MIGRATIONS,
    applyMigrations
}
