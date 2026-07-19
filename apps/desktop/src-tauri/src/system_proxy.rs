use reqwest::{blocking::ClientBuilder, Proxy, Url};

#[derive(Clone, Debug, Default, PartialEq)]
struct SystemProxyConfig {
    default_proxy: Option<Url>,
    http_proxy: Option<Url>,
    https_proxy: Option<Url>,
    bypass: Vec<String>,
}

impl SystemProxyConfig {
    fn proxy_for(&self, target: &Url) -> Option<Url> {
        if environment_proxy_configured(target.scheme()) {
            return None;
        }

        self.configured_proxy_for(target)
    }

    fn configured_proxy_for(&self, target: &Url) -> Option<Url> {
        if self.should_bypass(target) {
            return None;
        }

        match target.scheme() {
            "http" => self
                .http_proxy
                .as_ref()
                .or(self.default_proxy.as_ref())
                .cloned(),
            "https" => self
                .https_proxy
                .as_ref()
                .or(self.default_proxy.as_ref())
                .cloned(),
            _ => None,
        }
    }

    fn should_bypass(&self, target: &Url) -> bool {
        let Some(host) = target.host_str() else {
            return true;
        };
        let host = host.trim_matches(['[', ']']).to_ascii_lowercase();
        if host == "localhost"
            || host
                .parse::<std::net::IpAddr>()
                .is_ok_and(|address| address.is_loopback())
        {
            return true;
        }

        self.bypass
            .iter()
            .any(|rule| bypass_rule_matches(rule, &host, target.port_or_known_default()))
    }
}

pub(crate) fn apply(builder: ClientBuilder) -> ClientBuilder {
    let Some(config) = current_system_proxy() else {
        return builder;
    };
    builder.proxy(Proxy::custom(move |target| config.proxy_for(target)))
}

fn parse_windows_proxy(
    proxy_server: &str,
    proxy_bypass: Option<&str>,
) -> Option<SystemProxyConfig> {
    let mut config = SystemProxyConfig {
        bypass: proxy_bypass
            .unwrap_or_default()
            .split(';')
            .map(str::trim)
            .filter(|entry| !entry.is_empty())
            .map(str::to_string)
            .collect(),
        ..SystemProxyConfig::default()
    };

    for entry in proxy_server.split(';').map(str::trim) {
        if entry.is_empty() {
            continue;
        }
        let Some((kind, endpoint)) = entry.split_once('=') else {
            if config.default_proxy.is_none() {
                config.default_proxy = parse_proxy_endpoint(entry);
            }
            continue;
        };
        match kind.trim().to_ascii_lowercase().as_str() {
            "http" => config.http_proxy = parse_proxy_endpoint(endpoint),
            "https" => config.https_proxy = parse_proxy_endpoint(endpoint),
            _ => {}
        }
    }

    (config.default_proxy.is_some() || config.http_proxy.is_some() || config.https_proxy.is_some())
        .then_some(config)
}

fn parse_proxy_endpoint(endpoint: &str) -> Option<Url> {
    let endpoint = endpoint.trim().trim_matches('"');
    if endpoint.is_empty() {
        return None;
    }
    let value = if endpoint.contains("://") {
        endpoint.to_string()
    } else {
        format!("http://{endpoint}")
    };
    Url::parse(&value)
        .ok()
        .filter(|url| matches!(url.scheme(), "http" | "https") && url.host_str().is_some())
}

fn environment_proxy_configured(scheme: &str) -> bool {
    let scheme_variables: &[&str] = match scheme {
        "http" => &["HTTP_PROXY", "http_proxy"],
        "https" => &["HTTPS_PROXY", "https_proxy"],
        _ => &[],
    };
    scheme_variables
        .iter()
        .chain(["ALL_PROXY", "all_proxy"].iter())
        .any(|name| std::env::var_os(name).is_some_and(|value| !value.is_empty()))
}

fn bypass_rule_matches(rule: &str, host: &str, port: Option<u16>) -> bool {
    let rule = rule.trim().to_ascii_lowercase();
    if rule.is_empty() {
        return false;
    }
    if rule == "<local>" {
        return !host.contains('.');
    }
    if rule.starts_with("<-") && rule.ends_with('>') {
        return false;
    }

    let rule = rule
        .strip_prefix("http://")
        .or_else(|| rule.strip_prefix("https://"))
        .unwrap_or(&rule)
        .trim_end_matches('/');
    let (rule_host, rule_port) = split_bypass_host_port(rule);
    if rule_port.is_some() && rule_port != port {
        return false;
    }
    if let Some(suffix) = rule_host.strip_prefix('.') {
        return host == suffix || host.ends_with(&format!(".{suffix}"));
    }
    wildcard_matches(rule_host, host)
}

fn split_bypass_host_port(rule: &str) -> (&str, Option<u16>) {
    if let Some(rest) = rule.strip_prefix('[') {
        if let Some(closing) = rest.find(']') {
            let host = &rest[..closing];
            let port = rest[closing + 1..]
                .strip_prefix(':')
                .and_then(|value| value.parse().ok());
            return (host, port);
        }
    }
    if rule.matches(':').count() == 1 {
        if let Some((host, port)) = rule.rsplit_once(':') {
            if let Ok(port) = port.parse() {
                return (host, Some(port));
            }
        }
    }
    (rule.trim_matches(['[', ']']), None)
}

fn wildcard_matches(pattern: &str, value: &str) -> bool {
    let (pattern, value) = (pattern.as_bytes(), value.as_bytes());
    let (mut pattern_index, mut value_index) = (0, 0);
    let (mut star_index, mut star_value_index) = (None, 0);

    while value_index < value.len() {
        if pattern_index < pattern.len() && pattern[pattern_index] == value[value_index] {
            pattern_index += 1;
            value_index += 1;
        } else if pattern_index < pattern.len() && pattern[pattern_index] == b'*' {
            star_index = Some(pattern_index);
            pattern_index += 1;
            star_value_index = value_index;
        } else if let Some(star) = star_index {
            pattern_index = star + 1;
            star_value_index += 1;
            value_index = star_value_index;
        } else {
            return false;
        }
    }
    while pattern_index < pattern.len() && pattern[pattern_index] == b'*' {
        pattern_index += 1;
    }
    pattern_index == pattern.len()
}

#[cfg(target_os = "windows")]
fn current_system_proxy() -> Option<SystemProxyConfig> {
    use windows_sys::Win32::{
        Foundation::GlobalFree,
        Networking::WinHttp::{
            WinHttpGetIEProxyConfigForCurrentUser, WINHTTP_CURRENT_USER_IE_PROXY_CONFIG,
        },
    };

    let mut raw = WINHTTP_CURRENT_USER_IE_PROXY_CONFIG::default();
    if unsafe { WinHttpGetIEProxyConfigForCurrentUser(&mut raw) } == 0 {
        return None;
    }

    let proxy_server = wide_string(raw.lpszProxy);
    let proxy_bypass = wide_string(raw.lpszProxyBypass);
    unsafe {
        if !raw.lpszAutoConfigUrl.is_null() {
            GlobalFree(raw.lpszAutoConfigUrl.cast());
        }
        if !raw.lpszProxy.is_null() {
            GlobalFree(raw.lpszProxy.cast());
        }
        if !raw.lpszProxyBypass.is_null() {
            GlobalFree(raw.lpszProxyBypass.cast());
        }
    }

    parse_windows_proxy(proxy_server.as_deref()?, proxy_bypass.as_deref())
}

#[cfg(target_os = "windows")]
fn wide_string(value: *const u16) -> Option<String> {
    if value.is_null() {
        return None;
    }
    let mut length = 0;
    unsafe {
        while *value.add(length) != 0 {
            length += 1;
        }
        Some(String::from_utf16_lossy(std::slice::from_raw_parts(
            value, length,
        )))
    }
}

#[cfg(not(target_os = "windows"))]
fn current_system_proxy() -> Option<SystemProxyConfig> {
    None
}

#[cfg(test)]
mod tests {
    use reqwest::Url;

    use super::{bypass_rule_matches, parse_windows_proxy, wildcard_matches};

    #[test]
    fn parses_clash_style_single_proxy_for_http_and_https() {
        let config = parse_windows_proxy("127.0.0.1:7897", Some("<local>;localhost;127.*"))
            .expect("proxy should parse");

        assert_eq!(
            config.default_proxy.as_ref().map(|url| url.as_str()),
            Some("http://127.0.0.1:7897/")
        );
        assert_eq!(config.bypass, ["<local>", "localhost", "127.*"]);
        assert_eq!(
            config
                .configured_proxy_for(&Url::parse("https://auth.openai.com/oauth").unwrap())
                .as_ref()
                .map(Url::as_str),
            Some("http://127.0.0.1:7897/")
        );
        assert!(config
            .configured_proxy_for(&Url::parse("http://localhost:1455/auth/callback").unwrap())
            .is_none());
    }

    #[test]
    fn parses_protocol_specific_windows_proxy_list() {
        let config = parse_windows_proxy(
            "http=127.0.0.1:7890;https=127.0.0.1:7891;socks=127.0.0.1:7892",
            None,
        )
        .expect("proxy should parse");

        assert_eq!(
            config.http_proxy.as_ref().map(|url| url.as_str()),
            Some("http://127.0.0.1:7890/")
        );
        assert_eq!(
            config.https_proxy.as_ref().map(|url| url.as_str()),
            Some("http://127.0.0.1:7891/")
        );
        assert!(config.default_proxy.is_none());
    }

    #[test]
    fn matches_windows_proxy_bypass_rules() {
        assert!(bypass_rule_matches("<local>", "intranet", Some(80)));
        assert!(!bypass_rule_matches("<local>", "example.com", Some(80)));
        assert!(bypass_rule_matches(
            "*.example.com",
            "api.example.com",
            Some(443)
        ));
        assert!(bypass_rule_matches("10.*", "10.2.3.4", Some(80)));
        assert!(bypass_rule_matches(
            "localhost:3000",
            "localhost",
            Some(3000)
        ));
        assert!(!bypass_rule_matches(
            "localhost:3000",
            "localhost",
            Some(3001)
        ));
        assert!(wildcard_matches("*", "anything.example"));
    }
}
