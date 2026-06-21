use crate::link_preview::{Metadata, MAX_META_FIELD};
use scraper::{Html, Selector};

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

    #[test]
    fn drops_non_http_scheme_urls() {
        let html = r#"<html><head>
            <title>Safe Title</title>
            <meta property="og:image" content="javascript:alert(1)">
            <link rel="canonical" href="file:///etc/passwd">
        </head><body>x</body></html>"#;
        let m = extract_metadata(html, &base());
        assert_eq!(m.image_url, None);
        assert_eq!(m.canonical_url, None);
        assert_eq!(m.title.as_deref(), Some("Safe Title"));
    }
}
