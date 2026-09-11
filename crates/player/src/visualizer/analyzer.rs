// FFT analyzer: real-time spectrum analysis of decoded f32 audio with
// CAVA-style log-frequency bands, perceptual (dB) scaling and gravity falloff.

use realfft::num_complex::Complex;
use realfft::{RealFftPlanner, RealToComplex};
use std::f32::consts::PI;
use std::sync::Arc;

use super::VisualizerMode;

// Perceptual scaling constants for the spectrum. Magnitudes are normalized
// by the FFT size first, so a full-scale sine peaks around -12 dB; the floor
// and ceiling below map that range to the 0..1 visual domain.
const MAG_EPSILON: f32 = 1e-12;
const DB_FLOOR: f32 = -80.0;
const DB_CEIL: f32 = -4.0;
// FFT window. 4096 gives ~10.8 Hz bins at 44.1 kHz, enough to separate
// adjacent log-spaced bass bands; 1024 collapsed them onto shared bins.
pub const FFT_SIZE: usize = 4096;
// Equal-loudness compensation applied to the magnitude (not the dB value):
// boosting after the floor clamp would lift silent high bands to a constant
// pedestal instead of leaving them at zero.
const EQ_BOOST_EXP: f32 = 0.35;
const EQ_BOOST_MAX: f32 = 4.0;
// Winamp peak-hold physics: pin the peak for a short hold, then let gravity
// take it down. Expressed per second so 30 and 60 FPS feel the same.
const PEAK_HOLD_SECS: f32 = 0.5;
const PEAK_FALL_ACCEL: f32 = 0.375;
const PEAK_FALL_MAX: f32 = 0.6;
// Oscilloscope auto-gain: quiet tracks are lifted until the trace fills the
// canvas, loud tracks are attenuated. Attack is instant, release is gradual.
const WAVE_TARGET_PEAK: f32 = 0.9;
const WAVE_MAX_GAIN: f32 = 20.0;
const WAVE_GAIN_RELEASE: f32 = 0.12;
const WAVE_GAIN_FLOOR: f32 = 0.002;

pub struct Analyzer {
    bands: usize,
    sample_rate: f32,
    fps: f32,
    r2c: Arc<dyn RealToComplex<f32>>,
    fft_in: Vec<f32>,
    fft_out: Vec<Complex<f32>>,
    window: Vec<f32>,
    bars: Vec<f32>,
    peaks: Vec<f32>,
    fall_speed: Vec<f32>,
    peak_fall_speed: Vec<f32>,
    peak_hold: Vec<f32>,
    wave_gain: f32,
}

impl Analyzer {
    pub fn new(bands: usize) -> Self {
        let fft_size = FFT_SIZE;
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
            sample_rate: 44100.0,
            fps: 60.0,
            r2c,
            fft_in,
            fft_out,
            window,
            bars: vec![0.0; bands],
            peaks: vec![0.0; bands],
            fall_speed: vec![0.0; bands],
            peak_fall_speed: vec![0.0; bands],
            peak_hold: vec![0.0; bands],
            wave_gain: 1.0,
        }
    }

    pub fn set_bands(&mut self, bands: usize) {
        if self.bands != bands && bands > 0 {
            self.bands = bands;
            self.bars = vec![0.0; bands];
            self.peaks = vec![0.0; bands];
            self.fall_speed = vec![0.0; bands];
            self.peak_fall_speed = vec![0.0; bands];
            self.peak_hold = vec![0.0; bands];
        }
    }

    /// Analysis sample rate used for bin -> frequency mapping. Maps to the
    /// decoded stream rate; 44.1 kHz covers Spotify's OGG/Vorbis output.
    pub fn set_sample_rate(&mut self, sample_rate: f32) {
        if sample_rate > 0.0 {
            self.sample_rate = sample_rate;
        }
    }

    /// Delivery rate of analyzer frames; drives the time-based peak physics.
    pub fn set_fps(&mut self, fps: f32) {
        if fps > 0.0 {
            self.fps = fps;
        }
    }

    /// Winamp peak physics for one band: hold at the high-water mark, then
    /// accelerate downward but never below the current bar.
    fn apply_peak_dynamics(&mut self, i: usize, dt: f32) {
        if self.bars[i] >= self.peaks[i] {
            self.peaks[i] = self.bars[i];
            self.peak_fall_speed[i] = 0.0;
            self.peak_hold[i] = PEAK_HOLD_SECS;
        } else if self.peak_hold[i] > 0.0 {
            self.peak_hold[i] = (self.peak_hold[i] - dt).max(0.0);
        } else {
            self.peak_fall_speed[i] =
                (self.peak_fall_speed[i] + PEAK_FALL_ACCEL * dt).min(PEAK_FALL_MAX);
            self.peaks[i] = (self.peaks[i] - self.peak_fall_speed[i] * dt).max(self.bars[i]);
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
    /// real FFT, dB perceptual scaling, and gravity falloff.
    pub fn compute_spectrum(&mut self, samples: &[f32], mode: VisualizerMode) -> Vec<f32> {
        if samples.is_empty() || self.bands == 0 {
            let dt = 1.0 / self.fps.max(1.0);
            for i in 0..self.bands {
                self.bars[i] = (self.bars[i] - 0.05).max(0.0);
                self.apply_peak_dynamics(i, dt);
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
        let freq_per_bin = self.sample_rate / (fft_size as f32);

        let min_freq = 20.0f32;
        let max_freq = 20000.0f32;

        let mut raw_bands = vec![0.0f32; self.bands];
        // Cursor over unique FFT bins. Log-spaced bands below ~200 Hz are
        // narrower than one bin at 44.1 kHz, so without this several adjacent
        // bass bands would read the exact same bin — identical heights that
        // look like one merged block. Each band gets at least one new bin.
        let mut cursor = 1usize;

        for b in 0..self.bands {
            let t0 = (b as f32) / (self.bands as f32);
            let t1 = ((b + 1) as f32) / (self.bands as f32);
            let f_low = min_freq * (max_freq / min_freq).powf(t0);
            let f_high = min_freq * (max_freq / min_freq).powf(t1);

            let k_low = ((f_low / freq_per_bin).floor() as usize)
                .max(cursor)
                .min(bin_count - 1);
            let k_high = ((f_high / freq_per_bin).ceil() as usize)
                .max(k_low + 1)
                .min(bin_count);
            cursor = k_high;

            // Equal-loudness compensation: treble magnitudes are genuinely
            // smaller, so boost them before converting to dB. Any band whose
            // boosted magnitude still sits under DB_FLOOR maps to zero.
            let center_freq = (f_low * f_high).sqrt();
            let eq_boost = (center_freq / 200.0)
                .powf(EQ_BOOST_EXP)
                .clamp(1.0, EQ_BOOST_MAX);

            // Per-band peak in dB. Max (not mean) keeps narrow treble peaks
            // visible; dividing by the FFT size makes the scale independent
            // of window length so a full-scale sine sits near -12 dB.
            let mut max_db = DB_FLOOR;
            for k in k_low..k_high {
                let mag =
                    (self.fft_out[k].re.powi(2) + self.fft_out[k].im.powi(2)).sqrt() * eq_boost;
                let db = 20.0 * (mag / (fft_size as f32) + MAG_EPSILON).log10();
                if db > max_db {
                    max_db = db;
                }
            }

            let norm = ((max_db - DB_FLOOR) / (DB_CEIL - DB_FLOOR)).clamp(0.0, 1.0);
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
        let dt = 1.0 / self.fps.max(1.0);
        for i in 0..self.bands {
            let target = smoothed[i];
            if target >= self.bars[i] {
                self.bars[i] = self.bars[i] * 0.25 + target * 0.75;
                self.fall_speed[i] = 0.0;
            } else {
                self.fall_speed[i] += 0.008;
                self.bars[i] = (self.bars[i] - self.fall_speed[i]).max(target);
            }

            self.apply_peak_dynamics(i, dt);
        }

        if mode == VisualizerMode::Winamp {
            self.peaks.clone()
        } else {
            self.bars.clone()
        }
    }

    /// Downsample the waveform to `target_samples` points across the whole
    /// buffer, mapped to [-1.0, 1.0]. Each point averages its source bucket
    /// (smooth, alias-free) and an auto-gain stage keeps quiet tracks wide.
    pub fn compute_waveform(&mut self, samples: &[f32], target_samples: usize) -> Vec<f32> {
        if samples.is_empty() || target_samples == 0 {
            return vec![0.0; target_samples];
        }

        let step = samples.len() as f32 / target_samples as f32;
        let mut out = Vec::with_capacity(target_samples);

        for i in 0..target_samples {
            let start = (i as f32 * step) as usize;
            let end = (((i + 1) as f32 * step) as usize)
                .max(start + 1)
                .min(samples.len());
            let mut sum = 0.0f32;
            for k in start..end {
                sum += samples[k];
            }
            out.push(sum / ((end - start) as f32));
        }

        // Auto gain: cut immediately when the signal gets louder, swell back
        // slowly so quiet passages still fill the scope.
        let frame_peak = out.iter().fold(0.0f32, |m, s| m.max(s.abs()));
        let target_gain = if frame_peak > WAVE_GAIN_FLOOR {
            (WAVE_TARGET_PEAK / frame_peak).clamp(1.0, WAVE_MAX_GAIN)
        } else {
            1.0
        };
        if target_gain < self.wave_gain {
            self.wave_gain = target_gain;
        } else {
            self.wave_gain += (target_gain - self.wave_gain) * WAVE_GAIN_RELEASE;
        }

        for v in out.iter_mut() {
            *v = (*v * self.wave_gain).clamp(-1.0, 1.0);
        }
        out
    }
}
