const test = require('node:test')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const { applyMigrations } = require('../src/migrations')
const { Collector } = require('../src/collector')
const { OpenSkyClient } = require('../src/opensky')

test('OpenSky client caches token and parses states', async () => {
    let calls = 0
    const client = new OpenSkyClient({ clientId: 'id', clientSecret: 'secret', baseUrl: 'https://api.test', tokenUrl: 'https://auth.test/token', fetchImpl: async (url) => { calls++; if (String(url) === 'https://auth.test/token') return new Response(JSON.stringify({ access_token: 'token', expires_in: 300 }), { status: 200, headers: { 'content-type': 'application/json' } }); return new Response(JSON.stringify({ states: [['ABC123', ' TEST ', null, 1, null, 121.55, 25.07, 100, false, 200, 270, 2, null, 110]] }), { status: 200, headers: { 'x-rate-limit-remaining': '42' } }) } })
    const result = await client.getStates({ lamin: 25 })
    assert.equal(result.remainingCredits, 42)
    assert.equal(calls, 2)
    await client.getStates()
    assert.equal(calls, 3)
})

test('collector retries 429 and records observations and run status', async () => {
    const database = new Database(':memory:'); applyMigrations(database)
    let attempts = 0
    const provider = { async getStates () { attempts++; if (attempts === 1) { const error = new Error('rate limited'); error.status = 429; throw error }; return { states: [['abc', 'CALL', null, 1, null, 121.55, 25.07, 100, true, 200, 280, 3, null, 110]], remainingCredits: 9 } } }
    const collector = new Collector({ database, provider, retryDelayMs: 1, now: () => new Date('2026-09-16T01:02:03Z') })
    const result = await collector.runOnce()
    assert.equal(result.count, 1); assert.equal(attempts, 2)
    assert.equal(database.prepare('SELECT count(*) AS count FROM aircraft_observations').get().count, 1)
    assert.equal(database.prepare('SELECT remaining_credits, last_error FROM collector_runs').get().remaining_credits, 9)
    database.close()
})

test('scheduler never overlaps tasks', async () => {
    const { startScheduler } = require('../src/scheduler')
    let active = 0; let max = 0
    const scheduler = startScheduler({ intervalMs: 5, task: async () => { active++; max = Math.max(max, active); await new Promise(resolve => setTimeout(resolve, 20)); active-- } })
    await scheduler.tick(); await new Promise(resolve => setTimeout(resolve, 30)); scheduler.stop()
    assert.equal(max, 1)
})
