use crate::linear::{extract_data, LinearClient, LinearError};
use serde::{Deserialize, Deserializer};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedLabel {
    pub id: String,
    pub name: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedRelation {
    pub related_id: String,
    pub r#type: String,
    pub related_identifier: Option<String>,
    pub related_title: Option<String>,
    pub related_state_name: Option<String>,
    pub related_state_type: Option<String>,
    pub related_state_color: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedIssue {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub description: Option<String>,
    pub due_date: Option<String>,
    pub started_at: Option<String>,
    pub priority: i64,
    pub url: String,
    pub state_id: Option<String>,
    pub state_name: Option<String>,
    pub state_type: Option<String>,
    pub state_color: Option<String>,
    pub assignee_id: Option<String>,
    pub assignee_name: Option<String>,
    pub team_id: Option<String>,
    pub team_key: Option<String>,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub parent_id: Option<String>,
    pub estimate: Option<f64>,
    pub cycle_name: Option<String>,
    pub cycle_number: Option<i64>,
    pub milestone_name: Option<String>,
    pub link_count: i64,
    pub pr_count: i64,
    pub attachments_truncated: bool,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
    pub labels: Vec<ParsedLabel>,
    pub relations: Vec<ParsedRelation>,
    pub raw_json: String,
}

pub struct IssuesPage {
    pub issues: Vec<ParsedIssue>,
    pub has_next: bool,
    pub end_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct OrgIdentity {
    pub viewer_id: String,
    pub viewer_name: String,
    pub org_id: String,
    pub org_name: String,
    pub org_url_key: String,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedUser {
    pub id: String,
    pub name: String,
    /// Linear avatar image URL, when the user has uploaded one (else null).
    pub avatar_url: Option<String>,
    /// Short handle (e.g. "abrar"), IANA timezone, and primary team name — used
    /// by the mention hover card. All optional; absent fields just hide a line.
    pub display_name: Option<String>,
    pub timezone: Option<String>,
    pub team_name: Option<String>,
}

/// One inbox notification, flattened to the issue it points at. Only
/// issue-bearing notifications are surfaced (the inbox reuses the issue drawer),
/// so non-issue notifications are dropped during parsing.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedNotification {
    pub id: String,
    /// Linear notification `type` (e.g. `issueMention`, `issueNewComment`); the
    /// frontend turns this into the human subtitle, so unknown values still render.
    pub kind: String,
    pub created_at: String,
    pub read: bool,
    pub actor_name: Option<String>,
    pub issue_id: String,
    pub issue_identifier: String,
    pub issue_title: String,
    pub issue_state_type: String,
    pub issue_state_color: String,
    pub issue_project_name: Option<String>,
}

/// The inbox is capped at the most recent notifications; `has_more` reports
/// whether older notifications exist beyond this page so the UI can say so
/// rather than imply the list is complete.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationsPage {
    pub notifications: Vec<ParsedNotification>,
    pub has_more: bool,
}

// ---- helpers to read nested JSON safely ----
fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(|x| x.as_str()).map(Into::into)
}
fn nested(v: &Value, obj: &str, k: &str) -> Option<String> {
    v.get(obj)
        .and_then(|o| o.get(k))
        .and_then(|x| x.as_str())
        .map(Into::into)
}

/// A PR-style attachment URL across the common forges (GitHub `/pull/`,
/// GitLab `/merge_requests/`, Bitbucket `/pull-requests/`).
fn is_pr_url(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    let segments: Vec<_> = parsed
        .path_segments()
        .map(Iterator::collect)
        .unwrap_or_default();
    let marker = match host.as_str() {
        "github.com" | "www.github.com" => "pull",
        "gitlab.com" | "www.gitlab.com" => "merge_requests",
        "bitbucket.org" | "www.bitbucket.org" => "pull-requests",
        _ => return false,
    };
    segments
        .windows(2)
        .any(|parts| parts[0] == marker && parts[1].parse::<u64>().is_ok())
}

/// Count an issue's attachments, split into pull requests vs. other links.
fn classify_attachments(n: &Value) -> (i64, i64, bool) {
    let (mut links, mut prs) = (0i64, 0i64);
    if let Some(arr) = n
        .get("attachments")
        .and_then(|a| a.get("nodes"))
        .and_then(|x| x.as_array())
    {
        for a in arr {
            let url = a.get("url").and_then(|u| u.as_str()).unwrap_or("");
            if is_pr_url(url) {
                prs += 1;
            } else {
                links += 1;
            }
        }
    }
    let truncated = n
        .get("attachments")
        .and_then(|attachments| attachments.get("pageInfo"))
        .and_then(|page| page.get("hasNextPage"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    (links, prs, truncated)
}

fn node_to_issue(n: &Value) -> ParsedIssue {
    let (link_count, pr_count, attachments_truncated) = classify_attachments(n);
    let labels = n
        .get("labels")
        .and_then(|l| l.get("nodes"))
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .map(|l| ParsedLabel {
                    id: s(l, "id").unwrap_or_default(),
                    name: s(l, "name"),
                    color: s(l, "color"),
                })
                .collect()
        })
        .unwrap_or_default();
    let relations = n
        .get("relations")
        .and_then(|r| r.get("nodes"))
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|r| {
                    let ri = r.get("relatedIssue")?;
                    Some(ParsedRelation {
                        related_id: s(ri, "id").unwrap_or_default(),
                        r#type: s(r, "type").unwrap_or_default(),
                        related_identifier: s(ri, "identifier"),
                        related_title: s(ri, "title"),
                        related_state_name: nested(ri, "state", "name"),
                        related_state_type: nested(ri, "state", "type"),
                        related_state_color: nested(ri, "state", "color"),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    ParsedIssue {
        id: s(n, "id").unwrap_or_default(),
        identifier: s(n, "identifier").unwrap_or_default(),
        title: s(n, "title").unwrap_or_default(),
        description: s(n, "description"),
        due_date: s(n, "dueDate"),
        started_at: s(n, "startedAt"),
        priority: n.get("priority").and_then(|p| p.as_i64()).unwrap_or(0),
        url: s(n, "url").unwrap_or_default(),
        state_id: nested(n, "state", "id"),
        state_name: nested(n, "state", "name"),
        state_type: nested(n, "state", "type"),
        state_color: nested(n, "state", "color"),
        assignee_id: nested(n, "assignee", "id"),
        assignee_name: nested(n, "assignee", "name"),
        team_id: nested(n, "team", "id"),
        team_key: nested(n, "team", "key"),
        project_id: nested(n, "project", "id"),
        project_name: nested(n, "project", "name"),
        parent_id: nested(n, "parent", "id"),
        // `estimate` may arrive as an int or a float (fibonacci scales); read as f64.
        estimate: n.get("estimate").and_then(|x| x.as_f64()),
        cycle_name: nested(n, "cycle", "name"),
        cycle_number: n
            .get("cycle")
            .and_then(|c| c.get("number"))
            .and_then(|x| x.as_i64()),
        milestone_name: nested(n, "projectMilestone", "name"),
        link_count,
        pr_count,
        attachments_truncated,
        created_at: s(n, "createdAt").unwrap_or_default(),
        updated_at: s(n, "updatedAt").unwrap_or_default(),
        archived_at: s(n, "archivedAt"),
        labels,
        relations,
        raw_json: n.to_string(),
    }
}

pub fn parse_issues_page(body: &str) -> Result<IssuesPage, LinearError> {
    let data = extract_data(body)?;
    let issues_obj = data.get("issues").ok_or(LinearError::Malformed)?;
    let page = issues_obj.get("pageInfo").ok_or(LinearError::Malformed)?;
    let nodes = issues_obj
        .get("nodes")
        .and_then(|n| n.as_array())
        .ok_or(LinearError::Malformed)?;
    Ok(IssuesPage {
        issues: nodes.iter().map(node_to_issue).collect(),
        has_next: page
            .get("hasNextPage")
            .and_then(|b| b.as_bool())
            .unwrap_or(false),
        end_cursor: s(page, "endCursor"),
    })
}

pub fn parse_viewer_with_org(body: &str) -> Result<OrgIdentity, LinearError> {
    let data = extract_data(body)?;
    let v = data.get("viewer").ok_or(LinearError::Malformed)?;
    Ok(OrgIdentity {
        viewer_id: s(v, "id").ok_or(LinearError::Malformed)?,
        viewer_name: s(v, "name").unwrap_or_default(),
        org_id: nested(v, "organization", "id").ok_or(LinearError::Malformed)?,
        org_name: nested(v, "organization", "name").unwrap_or_default(),
        org_url_key: nested(v, "organization", "urlKey").unwrap_or_default(),
    })
}

pub fn parse_users(body: &str) -> Result<Vec<ParsedUser>, LinearError> {
    let data = extract_data(body)?;
    let nodes = data
        .get("users")
        .and_then(|u| u.get("nodes"))
        .and_then(|n| n.as_array())
        .ok_or(LinearError::Malformed)?;
    Ok(nodes
        .iter()
        .filter_map(|u| {
            Some(ParsedUser {
                id: s(u, "id")?,
                name: s(u, "name").unwrap_or_default(),
                avatar_url: s(u, "avatarUrl"),
                display_name: s(u, "displayName"),
                timezone: s(u, "timezone"),
                team_name: u
                    .get("teams")
                    .and_then(|t| t.get("nodes"))
                    .and_then(|n| n.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|t| s(t, "name")),
            })
        })
        .collect())
}

pub fn parse_notifications(body: &str) -> Result<NotificationsPage, LinearError> {
    let data = extract_data(body)?;
    let conn = data.get("notifications").ok_or(LinearError::Malformed)?;
    let has_more = conn
        .get("pageInfo")
        .and_then(|p| p.get("hasNextPage"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let nodes = conn
        .get("nodes")
        .and_then(|n| n.as_array())
        .ok_or(LinearError::Malformed)?;
    let notifications = nodes
        .iter()
        .filter_map(|n| {
            // Skip non-issue notifications: the inbox opens the issue drawer on click.
            let issue = n.get("issue").filter(|i| i.is_object())?;
            Some(ParsedNotification {
                id: s(n, "id")?,
                kind: s(n, "type").unwrap_or_default(),
                created_at: s(n, "createdAt").unwrap_or_default(),
                read: n.get("readAt").map(|r| !r.is_null()).unwrap_or(false),
                actor_name: nested(n, "actor", "name"),
                issue_id: s(issue, "id")?,
                issue_identifier: s(issue, "identifier").unwrap_or_default(),
                issue_title: s(issue, "title").unwrap_or_default(),
                issue_state_type: nested(issue, "state", "type").unwrap_or_default(),
                issue_state_color: nested(issue, "state", "color").unwrap_or_default(),
                issue_project_name: nested(issue, "project", "name"),
            })
        })
        .collect();
    Ok(NotificationsPage {
        notifications,
        has_more,
    })
}

pub fn parse_labels(body: &str) -> Result<Vec<ParsedLabel>, LinearError> {
    let data = extract_data(body)?;
    let nodes = data
        .get("issueLabels")
        .and_then(|u| u.get("nodes"))
        .and_then(|n| n.as_array())
        .ok_or(LinearError::Malformed)?;
    Ok(nodes
        .iter()
        .filter_map(|l| {
            Some(ParsedLabel {
                id: s(l, "id")?,
                name: s(l, "name"),
                color: s(l, "color"),
            })
        })
        .collect())
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedCycle {
    pub id: String,
    pub number: Option<i64>,
    pub name: Option<String>,
    pub team_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowState {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub color: String,
    pub team_id: String,
}

pub fn parse_workflow_states(body: &str) -> Result<Vec<WorkflowState>, LinearError> {
    let data = extract_data(body)?;
    let nodes = data
        .get("workflowStates")
        .and_then(|value| value.get("nodes"))
        .and_then(Value::as_array)
        .ok_or(LinearError::Malformed)?;
    Ok(nodes
        .iter()
        .filter_map(|state| {
            Some(WorkflowState {
                id: s(state, "id")?,
                name: s(state, "name")?,
                r#type: s(state, "type").unwrap_or_default(),
                color: s(state, "color").unwrap_or_default(),
                team_id: nested(state, "team", "id")?,
            })
        })
        .collect())
}

pub fn parse_cycles(body: &str) -> Result<Vec<ParsedCycle>, LinearError> {
    let data = extract_data(body)?;
    let nodes = data
        .get("cycles")
        .and_then(|u| u.get("nodes"))
        .and_then(|n| n.as_array())
        .ok_or(LinearError::Malformed)?;
    Ok(nodes
        .iter()
        .filter_map(|c| {
            Some(ParsedCycle {
                id: s(c, "id")?,
                number: c.get("number").and_then(|x| x.as_i64()),
                name: s(c, "name"),
                team_id: nested(c, "team", "id"),
            })
        })
        .collect())
}

const COMMENT_NODE_FIELDS: &str =
    "id body createdAt editedAt parent { id } user { id name } reactions { id emoji user { id name } }";

fn parse_reaction_node(r: &Value) -> DetailReaction {
    DetailReaction {
        id: s(r, "id").unwrap_or_default(),
        emoji: s(r, "emoji").unwrap_or_default(),
        user_id: nested(r, "user", "id"),
        user_name: nested(r, "user", "name"),
    }
}

fn parse_comment_node(c: &Value) -> DetailComment {
    let reactions = c
        .get("reactions")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().map(parse_reaction_node).collect())
        .unwrap_or_default();
    DetailComment {
        id: s(c, "id").unwrap_or_default(),
        body: s(c, "body").unwrap_or_default(),
        user_id: nested(c, "user", "id"),
        user_name: nested(c, "user", "name"),
        created_at: s(c, "createdAt").unwrap_or_default(),
        edited_at: s(c, "editedAt"),
        parent_id: nested(c, "parent", "id"),
        reactions,
    }
}

pub fn parse_label_create(body: &str) -> Result<ParsedLabel, LinearError> {
    let data = extract_data(body)?;
    let created = data.get("issueLabelCreate").ok_or(LinearError::Malformed)?;
    if created.get("success").and_then(|b| b.as_bool()) != Some(true) {
        return Err(LinearError::Api(
            "issueLabelCreate returned success=false".into(),
        ));
    }
    let l = created.get("issueLabel").ok_or(LinearError::Malformed)?;
    Ok(ParsedLabel {
        id: s(l, "id").unwrap_or_default(),
        name: s(l, "name"),
        color: s(l, "color"),
    })
}

/// Parse `issueRelationCreate`, returning the new relation from the source
/// issue's perspective (`relatedIssue` is the target, with display fields for
/// the relations cache).
pub fn parse_relation_create(body: &str) -> Result<ParsedRelation, LinearError> {
    let data = extract_data(body)?;
    let created = data
        .get("issueRelationCreate")
        .ok_or(LinearError::Malformed)?;
    if created.get("success").and_then(|b| b.as_bool()) != Some(true) {
        return Err(LinearError::Api(
            "issueRelationCreate returned success=false".into(),
        ));
    }
    let rel = created.get("issueRelation").ok_or(LinearError::Malformed)?;
    let ri = rel.get("relatedIssue").ok_or(LinearError::Malformed)?;
    Ok(ParsedRelation {
        related_id: s(ri, "id").unwrap_or_default(),
        r#type: s(rel, "type").unwrap_or_default(),
        related_identifier: s(ri, "identifier"),
        related_title: s(ri, "title"),
        related_state_name: nested(ri, "state", "name"),
        related_state_type: nested(ri, "state", "type"),
        related_state_color: nested(ri, "state", "color"),
    })
}

pub fn parse_issue_delete(body: &str) -> Result<(), LinearError> {
    let data = extract_data(body)?;
    let ok = data
        .get("issueDelete")
        .and_then(|d| d.get("success"))
        .and_then(|b| b.as_bool())
        == Some(true);
    if ok {
        Ok(())
    } else {
        Err(LinearError::Api(
            "issueDelete returned success=false".into(),
        ))
    }
}

pub fn parse_issue_update(body: &str) -> Result<ParsedIssue, LinearError> {
    let data = extract_data(body)?;
    let upd = data.get("issueUpdate").ok_or(LinearError::Malformed)?;
    if upd.get("success").and_then(|b| b.as_bool()) != Some(true) {
        return Err(LinearError::Api(
            "issueUpdate returned success=false".into(),
        ));
    }
    let issue = upd.get("issue").ok_or(LinearError::Malformed)?;
    Ok(node_to_issue(issue))
}

pub fn parse_issue_create(body: &str) -> Result<ParsedIssue, LinearError> {
    let data = extract_data(body)?;
    let created = data.get("issueCreate").ok_or(LinearError::Malformed)?;
    if created.get("success").and_then(|b| b.as_bool()) != Some(true) {
        return Err(LinearError::Api(
            "issueCreate returned success=false".into(),
        ));
    }
    let issue = created.get("issue").ok_or(LinearError::Malformed)?;
    Ok(node_to_issue(issue))
}

pub fn parse_comment_create(body: &str) -> Result<DetailComment, LinearError> {
    let data = extract_data(body)?;
    let created = data.get("commentCreate").ok_or(LinearError::Malformed)?;
    if created.get("success").and_then(|b| b.as_bool()) != Some(true) {
        return Err(LinearError::Api(
            "commentCreate returned success=false".into(),
        ));
    }
    Ok(parse_comment_node(
        created.get("comment").ok_or(LinearError::Malformed)?,
    ))
}

pub fn parse_comment_update(body: &str) -> Result<DetailComment, LinearError> {
    let data = extract_data(body)?;
    let upd = data.get("commentUpdate").ok_or(LinearError::Malformed)?;
    if upd.get("success").and_then(|b| b.as_bool()) != Some(true) {
        return Err(LinearError::Api(
            "commentUpdate returned success=false".into(),
        ));
    }
    Ok(parse_comment_node(
        upd.get("comment").ok_or(LinearError::Malformed)?,
    ))
}

pub fn parse_reaction_create(body: &str) -> Result<DetailReaction, LinearError> {
    let data = extract_data(body)?;
    let created = data.get("reactionCreate").ok_or(LinearError::Malformed)?;
    if created.get("success").and_then(|b| b.as_bool()) != Some(true) {
        return Err(LinearError::Api(
            "reactionCreate returned success=false".into(),
        ));
    }
    Ok(parse_reaction_node(
        created.get("reaction").ok_or(LinearError::Malformed)?,
    ))
}

pub fn parse_reaction_delete(body: &str) -> Result<(), LinearError> {
    let data = extract_data(body)?;
    if data
        .get("reactionDelete")
        .and_then(|d| d.get("success"))
        .and_then(|b| b.as_bool())
        == Some(true)
    {
        Ok(())
    } else {
        Err(LinearError::Api(
            "reactionDelete returned success=false".into(),
        ))
    }
}

pub fn parse_comment_delete(body: &str) -> Result<(), LinearError> {
    let data = extract_data(body)?;
    if data
        .get("commentDelete")
        .and_then(|d| d.get("success"))
        .and_then(|b| b.as_bool())
        == Some(true)
    {
        Ok(())
    } else {
        Err(LinearError::Api(
            "commentDelete returned success=false".into(),
        ))
    }
}

// ---- issue detail (drawer) ----
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailRef {
    pub id: String,
    pub identifier: String,
    pub title: String,
    /// Workflow-state type/color of the referenced issue, when fetched (relations
    /// carry it so the rail can show a status icon; `parent` leaves them None).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state_color: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailChild {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub state_type: String,
    pub state_name: String,
    pub state_color: String,
    pub priority: i64,
    pub due_date: Option<String>,
    pub estimate: Option<f64>,
    pub assignee_name: Option<String>,
    pub project_name: Option<String>,
    pub cycle_name: Option<String>,
    pub cycle_number: Option<i64>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailRelation {
    pub r#type: String,
    pub issue: DetailRef,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailReaction {
    pub id: String,
    pub emoji: String,
    pub user_id: Option<String>,
    pub user_name: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailComment {
    pub id: String,
    pub body: String,
    pub user_id: Option<String>,
    pub user_name: Option<String>,
    pub created_at: String,
    pub edited_at: Option<String>,
    pub parent_id: Option<String>,
    pub reactions: Vec<DetailReaction>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailAttachment {
    pub id: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub url: String,
    pub source_type: Option<String>,
    pub created_at: String,
    pub body: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailRelationChange {
    pub r#type: String,
    pub identifier: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailHistory {
    pub id: String,
    pub created_at: String,
    pub actor_name: Option<String>,
    pub from_state_name: Option<String>,
    pub to_state_name: Option<String>,
    pub to_state_type: Option<String>,
    pub to_state_color: Option<String>,
    pub from_assignee_name: Option<String>,
    pub to_assignee_name: Option<String>,
    pub from_priority: Option<f64>,
    pub to_priority: Option<f64>,
    pub from_title: Option<String>,
    pub to_title: Option<String>,
    pub updated_description: bool,
    pub attachment: Option<DetailAttachment>,
    pub relation_changes: Vec<DetailRelationChange>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailState {
    pub id: String,
    pub name: String,
    pub r#type: String,
    pub color: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailCycle {
    pub id: String,
    pub number: Option<i64>,
    pub name: Option<String>,
}

pub struct IssueDetailNode {
    pub issue: ParsedIssue,
    /// Linear's git branch name for this issue (workspace-formatted).
    pub branch_name: Option<String>,
    pub creator_name: Option<String>,
    pub team_states: Vec<DetailState>,
    pub cycle: Option<DetailCycle>,
    pub parent: Option<DetailRef>,
    pub children: Vec<DetailChild>,
    pub relations: Vec<DetailRelation>,
    pub attachments: Vec<DetailAttachment>,
    pub history: Vec<DetailHistory>,
    pub comments: Vec<DetailComment>,
    pub has_more_children: bool,
    pub has_more_relations: bool,
    pub has_more_history: bool,
    pub has_more_comments: bool,
}

fn conn_has_next(n: &Value, conn: &str) -> bool {
    n.get(conn)
        .and_then(|c| c.get("pageInfo"))
        .and_then(|p| p.get("hasNextPage"))
        .and_then(|b| b.as_bool())
        .unwrap_or(false)
}

fn collect_document_text(value: &Value, output: &mut Vec<String>, depth: usize) {
    // Cap recursion: bodyData is external (Linear) JSON, so a pathologically deep
    // document must not overflow the stack.
    if depth >= 32 {
        return;
    }
    if let Some(text) = value.get("text").and_then(Value::as_str) {
        if !text.trim().is_empty() {
            output.push(text.to_owned());
        }
    }
    if let Some(children) = value.get("content").and_then(Value::as_array) {
        for child in children {
            collect_document_text(child, output, depth + 1);
        }
    }
}

fn attachment_body(n: &Value) -> Option<String> {
    let messages = n
        .get("metadata")
        .and_then(|metadata| metadata.get("messages"))
        .and_then(Value::as_array)
        .map(|messages| {
            messages
                .iter()
                .filter_map(|message| s(message, "body"))
                .filter(|body| !body.trim().is_empty())
                .collect::<Vec<_>>()
                .join("\n\n")
        })
        .filter(|body| !body.is_empty());
    if messages.is_some() {
        return messages;
    }
    let body_data = s(n, "bodyData")?;
    if let Ok(document) = serde_json::from_str::<Value>(&body_data) {
        let mut text = Vec::new();
        collect_document_text(&document, &mut text, 0);
        let joined = text.join("\n\n");
        return (!joined.is_empty()).then_some(joined);
    }
    (!body_data.trim().is_empty()).then_some(body_data)
}

fn detail_attachment(n: &Value) -> DetailAttachment {
    DetailAttachment {
        id: s(n, "id").unwrap_or_default(),
        title: s(n, "title").unwrap_or_else(|| "Untitled resource".into()),
        subtitle: s(n, "subtitle"),
        url: s(n, "url").unwrap_or_default(),
        source_type: s(n, "sourceType"),
        created_at: s(n, "createdAt").unwrap_or_default(),
        body: attachment_body(n),
    }
}

pub fn parse_issue_detail(body: &str) -> Result<IssueDetailNode, LinearError> {
    let data = extract_data(body)?;
    let n = data.get("issue").ok_or(LinearError::Malformed)?;
    let issue = node_to_issue(n);
    let cycle = n
        .get("cycle")
        .filter(|c| !c.is_null())
        .map(|c| DetailCycle {
            id: s(c, "id").unwrap_or_default(),
            number: c.get("number").and_then(|x| x.as_i64()),
            name: s(c, "name"),
        });
    let team_states = n
        .get("team")
        .and_then(|t| t.get("states"))
        .and_then(|s2| s2.get("nodes"))
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .map(|st| DetailState {
                    id: s(st, "id").unwrap_or_default(),
                    name: s(st, "name").unwrap_or_default(),
                    r#type: s(st, "type").unwrap_or_default(),
                    color: s(st, "color").unwrap_or_default(),
                })
                .collect()
        })
        .unwrap_or_default();
    let parent = n.get("parent").filter(|p| !p.is_null()).map(|p| DetailRef {
        id: s(p, "id").unwrap_or_default(),
        identifier: s(p, "identifier").unwrap_or_default(),
        title: s(p, "title").unwrap_or_default(),
        state_type: None,
        state_color: None,
    });
    let children = n
        .get("children")
        .and_then(|c| c.get("nodes"))
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .map(|c| DetailChild {
                    id: s(c, "id").unwrap_or_default(),
                    identifier: s(c, "identifier").unwrap_or_default(),
                    title: s(c, "title").unwrap_or_default(),
                    state_type: nested(c, "state", "type").unwrap_or_default(),
                    state_name: nested(c, "state", "name").unwrap_or_default(),
                    state_color: nested(c, "state", "color").unwrap_or_default(),
                    priority: c.get("priority").and_then(Value::as_i64).unwrap_or(0),
                    due_date: s(c, "dueDate"),
                    estimate: c.get("estimate").and_then(Value::as_f64),
                    assignee_name: nested(c, "assignee", "name"),
                    project_name: nested(c, "project", "name"),
                    cycle_name: nested(c, "cycle", "name"),
                    cycle_number: c
                        .get("cycle")
                        .and_then(|cycle| cycle.get("number"))
                        .and_then(Value::as_i64),
                })
                .collect()
        })
        .unwrap_or_default();
    let relations = n
        .get("relations")
        .and_then(|r| r.get("nodes"))
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|r| {
                    let ri = r.get("relatedIssue")?;
                    Some(DetailRelation {
                        r#type: s(r, "type").unwrap_or_default(),
                        issue: DetailRef {
                            id: s(ri, "id").unwrap_or_default(),
                            identifier: s(ri, "identifier").unwrap_or_default(),
                            title: s(ri, "title").unwrap_or_default(),
                            state_type: nested(ri, "state", "type"),
                            state_color: nested(ri, "state", "color"),
                        },
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let comments = n
        .get("comments")
        .and_then(|c| c.get("nodes"))
        .and_then(|x| x.as_array())
        .map(|arr| arr.iter().map(parse_comment_node).collect())
        .unwrap_or_default();
    let attachments = n
        .get("attachments")
        .and_then(|a| a.get("nodes"))
        .and_then(Value::as_array)
        .map(|nodes| nodes.iter().map(detail_attachment).collect())
        .unwrap_or_default();
    let history = n
        .get("history")
        .and_then(|h| h.get("nodes"))
        .and_then(Value::as_array)
        .map(|nodes| {
            nodes
                .iter()
                .map(|event| DetailHistory {
                    id: s(event, "id").unwrap_or_default(),
                    created_at: s(event, "createdAt").unwrap_or_default(),
                    actor_name: nested(event, "actor", "name"),
                    from_state_name: nested(event, "fromState", "name"),
                    to_state_name: nested(event, "toState", "name"),
                    to_state_type: nested(event, "toState", "type"),
                    to_state_color: nested(event, "toState", "color"),
                    from_assignee_name: nested(event, "fromAssignee", "name"),
                    to_assignee_name: nested(event, "toAssignee", "name"),
                    from_priority: event.get("fromPriority").and_then(Value::as_f64),
                    to_priority: event.get("toPriority").and_then(Value::as_f64),
                    from_title: s(event, "fromTitle"),
                    to_title: s(event, "toTitle"),
                    updated_description: event
                        .get("updatedDescription")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    attachment: event
                        .get("attachment")
                        .filter(|attachment| !attachment.is_null())
                        .map(detail_attachment),
                    relation_changes: event
                        .get("relationChanges")
                        .and_then(Value::as_array)
                        .map(|changes| {
                            changes
                                .iter()
                                .map(|change| DetailRelationChange {
                                    r#type: s(change, "type").unwrap_or_default(),
                                    identifier: s(change, "identifier").unwrap_or_default(),
                                })
                                .collect()
                        })
                        .unwrap_or_default(),
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(IssueDetailNode {
        issue,
        branch_name: s(n, "branchName"),
        creator_name: nested(n, "creator", "name"),
        team_states,
        cycle,
        parent,
        children,
        relations,
        attachments,
        history,
        comments,
        has_more_children: conn_has_next(n, "children"),
        has_more_relations: conn_has_next(n, "relations"),
        has_more_history: conn_has_next(n, "history"),
        has_more_comments: conn_has_next(n, "comments"),
    })
}

// ---- tri-state patch ----
fn double_option<'de, T, D>(de: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Deserialize::deserialize(de).map(Some)
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateIssuePatch {
    #[serde(default)]
    pub title: Option<String>,
    /// Move the issue to another team. Not nullable — an issue always has a team.
    #[serde(default)]
    pub team_id: Option<String>,
    #[serde(default)]
    pub state_id: Option<String>,
    #[serde(default)]
    pub priority: Option<i64>,
    #[serde(default, deserialize_with = "double_option")]
    pub due_date: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub assignee_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub description: Option<Option<String>>,
    /// Replace the full label set (present => set, absent => unchanged).
    #[serde(default)]
    pub label_ids: Option<Vec<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub project_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub estimate: Option<Option<f64>>,
    #[serde(default, deserialize_with = "double_option")]
    pub cycle_id: Option<Option<String>>,
    /// Re-parent the issue (sub-issue of / parent of). Some(None) detaches.
    #[serde(default, deserialize_with = "double_option")]
    pub parent_id: Option<Option<String>>,
}

/// Build the GraphQL `IssueUpdateInput`. Omitted => absent; Some(None) => null (clear).
pub fn patch_to_input(p: &UpdateIssuePatch) -> Value {
    let mut m = serde_json::Map::new();
    if let Some(v) = &p.title {
        m.insert("title".into(), Value::String(v.clone()));
    }
    if let Some(v) = &p.team_id {
        m.insert("teamId".into(), Value::String(v.clone()));
    }
    if let Some(v) = &p.state_id {
        m.insert("stateId".into(), Value::String(v.clone()));
    }
    if let Some(v) = p.priority {
        m.insert("priority".into(), Value::from(v));
    }
    if let Some(opt) = &p.due_date {
        m.insert(
            "dueDate".into(),
            opt.clone().map(Value::String).unwrap_or(Value::Null),
        );
    }
    if let Some(opt) = &p.assignee_id {
        m.insert(
            "assigneeId".into(),
            opt.clone().map(Value::String).unwrap_or(Value::Null),
        );
    }
    if let Some(opt) = &p.description {
        m.insert(
            "description".into(),
            opt.clone().map(Value::String).unwrap_or(Value::Null),
        );
    }
    if let Some(ids) = &p.label_ids {
        m.insert(
            "labelIds".into(),
            Value::Array(ids.iter().cloned().map(Value::String).collect()),
        );
    }
    if let Some(opt) = &p.project_id {
        m.insert(
            "projectId".into(),
            opt.clone().map(Value::String).unwrap_or(Value::Null),
        );
    }
    if let Some(opt) = &p.estimate {
        m.insert(
            "estimate".into(),
            opt.map(Value::from).unwrap_or(Value::Null),
        );
    }
    if let Some(opt) = &p.cycle_id {
        m.insert(
            "cycleId".into(),
            opt.clone().map(Value::String).unwrap_or(Value::Null),
        );
    }
    if let Some(opt) = &p.parent_id {
        m.insert(
            "parentId".into(),
            opt.clone().map(Value::String).unwrap_or(Value::Null),
        );
    }
    Value::Object(m)
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateIssueInput {
    pub team_id: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub state_id: Option<String>,
    #[serde(default)]
    pub priority: Option<i64>,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub assignee_id: Option<String>,
    #[serde(default)]
    pub label_ids: Option<Vec<String>>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub estimate: Option<f64>,
    #[serde(default)]
    pub cycle_id: Option<String>,
}

/// Build the GraphQL `IssueCreateInput`. `teamId`/`title` are required; the rest
/// are included only when present (no tri-state — create has no "clear").
pub fn create_input_to_value(p: &CreateIssueInput) -> Value {
    let mut m = serde_json::Map::new();
    m.insert("teamId".into(), Value::String(p.team_id.clone()));
    m.insert("title".into(), Value::String(p.title.clone()));
    if let Some(v) = &p.description {
        m.insert("description".into(), Value::String(v.clone()));
    }
    if let Some(v) = &p.state_id {
        m.insert("stateId".into(), Value::String(v.clone()));
    }
    if let Some(v) = p.priority {
        m.insert("priority".into(), Value::from(v));
    }
    if let Some(v) = &p.due_date {
        m.insert("dueDate".into(), Value::String(v.clone()));
    }
    if let Some(v) = &p.assignee_id {
        m.insert("assigneeId".into(), Value::String(v.clone()));
    }
    if let Some(ids) = &p.label_ids {
        m.insert(
            "labelIds".into(),
            Value::Array(ids.iter().cloned().map(Value::String).collect()),
        );
    }
    if let Some(v) = &p.project_id {
        m.insert("projectId".into(), Value::String(v.clone()));
    }
    if let Some(v) = p.estimate {
        m.insert("estimate".into(), Value::from(v));
    }
    if let Some(v) = &p.cycle_id {
        m.insert("cycleId".into(), Value::String(v.clone()));
    }
    Value::Object(m)
}

pub fn validate_create_input(p: &CreateIssueInput) -> Result<(), &'static str> {
    if p.team_id.trim().is_empty() {
        return Err("teamId is required");
    }
    if p.title.trim().is_empty() {
        return Err("title is required");
    }
    Ok(())
}

// ---- GraphQL query strings + LinearClient methods ----
const ISSUE_NODE_FIELDS: &str = "id identifier title description dueDate startedAt priority url createdAt updatedAt archivedAt
  estimate cycle { id number name } projectMilestone { id name }
  attachments(first: 50) { pageInfo { hasNextPage } nodes { id title subtitle url sourceType createdAt } }
  state { id name type color } assignee { id name } team { id key } project { id name } parent { id }
  labels { nodes { id name color } }";

fn issues_query() -> String {
    format!(
        "query Issues($after: String, $filter: IssueFilter) {{
           issues(first: 100, after: $after, filter: $filter, includeArchived: true, orderBy: updatedAt) {{
             pageInfo {{ hasNextPage endCursor }}
             nodes {{ {ISSUE_NODE_FIELDS}
               relations(first: 50) {{ nodes {{ type relatedIssue {{ id identifier title state {{ name type color }} }} }} }}
             }}
           }}
         }}"
    )
}

fn issue_detail_query() -> String {
    format!(
        "query Issue($id: String!) {{
           issue(id: $id) {{
             {ISSUE_NODE_FIELDS}
             branchName
             team {{ id key states(first: 50) {{ nodes {{ id name type color }} }} }}
             parent {{ id identifier title }}
             creator {{ name }}
             attachments(first: 50) {{ nodes {{ bodyData metadata }} }}
             children(first: 50) {{ pageInfo {{ hasNextPage }} nodes {{
               id identifier title priority dueDate estimate
               state {{ name type color }} assignee {{ name }} project {{ name }} cycle {{ name number }}
             }} }}
             relations(first: 50) {{ pageInfo {{ hasNextPage }} nodes {{ type relatedIssue {{ id identifier title state {{ type color }} }} }} }}
             history(first: 50) {{ pageInfo {{ hasNextPage }} nodes {{
               id createdAt actor {{ name }} fromState {{ name }} toState {{ name type color }}
               fromAssignee {{ name }} toAssignee {{ name }} fromPriority toPriority fromTitle toTitle
               updatedDescription relationChanges {{ type identifier }}
               attachment {{ id title subtitle url sourceType createdAt }}
             }} }}
             comments(first: 50) {{ pageInfo {{ hasNextPage }} nodes {{ {COMMENT_NODE_FIELDS} }} }}
           }}
         }}"
    )
}

const USERS_QUERY: &str = "query { users(first: 250) { nodes { id name avatarUrl displayName timezone teams(first: 1) { nodes { name } } } } }";
const NOTIFICATIONS_QUERY: &str = "query { notifications(first: 50) {
    pageInfo { hasNextPage }
    nodes {
      id type createdAt readAt actor { name }
      ... on IssueNotification {
        issue { id identifier title state { type color } project { name } }
      }
    } } }";
const LABELS_QUERY: &str = "query { issueLabels(first: 250) { nodes { id name color } } }";
const CYCLES_QUERY: &str = "query { cycles(first: 250) { nodes { id number name team { id } } } }";
const WORKFLOW_STATES_QUERY: &str =
    "query { workflowStates(first: 250) { nodes { id name type color team { id } } } }";
const ISSUE_DELETE_MUTATION: &str = "mutation D($id: String!) { issueDelete(id: $id) { success } }";
const COMMENT_DELETE_MUTATION: &str =
    "mutation D($id: String!) { commentDelete(id: $id) { success } }";
const REACTION_DELETE_MUTATION: &str =
    "mutation D($id: String!) { reactionDelete(id: $id) { success } }";

fn reaction_create_mutation() -> String {
    "mutation R($input: ReactionCreateInput!) { reactionCreate(input: $input) { success reaction { id emoji user { id name } } } }".to_string()
}
const VIEWER_ORG_QUERY: &str = "query { viewer { id name organization { id name urlKey } } }";

fn issue_update_mutation() -> String {
    format!(
        "mutation U($id: String!, $input: IssueUpdateInput!) {{
           issueUpdate(id: $id, input: $input) {{ success issue {{ {ISSUE_NODE_FIELDS} }} }}
         }}"
    )
}

fn issue_create_mutation() -> String {
    format!(
        "mutation C($input: IssueCreateInput!) {{
           issueCreate(input: $input) {{ success issue {{ {ISSUE_NODE_FIELDS} }} }}
         }}"
    )
}

fn comment_create_mutation() -> String {
    format!(
        "mutation C($input: CommentCreateInput!) {{ commentCreate(input: $input) {{ success comment {{ {COMMENT_NODE_FIELDS} }} }} }}"
    )
}

fn comment_update_mutation() -> String {
    format!(
        "mutation U($id: String!, $input: CommentUpdateInput!) {{ commentUpdate(id: $id, input: $input) {{ success comment {{ {COMMENT_NODE_FIELDS} }} }} }}"
    )
}

fn label_create_mutation() -> String {
    "mutation L($input: IssueLabelCreateInput!) { issueLabelCreate(input: $input) { success issueLabel { id name color } } }".to_string()
}

fn relation_create_mutation() -> String {
    "mutation IRC($input: IssueRelationCreateInput!) { \
       issueRelationCreate(input: $input) { \
         success \
         issueRelation { type relatedIssue { id identifier title state { name type color } } } \
       } \
     }"
    .to_string()
}

impl LinearClient {
    async fn post(&self, auth: &str, body: serde_json::Value) -> Result<String, LinearError> {
        self.http_post(auth, body).await
    }

    pub async fn issues_page(
        &self,
        auth: &str,
        after: Option<&str>,
        since: Option<&str>,
    ) -> Result<IssuesPage, LinearError> {
        let filter: serde_json::Value = since
            .map(|c| serde_json::json!({ "updatedAt": { "gte": c } }))
            .unwrap_or(serde_json::Value::Null);
        let body = serde_json::json!({
            "query": issues_query(),
            "variables": { "after": after, "filter": filter }
        });
        parse_issues_page(&self.post(auth, body).await?)
    }

    pub async fn issue_detail(&self, auth: &str, id: &str) -> Result<IssueDetailNode, LinearError> {
        let body = serde_json::json!({ "query": issue_detail_query(), "variables": { "id": id } });
        parse_issue_detail(&self.post(auth, body).await?)
    }

    pub async fn users(&self, auth: &str) -> Result<Vec<ParsedUser>, LinearError> {
        let body = serde_json::json!({ "query": USERS_QUERY });
        parse_users(&self.post(auth, body).await?)
    }

    pub async fn labels(&self, auth: &str) -> Result<Vec<ParsedLabel>, LinearError> {
        let body = serde_json::json!({ "query": LABELS_QUERY });
        parse_labels(&self.post(auth, body).await?)
    }

    pub async fn notifications(&self, auth: &str) -> Result<NotificationsPage, LinearError> {
        let body = serde_json::json!({ "query": NOTIFICATIONS_QUERY });
        parse_notifications(&self.post(auth, body).await?)
    }

    pub async fn cycles(&self, auth: &str) -> Result<Vec<ParsedCycle>, LinearError> {
        let body = serde_json::json!({ "query": CYCLES_QUERY });
        parse_cycles(&self.post(auth, body).await?)
    }

    pub async fn workflow_states(&self, auth: &str) -> Result<Vec<WorkflowState>, LinearError> {
        let body = serde_json::json!({ "query": WORKFLOW_STATES_QUERY });
        parse_workflow_states(&self.post(auth, body).await?)
    }

    pub async fn delete_issue(&self, auth: &str, id: &str) -> Result<(), LinearError> {
        let body = serde_json::json!({ "query": ISSUE_DELETE_MUTATION, "variables": { "id": id } });
        parse_issue_delete(&self.post(auth, body).await?)
    }

    /// Create an issue relation. `type_` is the Linear `IssueRelationType`
    /// (`related` | `blocks` | `duplicate`); the caller chooses `issue_id` /
    /// `related_issue_id` to encode direction (e.g. "blocked by" = swap them).
    pub async fn create_issue_relation(
        &self,
        auth: &str,
        issue_id: &str,
        related_issue_id: &str,
        type_: &str,
    ) -> Result<ParsedRelation, LinearError> {
        let input = serde_json::json!({
            "issueId": issue_id,
            "relatedIssueId": related_issue_id,
            "type": type_,
        });
        let req = serde_json::json!({
            "query": relation_create_mutation(),
            "variables": { "input": input }
        });
        parse_relation_create(&self.post(auth, req).await?)
    }

    pub async fn create_comment(
        &self,
        auth: &str,
        issue_id: &str,
        body: &str,
        parent_id: Option<&str>,
    ) -> Result<DetailComment, LinearError> {
        let mut input = serde_json::json!({ "issueId": issue_id, "body": body });
        if let Some(pid) = parent_id {
            input["parentId"] = serde_json::Value::String(pid.to_string());
        }
        let req = serde_json::json!({ "query": comment_create_mutation(), "variables": { "input": input } });
        parse_comment_create(&self.post(auth, req).await?)
    }

    pub async fn update_comment(
        &self,
        auth: &str,
        id: &str,
        body: &str,
    ) -> Result<DetailComment, LinearError> {
        let req = serde_json::json!({
            "query": comment_update_mutation(),
            "variables": { "id": id, "input": { "body": body } }
        });
        parse_comment_update(&self.post(auth, req).await?)
    }

    pub async fn delete_comment(&self, auth: &str, id: &str) -> Result<(), LinearError> {
        let req =
            serde_json::json!({ "query": COMMENT_DELETE_MUTATION, "variables": { "id": id } });
        parse_comment_delete(&self.post(auth, req).await?)
    }

    pub async fn add_reaction(
        &self,
        auth: &str,
        comment_id: &str,
        emoji: &str,
    ) -> Result<DetailReaction, LinearError> {
        let req = serde_json::json!({
            "query": reaction_create_mutation(),
            "variables": { "input": { "commentId": comment_id, "emoji": emoji } }
        });
        parse_reaction_create(&self.post(auth, req).await?)
    }

    pub async fn remove_reaction(&self, auth: &str, id: &str) -> Result<(), LinearError> {
        let req =
            serde_json::json!({ "query": REACTION_DELETE_MUTATION, "variables": { "id": id } });
        parse_reaction_delete(&self.post(auth, req).await?)
    }

    pub async fn viewer_with_org(&self, auth: &str) -> Result<OrgIdentity, LinearError> {
        let body = serde_json::json!({ "query": VIEWER_ORG_QUERY });
        parse_viewer_with_org(&self.post(auth, body).await?)
    }

    pub async fn update_issue(
        &self,
        auth: &str,
        id: &str,
        input: &serde_json::Value,
    ) -> Result<ParsedIssue, LinearError> {
        let body = serde_json::json!({
            "query": issue_update_mutation(),
            "variables": { "id": id, "input": input }
        });
        parse_issue_update(&self.post(auth, body).await?)
    }

    pub async fn create_issue(
        &self,
        auth: &str,
        input: &serde_json::Value,
    ) -> Result<ParsedIssue, LinearError> {
        let body = serde_json::json!({
            "query": issue_create_mutation(),
            "variables": { "input": input }
        });
        parse_issue_create(&self.post(auth, body).await?)
    }

    pub async fn create_label(
        &self,
        auth: &str,
        name: &str,
        color: &str,
        team_id: Option<&str>,
    ) -> Result<ParsedLabel, LinearError> {
        let mut input = serde_json::json!({ "name": name, "color": color });
        if let Some(t) = team_id {
            input["teamId"] = serde_json::Value::String(t.to_string());
        }
        let req = serde_json::json!({ "query": label_create_mutation(), "variables": { "input": input } });
        parse_label_create(&self.post(auth, req).await?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_issues_page_with_pageinfo() {
        let body = r##"{"data":{"issues":{"pageInfo":{"hasNextPage":true,"endCursor":"C1"},
          "nodes":[{"id":"i1","identifier":"ENG-1","title":"T","description":null,
          "dueDate":"2026-06-10","startedAt":"2026-06-08T05:00:00Z","priority":2,"url":"u","createdAt":"c","updatedAt":"u1","archivedAt":null,
          "estimate":3,"cycle":{"id":"cy1","number":7,"name":"Sprint 7"},
          "projectMilestone":{"id":"m1","name":"Beta"},
          "attachments":{"nodes":[{"url":"https://github.com/o/r/pull/12"},
            {"url":"https://example.com/doc"},{"url":"https://gitlab.com/o/r/-/merge_requests/3"}]},
          "state":{"id":"s","name":"Todo","type":"unstarted","color":"#fff"},
          "assignee":{"id":"me","name":"Me"},"team":{"id":"t","key":"ENG"},
          "project":{"id":"p","name":"P"},"parent":null,
          "labels":{"nodes":[{"id":"l1","name":"bug","color":"#f00"}]}}]}}}"##;
        let page = parse_issues_page(body).unwrap();
        assert!(page.has_next);
        assert_eq!(page.end_cursor.as_deref(), Some("C1"));
        assert_eq!(page.issues.len(), 1);
        let i = &page.issues[0];
        assert_eq!(i.identifier, "ENG-1");
        assert_eq!(i.priority, 2);
        assert_eq!(i.started_at.as_deref(), Some("2026-06-08T05:00:00Z"));
        assert_eq!(i.team_key.as_deref(), Some("ENG"));
        assert_eq!(i.estimate, Some(3.0));
        assert_eq!(i.cycle_number, Some(7));
        assert_eq!(i.cycle_name.as_deref(), Some("Sprint 7"));
        assert_eq!(i.milestone_name.as_deref(), Some("Beta"));
        assert_eq!(i.pr_count, 2); // github pull + gitlab merge_request
        assert_eq!(i.link_count, 1); // the plain doc link
        assert_eq!(i.labels.len(), 1);
        assert_eq!(i.archived_at, None);
        assert!(!i.raw_json.is_empty());
    }

    #[test]
    fn node_to_issue_parses_relations() {
        let n = serde_json::json!({
            "id": "1", "identifier": "ENG-1", "title": "T", "url": "u",
            "createdAt": "c", "updatedAt": "u",
            "attachments": { "nodes": [] },
            "labels": { "nodes": [] },
            "relations": { "nodes": [
                { "type": "blocks", "relatedIssue": {
                    "id": "2", "identifier": "ENG-2", "title": "Other",
                    "state": { "name": "In Progress", "type": "started", "color": "#abc" }
                }}
            ]}
        });
        let p = node_to_issue(&n);
        assert_eq!(p.relations.len(), 1);
        assert_eq!(p.relations[0].related_id, "2");
        assert_eq!(p.relations[0].r#type, "blocks");
        assert_eq!(p.relations[0].related_identifier.as_deref(), Some("ENG-2"));
        assert_eq!(
            p.relations[0].related_state_type.as_deref(),
            Some("started")
        );
    }

    #[test]
    fn parse_users_extracts_profile_fields() {
        let body = r##"{"data":{"users":{"nodes":[
            {"id":"u1","name":"Abrar Mahir Esam","avatarUrl":"https://public.linear.app/a.png",
             "displayName":"abrar","timezone":"Asia/Dhaka","teams":{"nodes":[{"name":"Psycloud"}]}},
            {"id":"u2","name":"No Extras","avatarUrl":null,"displayName":null,"timezone":null,"teams":{"nodes":[]}}
        ]}}}"##;
        let users = parse_users(body).unwrap();
        assert_eq!(users[0].avatar_url.as_deref(), Some("https://public.linear.app/a.png"));
        assert_eq!(users[0].display_name.as_deref(), Some("abrar"));
        assert_eq!(users[0].timezone.as_deref(), Some("Asia/Dhaka"));
        assert_eq!(users[0].team_name.as_deref(), Some("Psycloud"));
        // Nulls / empty team connection degrade to None, not a panic.
        assert_eq!(users[1].display_name, None);
        assert_eq!(users[1].team_name, None);
    }

    #[test]
    fn patch_to_input_sets_and_clears_parent() {
        let set = UpdateIssuePatch {
            parent_id: Some(Some("p1".into())),
            ..Default::default()
        };
        assert_eq!(patch_to_input(&set)["parentId"], serde_json::json!("p1"));

        let clear = UpdateIssuePatch {
            parent_id: Some(None),
            ..Default::default()
        };
        assert_eq!(patch_to_input(&clear)["parentId"], Value::Null);

        let absent = UpdateIssuePatch::default();
        assert!(patch_to_input(&absent).get("parentId").is_none());
    }

    #[test]
    fn parse_relation_create_extracts_target() {
        let body = r##"{"data":{"issueRelationCreate":{"success":true,"issueRelation":{
            "type":"blocks","relatedIssue":{"id":"2","identifier":"ENG-2","title":"Other",
            "state":{"name":"Todo","type":"unstarted","color":"#abc"}}}}}}"##;
        let r = parse_relation_create(body).unwrap();
        assert_eq!(r.related_id, "2");
        assert_eq!(r.r#type, "blocks");
        assert_eq!(r.related_identifier.as_deref(), Some("ENG-2"));
        assert_eq!(r.related_state_type.as_deref(), Some("unstarted"));
    }

    #[test]
    fn parse_relation_create_rejects_failure() {
        let body = r##"{"data":{"issueRelationCreate":{"success":false,"issueRelation":null}}}"##;
        assert!(parse_relation_create(body).is_err());
    }

    #[test]
    fn parses_notifications_and_drops_non_issue_nodes() {
        let body = r##"{"data":{"notifications":{"pageInfo":{"hasNextPage":true},"nodes":[
          {"id":"n1","type":"issueMention","createdAt":"2026-06-20T08:00:00Z","readAt":null,
           "actor":{"name":"Jakob Schwarz"},
           "issue":{"id":"i1","identifier":"PSY-410","title":"Product Decision",
             "state":{"type":"unstarted","color":"#aaa"},"project":{"name":"Psycloud"}}},
          {"id":"n2","type":"issueAddedToView","createdAt":"2026-06-19T08:00:00Z","readAt":"2026-06-19T09:00:00Z",
           "actor":{"name":"Jakob Schwarz"},
           "issue":{"id":"i2","identifier":"PSY-372","title":"Webhooks",
             "state":{"type":"completed","color":"#5b5"},"project":null}},
          {"id":"n3","type":"projectUpdate","createdAt":"2026-06-18T08:00:00Z","readAt":null,
           "actor":{"name":"Bot"}}
        ]}}}"##;
        let page = parse_notifications(body).unwrap();
        assert!(page.has_more);
        let ns = page.notifications;
        assert_eq!(ns.len(), 2); // the project notification (no issue) is dropped
        assert_eq!(ns[0].issue_identifier, "PSY-410");
        assert!(!ns[0].read);
        assert_eq!(ns[0].actor_name.as_deref(), Some("Jakob Schwarz"));
        assert_eq!(ns[0].issue_project_name.as_deref(), Some("Psycloud"));
        assert!(ns[1].read);
        assert_eq!(ns[1].issue_state_type, "completed");
        assert_eq!(ns[1].issue_project_name, None);
    }

    #[test]
    fn preserves_fractional_estimates_and_rejects_spoofed_pr_urls() {
        let body = r##"{"data":{"issues":{"pageInfo":{"hasNextPage":false,"endCursor":null},
          "nodes":[{"id":"i1","identifier":"ENG-1","title":"T","priority":0,"url":"u",
          "createdAt":"c","updatedAt":"u","estimate":2.5,
          "attachments":{"pageInfo":{"hasNextPage":true},"nodes":[
            {"url":"https://github.com/o/r/pull/12"},
            {"url":"https://example.com/github.com/o/r/pull/12"},
            {"url":"https://github.com/o/r/pull/not-a-number"}]},
          "labels":{"nodes":[]}}]}}}"##;
        let issue = &parse_issues_page(body).unwrap().issues[0];
        assert_eq!(issue.estimate, Some(2.5));
        assert_eq!(issue.pr_count, 1);
        assert_eq!(issue.link_count, 2);
        assert!(issue.attachments_truncated);
    }

    #[test]
    fn parses_drawer_children_resources_and_activity_history() {
        let body = r##"{"data":{"issue":{"id":"i1","identifier":"AST-1","title":"Parent",
          "priority":2,"url":"https://linear.app/issue/AST-1","createdAt":"2026-06-19T08:00:00Z",
          "updatedAt":"2026-06-19T09:00:00Z","creator":{"name":"Abrar"},
          "attachments":{"pageInfo":{"hasNextPage":false},"nodes":[
            {"id":"a1","title":"Message from Abrar","subtitle":"#issues","url":"https://linear.app/attachment/a1","sourceType":"slack","createdAt":"2026-06-19T08:30:00Z",
             "bodyData":null,"metadata":{"messages":[{"subject":"Thread","body":"The complete Slack message","timestamp":"2026-06-19T08:29:00Z"}]}}]},
          "labels":{"nodes":[]},"team":{"id":"t1","key":"AST","states":{"nodes":[]}},
          "children":{"pageInfo":{"hasNextPage":false},"nodes":[
            {"id":"c1","identifier":"AST-2","title":"Child","priority":1,"dueDate":"2026-06-25","estimate":3,
             "state":{"name":"In Progress","type":"started","color":"#eab308"},"assignee":{"name":"Abrar"},
             "project":{"name":"M1"},"cycle":{"number":4,"name":"Cycle 4"}}]},
          "relations":{"pageInfo":{"hasNextPage":false},"nodes":[
            {"type":"blocks","relatedIssue":{"id":"r1","identifier":"AST-7","title":"Blocked work",
             "state":{"type":"started","color":"#eab308"}}}]},
          "comments":{"pageInfo":{"hasNextPage":false},"nodes":[
            {"id":"cm1","body":"Looks good","createdAt":"2026-06-19T10:00:00Z","editedAt":"2026-06-19T10:05:00Z",
             "parent":null,"user":{"id":"u1","name":"Abrar"},
             "reactions":[{"id":"re1","emoji":"👍","user":{"id":"u2","name":"Jakob"}}]},
            {"id":"cm2","body":"Agreed","createdAt":"2026-06-19T11:00:00Z","editedAt":null,
             "parent":{"id":"cm1"},"user":{"id":"u2","name":"Jakob"},"reactions":[]}]},
          "history":{"pageInfo":{"hasNextPage":false},"nodes":[
            {"id":"h1","createdAt":"2026-06-19T09:00:00Z","actor":{"name":"Abrar"},
             "fromState":{"name":"Todo"},"toState":{"name":"In Progress","type":"started","color":"#eab308"},"updatedDescription":false,
             "relationChanges":[{"type":"related","identifier":"AST-9"}],"attachment":null}]}
        }}}"##;

        let detail = parse_issue_detail(body).unwrap();
        assert_eq!(detail.creator_name.as_deref(), Some("Abrar"));
        assert_eq!(detail.children[0].state_name, "In Progress");
        assert_eq!(detail.children[0].priority, 1);
        assert_eq!(detail.relations[0].r#type, "blocks");
        assert_eq!(detail.relations[0].issue.identifier, "AST-7");
        assert_eq!(
            detail.relations[0].issue.state_type.as_deref(),
            Some("started")
        );
        assert_eq!(
            detail.relations[0].issue.state_color.as_deref(),
            Some("#eab308")
        );
        assert_eq!(detail.children[0].due_date.as_deref(), Some("2026-06-25"));
        assert_eq!(detail.attachments[0].title, "Message from Abrar");
        assert_eq!(detail.attachments[0].source_type.as_deref(), Some("slack"));
        assert_eq!(
            detail.attachments[0].body.as_deref(),
            Some("The complete Slack message")
        );
        assert_eq!(detail.history[0].from_state_name.as_deref(), Some("Todo"));
        assert_eq!(
            detail.history[0].to_state_name.as_deref(),
            Some("In Progress")
        );
        assert_eq!(detail.history[0].to_state_type.as_deref(), Some("started"));
        assert_eq!(detail.history[0].relation_changes[0].identifier, "AST-9");
        assert!(!detail.has_more_history);
        assert_eq!(detail.comments[0].user_id.as_deref(), Some("u1"));
        assert_eq!(
            detail.comments[0].edited_at.as_deref(),
            Some("2026-06-19T10:05:00Z")
        );
        assert_eq!(detail.comments[0].reactions[0].emoji, "👍");
        assert_eq!(
            detail.comments[0].reactions[0].user_id.as_deref(),
            Some("u2")
        );
        assert_eq!(detail.comments[1].parent_id.as_deref(), Some("cm1"));
    }

    #[test]
    fn graphql_ratelimited_is_rate_limited() {
        let body = r#"{"errors":[{"message":"slow down","extensions":{"code":"RATELIMITED"}}]}"#;
        assert!(matches!(
            parse_issues_page(body),
            Err(LinearError::RateLimited(_))
        ));
    }

    #[test]
    fn malformed_body_is_malformed() {
        assert!(matches!(
            parse_issues_page("nope"),
            Err(LinearError::Malformed)
        ));
    }

    #[test]
    fn parses_org_identity() {
        let body = r#"{"data":{"viewer":{"id":"v1","name":"Me",
          "organization":{"id":"o1","name":"GAM","urlKey":"gam"}}}}"#;
        let o = parse_viewer_with_org(body).unwrap();
        assert_eq!(o.viewer_id, "v1");
        assert_eq!(o.org_id, "o1");
        assert_eq!(o.org_url_key, "gam");
    }

    #[test]
    fn parses_team_scoped_workflow_states_including_empty_columns() {
        let body = r##"{"data":{"workflowStates":{"nodes":[
          {"id":"s1","name":"Todo","type":"unstarted","color":"#aaa","team":{"id":"t1"}}
        ]}}}"##;
        let states = parse_workflow_states(body).unwrap();
        assert_eq!(states.len(), 1);
        assert_eq!(states[0].team_id, "t1");
        assert_eq!(states[0].name, "Todo");
    }

    #[test]
    fn patch_tristate_maps_to_graphql_input() {
        // omitted -> field absent
        let p: UpdateIssuePatch = serde_json::from_str("{}").unwrap();
        assert_eq!(patch_to_input(&p), serde_json::json!({}));
        // explicit null -> clear
        let p: UpdateIssuePatch = serde_json::from_str(r#"{"dueDate":null}"#).unwrap();
        assert_eq!(patch_to_input(&p), serde_json::json!({"dueDate": null}));
        // value -> set
        let p: UpdateIssuePatch =
            serde_json::from_str(r#"{"dueDate":"2026-06-12","priority":1}"#).unwrap();
        assert_eq!(
            patch_to_input(&p),
            serde_json::json!({"dueDate":"2026-06-12","priority":1})
        );
    }

    #[test]
    fn patch_maps_labels_project_estimate_cycle() {
        let p: UpdateIssuePatch = serde_json::from_str(
            r#"{"labelIds":["a","b"],"projectId":"p1","estimate":5,"cycleId":null}"#,
        )
        .unwrap();
        assert_eq!(
            patch_to_input(&p),
            serde_json::json!({
                "labelIds": ["a", "b"],
                "projectId": "p1",
                "estimate": 5.0,
                "cycleId": null
            })
        );
        // estimate cleared, project cleared
        let p: UpdateIssuePatch =
            serde_json::from_str(r#"{"estimate":null,"projectId":null}"#).unwrap();
        assert_eq!(
            patch_to_input(&p),
            serde_json::json!({ "estimate": null, "projectId": null })
        );
        // move to another team
        let p: UpdateIssuePatch = serde_json::from_str(r#"{"teamId":"team-2"}"#).unwrap();
        assert_eq!(
            patch_to_input(&p),
            serde_json::json!({ "teamId": "team-2" })
        );
    }

    #[test]
    fn parses_issue_delete_success() {
        assert!(parse_issue_delete(r#"{"data":{"issueDelete":{"success":true}}}"#).is_ok());
        assert!(parse_issue_delete(r#"{"data":{"issueDelete":{"success":false}}}"#).is_err());
    }

    #[test]
    fn create_input_requires_team_title_and_includes_present_fields() {
        // minimal: only the required fields
        let p: CreateIssueInput =
            serde_json::from_str(r#"{"teamId":"t1","title":"Hello"}"#).unwrap();
        assert_eq!(
            create_input_to_value(&p),
            serde_json::json!({ "teamId": "t1", "title": "Hello" })
        );
        // full: optional fields included only when present
        let p: CreateIssueInput = serde_json::from_str(
            r#"{"teamId":"t1","title":"H","priority":2,"assigneeId":"u1",
                "labelIds":["a"],"projectId":"p1","estimate":3,"dueDate":"2026-07-01"}"#,
        )
        .unwrap();
        assert_eq!(
            create_input_to_value(&p),
            serde_json::json!({
                "teamId": "t1", "title": "H", "priority": 2, "assigneeId": "u1",
                "labelIds": ["a"], "projectId": "p1", "estimate": 3.0, "dueDate": "2026-07-01"
            })
        );

        let blank_team: CreateIssueInput =
            serde_json::from_str(r#"{"teamId":"  ","title":"Hello"}"#).unwrap();
        assert!(validate_create_input(&blank_team).is_err());
        let blank_title: CreateIssueInput =
            serde_json::from_str(r#"{"teamId":"t1","title":"\n\t"}"#).unwrap();
        assert!(validate_create_input(&blank_title).is_err());
        assert!(validate_create_input(&p).is_ok());
    }

    #[test]
    fn parses_issue_create_returned_issue() {
        let body = r##"{"data":{"issueCreate":{"success":true,"issue":{"id":"new1","identifier":"PSY-9",
          "title":"New","description":null,"dueDate":null,"priority":0,"url":"u","createdAt":"c","updatedAt":"u1","archivedAt":null,
          "state":{"id":"s","name":"Backlog","type":"backlog","color":"#aaa"},"assignee":null,
          "team":{"id":"t","key":"PSY"},"project":null,"cycle":null,"parent":null,
          "labels":{"nodes":[]}}}}}"##;
        let i = parse_issue_create(body).unwrap();
        assert_eq!(i.id, "new1");
        assert_eq!(i.identifier, "PSY-9");
        assert!(parse_issue_create(r#"{"data":{"issueCreate":{"success":false}}}"#).is_err());
    }

    #[test]
    fn parses_issue_update_returned_issue() {
        let body = r##"{"data":{"issueUpdate":{"success":true,"issue":{"id":"i1","identifier":"ENG-1",
          "title":"T","description":null,"dueDate":null,"priority":0,"url":"u","createdAt":"c","updatedAt":"u2","archivedAt":null,
          "state":{"id":"s","name":"Todo","type":"unstarted","color":"#fff"},"assignee":null,
          "team":{"id":"t","key":"ENG"},"project":null,"cycle":null,"parent":null,
          "labels":{"nodes":[]}}}}}"##;
        let i = parse_issue_update(body).unwrap();
        assert_eq!(i.id, "i1");
        assert_eq!(i.updated_at, "u2");
        assert_eq!(i.assignee_id, None);
    }

    #[test]
    fn parses_comment_create() {
        let body = r##"{"data":{"commentCreate":{"success":true,"comment":{
          "id":"cm9","body":"Hi","createdAt":"2026-06-20T09:00:00Z","editedAt":null,
          "parent":null,"user":{"id":"u1","name":"Abrar"},"reactions":[]}}}}"##;
        let c = parse_comment_create(body).unwrap();
        assert_eq!(c.id, "cm9");
        assert_eq!(c.body, "Hi");
        assert!(parse_comment_create(r#"{"data":{"commentCreate":{"success":false}}}"#).is_err());
    }

    #[test]
    fn parses_reaction_create_and_delete() {
        let body = r##"{"data":{"reactionCreate":{"success":true,"reaction":{
          "id":"re9","emoji":"🎉","user":{"id":"u1","name":"Abrar"}}}}}"##;
        let r = parse_reaction_create(body).unwrap();
        assert_eq!(r.emoji, "🎉");
        assert_eq!(r.user_id.as_deref(), Some("u1"));
        assert!(parse_reaction_delete(r#"{"data":{"reactionDelete":{"success":true}}}"#).is_ok());
        assert!(parse_reaction_create(r#"{"data":{"reactionCreate":{"success":false}}}"#).is_err());
    }

    #[test]
    fn parses_label_create() {
        let body = r##"{"data":{"issueLabelCreate":{"success":true,"issueLabel":{
          "id":"l9","name":"infra","color":"#8b5cf6"}}}}"##;
        let l = parse_label_create(body).unwrap();
        assert_eq!(l.id, "l9");
        assert_eq!(l.name.as_deref(), Some("infra"));
        assert!(parse_label_create(r#"{"data":{"issueLabelCreate":{"success":false}}}"#).is_err());
    }

    #[test]
    fn parses_comment_update_and_delete() {
        let upd = r##"{"data":{"commentUpdate":{"success":true,"comment":{
          "id":"cm9","body":"Edited","createdAt":"2026-06-20T09:00:00Z","editedAt":"2026-06-20T09:30:00Z",
          "parent":null,"user":{"id":"u1","name":"Abrar"},"reactions":[]}}}}"##;
        assert_eq!(parse_comment_update(upd).unwrap().body, "Edited");
        assert!(parse_comment_delete(r#"{"data":{"commentDelete":{"success":true}}}"#).is_ok());
        assert!(parse_comment_delete(r#"{"data":{"commentDelete":{"success":false}}}"#).is_err());
    }
}
