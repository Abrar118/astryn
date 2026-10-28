//! ClickUp Docs: link parsing, request paths, and response parsing into the
//! shared docs cache shape.
//!
//! Built against ClickUp's public API reference without live credentials; the
//! fixtures below mirror the documented shapes (live verification pending).

use serde_json::Value;

use super::ClickUpError;
use crate::db::docs::DocFile;

/// One ClickUp Doc: the workspace it lives in and its id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocRef {
    pub workspace_id: String,
    pub doc_id: String,
}

fn is_id(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn is_workspace_id(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_digit())
}

/// Parse a Doc link: `https://app.clickup.com/{workspace}/v/dc/{doc}[/{page}]`
/// (scheme, query, fragment and trailing slash optional) or a bare
/// `{workspace}/{doc}`. Ids are validated so they can't smuggle extra path or
/// query segments into an API URL.
pub fn parse_doc_link(input: &str) -> Option<DocRef> {
    let mut s = input.trim();
    for scheme in ["https://", "http://"] {
        if let Some(rest) = s.strip_prefix(scheme) {
            s = rest;
            break;
        }
    }
    let s = s.split(['?', '#']).next().unwrap_or("");
    let (hosted, path) = match s.strip_prefix("app.clickup.com/") {
        Some(rest) => (true, rest),
        None => (false, s),
    };
    let parts: Vec<&str> = path.trim_matches('/').split('/').collect();
    let (workspace, doc) = match parts.as_slice() {
        [ws, "v", "dc", doc, ..] => (*ws, *doc),
        [ws, doc] if !hosted => (*ws, *doc),
        _ => return None,
    };
    (is_workspace_id(workspace) && is_id(doc)).then(|| DocRef {
        workspace_id: workspace.to_string(),
        doc_id: doc.to_string(),
    })
}

/// How a Doc is stored in `docs_sources.location`.
pub fn location(doc: &DocRef) -> String {
    format!("{}/{}", doc.workspace_id, doc.doc_id)
}

/// Inverse of `location` (validated the same way as a pasted link).
pub fn from_location(location: &str) -> Option<DocRef> {
    let (ws, doc) = location.split_once('/')?;
    (is_workspace_id(ws) && is_id(doc)).then(|| DocRef {
        workspace_id: ws.to_string(),
        doc_id: doc.to_string(),
    })
}

/// The Doc in ClickUp's web app.
pub fn doc_url(doc: &DocRef) -> String {
    format!(
        "https://app.clickup.com/{}/v/dc/{}",
        doc.workspace_id, doc.doc_id
    )
}

/// `GET` path for the Doc itself (v3).
pub fn doc_path(doc: &DocRef) -> String {
    format!("/v3/workspaces/{}/docs/{}", doc.workspace_id, doc.doc_id)
}

/// `GET` path for every page at any depth, content as Markdown (v3).
pub fn pages_path(doc: &DocRef) -> String {
    format!(
        "/v3/workspaces/{}/docs/{}/pages?max_page_depth=-1&content_format=text%2Fmd",
        doc.workspace_id, doc.doc_id
    )
}

/// `GET` path for the token's user (v2), used to test a connection.
pub const USER_PATH: &str = "/v2/user";

/// The Doc's name from a "get doc" response (`"Untitled"` when blank). A Doc
/// the API reports as deleted or archived is refused — it can't be a live source.
pub fn parse_doc_name(v: &Value) -> Result<String, ClickUpError> {
    if v.get("id").is_none() {
        return Err(ClickUpError::Malformed);
    }
    if flag(v, "deleted") || flag(v, "archived") {
        return Err(ClickUpError::Api("doc is deleted or archived".into()));
    }
    Ok(page_name(v))
}

/// The user's display name from `GET /v2/user`.
pub fn parse_user(v: &Value) -> Result<String, ClickUpError> {
    let user = v.get("user").ok_or(ClickUpError::Malformed)?;
    ["username", "email"]
        .iter()
        .find_map(|k| {
            user.get(*k)
                .and_then(|s| s.as_str())
                .filter(|s| !s.is_empty())
        })
        .map(String::from)
        .ok_or(ClickUpError::Malformed)
}

fn page_name(v: &Value) -> String {
    v.get("name")
        .and_then(|n| n.as_str())
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .unwrap_or("Untitled")
        .to_string()
}

fn flag(v: &Value, key: &str) -> bool {
    v.get(key).and_then(|b| b.as_bool()).unwrap_or(false)
}

/// Flatten a "get pages" response into cache rows. Each page becomes one
/// document whose path is its id chain (`parent/child`), so sub-pages nest under
/// their parent in the Docs tree. Archived or deleted pages are dropped with
/// their sub-pages; pages without a usable id are skipped. Accepts the documented
/// top-level array, or an object wrapping it in `pages`.
pub fn pages_to_files(v: &Value) -> Result<Vec<DocFile>, ClickUpError> {
    let pages = v
        .as_array()
        .or_else(|| v.get("pages").and_then(|p| p.as_array()))
        .ok_or(ClickUpError::Malformed)?;
    let mut out = Vec::new();
    collect(pages, "", &mut out);
    Ok(out)
}

fn collect(pages: &[Value], parent: &str, out: &mut Vec<DocFile>) {
    for page in pages {
        let Some(id) = page.get("id").and_then(|i| i.as_str()).filter(|i| is_id(i)) else {
            continue;
        };
        if flag(page, "archived") || flag(page, "deleted") {
            continue;
        }
        let path = if parent.is_empty() {
            id.to_string()
        } else {
            format!("{parent}/{id}")
        };
        out.push(DocFile {
            path: path.clone(),
            name: page_name(page),
            kind: "blob".into(),
            parent_path: parent.to_string(),
            sha: id.to_string(),
            content: Some(
                page.get("content")
                    .and_then(|c| c.as_str())
                    .unwrap_or("")
                    .to_string(),
            ),
        });
        if let Some(children) = page.get("pages").and_then(|p| p.as_array()) {
            collect(children, &path, out);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn doc(ws: &str, id: &str) -> DocRef {
        DocRef {
            workspace_id: ws.into(),
            doc_id: id.into(),
        }
    }

    #[test]
    fn parses_app_links_and_bare_pairs() {
        let want = Some(doc("9015123456", "8cnu1p0-1234"));
        for link in [
            "https://app.clickup.com/9015123456/v/dc/8cnu1p0-1234",
            "https://app.clickup.com/9015123456/v/dc/8cnu1p0-1234/8cnu1p0-5678",
            "app.clickup.com/9015123456/v/dc/8cnu1p0-1234/",
            "  https://app.clickup.com/9015123456/v/dc/8cnu1p0-1234?block=x#top ",
            "9015123456/8cnu1p0-1234",
        ] {
            assert_eq!(parse_doc_link(link), want, "{link}");
        }
    }

    #[test]
    fn rejects_other_links_and_unsafe_ids() {
        for link in [
            "",
            "https://app.clickup.com/9015123456/home",
            "https://app.clickup.com/9015123456/8cnu1p0-1234", // hosted but not a doc
            "https://doc.clickup.com/9015123456/d/h/8cnu1p0-1234/abc",
            "https://app.clickup.com/acme/v/dc/8cnu1p0-1234", // workspace must be numeric
            "9015123456/doc..id",
            "9015123456/doc%2F..",
            "https://github.com/acme/docs",
        ] {
            assert_eq!(parse_doc_link(link), None, "{link}");
        }
    }

    #[test]
    fn location_round_trips_and_builds_urls() {
        let d = doc("901", "abc-1");
        assert_eq!(location(&d), "901/abc-1");
        assert_eq!(from_location("901/abc-1"), Some(d.clone()));
        assert_eq!(from_location("901"), None);
        assert_eq!(doc_url(&d), "https://app.clickup.com/901/v/dc/abc-1");
        assert_eq!(doc_path(&d), "/v3/workspaces/901/docs/abc-1");
        assert_eq!(
            pages_path(&d),
            "/v3/workspaces/901/docs/abc-1/pages?max_page_depth=-1&content_format=text%2Fmd"
        );
    }

    #[test]
    fn reads_the_doc_name() {
        let v = json!({ "id": "abc-1", "name": "Engineering Handbook", "workspace_id": 901 });
        assert_eq!(parse_doc_name(&v).unwrap(), "Engineering Handbook");
        assert_eq!(
            parse_doc_name(&json!({ "id": "abc-1", "name": "" })).unwrap(),
            "Untitled"
        );
        assert!(matches!(
            parse_doc_name(&json!({})),
            Err(ClickUpError::Malformed)
        ));
    }

    #[test]
    fn a_deleted_or_archived_doc_is_not_accepted() {
        for flag in ["deleted", "archived"] {
            let v = json!({ "id": "abc-1", "name": "Old", flag: true });
            assert!(
                matches!(parse_doc_name(&v), Err(ClickUpError::Api(_))),
                "{flag}"
            );
        }
        let live = json!({ "id": "abc-1", "name": "Live", "deleted": false, "archived": false });
        assert_eq!(parse_doc_name(&live).unwrap(), "Live");
    }

    #[test]
    fn reads_the_user_name() {
        let v = json!({ "user": { "id": 1, "username": "Abrar", "email": "a@x.io" } });
        assert_eq!(parse_user(&v).unwrap(), "Abrar");
        let no_name = json!({ "user": { "id": 1, "username": null, "email": "a@x.io" } });
        assert_eq!(parse_user(&no_name).unwrap(), "a@x.io");
        assert!(matches!(
            parse_user(&json!({})),
            Err(ClickUpError::Malformed)
        ));
    }

    /// Mirrors the documented `GET …/docs/{doc_id}/pages` response: an array of
    /// pages with nested `pages`.
    fn pages_fixture() -> Value {
        json!([
            {
                "id": "p1", "doc_id": "abc-1", "workspace_id": 901, "name": "Overview",
                "content": "# Overview\n\nHello", "archived": false, "deleted": false,
                "pages": [
                    {
                        "id": "p2", "doc_id": "abc-1", "parent_page_id": "p1", "name": "Setup",
                        "content": "Install it.", "pages": [
                            { "id": "p3", "parent_page_id": "p2", "name": "", "content": "" }
                        ]
                    },
                    { "id": "p4", "parent_page_id": "p1", "name": "Old", "content": "x", "archived": true,
                      "pages": [ { "id": "p5", "name": "Hidden child", "content": "y" } ] }
                ]
            },
            { "id": "p6", "name": "Gone", "content": "z", "deleted": true },
            { "name": "No id" },
            { "id": "p7", "name": "FAQ" }
        ])
    }

    #[test]
    fn flattens_nested_pages_into_cache_rows() {
        let files = pages_to_files(&pages_fixture()).unwrap();
        let rows: Vec<(&str, &str, &str)> = files
            .iter()
            .map(|f| (f.path.as_str(), f.name.as_str(), f.parent_path.as_str()))
            .collect();
        assert_eq!(
            rows,
            [
                ("p1", "Overview", ""),
                ("p1/p2", "Setup", "p1"),
                ("p1/p2/p3", "Untitled", "p1/p2"),
                ("p7", "FAQ", ""),
            ]
        );
        assert!(files.iter().all(|f| f.kind == "blob"));
        assert_eq!(files[0].content.as_deref(), Some("# Overview\n\nHello"));
        assert_eq!(files[3].content.as_deref(), Some("")); // no content field
    }

    #[test]
    fn accepts_a_wrapped_pages_array_and_rejects_garbage() {
        let wrapped = json!({ "pages": [ { "id": "p1", "name": "A", "content": "a" } ] });
        assert_eq!(pages_to_files(&wrapped).unwrap().len(), 1);
        assert!(matches!(
            pages_to_files(&json!({ "err": "x" })),
            Err(ClickUpError::Malformed)
        ));
    }
}
