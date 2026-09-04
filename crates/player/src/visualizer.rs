// Audio analyzer for the visualizer. Computes real-time FFT spectrum,
// Winamp-style peak decay, and oscilloscope downsampling from decoded f32 audio.
// Uses RealFFT with CAVA-style logarithmic frequency bands, equal-loudness curve,
// and gravity falloff physics.

use realfft::num_complex::Complex;
use realfft::{RealFftPlanner, RealToComplex};
use std::f32::consts::PI;
use std::sync::Arc;

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
    r2c: Arc<dyn RealToComplex<f32>>,
    fft_in: Vec<f32>,
    fft_out: Vec<Complex<f32>>,
    window: Vec<f32>,
    bars: Vec<f32>,
    peaks: Vec<f32>,
    fall_speed: Vec<f32>,
    decay_rate: f32,
}

impl Analyzer {
    pub fn new(bands: usize) -> Self {
        let fft_size = 1024;
        let mut planner = RealFftPlanner::<f32>::new();
        let r2c = planner.plan_fft_forward(fft_size);
        let fft_in = r2c.make_input_vec();
        let fft_out = r2c.make_output_vec();

        // Hann window
        let window: Vec<f32> = (0..fft_size)
            .map(|i| 0.5 * (1.0 - (2.0 * PI * (i as f32) / (fft_size as f32)).cos()))
            .collect();

        Self {
            bands,
            r2c,
            fft_in,
            fft_out,
            window,
            bars: vec![0.0; bands],
            peaks: vec![0.0; bands],
            fall_speed: vec![0.0; bands],
            decay_rate: 0.04,
        }
    }

    pub fn set_bands(&mut self, bands: usize) {
        if self.bands != bands && bands > 0 {
            self.bands = bands;
            self.bars = vec![0.0; bands];
            self.peaks = vec![0.0; bands];
            self.fall_speed = vec![0.0; bands];
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

    /// Compute CAVA-style log-spaced frequency bands with Hann windowing,
    /// real FFT, ISO equal-loudness boost, and gravity falloff.
    pub fn compute_spectrum(&mut self, samples: &[f32], mode: VisualizerMode) -> Vec<f32> {
        if samples.is_empty() || self.bands == 0 {
            for i in 0..self.bands {
                self.bars[i] = (self.bars[i] - 0.05).max(0.0);
                self.peaks[i] = (self.peaks[i] - 0.03).max(0.0);
            }
            return if mode == VisualizerMode::Winamp {
                self.peaks.clone()
            } else {
                self.bars.clone()
            };
        }

        let fft_size = self.window.len();
        let sample_len = samples.len();
        for i in 0..fft_size {
            let s = if i < sample_len { samples[i] } else { 0.0 };
            self.fft_in[i] = s * self.window[i];
        }

        if self
            .r2c
            .process(&mut self.fft_in, &mut self.fft_out)
            .is_err()
        {
            return self.bars.clone();
        }

        let bin_count = self.fft_out.len();
        let freq_per_bin = 44100.0 / (fft_size as f32);

        let min_freq = 30.0f32;
        let max_freq = 16000.0f32;

        let mut raw_bands = vec![0.0f32; self.bands];

        for b in 0..self.bands {
            let t0 = (b as f32) / (self.bands as f32);
            let t1 = ((b + 1) as f32) / (self.bands as f32);
            let f_low = min_freq * (max_freq / min_freq).powf(t0);
            let f_high = min_freq * (max_freq / min_freq).powf(t1);

            let k_low = ((f_low / freq_per_bin).floor() as usize).min(bin_count - 1);
            let mut k_high = ((f_high / freq_per_bin).ceil() as usize).min(bin_count);
            if k_high <= k_low {
                k_high = (k_low + 1).min(bin_count);
            }

            let mut sum_mag = 0.0f32;
            for k in k_low..k_high {
                let mag = (self.fft_out[k].re.powi(2) + self.fft_out[k].im.powi(2)).sqrt();
                sum_mag += mag;
            }
            let avg_mag = sum_mag / ((k_high - k_low) as f32);

            let center_freq = (f_low * f_high).sqrt();
            let eq_boost = (center_freq / 200.0).powf(0.35).clamp(1.0, 4.5);

            let norm = (avg_mag * eq_boost / (fft_size as f32) * 28.0).clamp(0.0, 1.0);
            raw_bands[b] = norm;
        }

        // Horizontal smoothing: 3-point moving average
        let mut smoothed = vec![0.0f32; self.bands];
        for i in 0..self.bands {
            let left = if i > 0 {
                raw_bands[i - 1]
            } else {
                raw_bands[i]
            };
            let center = raw_bands[i];
            let right = if i + 1 < self.bands {
                raw_bands[i + 1]
            } else {
                raw_bands[i]
            };
            smoothed[i] = 0.15 * left + 0.70 * center + 0.15 * right;
        }

        // CAVA Physics: Gravity Falloff
        for i in 0..self.bands {
            let target = smoothed[i];
            if target >= self.bars[i] {
                self.bars[i] = self.bars[i] * 0.25 + target * 0.75;
                self.fall_speed[i] = 0.0;
            } else {
                self.fall_speed[i] += 0.008;
                self.bars[i] = (self.bars[i] - self.fall_speed[i]).max(target);
            }

            if self.bars[i] >= self.peaks[i] {
                self.peaks[i] = self.bars[i];
            } else {
                self.peaks[i] = (self.peaks[i] - self.decay_rate).max(0.0);
            }
        }

        if mode == VisualizerMode::Winamp {
            self.peaks.clone()
        } else {
            self.bars.clone()
        }
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
