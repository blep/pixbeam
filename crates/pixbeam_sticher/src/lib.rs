//! Accumulation of decoded packets into a file.

pub mod assembler;

pub use assembler::{AssemblerError, FileAssembler, Progress};
