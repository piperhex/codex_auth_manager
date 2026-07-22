use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
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

fn is_agent_identity_auth(auth: &Value) -> bool {
    auth.get("auth_mode")
        .and_then(Value::as_str)
        .is_some_and(|value| value.eq_ignore_ascii_case("agentIdentity"))
        || auth.get("agent_identity").is_some_and(Value::is_object)
}

fn agent_identity(auth: &Value) -> Result<&Value, String> {
    auth.get("agent_identity")
        .filter(|value| value.is_object())
        .ok_or_else(|| "auth.json 缺少 agent_identity 对象".to_string())
}

fn required_agent_identity_string<'a>(identity: &'a Value, key: &str) -> Result<&'a str, String> {
    identity
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| format!("auth.json 缺少 agent_identity.{key}"))
}

fn agent_identity_account_fields(
    auth: &Value,
) -> Result<(String, String, Option<String>, String), String> {
    let identity = agent_identity(auth)?;
    required_agent_identity_string(identity, "agent_runtime_id")?;
    required_agent_identity_string(identity, "agent_private_key")?;
    let account_id = identity
        .get("account_id")
        .or_else(|| identity.get("chatgpt_account_id"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "auth.json 缺少 agent_identity.account_id".to_string())?
        .to_string();
    let user_id = required_agent_identity_string(identity, "chatgpt_user_id")?;
    let email = identity
        .get("email")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("未知账户")
        .to_string();
    let plan = identity
        .get("plan_type")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("ChatGPT")
        .to_string();
    let mut hasher = Sha256::new();
    hasher.update(user_id.as_bytes());
    hasher.update(b"\0");
    hasher.update(account_id.as_bytes());
    let digest = hasher.finalize();
    let id = digest[..12]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    Ok((email, plan, Some(account_id), id))
}

pub(crate) fn account_fields(
    auth: &Value,
) -> Result<(String, String, Option<String>, String), String> {
    if is_agent_identity_auth(auth) {
        return agent_identity_account_fields(auth);
    }
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
    if is_agent_identity_auth(auth) {
        let identity = agent_identity(auth)?;
        let private_key = required_agent_identity_string(identity, "agent_private_key")?;
        let decoded = STANDARD.decode(private_key).map_err(|_| {
            "auth.json 中的 agent_identity.agent_private_key 不是有效 Base64".to_string()
        })?;
        if decoded.len() < 32 {
            return Err("auth.json 中的 agent_identity.agent_private_key 格式无效".to_string());
        }
        return agent_identity_account_fields(auth).map(|_| ());
    }
    token_string(auth, "access_token")
        .ok_or_else(|| "auth.json 缺少 tokens.access_token".to_string())?;
    account_fields(auth).map(|_| ())
}

/// Bring a managed ChatGPT credential up to the shape expected by current Codex builds.
/// Unknown fields are deliberately preserved so newer Codex metadata can round-trip through
/// Codex Switch without being discarded.
pub(crate) fn canonicalize_chatgpt_auth(auth: &mut Value) -> Result<bool, String> {
    if is_agent_identity_auth(auth) {
        let original = auth.clone();
        let auth_object = auth
            .as_object_mut()
            .ok_or_else(|| "auth.json 顶层必须是对象".to_string())?;
        auth_object.insert(
            "auth_mode".to_string(),
            Value::String("agentIdentity".to_string()),
        );
        return Ok(*auth != original);
    }
    let original = auth.clone();
    let access_token = token_string(auth, "access_token").map(str::to_string);
    let valid_id_token = token_string(auth, "id_token")
        .filter(|token| decode_jwt(token).is_ok())
        .map(str::to_string);

    let auth_object = auth
        .as_object_mut()
        .ok_or_else(|| "auth.json 顶层必须是对象".to_string())?;
    let tokens = auth_object
        .get_mut("tokens")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "auth.json 缺少 tokens 对象".to_string())?;

    if valid_id_token.is_none() {
        if let Some(access_token) = access_token.filter(|token| decode_jwt(token).is_ok()) {
            // Compatible account exports sometimes contain only an access JWT. Codex requires
            // an id_token field to deserialize TokenData, and accepts the same claim layout.
            tokens.insert("id_token".to_string(), Value::String(access_token));
        }
    }
    if !tokens
        .get("refresh_token")
        .is_some_and(|value| value.is_string())
    {
        // TokenData structurally requires this field. An empty value keeps access-only imports
        // usable until expiry while still making refresh failure explicit when it is attempted.
        tokens.insert("refresh_token".to_string(), Value::String(String::new()));
    }

    auth_object.insert(
        "auth_mode".to_string(),
        Value::String("chatgpt".to_string()),
    );
    auth_object.insert("OPENAI_API_KEY".to_string(), Value::Null);
    let last_refresh_is_valid = auth_object
        .get("last_refresh")
        .and_then(Value::as_str)
        .is_some_and(|value| DateTime::parse_from_rfc3339(value).is_ok());
    if !last_refresh_is_valid {
        auth_object.insert(
            "last_refresh".to_string(),
            Value::String(Utc::now().to_rfc3339()),
        );
    }

    Ok(*auth != original)
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

    #[test]
    fn canonicalizes_chatgpt_auth_without_discarding_newer_fields() {
        let access_token = jwt(json!({
            "email": "person@example.com",
            "sub": "user-1"
        }));
        let mut auth = json!({
            "tokens": { "access_token": access_token },
            "newer_codex_field": { "keep": true }
        });

        assert!(canonicalize_chatgpt_auth(&mut auth).unwrap());
        assert_eq!(auth["auth_mode"], "chatgpt");
        assert!(auth["OPENAI_API_KEY"].is_null());
        assert_eq!(auth["tokens"]["id_token"], auth["tokens"]["access_token"]);
        assert_eq!(auth["tokens"]["refresh_token"], "");
        assert!(DateTime::parse_from_rfc3339(auth["last_refresh"].as_str().unwrap()).is_ok());
        assert_eq!(auth["newer_codex_field"]["keep"], true);
        validate_auth(&auth).unwrap();
    }

    #[test]
    fn canonicalization_preserves_a_valid_last_refresh() {
        let timestamp = "2026-07-01T02:03:04.123456Z";
        let token = jwt(json!({ "email": "person@example.com", "sub": "user-1" }));
        let mut auth = json!({
            "auth_mode": "chatgpt",
            "OPENAI_API_KEY": null,
            "tokens": {
                "id_token": token,
                "access_token": token,
                "refresh_token": "refresh"
            },
            "last_refresh": timestamp
        });

        assert!(!canonicalize_chatgpt_auth(&mut auth).unwrap());
        assert_eq!(auth["last_refresh"], timestamp);
    }

    #[test]
    fn validates_and_identifies_agent_identity_auth() {
        let mut auth = json!({
            "auth_mode": "agentidentity",
            "agent_identity": {
                "agent_runtime_id": "agent-runtime",
                "agent_private_key": STANDARD.encode([7_u8; 48]),
                "account_id": "workspace-1",
                "chatgpt_user_id": "user-1",
                "email": "agent@example.com",
                "plan_type": "business"
            }
        });

        assert!(canonicalize_chatgpt_auth(&mut auth).unwrap());
        assert_eq!(auth["auth_mode"], "agentIdentity");
        validate_auth(&auth).unwrap();
        let (email, plan, account_id, id) = account_fields(&auth).unwrap();
        assert_eq!(email, "agent@example.com");
        assert_eq!(plan, "business");
        assert_eq!(account_id.as_deref(), Some("workspace-1"));
        assert_eq!(id.len(), 24);
    }
}
