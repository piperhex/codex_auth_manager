use serde::{Deserialize, Serialize};

pub(crate) const DEFAULT_CLOUD_BASE_URL: &str = "https://codex.onepiper.cloud";

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
    pub(crate) auto_switch_enabled: bool,
    pub(crate) local_proxy_compatible: bool,
    pub(crate) direct_switch_compatible: bool,
    pub(crate) agent_identity: bool,
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
    /// Last known executable used by the local ChatGPT/Codex desktop app. This is
    /// intentionally only a local launch hint; it is never synced with accounts.
    #[serde(default)]
    pub(crate) local_codex_path: Option<String>,
    #[serde(default)]
    pub(crate) local_proxy_enabled: bool,
    #[serde(default)]
    pub(crate) auto_switch_on_quota_exhaustion: bool,
    #[serde(default)]
    pub(crate) auto_disable_unreachable_accounts: bool,
    #[serde(default)]
    pub(crate) local_proxy_listen_on_all_interfaces: bool,
    #[serde(default)]
    pub(crate) image_generation_account_id: Option<String>,
    #[serde(default)]
    pub(crate) disabled_account_ids: Vec<String>,
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
    #[serde(default)]
    pub(crate) models: Vec<String>,
    #[serde(default)]
    pub(crate) model_selection_controlled_by_codex: bool,
    pub(crate) api_format: ProviderApiFormat,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderSummary {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) base_url: String,
    pub(crate) model: String,
    pub(crate) models: Vec<String>,
    pub(crate) model_selection_controlled_by_codex: bool,
    pub(crate) api_format: ProviderApiFormat,
    pub(crate) active: bool,
    pub(crate) has_api_key: bool,
    pub(crate) supports_direct_switch: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalProxyStatus {
    pub(crate) running: bool,
    pub(crate) address: String,
    pub(crate) port: u16,
    pub(crate) base_url: String,
    pub(crate) auto_switch_on_quota_exhaustion: bool,
    pub(crate) auto_disable_unreachable_accounts: bool,
    pub(crate) listen_on_all_interfaces: bool,
    pub(crate) image_generation_account_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TokenUsageEntry {
    pub(crate) id: String,
    pub(crate) ts: u64,
    pub(crate) provider: String,
    pub(crate) account_id: Option<String>,
    pub(crate) account_email: Option<String>,
    pub(crate) model: String,
    pub(crate) duration_ms: Option<u64>,
    pub(crate) input_tokens: Option<u64>,
    pub(crate) output_tokens: Option<u64>,
    pub(crate) reasoning_tokens: Option<u64>,
    pub(crate) cached_tokens: Option<u64>,
    pub(crate) total_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DailyTokenUsage {
    pub(crate) date: String,
    pub(crate) total_tokens: u64,
    pub(crate) input_tokens: u64,
    pub(crate) output_tokens: u64,
    pub(crate) reasoning_tokens: u64,
    pub(crate) cached_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppSettings {
    #[serde(default)]
    pub(crate) floating_bubble_enabled: bool,
    #[serde(default)]
    pub(crate) theme_color: Option<String>,
    #[serde(default)]
    pub(crate) language: Option<String>,
    #[serde(default = "default_privacy_mode")]
    pub(crate) privacy_mode: bool,
    #[serde(default)]
    pub(crate) bubble_reset_display: BubbleResetDisplay,
    #[serde(default)]
    pub(crate) bubble_x: Option<f64>,
    #[serde(default)]
    pub(crate) bubble_y: Option<f64>,
    #[serde(default = "default_cloud_base_url")]
    pub(crate) cloud_base_url: Option<String>,
    #[serde(default)]
    pub(crate) cloud_user_email: Option<String>,
    #[serde(default)]
    pub(crate) cloud_user_id: Option<String>,
    #[serde(default)]
    pub(crate) cloud_last_sync_at: Option<String>,
    #[serde(default = "default_token_usage_weeks")]
    pub(crate) token_usage_weeks: u16,
    #[serde(default = "default_token_usage_refresh_seconds")]
    pub(crate) token_usage_refresh_seconds: u64,
    /// New installations are invited to enable proxy mode once. Existing
    /// installations retain the `Legacy` default and are never interrupted.
    #[serde(default)]
    pub(crate) proxy_onboarding_status: ProxyOnboardingStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ProxyOnboardingStatus {
    Legacy,
    Pending,
    Enabled,
    Declined,
}

impl Default for ProxyOnboardingStatus {
    fn default() -> Self {
        Self::Legacy
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum BubbleResetDisplay {
    Countdown,
    ResetAt,
}

impl Default for BubbleResetDisplay {
    fn default() -> Self {
        Self::Countdown
    }
}

fn default_privacy_mode() -> bool {
    true
}

fn default_cloud_base_url() -> Option<String> {
    Some(DEFAULT_CLOUD_BASE_URL.to_string())
}

pub(crate) const MIN_TOKEN_USAGE_WEEKS: u16 = 1;
pub(crate) const MAX_TOKEN_USAGE_WEEKS: u16 = 52;
pub(crate) const MIN_TOKEN_USAGE_REFRESH_SECONDS: u64 = 1;
pub(crate) const MAX_TOKEN_USAGE_REFRESH_SECONDS: u64 = 3_600;

fn default_token_usage_weeks() -> u16 {
    20
}

fn default_token_usage_refresh_seconds() -> u64 {
    60
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            floating_bubble_enabled: false,
            theme_color: None,
            language: None,
            privacy_mode: default_privacy_mode(),
            bubble_reset_display: BubbleResetDisplay::default(),
            bubble_x: None,
            bubble_y: None,
            cloud_base_url: default_cloud_base_url(),
            cloud_user_email: None,
            cloud_user_id: None,
            cloud_last_sync_at: None,
            token_usage_weeks: default_token_usage_weeks(),
            token_usage_refresh_seconds: default_token_usage_refresh_seconds(),
            proxy_onboarding_status: ProxyOnboardingStatus::Legacy,
        }
    }
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

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountFieldModifiedAt {
    #[serde(default)]
    pub(crate) auth: String,
    #[serde(default)]
    pub(crate) note: String,
    #[serde(default)]
    pub(crate) expires_at: String,
    #[serde(default)]
    pub(crate) usage: String,
    #[serde(default)]
    pub(crate) active: String,
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
    pub(crate) last_modified_at: String,
    #[serde(default)]
    pub(crate) field_modified_at: AccountFieldModifiedAt,
    pub(crate) auth: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderSyncPayload {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) base_url: String,
    pub(crate) api_key: String,
    pub(crate) model: String,
    #[serde(default)]
    pub(crate) models: Vec<String>,
    #[serde(default)]
    pub(crate) model_selection_controlled_by_codex: bool,
    pub(crate) api_format: ProviderApiFormat,
    pub(crate) last_modified_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manager_state_defaults_local_proxy_to_disabled() {
        let state: ManagerStateFile =
            serde_json::from_str(r#"{"active_account_id":"account-1"}"#).unwrap();

        assert_eq!(state.active_account_id.as_deref(), Some("account-1"));
        assert!(!state.local_proxy_enabled);
        assert!(!state.auto_switch_on_quota_exhaustion);
        assert!(!state.auto_disable_unreachable_accounts);
        assert!(!state.local_proxy_listen_on_all_interfaces);
        assert!(state.image_generation_account_id.is_none());
        assert!(state.disabled_account_ids.is_empty());
    }

    #[test]
    fn app_settings_default_to_the_hosted_cloud_server() {
        let defaults = AppSettings::default();
        let migrated: AppSettings = serde_json::from_str("{}").unwrap();
        let explicitly_disabled: AppSettings =
            serde_json::from_str(r#"{"cloudBaseUrl":null}"#).unwrap();

        assert_eq!(
            defaults.cloud_base_url.as_deref(),
            Some(DEFAULT_CLOUD_BASE_URL)
        );
        assert_eq!(
            migrated.cloud_base_url.as_deref(),
            Some(DEFAULT_CLOUD_BASE_URL)
        );
        assert!(explicitly_disabled.cloud_base_url.is_none());
    }
}
