// 队列链路实测：入队 → worker 执行 → 进度回调 → 成品落盘 → 可被 ffprobe 识别。
// 用真实视频跑，验证的不是参数拼接而是整条调度链路。
use format_studio_lib::model::{Container, EncodeParams, QualityMode, Status, Task, Trim, VideoCodec};
use format_studio_lib::transcode::{spawn_worker, Queue};
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

fn src_video() -> Option<PathBuf> {
    let p = PathBuf::from("E:/workspace2/oceans.mp4");
    p.exists().then_some(p)
}

fn probe_duration(path: &std::path::Path) -> f64 {
    let out = Command::new("ffprobe")
        .args(["-v", "quiet", "-print_format", "json", "-show_format"])
        .arg(path)
        .output()
        .expect("ffprobe");
    let v: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap_or_default();
    v["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0.0)
}

#[test]
fn queue_runs_task_end_to_end() {
    let Some(input) = src_video() else {
        eprintln!("跳过：找不到 E:/workspace2/oceans.mp4");
        return;
    };

    let out_dir = std::env::temp_dir().join("format-studio-queue-test");
    std::fs::create_dir_all(&out_dir).unwrap();
    let output = out_dir.join("oceans_queue_test.mp4");
    let _ = std::fs::remove_file(&output);

    let queue = Arc::new(Queue::new());
    let seen = Arc::new(Mutex::new(Vec::<f32>::new()));
    let seen_cb = seen.clone();
    spawn_worker(queue.clone(), move |t| {
        if let Ok(mut v) = seen_cb.lock() {
            v.push(t.progress);
        }
    });

    let src_dur = probe_duration(&input);
    eprintln!("源视频时长 = {src_dur:.2}s");

    queue.add(Task {
        id: "queue-test".into(),
        input,
        output: output.clone(),
        duration: src_dur,
        status: Status::Queued,
        progress: 0.0,
        speed: None,
        // 只转 2→6 秒，验证裁剪也一起生效
        trim: Some(Trim { start: 2.0, end: 6.0 }),
        params: EncodeParams {
            container: Container::Mp4,
            video_codec: Some(VideoCodec::H264),
            quality_mode: QualityMode::Rf,
            rf: Some(30),
            preset: Some("veryfast".into()),
            height: Some(480),
            ..EncodeParams::default()
        },
        error: None,
        created_at: 0,
    });

    // 等队列跑完（最多 3 分钟）
    let deadline = Instant::now() + Duration::from_secs(180);
    let mut final_status = Status::Queued;
    while Instant::now() < deadline {
        let snap = queue.snapshot();
        if let Some(t) = snap.iter().find(|t| t.id == "queue-test") {
            final_status = t.status;
            if matches!(t.status, Status::Done | Status::Failed | Status::Cancelled) {
                if let Some(e) = &t.error {
                    eprintln!("任务错误: {e}");
                }
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(300));
    }

    assert_eq!(final_status, Status::Done, "队列任务未能完成: {final_status:?}");

    // 进度必须真的推进过，而不是一路 0 然后直接 100
    let progress: Vec<f32> = seen.lock().unwrap().clone();
    let mid = progress.iter().filter(|p| **p > 0.0 && **p < 1.0).count();
    eprintln!("收到 {} 次进度回调，其中中间态 {} 次", progress.len(), mid);
    eprintln!("采样: {:?}", &progress[..progress.len().min(12)]);
    assert!(mid >= 1, "没有收到任何中间进度，进度解析可能失效");

    // 成品校验
    assert!(output.exists(), "成品文件不存在");
    let out_dur = probe_duration(&output);
    let size = std::fs::metadata(&output).unwrap().len();
    eprintln!("成品: {out_dur:.2}s, {} 字节", size);
    assert!((out_dur - 4.0).abs() < 0.6, "裁剪后应为约 4 秒，实际 {out_dur:.2}");
    assert!(size > 10_000, "成品过小");

    // 临时文件必须已被改名，不能残留
    let tmp_leftover = out_dir.join("oceans_queue_test.tmp.mp4");
    assert!(!tmp_leftover.exists(), "临时文件残留: {tmp_leftover:?}");
}

#[test]
fn cancel_leaves_no_broken_file() {
    let Some(input) = src_video() else {
        eprintln!("跳过：找不到源视频");
        return;
    };

    let out_dir = std::env::temp_dir().join("format-studio-cancel-test");
    std::fs::create_dir_all(&out_dir).unwrap();
    let output = out_dir.join("cancel_test.mp4");
    let _ = std::fs::remove_file(&output);

    let queue = Arc::new(Queue::new());
    spawn_worker(queue.clone(), |_| {});

    let src_dur = probe_duration(&input);
    queue.add(Task {
        id: "cancel-test".into(),
        input,
        output: output.clone(),
        duration: src_dur,
        status: Status::Queued,
        progress: 0.0,
        speed: None,
        trim: None,
        params: EncodeParams {
            // 用 slow 预设拉长耗时，保证有足够时间取消
            preset: Some("slow".into()),
            video_codec: Some(VideoCodec::H264),
            ..EncodeParams::default()
        },
        error: None,
        created_at: 0,
    });

    // 等它真的开跑再取消
    std::thread::sleep(Duration::from_millis(1500));
    queue.cancel("cancel-test");

    let deadline = Instant::now() + Duration::from_secs(60);
    let mut st = Status::Running;
    while Instant::now() < deadline {
        if let Some(t) = queue.snapshot().into_iter().find(|t| t.id == "cancel-test") {
            st = t.status;
            if matches!(t.status, Status::Cancelled | Status::Done | Status::Failed) {
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(200));
    }

    eprintln!("取消后状态: {st:?}");
    assert!(matches!(st, Status::Cancelled | Status::Done), "状态异常: {st:?}");

    // 关键：不能留下半成品或临时文件
    let tmp = out_dir.join("cancel_test.tmp.mp4");
    assert!(!tmp.exists(), "取消后残留临时文件");
    if st == Status::Cancelled {
        assert!(!output.exists(), "取消后不应产出正式文件");
    }
}
