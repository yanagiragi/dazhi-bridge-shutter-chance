module.exports = [
    {
        files: ['src/**/*.js', 'test/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: {
                AbortSignal: 'readonly',
                Buffer: 'readonly',
                URL: 'readonly',
                console: 'readonly',
                fetch: 'readonly',
                module: 'readonly',
                process: 'readonly',
                require: 'readonly'
            }
        },
        rules: {
            eqeqeq: ['error', 'always'],
            'no-const-assign': 'error',
            'no-dupe-keys': 'error',
            'no-duplicate-case': 'error',
            'no-unreachable': 'error',
            'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            quotes: ['error', 'single', { avoidEscape: true }],
            semi: ['error', 'never']
        }
    }
]
