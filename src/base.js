// ---- 基础：日志、存储、配置 ----
// __BU_DEV__ / __BU_VERSION__ 由构建脚本注入

const TAG = '[bili-unlock]'
const SECRET_RE = /(access_key|access_token|refresh_token|SESSDATA|bili_jct|csrf|sign)=[^&\s"']+/gi
const redact = s => String(s).replace(SECRET_RE, '$1=***')

const debugLines = []
let debugBox = null
function renderDebug() {
    // 诊断小窗默认关闭；需要时在控制台执行 localStorage.bu_debug_box = 'true' 再刷新
    if (!__BU_DEV__ || window.top !== window || store.get('debug_box', false) !== true) return
    if (!document.body) return void setTimeout(renderDebug, 200)
    if (!debugBox) {
        debugBox = document.createElement('pre')
        debugBox.style.cssText = 'position:fixed;left:6px;bottom:6px;z-index:2147483647;max-width:46vw;max-height:40vh;overflow:hidden;margin:0;padding:6px 8px;background:rgba(0,0,0,.82);color:#7CFC9A;font:11px/1.35 Menlo,monospace;white-space:pre-wrap;word-break:break-all;border-radius:6px;pointer-events:none'
        document.body.appendChild(debugBox)
    }
    debugBox.textContent = `[bili-unlock ${__BU_VERSION__} dev]\n` + debugLines.slice(-20).join('\n')
}
function beacon(line) {
    if (!__BU_DEV__) return
    try { new Image().src = 'http://127.0.0.1:17865/beacon?' + encodeURIComponent(line.slice(0, 600)) } catch (_) { }
}
function log(...args) {
    const line = redact(args.map(a => typeof a === 'string' ? a : (() => { try { return JSON.stringify(a) } catch (_) { return String(a) } })()).join(' '))
    console.log(TAG, line)
    if (__BU_DEV__) { debugLines.push(line.slice(0, 300)); beacon(line); renderDebug() }
}

const store = {
    get(k, d) { try { const v = localStorage.getItem('bu_' + k); return v == null ? d : JSON.parse(v) } catch (_) { return d } },
    set(k, v) { try { localStorage.setItem('bu_' + k, JSON.stringify(v)) } catch (_) { } },
    del(k) { try { localStorage.removeItem('bu_' + k) } catch (_) { } },
}

const DEFAULT_SERVERS = ['https://bili.nepnep.moe']
const config = {
    get servers() {
        const s = store.get('servers', null)
        return Array.isArray(s) && s.length ? s : DEFAULT_SERVERS
    },
    set servers(v) { store.set('servers', v) },
    get quality() { return store.get('quality', 127) }, // 想要的最高画质 qn
}

function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'))
    return m ? decodeURIComponent(m[1]) : ''
}

async function fetchJSON(url, opts = {}) {
    const res = await fetch(url, opts)
    const text = await res.text()
    try { return JSON.parse(text) } catch (_) { throw new Error(`非 JSON 响应 (${res.status}): ${text.slice(0, 120)}`) }
}

function signParams(params, appsec) {
    const q = Object.keys(params).sort().map(k => k + '=' + encodeURIComponent(params[k])).join('&')
    return q + '&sign=' + md5(q + appsec)
}
