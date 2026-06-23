pub mod github;
pub mod graphql;

use crate::error::{AppError, AppResult};
use reqwest::Response;

/// Convert an HTTP response into an `AppError::Upstream` if non-2xx.
pub async fn check(res: Response) -> AppResult<Response> {
    if res.status().is_success() {
        return Ok(res);
    }
    let status = res.status().as_u16();
    let body = res.text().await.unwrap_or_default();
    Err(AppError::Upstream { status, body })
}
