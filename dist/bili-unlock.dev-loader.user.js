// ==UserScript==
// @name         bili-unlock (dev loader)
// @name:en      bili-unlock
// @namespace    https://github.com/LucasYanzy/bili-unlock
// @version      0.1.3
// @description  B站 海外看番：解除地区限制（通过代理）+ 播放加速
// @description:en Watch region-locked Bilibili shows from abroad via a proxy, with smoother playback.
// @author       LucasYanzy
// @license      MIT
// @homepageURL  https://github.com/LucasYanzy/bili-unlock
// @supportURL   https://github.com/LucasYanzy/bili-unlock/issues
// @match        https://*.bilibili.com/*
// @match        https://*.bilibili.tv/*
// @run-at       document-start
// @grant        none
// @inject-into  page
// ==/UserScript==

;(function () {
    var url = 'https://api.github.com/repos/LucasYanzy/bili-unlock/contents/dist/bili-unlock.dev.js?ref=dev&t=' + Date.now()
    var x = new XMLHttpRequest()
    try {
        x.open('GET', url, false)
        x.setRequestHeader('Accept', 'application/vnd.github.raw')
        x.send()
        if (x.status === 200) { (0, eval)(x.responseText); return }
    } catch (e) {}
    try { new Image().src = 'http://127.0.0.1:17865/beacon?' + encodeURIComponent('loader: github fetch failed ' + x.status) } catch (e) {}
})();
