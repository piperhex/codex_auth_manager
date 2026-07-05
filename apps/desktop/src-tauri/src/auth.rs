use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{DateTime, Utc};
use serde_json::Value;
use sha2::{Digest, Sha256};

pub(crate) fn decode_jwt(token: &str) -> Result<Value, String> {
    let payload = token
        .split('.')
        .nth(1)
        .filter(|part| !part.is_empty())
        .ok_or_else(|| "auth.json 中的 JWT 格式无效".to_string())?;
    let bytes = URL_SAFE_NO_PAD
        .decode(payload)
        .map_err(|_| "auth.json 中的 JWT 无法解码".to_string())?;
    serde_json::from_slice(&bytes)
        .map_err(|_| "auth.json 中的 JWT payload 不是有效 JSON".to_string())
}

pub(crate) fn token_string<'a>(auth: &'a Value, key: &str) -> Option<&'a str> {
    auth.get("tokens")?
        .get(key)?
        .as_str()
        .filter(|value| !value.is_empty())
}

fn auth_claims(auth: &Value) -> Result<Value, String> {
    let token = token_string(auth, "id_token")
        .or_else(|| token_string(auth, "access_token"))
        .ok_or_else(|| "auth.json 缺少 ChatGPT tokens".to_string())?;
    decode_jwt(token)
}

fn nested_auth(claims: &Value) -> Option<&Value> {
    claims.get("https://api.openai.com/auth")
}

pub(crate) fn account_fields(
    auth: &Value,
) -> Result<(String, String, Option<String>, String), String> {
    let claims = auth_claims(auth)?;
    let nested = nested_auth(&claims);
    let email = claims
        .get("email")
        .and_then(Value::as_str)
        .or_else(|| {
            claims
                .get("https://api.openai.com/profile")?
                .get("email")?
                .as_str()
        })
        .unwrap_or("未知账户")
        .to_string();
    let plan = nested
        .and_then(|value| value.get("chatgpt_plan_type"))
        .and_then(Value::as_str)
        .unwrap_or("ChatGPT")
        .to_string();
    let account_id = auth
        .get("tokens")
        .and_then(|value| value.get("account_id"))
        .and_then(Value::as_str)
        .or_else(|| nested?.get("chatgpt_account_id")?.as_str())
        .map(str::to_string);
    let identity = nested
        .and_then(|value| {
            value
                .get("chatgpt_user_id")
                .or_else(|| value.get("user_id"))
        })
        .and_then(Value::as_str)
        .or_else(|| claims.get("sub").and_then(Value::as_str))
        .unwrap_or(&email);
    let mut hasher = Sha256::new();
    hasher.update(identity.as_bytes());
    hasher.update(b"\0");
    hasher.update(account_id.as_deref().unwrap_or("personal").as_bytes());
    let digest = hasher.finalize();
    let id = digest[..12]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    Ok((email, plan, account_id, id))
}

pub(crate) fn validate_auth(auth: &Value) -> Result<(), String> {
    if !auth.is_object() {
        return Err("auth.json 顶层必须是对象".to_string());
    }
    token_string(auth, "access_token")
        .ok_or_else(|| "auth.json 缺少 tokens.access_token".to_string())?;
    account_fields(auth).map(|_| ())
}

pub(crate) fn should_replace_auth_by_refresh_time(
    account_id: &str,
    local_auth: Option<&Value>,
    incoming_auth: &Value,
) -> bool {
    let Some(local_auth) = local_auth else {
        return true;
    };
    if validate_auth(local_auth).is_err() {
        return true;
    }
    match account_fields(local_auth) {
        Ok((_, _, _, local_id)) if local_id == account_id => {}
        _ => return true,
    }

    match (
        last_refresh_time(local_auth),
        last_refresh_time(incoming_auth),
    ) {
        (Some(local_refresh), Some(incoming_refresh)) if incoming_refresh != local_refresh => {
            return incoming_refresh > local_refresh;
        }
        (None, Some(_)) => return true,
        (Some(_), None) => return false,
        _ => {}
    }

    let Some(incoming_iat) = access_token_iat(incoming_auth) else {
        return false;
    };
    access_token_iat(local_auth).map_or(true, |local_iat| incoming_iat > local_iat)
}

pub(crate) fn last_refresh_time(auth: &Value) -> Option<DateTime<Utc>> {
    let value = auth.get("last_refresh")?.as_str()?;
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|value| value.with_timezone(&Utc))
}

pub(crate) fn access_token_iat(auth: &Value) -> Option<i64> {
    let claims = decode_jwt(token_string(auth, "access_token")?).ok()?;
    let iat = claims.get("iat")?;
    iat.as_i64()
        .or_else(|| iat.as_u64().and_then(|value| i64::try_from(value).ok()))
        .or_else(|| iat.as_str()?.parse().ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn jwt(payload: Value) -> String {
        format!(
            "e30.{}.sig",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&payload).unwrap())
        )
    }

    #[test]
    fn parses_account_identity_without_exposing_tokens() {
        let auth = json!({
            "tokens": {
                "id_token": jwt(json!({
                    "email": "person@example.com",
                    "sub": "user-1",
                    "https://api.openai.com/auth": {
                        "chatgpt_plan_type": "plus",
                        "chatgpt_account_id": "account-1"
                    }
                })),
                "access_token": "header.payload.signature",
                "refresh_token": "secret"
            }
        });
        let (email, plan, account_id, id) = account_fields(&auth).unwrap();
        assert_eq!(email, "person@example.com");
        assert_eq!(plan, "plus");
        assert_eq!(account_id.as_deref(), Some("account-1"));
        assert_eq!(id.len(), 24);
    }

    fn auth_with_access_token_iat(iat: i64) -> Value {
        json!({
            "tokens": {
                "access_token": jwt(json!({ "iat": iat }))
            }
        })
    }

    fn auth_with_refresh_and_iat(last_refresh: &str, iat: i64) -> Value {
        json!({
            "tokens": {
                "access_token": jwt(json!({ "iat": iat }))
            },
            "last_refresh": last_refresh,
        })
    }

    #[test]
    fn incoming_auth_replaces_local_auth_only_when_access_token_iat_is_newer() {
        let local = auth_with_access_token_iat(100);
        let incoming_newer = auth_with_access_token_iat(101);
        let incoming_older = auth_with_access_token_iat(99);
        let (_, _, _, account_id) = account_fields(&local).unwrap();

        assert!(should_replace_auth_by_refresh_time(
            &account_id,
            Some(&local),
            &incoming_newer
        ));
        assert!(!should_replace_auth_by_refresh_time(
            &account_id,
            Some(&local),
            &incoming_older
        ));
    }

    #[test]
    fn incoming_auth_uses_last_refresh_before_access_token_iat() {
        let local = auth_with_refresh_and_iat("2026-07-01T09:58:50.638606500Z", 200);
        let incoming_newer_refresh =
            auth_with_refresh_and_iat("2026-07-01T09:58:51.638606500Z", 100);
        let incoming_older_refresh =
            auth_with_refresh_and_iat("2026-07-01T09:58:49.638606500Z", 300);
        let incoming_equal_refresh =
            auth_with_refresh_and_iat("2026-07-01T09:58:50.638606500Z", 201);
        let (_, _, _, account_id) = account_fields(&local).unwrap();

        assert!(should_replace_auth_by_refresh_time(
            &account_id,
            Some(&local),
            &incoming_newer_refresh
        ));
        assert!(!should_replace_auth_by_refresh_time(
            &account_id,
            Some(&local),
            &incoming_older_refresh
        ));
        assert!(should_replace_auth_by_refresh_time(
            &account_id,
            Some(&local),
            &incoming_equal_refresh
        ));
    }

    #[test]
    fn incoming_auth_with_last_refresh_replaces_local_auth_without_last_refresh() {
        let local = auth_with_access_token_iat(200);
        let incoming = auth_with_refresh_and_iat("2026-07-01T09:58:50.638606500Z", 100);
        let (_, _, _, account_id) = account_fields(&local).unwrap();

        assert!(should_replace_auth_by_refresh_time(
            &account_id,
            Some(&local),
            &incoming
        ));
    }

    #[test]
    fn incoming_auth_replaces_missing_or_unusable_local_auth() {
        let incoming = auth_with_access_token_iat(100);
        let local_without_iat = json!({ "tokens": { "access_token": jwt(json!({})) } });
        let (_, _, _, account_id) = account_fields(&incoming).unwrap();

        assert!(should_replace_auth_by_refresh_time(
            &account_id,
            None,
            &incoming
        ));
        assert!(should_replace_auth_by_refresh_time(
            &account_id,
            Some(&json!({ "tokens": { "access_token": "" } })),
            &incoming
        ));
        assert!(should_replace_auth_by_refresh_time(
            &account_id,
            Some(&local_without_iat),
            &incoming
        ));
    }
}
