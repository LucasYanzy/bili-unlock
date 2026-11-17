// ---- 入口：状态流转 + 播放器操作栏 ----

const isBangumiPage = () => location.hostname === 'www.bilibili.com' && /\/bangumi\/play\/(ep|ss)\d+/.test(location.pathname)
const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]
const fmtTime = s => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(ss).padStart(2, '0') }

let current = null // { player, video, timers }

function teardown() {
    if (!current) return
    try { current.player && current.player.reset() } catch (_) { }
    current.timers.forEach(clearInterval)
    current.cleanup.forEach(fn => { try { fn() } catch (_) { } })
    current = null
}

function settingsAction(layer, info) {
    return () => openSettings(layer, { onChange: () => run(layer, info) })
}

async function run(layer, info, { retriedAuth = false } = {}) {
    teardown()
    const openSet = settingsAction(layer, info)

    if (!getCookie('DedeUserID')) {
        return showCard(layer, {
            title: '需要先登录 B站',
            text: '解锁会用你的账号向代理请求播放地址。\n登录后刷新本页即可。',
            buttons: [
                { label: '去登录', onClick: () => { location.href = 'https://passport.bilibili.com/login?gourl=' + encodeURIComponent(location.href) } },
                { label: '设置', kind: 'ghost', onClick: openSet },
            ],
        })
    }

    // 授权过期且以前授权过：静默续期，不再打扰
    if (!auth.accessKey && store.get('authorized_once', false) && !retriedAuth) {
        showCard(layer, { title: '正在续期授权…', loading: true })
        try { await auth.login(); return run(layer, info, { retriedAuth: true }) } catch (e) { log('silent re-auth failed', e.message) }
    }

    if (!auth.accessKey) {
        return showCard(layer, {
            icon: 'globe',
            title: '这部内容在你所在的地区不可播放',
            text: 'bili-unlock 可以通过代理服务器帮你播放。\n\n第一次使用需要授权一次：用当前登录的账号生成令牌，只保存在本浏览器，只发给代理服务器。',
            buttons: [
                { label: '授权并播放', onClick: () => doAuth(layer, info) },
                { label: '设置', kind: 'ghost', onClick: openSet },
            ],
        })
    }

    showCard(layer, { title: '正在解锁…', text: `通过 ${config.servers[0].replace(/^https?:\/\//, '')} 获取播放地址`, loading: true })
    let got
    try {
        got = await requestPlayurl(info)
    } catch (e) {
        log('unlock failed', e.message)
        if (e.needAuth && !retriedAuth) {
            showCard(layer, { title: '授权已失效，正在重新授权…', loading: true })
            try { await auth.login(); return run(layer, info, { retriedAuth: true }) } catch (e2) { log('re-auth failed', e2.message) }
        }
        return showCard(layer, {
            icon: 'globe',
            title: '解锁失败',
            text: e.needAuth ? '代理说没有授权。可以重新授权试试。' : '代理服务器没有返回可用的播放地址。可以换一个代理再试。',
            error: redact(e.message),
            buttons: [
                { label: '重试', onClick: () => run(layer, info) },
                e.needAuth ? { label: '重新授权', kind: 'ghost', onClick: () => doAuth(layer, info) } : null,
                { label: '更换代理', kind: 'ghost', onClick: openSet },
            ].filter(Boolean),
        })
    }

    try {
        await startPlayer(layer, info, got)
    } catch (e) {
        log('player failed', e.message)
        showCard(layer, {
            title: '播放器启动失败', error: redact(e.message),
            buttons: [{ label: '重试', onClick: () => run(layer, info) }, { label: '反馈问题', kind: 'ghost', onClick: () => window.open('https://github.com/LucasYanzy/bili-unlock/issues/new') }],
        })
    }
}

async function startPlayer(layer, info, { result, server, area }) {
    layer.replaceChildren()
    const video = el('video', { controls: true, playsinline: true, preload: 'auto' })
    layer.appendChild(video)
    current = { player: null, video, timers: [], cleanup: [] }

    const { player, tracks, start } = result.dash
        ? await playDash(video, result.dash, config.quality)
        : playDurl(video, result)
    current.player = player

    // ---- 顶部操作栏 ----
    const top = el('div', { class: 'bu-top' })
    const host = server.replace(/^https?:\/\//, '')
    top.appendChild(el('span', { class: 'bu-badge' }, [iconEl('lock'), '已解锁']))
    top.appendChild(el('span', { class: 'bu-sub bu-grow', text: `${AREA_NAME[area] || area} · ${host}`, title: server }))

    const qualityName = i => tracks[i] ? (QN_NAME[tracks[i].id] || `${tracks[i].height}P`) : '自动'
    let quality = null
    if (player && tracks.length > 1) {
        quality = dropdown(qualityName(start), () => tracks.map((t, i) => ({ value: i, label: QN_NAME[t.id] || `${t.height}P`, hint: `${t.width}×${t.height}` })).reverse(), (i) => {
            player.setQualityFor('video', i, true)
            quality.set(qualityName(i), i)
            toast(layer, '切换到 ' + qualityName(i))
            log('quality', qualityName(i))
        }, '画质')
        quality.set(qualityName(start), start)
        top.appendChild(quality.wrap)
    }

    const rateLabel = r => r === 1 ? '倍速' : r + 'x'
    const setRate = r => { video.playbackRate = r; config.rate = r; rate.set(rateLabel(r), r) }
    const rate = dropdown(rateLabel(config.rate), () => RATES.slice().reverse().map(r => ({ value: r, label: r + 'x' })), (r) => { setRate(r); toast(layer, '倍速 ' + r + 'x') }, '倍速')
    rate.set(rateLabel(config.rate), config.rate)
    top.appendChild(rate.wrap)

    const accel = acceleratorMode()
    if (accel) {
        top.appendChild(el('button', {
            class: 'bu-chip icon' + (accel !== 'off' ? ' on' : ''), title: `播放加速：${ACCEL_MODE_NAME[accel] || accel}（点击打开加速面板）`,
            html: ICON.bolt, on: { click: () => openAcceleratorPanel() },
        }))
    }
    const toggleWebFs = () => { layer.classList.toggle('bu-webfs'); toast(layer, layer.classList.contains('bu-webfs') ? '网页全屏（Esc 退出）' : '退出网页全屏') }
    top.appendChild(el('button', { class: 'bu-chip icon', title: '网页全屏', html: ICON.expand, on: { click: toggleWebFs } }))
    top.appendChild(el('button', { class: 'bu-chip icon', title: '设置', html: ICON.gear, on: { click: settingsAction(layer, info) } }))
    layer.appendChild(top)

    // 鼠标不动 2.5 秒隐藏操作栏
    let idleTimer
    const wake = () => { layer.classList.remove('bu-idle'); clearTimeout(idleTimer); idleTimer = setTimeout(() => { if (!video.paused) layer.classList.add('bu-idle') }, 2500) }
    layer.addEventListener('mousemove', wake)
    video.addEventListener('pause', wake)
    document.addEventListener('click', () => layer.querySelectorAll('.bu-menu.open').forEach(m => m.classList.remove('open')))
    wake()

    // ---- 播放进度记忆 ----
    const progKey = 'progress_' + info.epId
    video.addEventListener('loadedmetadata', () => {
        video.playbackRate = config.rate
        const p = store.get(progKey, null)
        if (config.resume && p && p.t > 10 && video.duration && p.t < video.duration - 20) {
            video.currentTime = p.t
            toast(layer, '已从 ' + fmtTime(p.t) + ' 继续播放', 2200)
        }
        if (config.autoplay) video.play().catch(() => toast(layer, '点击播放', 2000))
    }, { once: true })
    const saveProgress = () => {
        if (!config.resume || !video.duration) return
        if (video.currentTime > video.duration - 20) store.del(progKey)
        else if (video.currentTime > 10) store.set(progKey, { t: Math.floor(video.currentTime), d: Math.floor(video.duration), at: Date.now() })
    }
    current.timers.push(setInterval(saveProgress, 5000))
    video.addEventListener('pause', saveProgress)
    window.addEventListener('pagehide', saveProgress)
    current.cleanup.push(() => { saveProgress(); window.removeEventListener('pagehide', saveProgress) })

    // ---- 快捷键（鼠标在播放器上或播放器有焦点时） ----
    let hover = false
    layer.addEventListener('mouseenter', () => { hover = true })
    layer.addEventListener('mouseleave', () => { hover = false })
    const onKey = (e) => {
        if (!layer.isConnected || (!hover && !layer.contains(document.activeElement) && !layer.classList.contains('bu-webfs'))) return
        if (/^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') || e.target.isContentEditable) return
        if (e.metaKey || e.ctrlKey || e.altKey) return
        const k = e.key
        let handled = true
        if (k === ' ' || k === 'k') video.paused ? video.play() : video.pause()
        else if (k === 'ArrowLeft') { video.currentTime = Math.max(0, video.currentTime - 5); toast(layer, '◀ ' + fmtTime(video.currentTime)) }
        else if (k === 'ArrowRight') { video.currentTime = Math.min(video.duration || 1e9, video.currentTime + 5); toast(layer, fmtTime(video.currentTime) + ' ▶') }
        else if (k === 'ArrowUp') { video.volume = Math.min(1, video.volume + 0.1); toast(layer, '音量 ' + Math.round(video.volume * 100) + '%') }
        else if (k === 'ArrowDown') { video.volume = Math.max(0, video.volume - 0.1); toast(layer, '音量 ' + Math.round(video.volume * 100) + '%') }
        else if (k === 'm') { video.muted = !video.muted; toast(layer, video.muted ? '静音' : '取消静音') }
        else if (k === 'f') {
            const fs = document.fullscreenElement || document.webkitFullscreenElement
            if (fs) (document.exitFullscreen || document.webkitExitFullscreen).call(document)
            else if (layer.requestFullscreen) layer.requestFullscreen().catch(() => { })
            else if (layer.webkitRequestFullscreen) layer.webkitRequestFullscreen()
            else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen()
        }
        else if (k === 'Escape' && layer.classList.contains('bu-webfs')) toggleWebFs()
        else if (k === '[' || k === ']') {
            const i = RATES.indexOf(video.playbackRate)
            const r = RATES[Math.max(0, Math.min(RATES.length - 1, (i < 0 ? 2 : i) + (k === ']' ? 1 : -1)))]
            setRate(r); toast(layer, '倍速 ' + r + 'x')
        }
        else handled = false
        if (handled) { e.preventDefault(); e.stopPropagation(); wake() }
    }
    window.addEventListener('keydown', onKey, true)
    current.cleanup.push(() => window.removeEventListener('keydown', onKey, true))

    video.addEventListener('error', () => log('video error', video.error && video.error.code))
    video.addEventListener('playing', () => log('playing', qualityName(start)), { once: true })
    log('stream', tracks.map(t => QN_NAME[t.id] || t.height).join('/'))
}

async function doAuth(layer, info) {
    showCard(layer, { title: '正在授权…', text: '使用当前登录的账号生成令牌', loading: true })
    try {
        await auth.login()
        run(layer, info)
    } catch (e) {
        log('auth failed', e.message)
        showCard(layer, {
            title: '授权失败', error: redact(e.message),
            buttons: [{ label: '再试一次', onClick: () => doAuth(layer, info) }, { label: '设置', kind: 'ghost', onClick: settingsAction(layer, info) }],
        })
    }
}

async function boot() {
    if (!isBangumiPage()) return
    let info = null
    for (let i = 0; i < 40 && !(info = readPlayInfo()); i++) await new Promise(r => setTimeout(r, 250))
    log('page', location.pathname, info ? JSON.stringify({ blocked: info.blocked, ep: info.epId, cid: info.cid, type: info.playType, drm: info.isDrm }) : 'no playinfo', 'auth=' + (auth.accessKey ? 1 : 0))
    if (!info || !info.blocked) return
    if (auth.accessKey) store.set('authorized_once', true)

    let layer = null
    for (let i = 0; i < 40 && !(layer = createLayer()); i++) await new Promise(r => setTimeout(r, 250))
    if (!layer) return log('找不到播放器区域')
    log('layer mounted in', layer.parentElement && (layer.parentElement.id || layer.parentElement.className))

    if (info.isDrm) {
        return showCard(layer, { title: '这部内容使用了 DRM 加密', text: 'bili-unlock 无法播放加密内容。', buttons: [] })
    }
    run(layer, info)

    // B站 的 React 会重渲染播放器区域，把面板挤掉；被移除就挂回去（保留里面的状态）
    let reattach = 0
    setInterval(() => {
        if (layer.isConnected && layer.offsetWidth > 0) return
        if (layer.classList.contains('bu-webfs') && layer.isConnected) return
        const box = findPlayerBox()
        if (!box) return
        if (getComputedStyle(box).position === 'static') box.style.position = 'relative'
        box.appendChild(layer)
        if (++reattach <= 5) log('layer re-attached', reattach)
    }, 400)

    // 番剧页切集是前端路由，页面数据不会更新；切集后整页刷新让服务端重新给数据
    const startPath = location.pathname
    setInterval(() => { if (location.pathname !== startPath && isBangumiPage()) location.reload() }, 800)
}

if (window.top === window) {
    log('loaded', __BU_VERSION__, location.pathname)
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true })
    else boot()
}
