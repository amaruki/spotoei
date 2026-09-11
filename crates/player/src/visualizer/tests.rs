// Unit tests for the visualizer domain, analyzer, and mock generator.

use super::*;
use std::f32::consts::PI;

fn tone(freq: f32, sample_rate: f32, amplitude: f32, n: usize) -> Vec<f32> {
    (0..n)
        .map(|i| amplitude * (2.0 * PI * freq * (i as f32) / sample_rate).sin())
        .collect()
}

fn peak_index(bands: &[f32]) -> usize {
    bands
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
        .map(|(idx, _)| idx)
        .unwrap()
}

#[test]
fn test_downmix_stereo() {
    let stereo = vec![1.0, -1.0, 0.5, 0.5];
    let mono = Analyzer::downmix_stereo_to_mono(&stereo);
    assert_eq!(mono, vec![0.0, 0.5]);
}

#[test]
fn test_spectrum_sine_wave_determinism() {
    let mut analyzer = Analyzer::new(32);
    let samples = tone(1000.0, 44100.0, 1.0, FFT_SIZE);
    let bands = analyzer.compute_spectrum(&samples, VisualizerMode::Spectrum);
    assert_eq!(bands.len(), 32);

    // 1kHz in a 30Hz - 16kHz log-scale over 32 bands is around band 17-20.
    let max_idx = peak_index(&bands);
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

#[test]
fn test_64_bands_spectrum_calculation() {
    let mut analyzer = Analyzer::new(64);
    let samples = tone(440.0, 44100.0, 1.0, FFT_SIZE);
    let bands = analyzer.compute_spectrum(&samples, VisualizerMode::Spectrum);
    assert_eq!(bands.len(), 64);
    for &b in &bands {
        assert!(b >= 0.0 && b <= 1.0, "band value out of range: {b}");
    }

    // In 20Hz-20kHz 64-band log scale the 440Hz peak lands around 26..32.
    let max_idx = peak_index(&bands);
    assert!(
        max_idx >= 25 && max_idx <= 32,
        "Max band index for 440Hz was {max_idx}"
    );
}

#[test]
fn test_loud_tone_renders_taller_than_quiet_tone() {
    let mut loud = Analyzer::new(64);
    let mut quiet = Analyzer::new(64);
    let loud_tone = tone(1000.0, 44100.0, 1.0, FFT_SIZE);
    let quiet_tone = tone(1000.0, 44100.0, 0.05, FFT_SIZE);
    // Two passes so the attack smoothing reaches steady state.
    loud.compute_spectrum(&loud_tone, VisualizerMode::Spectrum);
    quiet.compute_spectrum(&quiet_tone, VisualizerMode::Spectrum);
    let loud_bands = loud.compute_spectrum(&loud_tone, VisualizerMode::Spectrum);
    let quiet_bands = quiet.compute_spectrum(&quiet_tone, VisualizerMode::Spectrum);
    let max_loud = loud_bands.iter().copied().fold(0.0f32, f32::max);
    let max_quiet = quiet_bands.iter().copied().fold(0.0f32, f32::max);
    assert!(
        max_loud > max_quiet,
        "loud {max_loud} should exceed quiet {max_quiet}"
    );
    assert!(
        max_loud > 0.6,
        "full-scale tone should render a tall bar, got {max_loud}"
    );
}

#[test]
fn test_sample_rate_keeps_frequency_mapping_stable() {
    let mut at_44k = Analyzer::new(64);
    let mut at_22k = Analyzer::new(64);
    at_22k.set_sample_rate(22050.0);

    let bands_44k = at_44k.compute_spectrum(
        &tone(1000.0, 44100.0, 1.0, FFT_SIZE),
        VisualizerMode::Spectrum,
    );
    let bands_22k = at_22k.compute_spectrum(
        &tone(1000.0, 22050.0, 1.0, FFT_SIZE),
        VisualizerMode::Spectrum,
    );

    // The same physical 1 kHz tone must land on the same band no matter
    // which sample rate the decoded stream uses.
    assert_eq!(peak_index(&bands_44k), peak_index(&bands_22k));

    // Without the configured rate, the 22.05 kHz stream would be mapped
    // as if it were 44.1 kHz and the peak would climb to a higher band.
    let mut hardcoded = Analyzer::new(64);
    let bands_hardcoded = hardcoded.compute_spectrum(
        &tone(1000.0, 22050.0, 1.0, FFT_SIZE),
        VisualizerMode::Spectrum,
    );
    assert!(
        peak_index(&bands_hardcoded) > peak_index(&bands_22k),
        "hardcoded 44.1kHz should misplace a 22.05kHz stream"
    );
}

#[test]
fn test_mock_sample_generator() {
    let mut gen = MockSampleGenerator::new(44100.0);
    let samples = gen.generate(FFT_SIZE);
    assert_eq!(samples.len(), FFT_SIZE);
    for &s in &samples {
        assert!(s >= -1.0 && s <= 1.0, "sample out of range: {s}");
    }
    assert!(gen.phase() > 0.0);

    let mut analyzer = Analyzer::new(64);
    let bands = analyzer.compute_spectrum(&samples, VisualizerMode::Spectrum);
    assert_eq!(bands.len(), 64);
    // Mock generator has bass, kick, mids, and treble, so some bands should be active
    let total_energy: f32 = bands.iter().sum();
    assert!(
        total_energy > 0.1,
        "mock samples must produce spectrum energy"
    );
}

#[test]
fn test_format_protocol_events() {
    let bands = vec![0.1, 0.5, 0.75];
    let spec_line = format_spectrum_event(42, &bands);
    let spec_val: serde_json::Value =
        serde_json::from_str(&spec_line).expect("valid json for spectrum event");
    assert_eq!(spec_val["event"], "visualizer.spectrum");
    assert_eq!(spec_val["seq"], 42);
    assert_eq!(spec_val["data"]["bands"].as_array().unwrap().len(), 3);

    let wave = vec![0.0, -0.5, 0.5];
    let wave_line = format_waveform_event(43, &wave);
    let wave_val: serde_json::Value =
        serde_json::from_str(&wave_line).expect("valid json for waveform event");
    assert_eq!(wave_val["event"], "visualizer.waveform");
    assert_eq!(wave_val["seq"], 43);
    assert_eq!(wave_val["data"]["samples"].as_array().unwrap().len(), 3);
}

#[test]
fn test_silent_high_bands_do_not_form_a_pedestal() {
    let sample_rate = 44100.0f32;
    let n = FFT_SIZE;
    // Bass-only "track" plus a tiny white noise floor. Bands with no
    // content must stay near zero instead of sitting on a constant
    // pedestal produced by boosting the clamped dB floor.
    let mut rng: u64 = 0x9E3779B97F4A7C15;
    let samples: Vec<f32> = (0..n)
        .map(|i| {
            let t = i as f32 / sample_rate;
            let bass = 0.7 * (2.0 * PI * 60.0 * t).sin();
            rng = rng
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            let noise = 0.002 * (((rng >> 40) as f32 / (1u64 << 24) as f32) - 0.5);
            bass + noise
        })
        .collect();
    let mut analyzer = Analyzer::new(64);
    // Two passes so the attack smoothing reaches steady state.
    analyzer.compute_spectrum(&samples, VisualizerMode::Spectrum);
    let bands = analyzer.compute_spectrum(&samples, VisualizerMode::Spectrum);
    let high_max = bands[32..].iter().copied().fold(0.0f32, f32::max);
    assert!(
        high_max < 0.1,
        "empty high bands must stay near zero, got {high_max}"
    );
    assert!(peak_index(&bands) < 32, "bass tone must own the peak");
}

#[test]
fn test_adjacent_bass_bands_stay_distinct() {
    // A pure low tone used to fill many adjacent bass bands with the same
    // value because several log bands collapsed onto one 43 Hz FFT bin.
    // Every band must now read a unique bin so neighboring bars move
    // independently instead of merging into a solid block.
    let mut analyzer = Analyzer::new(64);
    analyzer.compute_spectrum(
        &tone(60.0, 44100.0, 0.7, FFT_SIZE),
        VisualizerMode::Spectrum,
    );
    let bands = analyzer.compute_spectrum(
        &tone(60.0, 44100.0, 0.7, FFT_SIZE),
        VisualizerMode::Spectrum,
    );
    let low = &bands[..15];
    let max = low.iter().copied().fold(0.0f32, f32::max);
    let min = low.iter().copied().fold(f32::MAX, f32::min);
    assert!(max > 0.4, "60Hz tone should light its bass band, got {max}");
    assert!(
        max - min > 0.2,
        "bass bands must not all share one value (max {max}, min {min})"
    );

    // Two nearby bass tones must land on matching but different bars.
    let mut two_tone = Analyzer::new(64);
    let mix: Vec<f32> = tone(55.0, 44100.0, 0.6, FFT_SIZE)
        .iter()
        .zip(tone(110.0, 44100.0, 0.6, FFT_SIZE).iter())
        .map(|(a, b)| a + b)
        .collect();
    two_tone.compute_spectrum(&mix, VisualizerMode::Spectrum);
    let mix_bands = two_tone.compute_spectrum(&mix, VisualizerMode::Spectrum);
    let hot: Vec<usize> = mix_bands[..15]
        .iter()
        .enumerate()
        .filter(|(_, v)| **v > 0.5)
        .map(|(i, _)| i)
        .collect();
    assert!(
        hot.len() >= 2,
        "both bass tones should light bars, got {hot:?}"
    );
    assert!(
        hot.last().unwrap() - hot.first().unwrap() >= 2,
        "55Hz and 110Hz must occupy separated bars, got {hot:?}"
    );
}

#[test]
fn test_treble_tone_lights_up_upper_bands() {
    let mut analyzer = Analyzer::new(64);
    let bands = analyzer.compute_spectrum(
        &tone(8000.0, 44100.0, 0.3, FFT_SIZE),
        VisualizerMode::Spectrum,
    );
    let idx = peak_index(&bands);
    // log10(8000/20) / log10(1000) * 64 = 55.5, so the peak belongs in 53..58.
    assert!((52..=59).contains(&idx), "8kHz peak landed at band {idx}");
    assert!(
        bands[idx] > 0.4,
        "treble tone should be clearly visible, got {}",
        bands[idx]
    );
}
