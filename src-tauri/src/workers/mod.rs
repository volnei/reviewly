pub mod github_poll;

use tauri::AppHandle;

pub async fn start_all(app: AppHandle) {
    tokio::spawn(async move {
        github_poll::run(app).await;
    });
}
