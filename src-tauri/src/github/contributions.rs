use serde_json::{json, Value};

use super::GitHubError;

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContribDay {
    pub date: String,
    pub count: i64,
    /// 0 = Sunday … 6 = Saturday (used to pad partial edge weeks to 7 rows).
    pub weekday: i64,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Contributions {
    pub total: i64,
    /// Weeks oldest→newest; each carries that GitHub week's contribution days
    /// (the first/last week may be partial — the renderer pads by weekday).
    pub weeks: Vec<Vec<ContribDay>>,
}

const CONTRIB_QUERY: &str = r#"query{
  viewer {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount weekday } }
      }
    }
  }
}"#;

pub fn contributions_query_body() -> Value {
    json!({ "query": CONTRIB_QUERY })
}

/// Parse the viewer's contribution calendar. Any missing/invalid required field
/// is `Malformed` — never a silent empty calendar.
pub fn parse_contributions(data: &Value) -> Result<Contributions, GitHubError> {
    let cal = data
        .get("viewer")
        .and_then(|v| v.get("contributionsCollection"))
        .and_then(|c| c.get("contributionCalendar"))
        .ok_or(GitHubError::Malformed)?;
    let total = cal
        .get("totalContributions")
        .and_then(Value::as_i64)
        .ok_or(GitHubError::Malformed)?;
    let weeks_v = cal
        .get("weeks")
        .and_then(|w| w.as_array())
        .ok_or(GitHubError::Malformed)?;
    let mut weeks = Vec::with_capacity(weeks_v.len());
    for w in weeks_v {
        let days_v = w
            .get("contributionDays")
            .and_then(|d| d.as_array())
            .ok_or(GitHubError::Malformed)?;
        let mut days = Vec::with_capacity(days_v.len());
        for d in days_v {
            days.push(ContribDay {
                date: d
                    .get("date")
                    .and_then(|x| x.as_str())
                    .ok_or(GitHubError::Malformed)?
                    .to_string(),
                count: d
                    .get("contributionCount")
                    .and_then(Value::as_i64)
                    .ok_or(GitHubError::Malformed)?,
                weekday: d
                    .get("weekday")
                    .and_then(Value::as_i64)
                    .ok_or(GitHubError::Malformed)?,
            });
        }
        weeks.push(days);
    }
    Ok(Contributions { total, weeks })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Value {
        json!({
            "viewer": { "contributionsCollection": { "contributionCalendar": {
                "totalContributions": 2125,
                "weeks": [
                    { "contributionDays": [
                        { "date": "2025-06-15", "contributionCount": 3, "weekday": 0 },
                        { "date": "2025-06-16", "contributionCount": 0, "weekday": 1 }
                    ] }
                ]
            } } }
        })
    }

    #[test]
    fn parses_total_and_days() {
        let c = parse_contributions(&sample()).unwrap();
        assert_eq!(c.total, 2125);
        assert_eq!(c.weeks.len(), 1);
        assert_eq!(c.weeks[0].len(), 2);
        assert_eq!(c.weeks[0][0].count, 3);
        assert_eq!(c.weeks[0][1].weekday, 1);
    }

    #[test]
    fn missing_calendar_is_malformed() {
        assert!(matches!(
            parse_contributions(&json!({})),
            Err(GitHubError::Malformed)
        ));
        let no_total = json!({ "viewer": { "contributionsCollection": { "contributionCalendar": { "weeks": [] } } } });
        assert!(matches!(
            parse_contributions(&no_total),
            Err(GitHubError::Malformed)
        ));
    }
}
