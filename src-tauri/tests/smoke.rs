// 端到端冒烟测试：真正调用 ffmpeg 转一个小文件，验证参数生成到成品的全链路。
// 运行：cargo test --manifest-path src-tauri/Cargo.toml --test smoke -- --nocapture
use format_studio_lib::model::{Container, EncodeParams, QualityMode, Status, Task, Trim, VideoCodec};
use std::path::PathBuf;
use std::process::Command;

fn ffmpeg_ok() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn make_sample(dir: &std::path::Path) -> PathBuf {
    let p = dir.join("sample.mp4");
    let status = Command::new("ffmpeg")
        .args([
            "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=3",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30",
            "-c:a", "aac", "-b:a", "96k", "-shortest",
        ])
        .arg(&p)
        .status()
        .expect("无法生成测试素材");
    assert!(status.success(), "生成测试素材失败");
    p
}

fn probe_duration(path: &std::path::Path) -> f64 {
    let out = Command::new("ffprobe")
        .args([
            "-v", "quiet", "-print_format", "json", "-show_format",
        ])
        .arg(path)
        .output()
        .expect("ffprobe 运行失败");
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    v["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0.0)
}

#[test]
fn transcode_end_to_end_with_trim() {
    if !ffmpeg_ok() {
        eprintln!("跳过：环境里没有 ffmpeg");
        return;
    }

    let dir = std::env::temp_dir().join("format-studio-smoke");
    std::fs::create_dir_all(&dir).unwrap();
    let input = make_sample(&dir);
    let output = dir.join("sample_converted.mp4");
    let _ = std::fs::remove_file(&output);

    // 只转第 1.0 → 2.5 秒，验证裁剪区间真的生效
    let task = Task {
        id: "smoke".into(),
        input,
        output: output.clone(),
        duration: 3.0,
        status: Status::Queued,
        progress: 0.0,
        speed: None,
        trim: Some(Trim { start: 1.0, end: 2.5 }),
        params: EncodeParams {
            container: Container::Mp4,
            video_codec: Some(VideoCodec::H264),
            quality_mode: QualityMode::Rf,
            rf: Some(28),
            height: Some(480),
            ..EncodeParams::default()
        },
        error: None,
        created_at: 0,
    };

    // 直接走 worker 里那条路径的公开入口不方便，这里复刻关键三步：
    // build_args → 跑 ffmpeg → 校验产物
    let args = format_studio_lib::ffmpeg::build_args(&task).expect("参数生成失败");
    eprintln!("ffmpeg {}", args.join(" "));

    let status = Command::new("ffmpeg")
        .args(&args)
        .status()
        .expect("ffmpeg 启动失败");
    assert!(status.success(), "转码失败");

    let tmp = task.temp_path();
    assert!(tmp.exists(), "临时文件应存在: {tmp:?}");

    // 模拟 worker 的成功收尾
    std::fs::rename(&tmp, &output).unwrap();
    assert!(output.exists(), "成品文件应存在");

    let dur = probe_duration(&output);
    eprintln!("成品时长 = {dur:.2}s");
    assert!(
        (dur - 1.5).abs() < 0.35,
        "裁剪后时长应约为 1.5 秒，实际 {dur:.2} 秒"
    );

    let size = std::fs::metadata(&output).unwrap().len();
    assert!(size > 1000, "成品文件过小，可能是空文件");
    eprintln!("成品大小 = {size} 字节");
}

#[test]
fn audio_only_extraction() {
    if !ffmpeg_ok() {
        eprintln!("跳过：环境里没有 ffmpeg");
        return;
    }

    let dir = std::env::temp_dir().join("format-studio-smoke");
    std::fs::create_dir_all(&dir).unwrap();
    let input = make_sample(&dir);
    let output = dir.join("sample_converted.mp3");
    let _ = std::fs::remove_file(&output);

    let task = Task {
        id: "smoke-audio".into(),
        input,
        output: output.clone(),
        duration: 3.0,
        status: Status::Queued,
        progress: 0.0,
        speed: None,
        trim: None,
        params: EncodeParams {
            container: Container::Mp3,
            video_codec: None,
            audio_codec: format_studio_lib::model::AudioCodec::Mp3,
            ..EncodeParams::default()
        },
        error: None,
        created_at: 0,
    };

    let args = format_studio_lib::ffmpeg::build_args(&task).expect("参数生成失败");
    let status = Command::new("ffmpeg").args(&args).status().unwrap();
    assert!(status.success(), "音频提取失败");

    let tmp = task.temp_path();
    std::fs::rename(&tmp, &output).unwrap();
    assert!(std::fs::metadata(&output).unwrap().len() > 1000);
    eprintln!("MP3 提取成功: {output:?}");
}
