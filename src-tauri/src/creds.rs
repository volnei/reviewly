use crate::error::{AppError, AppResult};
use keyring::Entry;
use serde::{Deserialize, Serialize};

const SERVICE: &str = "dev.volnei.reviewly";
const ACCOUNT: &str = "github";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredCredentials {
    pub host: String,
    pub token: String,
}

/// Dev-only escape hatch for the macOS keychain prompt.
///
/// Each `tauri dev` rebuild is re-signed with a fresh ad-hoc signature, so the
/// keychain treats it as a new app and re-prompts ("Always Allow" never sticks).
/// In debug builds we let the token come from `REVIEWLY_GH_TOKEN` instead, which
/// bypasses the keychain entirely — no prompt. Release builds always use the
/// keychain. Run dev with, e.g.:
///
/// ```sh
/// REVIEWLY_GH_TOKEN=$(gh auth token) bun tauri dev
/// ```
#[cfg(debug_assertions)]
fn dev_token() -> Option<String> {
    std::env::var("REVIEWLY_GH_TOKEN")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[cfg(not(debug_assertions))]
fn dev_token() -> Option<String> {
    None
}

fn entry() -> AppResult<Entry> {
    Entry::new(SERVICE, ACCOUNT).map_err(AppError::from)
}

pub fn save_token(host: &str, token: &str) -> AppResult<()> {
    // When a dev token is supplied via env, it's the source of truth — don't
    // touch the keychain (which would re-trigger the prompt).
    if dev_token().is_some() {
        return Ok(());
    }
    let value = serde_json::to_string(&StoredCredentials {
        host: host.into(),
        token: token.into(),
    })
    .map_err(|e| AppError::Other(format!("encode credentials: {e}")))?;
    entry()?.set_password(&value)?;
    Ok(())
}

pub fn load_token() -> AppResult<Option<String>> {
    Ok(load_credentials()?.map(|credentials| credentials.token))
}

pub fn load_credentials() -> AppResult<Option<StoredCredentials>> {
    if let Some(t) = dev_token() {
        let host = std::env::var("REVIEWLY_GH_HOST").unwrap_or_else(|_| "github.com".into());
        return Ok(Some(StoredCredentials { host, token: t }));
    }
    match entry()?.get_password() {
        Ok(s) => Ok(Some(serde_json::from_str(&s).unwrap_or(
            StoredCredentials {
                host: "github.com".into(),
                token: s,
            },
        ))),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn delete_token() -> AppResult<()> {
    if dev_token().is_some() {
        return Ok(());
    }
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}

pub fn require_token() -> AppResult<String> {
    load_token()?.ok_or(AppError::NotSignedIn)
}
