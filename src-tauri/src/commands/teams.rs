use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::creds;
use crate::error::{AppError, AppResult};

const PRODUCTION_URL: &str = "https://getreviewly.dev";

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamOrganization {
    pub id: String,
    pub login: String,
    pub display_name: Option<String>,
    pub role: String,
}

#[derive(Debug, Deserialize)]
struct OrganizationsResponse {
    organizations: Vec<TeamOrganization>,
}

#[derive(Debug, Serialize)]
pub struct TeamsStatus {
    pub signed_in: bool,
    pub organizations: Vec<TeamOrganization>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct DesktopLinkStart {
    pub link_id: String,
    pub device_code: String,
    pub user_code: String,
    pub authorize_url: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Deserialize)]
struct PollResponse {
    status: String,
    token: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DesktopLinkPoll {
    pub status: String,
    pub organizations: Vec<TeamOrganization>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamPull {
    pub id: String,
    pub repository: String,
    pub number: u64,
    pub title: Option<String>,
    pub url: Option<String>,
    pub author_login: Option<String>,
    pub state: String,
    pub draft: bool,
    pub base_branch: Option<String>,
    pub review_decision: Option<String>,
    pub ci_state: Option<String>,
    pub mergeable_state: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub synced_at: String,
    pub claimed_by_user_id: Option<String>,
    pub claimed_by_login: Option<String>,
    pub claimed_at: Option<String>,
    pub priority: String,
    pub next_action: String,
    pub sla_due_at: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamMember {
    pub id: String,
    pub login: String,
    pub role: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamsInbox {
    pub organization_id: String,
    pub current_user_id: String,
    pub members: Vec<TeamMember>,
    pub pulls: Vec<TeamPull>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FastLanePolicy {
    pub enabled: bool,
    pub include_dependabot: bool,
    pub include_renovate: bool,
    pub require_green_ci: bool,
    pub exclude_drafts: bool,
    pub exclude_conflicts: bool,
    pub exclude_changes_requested: bool,
    pub exclude_open_threads: bool,
    pub trusted_authors: Vec<String>,
    pub max_changed_files: Option<u64>,
    pub max_changed_lines: Option<u64>,
    pub allowed_paths: Vec<String>,
    pub blocked_paths: Vec<String>,
    pub required_labels: Vec<String>,
    pub blocked_labels: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamBillingPrice {
    pub currency: String,
    pub unit_amount: u64,
    pub interval: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamBilling {
    pub organization_id: String,
    pub configured: bool,
    pub status: String,
    pub access: bool,
    pub complimentary: bool,
    pub can_manage: bool,
    pub price: TeamBillingPrice,
    pub member_count: u64,
    pub seat_count: u64,
    pub current_period_end: Option<String>,
    pub cancel_at_period_end: bool,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct TeamsBillingUrl {
    pub url: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamIntegrationConnection {
    pub status: String,
    pub display_name: Option<String>,
    pub external_id: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamIntegration {
    pub provider: String,
    pub configured: bool,
    pub connection: Option<TeamIntegrationConnection>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct TeamIntegrations {
    pub integrations: Vec<TeamIntegration>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct TeamRepositories {
    pub repositories: Vec<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamEnvironmentVariable {
    pub id: String,
    pub key: String,
    pub secret: bool,
    pub updated_at: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamEnvironmentCommand {
    pub id: String,
    pub name: String,
    pub command: String,
    pub working_directory: String,
    pub timeout_seconds: u64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamEnvironment {
    pub id: String,
    pub name: String,
    pub repository: Option<String>,
    pub variables: Vec<TeamEnvironmentVariable>,
    pub commands: Vec<TeamEnvironmentCommand>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamEnvironments {
    pub environments: Vec<TeamEnvironment>,
    pub can_edit: bool,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CreatedEnvironment {
    pub id: String,
}

#[derive(Debug, Deserialize)]
struct ResolvedVariable {
    key: String,
    value: String,
}

#[derive(Debug, Deserialize)]
struct ResolvedEnvironment {
    variables: Vec<ResolvedVariable>,
    commands: Vec<TeamEnvironmentCommand>,
}

fn base_url() -> String {
    #[cfg(debug_assertions)]
    if let Ok(value) = std::env::var("REVIEWLY_TEAMS_URL") {
        return value.trim_end_matches('/').to_string();
    }
    PRODUCTION_URL.into()
}

fn client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent("Reviewly desktop")
        .build()
        .map_err(AppError::from)
}

async fn organizations(token: &str) -> AppResult<Vec<TeamOrganization>> {
    let response = client()?
        .get(format!("{}/api/organizations", base_url()))
        .bearer_auth(token)
        .send()
        .await?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(AppError::Auth("Reviewly Teams session expired".into()));
    }
    if !response.status().is_success() {
        return Err(AppError::Other(format!(
            "Reviewly Teams returned {}",
            response.status()
        )));
    }
    Ok(response
        .json::<OrganizationsResponse>()
        .await?
        .organizations)
}

#[tauri::command]
pub async fn teams_status() -> AppResult<TeamsStatus> {
    let Some(token) = creds::load_teams_token()? else {
        return Ok(TeamsStatus {
            signed_in: false,
            organizations: Vec::new(),
        });
    };
    match organizations(&token).await {
        Ok(organizations) => Ok(TeamsStatus {
            signed_in: true,
            organizations,
        }),
        Err(AppError::Auth(_)) => {
            creds::delete_teams_token()?;
            Ok(TeamsStatus {
                signed_in: false,
                organizations: Vec::new(),
            })
        }
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub fn teams_install_url() -> String {
    format!("{}/api/github/install", base_url())
}

#[tauri::command]
pub async fn teams_link_start() -> AppResult<DesktopLinkStart> {
    let response = client()?
        .post(format!("{}/api/desktop/link/start", base_url()))
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(AppError::Other(format!(
            "Could not start Reviewly Teams sign in ({})",
            response.status()
        )));
    }
    Ok(response.json().await?)
}

#[tauri::command]
pub async fn teams_link_poll(link_id: String, device_code: String) -> AppResult<DesktopLinkPoll> {
    let response = client()?
        .post(format!("{}/api/desktop/link/poll", base_url()))
        .json(&serde_json::json!({
            "link_id": link_id,
            "device_code": device_code,
        }))
        .send()
        .await?;
    if response.status() == reqwest::StatusCode::ACCEPTED {
        return Ok(DesktopLinkPoll {
            status: "pending".into(),
            organizations: Vec::new(),
        });
    }
    if !response.status().is_success() {
        return Err(AppError::Auth("Reviewly Teams sign in expired".into()));
    }
    let body = response.json::<PollResponse>().await?;
    let token = body
        .token
        .ok_or_else(|| AppError::Auth("Reviewly Teams returned no session".into()))?;
    creds::save_teams_token(&token)?;
    let organizations = organizations(&token).await?;
    Ok(DesktopLinkPoll {
        status: body.status,
        organizations,
    })
}

#[tauri::command]
pub async fn teams_sign_out() -> AppResult<()> {
    let mut revoke_error = None;
    if let Some(token) = creds::load_teams_token()? {
        match client()?
            .post(format!("{}/api/auth/logout", base_url()))
            .bearer_auth(token)
            .send()
            .await
        {
            Ok(response)
                if !response.status().is_success()
                    && response.status() != reqwest::StatusCode::UNAUTHORIZED =>
            {
                revoke_error = Some(AppError::Other(format!(
                    "Could not revoke Reviewly Teams session ({})",
                    response.status()
                )));
            }
            Err(error) => revoke_error = Some(AppError::from(error)),
            _ => {}
        }
    }
    creds::delete_teams_token()?;
    if let Some(error) = revoke_error {
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
pub async fn teams_inbox(organization_id: String) -> AppResult<TeamsInbox> {
    let token = creds::load_teams_token()?.ok_or(AppError::NotSignedIn)?;
    let response = client()?
        .get(format!(
            "{}/api/organizations/{}/inbox",
            base_url(),
            urlencoding::encode(&organization_id)
        ))
        .bearer_auth(token)
        .send()
        .await?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        creds::delete_teams_token()?;
        return Err(AppError::Auth("Reviewly Teams session expired".into()));
    }
    if !response.status().is_success() {
        return Err(AppError::Other(format!(
            "Reviewly Teams inbox returned {}",
            response.status()
        )));
    }
    Ok(response.json().await?)
}

#[tauri::command]
pub async fn teams_queue_update(
    organization_id: String,
    update: serde_json::Value,
) -> AppResult<()> {
    let pull_request_id = update
        .get("pullRequestId")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| AppError::Other("Reviewly Teams queue update is missing its PR".into()))?;
    let token = creds::load_teams_token()?.ok_or(AppError::NotSignedIn)?;
    let response = client()?
        .patch(format!(
            "{}/api/organizations/{}/inbox/{}",
            base_url(),
            urlencoding::encode(&organization_id),
            urlencoding::encode(pull_request_id)
        ))
        .bearer_auth(token)
        .json(&update)
        .send()
        .await?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        creds::delete_teams_token()?;
        return Err(AppError::Auth("Reviewly Teams session expired".into()));
    }
    if !response.status().is_success() {
        return Err(AppError::Other(format!(
            "Reviewly Teams queue returned {}",
            response.status()
        )));
    }
    Ok(())
}

async fn teams_api_request(
    organization_id: &str,
    path: &str,
    method: reqwest::Method,
    body: Option<serde_json::Value>,
) -> AppResult<reqwest::Response> {
    let token = creds::load_teams_token()?.ok_or(AppError::NotSignedIn)?;
    let mut request = client()?
        .request(
            method,
            format!(
                "{}/api/organizations/{}/{}",
                base_url(),
                urlencoding::encode(organization_id),
                path.trim_start_matches('/')
            ),
        )
        .bearer_auth(token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().await?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        creds::delete_teams_token()?;
        return Err(AppError::Auth("Reviewly Teams session expired".into()));
    }
    if !response.status().is_success() {
        return Err(AppError::Other(format!(
            "Reviewly Teams returned {}",
            response.status()
        )));
    }
    Ok(response)
}

#[tauri::command]
pub async fn teams_fast_lane_policy(organization_id: String) -> AppResult<FastLanePolicy> {
    Ok(
        teams_api_request(&organization_id, "fast-lane", reqwest::Method::GET, None)
            .await?
            .json()
            .await?,
    )
}

#[tauri::command]
pub async fn teams_repositories(organization_id: String) -> AppResult<TeamRepositories> {
    Ok(
        teams_api_request(&organization_id, "repositories", reqwest::Method::GET, None)
            .await?
            .json()
            .await?,
    )
}

#[tauri::command]
pub async fn teams_fast_lane_policy_update(
    organization_id: String,
    policy: FastLanePolicy,
) -> AppResult<FastLanePolicy> {
    Ok(teams_api_request(
        &organization_id,
        "fast-lane",
        reqwest::Method::PATCH,
        Some(serde_json::to_value(policy)?),
    )
    .await?
    .json()
    .await?)
}

#[tauri::command]
pub async fn teams_integrations(organization_id: String) -> AppResult<TeamIntegrations> {
    Ok(
        teams_api_request(&organization_id, "integrations", reqwest::Method::GET, None)
            .await?
            .json()
            .await?,
    )
}

#[tauri::command]
pub async fn teams_integration_start(
    organization_id: String,
    provider: String,
) -> AppResult<TeamsBillingUrl> {
    if provider != "gitlab" && provider != "slack" {
        return Err(AppError::Other("Unknown Reviewly integration".into()));
    }
    Ok(teams_api_request(
        &organization_id,
        &format!("integrations/{provider}/start"),
        reqwest::Method::POST,
        None,
    )
    .await?
    .json()
    .await?)
}

async fn teams_request(
    organization_id: &str,
    suffix: &str,
    method: reqwest::Method,
) -> AppResult<reqwest::Response> {
    let token = creds::load_teams_token()?.ok_or(AppError::NotSignedIn)?;
    let response = client()?
        .request(
            method,
            format!(
                "{}/api/organizations/{}/billing{}",
                base_url(),
                urlencoding::encode(organization_id),
                suffix
            ),
        )
        .bearer_auth(token)
        .send()
        .await?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        creds::delete_teams_token()?;
        return Err(AppError::Auth("Reviewly Teams session expired".into()));
    }
    if !response.status().is_success() {
        return Err(AppError::Other(format!(
            "Reviewly Teams billing returned {}",
            response.status()
        )));
    }
    Ok(response)
}

#[tauri::command]
pub async fn teams_billing(organization_id: String) -> AppResult<TeamBilling> {
    Ok(teams_request(&organization_id, "", reqwest::Method::GET)
        .await?
        .json()
        .await?)
}

#[tauri::command]
pub async fn teams_checkout(organization_id: String) -> AppResult<TeamsBillingUrl> {
    Ok(
        teams_request(&organization_id, "/checkout", reqwest::Method::POST)
            .await?
            .json()
            .await?,
    )
}

#[tauri::command]
pub async fn teams_billing_portal(organization_id: String) -> AppResult<TeamsBillingUrl> {
    Ok(
        teams_request(&organization_id, "/portal", reqwest::Method::POST)
            .await?
            .json()
            .await?,
    )
}

#[tauri::command]
pub async fn teams_environments(organization_id: String) -> AppResult<TeamEnvironments> {
    Ok(
        teams_api_request(&organization_id, "environments", reqwest::Method::GET, None)
            .await?
            .json()
            .await?,
    )
}

#[tauri::command]
pub async fn teams_environment_create(
    organization_id: String,
    environment: serde_json::Value,
) -> AppResult<CreatedEnvironment> {
    Ok(teams_api_request(
        &organization_id,
        "environments",
        reqwest::Method::POST,
        Some(environment),
    )
    .await?
    .json()
    .await?)
}

#[tauri::command]
pub async fn teams_environment_update(
    organization_id: String,
    environment_id: String,
    environment: serde_json::Value,
) -> AppResult<()> {
    teams_api_request(
        &organization_id,
        &format!("environments/{}", urlencoding::encode(&environment_id)),
        reqwest::Method::PUT,
        Some(environment),
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn teams_environment_delete(
    organization_id: String,
    environment_id: String,
) -> AppResult<()> {
    teams_api_request(
        &organization_id,
        &format!("environments/{}", urlencoding::encode(&environment_id)),
        reqwest::Method::DELETE,
        None,
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn teams_environment_command_run(
    organization_id: String,
    environment_id: String,
    command_id: String,
    cwd: String,
) -> AppResult<crate::commands::environments::CommandRunResult> {
    let resolved = teams_api_request(
        &organization_id,
        &format!(
            "environments/{}/resolve",
            urlencoding::encode(&environment_id)
        ),
        reqwest::Method::POST,
        None,
    )
    .await?
    .json::<ResolvedEnvironment>()
    .await?;
    let command = resolved
        .commands
        .into_iter()
        .find(|command| command.id == command_id)
        .ok_or_else(|| AppError::Other("Shared command no longer exists".into()))?;
    let variables = resolved
        .variables
        .into_iter()
        .map(|variable| (variable.key, variable.value))
        .collect::<HashMap<_, _>>();
    crate::commands::environments::run_command(
        &cwd,
        &command.command,
        variables,
        command.timeout_seconds,
    )
    .await
}
