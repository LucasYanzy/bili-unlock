# bili-unlock

在海外看 B站：**解除番剧/影视的地区限制**（通过代理服务器），并内置 **播放加速**。

一个用户脚本，Safari（Userscripts）、Chrome / Edge / Firefox（Tampermonkey、Violentmonkey）都能用。

> 状态：早期版本（v0.x），欢迎提 Issue。

## 它做什么

- **解锁**：打开被地区限制的番剧/电影页时，在播放器位置显示解锁面板。授权后，脚本向代理服务器请求播放地址，用内置播放器（dash.js）直接播放。
- **加速**：内置 [bilibili-accelerator](https://github.com/realzza/bilibili-accelerator)，自动为慢的视频线路换更快的 CDN，右下角 ⚡ 可以打开面板。解锁后的视频同样会被加速。

## 安装

1. 先装脚本管理器：
   - Safari：App Store 上的 [Userscripts](https://apps.apple.com/app/userscripts/id1463298887)，并在 Safari 设置里允许它访问 `bilibili.com`
   - Chrome / Edge / Firefox：[Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/)
2. 打开安装地址：<https://raw.githubusercontent.com/LucasYanzy/bili-unlock/main/dist/bili-unlock.user.js>
3. 刷新已经打开的 B站 页面。

> 如果你之前装过 bilibili-accelerator，请先停用它，本脚本已经内置。
>
> Chrome / Edge 新版 Tampermonkey 需要在扩展详情里打开「允许用户脚本」。

## 使用

1. 先在 B站 登录你的账号（想看会员内容，账号本身需要有大会员）。
2. 打开被限制的视频页，点面板上的 **授权并播放**。
3. 之后同一个浏览器会直接播放。右上角可以切换画质、更换代理。

## 授权和隐私，请先读

- 授权借用你当前的 B站 登录状态，调用 B站 TV 端的扫码登录接口自己完成确认，得到一个 `access_key`。**不需要输入密码。**
- `access_key` 只保存在你浏览器的 `localStorage`（bilibili.com 域），只在向代理服务器请求播放地址时发送。
- **代理服务器会看到这个令牌**，相当于能以你的身份访问 B站 的部分接口。只用你信任的服务器，或者自己搭建。
- 想撤销：在 B站「账号安全 → 登录设备」里退出对应设备。

## 代理服务器

默认使用社区公共解析服务器 `https://bili.nepnep.moe`。服务器兼容 [哔哩漫游（BiliRoaming）](https://github.com/yujincheng08/BiliRoaming) 的解析协议即可。可以在面板上点「更换代理」，每行填一个地址，按顺序尝试。

公共服务器列表与自建方法见 BiliRoaming 的 wiki：[公共解析服务器](https://github.com/yujincheng08/BiliRoaming/wiki/%E5%85%AC%E5%85%B1%E8%A7%A3%E6%9E%90%E6%9C%8D%E5%8A%A1%E5%99%A8)、[自建解析服务器](https://github.com/yujincheng08/BiliRoaming/wiki/%E8%87%AA%E5%BB%BA%E8%A7%A3%E6%9E%90%E6%9C%8D%E5%8A%A1%E5%99%A8)。

## 限制

- 只处理网页版 B站，不管 App 和电视端。
- DRM 加密的内容无法播放。
- 会员内容需要授权的账号本身有大会员；付费内容需要已购买。
- 番剧页切换剧集时会整页刷新一次。
- 能否解锁取决于代理服务器是否可用。

## 开发

```sh
npm run build   # 生成 dist/bili-unlock.user.js
npm test
```

零依赖。源码在 `src/`，构建脚本把源码和 `vendor/` 里的加速脚本拼成一个用户脚本。

## 致谢与许可

- 播放加速来自 [realzza/bilibili-accelerator](https://github.com/realzza/bilibili-accelerator)（MIT），原样内置，许可证见 `vendor/LICENSE-bilibili-accelerator`。
- 授权流程和代理协议参考了 [ipcjs/bilibili-helper](https://github.com/ipcjs/oh-my-userscripts)（解除B站区域限制，MIT）和 [BiliRoaming](https://github.com/yujincheng08/BiliRoaming)。
- 本项目以 MIT 许可发布。仅供学习交流，请遵守当地法律和 B站 的用户协议。
