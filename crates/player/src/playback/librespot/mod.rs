use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;

mod commands;
mod session;
mod sink;

pub use sink::VisualizerSink;

/// Real audio playback engine driven by Librespot and native Rodio audio sink.
#[derive(Clone)]
pub struct LibrespotEngine {
    pub(super) auth: Arc<crate::auth::AuthManager>,
    pub(super) inner: Arc<Mutex<Option<session::LibrespotActive>>>,
    pub(super) track_metadata_cache: Arc<Mutex<HashMap<String, super::types::Track>>>,
    pub(super) pcm_sender: crossbeam_channel::Sender<Vec<f32>>,
    pub(super) pcm_receiver: crossbeam_channel::Receiver<Vec<f32>>,
}

impl LibrespotEngine {
    pub fn new(auth: Arc<crate::auth::AuthManager>) -> Self {
        let (pcm_sender, pcm_receiver) = crossbeam_channel::bounded(64);
        Self {
            auth,
            inner: Arc::new(Mutex::new(None)),
            track_metadata_cache: Arc::new(Mutex::new(HashMap::new())),
            pcm_sender,
            pcm_receiver,
        }
    }

    pub fn pcm_receiver(&self) -> crossbeam_channel::Receiver<Vec<f32>> {
        self.pcm_receiver.clone()
    }
}
