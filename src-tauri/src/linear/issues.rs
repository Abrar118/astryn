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
pub struct ParsedIssue {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub description: Option<String>,
    pub due_date: Option<String>,
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
    pub estimate: Option<i64>,
    pub cycle_name: Option<String>,
    pub cycle_number: Option<i64>,
    pub milestone_name: Option<String>,
    pub link_count: i64,
    pub pr_count: i64,
    pub created_at: String,
    pub updated_at: String,
    pub archived_at: Option<String>,
    pub labels: Vec<ParsedLabel>,
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
    pub avatar_url: Option<String>,
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
    url.contains("/pull/") || url.contains("/merge_requests/") || url.contains("/pull-requests/")
}

/// Count an issue's attachments, split into pull requests vs. other links.
fn classify_attachments(n: &Value) -> (i64, i64) {
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
    (links, prs)
}

fn node_to_issue(n: &Value) -> ParsedIssue {
    let (link_count, pr_count) = classify_attachments(n);
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
    ParsedIssue {
        id: s(n, "id").unwrap_or_default(),
        identifier: s(n, "identifier").unwrap_or_default(),
        title: s(n, "title").unwrap_or_default(),
        description: s(n, "description"),
        due_date: s(n, "dueDate"),
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
        estimate: n.get("estimate").and_then(|x| x.as_f64()).map(|f| f as i64),
        cycle_name: nested(n, "cycle", "name"),
        cycle_number: n
            .get("cycle")
            .and_then(|c| c.get("number"))
            .and_then(|x| x.as_i64()),
        milestone_name: nested(n, "projectMilestone", "name"),
        link_count,
        pr_count,
        created_at: s(n, "createdAt").unwrap_or_default(),
        updated_at: s(n, "updatedAt").unwrap_or_default(),
        archived_at: s(n, "archivedAt"),
        labels,
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
            })
        })
        .collect())
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

// ---- issue detail (drawer) ----
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailRef {
    pub id: String,
    pub identifier: String,
    pub title: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailChild {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub state_type: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailRelation {
    pub r#type: String,
    pub issue: DetailRef,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetailComment {
    pub id: String,
    pub body: String,
    pub user_name: Option<String>,
    pub created_at: String,
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
    pub team_states: Vec<DetailState>,
    pub cycle: Option<DetailCycle>,
    pub parent: Option<DetailRef>,
    pub children: Vec<DetailChild>,
    pub relations: Vec<DetailRelation>,
    pub comments: Vec<DetailComment>,
    pub has_more_children: bool,
    pub has_more_relations: bool,
    pub has_more_comments: bool,
}

fn conn_has_next(n: &Value, conn: &str) -> bool {
    n.get(conn)
        .and_then(|c| c.get("pageInfo"))
        .and_then(|p| p.get("hasNextPage"))
        .and_then(|b| b.as_bool())
        .unwrap_or(false)
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
        .map(|arr| {
            arr.iter()
                .map(|c| DetailComment {
                    id: s(c, "id").unwrap_or_default(),
                    body: s(c, "body").unwrap_or_default(),
                    user_name: nested(c, "user", "name"),
                    created_at: s(c, "createdAt").unwrap_or_default(),
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(IssueDetailNode {
        issue,
        team_states,
        cycle,
        parent,
        children,
        relations,
        comments,
        has_more_children: conn_has_next(n, "children"),
        has_more_relations: conn_has_next(n, "relations"),
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
    pub estimate: Option<Option<i64>>,
    #[serde(default, deserialize_with = "double_option")]
    pub cycle_id: Option<Option<String>>,
}

/// Build the GraphQL `IssueUpdateInput`. Omitted => absent; Some(None) => null (clear).
pub fn patch_to_input(p: &UpdateIssuePatch) -> Value {
    let mut m = serde_json::Map::new();
    if let Some(v) = &p.title {
        m.insert("title".into(), Value::String(v.clone()));
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
    pub estimate: Option<i64>,
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

// ---- GraphQL query strings + LinearClient methods ----
const ISSUE_NODE_FIELDS: &str = "id identifier title description dueDate priority url createdAt updatedAt archivedAt
  estimate cycle { id number name } projectMilestone { id name }
  attachments(first: 50) { nodes { url } }
  state { id name type color } assignee { id name } team { id key } project { id name } parent { id }
  labels { nodes { id name color } }";

fn issues_query() -> String {
    format!(
        "query Issues($after: String, $filter: IssueFilter) {{
           issues(first: 100, after: $after, filter: $filter, includeArchived: true, orderBy: updatedAt) {{
             pageInfo {{ hasNextPage endCursor }}
             nodes {{ {ISSUE_NODE_FIELDS} }}
           }}
         }}"
    )
}

fn issue_detail_query() -> String {
    format!(
        "query Issue($id: String!) {{
           issue(id: $id) {{
             {ISSUE_NODE_FIELDS}
             team {{ id key states(first: 50) {{ nodes {{ id name type color }} }} }}
             parent {{ id identifier title }}
             children(first: 50) {{ pageInfo {{ hasNextPage }} nodes {{ id identifier title state {{ type }} }} }}
             relations(first: 50) {{ pageInfo {{ hasNextPage }} nodes {{ type relatedIssue {{ id identifier title }} }} }}
             comments(first: 50) {{ pageInfo {{ hasNextPage }} nodes {{ id body createdAt user {{ name }} }} }}
           }}
         }}"
    )
}

const USERS_QUERY: &str = "query { users(first: 250) { nodes { id name avatarUrl } } }";
const LABELS_QUERY: &str = "query { issueLabels(first: 250) { nodes { id name color } } }";
const CYCLES_QUERY: &str = "query { cycles(first: 250) { nodes { id number name team { id } } } }";
const ISSUE_DELETE_MUTATION: &str = "mutation D($id: String!) { issueDelete(id: $id) { success } }";
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

    pub async fn cycles(&self, auth: &str) -> Result<Vec<ParsedCycle>, LinearError> {
        let body = serde_json::json!({ "query": CYCLES_QUERY });
        parse_cycles(&self.post(auth, body).await?)
    }

    pub async fn delete_issue(&self, auth: &str, id: &str) -> Result<(), LinearError> {
        let body = serde_json::json!({ "query": ISSUE_DELETE_MUTATION, "variables": { "id": id } });
        parse_issue_delete(&self.post(auth, body).await?)
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_issues_page_with_pageinfo() {
        let body = r##"{"data":{"issues":{"pageInfo":{"hasNextPage":true,"endCursor":"C1"},
          "nodes":[{"id":"i1","identifier":"ENG-1","title":"T","description":null,
          "dueDate":"2026-06-10","priority":2,"url":"u","createdAt":"c","updatedAt":"u1","archivedAt":null,
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
        assert_eq!(i.team_key.as_deref(), Some("ENG"));
        assert_eq!(i.estimate, Some(3));
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
                "estimate": 5,
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
                "labelIds": ["a"], "projectId": "p1", "estimate": 3, "dueDate": "2026-07-01"
            })
        );
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
}
