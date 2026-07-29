//! Parsing for the rate-limit headers GitHub attaches to every REST response.

/// The request budget GitHub reports for the current window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RateBudget {
    pub limit: u32,
    pub remaining: u32,
    /// Unix seconds at which the window rolls over.
    pub resets_at: i64,
}

impl RateBudget {
    /// True once the window is spent and further calls will be rejected.
    pub fn is_exhausted(&self) -> bool {
        self.remaining == 0
    }

    /// Fraction of the window still available, `0.0` through `1.0`.
    pub fn headroom(&self) -> f32 {
        if self.limit == 0 {
            return 0.0;
        }
        self.remaining as f32 / self.limit as f32
    }
}

/// Read the `x-ratelimit-*` headers into a [`RateBudget`].
///
/// Returns `None` when any header is missing or unparseable. Callers treat
/// that as "no budget information", never as an exhausted budget — GitHub
/// omits these headers on some cached and error responses.
pub fn parse_rate_budget(header: impl Fn(&str) -> Option<String>) -> Option<RateBudget> {
    let limit = header("x-ratelimit-limit")?.trim().parse().ok()?;
    let remaining = header("x-ratelimit-remaining")?.trim().parse().ok()?;
    let resets_at = header("x-ratelimit-reset")?.trim().parse().ok()?;
    Some(RateBudget {
        limit,
        remaining,
        resets_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
        move |name| {
            pairs
                .iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| (*value).to_string())
        }
    }

    #[test]
    fn parses_a_complete_header_set() {
        let budget = parse_rate_budget(headers(&[
            ("x-ratelimit-limit", "5000"),
            ("x-ratelimit-remaining", "4000"),
            ("x-ratelimit-reset", "1753800000"),
        ]))
        .expect("a budget");

        assert_eq!(budget.limit, 5000);
        assert_eq!(budget.remaining, 4000);
        assert_eq!(budget.resets_at, 1_753_800_000);
        assert!(!budget.is_exhausted());
        assert!((budget.headroom() - 0.8).abs() < 1e-6);
    }

    #[test]
    fn returns_none_when_a_header_is_missing() {
        assert!(parse_rate_budget(headers(&[("x-ratelimit-limit", "5000")])).is_none());
    }

    #[test]
    fn returns_none_for_unparseable_values() {
        assert!(parse_rate_budget(headers(&[
            ("x-ratelimit-limit", "5000"),
            ("x-ratelimit-remaining", "plenty"),
            ("x-ratelimit-reset", "1753800000"),
        ]))
        .is_none());
    }

    #[test]
    fn a_spent_window_is_exhausted() {
        let budget = RateBudget {
            limit: 5000,
            remaining: 0,
            resets_at: 0,
        };
        assert!(budget.is_exhausted());
        assert_eq!(budget.headroom(), 0.0);
    }
}
