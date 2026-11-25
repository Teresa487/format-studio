import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";

import { FileList } from "./components/FileList";
import { ParamPanel } from "./components/ParamPanel";
import { Preview, TransportBar, type PreviewHandle } from "./components/Preview";
import { TaskQueue } from "./components/TaskQueue";
import { TrimBar, type TrimValue } from "./components/TrimBar";
import {
  DEFAULT_PARAMS,
  type EncodeParams,
  type HwInfo,
  type MediaInfo,
  type Preset,
  type Task,
} from "./types";
import "./styles.css";

const VIDEO_EXTS = [
  "mp4", "mkv", "mov", "avi", "webm", "flv", "wmv", "m4v", "ts", "m2ts",
  "mpg", "mpeg", "3gp", "ogv", "mts", "rmvb", "rm",
];

export default function App() {
  const [files, setFiles] = useState<MediaInfo[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [params, setParams] = useState<EncodeParams>(DEFAULT_PARAMS);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [hw, setHw] = useState<HwInfo>({ accel: "none", label: "CPU" });
  const [useGpu, setUseGpu] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [trim, setTrim] = useState<TrimValue>({ start: 0, end: 0 });
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [frames, setFrames] = useState<string[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const previewRef = useRef<PreviewHandle>(null);

  const active = useMemo(
    () => files.find((f) => f.path === activePath) ?? null,
    [files, activePath],
  );

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  // ---------------------------------------------------------------- 初始化
  useEffect(() => {
    invoke<HwInfo>("detect_hw")
      .then((info) => {
        setHw(info);
        // 有显卡就默认开启加速，日常用户不用自己翻开关
        const on = info.accel !== "none";
        setUseGpu(on);
        setParams((p) => ({ ...p, hw: on ? info.accel : "none" }));
      })
      .catch(() => {});
    invoke<Preset[]>("load_presets").then(setPresets).catch(console.error);
    invoke<Task[]>("list_tasks").then(setTasks).catch(console.error);
  }, []);

  // 后端每推进一次进度就推一个完整 Task 过来
  useEffect(() => {
    let un: (() => void) | undefined;
    listen<Task>("task-update", (e) => {
      setTasks((prev) => {
        const i = prev.findIndex((t) => t.id === e.payload.id);
        if (i === -1) return [...prev, e.payload];
        const next = prev.slice();
        next[i] = e.payload;
        return next;
      });
    }).then((fn) => {
      un = fn;
    });
    return () => un?.();
  }, []);

  // ---------------------------------------------------------------- 导入
  const addPaths = useCallback(
    async (paths: string[]) => {
      const vids = paths.filter((p) => {
        const ext = p.split(".").pop()?.toLowerCase() ?? "";
        return VIDEO_EXTS.includes(ext);
      });
      if (vids.length === 0) {
        flash("没有可识别的视频文件");
        return;
      }

      const infos = await Promise.all(
        vids.map((p) => invoke<MediaInfo>("probe_file", { path: p }).catch(() => null)),
      );
      const valid = infos.filter((x): x is MediaInfo => x !== null);

      setFiles((prev) => {
        const seen = new Set(prev.map((f) => f.path));
        const fresh = valid.filter((v) => !seen.has(v.path));
        return [...prev, ...fresh];
      });

      setActivePath((cur) => cur ?? valid[0]?.path ?? null);
      flash(`已导入 ${valid.length} 个文件`);
    },
    [flash],
  );

  const importFiles = async () => {
    const picked = await open({
      multiple: true,
      filters: [{ name: "视频文件", extensions: VIDEO_EXTS }],
    });
    if (!picked) return;
    await addPaths(Array.isArray(picked) ? picked : [picked]);
  };

  // 把文件拖到 exe 图标上、或在命令行带文件启动时，自动载入
  useEffect(() => {
    invoke<string[]>("startup_files")
      .then((paths) => {
        if (paths.length > 0) void addPaths(paths);
      })
      .catch(() => {});
  }, [addPaths]);

  // 系统级拖放（Tauri 拦截系统事件，比 HTML5 drop 更可靠）
  useEffect(() => {
    let un: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "over") {
          setDragOver(true);
        } else if (event.payload.type === "drop") {
          setDragOver(false);
          void addPaths(event.payload.paths);
        } else {
          setDragOver(false);
        }
      })
      .then((fn) => {
        un = fn;
      });
    return () => un?.();
  }, [addPaths]);

  // 空格播放 / 暂停
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.code === "Space") {
        e.preventDefault();
        document.querySelector<HTMLVideoElement>("video")?.click();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 切换素材：重置区间 + 抽帧做胶片条
  useEffect(() => {
    if (!active) {
      setFrames([]);
      setTrim({ start: 0, end: 0 });
      return;
    }
    const dur = active.duration || 0;
    setTrim({ start: 0, end: dur });
    setCurrentTime(0);

    // 换到更小的素材时，把超出源分辨率的选择降回「保持原始」，
    // 否则会保留一个界面上已经禁用的非法值
    const h = active.height || 0;
    if (h > 0) {
      setParams((p) => (p.height !== null && p.height > h ? { ...p, height: null } : p));
    }

    if (!active.has_video || dur <= 0) {
      setFrames([]);
      return;
    }

    let cancelled = false;
    invoke<string[]>("make_thumbnails", { path: active.path, duration: dur, count: 12 })
      .then((list) => {
        if (cancelled || list.length === 0) return;
        setFrames(list.map((f) => convertFileSrc(f)));
        setThumbs((prev) => ({ ...prev, [active.path]: convertFileSrc(list[0]) }));
      })
      .catch(() => setFrames([]));

    return () => {
      cancelled = true;
    };
  }, [active]);

  // ---------------------------------------------------------------- 交互
  const removeFile = (path: string) => {
    const rest = files.filter((f) => f.path !== path);
    setFiles(rest);
    if (activePath === path) setActivePath(rest[0]?.path ?? null);
  };

  const applyPreset = (id: string) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    setActivePresetId(id);
    const { id: _id, name: _n, desc: _d, ...rest } = p;
    // 预设里 hw 是 none，用不用显卡由顶部那个开关说了算
    setParams({ ...rest, hw: useGpu ? hw.accel : "none" });
  };

  const changeParams = (p: EncodeParams) => {
    setParams(p);
    setActivePresetId(null); // 手改过就不再算哪个预设了
  };

  const toggleGpu = (v: boolean) => {
    setUseGpu(v);
    setParams((p) => ({ ...p, hw: v ? hw.accel : "none" }));
  };

  const startConvert = async () => {
    const targets = files.filter((f) => !f.error && (f.has_video || f.audio_codec));
    if (targets.length === 0) {
      flash("没有可转换的文件");
      return;
    }

    for (const f of targets) {
      // 裁剪区间只作用于正在预览的那个文件，其余按整段转
      const isActive = f.path === activePath;
      const trimmed =
        isActive && trim.end > trim.start + 0.05 && trim.end - trim.start < f.duration - 0.05;

      await invoke("enqueue_task", {
        input: f.path,
        duration: f.duration,
        trim: trimmed ? { start: trim.start, end: trim.end } : null,
        params,
      });
    }

    setTasks(await invoke<Task[]>("list_tasks"));
    flash(`已加入 ${targets.length} 个任务`);
  };

  const seek = useCallback((t: number) => {
    previewRef.current?.seek(t);
    setCurrentTime(t);
  }, []);

  const onTrimChange = useCallback((v: TrimValue) => {
    setTrim(v);
    // 拖手柄时播放头跟到入点，用户能直接看到那一帧
    previewRef.current?.seek(v.start);
    setCurrentTime(v.start);
  }, []);

  return (
    <div className="app">
      {/* ---------------------------------------------------------- 顶栏 */}
      <div className="topbar">
        <div className="brand">
          <span className="brand-dot" />
          格式工作台
        </div>

        <button className="btn primary" onClick={importFiles}>
          ＋ 导入
        </button>

        <button
          className="btn"
          onClick={startConvert}
          disabled={files.length === 0}
          title="把列表里的文件按当前参数加入队列"
        >
          ▶ 开始转换
        </button>

        <div className="spacer" />

        <div className={`hw-badge ${hw.accel !== "none" && useGpu ? "on" : ""}`}>
          <span className="dot" />
          {hw.accel !== "none"
            ? useGpu
              ? `GPU · ${hw.label}`
              : "GPU 可用（已关闭）"
            : "CPU 编码"}
        </div>
      </div>

      {/* -------------------------------------------------------- 中部三栏 */}
      <div className="workspace">
        <div className="panel panel-left">
          <div className="panel-head">
            <span>素材</span>
            <span style={{ letterSpacing: 0, textTransform: "none" }}>
              {files.length > 0 ? `${files.length} 个` : ""}
            </span>
          </div>
          <div className="panel-body">
            <FileList
              files={files}
              activePath={activePath}
              thumbnails={thumbs}
              onSelect={setActivePath}
              onRemove={removeFile}
            />
          </div>
        </div>

        <div className="panel panel-center">
          <div className="preview-wrap">
            <Preview
              ref={previewRef}
              src={active ? convertFileSrc(active.path) : null}
              duration={active?.duration ?? 0}
              trimStart={trim.start}
              trimEnd={trim.end}
              onTime={setCurrentTime}
              onPlayingChange={setIsPlaying}
            />

            <TransportBar
              currentTime={currentTime}
              duration={active?.duration ?? 0}
              isPlaying={isPlaying}
              onToggle={() => previewRef.current?.toggle()}
              onSeek={seek}
            />

            {active ? (
              <TrimBar
                duration={active.duration}
                value={trim}
                onChange={onTrimChange}
                currentTime={currentTime}
                onSeek={seek}
                frames={frames}
              />
            ) : (
              <div className="trim-hint" style={{ justifyContent: "center", opacity: 0.5 }}>
                选中素材后可在此设定截取区间
              </div>
            )}
          </div>
        </div>

        <div className="panel panel-right">
          <div className="panel-head">
            <span>输出参数</span>
          </div>
          <div className="panel-body">
            <ParamPanel
              params={params}
              onChange={changeParams}
              presets={presets}
              activePresetId={activePresetId}
              onPreset={applyPreset}
              hwAccel={hw.accel}
              useGpu={useGpu}
              onUseGpu={toggleGpu}
              sourceHeight={active?.height ?? 0}
            />
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------- 队列 */}
      <TaskQueue
        tasks={tasks}
        onCancel={(id) => invoke("cancel_task", { id })}
        onRetry={(id) => invoke("retry_task", { id })}
        onRemove={async (id) => {
          await invoke("remove_task", { id });
          setTasks((prev) => prev.filter((t) => t.id !== id));
        }}
        onReveal={(path) => invoke("reveal_file", { path }).catch(console.error)}
      />

      {dragOver && <div className="drop-overlay">松手即可导入</div>}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
