# Agent Notes

## Tauri 2 WebView Window Creation On Windows

- Do not create a `WebviewWindowBuilder` from a synchronous Tauri command on Windows. In this repo, opening the Token Usage window from a sync `#[tauri::command]` produced a native window shell, but the WebView content stayed white, the close button did not work reliably, and DevTools could not be opened.
- Use an `async fn` command for window creation instead. The working fix was changing `show_token_usage_window` from a synchronous command to `pub(crate) async fn show_token_usage_window(...) -> Result<(), String>`.
- If adding a new Tauri window label, also add it to `apps/desktop/src-tauri/capabilities/default.json`. For Token Usage, the label is `token-usage`.
- Prefer hash routing for single-page subwindows loaded from packaged assets, for example `WebviewUrl::App("index.html#token-usage".into())`, and keep the frontend route parser compatible with both query and hash routes.
- For auxiliary windows that previously got stuck, add a Rust-side close fallback in `on_window_event` that destroys the specific window label instead of hiding the main app.

