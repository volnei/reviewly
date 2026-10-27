use serde::{Deserialize, Serialize};
use std::fmt;
use std::sync::{OnceLock, RwLock};
use url::Url;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GitHubInstance {
    pub host: String,
    pub web_url: String,
    pub api_url: String,
    pub graphql_url: String,
}

impl Default for GitHubInstance {
    fn default() -> Self {
        Self::from_host("github.com").expect("github.com is a valid host")
    }
}

impl GitHubInstance {
    pub fn from_host(input: &str) -> AppResult<Self> {
        let raw = input.trim().trim_end_matches('/');
        let candidate = if raw.contains("://") {
            raw.to_owned()
        } else {
            format!("https://{raw}")
        };
        let parsed = Url::parse(&candidate)
            .map_err(|_| AppError::Auth("Enter a valid GitHub hostname.".into()))?;
        if parsed.scheme() != "https" {
            return Err(AppError::Auth("GitHub Enterprise must use HTTPS.".into()));
        }
        if parsed.path() != "/" && !parsed.path().is_empty() {
            return Err(AppError::Auth(
                "Enter only the GitHub hostname, without a path.".into(),
            ));
        }
        let host = parsed
            .host_str()
            .filter(|host| !host.is_empty())
            .ok_or_else(|| AppError::Auth("Enter a valid GitHub hostname.".into()))?
            .to_ascii_lowercase();
        let web_url = format!("https://{host}");
        let (api_url, graphql_url) = if host == "github.com" {
            (
                "https://api.github.com".into(),
                "https://api.github.com/graphql".into(),
            )
        } else {
            (
                format!("{web_url}/api/v3"),
                format!("{web_url}/api/graphql"),
            )
        };
        Ok(Self {
            host,
            web_url,
            api_url,
            graphql_url,
        })
    }
}

static CURRENT: OnceLock<RwLock<GitHubInstance>> = OnceLock::new();

fn slot() -> &'static RwLock<GitHubInstance> {
    CURRENT.get_or_init(|| RwLock::new(GitHubInstance::default()))
}

pub fn current() -> GitHubInstance {
    slot().read().expect("github instance lock").clone()
}

pub fn set_current(instance: GitHubInstance) {
    *slot().write().expect("github instance lock") = instance;
}

#[derive(Debug, Clone, Copy)]
pub struct ApiBase;

impl fmt::Display for ApiBase {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&current().api_url)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_github_endpoints() {
        let i = GitHubInstance::from_host("https://github.com/").unwrap();
        assert_eq!(i.api_url, "https://api.github.com");
        assert_eq!(i.graphql_url, "https://api.github.com/graphql");
    }

    #[test]
    fn enterprise_endpoints() {
        let i = GitHubInstance::from_host("github.acme.test").unwrap();
        assert_eq!(i.web_url, "https://github.acme.test");
        assert_eq!(i.api_url, "https://github.acme.test/api/v3");
        assert_eq!(i.graphql_url, "https://github.acme.test/api/graphql");
    }
}
