import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'

const ARCHIVE_FILE_SUFFIX = '.jsonl.gz'

function localArchiveParts (value, timezone) {
    // en-CA requests stable numeric calendar parts; timezone controls which
    // local hour receives the response.
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(new Date(value))
    return Object.fromEntries(parts
        .filter(part => part.type !== 'literal')
        .map(part => [part.type, part.value]))
}

function safeSource (source) {
    if (!/^[a-z0-9-]+$/i.test(source)) {
        throw new Error('Archive source contains unsupported characters')
    }
    return source.toLowerCase()
}

class ProviderArchive {
    constructor ({ rootPath, timezone = 'Asia/Taipei' }) {
        this.rootPath = rootPath
        this.timezone = timezone
    }

    write ({ source, requestedAt, completedAt, payload }) {
        const provider = safeSource(source)
        const parts = localArchiveParts(requestedAt, this.timezone)
        const relativePath = join(
            provider,
            parts.year,
            parts.month,
            `${parts.year}-${parts.month}-${parts.day}-${parts.hour}` +
                ARCHIVE_FILE_SUFFIX
        )
        const archivePath = join(this.rootPath, relativePath)
        const entry = JSON.stringify({
            requestedAt,
            completedAt,
            source: provider,
            payload
        }) + '\n'

        mkdirSync(dirname(archivePath), { recursive: true })
        // Each append is an independent gzip member. Standard gzip readers
        // concatenate members, while an interrupted write affects only the
        // newest response instead of the entire hourly archive.
        appendFileSync(archivePath, gzipSync(entry))
        return relativePath
    }
}

export {
    ProviderArchive,
    localArchiveParts
}
