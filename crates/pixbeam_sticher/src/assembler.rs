use std::fs::File;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use pixbeam_decoder::DecodedPacket;

/// Errors produced while assembling a received file.
#[derive(Debug, thiserror::Error)]
pub enum AssemblerError {
    #[error("cannot create output file {path}: {source}")]
    CreateFile { path: PathBuf, source: io::Error },
    #[error("cannot write to output file {path}: {source}")]
    Write { path: PathBuf, source: io::Error },
}

/// Reception progress of the assembled file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Progress {
    /// Packets appended so far.
    pub packets: u64,
    /// Bytes written to the output file so far.
    pub bytes: u64,
}

/// Accumulates [`DecodedPacket`]s into an output file.
///
/// TODO(fountain): implement block-0 metadata parsing and packet ordering
/// (the new protocol's equivalent of the old RaptorQ block scheme) — for now
/// payloads are appended in arrival order.
#[derive(Debug)]
pub struct FileAssembler {
    output: PathBuf,
    file: File,
    packets: u64,
    bytes: u64,
}

impl FileAssembler {
    /// Create (truncate) the output file.
    pub fn new(output: impl Into<PathBuf>) -> Result<Self, AssemblerError> {
        let output = output.into();
        let file = File::create(&output).map_err(|source| AssemblerError::CreateFile {
            path: output.clone(),
            source,
        })?;
        Ok(Self {
            output,
            file,
            packets: 0,
            bytes: 0,
        })
    }

    /// Append one decoded packet to the output file.
    pub fn add_packet(&mut self, packet: &DecodedPacket) -> Result<(), AssemblerError> {
        self.file
            .write_all(&packet.payload)
            .map_err(|source| AssemblerError::Write {
                path: self.output.clone(),
                source,
            })?;
        self.packets += 1;
        self.bytes += packet.payload.len() as u64;
        Ok(())
    }

    /// Current reception progress.
    pub fn progress(&self) -> Progress {
        Progress {
            packets: self.packets,
            bytes: self.bytes,
        }
    }

    /// Path of the output file.
    pub fn output_path(&self) -> &Path {
        &self.output
    }
}
