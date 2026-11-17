// ---- 把代理返回的 DASH 数据变成 MPD，用 dash.js 播放 ----

// 纯播放器版本：不带 DRM/EME 模块（用不上，而且 Safari 上 EME 检测会出错）
const DASHJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/dashjs/4.7.4/dash.mediaplayer.min.js'
const QN_NAME = { 127: '8K', 126: '杜比视界', 125: 'HDR', 120: '4K', 116: '1080P60', 112: '1080P+', 80: '1080P', 74: '720P60', 64: '720P', 32: '480P', 16: '360P', 6: '240P' }

// B站 页面自带一个精简版 window.dashjs（没有 Debug 等）。dash.js 内部组件会通过
// window.dashjs 互相查找，两套混用会出错。被限制的页面上 B站 自己的播放器不工作，
// 所以这里直接让 window.dashjs 指向我们的完整版，不再还原。
let ownDashjs = null
function loadDashJs() {
    if (ownDashjs) return Promise.resolve(ownDashjs)
    return new Promise((resolve, reject) => {
        const pageDashjs = window.dashjs
        try { delete window.dashjs } catch (_) { }
        if (window.dashjs) window.dashjs = undefined
        const s = document.createElement('script')
        s.src = DASHJS_URL
        s.onload = () => {
            const d = window.dashjs
            if (d && d.MediaPlayer && d.Debug && d !== pageDashjs) { ownDashjs = d; resolve(d) }
            else reject(new Error('dash.js 加载后不完整'))
        }
        s.onerror = () => { if (pageDashjs) window.dashjs = pageDashjs; reject(new Error('dash.js 加载失败（cdnjs 不可用？）')) }
        document.head.appendChild(s)
    })
}

const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] != null) return o[k] }

function segBase(item) {
    const sb = pick(item, 'segment_base', 'SegmentBase', 'segmentBase') || {}
    return {
        init: pick(sb, 'initialization', 'Initialization'),
        index: pick(sb, 'index_range', 'indexRange'),
    }
}

// 主地址 + 备用地址；加速脚本在的话先让它换成更快的线路
function mediaUrls(item) {
    const urls = [pick(item, 'baseUrl', 'base_url')].concat(pick(item, 'backupUrl', 'backup_url') || []).filter(Boolean)
    const out = []
    for (const u of urls) {
        let v = u
        try { if (window.BiliAccelerator && window.BiliAccelerator.rewriteUrl) v = window.BiliAccelerator.rewriteUrl(u) || u } catch (_) { }
        if (!out.includes(v)) out.push(v)
        if (!out.includes(u)) out.push(u)
    }
    return out.slice(0, 4)
}

// Safari 对 HEVC/AV1 的 MSE 支持不稳定，优先 AVC；同一画质只留一条
function chooseVideoTracks(videos) {
    const canPlay = v => !window.MediaSource || MediaSource.isTypeSupported(`${pick(v, 'mimeType', 'mime_type') || 'video/mp4'}; codecs="${v.codecs}"`)
    const supported = videos.filter(canPlay)
    const pool = supported.length ? supported : videos
    const rank = v => /^avc/.test(v.codecs) ? 0 : /^(hev|hvc)/.test(v.codecs) ? 1 : 2
    const byQn = new Map()
    for (const v of pool) {
        const cur = byQn.get(v.id)
        if (!cur || rank(v) < rank(cur)) byQn.set(v.id, v)
    }
    return [...byQn.values()].sort((a, b) => a.bandwidth - b.bandwidth)
}

function buildMpd(dash, videos = chooseVideoTracks(dash.video || [])) {
    const duration = dash.duration || dash.timelength / 1000 || 0
    const rep = (item, kind) => {
        const { init, index } = segBase(item)
        const attrs = kind === 'video'
            ? `width="${item.width}" height="${item.height}" frameRate="${pick(item, 'frameRate', 'frame_rate') || ''}"`
            : `audioSamplingRate="44100"`
        return `<Representation id="${kind}-${item.id}-${item.codecid || ''}" bandwidth="${item.bandwidth}" codecs="${xmlEsc(item.codecs)}" mimeType="${pick(item, 'mimeType', 'mime_type')}" ${attrs}>` +
            mediaUrls(item).map(u => `<BaseURL>${xmlEsc(u)}</BaseURL>`).join('') +
            `<SegmentBase indexRange="${index}"><Initialization range="${init}"/></SegmentBase></Representation>`
    }
    const audios = [].concat(dash.audio || [], (dash.flac && dash.flac.audio) ? [dash.flac.audio] : [])
        .filter(a => a && /mp4a/.test(a.codecs))
    return `<?xml version="1.0" encoding="UTF-8"?>` +
        `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" type="static" minBufferTime="PT1.5S" mediaPresentationDuration="PT${duration}S">` +
        `<Period start="PT0S">` +
        `<AdaptationSet contentType="video" segmentAlignment="true" subsegmentAlignment="true">${videos.map(v => rep(v, 'video')).join('')}</AdaptationSet>` +
        (audios.length ? `<AdaptationSet contentType="audio" segmentAlignment="true" subsegmentAlignment="true">${audios.map(a => rep(a, 'audio')).join('')}</AdaptationSet>` : '') +
        `</Period></MPD>`
}

// 返回 { player, tracks }，tracks 与 dash.js 的画质下标一一对应（都按码率升序）
async function playDash(video, dash, preferQn) {
    const dashjs = await loadDashJs()
    const tracks = chooseVideoTracks(dash.video || [])
    const mpd = buildMpd(dash, tracks)
    const url = URL.createObjectURL(new Blob([mpd], { type: 'application/dash+xml' }))
    let start = tracks.length - 1
    for (let i = tracks.length - 1; i >= 0; i--) { if (tracks[i].id <= preferQn) { start = i; break } }
    const player = dashjs.MediaPlayer().create()
    player.updateSettings({
        streaming: {
            abr: { autoSwitchBitrate: { video: false, audio: true }, initialBitrate: { video: (tracks[start] ? tracks[start].bandwidth / 1000 : 1e9) } },
            buffer: { fastSwitchEnabled: true, bufferTimeAtTopQuality: 30, stableBufferTime: 20 },
            retryAttempts: { MediaSegment: 4, InitializationSegment: 4, IndexSegment: 4 },
        },
        debug: { logLevel: dashjs.Debug.LOG_LEVEL_WARNING },
    })
    player.on(dashjs.MediaPlayer.events.ERROR, e => log('dash error', e && e.error && (e.error.message || e.error.code)))
    player.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => { try { player.setQualityFor('video', start, true) } catch (_) { } })
    player.initialize(video, url, false)
    return { player, tracks, start }
}

// 有些代理只给 durl（mp4 单文件）
function playDurl(video, result) {
    const seg = result.durl && result.durl[0]
    if (!seg) throw new Error('没有可播放的地址')
    video.src = seg.url
    return { player: null, tracks: [], start: 0 }
}
