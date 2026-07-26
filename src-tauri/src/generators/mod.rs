//! Report generators (daily scrum / weekly review): deterministic fact
//! assembly from the SQLite cache plus an optional LLM pass that turns the
//! facts into prose via a user-configured OpenAI-compatible endpoint.

pub mod facts;
pub mod llm;
