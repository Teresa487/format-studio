import type {
  AudioCodec,
  Channels,
  Container,
  EncodeParams,
  HwAccel,
  MediaInfo,
  VideoCodec,
} from "./types";

function extOf(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

/** 容器默认跟源文件走；MOV/M4V 等统一落到 MP4。 */
export function sourceContainer(info: MediaInfo): Container {
  const ext = extOf(info.path);
  if (ext === "mkv") return "mkv";
  if (ext === "webm") return "webm";
  if (ext === "mp3") return "mp3";
  return "mp4";
}

/** 视频编码默认跟源文件走；不认识的编码退回 H.264。 */
export function sourceVideoCodec(info: MediaInfo): VideoCodec | null {
  if (!info.has_video) return null;
  switch (info.video_codec?.toLowerCase()) {
    case "h264":
    case "avc1":
      return "h264";
    case "h265":
    case "hevc":
      return "h265";
    case "av1":
      return "av1";
    case "vp9":
      return "vp9";
    default:
      return "h264";
  }
}

/** 音频默认保持原样；只有目标容器不兼容时才选一个合法编码。 */
export function sourceAudioCodec(info: MediaInfo, container: Container): AudioCodec {
  if (container === "mp3") return "mp3";

  const codec = info.audio_codec?.toLowerCase();
  if (!codec) return "aac";

  if (container === "webm") {
    // WebM 只收 Opus/Vorbis；源文件不是这两种才需要转码
    return codec === "opus" || codec === "vorbis" ? "copy" : "opus";
  }

  if (container === "mkv") return "copy"; // MKV 基本什么音频都能装

  // MP4：常见音频直接流复制，冷门编码退回 AAC
  return ["aac", "mp3", "ac3", "eac3", "opus"].includes(codec) ? "copy" : "aac";
}

export function sourceChannels(info: MediaInfo): Channels {
  if (info.audio_channels === 1) return "mono";
  if (info.audio_channels === 2) return "stereo";
  return "keep";
}

/** 1234567 bit/s -> "1.23M"；用于固定码率模式的默认值。 */
export function formatSourceBitrate(bps: number | null | undefined): string | null {
  if (!bps || bps <= 0) return null;
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)}M`;
  return `${Math.round(bps / 1000)}k`;
}

/**
 * 根据源文件生成一套“只改需要改的项”的默认参数。
 * 例：1080p H.264/AAC 文件，默认就是 MP4 + H.264 + 原始分辨率 + 原始帧率 + AAC。
 * 用户要转 720p，只需要把分辨率改成 720，其他参数不用动。
 */
export function paramsFromSource(info: MediaInfo, hw: HwAccel): EncodeParams {
  const container = sourceContainer(info);
  const videoCodec = sourceVideoCodec(info);

  // WebM 不支持 H.264/H.265，源文件不是 WebM 但用户选 WebM 时在界面层处理；
  // 这里只保证源文件本身就是 WebM 时编码合法。
  const safeVideoCodec: VideoCodec | null =
    container === "webm" && videoCodec && videoCodec !== "av1" && videoCodec !== "vp9"
      ? "av1"
      : videoCodec;

  const sourceBitrate = formatSourceBitrate(info.video_bitrate);

  return {
    container,
    video_codec: safeVideoCodec,
    hw,
    quality_mode: sourceBitrate ? "bitrate" : "rf",
    rf: 22,
    bitrate: sourceBitrate,
    preset: "medium",
    height: null, // 默认保持原始分辨率
    fps: null, // 默认保持原始帧率
    audio_codec: sourceAudioCodec(info, container),
    audio_bitrate: info.audio_bitrate ? Math.max(32, Math.round(info.audio_bitrate / 1000)) : 160,
    channels: sourceChannels(info),
    faststart: container === "mp4",
    deinterlace: false,
  };
}
