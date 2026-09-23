import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { ProviderArchive } from '../src/provider-archive.js'

test('provider archive appends readable gzip members by local hour', t => {
    const directory = mkdtempSync(join(tmpdir(), 'dazhi-archive-'))
    const archive = new ProviderArchive({
        rootPath: directory,
        timezone: 'Asia/Taipei'
    })
    t.after(() => rmSync(directory, { recursive: true, force: true }))

    const firstPath = archive.write({
        source: 'adsbfi',
        requestedAt: '2026-09-23T06:01:00.000Z',
        completedAt: '2026-09-23T06:01:01.000Z',
        payload: { total: 1, ac: [{ hex: 'abc123', wd: 72, ws: 11 }] }
    })
    const secondPath = archive.write({
        source: 'adsbfi',
        requestedAt: '2026-09-23T06:02:00.000Z',
        completedAt: '2026-09-23T06:02:01.000Z',
        payload: { total: 0, ac: [] }
    })

    assert.equal(firstPath, secondPath)
    assert.equal(
        firstPath,
        join('adsbfi', '2026', '09', '2026-09-23-14.jsonl.gz')
    )
    const entries = gunzipSync(readFileSync(join(directory, firstPath)))
        .toString('utf8')
        .trim()
        .split('\n')
        .map(line => JSON.parse(line))
    assert.equal(entries.length, 2)
    assert.equal(entries[0].payload.ac[0].wd, 72)
    assert.equal(entries[1].payload.total, 0)
})
