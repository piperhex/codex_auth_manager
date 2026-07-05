use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountSummary {
    pub(crate) id: String,
    pub(crate) email: String,
    pub(crate) note: String,
    pub(crate) expires_at: String,
    pub(crate) plan: String,
    pub(crate) account_id: Option<String>,
    pub(crate) active: bool,
    pub(crate) usage: UsageSummary,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageSummary {
    pub(crate) primary: Option<UsageWindow>,
    pub(crate) secondary: Option<UsageWindow>,
    pub(crate) fetched_at: Option<String>,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageWindow {
    pub(crate) used_percent: f64,
    pub(crate) remaining_percent: f64,
    pub(crate) resets_at: Option<i64>,
    pub(crate) window_minutes: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResetCredit {
    pub(crate) issued_at: Option<String>,
    pub(crate) expires_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ResetCreditsSummary {
    pub(crate) credits: Vec<ResetCredit>,
}

#[derive(Default, Serialize, Deserialize)]
pub(crate) struct ManagerStateFile {
    pub(crate) active_account_id: Option<String>,
    pub(crate) active_provider_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppInfo {
    pub(crate) codex_home: String,
    pub(crate) auth_path: String,
    pub(crate) config_path: String,
    pub(crate) account_store: String,
    pub(crate) provider_store: String,
    pub(crate) version: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ProviderApiFormat {
    OpenaiResponses,
    OpenaiChat,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderProfile {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) base_url: String,
    pub(crate) api_key: String,
    pub(crate) model: String,
    pub(crate) api_format: ProviderApiFormat,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderSummary {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) base_url: String,
    pub(crate) model: String,
    pub(crate) api_format: ProviderApiFormat,
    pub(crate) active: bool,
    pub(crate) has_api_key: bool,
    pub(crate) supports_direct_switch: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateInfo {
    pub(crate) current_version: String,
    pub(crate) latest_version: String,
    pub(crate) release_name: String,
    pub(crate) release_notes: Option<String>,
    pub(crate) release_url: String,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppSettings {
    #[serde(default)]
    pub(crate) floating_bubble_enabled: bool,
    #[serde(default)]
    pub(crate) theme_color: Option<String>,
    #[serde(default)]
    pub(crate) bubble_x: Option<f64>,
    #[serde(default)]
    pub(crate) bubble_y: Option<f64>,
    #[serde(default)]
    pub(crate) cloud_base_url: Option<String>,
    #[serde(default)]
    pub(crate) cloud_user_email: Option<String>,
    #[serde(default)]
    pub(crate) cloud_user_id: Option<String>,
    #[serde(default)]
    pub(crate) cloud_last_sync_at: Option<String>,
}

#[derive(Serialize, Clone)]
pub(crate) struct LoginStatus {
    pub(crate) ok: bool,
    pub(crate) message: String,
    #[serde(rename = "accountId")]
    pub(crate) account_id: Option<String>,
}

#[derive(Serialize)]
pub(crate) struct LoginStart {
    pub(crate) url: String,
    pub(crate) embedded: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudAuthState {
    pub(crate) enabled: bool,
    pub(crate) base_url: Option<String>,
    pub(crate) authenticated: bool,
    pub(crate) user_email: Option<String>,
    pub(crate) user_id: Option<String>,
    pub(crate) last_sync_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudSyncResult {
    pub(crate) uploaded: usize,
    pub(crate) downloaded: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudAccountPayload {
    pub(crate) id: String,
    pub(crate) email: String,
    pub(crate) note: String,
    pub(crate) expires_at: String,
    pub(crate) plan: String,
    pub(crate) account_id: Option<String>,
    pub(crate) active: bool,
    pub(crate) usage: UsageSummary,
    pub(crate) auth: serde_json::Value,
}
