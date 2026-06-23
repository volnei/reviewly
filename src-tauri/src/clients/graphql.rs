//! Thin GraphQL helper for the handful of operations GitHub doesn't expose
//! via REST (mark ready for review, convert to draft, resolve / unresolve
//! review threads, mark file as viewed).

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::clients::check;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

const ENDPOINT: &str = "https://api.github.com/graphql";

#[derive(Serialize)]
struct GraphQLRequest<'a> {
    query: &'a str,
    variables: Value,
}

#[derive(Deserialize)]
struct GraphQLResponse<T> {
    data: Option<T>,
    errors: Option<Vec<Value>>,
}

pub async fn graphql<T: for<'de> Deserialize<'de>>(
    state: &AppState,
    token: &str,
    query: &str,
    variables: Value,
) -> AppResult<T> {
    let res = state
        .http
        .post(ENDPOINT)
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .json(&GraphQLRequest { query, variables })
        .send()
        .await?;
    let res = check(res).await?;
    let body: GraphQLResponse<T> = res.json().await?;
    if let Some(errors) = body.errors {
        return Err(AppError::Other(format!("graphql errors: {errors:?}")));
    }
    body.data
        .ok_or_else(|| AppError::Other("graphql empty response".into()))
}
