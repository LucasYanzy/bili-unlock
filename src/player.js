// ---- 把代理返回的 DASH 数据变成 MPD，用 dash.js 播放 ----

// 纯播放器版本：不带 DRM/EME 模块（用不上，而且 Safari 上 EME 检测会出错）
const DASHJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/dashjs/4.7.4/dash.mediaplayer.min.js'
const QN_NAME = { 127: '8K', 126: '杜比视界', 125: 'HDR', 120: '4K', 116: '1080P60', 112: '1080P+', 80: '1080P', 74: '720P60', 64: '720P', 32: '480P', 16: '360P' }

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

// Safari 对 HEVC/AV1 的 MSE 支持不稳定，优先 AVC
function chooseVideoTracks(videos) {
    const supported = videos.filter(v => {
        const mime = `${pick(v, 'mimeType', 'mime_type') || 'video/mp4'}; codecs="${v.codecs}"`
        return window.MediaSource && MediaSource.isTypeSupported(mime)
    })
    const avc = supported.filter(v => /^avc/.test(v.codecs))
    const list = avc.length ? avc : supported
    return list.length ? list : videos
}

function buildMpd(dash) {
    const duration = dash.duration || dash.timelength / 1000 || 0
    const rep = (item, kind) => {
        const { init, index } = segBase(item)
        const url = pick(item, 'baseUrl', 'base_url')
        const attrs = kind === 'video'
            ? `width="${item.width}" height="${item.height}" frameRate="${pick(item, 'frameRate', 'frame_rate') || ''}"`
            : `audioSamplingRate="44100"`
        return `<Representation id="${kind}-${item.id}-${item.codecid || ''}" bandwidth="${item.bandwidth}" codecs="${xmlEsc(item.codecs)}" mimeType="${pick(item, 'mimeType', 'mime_type')}" ${attrs}>` +
            `<BaseURL>${xmlEsc(url)}</BaseURL>` +
            `<SegmentBase indexRange="${index}"><Initialization range="${init}"/></SegmentBase></Representation>`
    }
    const videos = chooseVideoTracks(dash.video || [])
    const audios = [].concat(dash.audio || [], (dash.flac && dash.flac.audio) ? [dash.flac.audio] : [])
        .filter(a => a && /mp4a/.test(a.codecs))
    return `<?xml version="1.0" encoding="UTF-8"?>` +
        `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" type="static" minBufferTime="PT1.5S" mediaPresentationDuration="PT${duration}S">` +
        `<Period start="PT0S">` +
        `<AdaptationSet contentType="video" segmentAlignment="true" subsegmentAlignment="true">${videos.map(v => rep(v, 'video')).join('')}</AdaptationSet>` +
        (audios.length ? `<AdaptationSet contentType="audio" segmentAlignment="true" subsegmentAlignment="true">${audios.map(a => rep(a, 'audio')).join('')}</AdaptationSet>` : '') +
        `</Period></MPD>`
}

async function playDash(video, dash) {
    const dashjs = await loadDashJs()
    const mpd = buildMpd(dash)
    const url = URL.createObjectURL(new Blob([mpd], { type: 'application/dash+xml' }))
    const player = dashjs.MediaPlayer().create()
    player.updateSettings({
        streaming: {
            abr: { autoSwitchBitrate: { video: false }, initialBitrate: { video: 1e9 } },
            buffer: { fastSwitchEnabled: true },
        },
        debug: { logLevel: dashjs.Debug.LOG_LEVEL_WARNING },
    })
    player.on(dashjs.MediaPlayer.events.ERROR, e => log('dash error', e && e.error && (e.error.message || e.error.code)))
    player.initialize(video, url, false)
    return player
}

// 有些代理只给 durl（mp4 单文件）
function playDurl(video, result) {
    const seg = result.durl && result.durl[0]
    if (!seg) throw new Error('没有可播放的地址')
    video.src = seg.url
    return null
}
