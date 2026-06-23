use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use pbkdf2::pbkdf2_hmac;
use regex::Regex;
use sha1::Sha1;
use std::sync::OnceLock;

/// Removes its temp file when dropped, so `read_d_cookie_blob` never leaks a
/// copy of the Cookies DB on an early-return error path.
struct TempFileGuard(std::path::PathBuf);
impl Drop for TempFileGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ExtractError {
    #[error("Slack desktop app not found")]
    NotInstalled,
    #[error("could not read Slack local storage")]
    TokenUnavailable,
    #[error("could not read or decrypt the Slack cookie")]
    CookieUnavailable,
    // Constructed only by the non-macOS stub.
    #[allow(dead_code)]
    #[error("auto-detection isn't supported on this OS")]
    Unsupported,
}

pub struct ExtractedCreds {
    pub xoxc: String,
    pub xoxd: String,
    // Reserved for a future workspace-label hint; not yet consumed.
    #[allow(dead_code)]
    pub workspace_hint: Option<String>,
}

/// Longest `xoxc-…` token embedded in raw leveldb bytes, if any.
///
/// LevelDB is append-only, so a single scan sees many `xoxc-…` runs: the live
/// session token plus short stale fragments left by prior writes/compaction. A
/// real token is ~110+ chars while fragments are far shorter, so we return the
/// longest match rather than whichever the regex happens to hit first (position
/// is not a reliable discriminator; length is).
pub fn scan_xoxc(bytes: &[u8]) -> Option<String> {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"xoxc-[0-9A-Za-z-]+").unwrap());
    let text = String::from_utf8_lossy(bytes);
    re.find_iter(&text)
        .map(|m| m.as_str())
        .max_by_key(|s| s.len())
        .map(str::to_string)
}

/// Chromium cookie key: PBKDF2-HMAC-SHA1(password, "saltysalt", iters, 16).
/// Chromium uses 1003 iterations on macOS and 1 on Linux.
pub fn derive_key_iters(password: &[u8], iters: u32) -> [u8; 16] {
    let mut key = [0u8; 16];
    pbkdf2_hmac::<Sha1>(password, b"saltysalt", iters, &mut key);
    key
}

/// macOS Chromium key: PBKDF2-HMAC-SHA1(password, "saltysalt", 1003, 16).
pub fn derive_key(password: &[u8]) -> [u8; 16] {
    derive_key_iters(password, 1003)
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
    if &encrypted[..3] != b"v10" && &encrypted[..3] != b"v11" {
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
    let bytes = tokio::fs::read(db_path)
        .await
        .map_err(|_| ExtractError::CookieUnavailable)?;
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let tmp =
        std::env::temp_dir().join(format!("astryn-slack-cookies-{}-{}", std::process::id(), n));
    tokio::fs::write(&tmp, &bytes)
        .await
        .map_err(|_| ExtractError::CookieUnavailable)?;
    let _guard = TempFileGuard(tmp.clone());
    let url = format!("sqlite://{}?mode=ro", tmp.display());
    let pool = sqlx::SqlitePool::connect(&url)
        .await
        .map_err(|_| ExtractError::CookieUnavailable)?;
    let row: Option<(Vec<u8>,)> =
        sqlx::query_as("SELECT encrypted_value FROM cookies WHERE name = 'd' LIMIT 1")
            .fetch_optional(&pool)
            .await
            .map_err(|_| ExtractError::CookieUnavailable)?;
    pool.close().await;
    row.map(|r| r.0).ok_or(ExtractError::CookieUnavailable)
}

/// Shortest plausible `xoxc-…` session token. Real tokens are ~110+ chars; the
/// stale leveldb fragments we must reject are ~30. This floor turns a scan that
/// found only fragments into a clean `TokenUnavailable` rather than handing a
/// junk token to `auth.test`.
#[cfg(any(target_os = "macos", target_os = "linux"))]
const MIN_XOXC_LEN: usize = 40;

/// Scan a Slack data dir's `Local Storage/leveldb` for the live `xoxc-…` token.
/// The token can sit in any `.ldb`/`.log` file (and a file may also hold stale
/// fragments), so we scan every file and keep the longest match across all of
/// them, then reject it if it's too short to be a real token. Shared by the
/// macOS and Linux extractors (the leveldb layout is identical).
#[cfg(any(target_os = "macos", target_os = "linux"))]
async fn scan_dir_for_xoxc(dir: &std::path::Path) -> Result<String, ExtractError> {
    let ls = dir.join("Local Storage/leveldb");
    let mut rd = tokio::fs::read_dir(&ls)
        .await
        .map_err(|_| ExtractError::TokenUnavailable)?;
    let mut best: Option<String> = None;
    while let Ok(Some(ent)) = rd.next_entry().await {
        let p = ent.path();
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
        if ext == "ldb" || ext == "log" {
            if let Ok(bytes) = tokio::fs::read(&p).await {
                if let Some(t) = scan_xoxc(&bytes) {
                    if best.as_ref().is_none_or(|b| t.len() > b.len()) {
                        best = Some(t);
                    }
                }
            }
        }
    }
    match best {
        Some(t) if t.len() >= MIN_XOXC_LEN => Ok(t),
        _ => Err(ExtractError::TokenUnavailable),
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub async fn extract_credentials() -> Result<ExtractedCreds, ExtractError> {
    Err(ExtractError::Unsupported)
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;

    /// Candidate Slack data directories, checked in order: the direct-download
    /// location first, then the sandboxed Mac App Store container (the MAS build
    /// runs with `--user-data-dir` pointed at its `Containers/…` sandbox).
    fn slack_dirs(home: &std::path::Path) -> Vec<std::path::PathBuf> {
        vec![
            home.join("Library/Application Support/Slack"),
            home.join(
                "Library/Containers/com.tinyspeck.slackmacgap/Data/Library/Application Support/Slack",
            ),
        ]
    }

    fn slack_dir() -> Result<std::path::PathBuf, ExtractError> {
        let home = std::env::var("HOME").map_err(|_| ExtractError::NotInstalled)?;
        slack_dirs(std::path::Path::new(&home))
            .into_iter()
            .find(|d| d.is_dir())
            .ok_or(ExtractError::NotInstalled)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn slack_dirs_cover_direct_download_and_mac_app_store() {
            let home = std::path::Path::new("/Users/x");
            let dirs = slack_dirs(home);
            assert_eq!(dirs[0], home.join("Library/Application Support/Slack"));
            assert!(dirs.iter().any(|d| d.ends_with(
                "Library/Containers/com.tinyspeck.slackmacgap/Data/Library/Application Support/Slack"
            )));
        }
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
        if pw.is_empty() {
            Err(ExtractError::CookieUnavailable)
        } else {
            Ok(pw)
        }
    }

    pub async fn extract() -> Result<ExtractedCreds, ExtractError> {
        let dir = slack_dir()?;

        // xoxc: scan every leveldb .ldb/.log under Local Storage.
        let xoxc = scan_dir_for_xoxc(&dir).await?;

        // xoxd: decrypt the d cookie.
        let encrypted = read_d_cookie_blob(&dir.join("Cookies")).await?;
        let password = tokio::task::spawn_blocking(safe_storage_password)
            .await
            .map_err(|_| ExtractError::CookieUnavailable)??;
        let key = derive_key(password.as_bytes());
        let xoxd = decrypt_cookie(&encrypted, &key)?;

        Ok(ExtractedCreds {
            xoxc,
            xoxd,
            workspace_hint: None,
        })
    }
}

#[cfg(target_os = "macos")]
pub async fn extract_credentials() -> Result<ExtractedCreds, ExtractError> {
    macos::extract().await
}

#[cfg(target_os = "linux")]
mod linux {
    use super::*;

    /// Candidate Slack data dirs, checked in order: a direct `.deb` install, the
    /// confined snap (Ubuntu's App Center default), then a flatpak.
    fn slack_dirs(home: &std::path::Path) -> Vec<std::path::PathBuf> {
        vec![
            home.join(".config/Slack"),
            home.join("snap/slack/current/.config/Slack"),
            home.join("snap/slack/common/.config/Slack"),
            home.join(".var/app/com.slack.Slack/config/Slack"),
        ]
    }

    fn slack_dir() -> Result<std::path::PathBuf, ExtractError> {
        let home = std::env::var("HOME").map_err(|_| ExtractError::NotInstalled)?;
        slack_dirs(std::path::Path::new(&home))
            .into_iter()
            .find(|d| d.is_dir())
            .ok_or(ExtractError::NotInstalled)
    }

    /// Chromium "Slack Safe Storage" password from the Secret Service (used only
    /// for `v11` cookies), looked up via libsecret's `secret-tool`. Runs in
    /// spawn_blocking. A missing `secret-tool` or entry yields CookieUnavailable.
    fn safe_storage_password() -> Result<String, ExtractError> {
        let out = std::process::Command::new("secret-tool")
            .args(["lookup", "application", "Slack"])
            .output()
            .map_err(|_| ExtractError::CookieUnavailable)?;
        if !out.status.success() {
            return Err(ExtractError::CookieUnavailable);
        }
        let pw = String::from_utf8_lossy(&out.stdout)
            .trim_end_matches('\n')
            .to_string();
        if pw.is_empty() {
            Err(ExtractError::CookieUnavailable)
        } else {
            Ok(pw)
        }
    }

    pub async fn extract() -> Result<ExtractedCreds, ExtractError> {
        let dir = slack_dir()?;
        let xoxc = scan_dir_for_xoxc(&dir).await?;

        // xoxd: on Linux the key depends on the cookie's version prefix —
        // `v10` uses the hardcoded "peanuts" password (basic store), `v11` uses
        // the keyring password. Both derive with PBKDF2 iterations = 1.
        let encrypted = read_d_cookie_blob(&dir.join("Cookies")).await?;
        let key = if encrypted.len() < 3 {
            return Err(ExtractError::CookieUnavailable);
        } else if &encrypted[..3] == b"v10" {
            derive_key_iters(b"peanuts", 1)
        } else if &encrypted[..3] == b"v11" {
            let pw = tokio::task::spawn_blocking(safe_storage_password)
                .await
                .map_err(|_| ExtractError::CookieUnavailable)??;
            derive_key_iters(pw.as_bytes(), 1)
        } else {
            return Err(ExtractError::CookieUnavailable);
        };
        let xoxd = decrypt_cookie(&encrypted, &key)?;

        Ok(ExtractedCreds {
            xoxc,
            xoxd,
            workspace_hint: None,
        })
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn slack_dirs_cover_deb_snap_and_flatpak() {
            let home = std::path::Path::new("/home/x");
            let dirs = slack_dirs(home);
            assert_eq!(dirs[0], home.join(".config/Slack"));
            assert!(dirs
                .iter()
                .any(|d| d.ends_with("snap/slack/current/.config/Slack")));
            assert!(dirs
                .iter()
                .any(|d| d.ends_with(".var/app/com.slack.Slack/config/Slack")));
        }
    }
}

#[cfg(target_os = "linux")]
pub async fn extract_credentials() -> Result<ExtractedCreds, ExtractError> {
    linux::extract().await
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
    fn scan_returns_the_longest_xoxc_match() {
        // leveldb keeps stale short `xoxc-` fragments alongside the real (long)
        // session token. We must return the long one, not whichever the regex
        // hits first — even when the fragment appears earlier in the buffer.
        let real = "xoxc-this-is-the-real-and-much-longer-session-token-value";
        let blob = format!("junk xoxc-short-frag then {real} here");
        assert_eq!(scan_xoxc(blob.as_bytes()).as_deref(), Some(real));
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[tokio::test]
    async fn scan_dir_picks_longest_token_across_files() {
        // The fragment lives in one file, the real token in another — the scan
        // must read every file and return the longest, not stop at the first hit.
        let dir = tempfile::tempdir().unwrap();
        let ls = dir.path().join("Local Storage/leveldb");
        tokio::fs::create_dir_all(&ls).await.unwrap();
        let real = "xoxc-aaaaaaaaaa-bbbbbbbbbb-cccccccccc-dddddddddd-session";
        tokio::fs::write(ls.join("000001.ldb"), b"..xoxc-shortfrag..")
            .await
            .unwrap();
        tokio::fs::write(ls.join("000002.log"), format!("..{real}..").as_bytes())
            .await
            .unwrap();
        assert!(real.len() >= MIN_XOXC_LEN);
        assert_eq!(scan_dir_for_xoxc(dir.path()).await.unwrap(), real);
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    #[tokio::test]
    async fn scan_dir_rejects_when_only_short_fragments_present() {
        // A leveldb holding only stale fragments must yield TokenUnavailable,
        // never a too-short junk token that auth.test would reject anyway.
        let dir = tempfile::tempdir().unwrap();
        let ls = dir.path().join("Local Storage/leveldb");
        tokio::fs::create_dir_all(&ls).await.unwrap();
        tokio::fs::write(ls.join("000001.ldb"), b"..xoxc-tooshort..")
            .await
            .unwrap();
        assert!(matches!(
            scan_dir_for_xoxc(dir.path()).await,
            Err(ExtractError::TokenUnavailable)
        ));
    }

    #[test]
    fn decrypt_round_trips_a_v10_cookie() {
        // Encrypt "xoxd-secret" with the same scheme decrypt_cookie expects.
        let key = derive_key(b"Slack Safe Storage");
        let iv = [0x20u8; 16];
        type Enc = cbc::Encryptor<aes::Aes128>;
        let ct = Enc::new(&key.into(), &iv.into()).encrypt_padded_vec_mut::<Pkcs7>(b"xoxd-secret");
        let mut encrypted = b"v10".to_vec();
        encrypted.extend_from_slice(&ct);
        assert_eq!(decrypt_cookie(&encrypted, &key).unwrap(), "xoxd-secret");
    }

    #[test]
    fn decrypt_round_trips_a_linux_v10_peanuts_cookie() {
        // Linux basic-store cookie: PBKDF2 iters=1 over the hardcoded "peanuts".
        let key = derive_key_iters(b"peanuts", 1);
        let iv = [0x20u8; 16];
        type Enc = cbc::Encryptor<aes::Aes128>;
        let ct =
            Enc::new(&key.into(), &iv.into()).encrypt_padded_vec_mut::<Pkcs7>(b"xoxd-linux-secret");
        let mut encrypted = b"v10".to_vec();
        encrypted.extend_from_slice(&ct);
        assert_eq!(
            decrypt_cookie(&encrypted, &key).unwrap(),
            "xoxd-linux-secret"
        );
    }

    #[test]
    fn decrypt_rejects_short_input() {
        assert!(matches!(
            decrypt_cookie(b"v1", &[0u8; 16]),
            Err(ExtractError::CookieUnavailable)
        ));
    }

    #[test]
    fn decrypt_rejects_unknown_prefix() {
        // 3-byte unknown prefix + 16 bytes of padding — long enough to pass the
        // length check but must fail the version guard before touching AES.
        let mut blob = b"v99".to_vec();
        blob.extend_from_slice(&[0u8; 16]);
        assert!(matches!(
            decrypt_cookie(&blob, &[0u8; 16]),
            Err(ExtractError::CookieUnavailable)
        ));
    }

    #[tokio::test]
    async fn reads_encrypted_d_cookie_from_a_fixture_db() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("Cookies");
        let pool = sqlx::SqlitePool::connect(&format!("sqlite://{}?mode=rwc", db.display()))
            .await
            .unwrap();
        sqlx::query("CREATE TABLE cookies (name TEXT, encrypted_value BLOB)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO cookies (name, encrypted_value) VALUES ('d', ?1)")
            .bind(vec![1u8, 2, 3, 4])
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
        assert_eq!(read_d_cookie_blob(&db).await.unwrap(), vec![1u8, 2, 3, 4]);
    }

    #[tokio::test]
    async fn read_d_cookie_missing_is_cookie_unavailable() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("Cookies");
        let pool = sqlx::SqlitePool::connect(&format!("sqlite://{}?mode=rwc", db.display()))
            .await
            .unwrap();
        sqlx::query("CREATE TABLE cookies (name TEXT, encrypted_value BLOB)")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
        assert!(matches!(
            read_d_cookie_blob(&db).await,
            Err(ExtractError::CookieUnavailable)
        ));
    }
}
