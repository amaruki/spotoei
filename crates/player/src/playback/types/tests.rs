use super::*;

#[test]
fn test_bitrate_parsing_and_conversion() {
    assert_eq!("96".parse::<Bitrate>().unwrap(), Bitrate::Bitrate96);
    assert_eq!("96k".parse::<Bitrate>().unwrap(), Bitrate::Bitrate96);
    assert_eq!("96kbps".parse::<Bitrate>().unwrap(), Bitrate::Bitrate96);
    assert_eq!("160".parse::<Bitrate>().unwrap(), Bitrate::Bitrate160);
    assert_eq!("160k".parse::<Bitrate>().unwrap(), Bitrate::Bitrate160);
    assert_eq!("320".parse::<Bitrate>().unwrap(), Bitrate::Bitrate320);
    assert_eq!("320kbps".parse::<Bitrate>().unwrap(), Bitrate::Bitrate320);
    assert_eq!(Bitrate::try_from(96).unwrap(), Bitrate::Bitrate96);
    assert_eq!(Bitrate::try_from(160).unwrap(), Bitrate::Bitrate160);
    assert_eq!(Bitrate::try_from(320).unwrap(), Bitrate::Bitrate320);
    assert!(Bitrate::try_from(256).is_err());
    assert_eq!(Bitrate::default(), Bitrate::Bitrate320);
    assert_eq!(Bitrate::Bitrate320.as_str(), "320");
    assert_eq!(Bitrate::Bitrate320.kbps(), 320);
}

#[test]
fn test_bitrate_serde() {
    let json = "\"160\"";
    let b: Bitrate = serde_json::from_str(json).unwrap();
    assert_eq!(b, Bitrate::Bitrate160);
    let ser = serde_json::to_string(&b).unwrap();
    assert_eq!(ser, "\"160\"");
}

#[test]
fn test_librespot_config_defaults() {
    let cfg = LibrespotConfig::default();
    assert_eq!(cfg.bitrate, Bitrate::Bitrate320);
    assert_eq!(cfg.crossfade_duration_ms, 0);
    assert_eq!(cfg.normalisation_type, "album");
    assert_eq!(cfg.pregain, 0.0);
    assert!(cfg.gapless);
    assert!(cfg.normalisation);
}

#[test]
fn test_librespot_config_env_vars() {
    std::env::set_var("SPOTOEI_BITRATE", "96");
    std::env::set_var("SPOTOEI_CROSSFADE_MS", "4000");
    std::env::set_var("SPOTOEI_NORMALISATION_PREGAIN", "3.5");
    std::env::set_var("SPOTOEI_NORMALISATION_TYPE", "track");

    let cfg = LibrespotConfig::resolve();
    assert_eq!(cfg.bitrate, Bitrate::Bitrate96);
    assert_eq!(cfg.crossfade_duration_ms, 4000);
    assert_eq!(cfg.normalisation_type, "track");
    assert_eq!(cfg.pregain, 3.5);

    std::env::remove_var("SPOTOEI_BITRATE");
    std::env::remove_var("SPOTOEI_CROSSFADE_MS");
    std::env::remove_var("SPOTOEI_NORMALISATION_PREGAIN");
    std::env::remove_var("SPOTOEI_NORMALISATION_TYPE");
}
