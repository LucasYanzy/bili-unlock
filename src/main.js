// ---- 入口 ----

const isBangumiPage = () => location.hostname === 'www.bilibili.com' && /\/bangumi\/play\/(ep|ss)\d+/.test(location.pathname)

let currentPlayer = null

async function run(layer, info) {
    if (currentPlayer) { try { currentPlayer.reset() } catch (_) { } currentPlayer = null }

    if (!getCookie('DedeUserID')) {
        return showCard(layer, {
            title: '需要先登录 B站',
            text: '解锁需要用你的账号向代理请求播放地址。登录后刷新本页。',
            buttons: [{ label: '去登录', onClick: () => { location.href = 'https://passport.bilibili.com/login?gourl=' + encodeURIComponent(location.href) } }],
        })
    }
    if (!auth.accessKey) {
        return showCard(layer, {
            title: '这部内容有地区限制',
            text: `bili-unlock 可以通过代理服务器播放它。\n\n第一次使用需要授权：用你当前登录的账号生成一个令牌，存在本浏览器里，只在请求代理时发送。\n代理：${config.servers.join('、')}`,
            buttons: [
                { label: '授权并播放', onClick: () => doAuth(layer, info) },
                { label: '更换代理', ghost: true, onClick: () => { if (editServers()) run(layer, info) } },
            ],
        })
    }

    showCard(layer, { title: '正在解锁…', text: '通过代理获取播放地址' })
    let got
    try {
        got = await requestPlayurl(info)
    } catch (e) {
        log('unlock failed', e.message)
        return showCard(layer, {
            title: '解锁失败',
            text: e.needAuth ? '代理提示未授权或授权已过期，可以重新授权。' : '所有代理都没返回可用的播放地址。',
            error: redact(e.message),
            buttons: [
                { label: '重试', onClick: () => run(layer, info) },
                { label: '重新授权', ghost: true, onClick: () => doAuth(layer, info) },
                { label: '更换代理', ghost: true, onClick: () => { if (editServers()) run(layer, info) } },
            ],
        })
    }

    const { result, server, area } = got
    layer.replaceChildren()
    const video = el('video', { controls: '', playsinline: '', preload: 'auto' })
    layer.appendChild(video)
    const bar = el('div', { class: 'bu-bar' })
    layer.appendChild(bar)
    try {
        if (result.dash) {
            currentPlayer = await playDash(video, result.dash)
            const dashjs = ownDashjs
            currentPlayer.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, () => {
                const list = currentPlayer.getBitrateInfoListFor('video') || []
                if (list.length > 1) {
                    const sel = el('select', { title: '画质' }, list.map((b, i) => el('option', { value: String(i), text: b.height ? `${b.height}P` : `#${i}` })).reverse())
                    sel.value = String(list.length - 1)
                    currentPlayer.setQualityFor('video', list.length - 1, true)
                    sel.addEventListener('change', () => currentPlayer.setQualityFor('video', Number(sel.value), true))
                    bar.prepend(sel)
                }
                log('stream ready', list.map(b => b.height).join('/'))
            })
        } else {
            currentPlayer = playDurl(video, result)
        }
        const qn = result.quality
        bar.appendChild(el('span', { text: `已解锁 · ${QN_NAME[qn] || qn || ''} · ${area.toUpperCase()}`, title: server }))
        bar.appendChild(el('button', { text: '换代理', on: { click: () => { if (editServers()) run(layer, info) } } }))
        video.addEventListener('error', () => log('video error', video.error && video.error.code))
        video.addEventListener('playing', () => log('playing'), { once: true })
    } catch (e) {
        log('player failed', e.message)
        showCard(layer, { title: '播放器启动失败', error: e.message, buttons: [{ label: '重试', onClick: () => run(layer, info) }] })
    }
}

async function doAuth(layer, info) {
    showCard(layer, { title: '正在授权…', text: '使用当前登录的账号生成令牌' })
    try {
        await auth.login()
        run(layer, info)
    } catch (e) {
        log('auth failed', e.message)
        showCard(layer, {
            title: '授权失败', error: redact(e.message),
            buttons: [{ label: '再试一次', onClick: () => doAuth(layer, info) }],
        })
    }
}

async function boot() {
    if (!isBangumiPage()) return
    let info = null
    for (let i = 0; i < 40 && !(info = readPlayInfo()); i++) await new Promise(r => setTimeout(r, 250))
    log('page', location.pathname, info ? JSON.stringify({ blocked: info.blocked, ep: info.epId, cid: info.cid, type: info.playType, drm: info.isDrm }) : 'no playinfo', 'auth=' + (auth.accessKey ? 1 : 0))
    if (!info || !info.blocked) return
    if (info.isDrm) return log('DRM 内容，无法解锁')

    let layer = null
    for (let i = 0; i < 40 && !(layer = createLayer()); i++) await new Promise(r => setTimeout(r, 250))
    if (!layer) return log('找不到播放器区域')
    log('layer mounted in', layer.parentElement && (layer.parentElement.id || layer.parentElement.className))
    run(layer, info)

    // B站 的 React 会重渲染播放器区域，把面板挤掉；被移除就挂回去（保留里面的状态）
    let reattach = 0
    setInterval(() => {
        if (layer.isConnected && layer.offsetWidth > 0) return
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
