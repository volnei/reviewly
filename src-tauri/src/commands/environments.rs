use std::collections::HashMap;
use std::path::Path;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tokio::process::Command;

use crate::creds;
use crate::error::{AppError, AppResult};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentValue {
    pub key: String,
    pub value: String,
    pub secret: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandRunResult {
    pub success: bool,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
}

fn valid_key(key: &str) -> bool {
    let mut characters = key.chars();
    matches!(
        characters.next(),
        Some('_') | Some('A'..='Z') | Some('a'..='z')
    ) && characters.all(|character| character == '_' || character.is_ascii_alphanumeric())
}

#[tauri::command]
pub fn environment_values_save(
    environment_id: String,
    values: Vec<EnvironmentValue>,
) -> AppResult<()> {
    for value in values {
        if !valid_key(&value.key) {
            return Err(AppError::Other(format!(
                "Invalid environment key: {}",
                value.key
            )));
        }
        if value.secret {
            creds::save_environment_value(&environment_id, &value.key, &value.value)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn environment_value_delete(environment_id: String, key: String) -> AppResult<()> {
    creds::delete_environment_value(&environment_id, &key)
}

pub async fn run_command(
    cwd: &str,
    command: &str,
    variables: HashMap<String, String>,
    timeout_seconds: u64,
) -> AppResult<CommandRunResult> {
    let path = Path::new(cwd);
    if !path.is_dir() {
        return Err(AppError::Other(
            "The command directory does not exist".into(),
        ));
    }

    #[cfg(target_os = "windows")]
    let mut child = {
        let mut command_process = Command::new("cmd");
        command_process.args(["/C", command]);
        command_process
    };
    #[cfg(not(target_os = "windows"))]
    let mut child = {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
        let mut command_process = Command::new(shell);
        command_process.args(["-lc", command]);
        command_process
    };

    child.current_dir(path).envs(variables).kill_on_drop(true);
    let started = Instant::now();
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(timeout_seconds.clamp(1, 3_600)),
        child.output(),
    )
    .await
    .map_err(|_| AppError::Other("Command timed out".into()))??;

    const MAX_OUTPUT: usize = 200_000;
    let trim = |bytes: Vec<u8>| {
        let text = String::from_utf8_lossy(&bytes).to_string();
        if text.len() <= MAX_OUTPUT {
            text
        } else {
            format!("{}\n… output truncated", &text[..MAX_OUTPUT])
        }
    };
    Ok(CommandRunResult {
        success: output.status.success(),
        exit_code: output.status.code(),
        stdout: trim(output.stdout),
        stderr: trim(output.stderr),
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

#[tauri::command]
pub async fn environment_command_run(
    environment_id: String,
    cwd: String,
    command: String,
    values: Vec<EnvironmentValue>,
    timeout_seconds: u64,
) -> AppResult<CommandRunResult> {
    let mut variables = HashMap::new();
    for value in values {
        if !valid_key(&value.key) {
            return Err(AppError::Other(format!(
                "Invalid environment key: {}",
                value.key
            )));
        }
        let resolved = if value.secret {
            creds::load_environment_value(&environment_id, &value.key)?
                .ok_or_else(|| AppError::Other(format!("Missing value for {}", value.key)))?
        } else {
            value.value
        };
        variables.insert(value.key, resolved);
    }
    run_command(&cwd, &command, variables, timeout_seconds).await
}

#[cfg(test)]
mod tests {
    use super::valid_key;

    #[test]
    fn accepts_portable_environment_keys() {
        assert!(valid_key("DATABASE_URL"));
        assert!(valid_key("_INTERNAL_2"));
        assert!(!valid_key("2FA_TOKEN"));
        assert!(!valid_key("BAD-KEY"));
        assert!(!valid_key(""));
    }
}
