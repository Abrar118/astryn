pub mod addr;
pub mod url;

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
