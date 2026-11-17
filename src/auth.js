// ---- 授权：用当前已登录的 B站 账号，走 TV 扫码登录接口自己确认，拿到 access_key ----
// 令牌只保存在本浏览器的 localStorage（bilibili.com 域），只在请求代理服务器时带上。

const TV_APPKEY = '27eb53fc9058f8c3'
const TV_APPSEC = 'c2ed53a74eeefe3cf99fbd01d8c9c375'
const PASSPORT = 'https://passport.bilibili.com/x/passport-tv-login'

const auth = {
    get token() {
        const t = store.get('auth', null)
        if (!t || !t.access_key) return null
        if (t.expires_at && Date.now() > t.expires_at) return null
        return t
    },
    get accessKey() { return this.token ? this.token.access_key : '' },
    clear() { store.del('auth'); store.del('authorized_once') },

    async login() {
        if (!getCookie('DedeUserID')) throw new Error('请先登录 B站')
        const ts = () => String(Math.floor(Date.now() / 1000))

        const r1 = await fetchJSON(`${PASSPORT}/qrcode/auth_code?` + signParams({ appkey: TV_APPKEY, local_id: '0', ts: ts() }, TV_APPSEC), { method: 'POST' })
        if (r1.code !== 0 || !r1.data || !r1.data.auth_code) throw new Error('获取授权码失败: ' + (r1.message || r1.code))
        const authCode = r1.data.auth_code
        log('auth: got auth_code')

        const confirmQuery = ['auth_code=' + encodeURIComponent(authCode), 'build=7082000', 'csrf=' + encodeURIComponent(getCookie('bili_jct'))].join('&')
        const r2 = await fetchJSON(`${PASSPORT}/h5/qrcode/confirm?` + confirmQuery, {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
        if (r2.code !== 0) throw new Error('确认授权失败: ' + (r2.message || r2.code))
        log('auth: confirmed')

        let r3
        for (let i = 0; i < 5; i++) {
            r3 = await fetchJSON(`${PASSPORT}/qrcode/poll?` + signParams({ appkey: TV_APPKEY, auth_code: authCode, local_id: '0', ts: ts() }, TV_APPSEC), { method: 'POST' })
            if (r3.code === 0 && r3.data) break
            await new Promise(r => setTimeout(r, 1000))
        }
        if (!r3 || r3.code !== 0 || !r3.data) throw new Error('获取令牌失败: ' + (r3 && (r3.message || r3.code)))
        const info = r3.data.token_info || r3.data
        const token = {
            access_key: info.access_token,
            refresh_token: info.refresh_token,
            expires_at: Date.now() + (info.expires_in || 0) * 1000,
            mid: info.mid,
        }
        if (!token.access_key) throw new Error('令牌为空')
        store.set('auth', token)
        store.set('authorized_once', true)
        log('auth: ok, expires', new Date(token.expires_at).toLocaleDateString())
        return token
    },
}
