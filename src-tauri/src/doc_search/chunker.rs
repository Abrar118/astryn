//! Splits a document into search chunks of roughly 150–300 words (so each fits
//! the embedding model's 512-token limit later). Markdown is split on headings;
//! plain text is split on paragraphs.

const MIN_WORDS: usize = 40; // smaller sections merge with the next one
const TARGET_WORDS: usize = 250;
const MAX_WORDS: usize = 300;
const OVERLAP_MAX_WORDS: usize = 50;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chunk {
    /// Breadcrumb of enclosing headings, e.g. `Setup > Linux`. Empty before the first heading.
    pub heading_path: String,
    /// 1-based line where the chunk starts in the source file.
    pub start_line: usize,
    pub content: String,
}

fn words(s: &str) -> usize {
    s.split_whitespace().count()
}

/// `# Title` style heading → (level, text). Caller guarantees we are outside a code fence.
fn heading(line: &str) -> Option<(usize, &str)> {
    let level = line.bytes().take_while(|b| *b == b'#').count();
    let rest = line[level..].strip_prefix(' ')?;
    ((1..=6).contains(&level)).then(|| (level, rest.trim().trim_end_matches('#').trim()))
}

struct Section<'a> {
    path: String,
    lines: Vec<(usize, &'a str)>,
}

fn sections(text: &str, markdown: bool) -> Vec<Section<'_>> {
    let mut out = vec![Section {
        path: String::new(),
        lines: vec![],
    }];
    let mut stack: Vec<(usize, String)> = vec![];
    let mut fence: Option<&str> = None;
    for (i, line) in text.lines().enumerate() {
        let trimmed = line.trim_start();
        if markdown {
            let marker = ["```", "~~~"].into_iter().find(|m| trimmed.starts_with(m));
            match (fence, marker) {
                (None, Some(m)) => fence = Some(m),
                (Some(open), Some(m)) if open == m => fence = None,
                _ => {}
            }
            if fence.is_none() && marker.is_none() {
                if let Some((level, name)) = heading(line) {
                    while stack.last().is_some_and(|(l, _)| *l >= level) {
                        stack.pop();
                    }
                    stack.push((level, name.to_string()));
                    let path = stack
                        .iter()
                        .map(|(_, n)| n.as_str())
                        .collect::<Vec<_>>()
                        .join(" > ");
                    out.push(Section {
                        path,
                        lines: vec![],
                    });
                }
            }
        }
        out.last_mut().unwrap().lines.push((i + 1, line));
    }
    out.retain(|s| s.lines.iter().any(|(_, l)| !l.trim().is_empty()));
    out
}

/// Blank-line separated paragraphs as (start_line, text).
fn paragraphs<'a>(lines: &[(usize, &'a str)]) -> Vec<(usize, String)> {
    let mut out: Vec<(usize, Vec<&'a str>)> = vec![];
    let mut open = false;
    for (n, l) in lines {
        if l.trim().is_empty() {
            open = false;
        } else if open {
            out.last_mut().unwrap().1.push(l);
        } else {
            out.push((*n, vec![l]));
            open = true;
        }
    }
    out.into_iter().map(|(n, ls)| (n, ls.join("\n"))).collect()
}

fn push_piece(out: &mut Vec<Chunk>, piece: Chunk) {
    if let Some(last) = out.last_mut() {
        let (a, b) = (words(&last.content), words(&piece.content));
        if a < MIN_WORDS && a + b <= MAX_WORDS {
            last.content.push_str("\n\n");
            last.content.push_str(&piece.content);
            return;
        }
    }
    out.push(piece);
}

fn split_large(sec: &Section, out: &mut Vec<Chunk>) {
    let mut cur: Vec<(usize, String)> = vec![];
    let mut cur_words = 0;
    let flush = |cur: &mut Vec<(usize, String)>, out: &mut Vec<Chunk>| {
        if let Some((start, _)) = cur.first() {
            let content = cur
                .iter()
                .map(|(_, t)| t.as_str())
                .collect::<Vec<_>>()
                .join("\n\n");
            out.push(Chunk {
                heading_path: sec.path.clone(),
                start_line: *start,
                content,
            });
        }
    };
    for (n, para) in paragraphs(&sec.lines) {
        let w = words(&para);
        if w > MAX_WORDS {
            // One giant paragraph: cut it into fixed word windows.
            flush(&mut cur, out);
            cur.clear();
            cur_words = 0;
            let all: Vec<&str> = para.split_whitespace().collect();
            for win in all.chunks(TARGET_WORDS) {
                out.push(Chunk {
                    heading_path: sec.path.clone(),
                    start_line: n,
                    content: win.join(" "),
                });
            }
            continue;
        }
        if cur_words + w > TARGET_WORDS && !cur.is_empty() {
            flush(&mut cur, out);
            // Small overlap: repeat the last paragraph so context carries over.
            let tail = cur.pop().filter(|(_, t)| words(t) <= OVERLAP_MAX_WORDS);
            cur.clear();
            cur_words = tail.as_ref().map_or(0, |(_, t)| words(t));
            cur.extend(tail);
        }
        cur_words += w;
        cur.push((n, para));
    }
    flush(&mut cur, out);
}

pub fn chunk(text: &str, markdown: bool) -> Vec<Chunk> {
    let mut out = vec![];
    for sec in sections(text, markdown) {
        let total: usize = sec.lines.iter().map(|(_, l)| words(l)).sum();
        if total <= MAX_WORDS {
            let start_line = sec
                .lines
                .iter()
                .find(|(_, l)| !l.trim().is_empty())
                .map_or(1, |(n, _)| *n);
            let content = sec
                .lines
                .iter()
                .map(|(_, l)| *l)
                .collect::<Vec<_>>()
                .join("\n")
                .trim()
                .to_string();
            push_piece(
                &mut out,
                Chunk {
                    heading_path: sec.path,
                    start_line,
                    content,
                },
            );
        } else {
            split_large(&sec, &mut out);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn filler(n: usize) -> String {
        vec!["word"; n].join(" ")
    }

    #[test]
    fn splits_on_headings_with_breadcrumb_and_line() {
        let text = format!(
            "# Setup\n{}\n\n## Linux\n{}\n\n## Mac\n{}\n",
            filler(60),
            filler(60),
            filler(60)
        );
        let c = chunk(&text, true);
        let paths: Vec<_> = c.iter().map(|c| c.heading_path.as_str()).collect();
        assert_eq!(paths, ["Setup", "Setup > Linux", "Setup > Mac"]);
        assert_eq!(c[1].start_line, 4);
    }

    #[test]
    fn ignores_hash_inside_code_fence() {
        let text = format!("# A\n{}\n```\n# not a heading\n```\n", filler(60));
        let c = chunk(&text, true);
        assert_eq!(c.len(), 1);
        assert!(c[0].content.contains("# not a heading"));
    }

    #[test]
    fn merges_tiny_sections_forward() {
        let text = format!("# A\n## B\nshort\n\n## C\n{}\n", filler(100));
        let c = chunk(&text, true);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].heading_path, "A");
    }

    #[test]
    fn splits_large_sections_within_limit() {
        let paras: Vec<String> = (0..10).map(|_| filler(80)).collect();
        let text = format!("# Big\n{}\n", paras.join("\n\n"));
        let c = chunk(&text, true);
        assert!(c.len() > 1);
        assert!(c
            .iter()
            .all(|c| words(&c.content) <= MAX_WORDS + OVERLAP_MAX_WORDS));
    }

    #[test]
    fn cuts_one_giant_paragraph() {
        let c = chunk(&filler(1000), false);
        assert_eq!(c.len(), 4);
        assert!(c.iter().all(|c| words(&c.content) <= TARGET_WORDS));
    }

    #[test]
    fn plain_text_ignores_hashes() {
        let c = chunk(&format!("# not a heading\n{}", filler(60)), false);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].heading_path, "");
    }

    #[test]
    fn empty_text_yields_nothing() {
        assert!(chunk("\n  \n", true).is_empty());
    }
}
