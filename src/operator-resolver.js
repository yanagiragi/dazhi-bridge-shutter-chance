// FAA JO 7340.2 is the primary source for current ICAO three-letter operator
// designators, company names, countries, and radio telephony names.
const FAA_DESIGNATOR_URL = 'https://www.faa.gov/air_traffic/publications/atpubs/cnt_html/chap3_section_3.html'
// Wikidata supplies CC0 candidate IATA codes and localized names. Its data is
// community-maintained, so resolver output always requires human review.
const WIKIDATA_QUERY_URL = 'https://query.wikidata.org/sparql'
// Identify this low-volume maintenance client to public data services.
const RESOLVER_USER_AGENT = 'dazhi-bridge-shutter-chance operator-catalog-audit'
// Resolver input is restricted to exact ICAO-style operator codes.
const OPERATOR_CODE_PATTERN = /^[A-Z]{3}$/
// Prefer the locale most specific to this dashboard when Wikidata returns
// multiple Traditional Chinese labels for the same operator entity.
const TRADITIONAL_CHINESE_LANGUAGE_PRIORITY = ['zh-tw', 'zh-hant', 'zh']

const HTML_ENTITIES = Object.freeze({
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"'
})

function decodeHtml (value) {
    return value.replace(
        /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi,
        (match, decimal, hexadecimal, named) => {
            if (decimal) return String.fromCodePoint(Number(decimal))
            if (hexadecimal) {
                return String.fromCodePoint(Number.parseInt(hexadecimal, 16))
            }
            return HTML_ENTITIES[named.toLowerCase()] ?? match
        }
    )
}

function htmlText (value) {
    return decodeHtml(value.replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim()
}

function parseFaaOperators (html) {
    const operators = new Map()
    const rows = html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)

    for (const row of rows) {
        const cells = [...row[1].matchAll(
            /<td\b[^>]*>([\s\S]*?)<\/td>/gi
        )].map(match => htmlText(match[1]))
        if (cells.length < 4 || !OPERATOR_CODE_PATTERN.test(cells[0])) {
            continue
        }
        operators.set(cells[0], {
            code: cells[0],
            name: cells[1],
            country: cells[2],
            telephony: cells[3] || null
        })
    }

    return operators
}

function buildWikidataQuery (codes) {
    const values = codes.map(code => `"${code}"`).join(' ')
    return `
        SELECT ?airline ?icao ?iata ?englishName ?traditionalChineseName
        WHERE {
            VALUES ?icao { ${values} }
            ?airline wdt:P230 ?icao.
            OPTIONAL { ?airline wdt:P229 ?iata. }
            OPTIONAL {
                ?airline rdfs:label ?englishName.
                FILTER(LANG(?englishName) = "en")
            }
            OPTIONAL {
                ?airline rdfs:label ?traditionalChineseName.
                FILTER(LANG(?traditionalChineseName) IN
                    ("zh-tw", "zh-hant", "zh"))
            }
        }
        ORDER BY ?icao ?airline
    `
}

function bindingValue (binding, name) {
    return binding?.[name]?.value ?? null
}

function chineseLabelPriority (binding) {
    const language = binding?.traditionalChineseName?.['xml:lang']
    return TRADITIONAL_CHINESE_LANGUAGE_PRIORITY.indexOf(language)
}

function parseWikidataOperators (payload) {
    const operators = new Map()
    const bindings = payload?.results?.bindings
    if (!Array.isArray(bindings)) {
        throw new Error('Wikidata response does not contain result bindings')
    }

    for (const binding of bindings) {
        const code = bindingValue(binding, 'icao')
        if (!OPERATOR_CODE_PATTERN.test(code || '')) continue

        const existing = operators.get(code) || []
        const entity = bindingValue(binding, 'airline')
        const iataCode = bindingValue(binding, 'iata')
        let record = existing.find(item =>
            item.entity === entity && item.iataCode === iataCode
        )
        if (!record) {
            record = {
                entity,
                iataCode,
                englishName: bindingValue(binding, 'englishName'),
                traditionalChineseName: null,
                traditionalChineseLanguage: null
            }
            existing.push(record)
            operators.set(code, existing)
        }

        const nextChineseName = bindingValue(
            binding,
            'traditionalChineseName'
        )
        const nextPriority = chineseLabelPriority(binding)
        const currentPriority = TRADITIONAL_CHINESE_LANGUAGE_PRIORITY.indexOf(
            record.traditionalChineseLanguage
        )
        if (nextChineseName && (record.traditionalChineseName === null ||
            nextPriority < currentPriority)) {
            record.traditionalChineseName = nextChineseName
            record.traditionalChineseLanguage =
                binding.traditionalChineseName['xml:lang']
        }
    }

    return operators
}

async function fetchSource (url, format, fetchImpl) {
    const response = await fetchImpl(url, {
        headers: {
            accept: format === 'json'
                ? 'application/sparql-results+json'
                : 'text/html',
            'user-agent': RESOLVER_USER_AGENT
        }
    })
    if (!response.ok) {
        throw new Error(`Source request failed with HTTP ${response.status}`)
    }
    return format === 'json' ? response.json() : response.text()
}

function reviewNotes (faa, wikidata) {
    const notes = ['Human review is required before editing the catalog.']
    if (!faa) notes.push('No current FAA operator record was found.')
    if (wikidata.length === 0) {
        notes.push('No Wikidata operator record was found.')
    } else if (wikidata.length > 1) {
        notes.push('Multiple Wikidata records matched this ICAO code.')
    } else if (!wikidata[0].iataCode) {
        notes.push('The matched operator has no candidate IATA code.')
    }
    return notes
}

function suggestedFields (code, faa, wikidata) {
    const uniqueWikidata = wikidata.length === 1 ? wikidata[0] : null
    const englishName =
        uniqueWikidata?.englishName ?? faa?.name ?? null
    const traditionalChineseName =
        uniqueWikidata?.traditionalChineseName ?? null
    return {
        code,
        iataCode: uniqueWikidata?.iataCode ?? null,
        locales: {
            en: {
                short: englishName,
                name: englishName
            },
            'zh-TW': {
                short: traditionalChineseName,
                name: traditionalChineseName
            }
        }
    }
}

async function resolveOperatorCandidates (
    candidates,
    { fetchImpl = fetch } = {}
) {
    const codes = candidates.map(candidate => candidate.code)
    if (codes.some(code => !OPERATOR_CODE_PATTERN.test(code))) {
        throw new Error('Resolver candidates must use three uppercase letters')
    }
    if (codes.length === 0) {
        return {
            generatedAt: new Date().toISOString(),
            writesCatalog: false,
            sources: {
                faa: FAA_DESIGNATOR_URL,
                wikidata: WIKIDATA_QUERY_URL
            },
            candidates: []
        }
    }

    const wikidataUrl = new URL(WIKIDATA_QUERY_URL)
    wikidataUrl.searchParams.set('query', buildWikidataQuery(codes))
    wikidataUrl.searchParams.set('format', 'json')
    const [faaHtml, wikidataPayload] = await Promise.all([
        fetchSource(FAA_DESIGNATOR_URL, 'text', fetchImpl),
        fetchSource(wikidataUrl, 'json', fetchImpl)
    ])
    const faaOperators = parseFaaOperators(faaHtml)
    const wikidataOperators = parseWikidataOperators(wikidataPayload)

    return {
        generatedAt: new Date().toISOString(),
        writesCatalog: false,
        sources: {
            faa: FAA_DESIGNATOR_URL,
            wikidata: WIKIDATA_QUERY_URL
        },
        candidates: candidates.map(candidate => {
            const faa = faaOperators.get(candidate.code) ?? null
            const wikidata = wikidataOperators.get(candidate.code) ?? []
            return {
                ...candidate,
                faa,
                wikidata,
                suggestedFields: suggestedFields(
                    candidate.code,
                    faa,
                    wikidata
                ),
                reviewNotes: reviewNotes(faa, wikidata)
            }
        })
    }
}

export {
    FAA_DESIGNATOR_URL,
    WIKIDATA_QUERY_URL,
    buildWikidataQuery,
    parseFaaOperators,
    parseWikidataOperators,
    resolveOperatorCandidates
}
