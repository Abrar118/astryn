//! Retry pacing for Linear's rate limiter.

const BASE_DELAY_MS: u64 = 500;
const MAX_DELAY_MS: u64 = 30_000;
const MAX_ATTEMPTS: u32 = 5;

/// Delay before retry `attempt` (1-based), honouring a server-supplied
/// `retry_after_s` when Linear sends one.
///
/// `jitter` is supplied by the caller in `0.0..=1.0` so the schedule stays
/// deterministic under test; production passes a random draw. Returns `None`
/// once the retry budget is spent.
pub fn retry_delay_ms(attempt: u32, retry_after_s: Option<i64>, jitter: f64) -> Option<u64> {
    if !should_retry(attempt) {
        return None;
    }

    // Linear's own Retry-After wins whenever it gives us one.
    if let Some(seconds) = retry_after_s {
        if seconds > 0 {
            return Some((seconds as u64).saturating_mul(1_000).min(MAX_DELAY_MS));
        }
    }

    let ceiling = BASE_DELAY_MS
        .saturating_mul(1u64 << (attempt - 1))
        .min(MAX_DELAY_MS);

    // Half fixed, half jittered: parallel page fetches that trip the limiter
    // together must not all wake up together and trip it again.
    let spread = (ceiling as f64 * jitter.clamp(0.0, 1.0)) as u64;
    Some((ceiling / 2 + spread / 2).max(BASE_DELAY_MS))
}

/// True while `attempt` is still inside the retry budget.
pub fn should_retry(attempt: u32) -> bool {
    attempt > 0 && attempt <= MAX_ATTEMPTS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grows_the_ceiling_with_each_attempt() {
        assert_eq!(retry_delay_ms(1, None, 1.0), Some(500));
        assert_eq!(retry_delay_ms(2, None, 1.0), Some(1_000));
        assert_eq!(retry_delay_ms(3, None, 1.0), Some(2_000));
        assert_eq!(retry_delay_ms(5, None, 1.0), Some(8_000));
    }

    #[test]
    fn jitter_never_drops_below_the_base_delay() {
        assert_eq!(retry_delay_ms(1, None, 0.0), Some(500));
        assert_eq!(retry_delay_ms(4, None, 0.0), Some(2_000));
    }

    #[test]
    fn jitter_is_clamped_to_the_unit_interval() {
        assert_eq!(retry_delay_ms(3, None, 9.0), retry_delay_ms(3, None, 1.0));
        assert_eq!(retry_delay_ms(3, None, -4.0), retry_delay_ms(3, None, 0.0));
    }

    #[test]
    fn a_server_retry_after_wins() {
        assert_eq!(retry_delay_ms(1, Some(12), 1.0), Some(12_000));
    }

    #[test]
    fn a_server_retry_after_is_capped() {
        assert_eq!(retry_delay_ms(1, Some(600), 1.0), Some(MAX_DELAY_MS));
    }

    #[test]
    fn a_nonpositive_retry_after_falls_back_to_the_ceiling() {
        assert_eq!(retry_delay_ms(2, Some(0), 1.0), Some(1_000));
    }

    #[test]
    fn stops_once_the_budget_is_spent() {
        assert!(should_retry(MAX_ATTEMPTS));
        assert!(!should_retry(MAX_ATTEMPTS + 1));
        assert!(!should_retry(0));
        assert_eq!(retry_delay_ms(MAX_ATTEMPTS + 1, None, 0.5), None);
        assert_eq!(retry_delay_ms(0, None, 0.5), None);
    }
}
