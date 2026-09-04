use std::process::ExitCode;
use std::sync::Arc;
use tokio::sync::mpsc;

use crate::auth::{AuthManager, AuthStatus};
use crate::config::resolve_client_id;
use crate::playback;
use crate::protocol::{PLAYER_VERSION, PROTOCOL_VERSION};

pub async fn run_doctor(args: &[String]) -> ExitCode {
    let sub = args.first().map(|s| s.as_str()).unwrap_or("all");
    let mut problems = 0u32;

    if sub == "all" || sub == "version" {
        println!("[ok] SPOTOEI version: player={}", PLAYER_VERSION);
    }

    if sub == "all" || sub == "audio" {
        let client_id = resolve_client_id();
        let (tx, _rx) = mpsc::channel::<String>(8);
        let auth = Arc::new(AuthManager::new(client_id, tx));
        let _ = auth.hydrate().await;
        let engine = playback::LibrespotEngine::new(auth);
        match engine.ensure_player().await {
            Ok(_) => println!("[ok] audio engine and librespot connection successful"),
            Err(e) => {
                println!("[err] audio engine failure: {e}");
                problems += 1;
            }
        }
    }

    if sub == "all" || sub == "sidecar" {
        // We are the sidecar; confirm we can emit a hello response.
        println!(
            "[ok] player sidecar present (protocol={})",
            PROTOCOL_VERSION
        );
    }

    if sub == "all" || sub == "config" {
        let id = resolve_client_id();
        if !id.is_empty() {
            println!("[ok] config readable (client_id=<set>)");
        } else {
            println!("[warn] SPOTOEI_CLIENT_ID is not configured (set SPOTOEI_CLIENT_ID or create ~/.config/spotoei/config.json)");
            problems += 1;
        }
    }

    if sub == "all" || sub == "auth" {
        let client_id = resolve_client_id();
        let (tx, _rx) = mpsc::channel::<String>(8);
        let auth = AuthManager::new(client_id.clone(), tx);
        let status: AuthStatus = auth.hydrate().await;
        println!(
            "Client ID: {}",
            if client_id.is_empty() {
                "<not set: SPOTOEI_CLIENT_ID or ~/.config/spotoei/config.json>"
            } else {
                "<set>"
            }
        );
        println!("Auth State: {:?}", status.state);
        println!("Storage Tier: {:?}", status.storage);
        println!(
            "Account ID: {}",
            status.account_id.as_deref().unwrap_or("<none>")
        );
        println!(
            "Scopes: {}",
            if status.scopes.is_empty() {
                "<none>".to_string()
            } else {
                status.scopes.join(", ")
            }
        );
        if let Ok((token, _)) = auth.get_web_token().await {
            let client = reqwest::Client::new();
            if let Ok(resp) = client
                .get("https://api.spotify.com/v1/me")
                .bearer_auth(token)
                .send()
                .await
            {
                if let Ok(val) = resp.json::<serde_json::Value>().await {
                    println!("Spotify /v1/me: {}", val);
                    let user_id = val
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("<unknown>");
                    let product = val
                        .get("product")
                        .and_then(|v| v.as_str())
                        .unwrap_or("<unknown>");
                    println!("Spotify User ID: {user_id}");
                    println!("Spotify Product Plan: {product}");
                }
            }
        }
    }

    if sub == "all" || sub == "cache" {
        // Cache is owned by the UI; here we just confirm the directory is writable
        // so the UI can create its SQLite file.
        let cache_path = std::env::var("XDG_CACHE_HOME")
            .ok()
            .map(|p| std::path::PathBuf::from(p).join("spotoei"))
            .or_else(|| {
                std::env::var("HOME")
                    .ok()
                    .map(|p| std::path::PathBuf::from(p).join(".cache").join("spotoei"))
            });
        match cache_path {
            Some(dir) => {
                if std::fs::create_dir_all(&dir).is_ok() {
                    println!("[ok] cache directory writable: {}", dir.display());
                } else {
                    println!("[warn] cache directory not writable: {}", dir.display());
                    problems += 1;
                }
            }
            None => {
                println!("[warn] cache directory: cannot resolve XDG_CACHE_HOME/HOME");
                problems += 1;
            }
        }
    }

    if sub == "all" || sub == "browser" {
        // Best-effort check: the Spotify OAuth flow opens a browser. We look
        // for `xdg-open` (Linux), `open` (macOS), or `start` (Windows).
        let candidates: &[&str] = if cfg!(target_os = "macos") {
            &["open"]
        } else if cfg!(target_os = "windows") {
            &["start", "rundll32"]
        } else {
            &["xdg-open", "sensible-browser", "wslview"]
        };
        let found = candidates.iter().find(|c| {
            std::process::Command::new(c)
                .arg("--version")
                .output()
                .is_ok()
                || std::process::Command::new(c).arg("").output().is_ok()
        });
        match found {
            Some(cmd) => println!("[ok] browser launch mechanism available: {}", cmd),
            None => {
                println!("[warn] browser launch mechanism: no known browser opener on PATH");
                problems += 1;
            }
        }
    }

    if problems == 0 {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    }
}
