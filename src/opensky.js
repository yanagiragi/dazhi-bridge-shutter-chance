// Request timeout and OAuth token settings are milliseconds/seconds used by the provider.
const DEFAULT_REQUEST_TIMEOUT_MS = 10000
const DEFAULT_TOKEN_LIFETIME_SECONDS = 300
const TOKEN_REFRESH_MARGIN_MS = 30000
const RATE_LIMIT_HEADER = 'x-rate-limit-remaining'

const DEFAULT_BASE_URL = 'https://opensky-network.org/api'
const DEFAULT_TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'

// OpenSky state-vector indexes (defined by the REST API response schema).
const STATE_ICAO24 = 0
const STATE_CALLSIGN = 1
const STATE_LONGITUDE = 5
const STATE_LATITUDE = 6
const STATE_BARO_ALTITUDE = 7
const STATE_ON_GROUND = 8
const STATE_VELOCITY = 9
const STATE_TRUE_TRACK = 10
const STATE_VERTICAL_RATE = 11
const STATE_GEO_ALTITUDE = 13

function normalizeOpenSkyState (state) {
    return {
        icao24: String(state[STATE_ICAO24] || '').toLowerCase(),
        callsign: state[STATE_CALLSIGN]
            ? String(state[STATE_CALLSIGN]).trim() || null
            : null,
        longitude: state[STATE_LONGITUDE] ?? null,
        latitude: state[STATE_LATITUDE] ?? null,
        baroAltitude: state[STATE_BARO_ALTITUDE] ?? null,
        geoAltitude: state[STATE_GEO_ALTITUDE] ?? null,
        velocity: state[STATE_VELOCITY] ?? null,
        trueTrack: state[STATE_TRUE_TRACK] ?? null,
        verticalRate: state[STATE_VERTICAL_RATE] ?? null,
        onGround: state[STATE_ON_GROUND] ? 1 : 0
    }
}

class OpenSkyClient {
    constructor ({
        clientId,
        clientSecret,
        fetchImpl = fetch,
        baseUrl = DEFAULT_BASE_URL,
        tokenUrl = DEFAULT_TOKEN_URL,
        timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
    } = {}) {
        this.clientId = clientId
        this.clientSecret = clientSecret
        this.fetchImpl = fetchImpl
        this.baseUrl = baseUrl.replace(/\/$/, '')
        this.tokenUrl = tokenUrl
        this.timeoutMs = timeoutMs
        this.token = null
    }

    async getToken () {
        if (this.hasValidToken()) {
            return this.token.value
        }

        if (!this.clientId || !this.clientSecret) {
            return null
        }

        const body = new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: this.clientId,
            client_secret: this.clientSecret
        })
        const response = await this.request(this.tokenUrl, {
            method: 'POST',
            headers: {
                'content-type': 'application/x-www-form-urlencoded'
            },
            body
        })

        if (!response.ok) {
            throw new Error(`OpenSky token request failed: HTTP ${response.status}`)
        }

        const payload = await response.json()
        if (!payload.access_token) {
            throw new Error('OpenSky token response missing access_token')
        }

        this.token = {
            value: payload.access_token,
            expiresAt: Date.now() + Number(payload.expires_in || DEFAULT_TOKEN_LIFETIME_SECONDS) * 1000
        }

        return this.token.value
    }

    async getStates (params = {}) {
        const token = await this.getToken()
        const url = new URL(`${this.baseUrl}/states/all`)

        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined && value !== null) {
                url.searchParams.set(key, String(value))
            }
        }

        const response = await this.request(url, {
            headers: token
                ? { authorization: `Bearer ${token}` }
                : {}
        })

        const remaining = response.headers.get(RATE_LIMIT_HEADER)
        if (!response.ok) {
            const error = new Error(
                `OpenSky states request failed: HTTP ${response.status}`
            )
            error.status = response.status
            throw error
        }

        const payload = await response.json()
        if (!payload || !Array.isArray(payload.states)) {
            throw new Error('OpenSky states response missing states array')
        }

        return {
            ...payload,
            remainingCredits: remaining === null ? null : Number(remaining)
        }
    }

    async getAircraft (bounds = {}) {
        const result = await this.getStates(bounds)
        return {
            aircraft: result.states.map(normalizeOpenSkyState),
            remainingCredits: result.remainingCredits
        }
    }

    async request (url, options = {}) {
        const controller = new AbortController()
        const timer = setTimeout(
            () => controller.abort(),
            this.timeoutMs
        )

        try {
            return await this.fetchImpl(url, {
                ...options,
                signal: controller.signal
            })
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('OpenSky request timed out')
            }
            throw error
        } finally {
            clearTimeout(timer)
        }
    }

    hasValidToken () {
        return this.token &&
            this.token.expiresAt > Date.now() + TOKEN_REFRESH_MARGIN_MS
    }
}

module.exports = {
    OpenSkyClient,
    normalizeOpenSkyState
}
