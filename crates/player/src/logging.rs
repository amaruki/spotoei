use tokio::io::{AsyncWriteExt, Stdout};

pub async fn writeln_stdout(stdout: &mut Stdout, line: &str) -> std::io::Result<()> {
    stdout.write_all(line.as_bytes()).await?;
    stdout.write_all(b"\n").await?;
    stdout.flush().await
}

pub fn get_log_file_path() -> std::path::PathBuf {
    if let Ok(path) = std::env::var("SPOTOEI_LOG_FILE") {
        return std::path::PathBuf::from(path);
    }
    let config_dir = std::env::var("XDG_CONFIG_HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::var("HOME")
                .map(|h| std::path::PathBuf::from(h).join(".config"))
                .unwrap_or_else(|_| std::path::PathBuf::from("."))
        });
    let spotoei_dir = config_dir.join("spotoei");
    let _ = std::fs::create_dir_all(&spotoei_dir);
    spotoei_dir.join("spotoei.log")
}
pub const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024; // 2 MiB

pub fn rotate_log_if_needed(path: &std::path::Path) {
    if let Ok(meta) = std::fs::metadata(path) {
        if meta.len() >= MAX_LOG_BYTES {
            let mut backup = path.to_path_buf();
            let ext = backup.extension().and_then(|e| e.to_str()).unwrap_or("log");
            backup.set_extension(format!("{ext}.1"));
            let _ = std::fs::rename(path, backup);
        }
    }
}

pub fn init_tracing() {
    use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    // The TUI collects stderr into the shared diagnostic file.
    if std::env::var("SPOTOEI_LOG_STDERR_ONLY").as_deref() == Ok("1") {
        let _ = fmt()
            .with_writer(std::io::stderr)
            .with_ansi(false)
            .with_env_filter(filter)
            .with_target(true)
            .try_init();
        return;
    }
    let log_path = get_log_file_path();
    rotate_log_if_needed(&log_path);
    if let Ok(file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        let file_layer = fmt::layer()
            .with_writer(std::sync::Arc::new(file))
            .with_ansi(false)
            .with_target(false);
        let stderr_layer = fmt::layer().with_writer(std::io::stderr).with_target(false);

        let _ = tracing_subscriber::registry()
            .with(filter)
            .with(file_layer)
            .with(stderr_layer)
            .try_init();
    } else {
        let _ = fmt()
            .with_writer(std::io::stderr)
            .with_env_filter(filter)
            .with_target(false)
            .try_init();
    }
}
