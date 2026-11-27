use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

use crate::ffmpeg::ffprobe_path;

/// 前端文件列表要显示的东西
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaInfo {
    pub path: String,
    pub name: String,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub fps: f64,
    pub video_bitrate: Option<u32>,
    pub audio_bitrate: Option<u32>,
    pub audio_channels: Option<u32>,
    pub format_name: Option<String>,
    pub size_bytes: u64,
    pub has_video: bool,
    pub error: Option<String>,
}

#[derive(Deserialize)]
struct ProbeOut {
    #[serde(default)]
    streams: Vec<ProbeStream>,
    #[serde(default)]
    format: Option<ProbeFormat>,
}

#[derive(Deserialize)]
struct ProbeStream {
    codec_type: Option<String>,
    codec_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    avg_frame_rate: Option<String>,
    duration: Option<String>,
    bit_rate: Option<String>,
    channels: Option<u32>,
}

#[derive(Deserialize)]
struct ProbeFormat {
    duration: Option<String>,
    size: Option<String>,
    format_name: Option<String>,
}

fn parse_rate(s: &str) -> f64 {
    // "30000/1001" -> 29.97
    if let Some((n, d)) = s.split_once('/') {
        let n: f64 = n.parse().unwrap_or(0.0);
        let d: f64 = d.parse().unwrap_or(0.0);
        if d > 0.0 {
            return n / d;
        }
    }
    s.parse().unwrap_or(0.0)
}

pub fn probe(path: &Path) -> MediaInfo {
    let fallback = MediaInfo {
        path: path.to_string_lossy().to_string(),
        name: path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default(),
        duration: 0.0,
        width: 0,
        height: 0,
        video_codec: None,
        audio_codec: None,
        fps: 0.0,
        video_bitrate: None,
        audio_bitrate: None,
        audio_channels: None,
        format_name: None,
        size_bytes: path.metadata().map(|m| m.len()).unwrap_or(0),
        has_video: false,
        error: None,
    };

    let out = Command::new(ffprobe_path())
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(path)
        .output();

    let out = match out {
        Ok(o) if o.status.success() => o,
        Ok(o) => {
            return MediaInfo {
                error: Some(String::from_utf8_lossy(&o.stderr).trim().to_string()),
                ..fallback
            }
        }
        Err(e) => {
            return MediaInfo {
                error: Some(format!("无法运行 ffprobe: {e}")),
                ..fallback
            }
        }
    };

    let parsed: ProbeOut = match serde_json::from_slice(&out.stdout) {
        Ok(p) => p,
        Err(e) => {
            return MediaInfo {
                error: Some(format!("解析 ffprobe 输出失败: {e}")),
                ..fallback
            }
        }
    };

    let mut info = fallback;
    let mut first_audio_dur = 0.0;

    for s in &parsed.streams {
        match s.codec_type.as_deref() {
            Some("video") if !info.has_video => {
                // 跳过封面图这类「只有一帧」的伪视频流
                if s.width.unwrap_or(0) > 0 && s.height.unwrap_or(0) > 0 {
                    info.has_video = true;
                    info.width = s.width.unwrap_or(0);
                    info.height = s.height.unwrap_or(0);
                    info.video_codec = s.codec_name.clone();
                    info.fps = s
                        .avg_frame_rate
                        .as_deref()
                        .map(parse_rate)
                        .unwrap_or(0.0);
                    info.video_bitrate = s
                        .bit_rate
                        .as_deref()
                        .and_then(|v| v.parse::<u32>().ok());
                }
            }
            Some("audio") => {
                if info.audio_codec.is_none() {
                    info.audio_codec = s.codec_name.clone();
                    info.audio_bitrate = s
                        .bit_rate
                        .as_deref()
                        .and_then(|v| v.parse::<u32>().ok());
                    info.audio_channels = s.channels;
                }
                if first_audio_dur == 0.0 {
                    first_audio_dur = s
                        .duration
                        .as_deref()
                        .and_then(|d| d.parse().ok())
                        .unwrap_or(0.0);
                }
            }
            _ => {}
        }
    }

    info.duration = parsed
        .format
        .as_ref()
        .and_then(|f| f.duration.as_deref())
        .and_then(|d| d.parse::<f64>().ok())
        .filter(|d| *d > 0.0)
        .unwrap_or(first_audio_dur);

    if let Some(size) = parsed
        .format
        .as_ref()
        .and_then(|f| f.size.as_deref())
        .and_then(|s| s.parse::<u64>().ok())
    {
        info.size_bytes = size;
    }

    info.format_name = parsed.format.as_ref().and_then(|f| f.format_name.clone());

    if !info.has_video && info.audio_codec.is_none() {
        info.error = Some("未找到可识别的音视频流".into());
    }

    info
}
