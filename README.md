# Codex Auth Manager

一个本地优先的 Tauri 2 桌面应用，用来登录、保存和切换多个 Codex / ChatGPT 账户。

## 功能

- 复用 Codex CLI 的 OAuth 2.0 + PKCE 登录流程（回调端口 `1455`，备用 `1457`）
- 支持应用内 ChatGPT 登录窗口，并保留默认浏览器登录作为企业 SSO 兼容方案
- 导入和管理多份 `auth.json`
- 切换账户时原子覆盖 `$CODEX_HOME/auth.json`（默认 `~/.codex/auth.json`）
- 展示账户邮箱、套餐、5 小时与 1 周剩余用量
- 访问令牌不进入 React 前端，不输出到日志

## 开发

需要 Node.js、npm、Rust stable，以及 Windows 上的 WebView2。

```powershell
npm install
npm run dev:app
```

仅预览界面（使用演示数据，不读取真实凭据）：

```powershell
npm run dev
```

构建安装包：

```powershell
npm run build:app
```

> 切换会立即替换磁盘上的 `auth.json`。已经运行的 Codex 进程可能缓存了旧身份，建议在切换后重新启动对应会话。
