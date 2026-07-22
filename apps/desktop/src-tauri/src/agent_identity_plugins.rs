use std::{fs, path::PathBuf};

use crate::storage::{write_text_atomic, Paths};

const CONFIG_BACKUP_FILENAME: &str = "config-before-agent-identity-plugins.toml";

/// Agent Identity credentials can use Codex normally, but they are not
/// authorized for the Desktop plugin catalog. Keep the catalog disabled while
/// one is active so the client does not repeatedly refresh unauthorized
/// plugins.
pub(crate) fn sync_plugin_feature_for_auth(
    paths: &Paths,
    is_agent_identity: bool,
) -> Result<(), String> {
    let backup_path = config_backup_path(paths)?;
    if is_agent_identity {
        if !backup_path.exists() {
            let original = read_config_or_empty(paths)?;
            write_text_atomic(&backup_path, &original)?;
        }

        let current = read_config_or_empty(paths)?;
        let disabled = disable_plugins_feature(&current);
        if disabled != current {
            write_text_atomic(&paths.current_config, &disabled)?;
        }
        return Ok(());
    }

    restore_config_if_backed_up(paths, &backup_path)
}

fn config_backup_path(paths: &Paths) -> Result<PathBuf, String> {
    let parent = paths
        .state_file
        .parent()
        .ok_or_else(|| "Codex Switch state path has no parent directory".to_string())?;
    Ok(parent.join(CONFIG_BACKUP_FILENAME))
}

fn read_config_or_empty(paths: &Paths) -> Result<String, String> {
    if !paths.current_config.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&paths.current_config)
        .map_err(|error| format!("Failed to read Codex config: {error}"))
}

fn restore_config_if_backed_up(paths: &Paths, backup_path: &PathBuf) -> Result<(), String> {
    if !backup_path.exists() {
        return Ok(());
    }

    let backup = fs::read_to_string(backup_path)
        .map_err(|error| format!("Failed to read Agent Identity config backup: {error}"))?;
    if backup.is_empty() {
        if paths.current_config.exists() {
            fs::remove_file(&paths.current_config)
                .map_err(|error| format!("Failed to remove managed Codex config: {error}"))?;
        }
    } else {
        write_text_atomic(&paths.current_config, &backup)?;
    }
    fs::remove_file(backup_path)
        .map_err(|error| format!("Failed to clear Agent Identity config backup: {error}"))
}

fn disable_plugins_feature(config: &str) -> String {
    let had_trailing_newline = config.ends_with('\n');
    let mut output = Vec::new();
    let mut in_features_table = false;
    let mut found_features_table = false;
    let mut found_plugins = false;

    for line in config.lines() {
        let trimmed = line.trim();
        if is_table_header(trimmed) {
            if in_features_table && !found_plugins {
                output.push("plugins = false".to_string());
                found_plugins = true;
            }
            in_features_table = trimmed == "[features]";
            found_features_table |= in_features_table;
            output.push(line.to_string());
            continue;
        }

        if in_features_table && is_plugins_assignment(trimmed) {
            let indent = line.len() - line.trim_start().len();
            output.push(format!("{}plugins = false", &line[..indent]));
            found_plugins = true;
        } else if !found_features_table && is_dotted_plugins_assignment(trimmed) {
            let indent = line.len() - line.trim_start().len();
            output.push(format!("{}features.plugins = false", &line[..indent]));
            found_plugins = true;
        } else {
            output.push(line.to_string());
        }
    }

    if in_features_table && !found_plugins {
        output.push("plugins = false".to_string());
        found_plugins = true;
    }
    if !found_features_table && !found_plugins {
        if !output.is_empty() && !output.last().is_some_and(|line| line.trim().is_empty()) {
            output.push(String::new());
        }
        output.push("[features]".to_string());
        output.push("plugins = false".to_string());
    }

    let mut result = output.join("\n");
    if had_trailing_newline {
        result.push('\n');
    }
    result
}

fn is_table_header(value: &str) -> bool {
    value.starts_with('[') && value.ends_with(']')
}

fn is_plugins_assignment(value: &str) -> bool {
    value
        .split_once('=')
        .is_some_and(|(key, _)| key.trim() == "plugins")
}

fn is_dotted_plugins_assignment(value: &str) -> bool {
    value
        .split_once('=')
        .is_some_and(|(key, _)| key.trim() == "features.plugins")
}

#[cfg(test)]
mod tests {
    use super::{config_backup_path, disable_plugins_feature, sync_plugin_feature_for_auth};
    use crate::storage::Paths;
    use std::{fs, path::PathBuf};

    fn test_paths() -> Paths {
        let root = std::env::temp_dir().join(format!(
            "codex-switch-agent-identity-plugin-test-{}",
            uuid::Uuid::new_v4()
        ));
        let codex_home = root.join("codex-home");
        let app_data = root.join("app-data");
        Paths {
            current_auth: codex_home.join("auth.json"),
            current_config: codex_home.join("config.toml"),
            codex_home,
            accounts: app_data.join("accounts"),
            providers: app_data.join("providers"),
            config_backup: app_data.join("config-before-provider.toml"),
            state_file: app_data.join("state.json"),
        }
    }

    #[test]
    fn disables_the_global_plugins_feature_without_removing_other_features() {
        let config = "model = \"gpt-5\"\n\n[features]\napps = true\nplugins = true\n";
        let result = disable_plugins_feature(config);

        assert!(result.contains("apps = true"));
        assert!(result.contains("plugins = false"));
        assert!(!result.contains("plugins = true"));
    }

    #[test]
    fn adds_the_features_table_when_the_config_has_no_plugin_setting() {
        let result = disable_plugins_feature("model = \"gpt-5\"\n");

        assert!(result.contains("[features]\nplugins = false"));
    }

    #[test]
    fn restores_the_exact_config_when_leaving_agent_identity() {
        let paths = test_paths();
        fs::create_dir_all(&paths.codex_home).unwrap();
        let original = "model = \"gpt-5\"\n\n[features]\nplugins = true\n";
        fs::write(&paths.current_config, original).unwrap();

        sync_plugin_feature_for_auth(&paths, true).unwrap();
        assert!(fs::read_to_string(&paths.current_config)
            .unwrap()
            .contains("plugins = false"));
        assert!(config_backup_path(&paths).unwrap().exists());

        sync_plugin_feature_for_auth(&paths, false).unwrap();
        assert_eq!(fs::read_to_string(&paths.current_config).unwrap(), original);
        assert!(!config_backup_path(&paths).unwrap().exists());

        fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
    }

    #[test]
    fn restores_a_missing_config_by_removing_the_managed_file() {
        let paths = test_paths();

        sync_plugin_feature_for_auth(&paths, true).unwrap();
        assert!(paths.current_config.exists());

        sync_plugin_feature_for_auth(&paths, false).unwrap();
        assert!(!paths.current_config.exists());

        fs::remove_dir_all(paths.codex_home.parent().unwrap()).unwrap();
    }

    #[allow(dead_code)]
    fn _path_type_check(_: PathBuf) {}
}
