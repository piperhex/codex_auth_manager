# Codex Switch

## 为多 Codex 账户而生的本地桌面管理工具

集中管理多个 Codex / ChatGPT 账户，快速切换当前 Codex 身份，并在一个界面中查看各账户的用量周期与重置时间。

**本地优先 · Windows / macOS / Linux · 中文 / English**

[下载最新版本](https://github.com/piperhex/codex-switch/releases/latest) · [查看全部版本](https://github.com/piperhex/codex-switch/releases) · [访问 GitHub 仓库](https://github.com/piperhex/codex-switch)

> Codex Switch 是面向 Codex 多账户用户的桌面工具。它将账户登录、凭据导入、用量查看、身份切换和第三方 Provider 管理集中在一个清晰的工作台中，并可选连接自部署后端与只读移动端。

![Codex Switch 账户管理界面](https://raw.githubusercontent.com/piperhex/codex-switch/master/docs/assets/codex-switch-dashboard.png)

---

## 告别重复登录与手动替换文件

当你需要在不同 Codex 账户之间工作时，反复登录、复制 `auth.json`、确认剩余用量，既费时也容易出错。

Codex Switch 将这些操作整合到一个本地桌面应用中：添加账户后，你可以随时查看账户状态，选择目标身份，并以原子方式更新 Codex 当前使用的认证文件。

### 多账户集中管理

通过应用内登录、系统浏览器登录，或导入已有的 `auth.json` 文件添加账户。兼容导入还支持常见第三方账号管理器导出的单账号、多账号数组、`accounts` 包装和逐行 JSON。

### 一键切换 Codex 身份

选择目标账户即可切换 `$CODEX_HOME/auth.json`；未设置 `CODEX_HOME` 时，默认使用 `~/.codex/auth.json`。

### 一键请求重启 ChatGPT

切换后可直接从主界面或系统托盘请求重启 ChatGPT，减少正在运行的进程继续使用旧凭据的机会。

### 用量状态清晰可见

查看账户套餐、主/次用量窗口、剩余比例、重置时间与重置卡信息，也可使用可用的重置卡，无需逐个账户反复确认。

### 灵活的自动刷新

支持手动刷新全部账户，也可以设置全局自动刷新；当前账户还可拥有独立的刷新开关与时间间隔，切换到哪个账户就刷新哪个账户。

### 系统托盘与悬浮球

从系统托盘快速打开面板、切换账户、重启 ChatGPT 或退出程序；启用悬浮球后，无需停下当前工作也能关注用量状态，右键还可打开同一组快捷操作。

### Provider、热切换与自动切号

管理兼容 OpenAI Responses 或 Chat Completions 的第三方 Provider、API Key 与模型列表。本地代理运行后可在官方账号和 Provider 间热切换；官方额度耗尽时，还可刷新所有账号、自动切到主用量最低的可用账号并重试一次。

### 备份、Token 汇总与可选云同步

通过 `.cs` 文件备份和恢复本地账号与 Provider；本地代理可汇总请求返回的 Token 用量并导出结构化诊断（分享前仍应自行检查）。需要跨设备时，可连接自部署后端同步数据，并通过 Android / iOS 伴侣端查看只读用量摘要。

### 中英文界面

内置中文与英文界面，适配不同的工作环境与使用习惯。

---

## 三步开始使用

1. **下载并安装**  
   前往 [GitHub Releases](https://github.com/piperhex/codex-switch/releases/latest)，根据操作系统选择对应安装包。

2. **添加账户**  
   在应用中选择“添加账户”，使用应用内窗口、系统浏览器完成登录，或导入已有的 `auth.json` / 兼容 JSON。

3. **查看并切换**  
   刷新账户用量，选择需要使用的账户并点击“切换”。切换后，可使用“重启 ChatGPT”让本地 ChatGPT/Codex 进程重新读取当前凭据。

---

## 本地优先，云同步由你选择

Codex Switch 采用 Tauri 2 构建。认证令牌和 Provider API Key 由 Rust 后端处理，不会传入桌面 React 界面，也不会写入应用日志。默认本地模式下，账号与 Provider 保存在操作系统的应用数据目录中；只有主动配置并登录自部署后端后，才会启用云同步。

但“本地优先”不等于“无需防护”：

- 应用目前不会对本地账号凭据、Provider Key 和桌面云登录令牌增加额外的静态加密层。
- 请仅在可信设备上使用，并保护好操作系统账户。
- `.cs` 备份包含可恢复的账号凭据和 Provider Key，请像保护 `auth.json` 一样保护它。
- 开启云同步会把完整账号凭据和 Provider Key 上传到你配置的后端；请使用 HTTPS，并确保你信任该服务器及其数据库和备份管理。
- 不要提交、分享或截图展示 `auth.json`、`.cs`、Token、API Key、真实账户 ID 等敏感信息。
- 如果设备由多人共用，建议不要在其中保存生产或重要账户凭据。

[了解架构与数据流](https://github.com/piperhex/codex-switch/blob/master/docs/architecture.md)

---

## 发布平台支持

| 平台 | 架构 | 发布形式 | 说明 |
| --- | --- | --- | --- |
| Windows | x64 | 安装程序 | 需要 WebView2；多数现代 Windows 系统已预装 |
| Windows | ARM64 | 安装程序 | 适用于 Windows ARM64 设备 |
| Linux | x64 | `.deb` / AppImage | 运行时需要相应 WebKitGTK 系统依赖 |
| macOS | Apple Silicon | 应用安装包 | 当前为临时签名，尚未经过 Apple 公证 |
| macOS | Intel | 应用安装包 | 当前为临时签名，尚未经过 Apple 公证 |
| Android | 常用 ABI | APK | 只读移动伴侣端，需要自部署后端 |
| iOS | Device build | 未签名 `.app.zip` | 仅用于 CI 构建验证，安装或上架仍需 Apple 签名 |

> macOS 若出现系统安全提示，请确认安装包来自本项目的 GitHub Releases。应用内登录受 WebView 与身份提供方策略影响；如无法完成登录，请改用系统浏览器。

---

## 持续迭代，稳定交付

从多平台构建、国际化与账户切换，到 Provider 热切换、额度耗尽自动切号、Token 汇总、云同步、管理后台和只读移动端，Codex Switch 正在围绕真实的多账户工作流持续演进。

版本通过 GitHub Actions 自动构建并发布，Windows、macOS、Linux、Android 与 iOS 验证构建均可在 Releases 页面获取。你可以随时查看历史版本、发布日期与对应构建产物。

[查看版本记录](https://github.com/piperhex/codex-switch/releases) · [关注开发进展](https://github.com/piperhex/codex-switch/commits/master)

---

## 常见问题

### Codex Switch 会把我的凭据上传到第三方服务器吗？

默认本地模式不会上传到 Codex Switch 后端，但正常登录、刷新凭据和查询用量仍会访问相应的官方在线服务。若你主动配置并登录云同步服务器，桌面端会把完整账号凭据和 Provider API Key 上传到该服务器，以支持同步、后台分配和移动端摘要；请只使用你信任的自部署服务。

### 可以导入现有的 `auth.json` 吗？

可以。应用支持导入并管理多个 `auth.json` 文件，也支持常见第三方 JSON 字段、账号数组、`accounts` 包装和逐行 JSON。导入后会统一规范化并验证为 Codex Switch 使用的账号格式。

### 本地代理和自动切号什么时候生效？

本地代理启动后会监听 `127.0.0.1:15722` 并让 Codex 通过它访问当前官方账号或 Provider，因此后续切换通常无需重启。自动切号只在代理运行且当前使用官方账号时生效；命中额度错误后会刷新已保存账号，选择主用量最低且仍有剩余额度的账号，并只重试当前请求一次。

### 切换账户后为什么当前 Codex 会话没有变化？

已经运行的 ChatGPT/Codex 进程可能仍在使用缓存凭据。完成切换后，可以使用主界面或系统托盘中的“重启 ChatGPT”操作；该操作会尽力停止并重新启动本机 ChatGPT。

### 为什么应用内登录无法打开或完成？

应用内登录依赖系统 WebView 与身份提供方策略。遇到问题时，请选择使用系统默认浏览器登录，并确认本地回调端口 `1455` 或备用端口 `1457` 未被其他程序占用。

### macOS 安装时为什么会出现安全提示？

当前 macOS 构建尚未完成 Apple Developer 公证。请只从本项目的 GitHub Releases 下载，并在继续安装前核对来源。

### 这是 OpenAI 官方产品吗？

不是。Codex Switch 是独立开发的第三方工具，与 OpenAI 无隶属、授权或背书关系。Codex、ChatGPT 与 OpenAI 是其各自权利人的商标。

---

## 获取 Codex Switch

让多个 Codex 账户的管理、用量查看与身份切换，回到一个简单、清晰的桌面工作台。

[**下载最新版本 →**](https://github.com/piperhex/codex-switch/releases/latest)

[查看源代码](https://github.com/piperhex/codex-switch) · [Apache-2.0 许可证](https://github.com/piperhex/codex-switch/blob/master/LICENSE) · [提交问题与建议](https://github.com/piperhex/codex-switch/issues)

---

<small>Codex Switch 是采用 Apache License 2.0 的开源项目，以桌面端为完整管理入口，并提供可选的自部署后端和只读移动伴侣端。请遵守相关服务条款，并仅管理你有权使用的账户。</small>
