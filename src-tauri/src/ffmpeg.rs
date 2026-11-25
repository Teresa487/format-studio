use crate::model::{AudioCodec, Channels, Container, HwAccel, QualityMode, Task, VideoCodec};
use std::path::PathBuf;

/// 优先用随包分发的 ffmpeg，其次退回 PATH。
pub fn ffmpeg_path() -> PathBuf {
    bin_path("ffmpeg.exe", "ffmpeg")
}

pub fn ffprobe_path() -> PathBuf {
    bin_path("ffprobe.exe", "ffprobe")
}

fn bin_path(exe_name: &str, fallback: &str) -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join(exe_name);
            if p.exists() {
                return p;
            }
        }
    }
    PathBuf::from(fallback)
}

fn video_encoder(vc: VideoCodec, hw: HwAccel) -> &'static str {
    match (vc, hw) {
        (VideoCodec::H264, HwAccel::None) => "libx264",
        (VideoCodec::H264, HwAccel::Nvenc) => "h264_nvenc",
        (VideoCodec::H264, HwAccel::Qsv) => "h264_qsv",
        (VideoCodec::H264, HwAccel::Amf) => "h264_amf",
        (VideoCodec::H265, HwAccel::None) => "libx265",
        (VideoCodec::H265, HwAccel::Nvenc) => "hevc_nvenc",
        (VideoCodec::H265, HwAccel::Qsv) => "hevc_qsv",
        (VideoCodec::H265, HwAccel::Amf) => "hevc_amf",
        (VideoCodec::Av1, _) => "libsvtav1",
        (VideoCodec::Vp9, _) => "libvpx-vp9",
    }
}

fn audio_encoder(ac: AudioCodec) -> &'static str {
    match ac {
        AudioCodec::Copy => "copy",
        AudioCodec::Aac => "aac",
        AudioCodec::Mp3 => "libmp3lame",
        AudioCodec::Opus => "libopus",
        AudioCodec::Ac3 => "ac3",
    }
}

/// x264/x265 的 preset 词表 → NVENC 的 p1..p7
fn nvenc_preset(p: &str) -> &'static str {
    match p {
        "ultrafast" | "superfast" | "veryfast" => "p1",
        "faster" => "p2",
        "fast" => "p3",
        "medium" => "p5",
        "slow" => "p6",
        _ => "p7",
    }
}

/// x264 词表 → AMF 的 quality 档位
fn amf_quality(p: &str) -> &'static str {
    match p {
        "ultrafast" | "superfast" | "veryfast" | "faster" | "fast" => "speed",
        "medium" => "balanced",
        _ => "quality",
    }
}

/// SVT-AV1 的 preset 是 0..13 的数字，越小越慢
fn svt_preset(p: &str) -> &'static str {
    match p {
        "ultrafast" | "superfast" => "13",
        "veryfast" => "11",
        "faster" | "fast" => "10",
        "medium" => "8",
        "slow" => "6",
        _ => "4",
    }
}

/// libvpx-vp9 的 cpu-used 是 0..8
fn vp9_cpu_used(p: &str) -> &'static str {
    match p {
        "ultrafast" | "superfast" | "veryfast" => "8",
        "faster" | "fast" => "6",
        "medium" => "4",
        "slow" => "2",
        _ => "0",
    }
}

fn channels_ac(c: Channels) -> Option<u8> {
    match c {
        Channels::Keep => None,
        Channels::Stereo => Some(2),
        Channels::Mono => Some(1),
    }
}

/// 把 Task 翻译成完整的 ffmpeg 参数表。
pub fn build_args(task: &Task) -> Result<Vec<String>, String> {
    let p = task.params.normalize();
    let mut a: Vec<String> = vec!["-hide_banner".into(), "-y".into()];

    // 1) 入点放在 -i 之前：走快速 seek，秒级精度足够日常用
    if let Some(t) = &task.trim {
        a.push("-ss".into());
        a.push(format!("{:.3}", t.start.max(0.0)));
    }

    // 2) 输入
    a.push("-i".into());
    a.push(task.input.to_string_lossy().to_string());

    // 3) 时长用 -t 而不是 -to，语义无歧义
    if let Some(t) = &task.trim {
        let d = (t.end - t.start).max(0.05);
        a.push("-t".into());
        a.push(format!("{:.3}", d));
    }

    // 4) 视频
    match p.video_codec {
        Some(vc) => {
            a.push("-c:v".into());
            a.push(video_encoder(vc, p.hw).to_string());

            // 4.1 质量
            match p.quality_mode {
                QualityMode::Rf => {
                    let q = p.rf.unwrap_or(22);
                    match (vc, p.hw) {
                        (VideoCodec::Vp9, _) => {
                            // VP9 恒定质量必须配合 -b:v 0
                            a.push("-b:v".into());
                            a.push("0".into());
                            a.push("-crf".into());
                            a.push(q.to_string());
                        }
                        (_, HwAccel::None) => {
                            a.push("-crf".into());
                            a.push(q.to_string());
                        }
                        (_, HwAccel::Nvenc) => {
                            a.push("-rc".into());
                            a.push("vbr".into());
                            a.push("-cq".into());
                            a.push(q.to_string());
                        }
                        (_, HwAccel::Qsv) => {
                            a.push("-global_quality".into());
                            a.push(q.to_string());
                        }
                        (_, HwAccel::Amf) => {
                            a.push("-rc".into());
                            a.push("cqp".into());
                            a.push("-qp_i".into());
                            a.push(q.to_string());
                            a.push("-qp_p".into());
                            a.push(q.to_string());
                        }
                    }
                }
                QualityMode::Bitrate => {
                    a.push("-b:v".into());
                    a.push(p.bitrate.clone().unwrap_or_else(|| "4M".into()));
                }
            }

            // 4.2 速度预设：每个编码器词表都不一样
            if let Some(pr) = &p.preset {
                match (vc, p.hw) {
                    (VideoCodec::Av1, _) => {
                        a.push("-preset".into());
                        a.push(svt_preset(pr).into());
                    }
                    (VideoCodec::Vp9, _) => {
                        a.push("-cpu-used".into());
                        a.push(vp9_cpu_used(pr).into());
                        a.push("-row-mt".into());
                        a.push("1".into());
                    }
                    (_, HwAccel::None) => {
                        a.push("-preset".into());
                        a.push(pr.clone());
                    }
                    (_, HwAccel::Nvenc) => {
                        a.push("-preset".into());
                        a.push(nvenc_preset(pr).into());
                    }
                    (_, HwAccel::Qsv) => {
                        a.push("-preset".into());
                        a.push(pr.clone());
                    }
                    (_, HwAccel::Amf) => {
                        a.push("-quality".into());
                        a.push(amf_quality(pr).into());
                    }
                }
            }

            // 4.3 滤镜链：去隔行和缩放必须合进同一个 -vf
            let mut filters: Vec<String> = Vec::new();
            if p.deinterlace {
                filters.push("yadif".into());
            }
            if let Some(h) = p.height {
                // -2 保证宽度是偶数，否则 libx264 直接报错
                filters.push(format!("scale=-2:{h}"));
            }
            if !filters.is_empty() {
                a.push("-vf".into());
                a.push(filters.join(","));
            }

            // 4.4 帧率
            if let Some(fps) = p.fps {
                a.push("-r".into());
                a.push(format!("{fps}"));
            }

            // 4.5 像素格式：统一成 yuv420p，兼容性最好
            a.push("-pix_fmt".into());
            a.push("yuv420p".into());
        }
        None => {
            a.push("-vn".into());
        }
    }

    // 5) 音频
    a.push("-c:a".into());
    a.push(audio_encoder(p.audio_codec).to_string());
    if p.audio_codec == AudioCodec::Copy {
        // 流复制时不能再指定码率/声道，ffmpeg 会直接报错
    } else {
        a.push("-b:a".into());
        a.push(format!("{}k", p.audio_bitrate));
        if let Some(ac) = channels_ac(p.channels) {
            a.push("-ac".into());
            a.push(ac.to_string());
        }
    }

    // 6) 容器特性
    if p.container == Container::Mp4 && p.faststart {
        a.push("-movflags".into());
        a.push("+faststart".into());
    }

    // 7) 进度走 stdout，日志别刷屏
    a.push("-progress".into());
    a.push("pipe:1".into());
    a.push("-nostats".into());

    // 8) 输出到临时文件
    a.push(task.temp_path().to_string_lossy().to_string());

    Ok(a)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::*;
    use std::path::PathBuf;

    fn task() -> Task {
        Task {
            id: "t1".into(),
            input: PathBuf::from("in.mp4"),
            output: PathBuf::from("out.mp4"),
            duration: 10.0,
            status: Status::Queued,
            progress: 0.0,
            speed: None,
            trim: None,
            params: EncodeParams::default(),
            error: None,
            created_at: 0,
        }
    }

    fn args(t: &Task) -> String {
        build_args(t).unwrap().join(" ")
    }

    #[test]
    fn default_is_libx264_crf() {
        let s = args(&task());
        assert!(s.contains("-c:v libx264"));
        assert!(s.contains("-crf 22"));
        assert!(s.contains("-preset medium"));
        assert!(s.contains("-pix_fmt yuv420p"));
        assert!(s.contains("-movflags +faststart"));
        assert!(s.ends_with("out.tmp.mp4"));
    }

    #[test]
    fn trim_uses_ss_before_input_and_t_for_duration() {
        let mut t = task();
        t.trim = Some(Trim { start: 5.0, end: 12.5 });
        let s = args(&t);
        let ss = s.find("-ss 5.000").unwrap();
        let i = s.find("-i in.mp4").unwrap();
        assert!(ss < i, "-ss 必须在 -i 之前");
        assert!(s.contains("-t 7.500"));
    }

    #[test]
    fn nvenc_uses_cq_not_crf() {
        let mut t = task();
        t.params.hw = HwAccel::Nvenc;
        let s = args(&t);
        assert!(s.contains("-c:v h264_nvenc"));
        assert!(s.contains("-cq 22"));
        assert!(!s.contains("-crf"));
        assert!(s.contains("-preset p5"));
    }

    #[test]
    fn filters_are_merged_into_one_vf() {
        let mut t = task();
        t.params.deinterlace = true;
        t.params.height = Some(720);
        let s = args(&t);
        assert_eq!(s.matches("-vf").count(), 1, "只能有一个 -vf");
        assert!(s.contains("yadif,scale=-2:720"));
    }

    #[test]
    fn webm_is_normalized_to_av1_opus() {
        let mut t = task();
        t.params.container = Container::Webm;
        t.params.video_codec = Some(VideoCodec::H264); // 非法组合
        let s = args(&t);
        assert!(s.contains("-c:v libsvtav1"));
        assert!(s.contains("-c:a libopus"));
        assert!(!s.contains("faststart"));
    }

    #[test]
    fn mp3_container_drops_video() {
        let mut t = task();
        t.params.container = Container::Mp3;
        let s = args(&t);
        assert!(s.contains("-vn"));
        assert!(s.contains("-c:a libmp3lame"));
    }

    #[test]
    fn av1_preset_is_numeric() {
        let mut t = task();
        t.params.video_codec = Some(VideoCodec::Av1);
        let s = args(&t);
        assert!(s.contains("-preset 8"), "medium 应映射成 SVT 的 8: {s}");
    }

    #[test]
    fn mono_downmix() {
        let mut t = task();
        t.params.channels = Channels::Mono;
        assert!(args(&t).contains("-ac 1"));
    }

    #[test]
    fn audio_copy_skips_bitrate_and_channels() {
        let mut t = task();
        t.params.audio_codec = AudioCodec::Copy;
        t.params.audio_bitrate = 320;
        t.params.channels = Channels::Mono;
        let s = args(&t);
        assert!(s.contains("-c:a copy"), "应使用流复制: {s}");
        assert!(!s.contains("-b:a"), "流复制时不能带码率: {s}");
        assert!(!s.contains("-ac "), "流复制时不能带声道: {s}");
    }

    #[test]
    fn webm_keeps_copy_but_forces_opus_otherwise() {
        let mut t = task();
        t.params.container = Container::Webm;
        t.params.audio_codec = AudioCodec::Copy;
        assert!(args(&t).contains("-c:a copy"), "WebM 下应保留流复制");

        t.params.audio_codec = AudioCodec::Aac;
        assert!(args(&t).contains("-c:a libopus"), "非复制时应纠正为 Opus");
    }
}
