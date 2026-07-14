# Codex Switch Native

React Native（Expo）移动端，用已登录的 Codex Switch 云端账号查看桌面首页的官方账号与用量概览。

## 启动

```bash
npm install
npm run start -w @codex-switch/native
npm run android -w @codex-switch/native
npm run ios -w @codex-switch/native
```

`npm run export:android -w @codex-switch/native` 可在不启动模拟器的情况下校验 Android JS bundle。

每个版本 tag 的 GitHub Release 会构建 `CodexSwitch-android.apk`，以及未签名的 iOS Release `.app.zip`。iOS 压缩包用于 CI 构建验证；如需安装到真机或提交 App Store，仍需在 CI 中配置 Apple 证书与 provisioning profile 以导出签名 IPA。

首次登录需输入部署的后端根地址（例如 `https://api.example.com`）及 Codex Switch 云端账号。登录令牌保存在 iOS Keychain / Android Keystore 支持的安全存储中；移动端仅读取 `/sync/accounts/summary`，不会接收账户授权内容，也不能切换桌面端当前账号。

下拉刷新、页面内“刷新”和应用回到前台时，移动端只会重新读取服务器上最近一次同步的摘要，不会直接调用 Codex 官方接口刷新额度。要看到新的用量数据，请先由桌面端刷新账号用量并完成云同步。隐私开关仅遮罩当前页面中的邮箱和备注。

生产环境应使用 HTTPS。为了便于连接现有局域网或本地开发后端，当前 Expo 配置允许 HTTP；发布前若只使用 HTTPS，可移除 `app.json` 中的明文传输配置。
