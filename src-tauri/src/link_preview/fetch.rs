use base64::Engine;
use crate::link_preview::addr::is_public_ip;
use crate::link_preview::meta::extract_metadata;
use crate::link_preview::url::validate_preview_url;
use crate::link_preview::{LinkPreview, PreviewError};
use std::net::SocketAddr;
use std::time::Duration;

/// Cap on the HTML body we read before parsing metadata.
pub const MAX_HTML_BYTES: usize = 512 * 1024;
/// Cap on a preview image before encoding it as a data URL.
pub const MAX_PREVIEW_IMAGE_BYTES: usize = 2 * 1024 * 1024;
/// Manual redirect limit (each hop is re-validated).
pub const MAX_REDIRECTS: usize = 5;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(8);

/// Return the first globally-routable socket address, or None if every
/// resolved address is non-public (SSRF block).
pub fn validate_resolved_addrs(addrs: &[SocketAddr]) -> Option<SocketAddr> {
    addrs.iter().copied().find(|a| is_public_ip(a.ip()))
}

/// Fetch and sanitize a link preview for an untrusted URL. Resolves the host,
/// blocks non-public addresses, pins the validated IP at connect time
/// (rebinding defense), follows redirects manually re-validating each hop,
/// caps bytes/timeouts, requires an HTML content-type, and returns metadata
/// with any image as a bounded data URL. Never returns page markup.
pub async fn fetch_link_preview(requested: &str) -> Result<LinkPreview, PreviewError> {
    let mut current = validate_preview_url(requested)?;

    for _ in 0..MAX_REDIRECTS {
        let addr = resolve_public_addr(&current).await?;
        let client = pinned_client(&current, addr)?;

        let resp = client
            .get(current.clone())
            .header(reqwest::header::ACCEPT, "text/html,application/xhtml+xml")
            .send()
            .await
            .map_err(|_| PreviewError::Network)?;

        let status = resp.status();
        if status.is_redirection() {
            let location = resp
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or(PreviewError::Unsupported)?;
            // Resolve relative redirects against the current URL, then re-validate.
            current = current.join(location).map_err(|_| PreviewError::Unsupported)?;
            current = validate_preview_url(current.as_str())?;
            continue;
        }
        if !status.is_success() {
            return Err(PreviewError::Unsupported);
        }

        // Require HTML before reading a body for metadata.
        let mime = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        if !(mime == "text/html" || mime == "application/xhtml+xml" || mime == "application/xhtml") {
            return Err(PreviewError::Unsupported);
        }

        let html = read_capped(resp, MAX_HTML_BYTES).await?;
        let html = String::from_utf8_lossy(&html).into_owned();
        let resolved_url = current.clone();
        let meta = extract_metadata(&html, &resolved_url);

        let image_data_url = match &meta.image_url {
            Some(img) => fetch_image_data_url(img).await.ok(),
            None => None,
        };

        return Ok(LinkPreview {
            requested_url: requested.to_string(),
            resolved_url: meta
                .canonical_url
                .clone()
                .unwrap_or_else(|| resolved_url.to_string()),
            title: meta.title,
            description: meta.description,
            site_name: meta.site_name,
            image_data_url,
        });
    }

    Err(PreviewError::Network) // redirect budget exhausted
}

/// Resolve the URL's host:port and return one validated public socket address.
async fn resolve_public_addr(url: &reqwest::Url) -> Result<SocketAddr, PreviewError> {
    let host = url.host_str().ok_or(PreviewError::Unsupported)?.to_string();
    let port = url
        .port_or_known_default()
        .ok_or(PreviewError::Unsupported)?;
    let lookup = format!("{host}:{port}");
    let addrs = tokio::net::lookup_host(lookup)
        .await
        .map_err(|_| PreviewError::Network)?
        .collect::<Vec<_>>();
    validate_resolved_addrs(&addrs).ok_or(PreviewError::Network)
}

/// Build a one-shot client that connects ONLY to the pre-validated address for
/// this URL's host (DNS-rebinding defense) with redirects disabled.
fn pinned_client(url: &reqwest::Url, addr: SocketAddr) -> Result<reqwest::Client, PreviewError> {
    let host = url.host_str().ok_or(PreviewError::Unsupported)?;
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(TOTAL_TIMEOUT)
        .resolve(host, addr)
        .build()
        .map_err(|_| PreviewError::Internal)
}

/// Read a response body up to `cap` bytes, erroring if it exceeds the cap.
async fn read_capped(
    mut resp: reqwest::Response,
    cap: usize,
) -> Result<Vec<u8>, PreviewError> {
    if resp.content_length().is_some_and(|len| len > cap as u64) {
        return Err(PreviewError::TooLarge);
    }
    let mut buf = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(|_| PreviewError::Network)? {
        if buf.len() + chunk.len() > cap {
            return Err(PreviewError::TooLarge);
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(buf)
}

/// Fetch a preview image through the same address/redirect/size guards and
/// return it as a bounded `data:` URL, or error.
async fn fetch_image_data_url(img: &str) -> Result<String, PreviewError> {
    let mut current = validate_preview_url(img)?;
    for _ in 0..MAX_REDIRECTS {
        let addr = resolve_public_addr(&current).await?;
        let client = pinned_client(&current, addr)?;
        let resp = client
            .get(current.clone())
            .send()
            .await
            .map_err(|_| PreviewError::Network)?;
        let status = resp.status();
        if status.is_redirection() {
            let location = resp
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or(PreviewError::Unsupported)?;
            current = current.join(location).map_err(|_| PreviewError::Unsupported)?;
            current = validate_preview_url(current.as_str())?;
            continue;
        }
        if !status.is_success() {
            return Err(PreviewError::Unsupported);
        }
        let mime = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        if !matches!(
            mime.as_str(),
            "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/avif"
        ) {
            return Err(PreviewError::Unsupported);
        }
        let bytes = read_capped(resp, MAX_PREVIEW_IMAGE_BYTES).await?;
        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
        return Ok(format!("data:{mime};base64,{encoded}"));
    }
    Err(PreviewError::Network)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr};

    fn sa(ip: &str, port: u16) -> SocketAddr {
        SocketAddr::new(ip.parse::<IpAddr>().unwrap(), port)
    }

    #[test]
    fn picks_first_public_addr() {
        let addrs = [sa("10.0.0.1", 443), sa("93.184.216.34", 443)];
        assert_eq!(
            validate_resolved_addrs(&addrs),
            Some(sa("93.184.216.34", 443))
        );
    }

    #[test]
    fn all_private_is_blocked() {
        let addrs = [sa("127.0.0.1", 443), sa("10.0.0.1", 443)];
        assert_eq!(validate_resolved_addrs(&addrs), None);
        let _ = Ipv4Addr::LOCALHOST; // keep import used
    }
}
