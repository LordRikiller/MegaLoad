use std::path::{Path, PathBuf};

/// Validate that a string is a safe single path component (no traversal).
/// Rejects empty strings, path separators, "..", null bytes, and absolute paths.
pub fn sanitize_path_component(name: &str) -> Result<&str, String> {
    if name.is_empty() {
        return Err("Path component cannot be empty".to_string());
    }
    if name.contains('/') || name.contains('\\') || name.contains('\0') {
        return Err(format!("Invalid path component (contains separators): {}", name));
    }
    if name == "." || name == ".." {
        return Err(format!("Invalid path component (traversal): {}", name));
    }
    if name.contains("..") {
        return Err(format!("Invalid path component (contains ..): {}", name));
    }
    // Reject Windows device names
    let lower = name.to_lowercase();
    let stem = lower.split('.').next().unwrap_or(&lower);
    let reserved = ["con", "prn", "aux", "nul",
        "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
        "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9"];
    if reserved.contains(&stem) {
        return Err(format!("Invalid path component (reserved name): {}", name));
    }
    Ok(name)
}

/// Validate that a resolved path stays within an expected base directory.
/// Both paths are canonicalized to prevent symlink/traversal escapes.
pub fn ensure_path_containment(path: &Path, base: &Path) -> Result<PathBuf, String> {
    let canonical_base = base.canonicalize()
        .map_err(|e| format!("Cannot resolve base path {}: {}", base.display(), e))?;
    let canonical_path = path.canonicalize()
        .map_err(|e| format!("Cannot resolve path {}: {}", path.display(), e))?;
    if !canonical_path.starts_with(&canonical_base) {
        return Err(format!(
            "Path {} escapes base directory {}",
            canonical_path.display(),
            canonical_base.display()
        ));
    }
    Ok(canonical_path)
}

/// Validate a download URL: must be HTTPS and from an allowed host.
pub fn validate_download_url(url: &str) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err(format!("Download URL must use HTTPS: {}", url));
    }
    let allowed_hosts = [
        "github.com",
        "objects.githubusercontent.com",
        "api.github.com",
        "gcdn.thunderstore.io",
        "thunderstore.io",
        "mega-api.lordrik.workers.dev",
    ];
    // Extract host from URL
    let without_scheme = &url["https://".len()..];
    let host = without_scheme.split('/').next().unwrap_or("");
    // Strip port if present
    let host_no_port = host.split(':').next().unwrap_or(host);
    if !allowed_hosts.iter().any(|h| host_no_port == *h || host_no_port.ends_with(&format!(".{}", h))) {
        return Err(format!("Download URL host not allowed: {}", host_no_port));
    }
    Ok(())
}

/// Validate that a config file path is within a BepInEx config directory
/// and has a .cfg extension. Uses canonical path containment for safety.
pub fn validate_config_path(config_path: &str, bepinex_hint: &str) -> Result<(), String> {
    let path = Path::new(config_path);
    // Must have .cfg extension
    match path.extension().and_then(|e| e.to_str()) {
        Some("cfg") => {}
        _ => return Err("Config file must have .cfg extension".to_string()),
    }
    // Must not contain traversal
    if config_path.contains("..") {
        return Err("Config path must not contain path traversal".to_string());
    }
    // Use canonical path containment when BepInEx hint is available
    let bep = Path::new(bepinex_hint);
    let config_dir = bep.join("config");
    if config_dir.exists() && path.exists() {
        ensure_path_containment(path, &config_dir)?;
    } else {
        // Fallback to substring check for paths that don't exist yet
        let normalized = config_path.replace('\\', "/").to_lowercase();
        if !normalized.contains("bepinex") || !normalized.contains("config") {
            return Err("Config path must be within a BepInEx/config directory".to_string());
        }
    }
    Ok(())
}
