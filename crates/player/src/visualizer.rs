// Visualizer domain: FFT spectrum, Winamp-style peak decay, and oscilloscope
// downsampling from decoded f32 audio. The analyzer lives in `analyzer.rs`
// and the synthetic fallback in `mock.rs`.

mod analyzer;
mod mock;

pub use analyzer::{Analyzer, FFT_SIZE};
pub use mock::{generate_mock_samples, MockSampleGenerator};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VisualizerMode {
    Spectrum,
    Winamp,
    Oscilloscope,
    Circular,
    Off,
}

#[derive(Debug, Clone)]
pub struct VisualizerConfig {
    pub enabled: bool,
    pub mode: VisualizerMode,
    pub fps: u32,
    pub bands: usize,
    pub waveform_samples: usize,
    pub sample_rate: f32,
}

impl Default for VisualizerConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            mode: VisualizerMode::Spectrum,
            fps: 60,
            bands: 64,
            waveform_samples: 120,
            sample_rate: 44100.0,
        }
    }
}

/// Create a serialized protocol event string for visualizer spectrum data.
pub fn format_spectrum_event(seq: u64, bands: &[f32]) -> String {
    crate::protocol::event(
        "visualizer.spectrum",
        seq,
        serde_json::json!({ "bands": bands }),
    )
}

/// Create a serialized protocol event string for visualizer waveform data.
pub fn format_waveform_event(seq: u64, samples: &[f32]) -> String {
    crate::protocol::event(
        "visualizer.waveform",
        seq,
        serde_json::json!({ "samples": samples }),
    )
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod waveform_tests;
