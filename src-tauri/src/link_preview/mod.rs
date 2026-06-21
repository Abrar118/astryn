pub mod addr;
pub mod meta;
pub mod url;

/// Field-length cap for extracted text metadata (chars). Bounds payload size
/// and keeps a single preview from carrying an unreasonable string.
pub const MAX_META_FIELD: usize = 500;

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Metadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub site_name: Option<String>,
    pub image_url: Option<String>,
    pub canonical_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreviewError {
    /// Scheme/credential/host rejected, non-HTML, or no usable metadata.
    Unsupported,
    /// DNS/connect/read failure or blocked address.
    Network,
    /// Response exceeded a byte cap.
    TooLarge,
    /// Unexpected internal failure (e.g. runtime join error).
    Internal,
}
