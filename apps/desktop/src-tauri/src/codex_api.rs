use chrono::Utc;
use reqwest::blocking::{Client, Response};
use serde_json::{json, Value};

use crate::{
    auth::{account_fields, decode_jwt, token_string},
    models::{ResetCredit, ResetCreditsSummary, UsageSummary, UsageWindow},
};

pub(crate) const CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
pub(crate) const ISSUER: &str = "https://auth.openai.com";
pub(crate) const ORIGINATOR: &str = "codex_cli_rs";
const USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const RESET_CREDITS_URL: &str = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";

pub(crate) fn token_expiring(auth: &Value) -> bool {
    let Some(token) = token_string(auth, "access_token") else {
        return true;
    };
    let Ok(claims) = decode_jwt(token) else {
        return false;
    };
    let Some(exp) = claims.get("exp").and_then(Value::as_i64) else {
        return false;
    };
    exp <= Utc::now().timestamp() + 300
}

pub(crate) fn refresh_tokens(client: &Client, auth: &mut Value) -> Result<(), String> {
    let refresh_token = token_string(auth, "refresh_token")
        .ok_or_else(|| "登录已过期，且 auth.json 中没有 refresh_token；请重新登录".to_string())?
        .to_string();
    let response = client
        .post(format!("{ISSUER}/oauth/token"))
        .header("Content-Type", "application/json")
        .header("originator", ORIGINATOR)
        .json(&json!({
            "client_id": CLIENT_ID,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }))
        .send()
        .map_err(|error| format!("刷新登录凭据失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "刷新登录凭据失败（HTTP {}），请重新登录",
            response.status()
        ));
    }
    let payload: Value = response
        .json()
        .map_err(|error| format!("解析刷新响应失败：{error}"))?;
    let tokens = auth
        .get_mut("tokens")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "auth.json 缺少 tokens 对象".to_string())?;
    for key in ["id_token", "access_token", "refresh_token"] {
        if let Some(value) = payload.get(key).and_then(Value::as_str) {
            tokens.insert(key.to_string(), Value::String(value.to_string()));
        }
    }
    auth.as_object_mut()
        .ok_or_else(|| "auth.json 顶层格式无效".to_string())?
        .insert(
            "last_refresh".to_string(),
            Value::String(Utc::now().to_rfc3339()),
        );
    Ok(())
}

pub(crate) fn usage_request(client: &Client, auth: &Value) -> Result<Response, String> {
    authorized_get(client, auth, USAGE_URL, "读取 Codex 用量失败")
}

pub(crate) fn reset_credits_request(client: &Client, auth: &Value) -> Result<Response, String> {
    authorized_get(client, auth, RESET_CREDITS_URL, "读取 Codex 重置卡失败")
}

fn authorized_get(
    client: &Client,
    auth: &Value,
    url: &str,
    error_context: &str,
) -> Result<Response, String> {
    let access_token = token_string(auth, "access_token")
        .ok_or_else(|| "auth.json 缺少 access_token".to_string())?;
    let (_, _, account_id, _) = account_fields(auth)?;
    let mut request = client
        .get(url)
        .bearer_auth(access_token)
        .header("originator", ORIGINATOR)
        .header("User-Agent", "codex_cli_rs/0.1.0");
    if let Some(account_id) = account_id {
        request = request.header("ChatGPT-Account-Id", account_id);
    }
    request
        .send()
        .map_err(|error| format!("{error_context}：{error}"))
}

fn normalized_timestamp(value: Option<&Value>) -> Option<String> {
    let value = value?;
    if let Some(timestamp) = value.as_str() {
        return chrono::DateTime::parse_from_rfc3339(timestamp)
            .ok()
            .map(|value| value.with_timezone(&Utc).to_rfc3339());
    }

    let raw = value.as_i64()?;
    let seconds = if raw.abs() >= 100_000_000_000 {
        raw / 1000
    } else {
        raw
    };
    chrono::DateTime::<Utc>::from_timestamp(seconds, 0).map(|value| value.to_rfc3339())
}

pub(crate) fn parse_reset_credits(payload: &Value) -> Result<ResetCreditsSummary, String> {
    let credits = payload
        .get("credits")
        .and_then(Value::as_array)
        .ok_or_else(|| "重置卡接口响应缺少 credits 列表".to_string())?;
    let mut result = credits
        .iter()
        .map(|credit| ResetCredit {
            issued_at: normalized_timestamp(
                credit
                    .get("granted_at")
                    .or_else(|| credit.get("created_at")),
            ),
            expires_at: normalized_timestamp(credit.get("expires_at")),
        })
        .collect::<Vec<_>>();
    result.sort_by(|left, right| left.expires_at.cmp(&right.expires_at));
    Ok(ResetCreditsSummary { credits: result })
}

fn window_from(value: Option<&Value>) -> Option<UsageWindow> {
    let value = value?;
    let used = value.get("used_percent")?.as_f64()?.clamp(0.0, 100.0);
    Some(UsageWindow {
        used_percent: used,
        remaining_percent: (100.0 - used).clamp(0.0, 100.0),
        resets_at: value.get("reset_at").and_then(Value::as_i64),
        window_minutes: value
            .get("limit_window_seconds")
            .and_then(Value::as_i64)
            .filter(|seconds| *seconds > 0)
            .map(|seconds| seconds / 60),
    })
}

pub(crate) fn parse_usage(payload: &Value) -> UsageSummary {
    let rate_limit = payload.get("rate_limit").filter(|value| !value.is_null());
    UsageSummary {
        primary: window_from(rate_limit.and_then(|value| value.get("primary_window"))),
        secondary: window_from(rate_limit.and_then(|value| value.get("secondary_window"))),
        fetched_at: Some(Utc::now().to_rfc3339()),
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_used_quota_to_remaining_quota() {
        let usage = parse_usage(&json!({
            "rate_limit": {
                "primary_window": { "used_percent": 42, "limit_window_seconds": 18000, "reset_at": 123 },
                "secondary_window": { "used_percent": 5, "limit_window_seconds": 604800, "reset_at": 456 }
            }
        }));
        assert_eq!(usage.primary.unwrap().remaining_percent, 58.0);
        assert_eq!(usage.secondary.unwrap().window_minutes, Some(10080));
    }

    #[test]
    fn returns_only_reset_credit_times() {
        let summary = parse_reset_credits(&json!({
            "available_count": 1,
            "credits": [{
                "credit_id": "must-not-leave-rust",
                "status": "available",
                "granted_at": "2026-06-30T03:04:05Z",
                "expires_at": "2026-07-30T03:04:05Z"
            }]
        }))
        .unwrap();
        let serialized = serde_json::to_value(summary).unwrap();
        assert_eq!(
            serialized["credits"][0]["issuedAt"],
            "2026-06-30T03:04:05+00:00"
        );
        assert_eq!(
            serialized["credits"][0]["expiresAt"],
            "2026-07-30T03:04:05+00:00"
        );
        assert!(serialized.to_string().find("must-not-leave-rust").is_none());
    }
}
