// 与 src-tauri/src/model.rs 一一对应的类型定义

export type Container = "mp4" | "mkv" | "webm" | "mp3";
export type VideoCodec = "h264" | "h265" | "av1" | "vp9";
export type AudioCodec = "copy" | "aac" | "mp3" | "opus" | "ac3";
export type HwAccel = "none" | "nvenc" | "qsv" | "amf";
export type QualityMode = "rf" | "bitrate";
export type Channels = "keep" | "stereo" | "mono";
export type Status = "queued" | "running" | "done" | "failed" | "cancelled";

export interface Trim {
  start: number;
  end: number;
}

export interface EncodeParams {
  container: Container;
  video_codec: VideoCodec | null;
  hw: HwAccel;
  quality_mode: QualityMode;
  rf: number | null;
  bitrate: string | null;
  preset: string | null;
  height: number | null;
  fps: number | null;
  audio_codec: AudioCodec;
  audio_bitrate: number;
  channels: Channels;
  faststart: boolean;
  deinterlace: boolean;
}

export interface MediaInfo {
  path: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  video_codec: string | null;
  audio_codec: string | null;
  fps: number;
  size_bytes: number;
  has_video: boolean;
  error: string | null;
}

export interface Task {
  id: string;
  input: string;
  output: string;
  duration: number;
  status: Status;
  progress: number;
  speed: number | null;
  trim: Trim | null;
  params: EncodeParams;
  error: string | null;
  created_at: number;
}

export interface Preset extends EncodeParams {
  id: string;
  name: string;
  desc: string;
}

export interface HwInfo {
  accel: HwAccel;
  label: string;
}

// ---------------------------------------------------------------------------
// 默认参数：与 Rust 端 EncodeParams::default() 保持一致
// ---------------------------------------------------------------------------

export const DEFAULT_PARAMS: EncodeParams = {
  container: "mp4",
  video_codec: "h264",
  hw: "none",
  quality_mode: "rf",
  rf: 22,
  bitrate: null,
  preset: "medium",
  height: 1080,
  fps: null,
  audio_codec: "aac",
  audio_bitrate: 160,
  channels: "stereo",
  faststart: true,
  deinterlace: false,
};

// ---------------------------------------------------------------------------
// 界面上的可选项
// ---------------------------------------------------------------------------

export const CONTAINERS: { value: Container; label: string }[] = [
  { value: "mp4", label: "MP4" },
  { value: "mkv", label: "MKV" },
  { value: "webm", label: "WebM" },
  { value: "mp3", label: "MP3（仅音频）" },
];

export const VIDEO_CODECS: { value: VideoCodec; label: string; hint: string }[] = [
  { value: "h264", label: "H.264", hint: "兼容性最好" },
  { value: "h265", label: "H.265", hint: "体积更小" },
  { value: "av1", label: "AV1", hint: "压缩最强，较慢" },
  { value: "vp9", label: "VP9", hint: "WebM 专用" },
];

export const PRESETS_SPEED: { value: string; label: string }[] = [
  { value: "veryfast", label: "很快" },
  { value: "fast", label: "快" },
  { value: "medium", label: "均衡" },
  { value: "slow", label: "慢（质量好）" },
  { value: "slower", label: "更慢" },
];

export const HEIGHTS: { value: number | null; label: string }[] = [
  { value: null, label: "保持原始" },
  { value: 2160, label: "4K (2160p)" },
  { value: 1440, label: "2K (1440p)" },
  { value: 1080, label: "1080p" },
  { value: 720, label: "720p" },
  { value: 480, label: "480p" },
];

export const FPS_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "保持原始" },
  { value: 60, label: "60 fps" },
  { value: 30, label: "30 fps" },
  { value: 25, label: "25 fps" },
  { value: 24, label: "24 fps" },
];

export const AUDIO_CODECS: { value: AudioCodec; label: string }[] = [
  { value: "copy", label: "保持原样（不重编码）" },
  { value: "aac", label: "AAC" },
  { value: "mp3", label: "MP3" },
  { value: "opus", label: "Opus" },
  { value: "ac3", label: "AC3" },
];

export const AUDIO_BITRATES = [96, 128, 160, 192, 256, 320];

export const CHANNELS: { value: Channels; label: string }[] = [
  { value: "keep", label: "保持原始" },
  { value: "stereo", label: "立体声" },
  { value: "mono", label: "单声道" },
];

export const HW_LABELS: Record<HwAccel, string> = {
  none: "CPU（软件编码）",
  nvenc: "NVIDIA NVENC",
  qsv: "Intel QuickSync",
  amf: "AMD AMF",
};

// ---------------------------------------------------------------------------
// 格式化工具
// ---------------------------------------------------------------------------

export function fmtDuration(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return "00:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function fmtPrecise(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "00:00.0";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${s.toFixed(1).padStart(4, "0")}`;
}

export function fmtBytes(b: number): string {
  if (b <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/// 从路径里取文件名（兼容 Windows 反斜杠）
export function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
}
