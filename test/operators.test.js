import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
import test from 'node:test'
import {
    loadOperatorCatalog,
    validateOperatorCatalog
} from '../src/operator-catalog.js'
import {
    parseFaaOperators,
    parseWikidataOperators,
    resolveOperatorCandidates
} from '../src/operator-resolver.js'
import {
    extractOperatorCandidate,
    findUnknownOperatorCandidates,
    resolveRequested
} from '../scripts/audit-callsigns.js'

const OPERATOR_CATALOG_PATH = join(
    __dirname,
    '..',
    'config',
    'operators.json'
)

test('operator candidate parsing rejects ambiguous identifiers', () => {
    assert.equal(extractOperatorCandidate('CCA470'), 'CCA')
    assert.equal(extractOperatorCandidate(' twy123 '), 'TWY')
    assert.equal(extractOperatorCandidate('0917'), null)
    assert.equal(extractOperatorCandidate('N111UB'), null)
    assert.equal(extractOperatorCandidate('B91688'), null)
    assert.equal(extractOperatorCandidate('CCA'), null)
})

test('unknown operator audit groups candidates and ignores allowlisted codes', () => {
    const candidates = findUnknownOperatorCandidates([
        { callsign: 'CCA470', occurrences: 4 },
        { callsign: 'TWY123', occurrences: 2 },
        { callsign: 'TWY456', occurrences: 3 },
        { callsign: '0917', occurrences: 8 }
    ], new Set(['CCA']))

    assert.deepEqual(candidates, [{ code: 'TWY', occurrences: 5 }])
})

test('operator catalog contains known operators and localized names', () => {
    const catalog = loadOperatorCatalog(OPERATOR_CATALOG_PATH)
    const codes = catalog.operators.map(operator => operator.code)

    assert.ok(codes.includes('CCA'))
    assert.equal(
        catalog.operators.find(operator => operator.code === 'EVA').iataCode,
        'BR'
    )
})

function operatorCatalogEntry (iataCode, includeIataCode = true) {
    const operator = {
        code: 'VJT',
        locales: {
            en: { short: 'VistaJet', name: 'VistaJet' },
            'zh-TW': {
                short: '維思達公務機',
                name: '維思達公務機'
            }
        }
    }
    if (includeIataCode) operator.iataCode = iataCode
    return { version: 1, operators: [operator] }
}

test('operator catalog accepts explicit null IATA codes', () => {
    assert.doesNotThrow(() =>
        validateOperatorCatalog(operatorCatalogEntry(null))
    )
    assert.throws(
        () => validateOperatorCatalog(operatorCatalogEntry(null, false)),
        /valid IATA code or null/
    )
    assert.throws(
        () => validateOperatorCatalog(operatorCatalogEntry('5')),
        /valid IATA code or null/
    )
})

test('default catalog records VistaJet without an IATA code', () => {
    const catalog = loadOperatorCatalog(OPERATOR_CATALOG_PATH)
    const vistaJet = catalog.operators.find(operator =>
        operator.code === 'VJT'
    )

    assert.equal(vistaJet.iataCode, null)
    assert.equal(vistaJet.locales.en.name, 'VistaJet')
})

test('FAA parser extracts current operator source fields', () => {
    const operators = parseFaaOperators(`
        <table>
            <tr><th>Code</th><th>Name</th></tr>
            <tr>
                <td>VJT</td>
                <td>VISTAJET LTD</td>
                <td>MALTA</td>
                <td>VISTA JET</td>
            </tr>
            <tr>
                <td>ESR</td>
                <td>EASTAR JET</td>
                <td>REPUBLIC OF KOREA</td>
                <td>EASTAR</td>
            </tr>
        </table>
    `)

    assert.deepEqual(operators.get('VJT'), {
        code: 'VJT',
        name: 'VISTAJET LTD',
        country: 'MALTA',
        telephony: 'VISTA JET'
    })
})

test('Wikidata parser merges localized rows and prefers zh-TW', () => {
    const shared = {
        airline: { value: 'https://www.wikidata.org/entity/Q1' },
        icao: { value: 'ESR' },
        iata: { value: 'ZE' },
        englishName: { value: 'Eastar Jet', 'xml:lang': 'en' }
    }
    const operators = parseWikidataOperators({
        results: {
            bindings: [
                {
                    ...shared,
                    traditionalChineseName: {
                        value: '易斯達航空',
                        'xml:lang': 'zh'
                    }
                },
                {
                    ...shared,
                    traditionalChineseName: {
                        value: '易斯達航空',
                        'xml:lang': 'zh-tw'
                    }
                }
            ]
        }
    })

    assert.deepEqual(operators.get('ESR'), [{
        entity: 'https://www.wikidata.org/entity/Q1',
        iataCode: 'ZE',
        englishName: 'Eastar Jet',
        traditionalChineseName: '易斯達航空',
        traditionalChineseLanguage: 'zh-tw'
    }])
})

test('operator resolver returns sourced suggestions without catalog writes',
    async () => {
        const requestedUrls = []
        const fetchImpl = async url => {
            requestedUrls.push(String(url))
            if (String(url).includes('faa.gov')) {
                return {
                    ok: true,
                    text: async () => `
                        <tr>
                            <td>ESR</td><td>EASTAR JET</td>
                            <td>REPUBLIC OF KOREA</td><td>EASTAR</td>
                        </tr>
                    `
                }
            }
            return {
                ok: true,
                json: async () => ({
                    results: {
                        bindings: [{
                            airline: {
                                value: 'https://www.wikidata.org/entity/Q2'
                            },
                            icao: { value: 'ESR' },
                            iata: { value: 'ZE' },
                            englishName: { value: 'Eastar Jet' },
                            traditionalChineseName: {
                                value: '易斯達航空',
                                'xml:lang': 'zh-tw'
                            }
                        }]
                    }
                })
            }
        }

        const result = await resolveOperatorCandidates(
            [{ code: 'ESR', occurrences: 2 }],
            { fetchImpl }
        )

        assert.equal(result.writesCatalog, false)
        assert.equal(requestedUrls.length, 2)
        assert.match(result.sources.faa, /faa\.gov/)
        assert.match(result.sources.wikidata, /wikidata\.org/)
        assert.deepEqual(result.candidates[0].suggestedFields, {
            code: 'ESR',
            iataCode: 'ZE',
            locales: {
                en: {
                    short: 'Eastar Jet',
                    name: 'Eastar Jet'
                },
                'zh-TW': {
                    short: '易斯達航空',
                    name: '易斯達航空'
                }
            }
        })
        assert.deepEqual(result.candidates[0].faa, {
            code: 'ESR',
            name: 'EASTAR JET',
            country: 'REPUBLIC OF KOREA',
            telephony: 'EASTAR'
        })
    })

test('operator resolver leaves ambiguous IATA matches unresolved', async () => {
    const fetchImpl = async url => {
        if (String(url).includes('faa.gov')) {
            return {
                ok: true,
                text: async () =>
                    '<tr><td>VJT</td><td>VISTAJET LTD</td>' +
                    '<td>MALTA</td><td>VISTA JET</td></tr>'
            }
        }
        const binding = (entity, iataCode, name) => ({
            airline: { value: entity },
            icao: { value: 'VJT' },
            iata: iataCode ? { value: iataCode } : undefined,
            englishName: { value: name }
        })
        return {
            ok: true,
            json: async () => ({
                results: {
                    bindings: [
                        binding('https://example.test/current', null, 'VistaJet'),
                        binding('https://example.test/old', '5V', 'Vistajet')
                    ]
                }
            })
        }
    }

    const result = await resolveOperatorCandidates(
        [{ code: 'VJT', occurrences: 1 }],
        { fetchImpl }
    )
    const candidate = result.candidates[0]

    assert.equal(candidate.suggestedFields.iataCode, null)
    assert.ok(candidate.reviewNotes.some(note =>
        note.includes('Multiple Wikidata records')
    ))
})

test('callsign audit only accepts the resolve flag', () => {
    assert.equal(resolveRequested([]), false)
    assert.equal(resolveRequested(['--resolve']), true)
    assert.throws(() => resolveRequested(['--write']), /Unknown argument/)
})
