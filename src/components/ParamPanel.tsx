import {
  AUDIO_BITRATES,
  AUDIO_CODECS,
  CHANNELS,
  CONTAINERS,
  FPS_OPTIONS,
  HEIGHTS,
  HW_LABELS,
  PRESETS_SPEED,
  VIDEO_CODECS,
  type AudioCodec,
  type EncodeParams,
  type HwAccel,
  type MediaInfo,
  type VideoCodec,
} from "../types";

interface Props {
  params: EncodeParams;
  onChange: (p: EncodeParams) => void;
  hwAccel: HwAccel;
  useGpu: boolean;
  onUseGpu: (v: boolean) => void;
  /** 当前源文件；用来显示源信息、禁用放大档位、补上源音频码率选项 */
  source: MediaInfo | null;
}

const AUDIO_ONLY = "mp3";

function sourceSummary(s: MediaInfo | null): string {
  if (!s) return "请先导入文件";
  const parts: string[] = [];
  if (s.has_video) {
    parts.push(`${s.width}×${s.height}`);
    if (s.video_codec) parts.push(s.video_codec.toUpperCase());
    if (s.fps > 0) parts.push(`${s.fps.toFixed(2)} fps`);
  }
  if (s.audio_codec) {
    parts.push(s.audio_codec.toUpperCase());
    if (s.audio_bitrate) parts.push(`${Math.round(s.audio_bitrate / 1000)} kbps`);
    if (s.audio_channels === 1) parts.push("单声道");
    if (s.audio_channels === 2) parts.push("立体声");
  }
  return parts.join(" · ");
}

export function ParamPanel({ params, onChange, hwAccel, useGpu, onUseGpu, source }: Props) {
  const set = <K extends keyof EncodeParams>(key: K, value: EncodeParams[K]) =>
    onChange({ ...params, [key]: value });

  const audioOnly = params.container === AUDIO_ONLY;
  const audioCopy = params.audio_codec === "copy";
  const isWebm = params.container === "webm";
  const gpuAvailable = hwAccel !== "none";
  const sourceHeight = source?.height ?? 0;

  const codecOptions = isWebm
    ? VIDEO_CODECS.filter((c) => c.value === "av1" || c.value === "vp9")
    : VIDEO_CODECS;

  // 源音频码率通常不是 128/160 这种整数值，额外塞进下拉框，保证默认值有对应项
  const sourceAudioKbps = source?.audio_bitrate
    ? Math.max(32, Math.round(source.audio_bitrate / 1000))
    : null;
  const audioBitrates = Array.from(
    new Set([...AUDIO_BITRATES, ...(sourceAudioKbps ? [sourceAudioKbps] : [])]),
  ).sort((a, b) => a - b);

  const changeContainer = (c: EncodeParams["container"]) => {
    let videoCodec = params.video_codec;
    let audioCodec = params.audio_codec;

    if (c === "mp3") {
      videoCodec = null;
      audioCodec = "mp3";
    } else {
      videoCodec ??= "h264";
      if (c === "webm") {
        if (videoCodec !== "av1" && videoCodec !== "vp9") videoCodec = "av1";
        audioCodec = "opus";
      } else if (audioCodec === "mp3") {
        audioCodec = "aac";
      }

      // MP4 不能随便装所有音频；源音频太冷门时退回 AAC，避免交给 ffmpeg 才报错
      if (
        c === "mp4" &&
        audioCodec === "copy" &&
        source?.audio_codec &&
        !["aac", "mp3", "ac3", "eac3", "opus"].includes(source.audio_codec.toLowerCase())
      ) {
        audioCodec = "aac";
      }
    }

    onChange({
      ...params,
      container: c,
      video_codec: videoCodec,
      audio_codec: audioCodec,
      faststart: c === "mp4" ? params.faststart : false,
    });
  };

  const changeVideoCodec = (vc: VideoCodec) => {
    // VP9 只能进 WebM；选它时自动把容器和音频一起切到合法组合
    if (vc === "vp9" && params.container !== "webm") {
      onChange({
        ...params,
        container: "webm",
        video_codec: "vp9",
        audio_codec: "opus",
        faststart: false,
      });
      return;
    }
    set("video_codec", vc);
  };

  return (
    <div className="form">
      <div className="source-info">
        <div className="field-label">
          <span>源文件</span>
          <span className="hint">参数已按源文件填好</span>
        </div>
        <div className="source-info-value">{sourceSummary(source)}</div>
      </div>

      <div className="divider" />
      <div className="section-title">视频</div>

      <div className="field">
        <div className="field-label">容器格式</div>
        <select
          value={params.container}
          onChange={(e) => changeContainer(e.target.value as EncodeParams["container"])}
        >
          {CONTAINERS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {!audioOnly && (
        <>
          <div className="field">
            <div className="field-label">
              视频编码
              <span className="hint">
                {VIDEO_CODECS.find((v) => v.value === params.video_codec)?.hint ?? ""}
              </span>
            </div>
            <select
              value={params.video_codec ?? "h264"}
              onChange={(e) => changeVideoCodec(e.target.value as VideoCodec)}
            >
              {codecOptions.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <div className="field-label">质量</div>
            <div className="seg">
              <button
                className={params.quality_mode === "rf" ? "active" : ""}
                onClick={() => set("quality_mode", "rf")}
              >
                恒定质量
              </button>
              <button
                className={params.quality_mode === "bitrate" ? "active" : ""}
                onClick={() => set("quality_mode", "bitrate")}
              >
                固定码率
              </button>
            </div>
          </div>

          {params.quality_mode === "rf" ? (
            <div className="field">
              <div className="field-label">
                <span>质量值 RF</span>
                <span className="val">{params.rf ?? 22}</span>
              </div>
              <input
                type="range"
                min={16}
                max={32}
                step={1}
                value={params.rf ?? 22}
                onChange={(e) => set("rf", parseInt(e.target.value, 10))}
              />
              <div className="preset-desc">18 高画质 · 22 通用 · 28 省空间</div>
            </div>
          ) : (
            <div className="field">
              <div className="field-label">
                视频码率
                {source?.video_bitrate ? (
                  <span className="hint">
                    源 {formatKbps(source.video_bitrate)}
                  </span>
                ) : null}
              </div>
              <input
                type="text"
                value={params.bitrate ?? ""}
                placeholder="如 4M / 2500k"
                onChange={(e) => set("bitrate", e.target.value)}
              />
            </div>
          )}

          <div className="field">
            <div className="field-label">编码速度</div>
            <select
              value={params.preset ?? "medium"}
              onChange={(e) => set("preset", e.target.value)}
            >
              {PRESETS_SPEED.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <div className="preset-desc">不影响画质，只影响压缩率和耗时</div>
          </div>

          <div className="field">
            <div className="field-label">
              分辨率
              {sourceHeight > 0 && <span className="hint">源 {sourceHeight}p</span>}
            </div>
            <select
              value={params.height ?? ""}
              onChange={(e) =>
                set("height", e.target.value === "" ? null : parseInt(e.target.value, 10))
              }
            >
              {HEIGHTS.map((h) => {
                const upscale = h.value !== null && sourceHeight > 0 && h.value > sourceHeight;
                return (
                  <option key={String(h.value)} value={h.value ?? ""} disabled={upscale}>
                    {h.label}
                    {upscale ? "（超过源分辨率）" : ""}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="field">
            <div className="field-label">
              帧率
              {source?.fps ? <span className="hint">源 {source.fps.toFixed(2)}</span> : null}
            </div>
            <select
              value={params.fps ?? ""}
              onChange={(e) =>
                set("fps", e.target.value === "" ? null : parseFloat(e.target.value))
              }
            >
              {FPS_OPTIONS.map((f) => (
                <option key={String(f.value)} value={f.value ?? ""}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      <div className="divider" />
      <div className="section-title">音频</div>

      <div className="field">
        <div className="field-label">音频编码</div>
        <select
          value={params.audio_codec}
          onChange={(e) => set("audio_codec", e.target.value as AudioCodec)}
          disabled={isWebm || audioOnly}
        >
          {AUDIO_CODECS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field" style={{ opacity: audioCopy ? 0.45 : 1 }}>
        <div className="field-label">
          音频码率
          {audioCopy && <span className="hint">流复制时不适用</span>}
        </div>
        <select
          value={params.audio_bitrate}
          disabled={audioCopy}
          onChange={(e) => set("audio_bitrate", parseInt(e.target.value, 10))}
        >
          {audioBitrates.map((b) => (
            <option key={b} value={b}>
              {b} kbps{b === sourceAudioKbps ? "（源）" : ""}
            </option>
          ))}
        </select>
      </div>

      <div className="field" style={{ opacity: audioCopy ? 0.45 : 1 }}>
        <div className="field-label">声道</div>
        <select
          value={params.channels}
          disabled={audioCopy}
          onChange={(e) => set("channels", e.target.value as EncodeParams["channels"])}
        >
          {CHANNELS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="divider" />
      <div className="section-title">其他</div>

      <label className="check" style={{ opacity: gpuAvailable ? 1 : 0.45 }}>
        <input
          type="checkbox"
          checked={useGpu && gpuAvailable}
          disabled={!gpuAvailable}
          onChange={(e) => onUseGpu(e.target.checked)}
        />
        硬件加速编码
        <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--text-2)" }}>
          {gpuAvailable ? HW_LABELS[hwAccel] : "未检测到可用显卡"}
        </span>
      </label>

      <label className="check" style={{ opacity: params.container === "mp4" ? 1 : 0.45 }}>
        <input
          type="checkbox"
          checked={params.faststart}
          disabled={params.container !== "mp4"}
          onChange={(e) => set("faststart", e.target.checked)}
        />
        快速启动（网页边下边播）
      </label>

      {!audioOnly && (
        <label className="check">
          <input
            type="checkbox"
            checked={params.deinterlace}
            onChange={(e) => set("deinterlace", e.target.checked)}
          />
          去隔行（老 DV / 电视录制）
        </label>
      )}
    </div>
  );
}

function formatKbps(bps: number): string {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
  return `${Math.round(bps / 1000)} kbps`;
}
