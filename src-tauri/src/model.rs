use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// ---------------------------------------------------------------------------
// 枚举：全部小写序列化，前端直接当字符串用
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Container {
    Mp4,
    Mkv,
    Webm,
    Mp3,
}

impl Container {
    pub fn ext(&self) -> &'static str {
        match self {
            Container::Mp4 => "mp4",
            Container::Mkv => "mkv",
            Container::Webm => "webm",
            Container::Mp3 => "mp3",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum VideoCodec {
    H264,
    H265,
    Av1,
    Vp9,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AudioCodec {
    /// 保持原样：直接流复制，不重编码（秒过、零损失）
    Copy,
    Aac,
    Mp3,
    Opus,
    Ac3,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum HwAccel {
    #[default]
    None,
    Nvenc,
    Qsv,
    Amf,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum QualityMode {
    Rf,
    Bitrate,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Channels {
    Keep,
    Stereo,
    Mono,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Queued,
    Running,
    Done,
    Failed,
    Cancelled,
}

// ---------------------------------------------------------------------------
// 编码参数：界面上那 12 项，一一对应
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncodeParams {
    pub container: Container,
    pub video_codec: Option<VideoCodec>,
    #[serde(default)]
    pub hw: HwAccel,
    pub quality_mode: QualityMode,
    pub rf: Option<u8>,
    pub bitrate: Option<String>,
    pub preset: Option<String>,
    pub height: Option<u32>,
    pub fps: Option<f32>,
    pub audio_codec: AudioCodec,
    pub audio_bitrate: u32,
    pub channels: Channels,
    pub faststart: bool,
    #[serde(default)]
    pub deinterlace: bool,
}

impl Default for EncodeParams {
    fn default() -> Self {
        Self {
            container: Container::Mp4,
            video_codec: Some(VideoCodec::H264),
            hw: HwAccel::None,
            quality_mode: QualityMode::Rf,
            rf: Some(22),
            bitrate: None,
            preset: Some("medium".into()),
            height: Some(1080),
            fps: None,
            audio_codec: AudioCodec::Aac,
            audio_bitrate: 160,
            channels: Channels::Stereo,
            faststart: true,
            deinterlace: false,
        }
    }
}

impl EncodeParams {
    /// 把互相冲突的组合修正掉，避免生成 ffmpeg 一定拒绝的命令行。
    /// WebM 只认 AV1/VP9 + Opus；MP3 容器没有视频轨。
    pub fn normalize(&self) -> Self {
        let mut p = self.clone();
        match p.container {
            Container::Webm => {
                if !matches!(p.video_codec, Some(VideoCodec::Av1) | Some(VideoCodec::Vp9) | None) {
                    p.video_codec = Some(VideoCodec::Av1);
                }
                // 「保持原样」留给用户：源音频若是 Opus/Vorbis 就能直接复制
                if p.audio_codec != AudioCodec::Copy {
                    p.audio_codec = AudioCodec::Opus;
                }
                p.faststart = false;
            }
            Container::Mp3 => {
                p.video_codec = None;
                p.audio_codec = AudioCodec::Mp3;
                p.faststart = false;
            }
            _ => {}
        }
        p
    }
}

// ---------------------------------------------------------------------------
// 任务
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Trim {
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Task {
    pub id: String,
    pub input: PathBuf,
    pub output: PathBuf,
    /// 源素材总时长（秒），用于算进度百分比
    pub duration: f64,
    pub status: Status,
    pub progress: f32,
    pub speed: Option<f32>,
    pub trim: Option<Trim>,
    pub params: EncodeParams,
    pub error: Option<String>,
    pub created_at: u64,
}

impl Task {
    /// 先写 `xxx.tmp.mp4`，成功后再改名。取消/崩溃都不会留下半个坏文件。
    pub fn temp_path(&self) -> PathBuf {
        let mut p = self.output.clone();
        let ext = p
            .extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_else(|| "mp4".into());
        let stem = p
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "output".into());
        p.set_file_name(format!("{stem}.tmp.{ext}"));
        p
    }
}
