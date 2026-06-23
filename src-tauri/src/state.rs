use dashmap::DashMap;
use reqwest::Client;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};
use tauri::async_runtime::JoinHandle;

pub struct CacheEntry<T> {
    pub at: Instant,
    pub value: T,
    /// Last `ETag` seen for this key, for conditional revalidation.
    pub etag: Option<String>,
}

pub struct AppState {
    pub http: Client,
    /// Generic JSON cache keyed by request URL (helps the GitHub poller dedupe between worker + UI).
    pub gh_cache: Arc<DashMap<String, CacheEntry<serde_json::Value>>>,
    /// `owner/repo` list the UI is watching. The poller delta-watches these and
    /// emits `repos:changed` so the frontend reconciles them into the local DB.
    pub watched_repos: Arc<RwLock<Vec<String>>>,
    /// Keys (PRs) of guided-tour generations running in the background, so the UI
    /// can recover the "generating" state after navigating away or refreshing.
    pub ai_inflight: Arc<Mutex<HashSet<String>>>,
    /// Running guided-tour task handles, keyed by PR — so a generation can be
    /// canceled (aborting the task kills the spawned AI CLI via kill_on_drop).
    pub ai_tasks: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
}

impl AppState {
    /// Cached JSON value for `key` if present and younger than `ttl`.
    pub fn cache_get(&self, key: &str, ttl: Duration) -> Option<serde_json::Value> {
        let entry = self.gh_cache.get(key)?;
        if entry.at.elapsed() < ttl {
            Some(entry.value.clone())
        } else {
            None
        }
    }

    /// Store a value together with its ETag (for later conditional requests).
    pub fn cache_put_etag(&self, key: String, value: serde_json::Value, etag: Option<String>) {
        self.gh_cache.insert(key, CacheEntry { at: Instant::now(), value, etag });
    }

    /// The stored ETag for `key`, regardless of TTL.
    pub fn cache_etag(&self, key: &str) -> Option<String> {
        self.gh_cache.get(key).and_then(|e| e.etag.clone())
    }

    /// The stored value for `key`, regardless of TTL (used on a 304).
    pub fn cache_value(&self, key: &str) -> Option<serde_json::Value> {
        self.gh_cache.get(key).map(|e| e.value.clone())
    }

    /// Mark a key's cached value as fresh again (on a 304 Not Modified).
    pub fn cache_refresh(&self, key: &str) {
        if let Some(mut e) = self.gh_cache.get_mut(key) {
            e.at = Instant::now();
        }
    }

    pub fn new() -> Self {
        let http = Client::builder()
            .user_agent(concat!("reviewly/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(20))
            .build()
            .expect("build http client");

        Self {
            http,
            gh_cache: Arc::new(DashMap::new()),
            watched_repos: Arc::new(RwLock::new(Vec::new())),
            ai_inflight: Arc::new(Mutex::new(HashSet::new())),
            ai_tasks: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}
