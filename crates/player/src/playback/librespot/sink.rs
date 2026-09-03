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
