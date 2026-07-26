//! Minimal OpenAI-compatible chat client (Ollama, LM Studio, vLLM, OpenAI…).
//! Speaks `POST {base}/v1/chat/completions` with `stream: true` and parses the
//! SSE frames incrementally so tokens can be forwarded to the UI as they arrive.

use serde_json::{json, Value};
use std::time::Duration;

#[derive(Debug, Clone, PartialEq)]
pub enum LlmError {
    /// Endpoint unreachable / connection refused / timed out.
    Network,
    /// Non-2xx status or a well-formed error payload.
    Api,
    /// 2xx but the body wasn't the shape we expect.
    Malformed,
    /// Superseded by a newer generation request.
    Canceled,
}

/// Normalize a user-pasted base URL into the chat-completions endpoint.
/// Accepts `http://localhost:11434`, `…/v1`, `…/v1/` or the full path.
pub fn chat_completions_url(base: &str) -> String {
    let mut b = base.trim().trim_end_matches('/');
    for suffix in ["/chat/completions", "/v1"] {
        b = b.trim_end_matches(suffix);
    }
    format!("{}/v1/chat/completions", b.trim_end_matches('/'))
}

/// Sibling endpoint used by the Settings "Test" button.
pub fn models_url(base: &str) -> String {
    chat_completions_url(base).replace("/chat/completions", "/models")
}

/// Incremental SSE parser for OpenAI-style streams: buffers partial lines
/// across network chunks and yields each frame's `choices[0].delta.content`.
#[derive(Default)]
pub struct SseParser {
    buf: String,
}

impl SseParser {
    /// Feed one network chunk; returns the content tokens completed by it.
    pub fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buf.push_str(&String::from_utf8_lossy(chunk));
        let mut tokens = Vec::new();
        // Only consume fully-terminated lines; the tail stays buffered.
        while let Some(nl) = self.buf.find('\n') {
            let line: String = self.buf.drain(..=nl).collect();
            let line = line.trim();
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data == "[DONE]" {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<Value>(data) {
                if let Some(t) = v
                    .pointer("/choices/0/delta/content")
                    .and_then(Value::as_str)
                {
                    if !t.is_empty() {
                        tokens.push(t.to_string());
                    }
                }
            }
        }
        tokens
    }
}

const THINK_OPEN: &str = "<think>";
const THINK_CLOSE: &str = "</think>";

/// Streaming filter that drops `<think>…</think>` spans (reasoning models like
/// phi4-mini-reasoning emit their chain of thought inline). Tags may be split
/// across arbitrary chunk boundaries, so a possible partial tag at the end of
/// the buffer is held back until the next push resolves it.
#[derive(Default)]
pub struct ThinkFilter {
    pending: String,
    in_think: bool,
}

/// Longest suffix of `s` that is a proper prefix of `tag` (candidate split tag).
fn partial_tag_suffix(s: &str, tag: &str) -> usize {
    let max = (tag.len() - 1).min(s.len());
    for take in (1..=max).rev() {
        if s.ends_with(&tag[..take]) {
            return take;
        }
    }
    0
}

impl ThinkFilter {
    /// Feed raw text; returns the visible (non-think) text it releases.
    pub fn push(&mut self, text: &str) -> String {
        self.pending.push_str(text);
        let mut out = String::new();
        loop {
            if self.in_think {
                match self.pending.find(THINK_CLOSE) {
                    Some(i) => {
                        self.pending.drain(..i + THINK_CLOSE.len());
                        self.in_think = false;
                    }
                    None => {
                        // Drop consumed think-text, keep only a possible split "</think>".
                        let keep = partial_tag_suffix(&self.pending, THINK_CLOSE);
                        let cut = self.pending.len() - keep;
                        self.pending.drain(..cut);
                        return out;
                    }
                }
            } else {
                match self.pending.find(THINK_OPEN) {
                    Some(i) => {
                        out.push_str(&self.pending[..i]);
                        self.pending.drain(..i + THINK_OPEN.len());
                        self.in_think = true;
                    }
                    None => {
                        let keep = partial_tag_suffix(&self.pending, THINK_OPEN);
                        let cut = self.pending.len() - keep;
                        out.push_str(&self.pending[..cut]);
                        self.pending.drain(..cut);
                        return out;
                    }
                }
            }
        }
    }

    /// Flush any held-back tail (a lone "<" that never became a tag).
    pub fn finish(&mut self) -> String {
        if self.in_think {
            self.pending.clear();
            return String::new();
        }
        std::mem::take(&mut self.pending)
    }
}

/// Everything one chat call needs (config + the two messages).
pub struct ChatRequest<'a> {
    pub base_url: &'a str,
    pub api_key: Option<&'a str>,
    pub model: &'a str,
    pub system: &'a str,
    pub user: &'a str,
}

pub struct LlmClient {
    http: reqwest::Client,
}

impl LlmClient {
    pub fn new() -> Result<Self, LlmError> {
        let http = reqwest::Client::builder()
            // Local models can take a long time between tokens on cold start;
            // no overall timeout — cancellation comes from the generation guard.
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| LlmError::Network)?;
        Ok(Self { http })
    }

    fn request(&self, url: &str, api_key: Option<&str>) -> reqwest::RequestBuilder {
        let mut req = self.http.post(url).header("User-Agent", "astryn");
        if let Some(k) = api_key {
            req = req.header("Authorization", format!("Bearer {k}"));
        }
        req
    }

    /// Stream a chat completion, invoking `on_token` per visible token
    /// (think-spans filtered out). `keep_going()` is polled between chunks so a
    /// superseded generation stops early. Returns the full filtered text.
    pub async fn stream_chat(
        &self,
        req: ChatRequest<'_>,
        mut keep_going: impl FnMut() -> bool,
        mut on_token: impl FnMut(&str),
    ) -> Result<String, LlmError> {
        let body = json!({
            "model": req.model,
            "stream": true,
            "messages": [
                { "role": "system", "content": req.system },
                { "role": "user", "content": req.user },
            ],
        });
        let mut resp = self
            .request(&chat_completions_url(req.base_url), req.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|_| LlmError::Network)?;
        if !resp.status().is_success() {
            return Err(LlmError::Api);
        }

        let mut sse = SseParser::default();
        let mut filter = ThinkFilter::default();
        let mut text = String::new();
        loop {
            if !keep_going() {
                return Err(LlmError::Canceled);
            }
            let chunk = resp.chunk().await.map_err(|_| LlmError::Network)?;
            let Some(bytes) = chunk else { break };
            for token in sse.push(&bytes) {
                let visible = filter.push(&token);
                if !visible.is_empty() {
                    on_token(&visible);
                    text.push_str(&visible);
                }
            }
        }
        let tail = filter.finish();
        if !tail.is_empty() {
            on_token(&tail);
            text.push_str(&tail);
        }
        if text.trim().is_empty() {
            return Err(LlmError::Malformed);
        }
        Ok(text.trim().to_string())
    }

    /// GET `{base}/v1/models` — the Settings "Test" probe. Returns model ids.
    pub async fn list_models(
        &self,
        base_url: &str,
        api_key: Option<&str>,
    ) -> Result<Vec<String>, LlmError> {
        let mut req = self
            .http
            .get(models_url(base_url))
            .header("User-Agent", "astryn");
        if let Some(k) = api_key {
            req = req.header("Authorization", format!("Bearer {k}"));
        }
        let resp = req.send().await.map_err(|_| LlmError::Network)?;
        if !resp.status().is_success() {
            return Err(LlmError::Api);
        }
        let v: Value = resp.json().await.map_err(|_| LlmError::Malformed)?;
        let models = v
            .get("data")
            .and_then(Value::as_array)
            .ok_or(LlmError::Malformed)?
            .iter()
            .filter_map(|m| m.get("id").and_then(Value::as_str))
            .map(str::to_string)
            .collect();
        Ok(models)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_normalizes_common_pastes() {
        for base in [
            "http://localhost:11434",
            "http://localhost:11434/",
            "http://localhost:11434/v1",
            "http://localhost:11434/v1/",
            "http://localhost:11434/v1/chat/completions",
        ] {
            assert_eq!(
                chat_completions_url(base),
                "http://localhost:11434/v1/chat/completions",
                "from {base}"
            );
        }
        assert_eq!(
            models_url("https://api.openai.com/v1"),
            "https://api.openai.com/v1/models"
        );
    }

    fn frame(content: &str) -> String {
        format!(
            "data: {}\n\n",
            json!({"choices":[{"delta":{"content":content}}]})
        )
    }

    #[test]
    fn sse_parses_whole_frames() {
        let mut p = SseParser::default();
        let input = format!("{}{}data: [DONE]\n\n", frame("Hel"), frame("lo"));
        let tokens = p.push(input.as_bytes());
        assert_eq!(tokens, vec!["Hel", "lo"]);
    }

    #[test]
    fn sse_buffers_partial_lines_across_chunks() {
        let mut p = SseParser::default();
        let whole = frame("split token");
        let (a, b) = whole.split_at(whole.len() / 2);
        let mut tokens = p.push(a.as_bytes());
        tokens.extend(p.push(b.as_bytes()));
        assert_eq!(tokens, vec!["split token"]);
    }

    #[test]
    fn sse_skips_role_frames_and_garbage() {
        let mut p = SseParser::default();
        let input = "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\
                     not-a-data-line\n\
                     data: {broken json\n";
        assert!(p.push(input.as_bytes()).is_empty());
    }

    #[test]
    fn think_filter_strips_reasoning_span() {
        let mut f = ThinkFilter::default();
        let mut out = f.push("<think>step 1… step 2…</think>Answer: 42");
        out.push_str(&f.finish());
        assert_eq!(out, "Answer: 42");
    }

    #[test]
    fn think_filter_handles_tags_split_across_chunks() {
        let mut f = ThinkFilter::default();
        let mut out = String::new();
        for chunk in ["Hi <thi", "nk>secret", " stuff</thi", "nk> there"] {
            out.push_str(&f.push(chunk));
        }
        out.push_str(&f.finish());
        assert_eq!(out, "Hi  there");
    }

    #[test]
    fn think_filter_passes_lone_angle_bracket_through() {
        let mut f = ThinkFilter::default();
        let mut out = f.push("a < b and x <thin");
        out.push_str(&f.finish());
        assert_eq!(out, "a < b and x <thin");
    }

    #[test]
    fn think_filter_drops_unterminated_think() {
        let mut f = ThinkFilter::default();
        let mut out = f.push("<think>never closed…");
        out.push_str(&f.finish());
        assert_eq!(out, "");
    }
}
