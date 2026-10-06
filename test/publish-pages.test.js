import assert from 'node:assert/strict'
import test from 'node:test'
import {
    DEFAULT_GIT_AUTHOR_EMAIL,
    DEFAULT_GIT_AUTHOR_NAME,
    gitCommitIdentityArgs
} from '../scripts/publish-pages.js'

test('Pages publisher defaults to an unlinked deployment identity', () => {
    assert.equal(DEFAULT_GIT_AUTHOR_NAME, 'Dazhi Pages Publisher')
    assert.equal(
        DEFAULT_GIT_AUTHOR_EMAIL,
        'dazhi-pages-publisher@example.invalid'
    )
    assert.deepEqual(
        gitCommitIdentityArgs(
            DEFAULT_GIT_AUTHOR_NAME,
            DEFAULT_GIT_AUTHOR_EMAIL
        ),
        [
            '-c',
            'user.name=Dazhi Pages Publisher',
            '-c',
            'user.email=dazhi-pages-publisher@example.invalid'
        ]
    )
})

test('Pages publisher accepts an explicit deployment identity', () => {
    assert.deepEqual(
        gitCommitIdentityArgs('Pages Bot', 'pages-bot@example.invalid'),
        [
            '-c',
            'user.name=Pages Bot',
            '-c',
            'user.email=pages-bot@example.invalid'
        ]
    )
})
