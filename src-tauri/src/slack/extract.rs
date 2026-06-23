use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use pbkdf2::pbkdf2_hmac;
use regex::Regex;
use sha1::Sha1;
use std::sync::OnceLock;

#[derive(Debug, thiserror::Error)]
pub enum ExtractError {
    #[error("Slack desktop app not found")]
    NotInstalled,
    #[error("could not read Slack local storage")]
    TokenUnavailable,
    #[error("could not read or decrypt the Slack cookie")]
    CookieUnavailable,
    #[error("auto-detection isn't supported on this OS")]
    Unsupported,
}

pub struct ExtractedCreds {
    pub xoxc: String,
    pub xoxd: String,
    pub workspace_hint: Option<String>,
}

/// First `xoxc-…` token embedded in raw leveldb bytes, if any.
pub fn scan_xoxc(bytes: &[u8]) -> Option<String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"xoxc-[0-9A-Za-z-]+").unwrap());
    let text = String::from_utf8_lossy(bytes);
    re.find(&text).map(|m| m.as_str().to_string())
}

/// macOS Chromium key: PBKDF2-HMAC-SHA1(password, "saltysalt", 1003, 16).
pub fn derive_key(password: &[u8]) -> [u8; 16] {
    let mut key = [0u8; 16];
    pbkdf2_hmac::<Sha1>(password, b"saltysalt", 1003, &mut key);
    key
}

type Aes128CbcDec = cbc::Decryptor<aes::Aes128>;

/// Decrypt a Chromium `v10`/`v11` cookie blob to its string value. Strips the
/// 3-byte version prefix, AES-128-CBC decrypts (IV = 16×0x20), PKCS#7-unpads,
/// then recovers the `xoxd-…` value (tolerating a leading SHA-256(domain) prefix
/// that newer Chromium prepends).
pub fn decrypt_cookie(encrypted: &[u8], key: &[u8]) -> Result<String, ExtractError> {
    if encrypted.len() <= 3 {
        return Err(ExtractError::CookieUnavailable);
    }
    let ct = &encrypted[3..];
    let iv = [0x20u8; 16];
    let pt = Aes128CbcDec::new(key.into(), (&iv).into())
        .decrypt_padded_vec_mut::<Pkcs7>(ct)
        .map_err(|_| ExtractError::CookieUnavailable)?;
    let text = String::from_utf8_lossy(&pt);
    match text.find("xoxd-") {
        Some(i) => Ok(text[i..].trim_end_matches('\0').to_string()),
        None => Err(ExtractError::CookieUnavailable),
    }
}

/// Copy the Cookies SQLite to a temp path (Slack may hold a lock), open it
/// read-only, and return the raw `encrypted_value` of the `d` cookie.
pub async fn read_d_cookie_blob(db_path: &std::path::Path) -> Result<Vec<u8>, ExtractError> {
    let bytes = tokio::fs::read(db_path).await.map_err(|_| ExtractError::CookieUnavailable)?;
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp = std::env::temp_dir().join(format!("astryn-slack-cookies-{}-{}", std::process::id(), n));
    tokio::fs::write(&tmp, &bytes).await.map_err(|_| ExtractError::CookieUnavailable)?;
    let url = format!("sqlite://{}?mode=ro", tmp.display());
    let pool = sqlx::SqlitePool::connect(&url).await.map_err(|_| ExtractError::CookieUnavailable)?;
    let row: Option<(Vec<u8>,)> =
        sqlx::query_as("SELECT encrypted_value FROM cookies WHERE name = 'd' LIMIT 1")
            .fetch_optional(&pool).await.map_err(|_| ExtractError::CookieUnavailable)?;
    pool.close().await;
    let _ = tokio::fs::remove_file(&tmp).await;
    row.map(|r| r.0).ok_or(ExtractError::CookieUnavailable)
}

#[cfg(not(target_os = "macos"))]
pub async fn extract_credentials() -> Result<ExtractedCreds, ExtractError> {
    Err(ExtractError::Unsupported)
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;

    fn slack_dir() -> Result<std::path::PathBuf, ExtractError> {
        let home = std::env::var("HOME").map_err(|_| ExtractError::NotInstalled)?;
        let dir = std::path::Path::new(&home).join("Library/Application Support/Slack");
        if dir.is_dir() { Ok(dir) } else { Err(ExtractError::NotInstalled) }
    }

    /// The "Slack Safe Storage" password from the login keychain (triggers a
    /// one-time keychain-access prompt). Runs in spawn_blocking.
    fn safe_storage_password() -> Result<String, ExtractError> {
        let out = std::process::Command::new("/usr/bin/security")
            .args(["find-generic-password", "-w", "-s", "Slack Safe Storage"])
            .output()
            .map_err(|_| ExtractError::CookieUnavailable)?;
        if !out.status.success() {
            return Err(ExtractError::CookieUnavailable);
        }
        let pw = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if pw.is_empty() { Err(ExtractError::CookieUnavailable) } else { Ok(pw) }
    }

    pub async fn extract() -> Result<ExtractedCreds, ExtractError> {
        let dir = slack_dir()?;

        // xoxc: scan every leveldb .ldb/.log under Local Storage.
        let ls = dir.join("Local Storage/leveldb");
        let mut rd = tokio::fs::read_dir(&ls).await.map_err(|_| ExtractError::TokenUnavailable)?;
        let mut xoxc = None;
        while let Ok(Some(ent)) = rd.next_entry().await {
            let p = ent.path();
            let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
            if ext == "ldb" || ext == "log" {
                if let Ok(bytes) = tokio::fs::read(&p).await {
                    if let Some(t) = scan_xoxc(&bytes) { xoxc = Some(t); break; }
                }
            }
        }
        let xoxc = xoxc.ok_or(ExtractError::TokenUnavailable)?;

        // xoxd: decrypt the d cookie.
        let encrypted = read_d_cookie_blob(&dir.join("Cookies")).await?;
        let password = tokio::task::spawn_blocking(safe_storage_password)
            .await
            .map_err(|_| ExtractError::CookieUnavailable)??;
        let key = derive_key(password.as_bytes());
        let xoxd = decrypt_cookie(&encrypted, &key)?;

        Ok(ExtractedCreds { xoxc, xoxd, workspace_hint: None })
    }
}

#[cfg(target_os = "macos")]
pub async fn extract_credentials() -> Result<ExtractedCreds, ExtractError> {
    macos::extract().await
}

#[cfg(test)]
mod tests {
    use super::*;
    use aes::cipher::{block_padding::Pkcs7, BlockEncryptMut, KeyIvInit};

    #[test]
    fn scan_finds_xoxc_token() {
        let blob = br#"...{"token":"xoxc-12-34-56-abcdef"},"foo":1..."#;
        assert_eq!(scan_xoxc(blob).as_deref(), Some("xoxc-12-34-56-abcdef"));
    }

    #[test]
    fn scan_returns_none_when_absent() {
        assert_eq!(scan_xoxc(b"no token here"), None);
    }

    #[test]
    fn decrypt_round_trips_a_v10_cookie() {
        // Encrypt "xoxd-secret" with the same scheme decrypt_cookie expects.
        let key = derive_key(b"Slack Safe Storage");
        let iv = [0x20u8; 16];
        type Enc = cbc::Encryptor<aes::Aes128>;
        let ct = Enc::new(&key.into(), &iv.into())
            .encrypt_padded_vec_mut::<Pkcs7>(b"xoxd-secret");
        let mut encrypted = b"v10".to_vec();
        encrypted.extend_from_slice(&ct);
        assert_eq!(decrypt_cookie(&encrypted, &key).unwrap(), "xoxd-secret");
    }

    #[test]
    fn decrypt_rejects_short_input() {
        assert!(matches!(decrypt_cookie(b"v1", &[0u8; 16]), Err(ExtractError::CookieUnavailable)));
    }

    #[tokio::test]
    async fn reads_encrypted_d_cookie_from_a_fixture_db() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("Cookies");
        let pool = sqlx::SqlitePool::connect(&format!("sqlite://{}?mode=rwc", db.display()))
            .await
            .unwrap();
        sqlx::query("CREATE TABLE cookies (name TEXT, encrypted_value BLOB)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO cookies (name, encrypted_value) VALUES ('d', ?1)")
            .bind(vec![1u8, 2, 3, 4]).execute(&pool).await.unwrap();
        pool.close().await;
        assert_eq!(read_d_cookie_blob(&db).await.unwrap(), vec![1u8, 2, 3, 4]);
    }

    #[tokio::test]
    async fn read_d_cookie_missing_is_cookie_unavailable() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("Cookies");
        let pool = sqlx::SqlitePool::connect(&format!("sqlite://{}?mode=rwc", db.display()))
            .await.unwrap();
        sqlx::query("CREATE TABLE cookies (name TEXT, encrypted_value BLOB)")
            .execute(&pool).await.unwrap();
        pool.close().await;
        assert!(matches!(read_d_cookie_blob(&db).await, Err(ExtractError::CookieUnavailable)));
    }
}
