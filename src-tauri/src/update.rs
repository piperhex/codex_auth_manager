use std::time::Duration;

use reqwest::blocking::Client;
use semver::Version;
use serde::Deserialize;
use tauri::{AppHandle, Runtime};

use crate::models::UpdateInfo;

const LATEST_RELEASE_API: &str =
    "https://api.github.com/repos/piperhex/codex-switch/releases/latest";

#[derive(Deserialize)]
struct GithubRelease {
    tag_name: String,
    name: Option<String>,
    body: Option<String>,
    html_url: String,
}

fn normalized_version(value: &str) -> Result<Version, String> {
    Version::parse(
        value
            .trim()
            .trim_start_matches(|character| character == 'v' || character == 'V'),
    )
    .map_err(|error| format!("无法解析版本号 {value}：{error}"))
}

fn fetch_update(current_version: String) -> Result<Option<UpdateInfo>, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| format!("创建更新检查客户端失败：{error}"))?;
    let release = client
        .get(LATEST_RELEASE_API)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "codex-switch-update-check")
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|error| format!("检查 GitHub Release 失败：{error}"))?
        .json::<GithubRelease>()
        .map_err(|error| format!("解析 GitHub Release 失败：{error}"))?;

    if normalized_version(&release.tag_name)? <= normalized_version(&current_version)? {
        return Ok(None);
    }

    Ok(Some(UpdateInfo {
        current_version,
        latest_version: release.tag_name.trim_start_matches(['v', 'V']).to_string(),
        release_name: release.name.unwrap_or_else(|| release.tag_name.clone()),
        release_notes: release.body.filter(|body| !body.trim().is_empty()),
        release_url: release.html_url,
    }))
}

#[tauri::command]
pub(crate) async fn check_for_update<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<UpdateInfo>, String> {
    let current_version = app.package_info().version.to_string();
    tauri::async_runtime::spawn_blocking(move || fetch_update(current_version))
        .await
        .map_err(|error| format!("更新检查任务失败：{error}"))?
}

#[cfg(test)]
mod tests {
    use super::normalized_version;

    #[test]
    fn parses_release_tags_with_or_without_v_prefix() {
        assert_eq!(
            normalized_version("v0.1.13").unwrap(),
            normalized_version("0.1.13").unwrap()
        );
        assert!(normalized_version("v0.2.0").unwrap() > normalized_version("0.1.13").unwrap());
    }
}
