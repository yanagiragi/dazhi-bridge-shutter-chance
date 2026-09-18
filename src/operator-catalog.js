import { readFileSync } from 'node:fs'

// ICAO operator designators contain exactly three uppercase Latin letters.
const OPERATOR_CODE_PATTERN = /^[A-Z]{3}$/
// Assigned IATA airline designators contain two uppercase letters or digits.
// Operators without an assigned IATA designator explicitly use null.
const IATA_CODE_PATTERN = /^[A-Z0-9]{2}$/
// Every catalog entry must provide labels for each dashboard locale.
const SUPPORTED_OPERATOR_LOCALES = Object.freeze(['en', 'zh-TW'])

function validateLocalizedName (operator, locale) {
    const localized = operator.locales?.[locale]
    if (!localized || typeof localized.short !== 'string' ||
        localized.short.length === 0 || typeof localized.name !== 'string' ||
        localized.name.length === 0) {
        throw new Error(
            `Operator ${operator.code} requires short and name for ${locale}`
        )
    }
}

function validateOperatorCatalog (catalog) {
    if (catalog?.version !== 1 || !Array.isArray(catalog.operators)) {
        throw new Error(
            'Operator catalog must use version 1 and an operators array'
        )
    }

    const codes = new Set()
    for (const operator of catalog.operators) {
        if (!OPERATOR_CODE_PATTERN.test(operator?.code || '')) {
            throw new Error('Operator codes must use three uppercase letters')
        }
        const hasIataCode = Object.prototype.hasOwnProperty.call(
            operator,
            'iataCode'
        )
        if (!hasIataCode || (operator.iataCode !== null &&
            !IATA_CODE_PATTERN.test(operator.iataCode))) {
            throw new Error(
                `Operator ${operator?.code || 'unknown'} requires a valid ` +
                'IATA code or null'
            )
        }
        if (codes.has(operator.code)) {
            throw new Error(`Duplicate operator code: ${operator.code}`)
        }
        for (const locale of SUPPORTED_OPERATOR_LOCALES) {
            validateLocalizedName(operator, locale)
        }
        codes.add(operator.code)
    }

    return catalog
}

function loadOperatorCatalog (catalogPath) {
    const contents = readFileSync(catalogPath, 'utf8')
    return validateOperatorCatalog(JSON.parse(contents))
}

export {
    loadOperatorCatalog,
    validateOperatorCatalog
}
