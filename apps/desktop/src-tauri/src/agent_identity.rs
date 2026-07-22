use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use chrono::{SecondsFormat, Utc};
use crypto_box::SecretKey;
use ed25519_dalek::{pkcs8::DecodePrivateKey, Signer, SigningKey};
use reqwest::{
    blocking::{Client, Response},
    StatusCode,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha512};

const AUTH_API_BASE_URL: &str = "https://auth.openai.com/api/accounts";
const USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";

#[derive(Serialize)]
struct AgentAssertionEnvelope<'a> {
    agent_runtime_id: &'a str,
    task_id: &'a str,
    timestamp: &'a str,
    signature: String,
}

#[derive(Deserialize)]
struct TaskRegistrationResponse {
    #[serde(default)]
    task_id: String,
    #[serde(default, rename = "taskId")]
    task_id_camel: String,
    #[serde(default)]
    encrypted_task_id: String,
    #[serde(default, rename = "encryptedTaskId")]
    encrypted_task_id_camel: String,
}

fn identity(auth: &Value) -> Result<&Value, String> {
    auth.get("agent_identity")
        .filter(|value| value.is_object())
        .ok_or_else(|| "auth.json 缺少 agent_identity 对象".to_string())
}

fn identity_mut(auth: &mut Value) -> Result<&mut serde_json::Map<String, Value>, String> {
    auth.get_mut("agent_identity")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "auth.json 缺少 agent_identity 对象".to_string())
}

fn required_string<'a>(identity: &'a Value, key: &str) -> Result<&'a str, String> {
    identity
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("auth.json 缺少 agent_identity.{key}"))
}

fn signing_key(identity: &Value) -> Result<SigningKey, String> {
    let encoded = required_string(identity, "agent_private_key")?;
    let der = STANDARD
        .decode(encoded)
        .map_err(|_| "agent_identity.agent_private_key 不是有效 Base64".to_string())?;
    SigningKey::from_pkcs8_der(&der)
        .map_err(|_| "agent_identity.agent_private_key 不是有效的 Ed25519 PKCS#8 私钥".to_string())
}

fn utc_timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn build_assertion(identity: &Value, timestamp: &str) -> Result<String, String> {
    let runtime_id = required_string(identity, "agent_runtime_id")?;
    let task_id = required_string(identity, "task_id")?;
    let key = signing_key(identity)?;
    let payload = format!("{runtime_id}:{task_id}:{timestamp}");
    let signature = key.sign(payload.as_bytes());
    let envelope = AgentAssertionEnvelope {
        agent_runtime_id: runtime_id,
        task_id,
        timestamp,
        signature: STANDARD.encode(signature.to_bytes()),
    };
    let encoded = serde_json::to_vec(&envelope)
        .map_err(|error| format!("生成 Agent Identity 认证信息失败：{error}"))?;
    Ok(format!(
        "AgentAssertion {}",
        URL_SAFE_NO_PAD.encode(encoded)
    ))
}

fn decrypt_task_id(identity: &Value, encoded: &str) -> Result<String, String> {
    let ciphertext = STANDARD
        .decode(encoded.trim())
        .map_err(|_| "加密 task_id 不是有效 Base64".to_string())?;
    let key = signing_key(identity)?;
    let digest = Sha512::digest(key.to_bytes());
    let mut curve_private = [0_u8; 32];
    curve_private.copy_from_slice(&digest[..32]);
    curve_private[0] &= 248;
    curve_private[31] &= 127;
    curve_private[31] |= 64;
    let plaintext = SecretKey::from(curve_private)
        .unseal(&ciphertext)
        .map_err(|_| "解密 Agent Identity task_id 失败".to_string())?;
    let task_id = String::from_utf8(plaintext)
        .map_err(|_| "解密后的 Agent Identity task_id 不是有效文本".to_string())?;
    let task_id = task_id.trim();
    if task_id.is_empty() {
        return Err("解密后的 Agent Identity task_id 为空".to_string());
    }
    Ok(task_id.to_string())
}

fn task_registration_url(runtime_id: &str) -> Result<String, String> {
    let mut url = url::Url::parse(AUTH_API_BASE_URL)
        .map_err(|error| format!("Agent Identity 注册地址无效：{error}"))?;
    url.path_segments_mut()
        .map_err(|_| "Agent Identity 注册地址无效".to_string())?
        .extend(["v1", "agent", runtime_id, "task", "register"]);
    Ok(url.to_string())
}

pub(crate) fn register_task(client: &Client, auth: &mut Value) -> Result<(), String> {
    let identity_value = identity(auth)?;
    let runtime_id = required_string(identity_value, "agent_runtime_id")?.to_string();
    let key = signing_key(identity_value)?;
    let timestamp = utc_timestamp();
    let payload = format!("{runtime_id}:{timestamp}");
    let signature = STANDARD.encode(key.sign(payload.as_bytes()).to_bytes());
    let response = client
        .post(task_registration_url(&runtime_id)?)
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "timestamp": timestamp,
            "signature": signature,
        }))
        .send()
        .map_err(|error| format!("注册 Agent Identity task 失败：{error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "注册 Agent Identity task 失败（HTTP {}）",
            response.status()
        ));
    }
    let payload: TaskRegistrationResponse = response
        .json()
        .map_err(|error| format!("解析 Agent Identity task 注册响应失败：{error}"))?;
    let plaintext_task_id = [&payload.task_id, &payload.task_id_camel]
        .into_iter()
        .find(|value| !value.trim().is_empty());
    let encrypted_task_id = [&payload.encrypted_task_id, &payload.encrypted_task_id_camel]
        .into_iter()
        .find(|value| !value.trim().is_empty());
    let task_id = if let Some(task_id) = plaintext_task_id {
        task_id.trim().to_string()
    } else if let Some(encrypted_task_id) = encrypted_task_id {
        decrypt_task_id(identity(auth)?, encrypted_task_id)?
    } else {
        return Err("Agent Identity task 注册响应缺少 task_id".to_string());
    };
    identity_mut(auth)?.insert("task_id".to_string(), Value::String(task_id));
    Ok(())
}

pub(crate) fn ensure_task(client: &Client, auth: &mut Value) -> Result<bool, String> {
    let has_task = identity(auth)?
        .get("task_id")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty());
    if has_task {
        return Ok(false);
    }
    register_task(client, auth)?;
    Ok(true)
}

pub(crate) fn usage_request(client: &Client, auth: &Value) -> Result<Response, String> {
    let identity = identity(auth)?;
    let assertion = build_assertion(identity, &utc_timestamp())?;
    let account_id = identity
        .get("account_id")
        .or_else(|| identity.get("chatgpt_account_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "auth.json 缺少 agent_identity.account_id".to_string())?;
    let mut request = client
        .get(USAGE_URL)
        .header("Authorization", assertion)
        .header("ChatGPT-Account-Id", account_id)
        .header("openai-beta", "codex-1")
        .header("oai-language", "zh-CN")
        .header("originator", "Codex Desktop")
        .header("Accept", "application/json")
        .header("sec-fetch-site", "none")
        .header("sec-fetch-mode", "no-cors")
        .header("sec-fetch-dest", "empty")
        .header("priority", "u=4, i")
        .header("User-Agent", "codex_cli_rs/0.1.0");
    if identity
        .get("chatgpt_account_is_fedramp")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        request = request.header("x-openai-fedramp", "true");
    }
    request
        .send()
        .map_err(|error| format!("读取 Agent Identity Codex 用量失败：{error}"))
}

pub(crate) fn is_invalid_task_response(status: StatusCode, body: &str) -> bool {
    if status != StatusCode::UNAUTHORIZED {
        return false;
    }
    let lower = body.to_ascii_lowercase();
    let compact = lower
        .chars()
        .filter(|character| !character.is_ascii_whitespace())
        .collect::<String>();
    [
        "\"code\":\"invalid_task_id\"",
        "\"code\":\"task_not_found\"",
        "\"code\":\"task_expired\"",
        "\"error\":\"invalid_task_id\"",
    ]
    .iter()
    .any(|marker| compact.contains(marker))
        || [
            "invalid task_id",
            "invalid task id",
            "task_id is invalid",
            "task id is invalid",
            "task not found",
            "task expired",
            "unknown task_id",
            "unknown task id",
        ]
        .iter()
        .any(|marker| lower.contains(marker))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crypto_box::aead::OsRng;
    use ed25519_dalek::{pkcs8::EncodePrivateKey, Verifier};
    use serde_json::json;

    fn test_identity() -> Value {
        let key = SigningKey::from_bytes(&[7_u8; 32]);
        let der = key.to_pkcs8_der().unwrap();
        json!({
            "agent_runtime_id": "runtime-test",
            "agent_private_key": STANDARD.encode(der.as_bytes()),
            "task_id": "task-test",
            "account_id": "account-test"
        })
    }

    #[test]
    fn assertion_contains_a_verifiable_signature() {
        let identity = test_identity();
        let assertion = build_assertion(&identity, "2026-07-14T00:09:10Z").unwrap();
        let encoded = assertion.strip_prefix("AgentAssertion ").unwrap();
        let envelope: Value =
            serde_json::from_slice(&URL_SAFE_NO_PAD.decode(encoded).unwrap()).unwrap();
        assert_eq!(envelope["agent_runtime_id"], "runtime-test");
        assert_eq!(envelope["task_id"], "task-test");
        let signature = ed25519_dalek::Signature::from_slice(
            &STANDARD
                .decode(envelope["signature"].as_str().unwrap())
                .unwrap(),
        )
        .unwrap();
        let key = signing_key(&identity).unwrap();
        key.verifying_key()
            .verify(b"runtime-test:task-test:2026-07-14T00:09:10Z", &signature)
            .unwrap();
    }

    #[test]
    fn decrypts_a_sealed_task_id() {
        let identity = test_identity();
        let key = signing_key(&identity).unwrap();
        let digest = Sha512::digest(key.to_bytes());
        let mut curve_private = [0_u8; 32];
        curve_private.copy_from_slice(&digest[..32]);
        curve_private[0] &= 248;
        curve_private[31] &= 127;
        curve_private[31] |= 64;
        let secret = SecretKey::from(curve_private);
        let ciphertext = secret
            .public_key()
            .seal(&mut OsRng, b"task-sealed")
            .unwrap();
        assert_eq!(
            decrypt_task_id(&identity, &STANDARD.encode(ciphertext)).unwrap(),
            "task-sealed"
        );
    }

    #[test]
    fn recognizes_only_invalid_task_unauthorized_responses() {
        assert!(is_invalid_task_response(
            StatusCode::UNAUTHORIZED,
            r#"{"error":{"code":"invalid_task_id"}}"#
        ));
        assert!(!is_invalid_task_response(
            StatusCode::UNAUTHORIZED,
            r#"{"error":"invalid token"}"#
        ));
        assert!(!is_invalid_task_response(
            StatusCode::FORBIDDEN,
            r#"{"error":{"code":"invalid_task_id"}}"#
        ));
    }

    #[test]
    fn builds_the_expected_registration_url() {
        assert_eq!(
            task_registration_url("runtime/test").unwrap(),
            "https://auth.openai.com/api/accounts/v1/agent/runtime%2Ftest/task/register"
        );
    }

    #[test]
    fn accepts_camel_case_registration_fields() {
        let response: TaskRegistrationResponse = serde_json::from_value(json!({
            "taskId": "task-camel",
            "encryptedTaskId": "encrypted-camel"
        }))
        .unwrap();
        assert_eq!(response.task_id_camel, "task-camel");
        assert_eq!(response.encrypted_task_id_camel, "encrypted-camel");
    }
}
