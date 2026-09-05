use crossbeam_channel::Receiver;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::sync::RwLock;

use crate::playback::Playback;
use crate::protocol::next_event_seq;
use crate::visualizer::{
    format_spectrum_event, format_waveform_event, Analyzer, MockSampleGenerator, VisualizerConfig,
    VisualizerMode,
};

pub fn spawn_visualizer_task(
    playback: Playback,
    pcm_rx: Receiver<Vec<f32>>,
    viz_cfg: Arc<RwLock<VisualizerConfig>>,
    viz_stdout_tx: mpsc::Sender<String>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut analyzer = Analyzer::new(64);
        let mut ring_buffer = vec![0.0f32; 1024];
        let mut mock_gen = MockSampleGenerator::new(44100.0);
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
            drop(cfg);
            analyzer.set_bands(bands);

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

            // Drain fresh PCM packets from audio sink
            let mut got_real_pcm = false;
            while let Ok(chunk) = pcm_rx.try_recv() {
                got_real_pcm = true;
                if chunk.len() >= 1024 {
                    ring_buffer.copy_from_slice(&chunk[chunk.len() - 1024..]);
                } else {
                    ring_buffer.rotate_left(chunk.len());
                    let start = 1024 - chunk.len();
                    ring_buffer[start..].copy_from_slice(&chunk);
                }
            }

            if !got_real_pcm {
                mock_gen.generate_into(&mut ring_buffer);
            }

            let seq = next_event_seq();
            let line = match mode {
                VisualizerMode::Oscilloscope => {
                    let downsampled = Analyzer::compute_waveform(&ring_buffer, waveform_samples);
                    format_waveform_event(seq, &downsampled)
                }
                _ => {
                    let bands = analyzer.compute_spectrum(&ring_buffer, mode);
                    format_spectrum_event(seq, &bands)
                }
            };
            let _ = viz_stdout_tx.try_send(line);
        }
    })
}
