use super::super::sink::DummySink;
use super::SinkFn;

pub fn resolve_sink(
    requested_backend: crate::playback::types::AudioBackend,
    audio_device: Option<&str>,
) -> Result<(SinkFn, crate::playback::types::AudioBackend), String> {
    use crate::playback::types::AudioBackend;

    if requested_backend == AudioBackend::Dummy {
        let dummy_fn: SinkFn = Box::new(|| Box::new(DummySink::new()));
        return Ok((dummy_fn, AudioBackend::Dummy));
    }

    let mut backends_to_try = vec![requested_backend];
    for b in [
        AudioBackend::Rodio,
        AudioBackend::Alsa,
        AudioBackend::Pulseaudio,
    ] {
        if !backends_to_try.contains(&b) {
            backends_to_try.push(b);
        }
    }

    let mut last_err = String::new();
    for backend in backends_to_try {
        let backend_name = backend.as_str();
        let raw_builder = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            librespot::playback::audio_backend::find(Some(backend_name.to_string()))
        })) {
            Ok(Some(b)) => b,
            Ok(None) => {
                last_err = format!("audio backend '{backend_name}' not available in this build");
                continue;
            }
            Err(_) => {
                last_err = format!("audio backend '{backend_name}' lookup panicked");
                continue;
            }
        };

        let dev_string = audio_device.map(ToString::to_string);
        let dev_probe = dev_string.clone();

        let probe = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            raw_builder(
                dev_probe,
                librespot::playback::config::AudioFormat::default(),
            )
        }))
        .or_else(|_| {
            let dev_probe_s16 = dev_string.clone();
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                raw_builder(dev_probe_s16, librespot::playback::config::AudioFormat::S16)
            }))
        });

        match probe {
            Ok(mut test_sink) => {
                let start_res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    let res = test_sink.start();
                    let _ = test_sink.stop();
                    res
                }));
                match start_res {
                    Ok(Ok(())) => {}
                    Ok(Err(e)) => {
                        last_err = format!("backend '{backend_name}' failed to start: {e:?}");
                        continue;
                    }
                    Err(_) => {
                        last_err = format!("backend '{backend_name}' panicked during start/stop");
                        continue;
                    }
                }

                let dev_closure = dev_string.clone();
                let sink_fn: SinkFn = Box::new(move || {
                    let dev1 = dev_closure.clone();
                    let dev2 = dev_closure.clone();
                    let actual = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        raw_builder(dev1, librespot::playback::config::AudioFormat::default())
                    }))
                    .or_else(|_| {
                        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            raw_builder(dev2, librespot::playback::config::AudioFormat::S16)
                        }))
                    })
                    .unwrap_or_else(|_| {
                        tracing::warn!(
                            "Audio device runtime open failed; falling back to DummySink"
                        );
                        Box::new(DummySink::new())
                            as Box<dyn librespot::playback::audio_backend::Sink>
                    });

                    actual
                });

                return Ok((sink_fn, backend));
            }
            Err(_) => {
                last_err = format!("backend '{backend_name}' failed to open audio device");
            }
        }
    }

    Err(last_err)
}

pub fn resolve_sink_with_fallback(
    requested_backend: crate::playback::types::AudioBackend,
    audio_device: Option<&str>,
) -> (SinkFn, crate::playback::types::AudioBackend, Option<String>) {
    let resolved = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        resolve_sink(requested_backend, audio_device)
    }));
    match resolved {
        Ok(Ok((sink_fn, backend))) => (sink_fn, backend, None),
        Ok(Err(err)) => {
            tracing::warn!(
                "Audio device failed to open ({}): falling back to connect_only mode with DummySink",
                err
            );
            let dummy_fn: SinkFn = Box::new(|| Box::new(DummySink::new()));
            (
                dummy_fn,
                crate::playback::types::AudioBackend::Dummy,
                Some(err),
            )
        }
        Err(panic_payload) => {
            let msg = if let Some(s) = panic_payload.downcast_ref::<&str>() {
                (*s).to_string()
            } else if let Some(s) = panic_payload.downcast_ref::<String>() {
                s.clone()
            } else {
                "audio backend panicked during sink resolution".to_string()
            };
            tracing::error!(
                "Audio backend panicked during sink resolution ({}): falling back to connect_only mode with DummySink",
                msg
            );
            let dummy_fn: SinkFn = Box::new(|| Box::new(DummySink::new()));
            (
                dummy_fn,
                crate::playback::types::AudioBackend::Dummy,
                Some(format!("audio backend panicked: {}", msg)),
            )
        }
    }
}
