use serde::{Deserialize, Serialize};

use crate::creds;
use crate::error::{AppError, AppResult};

const PRODUCTION_URL: &str = "https://reviewly-teams.vercel.app";

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
    pub repository: String,
    pub number: u64,
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
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamsInbox {
    pub organization_id: String,
    pub pulls: Vec<TeamPull>,
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
pub fn teams_sign_out() -> AppResult<()> {
    creds::delete_teams_token()
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
