# Codex Switch

## 为多 Codex 账户而生的本地桌面管理工具

集中管理多个 Codex / ChatGPT 账户，快速切换当前 Codex 身份，并在一个界面中查看各账户的用量周期与重置时间。

**本地优先 · Windows 与 macOS · 中文 / English**

[下载最新版本](https://github.com/piperhex/codex-switch/releases/latest) · [查看全部版本](https://github.com/piperhex/codex-switch/releases) · [访问 GitHub 仓库](https://github.com/piperhex/codex-switch)

> Codex Switch 是面向 Codex 多账户用户的桌面工具。它将账户登录、凭据导入、用量查看和身份切换集中在一个清晰的工作台中，让日常使用更简单、更可控。

![Codex Switch 账户管理界面](https://raw.githubusercontent.com/piperhex/codex-switch/master/docs/assets/codex-switch-dashboard.png)

---

## 告别重复登录与手动替换文件

当你需要在不同 Codex 账户之间工作时，反复登录、复制 `auth.json`、确认剩余用量，既费时也容易出错。

Codex Switch 将这些操作整合到一个本地桌面应用中：添加账户后，你可以随时查看账户状态，选择目标身份，并以原子方式更新 Codex 当前使用的认证文件。

### 多账户集中管理

通过应用内登录、系统浏览器登录，或导入已有的 `auth.json` 文件添加账户。账户信息集中展示，当前账户一目了然。

### 一键切换 Codex 身份

选择目标账户即可切换 `$CODEX_HOME/auth.json`；未设置 `CODEX_HOME` 时，默认使用 `~/.codex/auth.json`。

### 用量状态清晰可见

查看账户套餐、5 小时窗口、每周窗口、剩余比例、重置时间与重置卡信息，无需逐个账户反复确认。

### 灵活的自动刷新

支持手动刷新全部账户，也可以设置全局自动刷新；当前账户还可拥有独立的刷新开关与时间间隔。

### 系统托盘与悬浮球

从系统托盘快速打开面板或切换账户；启用悬浮球后，无需停下当前工作也能关注用量状态。

### 中英文界面

内置中文与英文界面，适配不同的工作环境与使用习惯。

---

## 三步开始使用

1. **下载并安装**  
   前往 [GitHub Releases](https://github.com/piperhex/codex-switch/releases/latest)，根据操作系统选择对应安装包。

2. **添加账户**  
   在应用中选择“添加账户”，使用应用内窗口、系统浏览器完成登录，或导入已有的 `auth.json`。

3. **查看并切换**  
   刷新账户用量，选择需要使用的账户并点击“切换”。切换后，请重新启动相关 Codex 会话，避免正在运行的进程继续使用缓存凭据。

---

## 本地优先，凭据留在你的设备上

Codex Switch 采用 Tauri 2 构建。认证令牌由 Rust 后端处理，不会传入 React 界面，也不会写入应用日志。账户副本保存在操作系统的应用数据目录中，账户切换通过原子写入完成，以降低认证文件写入中断的风险。

但“本地优先”不等于“无需防护”：

- 应用目前不会对本地凭据增加额外的加密层。
- 请仅在可信设备上使用，并保护好操作系统账户。
- 不要提交、分享或截图展示 `auth.json`、Token、真实账户 ID 等敏感信息。
- 如果设备由多人共用，建议不要在其中保存生产或重要账户凭据。

[了解架构与数据流](https://github.com/piperhex/codex-switch/blob/master/docs/architecture.md)

---

## 桌面平台支持

| 平台 | 架构 | 发布形式 | 说明 |
| --- | --- | --- | --- |
| Windows | x64 | 安装程序 | 需要 WebView2；多数现代 Windows 系统已预装 |
| macOS | Apple Silicon | 应用安装包 | 当前为临时签名，尚未经过 Apple 公证 |
| macOS | Intel | 应用安装包 | 当前为临时签名，尚未经过 Apple 公证 |

> macOS 若出现系统安全提示，请确认安装包来自本项目的 GitHub Releases。应用内登录受 WebView 与身份提供方策略影响；如无法完成登录，请改用系统浏览器。

---

## 持续迭代，稳定交付

从多平台构建、国际化与账户切换，到重置卡查询、系统托盘、悬浮球和独立刷新策略，Codex Switch 正在围绕真实的多账户工作流持续演进。

版本通过 GitHub Actions 自动构建并发布，Windows 与 macOS 安装包均可在 Releases 页面获取。你可以随时查看历史版本、发布日期与对应构建产物。

[查看版本记录](https://github.com/piperhex/codex-switch/releases) · [关注开发进展](https://github.com/piperhex/codex-switch/commits/master)

---

## 常见问题

### Codex Switch 会把我的凭据上传到第三方服务器吗？

不会。应用在本地管理账户凭据，并直接复用 Codex CLI 的 OAuth 2.0 + PKCE 登录流程。请注意，正常登录、刷新凭据和查询用量仍需要访问相应的官方在线服务。

### 可以导入现有的 `auth.json` 吗？

可以。应用支持导入并管理多个 `auth.json` 文件，也支持直接通过应用内窗口或系统浏览器添加账户。

### 切换账户后为什么当前 Codex 会话没有变化？

已经运行的 Codex 进程可能仍在使用缓存凭据。完成切换后，请重新启动相关 Codex 会话。

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

<small>Codex Switch 是采用 Apache License 2.0 的开源项目，当前面向桌面环境。请遵守相关服务条款，并仅管理你有权使用的账户。</small>
