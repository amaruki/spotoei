pub struct VisualizerSink {
    pub(super) inner: Box<dyn librespot::playback::audio_backend::Sink>,
    pub(super) pcm_sender: crossbeam_channel::Sender<Vec<f32>>,
}

impl librespot::playback::audio_backend::Sink for VisualizerSink {
    fn start(&mut self) -> librespot::playback::audio_backend::SinkResult<()> {
        self.inner.start()
    }

    fn stop(&mut self) -> librespot::playback::audio_backend::SinkResult<()> {
        self.inner.stop()
    }

    fn write(
        &mut self,
        packet: librespot::playback::decoder::AudioPacket,
        converter: &mut librespot::playback::convert::Converter,
    ) -> librespot::playback::audio_backend::SinkResult<()> {
        if let Ok(samples) = packet.samples() {
            let mut mono = Vec::with_capacity(samples.len() / 2);
            for chunk in samples.chunks_exact(2) {
                mono.push(0.5 * (chunk[0] as f32 + chunk[1] as f32));
            }
            if !mono.is_empty() {
                let _ = self.pcm_sender.try_send(mono);
            }
        }
        self.inner.write(packet, converter)
    }
}

/// Dummy sink for connect-only mode or fallback when no audio hardware is present.
/// Paces audio writes in real-time so decoder does not race ahead.
pub struct DummySink {
    start_time: Option<std::time::Instant>,
    written_samples: u64,
    sample_rate: u32,
}

impl DummySink {
    pub fn new() -> Self {
        Self {
            start_time: None,
            written_samples: 0,
            sample_rate: 44100,
        }
    }
}

impl Default for DummySink {
    fn default() -> Self {
        Self::new()
    }
}

impl librespot::playback::audio_backend::Sink for DummySink {
    fn start(&mut self) -> librespot::playback::audio_backend::SinkResult<()> {
        self.start_time = Some(std::time::Instant::now());
        self.written_samples = 0;
        Ok(())
    }

    fn stop(&mut self) -> librespot::playback::audio_backend::SinkResult<()> {
        self.start_time = None;
        self.written_samples = 0;
        Ok(())
    }

    fn write(
        &mut self,
        packet: librespot::playback::decoder::AudioPacket,
        _converter: &mut librespot::playback::convert::Converter,
    ) -> librespot::playback::audio_backend::SinkResult<()> {
        if let Ok(samples) = packet.samples() {
            self.written_samples = self.written_samples.saturating_add(samples.len() as u64);
            let start = self.start_time.get_or_insert_with(std::time::Instant::now);
            let target_secs = (self.written_samples as f64) / (self.sample_rate as f64 * 2.0);
            let target_dur = std::time::Duration::from_secs_f64(target_secs);
            let elapsed = start.elapsed();
            if let Some(sleep_time) = target_dur.checked_sub(elapsed) {
                if sleep_time < std::time::Duration::from_millis(50) {
                    std::thread::sleep(sleep_time);
                } else {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
            }
        }
        Ok(())
    }
}
