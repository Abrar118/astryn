# Smart Embeds and Syntax-Highlighted Code Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add compact URL link-previews and read-only syntax-highlighted fenced code blocks to Astryn's Milkdown issue-description editor, persisting only standard Markdown and keeping the Tauri webview's security boundary intact.

**Architecture:** A new SSRF-hardened Rust command `fetch_link_preview` fetches and sanitizes page metadata (returning images only as bounded data URLs), cached in-memory with a TTL. The frontend renders previews via a predicate-driven Milkdown paragraph node view, highlights read-only code blocks with `lowlight`, and adds a context-sensitive preview/link toggle to the existing selection tooltip. Markdown stays canonical; previews and highlighting are presentation-only.

**Tech Stack:** Rust (Tauri v2, reqwest 0.12 rustls, `scraper` for HTML), React 19 + TypeScript (strict), Milkdown/ProseMirror (`@milkdown/kit` 7.21.2), `lowlight` for highlighting, Vitest + Testing Library.

## Global Constraints

- All external API/network calls live in Rust, never the webview. The frontend never fetches a remote URL directly.
- Preview metadata is **never** persisted in SQLite or added to issue descriptions; the only persisted form is standard Markdown.
- Preview images reach the webview **only as bounded data URLs**. No CSP change: `connect-src` stays `ipc: http://ipc.localhost`, `img-src` stays `'self' asset: http://asset.localhost data:`, `frame-src` stays `'none'` (`src-tauri/tauri.conf.json`).
- Tauri commands return sanitized `CmdError` strings — no raw reqwest/DNS/HTML diagnostics.
- The `fetch_link_preview` command is an untrusted-URL fetcher: accept only `http`/`https`; reject credentials in URLs; resolve hosts and block loopback/private/link-local/multicast/unspecified/other non-public IPv4 **and** IPv6 ranges; pin the validated resolved IP at connect time (DNS-rebinding defense); disable automatic redirects and follow manually, re-validating every hop under a small redirect limit; short connect/total timeouts; cap response bytes before parsing; reject non-HTML for metadata; cap field lengths and image bytes; never execute scripts or return page HTML.
- Code highlighting is **read-only only**. Edit-mode code blocks keep the existing editable `<pre><code>` (`<code>` as `contentDOM`); no highlight spans inside an editable `contentDOM`.
- Highlighted output is built from `lowlight` tokens rendered as React elements; raw code is never injected as untrusted HTML (no `dangerouslySetInnerHTML`).
- A `mermaid` fence keeps current behavior: diagram in read-only mode, editable source in edit mode. No regression to Mermaid or Markdown round-tripping.
- Highlighter: `lowlight` (frontend). HTML parsing: `scraper` (Rust). No other new runtime deps.
- TS config is strict with `noUnusedLocals`/`noUnusedParameters` — unused symbols fail the build.
- Time/date logic, where any arises, is computed in `Asia/Dhaka` (not relevant to this plan's logic, but do not introduce machine-locale date logic).
- Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

**Verification commands (run from repo root unless noted):**
- `npm test` → `vitest run --passWithNoTests`
- `npm run build` → `tsc && vite build`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `cargo clippy --manifest-path src-tauri/Cargo.toml`

---

## File Structure

**Backend (`src-tauri/src/`):**
- `link_preview/mod.rs` (new) — `LinkPreview` struct, module exports, orchestration glue.
- `link_preview/addr.rs` (new) — `is_public_ip` IP-range classifier (pure, heavily tested).
- `link_preview/url.rs` (new) — `validate_preview_url` (scheme/credentials/host shape, pure, tested).
- `link_preview/meta.rs` (new) — `extract_metadata` over an HTML string via `scraper`, with field-length caps (pure, tested).
- `link_preview/cache.rs` (new) — `PreviewCache` bounded TTL map with injected `now` (pure, tested).
- `link_preview/fetch.rs` (new) — the live network fetcher: resolve+pin, manual redirect loop, byte/timeout/content-type guards, optional image→data URL. Live path verified manually; decomposed helpers tested.
- `commands/mod.rs` (modify) — `fetch_link_preview` command + `fetch_link_preview_logic`; `AppState.link_preview_cache` field; `CmdError::PreviewUnavailable`.
- `lib.rs` (modify) — build the cache in `setup`, register the command.
- `Cargo.toml` (modify) — add `scraper`.

**Frontend (`src/features/drawer/`, `src/lib/`):**
- `src/lib/commands.ts` (modify) — `LinkPreview` type + `fetchLinkPreview(url)` binding.
- `src/features/drawer/urlPreview.ts` (new) — pure helpers: `parseHttpUrl`, `classifyUrlParagraph` (predicate over a minimal node shape), `hostLabel`. Tested.
- `src/features/drawer/milkdownCodeHighlight.ts` (new) — `lowlight` setup, `resolveLanguage` alias map, `highlightToReact`. Pure parts tested.
- `src/features/drawer/milkdownCodeBlock.tsx` (modify) — expand node view: read-only highlight + header + Copy; edit-mode header + language selector; preserve mermaid + default editable.
- `src/features/drawer/milkdownPreviewNode.tsx` (new) — paragraph node view rendering preview card / row / loading / fallback.
- `src/features/drawer/milkdownMenus.ts` (modify) — context-sensitive preview/link toggle in the tooltip.
- `src/features/drawer/milkdownEditor.ts` (modify) — register `descriptionPreviewView` in `descriptionPlugins`.
- `package.json` (modify) — add `lowlight`.

**Detection model (read before Tasks 7, 10, 11).** A bare URL that is a paragraph's sole content is the *preview* form; `[label](url)` is the *link* form (spec §Canonical). Because remark-gfm autolinks bare URL literals, a "bare" URL may load from Markdown as a `link`-marked text whose label equals its href. The predicate therefore treats a paragraph as a **preview** when its sole child is one text node whose trimmed content is a single http(s) URL **and** the text either has no `link` mark or has a `link` mark whose href equals that URL. It treats the paragraph as a **labeled link** (toggle target) when the sole child is one `link`-marked text whose href differs from its visible text. "Display as link" rewrites a preview to a labeled link using the URL's **host** as the label (host ≠ href, so it is unambiguously a link and matches the spec's `[github.com](https://github.com/)` example). "Display as preview" strips the mark, leaving the bare href as text.

---

## Task 1: IP-range classifier (`is_public_ip`)

**Files:**
- Create: `src-tauri/src/link_preview/addr.rs`
- Create: `src-tauri/src/link_preview/mod.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod link_preview;`)

**Interfaces:**
- Produces: `pub fn is_public_ip(ip: std::net::IpAddr) -> bool` — true only for globally-routable unicast addresses. Used by Task 5's fetcher.

- [ ] **Step 1: Declare the module**

In `src-tauri/src/lib.rs`, add alongside the other top-level `mod` declarations (near `mod commands;`):

```rust
mod link_preview;
```

In a new file `src-tauri/src/link_preview/mod.rs`:

```rust
pub mod addr;
```

- [ ] **Step 2: Write the failing test**

Create `src-tauri/src/link_preview/addr.rs`:

```rust
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

#[cfg(test)]
mod tests {
    use super::*;

    fn v4(s: &str) -> IpAddr {
        IpAddr::V4(s.parse::<Ipv4Addr>().unwrap())
    }
    fn v6(s: &str) -> IpAddr {
        IpAddr::V6(s.parse::<Ipv6Addr>().unwrap())
    }

    #[test]
    fn public_v4_is_allowed() {
        assert!(is_public_ip(v4("93.184.216.34"))); // example.com
        assert!(is_public_ip(v4("8.8.8.8")));
    }

    #[test]
    fn private_and_special_v4_blocked() {
        for s in [
            "127.0.0.1",      // loopback
            "10.0.0.1",       // private
            "172.16.0.1",     // private
            "192.168.1.1",    // private
            "169.254.0.1",    // link-local
            "0.0.0.0",        // unspecified
            "100.64.0.1",     // CGNAT (shared)
            "224.0.0.1",      // multicast
            "255.255.255.255",// broadcast
        ] {
            assert!(!is_public_ip(v4(s)), "{s} should be blocked");
        }
    }

    #[test]
    fn public_v6_is_allowed() {
        assert!(is_public_ip(v6("2606:2800:220:1:248:1893:25c8:1946")));
    }

    #[test]
    fn private_and_special_v6_blocked() {
        for s in [
            "::1",                 // loopback
            "::",                  // unspecified
            "fe80::1",             // link-local
            "fc00::1",             // unique-local
            "fd00::1",             // unique-local
            "ff02::1",             // multicast
            "::ffff:127.0.0.1",    // v4-mapped loopback
            "::ffff:10.0.0.1",     // v4-mapped private
        ] {
            assert!(!is_public_ip(v6(s)), "{s} should be blocked");
        }
    }
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml is_public_ip`
Expected: FAIL — `cannot find function is_public_ip`.

- [ ] **Step 4: Implement `is_public_ip`**

Add above the `#[cfg(test)]` block in `addr.rs`:

```rust
/// Returns true only for globally-routable unicast addresses. Everything else
/// — loopback, private, link-local, multicast, unspecified, CGNAT, broadcast,
/// documentation, v4-mapped/translated v6 — is treated as non-public so the
/// preview fetcher refuses to connect to it (SSRF defense).
pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => {
            // Unwrap v4-mapped (::ffff:a.b.c.d) and v4-translated (64:ff9b::/96)
            // so an attacker can't smuggle a private v4 through a v6 literal.
            if let Some(mapped) = v6.to_ipv4_mapped() {
                return is_public_v4(mapped);
            }
            is_public_v6(v6)
        }
    }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    !(ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_multicast()
        || ip.is_documentation()      // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24
        || o[0] == 0                  // 0.0.0.0/8
        || (o[0] == 100 && (o[1] & 0xc0) == 64)  // 100.64.0.0/10 CGNAT
        || (o[0] == 192 && o[1] == 0 && o[2] == 0) // 192.0.0.0/24 IETF
        || (o[0] & 0xf0) == 240)      // 240.0.0.0/4 reserved
}

fn is_public_v6(ip: Ipv6Addr) -> bool {
    let seg = ip.segments();
    !(ip.is_loopback()
        || ip.is_unspecified()
        || ip.is_multicast()
        || (seg[0] & 0xfe00) == 0xfc00  // fc00::/7 unique-local
        || (seg[0] & 0xffc0) == 0xfe80  // fe80::/10 link-local
        || (seg[0] == 0x2001 && seg[1] == 0x0db8) // 2001:db8::/32 documentation
        || (seg[0] == 0x0064 && seg[1] == 0xff9b)) // 64:ff9b::/96 v4-translated
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml is_public_ip`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/link_preview/ src-tauri/src/lib.rs
git commit -m "feat(preview): public-IP classifier for SSRF defense

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Preview URL validation

**Files:**
- Create: `src-tauri/src/link_preview/url.rs`
- Modify: `src-tauri/src/link_preview/mod.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: `pub fn validate_preview_url(value: &str) -> Result<reqwest::Url, PreviewError>` and `pub enum PreviewError { Unsupported, NotFound, TooLarge, Network, Internal }`. `PreviewError` is the module's internal error; Task 6 maps it to `CmdError`.

- [ ] **Step 1: Export the module and error**

In `src-tauri/src/link_preview/mod.rs`, add:

```rust
pub mod addr;
pub mod url;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreviewError {
    /// Scheme/credential/host rejected, non-HTML, or no usable metadata.
    Unsupported,
    /// DNS/connect/read failure or blocked address.
    Network,
    /// Response exceeded a byte cap.
    TooLarge,
    /// Unexpected internal failure (e.g. runtime join error).
    Internal,
}
```

- [ ] **Step 2: Write the failing test**

Create `src-tauri/src/link_preview/url.rs`:

```rust
use crate::link_preview::PreviewError;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_plain_https() {
        let u = validate_preview_url("https://example.com/path?q=1").unwrap();
        assert_eq!(u.host_str(), Some("example.com"));
    }

    #[test]
    fn accepts_http_and_explicit_port() {
        assert!(validate_preview_url("http://example.com:8080/").is_ok());
    }

    #[test]
    fn rejects_non_http_schemes() {
        for s in ["ftp://example.com", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,x"] {
            assert_eq!(validate_preview_url(s), Err(PreviewError::Unsupported), "{s}");
        }
    }

    #[test]
    fn rejects_credentials_in_url() {
        assert_eq!(
            validate_preview_url("https://user:pass@example.com/"),
            Err(PreviewError::Unsupported)
        );
        assert_eq!(
            validate_preview_url("https://user@example.com/"),
            Err(PreviewError::Unsupported)
        );
    }

    #[test]
    fn rejects_missing_host_and_garbage() {
        assert_eq!(validate_preview_url("https:///nohost"), Err(PreviewError::Unsupported));
        assert_eq!(validate_preview_url("not a url"), Err(PreviewError::Unsupported));
    }
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml validate_preview_url`
Expected: FAIL — `cannot find function validate_preview_url`.

- [ ] **Step 4: Implement**

Add above the test module in `url.rs`:

```rust
/// Validate an untrusted preview URL's static shape (scheme, credentials,
/// host present). Address-range checks happen later, after DNS resolution,
/// in the fetcher. Returns the parsed `reqwest::Url` on success.
pub fn validate_preview_url(value: &str) -> Result<reqwest::Url, PreviewError> {
    let url = reqwest::Url::parse(value).map_err(|_| PreviewError::Unsupported)?;
    let scheme = url.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(PreviewError::Unsupported);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(PreviewError::Unsupported);
    }
    if url.host_str().is_none() {
        return Err(PreviewError::Unsupported);
    }
    Ok(url)
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml validate_preview_url`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/link_preview/
git commit -m "feat(preview): validate untrusted preview URL shape

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: HTML metadata extraction

**Files:**
- Create: `src-tauri/src/link_preview/meta.rs`
- Modify: `src-tauri/src/link_preview/mod.rs` (export module + `Metadata` struct)
- Modify: `src-tauri/Cargo.toml` (add `scraper`)

**Interfaces:**
- Consumes: nothing.
- Produces: `pub struct Metadata { pub title: Option<String>, pub description: Option<String>, pub site_name: Option<String>, pub image_url: Option<String>, pub canonical_url: Option<String> }` and `pub fn extract_metadata(html: &str, base: &reqwest::Url) -> Metadata`. Field strings are length-capped. `image_url`/`canonical_url` are resolved to absolute against `base`. Used by Task 5.

- [ ] **Step 1: Add the `scraper` dependency**

In `src-tauri/Cargo.toml`, under `[dependencies]` (after the `base64` line):

```toml
scraper = "0.21"
```

Run `cargo build --manifest-path src-tauri/Cargo.toml` once to fetch it (expected: compiles).

- [ ] **Step 2: Export the struct**

In `src-tauri/src/link_preview/mod.rs`, add `pub mod meta;` and:

```rust
/// Field-length cap for extracted text metadata (chars). Bounds payload size
/// and keeps a single preview from carrying an unreasonable string.
pub const MAX_META_FIELD: usize = 500;

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Metadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub site_name: Option<String>,
    pub image_url: Option<String>,
    pub canonical_url: Option<String>,
}
```

- [ ] **Step 3: Write the failing test**

Create `src-tauri/src/link_preview/meta.rs`:

```rust
use crate::link_preview::{Metadata, MAX_META_FIELD};
use scraper::{Html, Selector};

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> reqwest::Url {
        reqwest::Url::parse("https://example.com/page").unwrap()
    }

    #[test]
    fn prefers_open_graph() {
        let html = r#"<html><head>
            <title>Plain Title</title>
            <meta property="og:title" content="OG Title">
            <meta property="og:description" content="OG Desc">
            <meta property="og:site_name" content="Example">
            <meta property="og:image" content="/img/cover.png">
        </head><body>x</body></html>"#;
        let m = extract_metadata(html, &base());
        assert_eq!(m.title.as_deref(), Some("OG Title"));
        assert_eq!(m.description.as_deref(), Some("OG Desc"));
        assert_eq!(m.site_name.as_deref(), Some("Example"));
        assert_eq!(m.image_url.as_deref(), Some("https://example.com/img/cover.png"));
    }

    #[test]
    fn falls_back_to_title_and_meta_description() {
        let html = r#"<html><head>
            <title>Plain Title</title>
            <meta name="description" content="Meta Desc">
            <link rel="canonical" href="https://example.com/canon">
        </head></html>"#;
        let m = extract_metadata(html, &base());
        assert_eq!(m.title.as_deref(), Some("Plain Title"));
        assert_eq!(m.description.as_deref(), Some("Meta Desc"));
        assert_eq!(m.canonical_url.as_deref(), Some("https://example.com/canon"));
        assert_eq!(m.image_url, None);
    }

    #[test]
    fn missing_metadata_yields_empty() {
        let m = extract_metadata("<html><head></head><body>nothing</body></html>", &base());
        assert_eq!(m, Metadata::default());
    }

    #[test]
    fn malformed_html_does_not_panic() {
        let _ = extract_metadata("<html><head><title>Unclosed", &base());
        let _ = extract_metadata("<<<>>> not really html", &base());
    }

    #[test]
    fn caps_field_length() {
        let long = "a".repeat(MAX_META_FIELD + 50);
        let html = format!("<html><head><title>{long}</title></head></html>");
        let m = extract_metadata(&html, &base());
        assert_eq!(m.title.unwrap().chars().count(), MAX_META_FIELD);
    }
}
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml extract_metadata`
Expected: FAIL — `cannot find function extract_metadata`.

- [ ] **Step 5: Implement**

Add above the test module in `meta.rs`:

```rust
/// Extract sanitized preview metadata from an HTML string. Open Graph wins
/// over plain `<title>` / `<meta name="description">`. Relative `og:image` and
/// canonical URLs are resolved against `base`. All text fields are trimmed and
/// capped at `MAX_META_FIELD` chars. Never returns or executes page markup.
pub fn extract_metadata(html: &str, base: &reqwest::Url) -> Metadata {
    let doc = Html::parse_document(html);

    let meta_content = |attr: &str, value: &str| -> Option<String> {
        let sel = Selector::parse(&format!(r#"meta[{attr}="{value}"]"#)).ok()?;
        doc.select(&sel)
            .find_map(|el| el.value().attr("content"))
            .map(cap_field)
            .filter(|s| !s.is_empty())
    };

    let title = meta_content("property", "og:title").or_else(|| {
        let sel = Selector::parse("title").ok()?;
        doc.select(&sel)
            .next()
            .map(|el| cap_field(&el.text().collect::<String>()))
            .filter(|s| !s.is_empty())
    });

    let description = meta_content("property", "og:description")
        .or_else(|| meta_content("name", "description"));

    let site_name = meta_content("property", "og:site_name");

    let resolve = |raw: &str| -> Option<String> {
        let abs = base.join(raw.trim()).ok()?;
        if abs.scheme() == "http" || abs.scheme() == "https" {
            Some(cap_field(abs.as_str()))
        } else {
            None
        }
    };

    let image_url = {
        let sel = Selector::parse(r#"meta[property="og:image"]"#).ok();
        sel.and_then(|s| {
            doc.select(&s)
                .find_map(|el| el.value().attr("content"))
                .and_then(resolve)
        })
    };

    let canonical_url = {
        let sel = Selector::parse(r#"link[rel="canonical"]"#).ok();
        sel.and_then(|s| {
            doc.select(&s)
                .find_map(|el| el.value().attr("href"))
                .and_then(resolve)
        })
    };

    Metadata {
        title,
        description,
        site_name,
        image_url,
        canonical_url,
    }
}

/// Collapse internal whitespace, trim, and cap to `MAX_META_FIELD` chars.
fn cap_field(raw: &str) -> String {
    let collapsed = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.chars().take(MAX_META_FIELD).collect()
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml extract_metadata`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/link_preview/ src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(preview): sanitized HTML metadata extraction

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Bounded TTL preview cache

**Files:**
- Create: `src-tauri/src/link_preview/cache.rs`
- Modify: `src-tauri/src/link_preview/mod.rs` (export module + `LinkPreview` struct)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `pub struct LinkPreview { pub requested_url: String, pub resolved_url: String, pub title: Option<String>, pub description: Option<String>, pub site_name: Option<String>, pub image_data_url: Option<String> }` (`Clone`, `serde::Serialize` camelCase).
  - `pub struct PreviewCache` with `pub fn new(capacity: usize, ttl: std::time::Duration) -> Self`, `pub fn get(&mut self, key: &str, now: std::time::Instant) -> Option<LinkPreview>`, `pub fn put(&mut self, key: String, value: LinkPreview, now: std::time::Instant)`. Used by Task 6.

- [ ] **Step 1: Export struct + module**

In `src-tauri/src/link_preview/mod.rs`, add `pub mod cache;` and:

```rust
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkPreview {
    pub requested_url: String,
    pub resolved_url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub site_name: Option<String>,
    pub image_data_url: Option<String>,
}
```

- [ ] **Step 2: Write the failing test**

Create `src-tauri/src/link_preview/cache.rs`:

```rust
use crate::link_preview::LinkPreview;
use std::collections::HashMap;
use std::time::{Duration, Instant};

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(url: &str) -> LinkPreview {
        LinkPreview {
            requested_url: url.into(),
            resolved_url: url.into(),
            title: Some("t".into()),
            description: None,
            site_name: None,
            image_data_url: None,
        }
    }

    #[test]
    fn returns_fresh_entry() {
        let t0 = Instant::now();
        let mut c = PreviewCache::new(4, Duration::from_secs(60));
        c.put("k".into(), sample("k"), t0);
        assert!(c.get("k", t0 + Duration::from_secs(10)).is_some());
    }

    #[test]
    fn expires_after_ttl() {
        let t0 = Instant::now();
        let mut c = PreviewCache::new(4, Duration::from_secs(60));
        c.put("k".into(), sample("k"), t0);
        assert!(c.get("k", t0 + Duration::from_secs(61)).is_none());
    }

    #[test]
    fn evicts_oldest_over_capacity() {
        let t0 = Instant::now();
        let mut c = PreviewCache::new(2, Duration::from_secs(60));
        c.put("a".into(), sample("a"), t0);
        c.put("b".into(), sample("b"), t0 + Duration::from_secs(1));
        c.put("c".into(), sample("c"), t0 + Duration::from_secs(2)); // evicts "a"
        let now = t0 + Duration::from_secs(3);
        assert!(c.get("a", now).is_none());
        assert!(c.get("b", now).is_some());
        assert!(c.get("c", now).is_some());
    }

    #[test]
    fn miss_returns_none() {
        let mut c = PreviewCache::new(2, Duration::from_secs(60));
        assert!(c.get("absent", Instant::now()).is_none());
    }
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml preview_cache`
Expected: FAIL — `cannot find type PreviewCache` (run with the module path: `cargo test --manifest-path src-tauri/Cargo.toml cache::tests`).

- [ ] **Step 4: Implement**

Add above the test module in `cache.rs`:

```rust
/// A small bounded, TTL'd in-memory cache for link previews. `now` is injected
/// so the logic is deterministic under test. Eviction is insertion-order
/// (oldest inserted dropped first) once `capacity` is exceeded. This is the
/// only in-memory cache in the app; preview metadata is never persisted.
pub struct PreviewCache {
    capacity: usize,
    ttl: Duration,
    /// key -> (inserted_at, value). Insertion order tracked separately.
    entries: HashMap<String, (Instant, LinkPreview)>,
    order: Vec<String>,
}

impl PreviewCache {
    pub fn new(capacity: usize, ttl: Duration) -> Self {
        Self {
            capacity: capacity.max(1),
            ttl,
            entries: HashMap::new(),
            order: Vec::new(),
        }
    }

    pub fn get(&mut self, key: &str, now: Instant) -> Option<LinkPreview> {
        let fresh = match self.entries.get(key) {
            Some((inserted, value)) if now.duration_since(*inserted) < self.ttl => {
                Some(value.clone())
            }
            Some(_) => None, // expired
            None => return None,
        };
        if fresh.is_none() {
            self.remove(key);
        }
        fresh
    }

    pub fn put(&mut self, key: String, value: LinkPreview, now: Instant) {
        if self.entries.contains_key(&key) {
            self.order.retain(|k| k != &key);
        }
        self.entries.insert(key.clone(), (now, value));
        self.order.push(key);
        while self.order.len() > self.capacity {
            let oldest = self.order.remove(0);
            self.entries.remove(&oldest);
        }
    }

    fn remove(&mut self, key: &str) {
        self.entries.remove(key);
        self.order.retain(|k| k != key);
    }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml cache::tests`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/link_preview/
git commit -m "feat(preview): bounded TTL in-memory preview cache

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: SSRF-hardened fetcher

**Files:**
- Create: `src-tauri/src/link_preview/fetch.rs`
- Modify: `src-tauri/src/link_preview/mod.rs` (export module)

**Interfaces:**
- Consumes: `is_public_ip` (Task 1), `validate_preview_url` (Task 2), `extract_metadata`/`Metadata` (Task 3), `LinkPreview`/`PreviewError` (Tasks 2/4).
- Produces:
  - `pub async fn fetch_link_preview(requested: &str) -> Result<LinkPreview, PreviewError>` — the full live fetch (resolve+pin, manual redirects, caps, optional image). Not unit-tested (live network); used by Task 6.
  - `pub fn validate_resolved_addrs(addrs: &[std::net::SocketAddr]) -> Option<std::net::SocketAddr>` — first public addr or None. Unit-tested.
  - `pub const MAX_HTML_BYTES: usize`, `pub const MAX_PREVIEW_IMAGE_BYTES: usize`, `pub const MAX_REDIRECTS: usize`.

- [ ] **Step 1: Export module + constants**

In `src-tauri/src/link_preview/mod.rs`, add `pub mod fetch;`.

Create `src-tauri/src/link_preview/fetch.rs`:

```rust
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml validate_resolved_addrs`
Expected: FAIL — `cannot find function validate_resolved_addrs`.

- [ ] **Step 3: Implement the fetcher**

Add above the test module in `fetch.rs`:

```rust
/// Fetch and sanitize a link preview for an untrusted URL. Resolves the host,
/// blocks non-public addresses, pins the validated IP at connect time
/// (rebinding defense), follows redirects manually re-validating each hop,
/// caps bytes/timeouts, requires an HTML content-type, and returns metadata
/// with any image as a bounded data URL. Never returns page markup.
pub async fn fetch_link_preview(requested: &str) -> Result<LinkPreview, PreviewError> {
    let mut current = validate_preview_url(requested)?;

    for _ in 0..=MAX_REDIRECTS {
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
        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_ascii_lowercase();
        if !(content_type.contains("text/html") || content_type.contains("application/xhtml")) {
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
    for _ in 0..=MAX_REDIRECTS {
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
```

Add the import for the base64 engine at the top of `fetch.rs`:

```rust
use base64::Engine;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml validate_resolved_addrs`
Expected: PASS (2 tests). Also run `cargo build --manifest-path src-tauri/Cargo.toml` (expected: compiles; `reqwest`'s `resolve`/`chunk` are available with current features).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/link_preview/
git commit -m "feat(preview): SSRF-hardened link fetcher (pin IP, manual redirects)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: `fetch_link_preview` command + state wiring

**Files:**
- Modify: `src-tauri/src/commands/mod.rs` (command, logic fn, `CmdError::PreviewUnavailable`, `AppState` field)
- Modify: `src-tauri/src/lib.rs` (build cache in `setup`, register command)

**Interfaces:**
- Consumes: `fetch_link_preview` (Task 5), `PreviewCache`/`LinkPreview`/`PreviewError` (Tasks 4/2).
- Produces: `#[tauri::command] pub async fn fetch_link_preview(state, url: String) -> Result<LinkPreview, CmdError>` registered in the handler; `AppState.link_preview_cache: tokio::sync::Mutex<PreviewCache>`.

- [ ] **Step 1: Add the error variant + state field**

In `src-tauri/src/commands/mod.rs`, add to `CmdError` (after `ImageUnavailable`):

```rust
    #[error("Preview unavailable.")]
    PreviewUnavailable,
```

Add a `From<PreviewError>` mapping near the other `From` impls:

```rust
impl From<crate::link_preview::PreviewError> for CmdError {
    fn from(_: crate::link_preview::PreviewError) -> Self {
        CmdError::PreviewUnavailable
    }
}
```

Add the cache field to `AppState` (after `rate_limited_until`):

```rust
    /// In-memory bounded TTL cache for link previews (never persisted).
    pub link_preview_cache: tokio::sync::Mutex<crate::link_preview::cache::PreviewCache>,
```

- [ ] **Step 2: Add the command + logic fn**

In `src-tauri/src/commands/mod.rs`, near `load_linear_image`, add:

```rust
/// Coalesce + cache wrapper around the live fetcher. Holds the cache lock only
/// around get/put; the network fetch runs without the lock held. A second
/// request for the same URL after the first completes is served from cache.
pub async fn fetch_link_preview_logic(
    cache: &tokio::sync::Mutex<crate::link_preview::cache::PreviewCache>,
    url: String,
) -> Result<crate::link_preview::LinkPreview, CmdError> {
    let now = std::time::Instant::now();
    if let Some(hit) = cache.lock().await.get(&url, now) {
        return Ok(hit);
    }
    let preview = crate::link_preview::fetch::fetch_link_preview(&url).await?;
    cache
        .lock()
        .await
        .put(url, preview.clone(), std::time::Instant::now());
    Ok(preview)
}

#[tauri::command]
pub async fn fetch_link_preview(
    state: State<'_, AppState>,
    url: String,
) -> Result<crate::link_preview::LinkPreview, CmdError> {
    fetch_link_preview_logic(&state.link_preview_cache, url).await
}
```

- [ ] **Step 3: Build the cache in setup + register the command**

In `src-tauri/src/lib.rs`, in the `setup` closure where `AppState` is constructed, add the field (after `rate_limited_until: ...`):

```rust
                link_preview_cache: tokio::sync::Mutex::new(
                    crate::link_preview::cache::PreviewCache::new(
                        128,
                        std::time::Duration::from_secs(600),
                    ),
                ),
```

In the `tauri::generate_handler![...]` list, add (after `commands::load_linear_image,`):

```rust
            commands::fetch_link_preview,
```

- [ ] **Step 4: Build + verify the backend compiles and all Rust tests pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS — existing suite plus Tasks 1–5 tests, no failures.

Run: `cargo clippy --manifest-path src-tauri/Cargo.toml`
Expected: no new warnings.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(preview): fetch_link_preview command with cached coalescing

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Frontend binding + URL/predicate helpers

**Files:**
- Modify: `src/lib/commands.ts` (`LinkPreview` type + `fetchLinkPreview`)
- Create: `src/features/drawer/urlPreview.ts`
- Test: `src/features/drawer/urlPreview.test.ts`

**Interfaces:**
- Produces:
  - `LinkPreview` type (camelCase mirror of the Rust struct) + `fetchLinkPreview(url: string): Promise<LinkPreview>`.
  - `parseHttpUrl(text: string): URL | null` — trims, returns a `URL` only for a single http(s) token.
  - `hostLabel(url: string): string` — host without `www.`.
  - `UrlParaKind` + `classifyUrlParagraph(node: UrlParaNode): UrlParaKind` where `type UrlParaNode = { text: string; linkHref: string | null }` and `type UrlParaKind = "preview" | "link" | "none"`. Used by Tasks 10 and 11.

- [ ] **Step 1: Add the command binding**

In `src/lib/commands.ts`, append (after the `load_linear_image` binding or near the issue commands):

```ts
export type LinkPreview = {
  requestedUrl: string;
  resolvedUrl: string;
  title: string | null;
  description: string | null;
  siteName: string | null;
  imageDataUrl: string | null;
};

export const fetchLinkPreview = (url: string): Promise<LinkPreview> =>
  invoke("fetch_link_preview", { url });
```

- [ ] **Step 2: Write the failing test**

Create `src/features/drawer/urlPreview.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseHttpUrl, hostLabel, classifyUrlParagraph } from "./urlPreview";

describe("parseHttpUrl", () => {
  it("accepts a single http(s) URL", () => {
    expect(parseHttpUrl("https://example.com/x")?.href).toBe("https://example.com/x");
    expect(parseHttpUrl("  http://a.test/y  ")?.href).toBe("http://a.test/y");
  });
  it("rejects non-http, multi-token, and empty", () => {
    expect(parseHttpUrl("ftp://x")).toBeNull();
    expect(parseHttpUrl("https://a.com and text")).toBeNull();
    expect(parseHttpUrl("just words")).toBeNull();
    expect(parseHttpUrl("")).toBeNull();
  });
});

describe("hostLabel", () => {
  it("strips www and returns host", () => {
    expect(hostLabel("https://www.github.com/foo")).toBe("github.com");
    expect(hostLabel("https://news.ycombinator.com")).toBe("news.ycombinator.com");
  });
});

describe("classifyUrlParagraph", () => {
  it("bare URL with no mark is a preview", () => {
    expect(classifyUrlParagraph({ text: "https://example.com/", linkHref: null })).toBe("preview");
  });
  it("autolinked URL (mark href === text) is a preview", () => {
    expect(
      classifyUrlParagraph({ text: "https://example.com/", linkHref: "https://example.com/" }),
    ).toBe("preview");
  });
  it("labeled link (text !== href) is a link", () => {
    expect(classifyUrlParagraph({ text: "github.com", linkHref: "https://github.com/" })).toBe("link");
  });
  it("non-URL text is none", () => {
    expect(classifyUrlParagraph({ text: "hello world", linkHref: null })).toBe("none");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/features/drawer/urlPreview.test.ts`
Expected: FAIL — cannot resolve `./urlPreview`.

- [ ] **Step 4: Implement**

Create `src/features/drawer/urlPreview.ts`:

```ts
/**
 * Pure helpers for the standalone-URL preview feature. No React, no Milkdown.
 * Shared by the preview node view (rendering) and the tooltip toggle (commands).
 */

/** A single http(s) URL with surrounding whitespace, or null otherwise. */
export function parseHttpUrl(text: string): URL | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return url;
}

/** Host without a leading `www.`, for use as a link label. */
export function hostLabel(href: string): string {
  try {
    return new URL(href).host.replace(/^www\./, "");
  } catch {
    return href;
  }
}

export type UrlParaNode = { text: string; linkHref: string | null };
export type UrlParaKind = "preview" | "link" | "none";

/**
 * Classify a paragraph whose sole content is one text node.
 * - "preview": the text is an http(s) URL and either has no link mark or has a
 *   link mark whose href equals the URL (the gfm-autolinked-literal case).
 * - "link": the text has a link mark whose href differs from the visible text
 *   (a labeled link, e.g. `[github.com](https://github.com/)`).
 * - "none": not a URL paragraph.
 */
export function classifyUrlParagraph(node: UrlParaNode): UrlParaKind {
  const asUrl = parseHttpUrl(node.text);
  if (node.linkHref) {
    if (asUrl && sameUrl(node.linkHref, node.text)) return "preview";
    return "link";
  }
  return asUrl ? "preview" : "none";
}

function sameUrl(a: string, b: string): boolean {
  const pa = parseHttpUrl(a);
  const pb = parseHttpUrl(b);
  if (!pa || !pb) return a.trim() === b.trim();
  return pa.href === pb.href;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/features/drawer/urlPreview.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add src/lib/commands.ts src/features/drawer/urlPreview.ts src/features/drawer/urlPreview.test.ts
git commit -m "feat(preview): frontend binding + URL/predicate helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Code-highlight module (`lowlight`)

**Files:**
- Create: `src/features/drawer/milkdownCodeHighlight.ts`
- Test: `src/features/drawer/milkdownCodeHighlight.test.ts`
- Modify: `package.json` (add `lowlight`)

**Interfaces:**
- Produces:
  - `resolveLanguage(lang: string | undefined): string | null` — maps a fence language/alias to a registered lowlight grammar name, or null if unsupported/empty.
  - `highlightToReact(code: string, lang: string | undefined): React.ReactNode` — highlighted spans when supported, plain text otherwise; never throws.
  Used by Task 9.

- [ ] **Step 1: Add the dependency**

Run: `npm install lowlight@^3`
Expected: `lowlight` added to `package.json` dependencies and installed.

- [ ] **Step 2: Write the failing test**

Create `src/features/drawer/milkdownCodeHighlight.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveLanguage } from "./milkdownCodeHighlight";

describe("resolveLanguage", () => {
  it("resolves common aliases to grammar names", () => {
    expect(resolveLanguage("ts")).toBe("typescript");
    expect(resolveLanguage("tsx")).toBe("typescript");
    expect(resolveLanguage("js")).toBe("javascript");
    expect(resolveLanguage("sh")).toBe("bash");
    expect(resolveLanguage("yml")).toBe("yaml");
    expect(resolveLanguage("rs")).toBe("rust");
  });
  it("passes through a known canonical name", () => {
    expect(resolveLanguage("python")).toBe("python");
  });
  it("returns null for unknown, empty, or mermaid", () => {
    expect(resolveLanguage("klingon")).toBeNull();
    expect(resolveLanguage("")).toBeNull();
    expect(resolveLanguage(undefined)).toBeNull();
    expect(resolveLanguage("mermaid")).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/features/drawer/milkdownCodeHighlight.test.ts`
Expected: FAIL — cannot resolve `./milkdownCodeHighlight`.

- [ ] **Step 4: Implement**

Create `src/features/drawer/milkdownCodeHighlight.ts`:

```ts
import { createElement, Fragment, type ReactNode } from "react";
import { createLowlight, common } from "lowlight";

const lowlight = createLowlight(common);

/**
 * Fence-language aliases → highlight.js grammar names. `mermaid` is excluded
 * on purpose (it renders as a diagram, not highlighted code).
 */
const ALIASES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  typescript: "typescript",
  js: "javascript",
  jsx: "javascript",
  javascript: "javascript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  bash: "bash",
  yml: "yaml",
  yaml: "yaml",
  rs: "rust",
  rust: "rust",
  py: "python",
  python: "python",
  json: "json",
  html: "xml",
  xml: "xml",
  css: "css",
  md: "markdown",
  markdown: "markdown",
  sql: "sql",
  go: "go",
  java: "java",
  c: "c",
  cpp: "cpp",
  toml: "ini",
  diff: "diff",
};

/** Resolve a fence language/alias to a registered grammar, or null. */
export function resolveLanguage(lang: string | undefined): string | null {
  if (!lang) return null;
  const key = lang.trim().toLowerCase();
  if (!key || key === "mermaid") return null;
  const grammar = ALIASES[key] ?? key;
  return lowlight.registered(grammar) ? grammar : null;
}

/** hast node shapes lowlight emits (narrowed locally to avoid a hast dep). */
type HastText = { type: "text"; value: string };
type HastElement = {
  type: "element";
  tagName: string;
  properties?: { className?: string[] | string };
  children: HastNode[];
};
type HastNode = HastText | HastElement | { type: "root"; children: HastNode[] };

function renderNodes(nodes: HastNode[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}-${i}`;
    if (node.type === "text") return node.value;
    if (node.type === "root") return renderNodes(node.children, key);
    const className = Array.isArray(node.properties?.className)
      ? node.properties?.className.join(" ")
      : node.properties?.className;
    return createElement(
      node.tagName,
      { key, className },
      ...renderNodes(node.children, key),
    );
  });
}

/**
 * Highlight `code` for `lang` into React elements built from lowlight tokens.
 * Falls back to plain text for unsupported languages or on any failure — never
 * throws, never injects raw HTML.
 */
export function highlightToReact(code: string, lang: string | undefined): ReactNode {
  const grammar = resolveLanguage(lang);
  if (!grammar) return code;
  try {
    const tree = lowlight.highlight(grammar, code) as { children: HastNode[] };
    return createElement(Fragment, null, ...renderNodes(tree.children, "hl"));
  } catch {
    return code;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/features/drawer/milkdownCodeHighlight.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add package.json package-lock.json src/features/drawer/milkdownCodeHighlight.ts src/features/drawer/milkdownCodeHighlight.test.ts
git commit -m "feat(code): lowlight highlighting module with alias map

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Highlighted read-only code block + header

**Files:**
- Modify: `src/features/drawer/milkdownCodeBlock.tsx`

**Interfaces:**
- Consumes: `highlightToReact`, `resolveLanguage` (Task 8).
- Produces: an expanded `createCodeBlockNodeView()` (same export signature). Visual; the pure highlighting is covered by Task 8. Manual verification.

**Behavior:** read-only non-mermaid blocks render a header (language label + Copy) over highlighted, non-editable code. Edit-mode non-mermaid blocks render the same header with a language `<select>` over the existing editable `<pre><code>` (`<code>` as `contentDOM`, unchanged). Mermaid behavior unchanged.

- [ ] **Step 1: Add a read-only highlighted React component**

In `src/features/drawer/milkdownCodeBlock.tsx`, add imports at the top:

```tsx
import { resolveLanguage, highlightToReact } from "./milkdownCodeHighlight";
```

Add a small read-only component above `createCodeBlockNodeView`:

```tsx
function ReadOnlyCodeBlock({ code, language }: { code: string; language?: string }) {
  const label = resolveLanguage(language) ?? (language?.trim() || "text");
  const onCopy = () => {
    void navigator.clipboard.writeText(code).catch(() => {
      // Clipboard denied: leave the block unchanged; no global toast.
    });
  };
  return (
    <div className="md-codeblock" data-language={language ?? ""}>
      <div className="md-codeblock-header">
        <span className="md-codeblock-lang">{label}</span>
        <button type="button" className="md-codeblock-copy" onClick={onCopy} aria-label="Copy code">
          Copy
        </button>
      </div>
      <pre>
        <code>{highlightToReact(code, language)}</code>
      </pre>
    </div>
  );
}
```

- [ ] **Step 2: Render it in the read-only branch**

In `createCodeBlockNodeView`, after the mermaid branch and before the default `<pre><code>` block, add a read-only non-mermaid branch:

```tsx
    // Read-only, non-mermaid: render highlighted code (presentation only).
    if (!view.editable) {
      const dom = document.createElement("div");
      dom.setAttribute("data-milkdown-codeblock", "");
      const root = createRoot(dom);
      const lang = node.attrs.language as string | undefined;
      root.render(<ReadOnlyCodeBlock code={node.textContent} language={lang} />);
      return {
        dom,
        ignoreMutation: () => true,
        update(updated: ProseMirrorNode) {
          if (updated.type !== node.type) return false;
          if ((updated.attrs.language as string | undefined) === "mermaid") return false;
          const l = updated.attrs.language as string | undefined;
          root.render(<ReadOnlyCodeBlock code={updated.textContent} language={l} />);
          return true;
        },
        destroy() {
          root.unmount();
        },
      };
    }
```

- [ ] **Step 3: Add the edit-mode language selector header**

Replace the default editable return at the end of `createCodeBlockNodeView`:

```tsx
    // Edit mode (non-mermaid): editable <pre><code> with a header + language
    // selector. The <code> stays the contentDOM so editing is unchanged; the
    // header is non-editable chrome.
    const wrapper = document.createElement("div");
    wrapper.className = "md-codeblock md-codeblock-edit";
    wrapper.setAttribute("contenteditable", "false");

    const header = document.createElement("div");
    header.className = "md-codeblock-header";
    const select = document.createElement("select");
    select.className = "md-codeblock-select";
    const language = node.attrs.language as string | undefined;
    for (const opt of CODE_LANGUAGES) {
      const o = document.createElement("option");
      o.value = opt.value;
      o.textContent = opt.label;
      if ((language ?? "") === opt.value) o.selected = true;
      select.appendChild(o);
    }
    select.addEventListener("change", () => {
      const pos = typeof getPos === "function" ? getPos() : null;
      if (pos == null) return;
      const tr = view.state.tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        language: select.value || null,
      });
      view.dispatch(tr);
    });
    header.appendChild(select);

    const pre = document.createElement("pre");
    const code = document.createElement("code");
    if (language) code.setAttribute("data-language", language);
    pre.appendChild(code);
    pre.setAttribute("contenteditable", "true");

    wrapper.appendChild(header);
    wrapper.appendChild(pre);
    return { dom: wrapper, contentDOM: code };
```

Add the `getPos` parameter to the node-view constructor signature and a language list. Update the constructor line:

```tsx
  return (node: ProseMirrorNode, view: EditorView, getPos: () => number | undefined) => {
```

And add the language list near the top of the file (after imports):

```tsx
/** Languages offered in the edit-mode selector. "" = plain text. */
const CODE_LANGUAGES: { value: string; label: string }[] = [
  { value: "", label: "Plain text" },
  { value: "typescript", label: "TypeScript" },
  { value: "javascript", label: "JavaScript" },
  { value: "tsx", label: "TSX" },
  { value: "python", label: "Python" },
  { value: "rust", label: "Rust" },
  { value: "bash", label: "Bash" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "sql", label: "SQL" },
  { value: "go", label: "Go" },
  { value: "java", label: "Java" },
  { value: "css", label: "CSS" },
  { value: "html", label: "HTML" },
  { value: "markdown", label: "Markdown" },
  { value: "mermaid", label: "Mermaid" },
];
```

- [ ] **Step 4: Add styles**

In `src/styles/index.css`, append code-block chrome styles (theme-aligned, compact):

```css
.md-codeblock { border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.md-codeblock-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px; padding: 4px 8px; background: color-mix(in oklab, var(--card) 90%, transparent);
  border-bottom: 1px solid var(--border); font-size: 12px; color: var(--muted-foreground);
}
.md-codeblock-lang { text-transform: lowercase; }
.md-codeblock-copy, .md-codeblock-select {
  font-size: 12px; color: var(--foreground); background: transparent;
  border: 1px solid var(--border); border-radius: 4px; padding: 1px 6px; cursor: pointer;
}
.md-codeblock pre { margin: 0; padding: 8px; overflow-x: auto; }
```

- [ ] **Step 5: Typecheck + build + manual verify**

Run: `npx tsc --noEmit && npm run build`
Expected: clean build.

Manual (in `npm run tauri dev`, an issue description with code blocks):
- Read-only: `ts`/`rust`/`python` blocks show highlighted tokens + a header with the language label and a Copy button; Copy copies only the code.
- Edit mode: the block is editable, header shows a language `<select>`; changing it updates the fence (verify by toggling read-only — highlighting/label follows).
- A `mermaid` block still renders a diagram read-only and editable source in edit mode.
- An unknown language renders as plain (escaped) text without crashing.

- [ ] **Step 6: Commit**

```bash
git add src/features/drawer/milkdownCodeBlock.tsx src/styles/index.css
git commit -m "feat(code): highlighted read-only blocks + edit-mode language selector

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Standalone-URL preview node view

**Files:**
- Create: `src/features/drawer/milkdownPreviewNode.tsx`
- Modify: `src/features/drawer/milkdownEditor.ts` (register the view)

**Interfaces:**
- Consumes: `classifyUrlParagraph`, `parseHttpUrl`, `hostLabel` (Task 7); `fetchLinkPreview`, `LinkPreview` (Task 7); existing `safeExternalUrl` (`src/lib/links.ts`) and `openUrl` from `@tauri-apps/plugin-opener`.
- Produces: `export const descriptionPreviewView` ($view over `paragraphSchema.node`). Visual; predicate covered by Task 7. Manual verification.

**Behavior:** override the paragraph node view. When `classifyUrlParagraph` returns `"preview"`, render presentation only (read-only: compact card ≤96px; edit: single-row with editable URL `contentDOM`); otherwise return the default editable paragraph. Never dispatch a transaction or trigger autosave on metadata load. On read-only activation, open via the external-link handler (never navigate the webview).

- [ ] **Step 1: Build the preview node view**

Create `src/features/drawer/milkdownPreviewNode.tsx`:

```tsx
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import type { Node as ProseMirrorNode } from "@milkdown/prose/model";
import type { EditorView, NodeViewConstructor } from "@milkdown/prose/view";
import { $view } from "@milkdown/kit/utils";
import { paragraphSchema } from "@milkdown/kit/preset/commonmark";
import { openUrl } from "@tauri-apps/plugin-opener";
import { safeExternalUrl } from "@/lib/links";
import { classifyUrlParagraph, hostLabel } from "./urlPreview";
import { fetchLinkPreview, type LinkPreview } from "@/lib/commands";

/** Read the sole text + its link href from a paragraph node, or null shape. */
function readParagraph(node: ProseMirrorNode): { text: string; linkHref: string | null } {
  if (node.childCount !== 1) return { text: "", linkHref: null };
  const child = node.child(0);
  if (!child.isText) return { text: "", linkHref: null };
  const linkMark = child.marks.find((m) => m.type.name === "link");
  const href = (linkMark?.attrs.href as string | undefined) ?? null;
  return { text: child.text ?? "", linkHref: href };
}

function openExternal(href: string) {
  const safe = safeExternalUrl(href);
  if (safe) void openUrl(safe).catch(() => undefined);
}

function PreviewCard({ url, editable }: { url: string; editable: boolean }) {
  const [data, setData] = useState<LinkPreview | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setData(null);
    setFailed(false);
    fetchLinkPreview(url)
      .then((p) => { if (active) setData(p); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [url]);

  const host = hostLabel(url);

  if (failed) {
    return (
      <button type="button" className="md-preview-fallback" onClick={() => openExternal(url)}>
        {url}
      </button>
    );
  }
  if (!data) {
    return (
      <div className="md-preview-card md-preview-loading" aria-busy="true">
        <span className="md-preview-host">{host}</span>
      </div>
    );
  }

  const title = data.title ?? host;
  if (editable) {
    return (
      <div className="md-preview-row">
        {data.imageDataUrl && <img className="md-preview-fav" src={data.imageDataUrl} alt="" />}
        <span className="md-preview-title">{title}</span>
        <span className="md-preview-host">{host}</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      className="md-preview-card"
      onClick={() => openExternal(data.resolvedUrl || url)}
      title={data.resolvedUrl || url}
    >
      {data.imageDataUrl && <img className="md-preview-thumb" src={data.imageDataUrl} alt="" />}
      <span className="md-preview-text">
        <span className="md-preview-title">{title}</span>
        {data.description && <span className="md-preview-desc">{data.description}</span>}
        <span className="md-preview-host">{data.siteName ?? host}</span>
      </span>
    </button>
  );
}

export function createPreviewNodeView(): NodeViewConstructor {
  return (node: ProseMirrorNode, view: EditorView) => {
    const isPreview = () => classifyUrlParagraph(readParagraph(node)) === "preview";

    if (!isPreview()) {
      // Default paragraph: editable contentDOM, no custom UI.
      const p = document.createElement("p");
      return { dom: p, contentDOM: p };
    }

    const url = readParagraph(node).text.trim();

    if (!view.editable) {
      // Read-only: opaque presentation card, no contentDOM.
      const dom = document.createElement("div");
      dom.setAttribute("data-milkdown-preview", "");
      const root = createRoot(dom);
      root.render(<PreviewCard url={url} editable={false} />);
      return {
        dom,
        ignoreMutation: () => true,
        update(updated: ProseMirrorNode) {
          if (updated.type !== node.type) return false;
          if (classifyUrlParagraph(readParagraph(updated)) !== "preview") return false;
          root.render(<PreviewCard url={readParagraph(updated).text.trim()} editable={false} />);
          return true;
        },
        destroy() { root.unmount(); },
      };
    }

    // Edit mode: single-row chrome + an editable contentDOM holding the URL so
    // the original URL is always editable inline (Enter/typing edits it).
    const dom = document.createElement("div");
    dom.className = "md-preview-edit";
    const chrome = document.createElement("div");
    chrome.setAttribute("contenteditable", "false");
    const root = createRoot(chrome);
    root.render(<PreviewCard url={url} editable />);
    const content = document.createElement("p");
    content.className = "md-preview-edit-url";
    dom.appendChild(chrome);
    dom.appendChild(content);
    return {
      dom,
      contentDOM: content,
      ignoreMutation: (m) => !content.contains(m.target as Node),
      update(updated: ProseMirrorNode) {
        if (updated.type !== node.type) return false;
        if (classifyUrlParagraph(readParagraph(updated)) !== "preview") return false;
        root.render(<PreviewCard url={readParagraph(updated).text.trim()} editable />);
        return true;
      },
      destroy() { root.unmount(); },
    };
  };
}

/** $view override of the paragraph node for standalone-URL previews. */
export const descriptionPreviewView = $view(
  paragraphSchema.node,
  () => createPreviewNodeView(),
);
```

- [ ] **Step 2: Register the view**

In `src/features/drawer/milkdownEditor.ts`, add the import (after the code-block view import):

```ts
import { descriptionPreviewView } from "./milkdownPreviewNode";
```

Add it to `descriptionPlugins` (after `descriptionCodeBlockView`):

```ts
  descriptionPreviewView,
```

Update the JSDoc above `descriptionPlugins` with one sentence: `descriptionPreviewView` overrides only DOM rendering of standalone bare-URL paragraphs (predicate-gated) and never alters Markdown serialization, so round-trips are unchanged.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

- [ ] **Step 4: Manual verification**

In `npm run tauri dev`, in an issue description:
- A paragraph that is only `https://example.com` renders a compact card in read-only mode (≤96px) and a single row in edit mode; a loading state shows first, then the card; clicking the read-only card opens the system browser (webview does not navigate).
- A `[label](https://example.com)` link is unaffected (still a link).
- A URL inside prose is unaffected.
- An offline/failed fetch shows the clickable URL fallback; editing/saving the description still works; no global toast.
- Round-trip: save, reload — the description still contains the bare URL (no `[ ]( )` wrapping).

- [ ] **Step 5: Commit**

```bash
git add src/features/drawer/milkdownPreviewNode.tsx src/features/drawer/milkdownEditor.ts
git commit -m "feat(preview): standalone-URL preview node view

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: Preview/link toggle in the selection tooltip

**Files:**
- Modify: `src/features/drawer/milkdownMenus.ts`
- Create: `src/features/drawer/previewToggle.ts`
- Test: `src/features/drawer/previewToggle.test.ts`

**Interfaces:**
- Consumes: `classifyUrlParagraph`, `parseHttpUrl`, `hostLabel` (Task 7).
- Produces:
  - `togglePreviewLabel(kind: UrlParaKind): string | null` — `"Display as link"` for `"preview"`, `"Display as preview"` for `"link"`, null otherwise (pure, tested).
  - tooltip wiring that, on a sole-content URL paragraph, shows the context-sensitive action and rewrites that paragraph via a ProseMirror transaction (preview↔labeled-link), flowing through the existing autosave.

- [ ] **Step 1: Write the failing test**

Create `src/features/drawer/previewToggle.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { togglePreviewLabel } from "./previewToggle";

describe("togglePreviewLabel", () => {
  it("offers 'Display as link' for a preview", () => {
    expect(togglePreviewLabel("preview")).toBe("Display as link");
  });
  it("offers 'Display as preview' for a link", () => {
    expect(togglePreviewLabel("link")).toBe("Display as preview");
  });
  it("offers nothing otherwise", () => {
    expect(togglePreviewLabel("none")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/drawer/previewToggle.test.ts`
Expected: FAIL — cannot resolve `./previewToggle`.

- [ ] **Step 3: Implement the pure helper + transaction logic**

Create `src/features/drawer/previewToggle.ts`:

```ts
import type { Ctx } from "@milkdown/kit/ctx";
import { editorViewCtx } from "@milkdown/kit/core";
import { findParentNode } from "@milkdown/prose";
import type { Node as ProseMirrorNode } from "@milkdown/prose/model";
import { classifyUrlParagraph, hostLabel, type UrlParaKind } from "./urlPreview";

export function togglePreviewLabel(kind: UrlParaKind): string | null {
  if (kind === "preview") return "Display as link";
  if (kind === "link") return "Display as preview";
  return null;
}

function readParagraph(node: ProseMirrorNode): { text: string; linkHref: string | null } {
  if (node.childCount !== 1) return { text: "", linkHref: null };
  const child = node.child(0);
  if (!child.isText) return { text: "", linkHref: null };
  const linkMark = child.marks.find((m) => m.type.name === "link");
  return { text: child.text ?? "", linkHref: (linkMark?.attrs.href as string | undefined) ?? null };
}

/** The toggle kind for the paragraph at the current selection, or "none". */
export function selectionUrlKind(ctx: Ctx): UrlParaKind {
  const view = ctx.get(editorViewCtx);
  const found = findParentNode((n) => n.type.name === "paragraph")(view.state.selection);
  if (!found) return "none";
  return classifyUrlParagraph(readParagraph(found.node));
}

/**
 * Rewrite the current URL paragraph between preview (bare URL text) and
 * labeled-link (host label + link mark) forms. A normal transaction, so it
 * participates in undo/redo and flows through autosave.
 */
export function runPreviewToggle(ctx: Ctx): void {
  const view = ctx.get(editorViewCtx);
  const { state } = view;
  const found = findParentNode((n) => n.type.name === "paragraph")(state.selection);
  if (!found) return;
  const { node, pos } = found;
  const kind = classifyUrlParagraph(readParagraph(node));
  const { text } = readParagraph(node);
  const url = text.trim();
  const linkType = state.schema.marks.link;
  if (!linkType) return;

  const start = pos + 1;
  const end = start + node.content.size;

  if (kind === "preview") {
    // → labeled link: host label text carrying a link mark to the URL.
    const label = hostLabel(url);
    const linked = state.schema.text(label, [linkType.create({ href: url })]);
    view.dispatch(state.tr.replaceWith(start, end, linked));
  } else if (kind === "link") {
    // → preview: bare URL text, no marks.
    const href = readParagraph(node).linkHref ?? url;
    const bare = state.schema.text(href);
    view.dispatch(state.tr.replaceWith(start, end, bare));
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/drawer/previewToggle.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the toggle into the tooltip**

In `src/features/drawer/milkdownMenus.ts`:

Add imports near the top:

```ts
import { selectionUrlKind, runPreviewToggle, togglePreviewLabel } from "./previewToggle";
```

In `TooltipView`, add a dedicated toggle button created in the constructor (after the `inlineCommands` button loop, before `wrapper.appendChild(buttons)` is finalized — append it into `buttons`):

```ts
    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "md-tooltip-preview-toggle";
    toggleBtn.style.display = "none";
    toggleBtn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      runPreviewToggle(this.#ctx);
      this.#provider.hide();
      this.#refocusEditor();
    });
    buttons.appendChild(toggleBtn);
    this.#toggleBtn = toggleBtn;
```

Add the field declaration with the other `readonly #...` fields:

```ts
  readonly #toggleBtn: HTMLButtonElement;
```

Relax the tooltip's `shouldShow` so it also appears for a collapsed selection sitting in a URL paragraph (today it requires a non-empty text selection). Replace the `shouldShow` body:

```ts
      shouldShow: (v: EditorView) => {
        if (!v.editable) return false;
        const { selection } = v.state;
        if (selection instanceof TextSelection && !selection.empty) return true;
        // Also show for a caret inside a standalone-URL paragraph (toggle only).
        return selectionUrlKind(this.#ctx) !== "none";
      },
```

Note: `shouldShow` must be an arrow function (not a method shorthand) so `this.#ctx` resolves; update accordingly. In `update`, refresh the toggle button's label/visibility — add at the start of the `update` arrow:

```ts
  update = (view: EditorView, prevState?: EditorState) => {
    const kind = selectionUrlKind(this.#ctx);
    const label = togglePreviewLabel(kind);
    if (label) {
      this.#toggleBtn.textContent = label;
      this.#toggleBtn.style.display = "inline-block";
    } else {
      this.#toggleBtn.style.display = "none";
    }
    this.#provider.update(view, prevState);
  };
```

- [ ] **Step 6: Typecheck + build + manual verify**

Run: `npx tsc --noEmit && npm run build`
Expected: clean.

Manual (in `npm run tauri dev`):
- Caret in a bare-URL preview paragraph → tooltip shows "Display as link"; clicking turns it into a `[host](url)` link (verify by saving/reloading the Markdown).
- Caret in a sole-content `[host](url)` link → tooltip shows "Display as preview"; clicking turns it into a preview card.
- Undo (Cmd+Z) reverses the toggle; the description autosaves after the change.
- Normal text selection still shows the existing bold/italic/link tooltip.

- [ ] **Step 7: Commit**

```bash
git add src/features/drawer/milkdownMenus.ts src/features/drawer/previewToggle.ts src/features/drawer/previewToggle.test.ts
git commit -m "feat(preview): context-sensitive preview/link toggle in tooltip

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: Round-trip safety + full gate

**Files:**
- Modify: `src/features/drawer/milkdownEditor.test.ts` (or create if absent — confirm the existing round-trip test file name first with `ls src/features/drawer/*.test.ts`)

**Interfaces:**
- Consumes: `roundtripMarkdown` (`milkdownEditor.ts`).
- Produces: a regression test that a standalone bare URL and a fenced code block round-trip unchanged through the real commonmark+gfm config.

- [ ] **Step 1: Write the round-trip test**

Locate the existing round-trip test file: run `ls src/features/drawer/*.test.ts` and open the one importing `roundtripMarkdown`. Add these cases there (adjust the import if the file already imports it):

```ts
import { roundtripMarkdown } from "./milkdownEditor";

it("preserves a standalone bare URL (no link wrapping)", async () => {
  const { markdown, valid } = await roundtripMarkdown("https://example.com/path");
  expect(valid).toBe(true);
  expect(markdown).toContain("https://example.com/path");
  expect(markdown).not.toContain("](https://example.com/path)");
});

it("preserves a fenced code block with a language", async () => {
  const src = "```ts\nconst x = 1;\n```";
  const { markdown, valid } = await roundtripMarkdown(src);
  expect(valid).toBe(true);
  expect(markdown).toContain("```ts");
  expect(markdown).toContain("const x = 1;");
});
```

- [ ] **Step 2: Run the new tests**

Run: `npx vitest run src/features/drawer` (whichever file you edited)
Expected: PASS — both new cases plus existing round-trip tests still green.

- [ ] **Step 3: Full gate**

Run each and confirm green:

```bash
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml
```

Expected: vitest all pass; `tsc && vite build` clean; Rust tests pass; fmt clean (run without `--check` to apply if needed); clippy no new warnings.

- [ ] **Step 4: Commit**

```bash
git add src/features/drawer/*.test.ts
git commit -m "test(preview): round-trip safety for bare URL + fenced code

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 5: Final manual smoke (both drawer and full-page issue views)**

In `npm run tauri dev`, confirm end-to-end in an issue description shown in **both** the drawer and the full-page tab: paste a URL → preview; toggle preview↔link; keyboard-navigate; open a link (opens browser, webview stays); offline fallback; change a code language; copy code; Mermaid renders. No console errors; secrets/network only via Rust.

---

## Self-Review

**1. Spec coverage:**
- Generic metadata preview cards for HTTP(S) URLs → Tasks 3, 5, 10. ✓
- Automatic previews only for whole-paragraph bare URLs → Task 7 predicate + Task 10. ✓
- Selection-toolbar preview/link toggle → Task 11. ✓
- Compact read-only cards (≤96px) + single-row edit embeds → Task 10 + CSS (Task 10 step uses classes; card height cap enforced in CSS — see note below). ✓
- Syntax highlighting for fenced blocks → Tasks 8, 9. ✓
- Edit-mode language selector → Task 9. ✓
- Copy only the code body → Task 9. ✓
- Mermaid behavior preserved → Tasks 9, 12. ✓
- Canonical Markdown (bare URL = preview; `[label](url)` = link; toggle rewrites) → Tasks 7, 11, 12. ✓
- `fetch_link_preview` returning sanitized structure (+ canonical URL, data-URL image) → Tasks 4, 5, 6. ✓
- Bounded TTL in-memory cache + in-flight coalescing → Tasks 4, 6. ✓
- Full SSRF rule set (scheme/creds/IP ranges/pin/redirects/timeouts/size/content-type/image caps/sanitized errors) → Tasks 1, 2, 5, 6. ✓
- No CSP change; image as data URL → Global Constraints + Task 5. ✓
- Failure handling (loading skeleton, fallback row, no global toast, remount retry, clipboard-fail local) → Tasks 9, 10. ✓
- Required verification commands → Task 12. ✓

**Gap fix (card height cap):** add to `src/styles/index.css` in Task 10's styling (fold into Task 10 step 1's commit) — append:

```css
.md-preview-card { display:flex; gap:8px; max-height:96px; overflow:hidden; width:100%;
  text-align:left; border:1px solid var(--border); border-radius:6px; padding:8px;
  background: color-mix(in oklab, var(--card) 92%, transparent); cursor:pointer; }
.md-preview-row, .md-preview-edit { display:flex; align-items:center; gap:8px;
  border:1px solid var(--border); border-radius:6px; padding:4px 8px; }
.md-preview-title { font-weight:500; color:var(--foreground); }
.md-preview-desc { color:var(--muted-foreground); font-size:12px;
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.md-preview-host { color:var(--muted-foreground); font-size:12px; }
.md-preview-thumb { width:64px; height:64px; object-fit:cover; border-radius:4px; flex:none; }
.md-preview-fav { width:16px; height:16px; border-radius:3px; flex:none; }
.md-preview-fallback { color:var(--primary); background:transparent; border:none;
  cursor:pointer; padding:0; text-align:left; }
```

(Task 10 must add these styles alongside the node view; reference this block.)

**2. Placeholder scan:** No "TBD"/"handle edge cases"/uncoded steps — every code step shows code. The only "confirm the file name" instruction (Task 12) is a concrete `ls` lookup, not a placeholder.

**3. Type consistency:**
- Rust: `LinkPreview` fields (`requested_url`, `resolved_url`, `title`, `description`, `site_name`, `image_data_url`) defined in Task 4, produced in Task 5, serialized camelCase, mirrored by the TS `LinkPreview` (`requestedUrl`, `resolvedUrl`, `title`, `description`, `siteName`, `imageDataUrl`) in Task 7. ✓
- `PreviewError` (Task 2) → mapped to `CmdError::PreviewUnavailable` (Task 6). ✓
- `is_public_ip` (Task 1) used in Task 5 `validate_resolved_addrs`. ✓
- `resolveLanguage`/`highlightToReact` (Task 8) consumed in Task 9. ✓
- `classifyUrlParagraph`/`UrlParaKind`/`hostLabel`/`parseHttpUrl` (Task 7) consumed in Tasks 10, 11. ✓
- `descriptionPreviewView` (Task 10) registered in `milkdownEditor.ts`. ✓
- Node-view constructor `getPos` param added in Task 9 matches ProseMirror's `NodeViewConstructor` signature. ✓
