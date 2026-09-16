const {
    feetPerMinuteToMetresPerSecond,
    feetToMetres,
    knotsToMetresPerSecond,
    optionalNumber
} = require('./utils')

// adsb.fi exposes an ADS-B Exchange-compatible point query in nautical miles.
const DEFAULT_BASE_URL = 'https://opendata.adsb.fi/api/v3'
const DEFAULT_REQUEST_TIMEOUT_MS = 10000

// adsb.fi represents a ground target by the string "ground" in alt_baro.
const GROUND_ALTITUDE = 'ground'

function normalizeAdsbFiAircraft (aircraft) {
    const baroAltitude = aircraft.alt_baro === GROUND_ALTITUDE
        ? null
        : feetToMetres(aircraft.alt_baro)

    return {
        icao24: String(aircraft.hex || '').toLowerCase(),
        callsign: aircraft.flight
            ? String(aircraft.flight).trim() || null
            : null,
        longitude: optionalNumber(aircraft.lon),
        latitude: optionalNumber(aircraft.lat),
        baroAltitude,
        geoAltitude: feetToMetres(aircraft.alt_geom),
        velocity: knotsToMetresPerSecond(aircraft.gs),
        trueTrack: optionalNumber(aircraft.track),
        verticalRate: feetPerMinuteToMetresPerSecond(aircraft.baro_rate),
        onGround: aircraft.alt_baro === GROUND_ALTITUDE ? 1 : 0
    }
}

class AdsbFiClient {
    constructor ({
        fetchImpl = fetch,
        baseUrl = DEFAULT_BASE_URL,
        timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
    } = {}) {
        this.fetchImpl = fetchImpl
        this.baseUrl = baseUrl.replace(/\/$/, '')
        this.timeoutMs = timeoutMs
    }

    async getAircraft ({ latitude, longitude, distanceNm }) {
        const url = new URL(
            `${this.baseUrl}/lat/${latitude}/lon/${longitude}/dist/${distanceNm}`
        )
        const response = await this.request(url)

        if (!response.ok) {
            const error = new Error(
                `adsb.fi aircraft request failed: HTTP ${response.status}`
            )
            error.status = response.status
            throw error
        }

        const payload = await response.json()
        if (!payload || !Array.isArray(payload.ac)) {
            throw new Error('adsb.fi response missing ac array')
        }

        return {
            aircraft: payload.ac.map(normalizeAdsbFiAircraft),
            remainingCredits: null
        }
    }

    async request (url) {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), this.timeoutMs)

        try {
            return await this.fetchImpl(url, { signal: controller.signal })
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('adsb.fi request timed out')
            }
            throw error
        } finally {
            clearTimeout(timer)
        }
    }
}

module.exports = {
    AdsbFiClient,
    normalizeAdsbFiAircraft
}
