(() => {
    const SUPPORTED_LANGUAGES = ['en', 'zh-TW']
    const DEFAULT_LANGUAGE = 'zh-TW'
    const LANGUAGE_STORAGE_KEY = 'language'
    const REFRESH_INTERVAL_MS = 60 * 1000
    const EMPTY_VALUE = '--'
    const WESTBOUND_ARROW = '\u2190'
    const NO_DIRECTION_SYMBOL = '.'
    // Dashboard endpoints and the provider ID that requires attribution.
    const API_STATUS_URL = '/api/v1/status'
    const WEB_CONFIG_URL = '/web-config.json'
    const ADSB_FI_PROVIDER = 'adsbfi'

    const RECOMMENDATION_STYLES = {
        high: 'good',
        medium: 'possible',
        low: 'low',
        insufficient: 'insufficient'
    }
    const WESTBOUND_RECOMMENDATIONS = new Set([
        'good-opportunity',
        'possible-opportunity'
    ])
    const translations = {}
    let language = getInitialLanguage()
    let latestPayload = null

    function getInitialLanguage () {
        const storedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY)
        return SUPPORTED_LANGUAGES.includes(storedLanguage)
            ? storedLanguage
            : DEFAULT_LANGUAGE
    }

    function element (id) {
        return document.getElementById(id)
    }

    function translate (key) {
        return translations[language]?.[key] || key
    }

    function formatTime (value) {
        if (!value) return EMPTY_VALUE

        const date = new Date(value)
        if (Number.isNaN(date.getTime())) return EMPTY_VALUE

        return date.toLocaleTimeString(language, {
            hour: '2-digit',
            minute: '2-digit'
        })
    }

    async function loadTranslations (locale) {
        if (translations[locale]) return

        const response = await fetch(`/locales/${locale}.json`)
        if (!response.ok) {
            throw new Error(`Unable to load locale: ${locale}`)
        }
        translations[locale] = await response.json()
    }

    function createTextElement (tagName, className, text) {
        const node = document.createElement(tagName)
        node.className = className
        node.textContent = text
        return node
    }

    function createDepartureRow (departure) {
        const row = document.createElement('div')
        row.className = 'departure'
        const time = createTextElement(
            'span',
            'time',
            formatTime(departure.detected_at)
        )
        const callsign = createTextElement(
            'span',
            'callsign',
            departure.callsign || EMPTY_VALUE
        )
        const direction = createTextElement(
            'span',
            `badge ${departure.direction}`,
            translate(departure.direction)
        )
        const confidence = createTextElement(
            'span',
            'badge confidence',
            translate(`confidence.${departure.detection_confidence}`)
        )

        row.append(time, callsign, direction, confidence)
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
        element('direction-icon').textContent =
            WESTBOUND_RECOMMENDATIONS.has(advice.recommendation)
                ? WESTBOUND_ARROW
                : NO_DIRECTION_SYMBOL
    }

    function render (payload) {
        latestPayload = payload
        const advice = payload.advice

        renderRecommendation(advice)
        element('westbound').textContent = advice.today.westbound
        element('eastbound').textContent = advice.today.eastbound
        element('unknown').textContent = advice.today.unknown
        element('updated').textContent = translate(advice.freshness)
        element('footer-updated').textContent = formatTime(advice.lastSuccessAt)
        renderDepartures(advice.recentDepartures)
    }

    function applyLanguage () {
        document.documentElement.lang =
            language === 'zh-TW' ? 'zh-Hant' : 'en'
        element('language').textContent = translate('languageSwitch')

        document.querySelectorAll('[data-i18n]').forEach(node => {
            node.textContent = translate(node.dataset.i18n)
        })

        if (latestPayload) render(latestPayload)
    }

    async function loadWebConfig () {
        const response = await fetch(WEB_CONFIG_URL)
        if (!response.ok) throw new Error('Unable to load web configuration')

        const config = await response.json()
        element('adsb-fi-attribution').hidden =
            config.aircraftDataProvider !== ADSB_FI_PROVIDER
    }

    async function loadData () {
        try {
            const response = await fetch(API_STATUS_URL)
            if (!response.ok) throw new Error('Request failed')
            render(await response.json())
        } catch {
            element('recommendation-title').textContent = translate('error')
        }
    }

    async function changeLanguage () {
        language = language === 'zh-TW' ? 'en' : 'zh-TW'
        await loadTranslations(language)
        localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
        applyLanguage()
    }

    async function start () {
        await Promise.all([
            loadTranslations(language),
            loadWebConfig()
        ])
        applyLanguage()
        await loadData()
        setInterval(loadData, REFRESH_INTERVAL_MS)
    }

    element('language').addEventListener('click', changeLanguage)
    start().catch(() => {
        element('recommendation-title').textContent =
            'Unable to initialize dashboard'
    })
})()
