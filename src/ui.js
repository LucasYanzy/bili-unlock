// ---- 界面：盖在播放器上的面板、操作栏、设置 ----

const ICON = {
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>',
    expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
}

const CSS = `
#big-block-panel{display:none!important}
.bu-layer{--bu-accent:#00aeec;--bu-accent2:#fb7299;position:absolute;inset:0;z-index:1000;background:#0b0d10;color:#e9edf1;font:14px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;overflow:hidden;user-select:none;-webkit-user-select:none}
.bu-layer *{box-sizing:border-box}
.bu-layer:focus{outline:none}
.bu-layer.bu-webfs{position:fixed;z-index:2147483000}
.bu-layer video{position:absolute;inset:0;width:100%;height:100%;background:#000;outline:none}
.bu-layer svg{width:16px;height:16px;display:block;flex:none}
.bu-center{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;background:radial-gradient(120% 90% at 50% 0%,#1a2230 0%,#0b0d10 60%)}
.bu-card{width:min(440px,100%);text-align:center}
.bu-card .bu-ico{width:52px;height:52px;margin:0 auto 14px;border-radius:16px;display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,var(--bu-accent),#5b8cff);box-shadow:0 10px 30px rgba(0,174,236,.35)}
.bu-card .bu-ico svg{width:26px;height:26px}
.bu-card h3{margin:0 0 8px;font-size:18px;font-weight:650;color:#fff;letter-spacing:.2px}
.bu-card p{margin:0 0 18px;color:#9aa6b2;font-size:13px;white-space:pre-wrap}
.bu-card pre{margin:0 0 16px;max-height:110px;overflow:auto;text-align:left;font:11px/1.45 ui-monospace,Menlo,monospace;color:#ffb4b4;background:rgba(255,80,80,.08);border:1px solid rgba(255,80,80,.18);border-radius:8px;padding:8px 10px;white-space:pre-wrap;user-select:text;-webkit-user-select:text}
.bu-card .bu-foot{margin-top:18px;font-size:11px;color:#5d6873}
.bu-card .bu-foot a{color:#7c8b99;text-decoration:none}
.bu-spin{width:30px;height:30px;margin:0 auto 16px;border-radius:50%;border:3px solid rgba(255,255,255,.12);border-top-color:var(--bu-accent);animation:bu-rot .8s linear infinite}
@keyframes bu-rot{to{transform:rotate(360deg)}}
.bu-btn{display:inline-flex;align-items:center;gap:6px;margin:4px;padding:8px 18px;border:0;border-radius:9px;background:var(--bu-accent);color:#fff;font:600 13px/1 inherit;cursor:pointer;transition:filter .15s,transform .1s}
.bu-btn:hover{filter:brightness(1.1)}.bu-btn:active{transform:scale(.97)}
.bu-btn.ghost{background:rgba(255,255,255,.07);color:#cfd6dd;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}
.bu-btn.danger{background:rgba(255,90,90,.12);color:#ff9b9b;box-shadow:inset 0 0 0 1px rgba(255,90,90,.25)}
.bu-btn.sm{padding:6px 11px;font-size:12px;border-radius:7px;margin:0}
.bu-top{position:absolute;left:0;right:0;top:0;z-index:3;display:flex;align-items:center;gap:8px;padding:10px 12px 26px;background:linear-gradient(rgba(0,0,0,.7),rgba(0,0,0,0));transition:opacity .25s}
.bu-layer.bu-idle .bu-top{opacity:0;pointer-events:none}
.bu-badge{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;background:rgba(0,174,236,.18);color:#bfefff;font-size:12px;font-weight:600;box-shadow:inset 0 0 0 1px rgba(0,174,236,.35)}
.bu-sub{font-size:12px;color:#aab4be;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bu-grow{flex:1;min-width:0}
.bu-chip{position:relative;display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 10px;border:0;border-radius:8px;background:rgba(255,255,255,.1);color:#fff;font:600 12px/1 inherit;cursor:pointer;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.bu-chip:hover{background:rgba(255,255,255,.18)}
.bu-chip.icon{width:30px;padding:0;justify-content:center}
.bu-chip.on{color:#ffe08a}
.bu-menu{position:absolute;top:36px;right:0;min-width:132px;padding:6px;border-radius:10px;background:rgba(22,26,32,.96);box-shadow:0 12px 40px rgba(0,0,0,.5),inset 0 0 0 1px rgba(255,255,255,.08);display:none;z-index:5}
.bu-menu.open{display:block}
.bu-menu button{display:flex;width:100%;justify-content:space-between;gap:12px;padding:7px 10px;border:0;border-radius:7px;background:none;color:#dfe5ea;font:13px/1.2 inherit;cursor:pointer;text-align:left}
.bu-menu button:hover{background:rgba(255,255,255,.08)}
.bu-menu button.cur{color:var(--bu-accent);font-weight:650}
.bu-menu small{color:#7d8893;font-size:11px}
.bu-toast{position:absolute;left:50%;top:18%;z-index:4;transform:translate(-50%,-6px);padding:8px 14px;border-radius:10px;background:rgba(0,0,0,.72);color:#fff;font-size:13px;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s}
.bu-toast.show{opacity:1;transform:translate(-50%,0)}
.bu-modal{position:absolute;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(5,7,10,.62);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.bu-sheet{outline:none;width:min(560px,100%);max-height:100%;overflow:auto;border-radius:16px;background:#151a20;box-shadow:0 24px 80px rgba(0,0,0,.6),inset 0 0 0 1px rgba(255,255,255,.07);user-select:text;-webkit-user-select:text}
.bu-sheet header{position:sticky;top:0;display:flex;align-items:center;gap:10px;padding:14px 16px;background:#151a20;border-bottom:1px solid rgba(255,255,255,.06);z-index:1}
.bu-sheet header h4{margin:0;flex:1;font-size:15px;color:#fff}
.bu-sec{padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.05)}
.bu-sec:last-child{border-bottom:0}
.bu-sec h5{margin:0 0 10px;font-size:12px;font-weight:650;letter-spacing:.6px;color:#7d8893;text-transform:uppercase}
.bu-row{display:flex;align-items:center;gap:8px;margin:6px 0}
.bu-row .bu-grow{font-size:13px;color:#dfe5ea}
.bu-row .bu-hint{display:block;font-size:11.5px;color:#7d8893}
.bu-srv{display:flex;align-items:center;gap:6px;padding:7px 8px;margin:4px 0;border-radius:9px;background:rgba(255,255,255,.04)}
.bu-srv code{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:12px ui-monospace,Menlo,monospace;color:#dfe5ea}
.bu-pill{font-size:11px;padding:2px 7px;border-radius:999px;background:rgba(255,255,255,.08);color:#9aa6b2;white-space:nowrap}
.bu-pill.ok{background:rgba(46,204,113,.15);color:#7ee2a8}.bu-pill.bad{background:rgba(255,90,90,.14);color:#ff9b9b}
.bu-iconbtn{display:grid;place-items:center;width:26px;height:26px;border:0;border-radius:7px;background:none;color:#9aa6b2;cursor:pointer}
.bu-iconbtn:hover{background:rgba(255,255,255,.08);color:#fff}
.bu-input,.bu-select{height:32px;padding:0 10px;border:0;border-radius:8px;background:rgba(255,255,255,.07);color:#fff;font:13px inherit;outline:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,.1)}
.bu-input{flex:1;min-width:0}.bu-input:focus,.bu-select:focus{box-shadow:inset 0 0 0 1px var(--bu-accent)}
.bu-switch{position:relative;width:38px;height:22px;flex:none;border-radius:999px;background:rgba(255,255,255,.16);cursor:pointer;transition:background .2s;border:0}
.bu-switch:after{content:'';position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .2s}
.bu-switch.on{background:var(--bu-accent)}.bu-switch.on:after{transform:translateX(16px)}
.bu-kbd{display:inline-block;min-width:20px;padding:1px 5px;margin:0 2px;border-radius:4px;background:rgba(255,255,255,.1);font:11px ui-monospace,Menlo,monospace;text-align:center;color:#cfd6dd}
`

function ensureStyle() {
    if (document.getElementById('bu-style')) return
    const st = document.createElement('style')
    st.id = 'bu-style'
    st.textContent = CSS
    ;(document.head || document.documentElement).appendChild(st)
}

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
            let e = n.parentElement
            while (e && e !== document.body && !(e.offsetWidth >= 480 && e.offsetHeight >= 260)) e = e.parentElement
            if (e && e !== document.body) return e
        }
    }
    return null
}

function createLayer() {
    ensureStyle()
    const box = findPlayerBox()
    if (!box) return null
    if (getComputedStyle(box).position === 'static') box.style.position = 'relative'
    let layer = box.querySelector(':scope > .bu-layer')
    if (!layer) {
        layer = document.createElement('div')
        layer.className = 'bu-layer'
        layer.tabIndex = -1
        box.appendChild(layer)
    }
    return layer
}

// 小型 DOM 构造器
function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue
        if (k === 'on') for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn)
        else if (k === 'text') e.textContent = v
        else if (k === 'html') e.innerHTML = v // 只用于内置的 SVG 图标
        else if (k === 'class') e.className = v
        else e.setAttribute(k, v === true ? '' : v)
    }
    for (const c of [].concat(children)) if (c != null && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
    return e
}
const iconEl = (name, cls = '') => el('span', { class: cls, html: ICON[name] })

const FOOT = () => el('div', { class: 'bu-foot' }, [
    `bili-unlock ${__BU_VERSION__} · `,
    el('a', { href: 'https://github.com/LucasYanzy/bili-unlock', target: '_blank', rel: 'noopener', text: 'GitHub' }),
])

// 播放前的各种状态卡片
function showCard(layer, { title, text, error, buttons = [], icon = 'lock', loading = false }) {
    log('card:', title)
    layer.replaceChildren(el('div', { class: 'bu-center' }, el('div', { class: 'bu-card' }, [
        loading ? el('div', { class: 'bu-spin' }) : el('div', { class: 'bu-ico', html: ICON[icon] }),
        el('h3', { text: title }),
        text ? el('p', { text }) : null,
        error ? el('pre', { text: error }) : null,
        buttons.length ? el('div', {}, buttons.map(b => el('button', { class: 'bu-btn' + (b.kind ? ' ' + b.kind : ''), text: b.label, on: { click: b.onClick } }))) : null,
        FOOT(),
    ])))
}

function toast(layer, msg, ms = 1400) {
    let t = layer.querySelector('.bu-toast')
    if (!t) { t = el('div', { class: 'bu-toast' }); layer.appendChild(t) }
    t.textContent = msg
    t.classList.add('show')
    clearTimeout(t._h)
    t._h = setTimeout(() => t.classList.remove('show'), ms)
}

// 下拉菜单：chip 按钮 + 选项列表
function dropdown(label, items, onPick, title) {
    const menu = el('div', { class: 'bu-menu' })
    const chip = el('button', { class: 'bu-chip', title, text: label })
    const wrap = el('div', { style: 'position:relative' }, [chip, menu])
    const render = (cur) => {
        menu.replaceChildren(...items().map(it => el('button', {
            class: it.value === cur ? 'cur' : '',
            on: { click: (e) => { e.stopPropagation(); menu.classList.remove('open'); onPick(it.value) } },
        }, [it.label, it.hint ? el('small', { text: it.hint }) : null])))
    }
    chip.addEventListener('click', (e) => {
        e.stopPropagation()
        const open = !menu.classList.contains('open')
        wrap.closest('.bu-layer').querySelectorAll('.bu-menu.open').forEach(m => m.classList.remove('open'))
        if (open) { render(wrap._cur); menu.classList.add('open') }
    })
    return { wrap, set(text, cur) { chip.textContent = text; wrap._cur = cur } }
}

function switchEl(on, onChange) {
    const s = el('button', { class: 'bu-switch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(!!on) })
    s.addEventListener('click', () => { const v = !s.classList.contains('on'); s.classList.toggle('on', v); s.setAttribute('aria-checked', String(v)); onChange(v) })
    return s
}

// 打开内置加速脚本的面板（它的按钮在 shadow DOM 里）
function openAcceleratorPanel() {
    const host = document.getElementById('bili-accelerator-button')
    const btn = host && host.shadowRoot && host.shadowRoot.querySelector('.ba-toggle')
    if (btn) { btn.click(); return true }
    return false
}
function acceleratorMode() {
    try { return window.BiliAccelerator ? window.BiliAccelerator.getConfig().mode : null } catch (_) { return null }
}
const ACCEL_MODE_NAME = { 'bad-only': '卡顿时加速', force: '始终加速', off: '已关闭' }
