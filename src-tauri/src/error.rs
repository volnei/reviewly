use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("not signed in")]
    NotSignedIn,
    #[error("auth failed: {0}")]
    Auth(String),
    #[error("upstream github returned {status}: {body}")]
    Upstream { status: u16, body: String },
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("keyring error: {0}")]
    Keyring(#[from] keyring::Error),
    #[error("serde error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Other(String),
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
