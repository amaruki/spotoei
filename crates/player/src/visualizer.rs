// Audio analyzer for the visualizer. Computes real-time FFT spectrum,
// Winamp-style peak decay, and oscilloscope downsampling from decoded f32 audio.

use std::f32::consts::PI;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VisualizerMode {
    Spectrum,
    Winamp,
    Oscilloscope,
}

#[derive(Debug, Clone)]
pub struct VisualizerConfig {
    pub enabled: bool,
    pub mode: VisualizerMode,
    pub fps: u32,
    pub bands: usize,
    pub waveform_samples: usize,
}

impl Default for VisualizerConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            mode: VisualizerMode::Spectrum,
            fps: 60,
            bands: 64,
            waveform_samples: 120,
        }
    }
}

pub struct Analyzer {
    bands: usize,
    peaks: Vec<f32>,
    decay_rate: f32,
}

impl Analyzer {
    pub fn new(bands: usize) -> Self {
        Self {
            bands,
            peaks: vec![0.0; bands],
            decay_rate: 0.05,
        }
    }

    pub fn set_bands(&mut self, bands: usize) {
        if self.bands != bands {
            self.bands = bands;
            self.peaks = vec![0.0; bands];
        }
    }

    /// Downmix stereo interleaved samples to mono f32.
    pub fn downmix_stereo_to_mono(interleaved: &[f32]) -> Vec<f32> {
        let n = interleaved.len() / 2;
        let mut mono = Vec::with_capacity(n);
        for chunk in interleaved.chunks_exact(2) {
            mono.push(0.5 * (chunk[0] + chunk[1]));
        }
        mono
    }

    /// Compute log-spaced energy bands from mono audio samples using a Hann-windowed
    /// Goertzel-like discrete filterbank. Output is normalized to [0.0, 1.0].
    pub fn compute_spectrum(&mut self, samples: &[f32], mode: VisualizerMode) -> Vec<f32> {
        if samples.is_empty() || self.bands == 0 {
            return vec![0.0; self.bands];
        }

        let n = samples.len();
        // Compute log-spaced center frequencies from ~30Hz to ~16kHz
        let min_freq = 30.0f32;
        let max_freq = 16000.0f32;
        let sample_rate = 44100.0f32;

        let mut current_bands = Vec::with_capacity(self.bands);

        for band_idx in 0..self.bands {
            let t = (band_idx as f32) / (self.bands as f32);
            let freq = min_freq * (max_freq / min_freq).powf(t);
            let k = (freq / sample_rate) * (n as f32);

            // Goertzel-style single-bin correlation with Hann window
            let mut real = 0.0f32;
            let mut imag = 0.0f32;
            let omega = 2.0 * PI * k / (n as f32);

            for (i, &s) in samples.iter().enumerate() {
                // Hann window: 0.5 * (1 - cos(2*pi*i/N))
                let w = 0.5 * (1.0 - (2.0 * PI * (i as f32) / (n as f32)).cos());
                let windowed = s * w;
                let angle = omega * (i as f32);
                real += windowed * angle.cos();
                imag -= windowed * angle.sin();
            }

            let magnitude = (real * real + imag * imag).sqrt() / (n as f32);
            // Log-scale mapping roughly into [0.0, 1.0]
            let norm = (magnitude * 8.0).clamp(0.0, 1.0);
            current_bands.push(norm);
        }

        if mode == VisualizerMode::Winamp {
            for i in 0..self.bands {
                let current = current_bands[i];
                if current > self.peaks[i] {
                    self.peaks[i] = current;
                } else {
                    self.peaks[i] = (self.peaks[i] - self.decay_rate).max(0.0);
                }
                current_bands[i] = self.peaks[i];
            }
        }

        current_bands
    }

    /// Downsample waveform to target number of points, mapped to [-1.0, 1.0].
    pub fn compute_waveform(samples: &[f32], target_samples: usize) -> Vec<f32> {
        if samples.is_empty() || target_samples == 0 {
            return vec![0.0; target_samples];
        }

        let step = (samples.len() as f32) / (target_samples as f32);
        let mut out = Vec::with_capacity(target_samples);

        for i in 0..target_samples {
            let idx = ((i as f32 * step) as usize).min(samples.len() - 1);
            out.push(samples[idx].clamp(-1.0, 1.0));
        }

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_downmix_stereo() {
        let stereo = vec![1.0, -1.0, 0.5, 0.5];
        let mono = Analyzer::downmix_stereo_to_mono(&stereo);
        assert_eq!(mono, vec![0.0, 0.5]);
    }

    #[test]
    fn test_spectrum_sine_wave_determinism() {
        let mut analyzer = Analyzer::new(32);
        let sample_rate = 44100.0f32;
        let freq = 1000.0f32; // 1 kHz pure tone
        let n = 1024;

        let samples: Vec<f32> = (0..n)
            .map(|i| (2.0 * PI * freq * (i as f32) / sample_rate).sin())
            .collect();

        let bands = analyzer.compute_spectrum(&samples, VisualizerMode::Spectrum);
        assert_eq!(bands.len(), 32);

        // Peak should be in the middle-upper frequencies (around 1kHz)
        let max_idx = bands
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
            .map(|(idx, _)| idx)
            .unwrap();

        // 1kHz in a 30Hz - 16kHz log-scale over 32 bands is around band index 17-20
        assert!(
            max_idx >= 15 && max_idx <= 22,
            "Max band index was {}",
            max_idx
        );
    }

    #[test]
    fn test_waveform_downsampling() {
        let samples: Vec<f32> = vec![0.0, 0.5, 1.0, 0.5, 0.0, -0.5, -1.0, -0.5];
        let waveform = Analyzer::compute_waveform(&samples, 4);
        assert_eq!(waveform.len(), 4);
        assert_eq!(waveform[0], 0.0);
        assert_eq!(waveform[2], 0.0);
    }
}
