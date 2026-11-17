// ---- 设置面板 ----

const QUALITY_PREFS = [
    { value: 127, label: '最高可用' },
    { value: 120, label: '4K' },
    { value: 112, label: '1080P 高码率' },
    { value: 80, label: '1080P' },
    { value: 64, label: '720P' },
    { value: 32, label: '480P（省流量）' },
]

function openSettings(layer, { onChange } = {}) {
    layer.querySelector('.bu-modal')?.remove()
    const changed = { servers: false, auth: false }
    const close = () => {
        modal.remove()
        layer.focus()
        if (onChange && (changed.servers || changed.auth)) onChange(changed)
    }
    const modal = el('div', { class: 'bu-modal', on: { click: (e) => { if (e.target === modal) close() } } })
    const sheet = el('div', { class: 'bu-sheet', role: 'dialog', 'aria-label': 'bili-unlock 设置' })
    modal.appendChild(sheet)

    sheet.appendChild(el('header', {}, [
        iconEl('gear'),
        el('h4', { text: 'bili-unlock 设置' }),
        el('button', { class: 'bu-iconbtn', title: '关闭 (Esc)', html: ICON.close, on: { click: close } }),
    ]))

    // 授权
    const authSec = el('div', { class: 'bu-sec' })
    const renderAuth = () => {
        const t = auth.token
        authSec.replaceChildren(
            el('h5', { text: '账号授权' }),
            el('div', { class: 'bu-row' }, [
                el('div', { class: 'bu-grow' }, [
                    t ? `已授权 · 有效期至 ${new Date(t.expires_at).toLocaleDateString()}` : '未授权',
                    el('span', { class: 'bu-hint', text: '令牌只保存在本浏览器，只发给你设置的代理服务器。' }),
                ]),
                el('button', {
                    class: 'bu-btn sm', text: t ? '重新授权' : '授权', on: {
                        click: async (e) => {
                            e.target.disabled = true; e.target.textContent = '授权中…'
                            try { await auth.login(); changed.auth = true } catch (err) { alert('授权失败：' + redact(err.message)) }
                            renderAuth()
                        }
                    }
                }),
                t ? el('button', { class: 'bu-btn sm danger', text: '退出', on: { click: () => { auth.clear(); changed.auth = true; renderAuth() } } }) : null,
            ]),
        )
    }
    renderAuth()
    sheet.appendChild(authSec)

    // 代理服务器
    const srvSec = el('div', { class: 'bu-sec' })
    const status = {}
    const renderServers = () => {
        const list = config.servers
        const input = el('input', { class: 'bu-input', placeholder: 'https://example.com', spellcheck: 'false' })
        const add = () => {
            const v = input.value.trim().replace(/\/+$/, '')
            if (!/^https?:\/\/[^/\s]+$/.test(v)) { input.focus(); input.style.boxShadow = 'inset 0 0 0 1px #ff6b6b'; return }
            if (!list.includes(v)) { config.servers = list.concat(v); changed.servers = true }
            renderServers()
        }
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); e.stopPropagation() })
        const move = (i, d) => { const l = list.slice(); const [x] = l.splice(i, 1); l.splice(i + d, 0, x); config.servers = l; changed.servers = true; renderServers() }
        srvSec.replaceChildren(
            el('h5', { text: '代理服务器（按顺序尝试）' }),
            ...list.map((s, i) => el('div', { class: 'bu-srv' }, [
                el('code', { text: s, title: s }),
                status[s] ? el('span', { class: 'bu-pill ' + (status[s].ok ? 'ok' : 'bad'), text: status[s].text, title: status[s].title || '' }) : null,
                el('button', { class: 'bu-iconbtn', title: '上移', html: ICON.up, disabled: i === 0, on: { click: () => move(i, -1) } }),
                el('button', { class: 'bu-iconbtn', title: '下移', html: ICON.down, disabled: i === list.length - 1, on: { click: () => move(i, 1) } }),
                el('button', {
                    class: 'bu-iconbtn', title: '删除', html: ICON.close, on: {
                        click: () => { config.servers = list.filter(x => x !== s); changed.servers = true; renderServers() }
                    }
                }),
            ])),
            el('div', { class: 'bu-row' }, [input, el('button', { class: 'bu-btn sm', text: '添加', on: { click: add } })]),
            el('div', { class: 'bu-row' }, [
                el('button', {
                    class: 'bu-btn sm ghost', text: '测试当前视频', on: {
                        click: async (e) => {
                            const info = readPlayInfo()
                            if (!info || !info.epId) { alert('请在番剧/影视播放页使用'); return }
                            e.target.disabled = true; e.target.textContent = '测试中…'
                            for (const s of config.servers) { status[s] = { text: '…' }; renderServers() ; status[s] = await probeServer(s, info) }
                            renderServers()
                        }
                    }
                }),
                el('button', { class: 'bu-btn sm ghost', text: '恢复默认', on: { click: () => { config.servers = DEFAULT_SERVERS; changed.servers = true; renderServers() } } }),
            ]),
            el('span', { class: 'bu-hint', html: '兼容 <a href="https://github.com/yujincheng08/BiliRoaming/wiki/%E5%85%AC%E5%85%B1%E8%A7%A3%E6%9E%90%E6%9C%8D%E5%8A%A1%E5%99%A8" target="_blank" rel="noopener" style="color:#7cc8ff">哔哩漫游公共解析服务器</a>。代理能看到你的授权令牌，只用信任的服务器。' }),
        )
    }
    renderServers()
    sheet.appendChild(srvSec)

    // 播放
    const qSel = el('select', { class: 'bu-select' }, QUALITY_PREFS.map(q => el('option', { value: String(q.value), text: q.label })))
    qSel.value = String(config.quality)
    qSel.addEventListener('change', () => { config.quality = Number(qSel.value) })
    sheet.appendChild(el('div', { class: 'bu-sec' }, [
        el('h5', { text: '播放' }),
        el('div', { class: 'bu-row' }, [el('div', { class: 'bu-grow', text: '默认画质' }), qSel]),
        el('div', { class: 'bu-row' }, [el('div', { class: 'bu-grow' }, ['记住播放进度', el('span', { class: 'bu-hint', text: '下次打开同一集从上次的位置继续' })]), switchEl(config.resume, v => { config.resume = v })]),
        el('div', { class: 'bu-row' }, [el('div', { class: 'bu-grow' }, ['自动播放', el('span', { class: 'bu-hint', text: '解锁成功后立即开始播放' })]), switchEl(config.autoplay, v => { config.autoplay = v })]),
        el('div', { class: 'bu-row' }, [el('div', { class: 'bu-grow' }, ['快捷键', el('span', { class: 'bu-hint', html: '<span class="bu-kbd">空格</span>播放/暂停 <span class="bu-kbd">←</span><span class="bu-kbd">→</span>快退/快进 5 秒 <span class="bu-kbd">↑</span><span class="bu-kbd">↓</span>音量 <span class="bu-kbd">F</span>全屏 <span class="bu-kbd">M</span>静音 <span class="bu-kbd">[</span><span class="bu-kbd">]</span>倍速' })])]),
    ]))

    // 加速
    const mode = acceleratorMode()
    sheet.appendChild(el('div', { class: 'bu-sec' }, [
        el('h5', { text: '播放加速' }),
        el('div', { class: 'bu-row' }, [
            el('div', { class: 'bu-grow' }, [
                mode ? `内置加速：${ACCEL_MODE_NAME[mode] || mode}` : '内置加速未运行',
                el('span', { class: 'bu-hint', text: '自动为卡顿的视频换更快的 CDN 线路，解锁后的视频同样有效。基于 realzza/bilibili-accelerator。' }),
            ]),
            el('button', { class: 'bu-btn sm ghost', text: '打开加速面板', on: { click: () => { close(); if (!openAcceleratorPanel()) alert('没找到加速面板（页面右下角的 ⚡）') } } }),
        ]),
    ]))

    sheet.appendChild(el('div', { class: 'bu-sec' }, [
        el('div', { class: 'bu-row' }, [
            el('div', { class: 'bu-grow' }, [`bili-unlock ${__BU_VERSION__}`, el('span', { class: 'bu-hint', text: 'MIT 开源 · 遇到问题欢迎反馈' })]),
            el('a', { class: 'bu-btn sm ghost', href: 'https://github.com/LucasYanzy/bili-unlock', target: '_blank', rel: 'noopener', text: 'GitHub ★' }),
            el('a', { class: 'bu-btn sm ghost', href: 'https://github.com/LucasYanzy/bili-unlock/issues/new', target: '_blank', rel: 'noopener', text: '反馈' }),
        ]),
    ]))

    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); e.stopPropagation() })
    layer.appendChild(modal)
    sheet.tabIndex = -1
    sheet.focus()
}
