const sharedRules = {
    eqeqeq: ['error', 'always'],
    'no-const-assign': 'error',
    'no-dupe-keys': 'error',
    'no-duplicate-case': 'error',
    'no-unreachable': 'error',
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    quotes: ['error', 'single', { avoidEscape: true }],
    semi: ['error', 'never']
}

export default [
    {
        files: ['src/**/*.js', 'test/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                AbortSignal: 'readonly',
                Buffer: 'readonly',
                URL: 'readonly',
                console: 'readonly',
                fetch: 'readonly',
                process: 'readonly',
            }
        },
        rules: sharedRules
    },
    {
        files: ['public/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'script',
            globals: {
                document: 'readonly',
                fetch: 'readonly',
                localStorage: 'readonly',
                setInterval: 'readonly'
            }
        },
        rules: sharedRules
    }
]
