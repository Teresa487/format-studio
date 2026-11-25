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
  type EncodeParams,
  type HwAccel,
  type Preset,
  type VideoCodec,
} from "../types";
import { useState } from "react";

interface Props {
  params: EncodeParams;
  onChange: (p: EncodeParams) => void;
  presets: Preset[];
  activePresetId: string | null;
  onPreset: (id: string) => void;
  hwAccel: HwAccel;
  useGpu: boolean;
  onUseGpu: (v: boolean) => void;
  /** 当前素材原始高度，用来禁用「放大」档位；0 表示未知 */
  sourceHeight: number;
}

const AUDIO_ONLY = "mp3";

export function ParamPanel({
  params,
  onChange,
  presets,
  activePresetId,
  onPreset,
  hwAccel,
  useGpu,
  onUseGpu,
  sourceHeight,
}: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const set = <K extends keyof EncodeParams>(key: K, value: EncodeParams[K]) =>
    onChange({ ...params, [key]: value });

  const audioOnly = params.container === AUDIO_ONLY;
  const audioCopy = params.audio_codec === "copy";
  const isWebm = params.container === "webm";
  const gpuAvailable = hwAccel !== "none";

  // WebM 只认 AV1/VP9；容器换了就把编码器纠回来，别让用户选出不可能的组合
  const codecOptions = isWebm
    ? VIDEO_CODECS.filter((c) => c.value === "av1" || c.value === "vp9")
    : VIDEO_CODECS;

  const activePreset = presets.find((p) => p.id === activePresetId);

  return (
    <div className="form">
      <div className="field">
        <div className="field-label">预设</div>
        <div className="preset-row">
          <select
            value={activePresetId ?? ""}
            onChange={(e) => e.target.value && onPreset(e.target.value)}
          >
            <option value="">自定义</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="preset-desc">{activePreset ? activePreset.desc : "手动调整下方参数"}</div>
      </div>

      <div className="divider" />
      <div className="section-title">输出</div>

      <div className="field">
        <div className="field-label">容器格式</div>
        <select
          value={params.container}
          onChange={(e) => {
            const c = e.target.value as EncodeParams["container"];
            // 切到 MP3 时顺手把视频编码清掉，界面要立刻反映
            onChange({
              ...params,
              container: c,
              video_codec: c === "mp3" ? null : params.video_codec ?? "h264",
              audio_codec: c === "mp3" ? "mp3" : c === "webm" ? "opus" : params.audio_codec,
              faststart: c === "mp4" ? params.faststart : false,
            });
          }}
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
              onChange={(e) => set("video_codec", e.target.value as VideoCodec)}
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
              <div className="preset-desc">数值越小画质越好、体积越大（18 高 · 22 通用 · 28 省空间）</div>
            </div>
          ) : (
            <div className="field">
              <div className="field-label">视频码率</div>
              <input
                type="text"
                value={params.bitrate ?? "4M"}
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
          </div>

          <div className="field">
            <div className="field-label">
              分辨率
              {sourceHeight > 0 && (
                <span className="hint">源 {sourceHeight}p</span>
              )}
            </div>
            <select
              value={params.height ?? ""}
              onChange={(e) =>
                set("height", e.target.value === "" ? null : parseInt(e.target.value, 10))
              }
            >
              {HEIGHTS.map((h) => {
                // 比源还大的档位等于放大：不增画质只增体积，直接禁掉
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
        </>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* 高级设置：日常用不到的全折叠在这里，默认收起                       */}
      {/* ---------------------------------------------------------------- */}
      <div className="divider" />
      <button
        className="advanced-toggle"
        onClick={() => setAdvancedOpen(!advancedOpen)}
        type="button"
      >
        <span>{advancedOpen ? "▾" : "▸"} 高级设置</span>
        <span className="hint" style={{ textTransform: "none", letterSpacing: 0 }}>
          {advancedOpen ? "收起" : "编码、音频、其他"}
        </span>
      </button>

      {advancedOpen && (
        <>
          {!audioOnly && (
            <>
              <div className="section-title">视频</div>

              <div className="field">
                <div className="field-label">
                  视频编码
                  <span className="hint">
                    {VIDEO_CODECS.find((v) => v.value === params.video_codec)?.hint ?? ""}
                  </span>
                </div>
                <select
                  value={params.video_codec ?? "h264"}
                  onChange={(e) => set("video_codec", e.target.value as VideoCodec)}
                >
                  {codecOptions.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

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
                <div className="preset-desc">不影响画质，只影响「压缩得多狠」和耗时</div>
              </div>

              <div className="field">
                <div className="field-label">帧率</div>
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

          <div className="section-title">音频</div>

          <div className="field">
            <div className="field-label">音频编码</div>
            <select
              value={params.audio_codec}
              onChange={(e) => set("audio_codec", e.target.value as EncodeParams["audio_codec"])}
              disabled={isWebm && !audioOnly}
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
              {AUDIO_BITRATES.map((b) => (
                <option key={b} value={b}>
                  {b} kbps
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
        </>
      )}
    </div>
  );
}
