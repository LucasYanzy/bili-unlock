// ---- 识别被区域限制的番剧页，向代理要播放地址 ----

function readPlayInfo() {
    const pi = window.__PLAYURL_HYDRATE_DATA__ || window.__playinfo__
    const r = pi && (pi.result || pi.data)
    if (!r) return null
    const blocked = (r.plugins || []).some(p => p && p.name === 'AreaLimitPanel' && p.config && p.config.is_block)
        || r.play_video_type === 'none' && /AREA|LIMIT/i.test(JSON.stringify(r.play_check || ''))
    const ep = (r.play_view_business_info && r.play_view_business_info.episode_info) || {}
    const sup = (r.supplement && r.supplement.ogv_episode_info) || {}
    const arc = r.arc || {}
    return {
        blocked,
        playType: r.play_video_type,
        isDrm: !!(r.video_info && r.video_info.is_drm),
        epId: ep.ep_id || sup.episode_id,
        cid: ep.cid || arc.cid,
        aid: ep.aid || arc.aid,
        seasonId: r.supplement && r.supplement.ogv_season_info && r.supplement.ogv_season_info.season_id,
    }
}

// 从页面的番剧信息里推断地区，决定先用哪个 area 参数
function guessAreas() {
    let names = ''
    try {
        const qs = window.__NEXT_DATA__.props.pageProps.dehydratedState.queries
        for (const q of qs) {
            const d = q && q.state && q.state.data
            if (d && d.areas) { names = d.areas.map(a => a.name).join(','); break }
        }
    } catch (_) { }
    const title = document.title
    if (/台湾|臺灣/.test(names + title)) return ['tw', 'hk', 'cn']
    if (/香港|港澳/.test(names + title)) return ['hk', 'tw', 'cn']
    if (/东南亚|泰国/.test(names + title)) return ['th', 'cn', 'hk']
    return ['cn', 'hk', 'tw']
}

async function requestPlayurl(info) {
    const accessKey = auth.accessKey
    const errors = []
    for (const server of config.servers) {
        for (const area of guessAreas()) {
            const q = new URLSearchParams({
                avid: info.aid || '', cid: info.cid || '', ep_id: info.epId,
                qn: config.quality, fnver: 0, fnval: 4048, fourk: 1, area,
            })
            if (accessKey) q.set('access_key', accessKey)
            const url = `${server.replace(/\/+$/, '')}/pgc/player/web/playurl?${q}`
            try {
                const j = await fetchJSON(url, { credentials: 'omit' })
                const result = j.result || j.data
                log('playurl', server, area, 'code=' + j.code, j.message || '', result && result.dash ? 'dash' : (result && result.durl ? 'durl' : ''))
                if (j.code === 0 && result && (result.dash || result.durl)) return { result, server, area }
                errors.push(`${server} [${area}] ${j.code} ${j.message || ''}`)
                if (j.code === -101 || j.code === 401) break // 未授权，换地区也没用
            } catch (e) {
                log('playurl error', server, area, e.message)
                errors.push(`${server} [${area}] ${e.message}`)
                break
            }
        }
    }
    const err = new Error(errors.join('\n') || '没有可用的代理服务器')
    err.needAuth = !accessKey || errors.some(e => / (-101|401) /.test(e))
    throw err
}
