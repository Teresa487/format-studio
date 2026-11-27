pub mod ffmpeg;
mod hw;
pub mod model;
mod probe;
pub mod transcode;

use model::{EncodeParams, HwAccel, Status, Task, Trim};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

/// 全局应用状态
struct AppState {
    queue: Arc<transcode::Queue>,
    hw: HwAccel,
    /// 缩略图缓存目录
    cache_dir: PathBuf,
    /// 用户选定的输出目录；None 表示「与源文件同目录」
    out_dir: Mutex<Option<PathBuf>>,
    seq: AtomicU64,
}

#[derive(serde::Serialize)]
struct HwInfo {
    accel: HwAccel,
    label: String,
}

#[tauri::command]
fn detect_hw(state: State<'_, AppState>) -> HwInfo {
    HwInfo {
        accel: state.hw,
        label: hw::label(state.hw).to_string(),
    }
}

#[tauri::command]
fn probe_file(path: String) -> probe::MediaInfo {
    probe::probe(&PathBuf::from(path))
}

/// 抽帧生成时间轴缩略图。返回本地文件路径，前端用 convertFileSrc 转成可显示的 URL。
#[tauri::command]
fn make_thumbnails(
    state: State<'_, AppState>,
    path: String,
    duration: f64,
    count: u32,
) -> Vec<String> {
    let id = state.seq.fetch_add(1, Ordering::Relaxed);
    let tag = format!("t{id}");
    transcode::extract_frames(
        &PathBuf::from(&path),
        duration,
        count.clamp(1, 60),
        &state.cache_dir,
        &tag,
    )
}

#[tauri::command]
fn set_output_dir(state: State<'_, AppState>, dir: Option<String>) {
    *state.out_dir.lock().unwrap() = dir.map(PathBuf::from);
}

#[tauri::command]
fn get_output_dir(state: State<'_, AppState>) -> Option<String> {
    state
        .out_dir
        .lock()
        .unwrap()
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
}

/// 计算输出路径：用户指定了目录就放那儿，否则跟源文件同目录，
/// 文件名加 `_converted` 后缀避免覆盖原片。
fn derive_output(state: &AppState, input: &PathBuf, container: &model::Container) -> PathBuf {
    let stem = input
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "output".into());
    let filename = format!("{stem}_converted.{}", container.ext());

    let dir = state
        .out_dir
        .lock()
        .unwrap()
        .clone()
        .or_else(|| input.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));

    dir.join(filename)
}

#[tauri::command]
fn enqueue_task(
    state: State<'_, AppState>,
    input: String,
    duration: f64,
    trim: Option<Trim>,
    params: EncodeParams,
) -> Task {
    let input_path = PathBuf::from(&input);
    let params = params.normalize();
    let output = derive_output(&state, &input_path, &params.container);

    let n = state.seq.fetch_add(1, Ordering::Relaxed);
    let task = Task {
        id: format!("task-{n}"),
        input: input_path,
        output,
        duration,
        status: Status::Queued,
        progress: 0.0,
        speed: None,
        trim,
        params,
        error: None,
        created_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    };
    state.queue.add(task.clone());
    task
}

#[tauri::command]
fn list_tasks(state: State<'_, AppState>) -> Vec<Task> {
    state.queue.snapshot()
}

#[tauri::command]
fn cancel_task(state: State<'_, AppState>, id: String) {
    state.queue.cancel(&id);
}

#[tauri::command]
fn retry_task(state: State<'_, AppState>, id: String) {
    state.queue.retry(&id);
}

#[tauri::command]
fn remove_task(state: State<'_, AppState>, id: String) {
    state.queue.remove(&id);
}

#[tauri::command]
fn reveal_file(app: AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| e.to_string())
}

/// 支持「把文件拖到 exe 图标上打开」以及命令行传参。
/// 返回启动时附带、且确实存在的文件路径。
#[tauri::command]
fn startup_files() -> Vec<String> {
    std::env::args()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .filter(|a| std::path::Path::new(a).is_file())
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let hw = hw::detect();
    let queue = Arc::new(transcode::Queue::new());

    let cache_dir = std::env::temp_dir().join("format-studio-thumbs");
    let _ = std::fs::create_dir_all(&cache_dir);

    let state = AppState {
        queue,
        hw,
        cache_dir,
        out_dir: Mutex::new(None),
        seq: AtomicU64::new(1),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .setup(|app| {
            let handle = app.handle().clone();
            let q = app.state::<AppState>().queue.clone();
            transcode::spawn_worker(q, move |task| {
                let _ = handle.emit("task-update", task);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            detect_hw,
            probe_file,
            make_thumbnails,
            set_output_dir,
            get_output_dir,
            enqueue_task,
            list_tasks,
            cancel_task,
            retry_task,
            remove_task,
            reveal_file,
            startup_files,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
