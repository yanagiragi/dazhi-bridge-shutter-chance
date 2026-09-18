// Unit conversion factors used when provider payloads are not metric.
const FEET_TO_METRES = 0.3048
const KNOTS_TO_METRES_PER_SECOND = 0.514444
const FEET_PER_MINUTE_TO_METRES_PER_SECOND = FEET_TO_METRES / 60

// Returns a numeric input unchanged, or null for missing and non-numeric data.
function optionalNumber (value) {
    return Number.isFinite(value) ? value : null
}

function feetToMetres (value) {
    return optionalNumber(value) === null ? null : value * FEET_TO_METRES
}

function knotsToMetresPerSecond (value) {
    return optionalNumber(value) === null
        ? null
        : value * KNOTS_TO_METRES_PER_SECOND
}

function feetPerMinuteToMetresPerSecond (value) {
    return optionalNumber(value) === null
        ? null
        : value * FEET_PER_MINUTE_TO_METRES_PER_SECOND
}

export {
    feetPerMinuteToMetresPerSecond,
    feetToMetres,
    knotsToMetresPerSecond,
    optionalNumber
}
