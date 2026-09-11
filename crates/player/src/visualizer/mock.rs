// Synthetic sample generator used when no live audio device is active
// or during mock playback mode.

use std::f32::consts::PI;

#[derive(Debug, Clone)]
pub struct MockSampleGenerator {
    phase: f32,
    sample_rate: f32,
}

impl Default for MockSampleGenerator {
    fn default() -> Self {
        Self::new(44100.0)
    }
}

impl MockSampleGenerator {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            phase: 0.0,
            sample_rate,
        }
    }

    pub fn phase(&self) -> f32 {
        self.phase
    }

    pub fn sample_rate(&self) -> f32 {
        self.sample_rate
    }

    pub fn reset(&mut self) {
        self.phase = 0.0;
    }

    /// Generate `count` synthetic audio samples across multiple frequency bands.
    pub fn generate(&mut self, count: usize) -> Vec<f32> {
        let mut buffer = vec![0.0f32; count];
        self.generate_into(&mut buffer);
        buffer
    }

    /// Fill `buffer` with synthetic audio samples across bass, mid, and treble tones.
    pub fn generate_into(&mut self, buffer: &mut [f32]) {
        let dt = 1.0 / self.sample_rate;
        for sample in buffer.iter_mut() {
            let t = self.phase;
            let bass = 0.40 * (2.0 * PI * 65.0 * t).sin();
            let kick = 0.30 * (2.0 * PI * 130.0 * t).sin();
            let mid1 = 0.25 * (2.0 * PI * 440.0 * t).sin();
            let mid2 = 0.20 * (2.0 * PI * 880.0 * t).sin();
            let treble = 0.15 * (2.0 * PI * 3520.0 * t).sin();
            *sample = (bass + kick + mid1 + mid2 + treble).clamp(-1.0, 1.0);
            self.phase += dt;
        }
        if self.phase > 1000.0 {
            self.phase %= 1000.0;
        }
    }
}

/// Helper function to generate mock audio samples into a vector.
pub fn generate_mock_samples(phase: &mut f32, sample_rate: f32, count: usize) -> Vec<f32> {
    let mut gen = MockSampleGenerator {
        phase: *phase,
        sample_rate,
    };
    let out = gen.generate(count);
    *phase = gen.phase;
    out
}
