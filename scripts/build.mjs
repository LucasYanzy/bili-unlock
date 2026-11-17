// 把 src/ 和内置的加速脚本拼成一个用户脚本。零依赖：node scripts/build.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = p => readFileSync(join(root, p), 'utf8')
const pkg = JSON.parse(read('package.json'))
const VERSION = pkg.version
const REPO = pkg.repository.replace(/^github:/, '')
const RAW = `https://raw.githubusercontent.com/${REPO}/main/dist`

const accelSrc = read('vendor/bilibili-accelerator.user.js')
const accelVersion = (accelSrc.match(/@version\s+(\S+)/) || [])[1]
const accelBody = accelSrc.split('// ==/UserScript==')[1]

const header = ({ name, extra = [] }) => [
    '// ==UserScript==',
    `// @name         ${name}`,
    '// @name:en      bili-unlock',
    `// @namespace    https://github.com/${REPO}`,
    `// @version      ${VERSION}`,
    '// @description  B站 海外看番：解除地区限制（通过代理）+ 播放加速',
    '// @description:en Watch region-locked Bilibili shows from abroad via a proxy, with smoother playback.',
    '// @author       LucasYanzy',
    '// @license      MIT',
    `// @homepageURL  https://github.com/${REPO}`,
    `// @supportURL   https://github.com/${REPO}/issues`,
    '// @match        https://*.bilibili.com/*',
    '// @match        https://*.bilibili.tv/*',
    '// @run-at       document-start',
    '// @grant        none',
    '// @inject-into  page',
    ...extra,
    '// ==/UserScript==',
    '',
].join('\n')

const unlockFiles = ['src/md5.js', 'src/base.js', 'src/auth.js', 'src/unlock.js', 'src/player.js', 'src/ui.js', 'src/settings.js', 'src/main.js']
const unlockBody = dev => [
    ';(function biliUnlock() {',
    "'use strict'",
    `const __BU_DEV__ = ${dev}`,
    `const __BU_VERSION__ = '${VERSION}${dev ? '-dev' : ''}'`,
    ...unlockFiles.map(f => `\n// ===== ${f} =====\n` + read(f)),
    '})();',
].join('\n')

const accelerator = [
    `// ===== 内置 bilibili-accelerator v${accelVersion} (MIT, © realzza) =====`,
    '// https://github.com/realzza/bilibili-accelerator',
    ';(function () {',
    accelBody,
    '})();',
].join('\n')

mkdirSync(join(root, 'dist'), { recursive: true })

// 正式版
writeFileSync(join(root, 'dist/bili-unlock.user.js'), header({
    name: 'bili-unlock · B站解锁+加速',
    extra: [`// @updateURL    ${RAW}/bili-unlock.user.js`, `// @downloadURL  ${RAW}/bili-unlock.user.js`],
}) + '\n' + accelerator + '\n\n' + unlockBody(false) + '\n')

// 开发版：代码由本机服务器提供，加载器只装一次
writeFileSync(join(root, 'dist/bili-unlock.dev.js'), accelerator + '\n\n' + unlockBody(true) + '\n')
// Safari 会拦截 https 页面去 http://127.0.0.1 加载脚本，所以从 GitHub dev 分支拉（https + CORS）
writeFileSync(join(root, 'dist/bili-unlock.dev-loader.user.js'), header({ name: 'bili-unlock (dev loader)' }) + `
;(function () {
    var url = 'https://api.github.com/repos/${REPO}/contents/dist/bili-unlock.dev.js?ref=dev&t=' + Date.now()
    var x = new XMLHttpRequest()
    try {
        x.open('GET', url, false)
        x.setRequestHeader('Accept', 'application/vnd.github.raw')
        x.send()
        if (x.status === 200) { (0, eval)(x.responseText); return }
    } catch (e) {}
    try { new Image().src = 'http://127.0.0.1:17865/beacon?' + encodeURIComponent('loader: github fetch failed ' + x.status) } catch (e) {}
})();
`)
console.log(`built v${VERSION} (accelerator ${accelVersion})`)
