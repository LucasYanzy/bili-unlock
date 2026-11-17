// ---- 盖在原播放器上的解锁面板 ----

const CSS = `
#big-block-panel{display:none!important}
.bu-layer{position:absolute;inset:0;z-index:1000;background:#000;display:flex;align-items:center;justify-content:center;font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#e8e8e8}
.bu-layer video{position:absolute;inset:0;width:100%;height:100%;background:#000}
.bu-card{position:relative;max-width:440px;padding:22px 24px;text-align:center}
.bu-card h3{margin:0 0 8px;font-size:17px;font-weight:600;color:#fff}
.bu-card p{margin:0 0 14px;color:#b8b8b8;font-size:13px;white-space:pre-wrap;word-break:break-word}
.bu-card pre{margin:0 0 14px;max-height:120px;overflow:auto;text-align:left;font:11px/1.4 Menlo,monospace;color:#ff9b9b;white-space:pre-wrap}
.bu-btn{display:inline-block;margin:4px;padding:7px 16px;border:0;border-radius:6px;background:#00aeec;color:#fff;font-size:13px;cursor:pointer}
.bu-btn.ghost{background:transparent;border:1px solid #555;color:#ccc}
.bu-bar{position:absolute;top:8px;right:8px;z-index:2;display:flex;gap:6px;align-items:center;opacity:.15;transition:opacity .2s}
.bu-layer:hover .bu-bar{opacity:1}
.bu-bar span,.bu-bar select,.bu-bar button{font:12px/1 -apple-system,sans-serif;color:#fff;background:rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.25);border-radius:4px;padding:5px 7px}
.bu-bar button{cursor:pointer}
`

function findPlayerBox() {
    // 2026 版番剧页：#bilibili-player-wrap > … > #bilibili-player > #big-block-panel(z=100, 阻断提示)
    for (const sel of ['#bilibili-player-wrap', '#bilibili-player']) {
        const e = document.querySelector(sel)
        if (e && e.offsetWidth > 300) return e
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let n
    while ((n = walker.nextNode())) {
        if (/无法观看|無法觀看/.test(n.nodeValue)) {
            let el = n.parentElement
            while (el && el !== document.body && !(el.offsetWidth >= 480 && el.offsetHeight >= 260)) el = el.parentElement
            if (el && el !== document.body) return el
        }
    }
    return null
}

function createLayer() {
    if (!document.getElementById('bu-style')) {
        const st = document.createElement('style')
        st.id = 'bu-style'
        st.textContent = CSS
        document.head.appendChild(st)
    }
    const box = findPlayerBox()
    if (!box) return null
    if (getComputedStyle(box).position === 'static') box.style.position = 'relative'
    let layer = box.querySelector(':scope > .bu-layer')
    if (!layer) {
        layer = document.createElement('div')
        layer.className = 'bu-layer'
        box.appendChild(layer)
    }
    return layer
}

function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn)
        else if (k === 'text') e.textContent = v
        else e.setAttribute(k, v)
    }
    for (const c of [].concat(children)) if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
    return e
}

function showCard(layer, { title, text, error, buttons = [] }) {
    layer.replaceChildren(el('div', { class: 'bu-card' }, [
        el('h3', { text: title }),
        text ? el('p', { text }) : null,
        error ? el('pre', { text: error }) : null,
        el('div', {}, buttons.map(b => el('button', { class: 'bu-btn' + (b.ghost ? ' ghost' : ''), text: b.label, on: { click: b.onClick } }))),
    ]))
}

function editServers() {
    const cur = config.servers.join('\n')
    const v = prompt('代理服务器地址（每行一个，按顺序尝试）。\n代理会看到你的授权令牌，只用你信任的服务器。', cur)
    if (v == null) return false
    const list = v.split(/[\s,]+/).map(s => s.trim()).filter(s => /^https?:\/\/[^/\s]+/.test(s)).map(s => s.replace(/\/+$/, ''))
    config.servers = list.length ? list : DEFAULT_SERVERS
    return true
}
