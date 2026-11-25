use crate::ffmpeg::{build_args, ffmpeg_path};
use crate::model::{Status, Task};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;

/// 队列 + 任务表。worker 单线程串行执行：
/// 消费级显卡的 NVENC 有并发会话数限制，排队反而更稳定。
#[derive(Default)]
pub struct Queue {
    inner: Mutex<QueueInner>,
    wake: Condvar,
}

#[derive(Default)]
struct QueueInner {
    tasks: HashMap<String, Task>,
    order: Vec<String>,
    running: Option<String>,
    cancel_flags: HashMap<String, Arc<AtomicBool>>,
}

impl Queue {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add(&self, task: Task) {
        let mut g = self.inner.lock().unwrap();
        g.order.push(task.id.clone());
        g.tasks.insert(task.id.clone(), task);
        drop(g);
        self.wake.notify_all();
    }

    pub fn snapshot(&self) -> Vec<Task> {
        let g = self.inner.lock().unwrap();
        g.order
            .iter()
            .filter_map(|id| g.tasks.get(id).cloned())
            .collect()
    }

    pub fn cancel(&self, id: &str) {
        let g = self.inner.lock().unwrap();
        if let Some(flag) = g.cancel_flags.get(id) {
            flag.store(true, Ordering::SeqCst);
        }
        // 还没开跑的直接标成已取消，worker 会跳过
        drop(g);
        let mut g = self.inner.lock().unwrap();
        if let Some(t) = g.tasks.get_mut(id) {
            if t.status == Status::Queued {
                t.status = Status::Cancelled;
                t.error = None;
            }
        }
    }

    pub fn retry(&self, id: &str) {
        let mut g = self.inner.lock().unwrap();
        if let Some(t) = g.tasks.get_mut(id) {
            if matches!(t.status, Status::Failed | Status::Cancelled) {
                t.status = Status::Queued;
                t.progress = 0.0;
                t.speed = None;
                t.error = None;
                g.cancel_flags.remove(id);
            }
        }
        drop(g);
        self.wake.notify_all();
    }

    pub fn remove(&self, id: &str) {
        let mut g = self.inner.lock().unwrap();
        if g.running.as_deref() == Some(id) {
            return; // 正在跑的不能删
        }
        g.order.retain(|x| x != id);
        g.tasks.remove(id);
        g.cancel_flags.remove(id);
    }

    /// 取下一个待办任务，没有就阻塞等待。
    fn next_queued(&self) -> Option<Task> {
        let mut g = self.inner.lock().unwrap();
        loop {
            if let Some(id) = g
                .order
                .iter()
                .find(|id| {
                    g.tasks
                        .get(*id)
                        .map(|t| t.status == Status::Queued)
                        .unwrap_or(false)
                })
                .cloned()
            {
                if let Some(t) = g.tasks.get_mut(&id) {
                    t.status = Status::Running;
                    t.progress = 0.0;
                    t.speed = None;
                    let task = t.clone();
                    g.running = Some(id.clone());
                    g.cancel_flags
                        .insert(id, Arc::new(AtomicBool::new(false)));
                    return Some(task);
                }
            }
            g = self.wake.wait(g).unwrap();
        }
    }

    fn finish(&self, id: &str, status: Status, error: Option<String>) {
        let mut g = self.inner.lock().unwrap();
        if let Some(t) = g.tasks.get_mut(id) {
            t.status = status;
            t.error = error;
            if status == Status::Done {
                t.progress = 1.0;
            }
            t.speed = None;
        }
        g.running = None;
        g.cancel_flags.remove(id);
    }

    fn update_progress(&self, id: &str, progress: f32, speed: Option<f32>) -> Option<Task> {
        let mut g = self.inner.lock().unwrap();
        let t = g.tasks.get_mut(id)?;
        // speed 事件只带速度，进度沿用上一次的值
        if !progress.is_nan() {
            t.progress = progress;
        }
        if speed.is_some() {
            t.speed = speed;
        }
        Some(t.clone())
    }

    fn cancel_flag(&self, id: &str) -> Option<Arc<AtomicBool>> {
        self.inner.lock().unwrap().cancel_flags.get(id).cloned()
    }
}

/// 起 worker 线程。每个进度事件都通过 `emit` 回调推给前端。
pub fn spawn_worker<E>(queue: Arc<Queue>, emit: E)
where
    E: Fn(Task) + Send + 'static,
{
    thread::spawn(move || loop {
        let Some(task) = queue.next_queued() else {
            continue;
        };
        emit(task.clone());

        let flag = queue
            .cancel_flag(&task.id)
            .unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
        let result = run_one(&task, &flag, |p, s| {
            if let Some(t) = queue.update_progress(&task.id, p, s) {
                emit(t);
            }
        });

        match result {
            Ok(()) => {
                queue.finish(&task.id, Status::Done, None);
                if let Some(t) = queue.snapshot().into_iter().find(|t| t.id == task.id) {
                    emit(t);
                }
            }
            Err(RunError::Cancelled) => {
                let _ = std::fs::remove_file(task.temp_path());
                queue.finish(&task.id, Status::Cancelled, None);
                if let Some(t) = queue.snapshot().into_iter().find(|t| t.id == task.id) {
                    emit(t);
                }
            }
            Err(RunError::Failed(msg)) => {
                let _ = std::fs::remove_file(task.temp_path());
                queue.finish(&task.id, Status::Failed, Some(msg.clone()));
                if let Some(t) = queue.snapshot().into_iter().find(|t| t.id == task.id) {
                    emit(t);
                }
            }
        }
    });
}

enum RunError {
    Cancelled,
    Failed(String),
}

fn run_one<F>(task: &Task, cancel: &AtomicBool, mut on_progress: F) -> Result<(), RunError>
where
    F: FnMut(f32, Option<f32>),
{
    let args = build_args(task).map_err(RunError::Failed)?;

    // 输出目录不存在就建
    if let Some(dir) = task.output.parent() {
        let _ = std::fs::create_dir_all(dir);
    }

    let mut child = Command::new(ffmpeg_path())
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| RunError::Failed(format!("无法启动 ffmpeg: {e}")))?;

    let stdout = child.stdout.take().unwrap();
    // stderr 单独收集，失败时给用户看真正的报错
    let stderr = child.stderr.take().unwrap();
    let err_handle = thread::spawn(move || {
        let mut buf = String::new();
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            buf.push_str(&line);
            buf.push('\n');
            if buf.len() > 64 * 1024 {
                buf.drain(..32 * 1024);
            }
        }
        buf
    });

    // 剪辑区间的时长才是分母，不是源文件总长
    let denom = task
        .trim
        .map(|t| (t.end - t.start).max(0.05))
        .unwrap_or(task.duration)
        .max(0.05);

    let mut cancelled = false;
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        if cancel.load(Ordering::SeqCst) {
            cancelled = true;
            let _ = child.kill();
            break;
        }
        if let Some(v) = line.strip_prefix("out_time_us=") {
            // 注意：ffmpeg 的 out_time_ms 实际单位是微秒，这里统一用 _us 字段
            if let Ok(us) = v.trim().parse::<f64>() {
                let pct = (us / 1_000_000.0 / denom).clamp(0.0, 1.0) as f32;
                on_progress(pct, None);
            }
        } else if let Some(v) = line.strip_prefix("speed=") {
            let s = v.trim().trim_end_matches('x');
            if let Ok(sp) = s.parse::<f32>() {
                // 上一次的进度值会被 update_progress 保留
                on_progress(f32::NAN, Some(sp));
            }
        } else if line.starts_with("progress=end") {
            on_progress(1.0, None);
        }
    }

    let status = child.wait().map_err(|e| RunError::Failed(e.to_string()))?;
    let stderr_text = err_handle.join().unwrap_or_default();

    if cancelled {
        return Err(RunError::Cancelled);
    }

    if !status.success() {
        let tail: String = stderr_text
            .lines()
            .rev()
            .take(6)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        return Err(RunError::Failed(format!(
            "ffmpeg 退出码 {:?}\n{}",
            status.code(),
            tail.trim()
        )));
    }

    // 成功：临时文件改名为正式文件
    let tmp = task.temp_path();
    if !tmp.exists() {
        return Err(RunError::Failed("ffmpeg 报告成功但未生成文件".into()));
    }
    if task.output.exists() {
        std::fs::remove_file(&task.output)
            .map_err(|e| RunError::Failed(format!("无法覆盖已有输出文件: {e}")))?;
    }
    std::fs::rename(&tmp, &task.output)
        .map_err(|e| RunError::Failed(format!("重命名输出文件失败: {e}")))?;

    Ok(())
}

/// 缩略图 / 胶片条：一次 ffmpeg 调用均匀抽 `count` 帧。
pub fn extract_frames(
    input: &PathBuf,
    duration: f64,
    count: u32,
    out_dir: &PathBuf,
    tag: &str,
) -> Vec<String> {
    if count == 0 || duration <= 0.0 {
        return vec![];
    }
    let _ = std::fs::create_dir_all(out_dir);

    // 先清掉上一轮的残留
    if let Ok(rd) = std::fs::read_dir(out_dir) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            if n.starts_with(&format!("{tag}_")) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }

    let pattern = out_dir.join(format!("{tag}_%03d.jpg"));
    // 均匀采样：总时长 / 帧数 = 采样间隔
    let interval = (duration / count as f64).max(0.04);
    let filter = format!("fps=1/{interval},scale=160:-2");

    let status = Command::new(ffmpeg_path())
        .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(input)
        .args(["-vf", &filter, "-frames:v"])
        .arg(count.to_string())
        .arg(&pattern)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    if !status.map(|s| s.success()).unwrap_or(false) {
        return vec![];
    }

    (1..=count)
        .map(|i| out_dir.join(format!("{tag}_{i:03}.jpg")))
        .filter(|p| p.exists())
        .map(|p| p.to_string_lossy().to_string())
        .collect()
}
