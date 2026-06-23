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
}
