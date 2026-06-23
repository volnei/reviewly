fn main() {
    println!("cargo:rerun-if-env-changed=REVIEWLY_GITHUB_CLIENT_ID");
    tauri_build::build();
}
