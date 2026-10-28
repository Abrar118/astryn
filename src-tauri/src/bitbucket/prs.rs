//! Pull request list parsing and request paths.

use serde_json::Value;

use super::{account_avatar, account_login, page_values, str_at, BitbucketError, PR_PAGE_LEN};
use crate::code_host::{parse_repo_name, ParsedPr, RepositoryName, Reviewer};
use crate::issue_ref::extract_linear_identifier;

/// Scope caps mirror GitHub's (300 most recently updated PRs per scope).
pub const PER_SCOPE_CAP: usize = 300;
/// Bound on workspace pages read from `/user/workspaces` (100 per page).
pub const WORKSPACE_MAX_PAGES: usize = 10;

/// List items omit participants/reviewers unless asked for (partial response).
const PR_LIST_QUERY: &str =
    "state=OPEN&sort=-updated_on&fields=%2Bvalues.participants,%2Bvalues.reviewers";

/// The authenticated account.
#[derive(Debug, Clone, PartialEq)]
pub struct Viewer {
    pub uuid: String,
    pub account_id: Option<String>,
    pub login: String,
}

impl Viewer {
    /// Path segment identifying the viewer: the Atlassian account id, else the
    /// brace-wrapped UUID (percent-encoded).
    pub fn selector(&self) -> String {
        encode_segment(self.account_id.as_deref().unwrap_or(&self.uuid))
    }
}

/// Percent-encode a path segment, keeping RFC 3986 unreserved bytes and `:`.
pub fn encode_segment(raw: &str) -> String {
    raw.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~' | b':') {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

pub fn parse_viewer(v: &Value) -> Result<Viewer, BitbucketError> {
    let uuid = str_at(v, "uuid").ok_or(BitbucketError::Malformed)?;
    let login = account_login(Some(v)).ok_or(BitbucketError::Malformed)?;
    Ok(Viewer {
        uuid,
        account_id: str_at(v, "account_id"),
        login,
    })
}

pub const WORKSPACES_PATH: &str = "/user/workspaces?pagelen=100";

/// Workspace slugs from one `/user/workspaces` page; unsafe slugs are malformed.
pub fn parse_workspaces_page(page: &Value) -> Result<Vec<String>, BitbucketError> {
    page_values(page)?
        .iter()
        .map(|item| {
            let slug = item
                .get("workspace")
                .and_then(|w| str_at(w, "slug"))
                .ok_or(BitbucketError::Malformed)?;
            valid_slug(&slug)
                .then_some(slug)
                .ok_or(BitbucketError::Malformed)
        })
        .collect()
}

fn valid_slug(slug: &str) -> bool {
    parse_repo_name(&format!("{slug}/x")).is_some()
}

pub fn authored_prs_path(workspace: &str, viewer: &Viewer) -> Result<String, BitbucketError> {
    if !valid_slug(workspace) {
        return Err(BitbucketError::Malformed);
    }
    Ok(format!(
        "/workspaces/{workspace}/pullrequests/{}?pagelen={PR_PAGE_LEN}&{PR_LIST_QUERY}",
        viewer.selector()
    ))
}

pub fn repo_prs_path(repo: &RepositoryName) -> String {
    format!(
        "/repositories/{}/{}/pullrequests?pagelen={PR_PAGE_LEN}&{PR_LIST_QUERY}",
        repo.owner, repo.name
    )
}

fn uuid_of(account: Option<&Value>) -> Option<String> {
    account.and_then(|a| str_at(a, "uuid"))
}

fn participants(pr: &Value) -> impl Iterator<Item = &Value> {
    pr.get("participants")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
}

fn reviewer_accounts(pr: &Value) -> impl Iterator<Item = &Value> {
    pr.get("reviewers")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
}

/// Reviewers with their state: explicit approvals / change requests from
/// participants first, then still-pending reviewers. Plain commenters are not
/// reviewers.
pub fn parse_reviewers(pr: &Value) -> Vec<Reviewer> {
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for p in participants(pr) {
        let user = p.get("user");
        let state = if p.get("state").and_then(Value::as_str) == Some("changes_requested") {
            "changes_requested"
        } else if p.get("approved").and_then(Value::as_bool) == Some(true) {
            "approved"
        } else if p.get("role").and_then(Value::as_str) == Some("REVIEWER") {
            "pending"
        } else {
            continue;
        };
        let (Some(login), key) = (account_login(user), uuid_of(user)) else {
            continue;
        };
        if seen.insert(key.unwrap_or_else(|| login.clone())) {
            out.push(Reviewer {
                login,
                avatar: account_avatar(user),
                state: state.into(),
            });
        }
    }
    for r in reviewer_accounts(pr) {
        let Some(login) = account_login(Some(r)) else {
            continue;
        };
        if seen.insert(uuid_of(Some(r)).unwrap_or_else(|| login.clone())) {
            out.push(Reviewer {
                login,
                avatar: account_avatar(Some(r)),
                state: "pending".into(),
            });
        }
    }
    out
}

/// Overall review status: any change request wins, then any approval, then
/// "review required" while reviewers exist; `None` with no reviewers at all.
pub fn review_decision(reviewers: &[Reviewer]) -> Option<String> {
    if reviewers.iter().any(|r| r.state == "changes_requested") {
        Some("changes_requested".into())
    } else if reviewers.iter().any(|r| r.state == "approved") {
        Some("approved".into())
    } else if !reviewers.is_empty() {
        Some("review_required".into())
    } else {
        None
    }
}

/// True when the viewer is a reviewer who has neither approved nor requested
/// changes, on a PR they did not author.
pub fn awaits_review_from(pr: &Value, viewer_uuid: &str) -> bool {
    if uuid_of(pr.get("author")).as_deref() == Some(viewer_uuid) {
        return false;
    }
    let mut is_reviewer = false;
    for p in participants(pr) {
        if uuid_of(p.get("user")).as_deref() != Some(viewer_uuid) {
            continue;
        }
        let acted = p.get("approved").and_then(Value::as_bool) == Some(true)
            || p.get("state").and_then(Value::as_str) == Some("changes_requested");
        if acted {
            return false;
        }
        is_reviewer |= p.get("role").and_then(Value::as_str) == Some("REVIEWER");
    }
    is_reviewer || reviewer_accounts(pr).any(|r| uuid_of(Some(r)).as_deref() == Some(viewer_uuid))
}

/// One pull request object → the provider-neutral row. Missing id/repository
/// fails the page rather than silently dropping the PR.
pub fn parse_pr(pr: &Value) -> Result<ParsedPr, BitbucketError> {
    let number = pr
        .get("id")
        .and_then(Value::as_i64)
        .ok_or(BitbucketError::Malformed)?;
    let full_name = pr
        .get("destination")
        .and_then(|d| d.get("repository"))
        .and_then(|r| str_at(r, "full_name"))
        .ok_or(BitbucketError::Malformed)?;
    let repo = parse_repo_name(&full_name)
        .ok_or(BitbucketError::Malformed)?
        .canonical;
    let branch_of = |side: &str| {
        pr.get(side)
            .and_then(|s| s.get("branch"))
            .and_then(|b| str_at(b, "name"))
    };
    let branch = branch_of("source");
    let title = str_at(pr, "title");
    let reviewers = parse_reviewers(pr);
    Ok(ParsedPr {
        id: format!("{repo}#{number}"),
        repo,
        number,
        linear_identifier: extract_linear_identifier(
            branch.as_deref().unwrap_or(""),
            title.as_deref().unwrap_or(""),
        ),
        title,
        draft: pr.get("draft").and_then(Value::as_bool).unwrap_or(false),
        // Neither is part of the list payload; the drawer reads them live.
        mergeable: Some("unknown".into()),
        ci_status: Some("none".into()),
        review_decision: review_decision(&reviewers),
        author_login: account_login(pr.get("author")),
        author_avatar: account_avatar(pr.get("author")),
        comment_count: pr.get("comment_count").and_then(Value::as_i64),
        branch,
        base_branch: branch_of("destination"),
        url: pr
            .get("links")
            .and_then(|l| l.get("html"))
            .and_then(|h| str_at(h, "href")),
        updated_at: str_at(pr, "updated_on"),
        merged_at: None,
        additions: None,
        deletions: None,
        changed_files: None,
        reviewers,
    })
}

/// A list page → rows, each with whether it awaits the viewer's review.
pub fn parse_pr_page(
    page: &Value,
    viewer_uuid: &str,
) -> Result<Vec<(ParsedPr, bool)>, BitbucketError> {
    page_values(page)?
        .iter()
        .map(|pr| Ok((parse_pr(pr)?, awaits_review_from(pr, viewer_uuid))))
        .collect()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use serde_json::json;

    pub(crate) const ME: &str = "{me-uuid}";

    pub(crate) fn account(uuid: &str, nick: &str) -> Value {
        json!({
            "type": "user",
            "uuid": uuid,
            "nickname": nick,
            "display_name": format!("{nick} Name"),
            "account_id": format!("557058:{nick}"),
            "links": { "avatar": { "href": format!("https://avatar/{nick}.png") } }
        })
    }

    /// Shaped like a Bitbucket Cloud `pullrequest` list item with participants.
    pub(crate) fn pr_json(id: i64, repo: &str, participants: Value) -> Value {
        json!({
            "type": "pullrequest",
            "id": id,
            "title": "ENG-12 Add widget",
            "state": "OPEN",
            "draft": false,
            "author": account("{author-uuid}", "author"),
            "source": {
                "branch": { "name": "feature/eng-12-widget" },
                "repository": { "full_name": repo }
            },
            "destination": {
                "branch": { "name": "main" },
                "repository": { "full_name": repo, "name": "repo" }
            },
            "comment_count": 4,
            "task_count": 0,
            "created_on": "2026-10-20T09:00:00.000000+00:00",
            "updated_on": "2026-10-27T10:00:00.123456+00:00",
            "links": { "html": { "href": format!("https://bitbucket.org/{repo}/pull-requests/{id}") } },
            "participants": participants,
            "reviewers": []
        })
    }

    fn participant(uuid: &str, nick: &str, role: &str, approved: bool, state: Value) -> Value {
        json!({
            "type": "participant",
            "user": account(uuid, nick),
            "role": role,
            "approved": approved,
            "state": state,
            "participated_on": "2026-10-27T09:00:00+00:00"
        })
    }

    #[test]
    fn parses_list_item_fields() {
        let pr = pr_json(
            7,
            "acme/api",
            json!([
                participant("{a}", "alice", "REVIEWER", true, json!("approved")),
                participant("{c}", "carol", "PARTICIPANT", false, json!(null)),
            ]),
        );
        let p = parse_pr(&pr).unwrap();
        assert_eq!(p.id, "acme/api#7");
        assert_eq!(p.repo, "acme/api");
        assert_eq!(p.number, 7);
        assert_eq!(p.branch.as_deref(), Some("feature/eng-12-widget"));
        assert_eq!(p.base_branch.as_deref(), Some("main"));
        assert_eq!(p.author_login.as_deref(), Some("author"));
        assert_eq!(
            p.author_avatar.as_deref(),
            Some("https://avatar/author.png")
        );
        assert_eq!(p.comment_count, Some(4));
        assert_eq!(
            p.url.as_deref(),
            Some("https://bitbucket.org/acme/api/pull-requests/7")
        );
        assert_eq!(p.linear_identifier.as_deref(), Some("ENG-12"));
        assert_eq!(p.ci_status.as_deref(), Some("none"));
        assert_eq!(p.mergeable.as_deref(), Some("unknown"));
        // Commenter-only participants are not reviewers.
        assert_eq!(p.reviewers.len(), 1);
        assert_eq!(p.reviewers[0].login, "alice");
        assert_eq!(p.review_decision.as_deref(), Some("approved"));
    }

    #[test]
    fn review_decision_prefers_changes_then_approval_then_required() {
        let mk = |states: &[&str]| -> Vec<Reviewer> {
            states
                .iter()
                .map(|s| Reviewer {
                    login: "x".into(),
                    avatar: None,
                    state: (*s).into(),
                })
                .collect()
        };
        assert_eq!(
            review_decision(&mk(&["approved", "changes_requested"])).as_deref(),
            Some("changes_requested")
        );
        assert_eq!(
            review_decision(&mk(&["pending", "approved"])).as_deref(),
            Some("approved")
        );
        assert_eq!(
            review_decision(&mk(&["pending"])).as_deref(),
            Some("review_required")
        );
        assert_eq!(review_decision(&[]), None);
    }

    #[test]
    fn pending_reviewers_merge_from_the_reviewers_list() {
        let mut pr = pr_json(
            1,
            "acme/api",
            json!([participant(
                "{a}",
                "alice",
                "REVIEWER",
                false,
                json!("changes_requested")
            )]),
        );
        pr["reviewers"] = json!([account("{a}", "alice"), account("{b}", "bob")]);
        let reviewers = parse_reviewers(&pr);
        assert_eq!(reviewers.len(), 2);
        assert_eq!(reviewers[0].state, "changes_requested");
        assert_eq!(reviewers[1].login, "bob");
        assert_eq!(reviewers[1].state, "pending");
    }

    #[test]
    fn awaits_review_only_when_viewer_is_an_unacted_reviewer() {
        let waiting = pr_json(
            1,
            "a/b",
            json!([participant(ME, "me", "REVIEWER", false, json!(null))]),
        );
        assert!(awaits_review_from(&waiting, ME));

        let approved = pr_json(
            1,
            "a/b",
            json!([participant(ME, "me", "REVIEWER", true, json!("approved"))]),
        );
        assert!(!awaits_review_from(&approved, ME));

        let changes = pr_json(
            1,
            "a/b",
            json!([participant(
                ME,
                "me",
                "REVIEWER",
                false,
                json!("changes_requested")
            )]),
        );
        assert!(!awaits_review_from(&changes, ME));

        let commenter = pr_json(
            1,
            "a/b",
            json!([participant(ME, "me", "PARTICIPANT", false, json!(null))]),
        );
        assert!(!awaits_review_from(&commenter, ME));

        let mut only_listed = pr_json(1, "a/b", json!([]));
        only_listed["reviewers"] = json!([account(ME, "me")]);
        assert!(awaits_review_from(&only_listed, ME));

        let mut mine = waiting.clone();
        mine["author"] = account(ME, "me");
        assert!(!awaits_review_from(&mine, ME));
    }

    #[test]
    fn missing_id_or_unsafe_repo_is_malformed() {
        let mut no_id = pr_json(1, "a/b", json!([]));
        no_id.as_object_mut().unwrap().remove("id");
        assert!(parse_pr(&no_id).is_err());
        assert!(parse_pr(&pr_json(1, "a/b/../c", json!([]))).is_err());
        assert!(parse_pr_page(&json!({}), ME).is_err());
    }

    #[test]
    fn page_parse_flags_review_requests() {
        let page = json!({
            "pagelen": 50,
            "values": [
                pr_json(1, "a/b", json!([participant(ME, "me", "REVIEWER", false, json!(null))])),
                pr_json(2, "a/b", json!([])),
            ]
        });
        let rows = parse_pr_page(&page, ME).unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows[0].1);
        assert!(!rows[1].1);
    }

    #[test]
    fn viewer_and_workspaces_parse() {
        let viewer = parse_viewer(&account(ME, "me")).unwrap();
        assert_eq!(viewer.login, "me");
        assert_eq!(viewer.selector(), "557058:me");
        let no_account_id = Viewer {
            uuid: "{abc-1}".into(),
            account_id: None,
            login: "me".into(),
        };
        assert_eq!(no_account_id.selector(), "%7Babc-1%7D");
        assert!(parse_viewer(&json!({ "nickname": "x" })).is_err());

        let ws = parse_workspaces_page(&json!({
            "values": [
                { "type": "workspace_access", "administrator": false,
                  "workspace": { "slug": "acme", "uuid": "{w}" } }
            ]
        }))
        .unwrap();
        assert_eq!(ws, vec!["acme"]);
        assert!(parse_workspaces_page(&json!({
            "values": [{ "workspace": { "slug": "../x" } }]
        }))
        .is_err());
    }

    #[test]
    fn paths_request_open_prs_with_participants() {
        let viewer = parse_viewer(&account(ME, "me")).unwrap();
        assert_eq!(
            authored_prs_path("acme", &viewer).unwrap(),
            "/workspaces/acme/pullrequests/557058:me?pagelen=50&state=OPEN&sort=-updated_on&fields=%2Bvalues.participants,%2Bvalues.reviewers"
        );
        assert!(authored_prs_path("a/b", &viewer).is_err());
        assert_eq!(
            repo_prs_path(&parse_repo_name("acme/api").unwrap()),
            "/repositories/acme/api/pullrequests?pagelen=50&state=OPEN&sort=-updated_on&fields=%2Bvalues.participants,%2Bvalues.reviewers"
        );
    }
}
