use crossbeam_channel::Receiver;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::sync::RwLock;

use crate::playback::Playback;
use crate::protocol::{event, next_event_seq};
use crate::visualizer::{Analyzer, VisualizerConfig, VisualizerMode};

pub fn spawn_visualizer_task(
    playback: Playback,
    pcm_rx: Receiver<Vec<f32>>,
    viz_cfg: Arc<RwLock<VisualizerConfig>>,
    viz_stdout_tx: mpsc::Sender<String>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut analyzer = Analyzer::new(64);
        let mut ring_buffer = vec![0.0f32; 1024];
        let mut mock_phase: f32 = 0.0;
        let sample_rate = 44100.0_f32;
        let mut last_tick = std::time::Instant::now();
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
                        let payload = serde_json::json!({ "samples": vec![0.0; waveform_samples] });
                        event("visualizer.waveform", seq, payload)
                    }
                    _ => {
                        let bands = analyzer.compute_spectrum(&empty_samples, mode);
                        let payload = serde_json::json!({ "bands": bands });
                        event("visualizer.spectrum", seq, payload)
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
                let elapsed = last_tick.elapsed().as_secs_f32();
                for i in 0..1024 {
                    let t = mock_phase + (i as f32) / sample_rate;
                    let bass = 0.40 * (2.0 * std::f32::consts::PI * 65.0 * t).sin();
                    let kick = 0.30 * (2.0 * std::f32::consts::PI * 130.0 * t).sin();
                    let mid1 = 0.25 * (2.0 * std::f32::consts::PI * 440.0 * t).sin();
                    let mid2 = 0.20 * (2.0 * std::f32::consts::PI * 880.0 * t).sin();
                    let treble = 0.15 * (2.0 * std::f32::consts::PI * 3520.0 * t).sin();
                    ring_buffer[i] = (bass + kick + mid1 + mid2 + treble).clamp(-1.0, 1.0);
                }
                mock_phase = (mock_phase + elapsed) % 1000.0;
            }
            last_tick = std::time::Instant::now();

            let seq = next_event_seq();
            let line = match mode {
                VisualizerMode::Oscilloscope => {
                    let downsampled = Analyzer::compute_waveform(&ring_buffer, waveform_samples);
                    let payload = serde_json::json!({ "samples": downsampled });
                    event("visualizer.waveform", seq, payload)
                }
                _ => {
                    let bands = analyzer.compute_spectrum(&ring_buffer, mode);
                    let payload = serde_json::json!({ "bands": bands });
                    event("visualizer.spectrum", seq, payload)
                }
            };
            let _ = viz_stdout_tx.try_send(line);
        }
    })
}
