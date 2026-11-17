import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const load = (files, exportsExpr, globals = {}) => {
    const src = files.map(f => readFileSync(new URL('../' + f, import.meta.url), 'utf8')).join('\n')
    const names = Object.keys(globals)
    return new Function('__BU_DEV__', '__BU_VERSION__', ...names, src + `\nreturn ${exportsExpr}`)(false, 'test', ...names.map(n => globals[n]))
}

test('md5 matches node crypto', () => {
    const md5 = load(['src/md5.js'], 'md5')
    for (const s of ['', 'abc', '中文', 'x'.repeat(55), 'x'.repeat(64), 'y'.repeat(999)]) {
        assert.equal(md5(s), createHash('md5').update(s).digest('hex'))
    }
})

test('signParams sorts keys and appends md5 sign', () => {
    const { signParams, md5 } = load(['src/md5.js', 'src/base.js'], '{ signParams, md5 }', { localStorage: { getItem: () => null } })
    const q = signParams({ ts: '1', appkey: 'k', local_id: '0' }, 'sec')
    assert.equal(q, 'appkey=k&local_id=0&ts=1&sign=' + md5('appkey=k&local_id=0&ts=1sec'))
})

test('buildMpd produces representations with segment ranges', () => {
    const fakeWindow = { MediaSource: { isTypeSupported: () => true } }
    const { buildMpd } = load(['src/md5.js', 'src/base.js', 'src/player.js'], '{ buildMpd }', { window: fakeWindow, MediaSource: fakeWindow.MediaSource })
    const mpd = buildMpd({
        duration: 120,
        video: [
            { id: 80, codecid: 7, codecs: 'avc1.640032', mimeType: 'video/mp4', width: 1920, height: 1080, frameRate: '25', bandwidth: 3000000, baseUrl: 'https://cdn/a.m4s?x=1&y=2', segment_base: { initialization: '0-1000', index_range: '1001-2000' } },
            { id: 80, codecid: 12, codecs: 'hev1.1.6.L120.90', mimeType: 'video/mp4', width: 1920, height: 1080, frameRate: '25', bandwidth: 1500000, baseUrl: 'https://cdn/h.m4s', segment_base: { initialization: '0-900', index_range: '901-1800' } },
        ],
        audio: [{ id: 30280, codecs: 'mp4a.40.2', mimeType: 'audio/mp4', bandwidth: 192000, baseUrl: 'https://cdn/au.m4s', segment_base: { initialization: '0-800', index_range: '801-1500' } }],
    })
    assert.match(mpd, /mediaPresentationDuration="PT120S"/)
    assert.match(mpd, /codecs="avc1\.640032"/)
    assert.doesNotMatch(mpd, /hev1/, 'AVC preferred when available')
    assert.match(mpd, /a\.m4s\?x=1&amp;y=2/)
    assert.match(mpd, /indexRange="1001-2000"><Initialization range="0-1000"/)
    assert.match(mpd, /contentType="audio"/)
})

test('readPlayInfo detects AreaLimitPanel block', () => {
    const win = {
        __PLAYURL_HYDRATE_DATA__: { code: 0, result: {
            play_video_type: 'none', arc: { aid: 1, cid: 2 },
            plugins: [{ name: 'AreaLimitPanel', config: { is_block: true } }],
            play_view_business_info: { episode_info: { aid: 867288412, cid: 1091578122, ep_id: 744327 } },
            supplement: { ogv_season_info: { season_id: 44847 } }, video_info: { is_drm: null },
        } },
    }
    const { readPlayInfo } = load(['src/md5.js', 'src/base.js', 'src/auth.js', 'src/unlock.js'], '{ readPlayInfo }', { window: win, localStorage: { getItem: () => null } })
    const info = readPlayInfo()
    assert.equal(info.blocked, true)
    assert.equal(info.epId, 744327)
    assert.equal(info.cid, 1091578122)
    assert.equal(info.isDrm, false)
})
