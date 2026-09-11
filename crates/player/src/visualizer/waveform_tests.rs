// Waveform (oscilloscope) and mock-generator analyzer tests.

use super::*;
use std::f32::consts::PI;

fn tone(freq: f32, sample_rate: f32, amplitude: f32, n: usize) -> Vec<f32> {
    (0..n)
        .map(|i| amplitude * (2.0 * PI * freq * (i as f32) / sample_rate).sin())
        .collect()
}

#[test]
fn test_waveform_downsampling_averages_buckets() {
    let samples: Vec<f32> = vec![0.0, 0.5, 1.0, 0.5, 0.0, -0.5, -1.0, -0.5];
    let mut analyzer = Analyzer::new(64);
    let waveform = analyzer.compute_waveform(&samples, 4);
    assert_eq!(waveform.len(), 4);
    // Buckets: [0,0.5], [1,0.5], [0,-0.5], [-1,-0.5] with auto-gain applied.
    assert!(waveform[0] > 0.0 && waveform[1] > waveform[0]);
    assert!(waveform[2] < 0.0 && waveform[3] < waveform[2]);
    for v in &waveform {
        assert!(v.abs() <= 1.0, "sample out of range: {v}");
    }
}

#[test]
fn test_waveform_auto_gain_lifts_quiet_audio() {
    let mut analyzer = Analyzer::new(64);
    let quiet = tone(440.0, 44100.0, 0.05, FFT_SIZE);
    let mut wave = Vec::new();
    for _ in 0..80 {
        wave = analyzer.compute_waveform(&quiet, 120);
    }
    let raw_peak = quiet.iter().fold(0.0f32, |m, s| m.max(s.abs()));
    let peak = wave.iter().fold(0.0f32, |m, s| m.max(s.abs()));
    assert!(
        peak > raw_peak * 5.0,
        "quiet audio should be boosted (raw {raw_peak}, gained {peak})"
    );
    assert!(
        peak <= 1.0,
        "auto gain must not exceed full scale, got {peak}"
    );

    // A full-scale signal is attenuated instead of clipping hard.
    let mut loud = Analyzer::new(64);
    let loud_wave = loud.compute_waveform(&tone(440.0, 44100.0, 1.0, FFT_SIZE), 120);
    let loud_peak = loud_wave.iter().fold(0.0f32, |m, s| m.max(s.abs()));
    assert!(
        (0.5..=1.0).contains(&loud_peak),
        "loud trace should fill but not clip, got {loud_peak}"
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
