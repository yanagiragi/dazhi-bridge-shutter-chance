(() => {
    const SUPPORTED_LANGUAGES = ['en', 'zh-TW']
    const DEFAULT_LANGUAGE = 'zh-TW'
    const LANGUAGE_STORAGE_KEY = 'language'
    // Theme is persisted after an explicit choice; otherwise it follows the OS.
    const THEME_STORAGE_KEY = 'theme'
    const LIGHT_THEME = 'light'
    const DARK_THEME = 'dark'
    const SUPPORTED_THEMES = [LIGHT_THEME, DARK_THEME]
    const REFRESH_INTERVAL_MS = 60 * 1000
    const EMPTY_VALUE = '--'
    // Dashboard endpoints and the provider ID that requires attribution.
    const DASHBOARD_STATUS_URL = './dashboard-data.json'
    // Favicon colors identify the current dashboard data/detail mode.
    const FAVICON_PATHS = {
        summary: './favicon-summary.svg',
        precise: './favicon-precise.svg',
        snapshot: './favicon-snapshot.svg'
    }

    const SNAPSHOT_STATUS_URL = './data/status.json'
    const WEB_CONFIG_URL = './web-config.json'
    const OPERATORS_URL = './operators.json'
    const ADSB_FI_PROVIDER = 'adsbfi'
    const FLIGHTRADAR24_BASE_URL =
        'https://www.flightradar24.com/data/flights/'
    const FLIGHTRADAR24_CALLSIGN_BASE_URL =
        'https://www.flightradar24.com/'


    // Active-window values use a validated 24-hour HH:mm representation.
    const SCHEDULE_TIME_PATTERN = /^([01][0-9]|2[0-3]):([0-5][0-9])$/

    // ADS-B airline callsigns begin with an ICAO three-letter operator code.
    // The remaining characters must be non-empty and alphanumeric so aircraft
    // registrations and malformed values are not guessed as airline flights.
    const AIRLINE_CALLSIGN_PATTERN = /^([A-Z]{3})([A-Z0-9]+)$/

    // Numeric-only ADS-B identifiers can be operator-defined values such as a
    // date. They must not be presented as reliable commercial flight numbers.
    const NUMERIC_CALLSIGN_PATTERN = /^\d+$/
    const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
    const TRACK_VIEWBOX_WIDTH = 640
    const TRACK_VIEWBOX_HEIGHT = 240
    const TRACK_VIEWBOX_PADDING = 36
    // Compass offsets use SVG viewBox units. Keeping the east label on the
    // right padding line gives it the same border distance as the north label.
    const TRACK_COMPASS_ORIGIN_OFFSET = 32
    const TRACK_COMPASS_LABEL_OFFSET = 28
    const TRACK_COMPASS_LINE_START_OFFSET = 8
    const TRACK_COMPASS_AXIS_LENGTH = 22
    const TRACK_COMPASS_LABEL_BASELINE_OFFSET = 5
    const TRACK_MINIMUM_SPAN = 0.002
    const DEGREES_TO_RADIANS = Math.PI / 180
    const TRACK_COORDINATE_PRECISION = 1
    const METRIC_VALUE_PRECISION = 1
    const LONGITUDE_VALUE_PRECISION = 4

    // Official threshold coordinates from Taiwan CAA eAIP RCSS AD 2.12,
    // AIRAC AIP AMDT 02-26. RWY 10 is west; RWY 28 is east.
    const RUNWAY_THRESHOLDS = [
        { label: '10', latitude: 25.07005, longitude: 121.539622 },
        { label: '28', latitude: 25.069136, longitude: 121.565425 }
    ]

    const RECOMMENDATION_STYLES = {
        high: 'good',
        medium: 'possible',
        low: 'low',
        insufficient: 'insufficient'
    }
    const translations = {}
    let operatorsByCode = new Map()
    let language = getInitialLanguage()
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
    let theme = getInitialTheme()
    document.documentElement.dataset.theme = theme
    let latestPayload = null
    let dataSource = 'api'
    let trackDiagramSequence = 0

    function getInitialLanguage () {
        const storedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY)
        return SUPPORTED_LANGUAGES.includes(storedLanguage)
            ? storedLanguage
            : DEFAULT_LANGUAGE
    }

    function getInitialTheme () {
        const storedTheme = localStorage.getItem(THEME_STORAGE_KEY)
        if (SUPPORTED_THEMES.includes(storedTheme)) return storedTheme
        return systemTheme.matches ? DARK_THEME : LIGHT_THEME
    }

    function applyTheme () {
        const nextTheme = theme === DARK_THEME ? LIGHT_THEME : DARK_THEME
        const themeButton = element('theme')

        document.documentElement.dataset.theme = theme
        themeButton.textContent = translate('theme.' + nextTheme)
        themeButton.setAttribute(
            'aria-label',
            translate('theme.' + nextTheme + 'Label')
        )
    }

    function element (id) {
        return document.getElementById(id)
    }

    function translate (key) {
        return translations[language]?.[key] || key
    }

    function localDateKey (value, timezone) {
        if (!value) return null

        // en-CA is used only to assemble a stable year-month-day key. The
        // supplied timeZone determines the calendar date.
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(new Date(value))
        const values = Object.fromEntries(parts
            .filter(part => part.type !== 'literal')
            .map(part => [part.type, part.value]))
        return `${values.year}-${values.month}-${values.day}`
    }

    function formatScheduleTime (value, timezone) {
        if (!value) return EMPTY_VALUE

        return new Intl.DateTimeFormat(language, {
            timeZone: timezone,
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        }).format(new Date(value))
    }

    function formatScheduleClock (value) {
        const match = typeof value === 'string'
            ? value.match(SCHEDULE_TIME_PATTERN)
            : null
        if (!match) return EMPTY_VALUE

        const date = new Date(Date.UTC(2000, 0, 1, match[1], match[2]))
        return new Intl.DateTimeFormat(language, {
            timeZone: 'UTC',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        }).format(date)
    }

    function formatScheduleRange (schedule) {
        if (!schedule?.start || !schedule?.end) return null

        const range = formatScheduleClock(schedule.start) + '–' +
            formatScheduleClock(schedule.end)
        return translate('collection.hours') + ' ' + range
    }

    function joinStatusDetails (...details) {
        return details.filter(Boolean).join('\n')
    }

    function formatCollectionStatus (advice, collector) {
        const schedule = advice.collectionSchedule
        const scheduleDetail = formatScheduleRange(schedule)

        if (collector?.state === 'outside_schedule' ||
            advice.freshness === 'outside_schedule') {
            let title = translate('collection.paused')
            let nextUpdate = null

            if (schedule?.nextStartAt) {
                const nextDate = localDateKey(
                    schedule.nextStartAt,
                    schedule.timezone
                )
                if (nextDate > schedule.date) {
                    title = translate('collection.ended')
                }
                nextUpdate = translate('collection.nextUpdate') + ' ' +
                    formatScheduleTime(
                        schedule.nextStartAt,
                        schedule.timezone
                    )
            }

            return {
                state: 'paused',
                title,
                detail: joinStatusDetails(scheduleDetail, nextUpdate)
            }
        }

        if (collector?.state === 'error' ||
            advice.freshness === 'expired') {
            return {
                state: 'error',
                title: translate('collection.interrupted'),
                detail: scheduleDetail
            }
        }

        if (!collector || collector.state === 'never' ||
            advice.freshness === 'unknown') {
            return {
                state: 'waiting',
                title: translate('collection.waiting'),
                detail: scheduleDetail
            }
        }

        if (advice.freshness === 'stale') {
            return {
                state: 'delayed',
                title: translate('collection.delayed'),
                detail: scheduleDetail
            }
        }

        return {
            state: 'active',
            title: translate('collection.collecting'),
            detail: scheduleDetail
        }
    }

    function formatTime (value) {
        if (!value) return EMPTY_VALUE

        const date = new Date(value)
        if (Number.isNaN(date.getTime())) return EMPTY_VALUE

        return date.toLocaleTimeString(language, {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        })
    }

    async function loadTranslations (locale) {
        if (translations[locale]) return

        const response = await fetch(`./locales/${locale}.json`)
        if (!response.ok) {
            throw new Error(`Unable to load locale: ${locale}`)
        }
        translations[locale] = await response.json()
    }

    async function loadOperators () {
        const response = await fetch(OPERATORS_URL)
        if (!response.ok) throw new Error('Unable to load operator allowlist')

        const payload = await response.json()
        if (payload.version !== 1 || !Array.isArray(payload.operators)) {
            throw new Error('Operator catalog must use version 1')
        }
        operatorsByCode = new Map(payload.operators.map(operator => [
            operator.code,
            operator
        ]))
    }

    function findOperator (callsign) {
        if (typeof callsign !== 'string') return null

        const match = callsign.trim().toUpperCase().match(
            AIRLINE_CALLSIGN_PATTERN
        )
        if (!match) return null

        const code = match[1]
        const operator = operatorsByCode.get(code)
        if (!operator) return null
        const localized = operator.locales?.[language] ||
            operator.locales?.en
        if (!localized) return null

        return {
            iataCode: operator.iataCode,
            shortName: localized.short,
            name: localized.name
        }
    }

    function flightradar24Url (callsign) {
        if (typeof callsign !== 'string') return null

        const normalizedCallsign = callsign.trim().toUpperCase()
        const match = normalizedCallsign.match(AIRLINE_CALLSIGN_PATTERN)
        const operator = match ? operatorsByCode.get(match[1]) : null

        if (match && operator) {
            const flightPrefix = operator.iataCode || match[1]
            const flightDesignator = flightPrefix + match[2]
            return FLIGHTRADAR24_BASE_URL +
                encodeURIComponent(flightDesignator.toLowerCase())
        }

        if (!normalizedCallsign ||
            NUMERIC_CALLSIGN_PATTERN.test(normalizedCallsign) ||
            !/^[A-Z0-9]+$/.test(normalizedCallsign)) {
            return null
        }

        return FLIGHTRADAR24_CALLSIGN_BASE_URL +
            encodeURIComponent(normalizedCallsign)
    }

    function createFlightVerificationLink (callsign) {
        const url = flightradar24Url(callsign)
        if (!url) return null

        const link = createTextElement(
            'a',
            'flight-verification',
            translate('details.verifyOnFlightradar24')
        )
        link.href = url
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
        return link
    }

    function displayCallsign (callsign) {
        if (typeof callsign !== 'string' ||
            NUMERIC_CALLSIGN_PATTERN.test(callsign.trim())) {
            return translate('flight.unidentified')
        }
        return callsign
    }

    function createTextElement (tagName, className, text) {
        const node = document.createElement(tagName)
        node.className = className
        node.textContent = text
        return node
    }

    function svgNode (name, attributes = {}) {
        const node = document.createElementNS(SVG_NAMESPACE, name)
        for (const [key, value] of Object.entries(attributes)) {
            node.setAttribute(key, value)
        }
        return node
    }

    function formatNumber (value, digits = METRIC_VALUE_PRECISION) {
        if (!Number.isFinite(value)) return EMPTY_VALUE
        return value.toLocaleString(language, {
            maximumFractionDigits: digits
        })
    }

    function projectTrack (track) {
        const allPoints = [...RUNWAY_THRESHOLDS, ...track]
        const referenceLatitude = allPoints.reduce(
            (total, point) => total + point.latitude,
            0
        ) / allPoints.length
        const longitudeScale = Math.cos(
            referenceLatitude * DEGREES_TO_RADIANS
        )
        const geographicPoints = allPoints.map(point => ({
            x: point.longitude * longitudeScale,
            y: point.latitude
        }))
        const xValues = geographicPoints.map(point => point.x)
        const yValues = geographicPoints.map(point => point.y)
        const minimumX = Math.min(...xValues)
        const maximumX = Math.max(...xValues)
        const minimumY = Math.min(...yValues)
        const maximumY = Math.max(...yValues)
        const xSpan = Math.max(maximumX - minimumX, TRACK_MINIMUM_SPAN)
        const ySpan = Math.max(maximumY - minimumY, TRACK_MINIMUM_SPAN)
        const drawableWidth = TRACK_VIEWBOX_WIDTH - 2 * TRACK_VIEWBOX_PADDING
        const drawableHeight = TRACK_VIEWBOX_HEIGHT - 2 * TRACK_VIEWBOX_PADDING
        const scale = Math.min(drawableWidth / xSpan, drawableHeight / ySpan)
        const centreX = (minimumX + maximumX) / 2
        const centreY = (minimumY + maximumY) / 2

        return point => ({
            x: TRACK_VIEWBOX_WIDTH / 2 +
                (point.longitude * longitudeScale - centreX) * scale,
            y: TRACK_VIEWBOX_HEIGHT / 2 -
                (point.latitude - centreY) * scale
        })
    }

    function appendRunway (svg, project) {
        const start = project(RUNWAY_THRESHOLDS[0])
        const end = project(RUNWAY_THRESHOLDS[1])
        svg.append(svgNode('line', {
            x1: start.x,
            y1: start.y,
            x2: end.x,
            y2: end.y,
            class: 'track-runway'
        }))

        RUNWAY_THRESHOLDS.forEach(threshold => {
            const position = project(threshold)
            const label = svgNode('text', {
                x: position.x,
                y: position.y - 12,
                class: 'track-runway-label',
                'text-anchor': 'middle'
            })
            label.textContent = threshold.label
            svg.append(label)
        })
    }

    function appendCompassIndicator (svg) {
        const eastLabelX = TRACK_VIEWBOX_WIDTH - TRACK_VIEWBOX_PADDING
        const x = eastLabelX - TRACK_COMPASS_LABEL_OFFSET
        const top = TRACK_VIEWBOX_PADDING
        const originY = top + TRACK_COMPASS_ORIGIN_OFFSET
        const northLabel = svgNode('text', {
            x,
            y: top,
            class: 'track-compass-label',
            'text-anchor': 'middle'
        })
        northLabel.textContent = 'N'
        const eastLabel = svgNode('text', {
            x: eastLabelX,
            y: originY + TRACK_COMPASS_LABEL_BASELINE_OFFSET,
            class: 'track-compass-label',
            'text-anchor': 'middle'
        })
        eastLabel.textContent = 'E'
        svg.append(
            northLabel,
            svgNode('line', {
                x1: x,
                y1: top + TRACK_COMPASS_LINE_START_OFFSET,
                x2: x,
                y2: originY,
                class: 'track-compass-line'
            }),
            svgNode('line', {
                x1: x,
                y1: originY,
                x2: x + TRACK_COMPASS_AXIS_LENGTH,
                y2: originY,
                class: 'track-compass-line'
            }),
            eastLabel
        )
    }

    function createTrackDiagram (track) {
        if (!Array.isArray(track) || track.length < 2) {
            return createTextElement(
                'p',
                'muted',
                translate('details.trackUnavailable')
            )
        }

        const svg = svgNode('svg', {
            class: 'track-diagram',
            viewBox: '0 0 ' + TRACK_VIEWBOX_WIDTH + ' ' +
                TRACK_VIEWBOX_HEIGHT,
            role: 'img',
            'aria-label': translate('details.trackAria')
        })
        const project = projectTrack(track)
        const markerId = 'track-arrow-' + ++trackDiagramSequence
        const marker = svgNode('marker', {
            id: markerId,
            viewBox: '0 0 10 10',
            refX: 8,
            refY: 5,
            markerWidth: 7,
            markerHeight: 7,
            orient: 'auto-start-reverse'
        })
        marker.append(svgNode('path', {
            d: 'M 0 0 L 10 5 L 0 10 z',
            class: 'track-arrow'
        }))
        const definitions = svgNode('defs')
        definitions.append(marker)
        svg.append(definitions)
        appendRunway(svg, project)
        appendCompassIndicator(svg)

        const positions = track.map(project)
        svg.append(svgNode('polyline', {
            points: positions.map(position =>
                position.x.toFixed(TRACK_COORDINATE_PRECISION) + ',' +
                position.y.toFixed(TRACK_COORDINATE_PRECISION)
            ).join(' '),
            class: 'track-path',
            'marker-end': 'url(#' + markerId + ')'
        }))

        track.forEach((point, index) => {
            const position = positions[index]
            const circle = svgNode('circle', {
                cx: position.x,
                cy: position.y,
                r: index === 0 ? 6 : 4,
                class: index === 0 ? 'track-point track-start' : 'track-point'
            })
            const title = svgNode('title')
            title.textContent = formatTime(point.observed_at) + ' · ' +
                formatNumber(point.altitude) + ' m'
            circle.append(title)
            svg.append(circle)
        })

        return svg
    }

    function createDetailItem (labelKey, value, className = '') {
        if (value === null || value === undefined || value === EMPTY_VALUE) {
            return null
        }
        const item = document.createElement('div')
        item.className = className
        item.append(
            createTextElement('dt', '', translate(labelKey)),
            createTextElement('dd', '', value)
        )
        return item
    }

    function createDepartureDetails (departure) {
        const panel = document.createElement('div')
        panel.className = 'departure-details'
        const verificationLink = createFlightVerificationLink(
            departure.callsign
        )
        const heading = document.createElement('div')
        heading.className = 'departure-details-heading'
        heading.append(createTextElement(
            'h3',
            'departure-details-title',
            translate('details.evidence')
        ))
        if (verificationLink) heading.append(verificationLink)
        panel.append(heading)
        const values = departure.details || {}
        const list = document.createElement('dl')
        list.className = 'departure-evidence'
        const observedPeriod = values.observed_from && values.observed_to
            ? formatTime(values.observed_from) + '–' +
            formatTime(values.observed_to)
            : null
        const items = [
            createDetailItem(
                'details.confidence',
                translate(
                    'confidence.' +
                    (departure.detection_confidence || 'unknown')
                )
            ),
            createDetailItem('details.samples',
                Number.isFinite(values.direction_samples)
                    ? String(values.direction_samples)
                    : null),
            createDetailItem('details.observedPeriod', observedPeriod),
            createDetailItem('details.altitudeGain',
                Number.isFinite(values.altitude_gain)
                    ? formatNumber(values.altitude_gain) + ' m'
                    : null),
            createDetailItem('details.climbRate',
                Number.isFinite(values.median_vertical_rate)
                    ? formatNumber(values.median_vertical_rate) + ' m/s'
                    : null),
            createDetailItem('details.longitudeChange',
                Number.isFinite(values.longitude_delta)
                    ? formatNumber(
                        values.longitude_delta,
                        LONGITUDE_VALUE_PRECISION
                    ) + '°'
                    : null)
        ].filter(Boolean)

        if (items.length === 0) {
            panel.append(createTextElement(
                'p',
                'muted',
                translate('details.unavailable')
            ))
        } else {
            list.append(...items)
            panel.append(list)
        }

        if (Array.isArray(values.track)) {
            panel.append(
                createTextElement(
                    'h3',
                    'departure-details-title track-title',
                    translate('details.track')
                ),
                createTrackDiagram(values.track)
            )
        }
        return panel
    }

    function createDepartureRow (departure) {
        const row = document.createElement('details')
        row.className = 'departure'
        const summary = document.createElement('summary')
        summary.className = 'departure-summary'
        const time = createTextElement(
            'span',
            'time',
            formatTime(departure.detected_at)
        )
        const callsign = createTextElement(
            'span',
            'callsign',
            displayCallsign(departure.callsign)
        )
        const identity = document.createElement('span')
        identity.className = 'flight-identity'
        const operator = findOperator(departure.callsign)
        if (operator) {
            const airline = createTextElement(
                'span',
                'airline-badge',
                operator.shortName
            )
            airline.title = operator.name
            airline.setAttribute('aria-label', operator.name)
            identity.append(airline)
        }
        identity.append(callsign)
        const direction = createTextElement(
            'span',
            'badge ' + departure.direction,
            translate(departure.direction)
        )
        const content = document.createElement('span')
        content.className = 'departure-summary-content'
        content.append(time, identity, direction)
        summary.append(content)
        row.append(summary, createDepartureDetails(departure))
        return row
    }

    function renderDepartures (departures) {
        const list = element('departures')
        list.replaceChildren()

        if (departures.length === 0) {
            list.append(createTextElement(
                'p',
                'muted',
                translate('noDepartures')
            ))
            return
        }

        for (const departure of departures) {
            list.append(createDepartureRow(departure))
        }
    }

    function renderRecommendation (advice) {
        const style = RECOMMENDATION_STYLES[advice.confidence] ||
            RECOMMENDATION_STYLES.insufficient
        element('recommendation').className = `recommendation ${style}`
        element('recommendation-title').textContent = translate(style)
        element('recommendation-reason').textContent = translate(
            `reason.${advice.recommendation}`
        )
    }

    function renderCollectionStatus (advice, collector) {
        const status = formatCollectionStatus(advice, collector)
        const container = element('collection-status')
        const detail = element('collection-status-detail')

        container.dataset.state = status.state
        element('collection-status-title').textContent = status.title
        detail.textContent = status.detail || EMPTY_VALUE
        detail.hidden = !status.detail
    }

    function renderCollectionError () {
        const container = element('collection-status')
        const detail = element('collection-status-detail')

        container.dataset.state = 'error'
        element('collection-status-title').textContent =
            translate('collection.unavailable')
        detail.textContent = translate('collection.retrying')
        detail.hidden = false
    }

    function render (payload) {
        latestPayload = payload
        const advice = payload.advice

        renderRecommendation(advice)
        element('westbound').textContent = advice.today.westbound
        element('eastbound').textContent = advice.today.eastbound
        element('unknown').textContent = advice.today.unknown
        renderCollectionStatus(advice, payload.collector)
        element('data-source').textContent = translate(
            dataSource === 'snapshot'
                ? 'dataSource.snapshot'
                : 'dataSource.live'
        )
        element('footer-updated').textContent = formatTime(
            payload.generatedAt || advice.lastSuccessAt
        )
        renderDepartures(advice.recentDepartures)
    }

    function applyLanguage () {
        document.documentElement.lang =
            language === 'zh-TW' ? 'zh-Hant' : 'en'
        element('language').textContent = translate('languageSwitch')
        applyTheme()

        document.querySelectorAll('[data-i18n]').forEach(node => {
            node.textContent = translate(node.dataset.i18n)
        })

        element('data-source').textContent = translate(
            dataSource === 'snapshot'
                ? 'dataSource.snapshot'
                : 'dataSource.live'
        )
        if (latestPayload) render(latestPayload)
    }

    function applyFavicon (config) {
        const favicon = document.querySelector('link[rel="icon"]')
        if (!favicon) return

        const mode = config?.dataSource === 'snapshot'
            ? 'snapshot'
            : config?.departureDetailsMode
        favicon.href = FAVICON_PATHS[mode] || FAVICON_PATHS.summary
    }

    function applyGithubStar (config) {
        const button = element('github-star')
        if (!button) return
        button.hidden = config?.dataSource !== 'snapshot'
    }

    function dashboardStatusUrl () {
        const at = new URLSearchParams(window.location.search).get('at')
        if (!at) return DASHBOARD_STATUS_URL
        return DASHBOARD_STATUS_URL + '?at=' + encodeURIComponent(at)
    }

    async function loadWebConfig () {
        const response = await fetch(WEB_CONFIG_URL)
        if (!response.ok) throw new Error('Unable to load web configuration')

        const config = await response.json()
        applyFavicon(config)
        applyGithubStar(config)
        element('adsb-fi-attribution').hidden =
            config.aircraftDataProvider !== ADSB_FI_PROVIDER
        return config
    }

    function snapshotPayload (snapshot) {
        return {
            advice: snapshot.advice,
            generatedAt: snapshot.generatedAt,
            collector: {
                state: snapshot.collectorStatus,
                last_success_at: snapshot.collectorLastSuccessAt,
                updated_at: snapshot.generatedAt
            }
        }
    }

    async function loadData (dataSource = 'api') {
        try {
            const endpoint = dataSource === 'snapshot'
                ? SNAPSHOT_STATUS_URL
                : dashboardStatusUrl()
            const response = await fetch(endpoint, { cache: 'no-store' })
            if (!response.ok) throw new Error('Request failed')
            const payload = await response.json()
            render(dataSource === 'snapshot'
                ? snapshotPayload(payload)
                : payload)
        } catch {
            element('recommendation-title').textContent = translate('error')
            renderCollectionError()
        }
    }

    async function changeLanguage () {
        language = language === 'zh-TW' ? 'en' : 'zh-TW'
        await loadTranslations(language)
        localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
        applyLanguage()
    }

    function changeTheme () {
        theme = theme === DARK_THEME ? LIGHT_THEME : DARK_THEME
        localStorage.setItem(THEME_STORAGE_KEY, theme)
        applyTheme()
    }

    function followSystemTheme (event) {
        if (localStorage.getItem(THEME_STORAGE_KEY)) return
        theme = event.matches ? DARK_THEME : LIGHT_THEME
        applyTheme()
    }

    async function start () {
        const [, config] = await Promise.all([
            loadTranslations(language),
            loadWebConfig(),
            loadOperators()
        ])
        applyLanguage()
        dataSource = config?.dataSource || 'api'
        await loadData(dataSource)
        setInterval(() => loadData(dataSource), REFRESH_INTERVAL_MS)
    }

    element('theme').addEventListener('click', changeTheme)
    element('language').addEventListener('click', changeLanguage)
    systemTheme.addEventListener('change', followSystemTheme)
    start().catch(() => {
        element('recommendation-title').textContent =
            'Unable to initialize dashboard'
    })
})()
