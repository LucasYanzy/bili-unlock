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

const AREA_NAME = { cn: '大陆', hk: '香港', tw: '台湾', th: '东南亚' }

// 代理/B站 常见错误码 → 人话
function explainCode(code, message) {
    const m = {
        '-101': '未授权或授权已过期',
        '401': '未授权或授权已过期',
        '-10403': '该地区的服务器也看不了',
        '-404': '服务器不支持这个接口，或地址填错了',
        '-403': '没有权限（会员内容需要大会员，付费内容需要已购买）',
        '-412': '请求被拦截，稍后再试',
        '6002003': '该内容需要大会员',
        '-3': '服务器校验失败',
    }[String(code)]
    return m ? `${m}（${code}${message ? ' ' + message : ''}）` : `${code} ${message || ''}`.trim()
}

function playurlUrl(server, info, area) {
    const q = new URLSearchParams({
        avid: info.aid || '', cid: info.cid || '', ep_id: info.epId,
        qn: 127, fnver: 0, fnval: 4048, fourk: 1, area,
    })
    if (auth.accessKey) q.set('access_key', auth.accessKey)
    return `${server.replace(/\/+$/, '')}/pgc/player/web/playurl?${q}`
}

async function requestPlayurl(info) {
    const errors = []
    let needAuth = !auth.accessKey
    for (const server of config.servers) {
        for (const area of guessAreas()) {
            try {
                const j = await fetchJSON(playurlUrl(server, info, area), { credentials: 'omit' })
                const result = j.result || j.data
                log('playurl', server, area, 'code=' + j.code, j.message || '', result && result.dash ? 'dash' : (result && result.durl ? 'durl' : ''))
                if (j.code === 0 && result && (result.dash || result.durl)) return { result, server, area }
                errors.push(`${server} · ${AREA_NAME[area] || area}：${explainCode(j.code, j.message)}`)
                if (j.code === -101 || j.code === 401) { needAuth = true; break } // 未授权，换地区也没用
                if (j.code === -404 || j.code === -3) break                       // 这台服务器不行，换下一台
            } catch (e) {
                log('playurl error', server, area, e.message)
                errors.push(`${server}：连不上（${e.message}）`)
                break
            }
        }
    }
    const err = new Error(errors.join('\n') || '没有可用的代理服务器')
    err.needAuth = needAuth
    throw err
}

// 设置面板里的“测试”：只测当前视频在这台服务器上能不能拿到地址
async function probeServer(server, info) {
    const t0 = performance.now()
    for (const area of guessAreas()) {
        try {
            const j = await fetchJSON(playurlUrl(server, info, area), { credentials: 'omit' })
            const ms = Math.round(performance.now() - t0)
            const r = j.result || j.data
            if (j.code === 0 && r && (r.dash || r.durl)) return { ok: true, text: `可用 · ${AREA_NAME[area]} · ${ms}ms` }
            if (j.code === -101 || j.code === 401 || j.code === -404) return { ok: false, text: explainCode(j.code).split('（')[0], title: explainCode(j.code, j.message) }
        } catch (e) {
            return { ok: false, text: '连不上', title: e.message }
        }
    }
    return { ok: false, text: '各地区都不行' }
}
