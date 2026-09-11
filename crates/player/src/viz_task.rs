use crossbeam_channel::Receiver;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tokio::sync::RwLock;

use crate::playback::Playback;
use crate::protocol::next_event_seq;
use crate::visualizer::{
    format_spectrum_event, format_waveform_event, Analyzer, MockSampleGenerator, VisualizerConfig,
    VisualizerMode, FFT_SIZE,
};

// The analysis ring must hold at least one full FFT window; `compute_spectrum`
// zero-pads anything shorter, which would silently halve the signal energy.
pub const RING_LEN: usize = FFT_SIZE;

// How long a real PCM window stays valid while "playing". Past this we treat
// the stream as stalled and decay the bars instead of freezing stale heights.
const PCM_STALE_AFTER: Duration = Duration::from_secs(2);

/// Slide a new mono PCM chunk into the analysis ring buffer. Chunks larger
/// than the ring keep only their newest `RING_LEN` samples.
pub fn update_ring(ring: &mut [f32; RING_LEN], chunk: &[f32]) {
    if chunk.is_empty() {
        return;
    }
    if chunk.len() >= RING_LEN {
        ring.copy_from_slice(&chunk[chunk.len() - RING_LEN..]);
        return;
    }
    ring.rotate_left(chunk.len());
    let start = RING_LEN - chunk.len();
    ring[start..].copy_from_slice(chunk);
}

pub fn spawn_visualizer_task(
    playback: Playback,
    pcm_rx: Receiver<Vec<f32>>,
    viz_cfg: Arc<RwLock<VisualizerConfig>>,
    viz_stdout_tx: mpsc::Sender<String>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut analyzer = Analyzer::new(64);
        let mut ring_buffer = [0.0f32; RING_LEN];
        let mut mock_gen = MockSampleGenerator::new(44100.0);
        // Synthetic tones are only a stand-in until the first real decoded
        // packet lands; after that, silent ticks reuse the last real window
        // (or decay when the stream goes stale) so the display never lies
        // about the frequencies of the current track.
        let mut received_real_pcm = false;
        let mut last_real_pcm_at: Option<Instant> = None;
        loop {
            let fps = viz_cfg.read().await.fps.max(1);
            let interval_ms = (1000_u64 / fps as u64).max(1);
            tokio::time::sleep(Duration::from_millis(interval_ms)).await;

            let cfg = viz_cfg.read().await;
            if !cfg.enabled {
                continue;
            }
            let mode = cfg.mode;
            let bands = cfg.bands;
            let waveform_samples = cfg.waveform_samples;
            let sample_rate = cfg.sample_rate;
            drop(cfg);
            analyzer.set_bands(bands);
            analyzer.set_sample_rate(sample_rate);

            let snap = playback.snapshot().await;
            if snap.state != "playing" {
                let empty_samples: [f32; 0] = [];
                let seq = next_event_seq();
                let line = match mode {
                    VisualizerMode::Oscilloscope => {
                        let samples = vec![0.0; waveform_samples];
                        format_waveform_event(seq, &samples)
                    }
                    _ => {
                        let bands = analyzer.compute_spectrum(&empty_samples, mode);
                        format_spectrum_event(seq, &bands)
                    }
                };
                let _ = viz_stdout_tx.try_send(line);
                continue;
            }

            // Drain fresh PCM packets from audio sink.
            let mut got_real_pcm = false;
            while let Ok(chunk) = pcm_rx.try_recv() {
                got_real_pcm = true;
                update_ring(&mut ring_buffer, &chunk);
            }
            if got_real_pcm {
                received_real_pcm = true;
                last_real_pcm_at = Some(Instant::now());
            } else if !received_real_pcm {
                mock_gen.generate_into(&mut ring_buffer);
            }

            let stale = last_real_pcm_at
                .map(|at| at.elapsed() >= PCM_STALE_AFTER)
                .unwrap_or(false);
            let silence = !got_real_pcm && stale;

            let seq = next_event_seq();
            let line = match mode {
                VisualizerMode::Oscilloscope => {
                    if silence {
                        format_waveform_event(seq, &vec![0.0; waveform_samples])
                    } else {
                        let downsampled =
                            Analyzer::compute_waveform(&ring_buffer, waveform_samples);
                        format_waveform_event(seq, &downsampled)
                    }
                }
                _ => {
                    let empty_samples: [f32; 0] = [];
                    let bands = if silence {
                        analyzer.compute_spectrum(&empty_samples, mode)
                    } else {
                        analyzer.compute_spectrum(&ring_buffer, mode)
                    };
                    format_spectrum_event(seq, &bands)
                }
            };
            let _ = viz_stdout_tx.try_send(line);
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_ring_keeps_newest_samples_for_large_chunks() {
        let mut ring = [0.0f32; RING_LEN];
        let chunk: Vec<f32> = (0..RING_LEN * 2).map(|i| i as f32).collect();
        update_ring(&mut ring, &chunk);
        assert_eq!(ring[0], RING_LEN as f32);
        assert_eq!(ring[RING_LEN - 1], (RING_LEN * 2 - 1) as f32);
    }

    #[test]
    fn update_ring_appends_small_chunks_and_advances_oldest_out() {
        let mut ring = [0.0f32; RING_LEN];
        for i in 0..RING_LEN {
            ring[i] = i as f32;
        }
        update_ring(&mut ring, &[999.0, 1000.0, 1001.0]);
        assert_eq!(ring[0], 3.0);
        assert_eq!(&ring[RING_LEN - 3..], &[999.0, 1000.0, 1001.0]);
    }

    #[test]
    fn update_ring_ignores_empty_chunks() {
        let mut ring = [0.0f32; RING_LEN];
        ring[0] = 7.0;
        ring[RING_LEN - 1] = 9.0;
        update_ring(&mut ring, &[]);
        assert_eq!(ring[0], 7.0);
        assert_eq!(ring[RING_LEN - 1], 9.0);
    }
}
