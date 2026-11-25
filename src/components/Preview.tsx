import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { fmtDuration } from "../types";

export interface PreviewHandle {
  seek: (t: number) => void;
  toggle: () => void;
  getElement: () => HTMLVideoElement | null;
}

/**
 * 往后探最多 `maxProbe` 秒，找第一帧不是全黑的画面。
 * 用离屏 canvas 采样亮度，判断很便宜（160x90 缩略后取平均）。
 * 找不到就返回 null，调用方保持原位。
 */
async function findVisibleFrame(
  v: HTMLVideoElement,
  from: number,
  duration: number,
  maxProbe = 3.0,
): Promise<number | null> {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 36;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  const seekTo = (t: number) =>
    new Promise<void>((resolve) => {
      const done = () => {
        v.removeEventListener("seeked", done);
        resolve();
      };
      v.addEventListener("seeked", done);
      v.currentTime = t;
      // 极端情况下 seeked 不触发，兜个底
      window.setTimeout(done, 400);
    });

  const step = 0.5;
  const limit = Math.min(from + maxProbe, Math.max(duration - 0.1, from));

  for (let t = from; t <= limit; t += step) {
    await seekTo(t);
    try {
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      }
      const avg = sum / (data.length / 4);
      if (avg > 8) return t; // 8/255 以上就当作有画面
    } catch {
      // 跨域污染等情况下读不到像素，直接放弃探测
      return null;
    }
  }
  return null;
}

interface Props {
  src: string | null;
  duration: number;
  trimStart: number;
  trimEnd: number;
  onTime: (t: number) => void;
  onPlayingChange: (playing: boolean) => void;
}

/**
 * 预览播放器。用原生 <video>：Chromium 自带硬解，
 * 不用我们手写解码，也能直接播绝大多数常见格式。
 */
export const Preview = forwardRef<PreviewHandle, Props>(function Preview(
  { src, duration, trimStart, trimEnd, onTime, onPlayingChange },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  const play = () => {
    const v = videoRef.current;
    if (!v) return;
    // 播放头已经越过出点（或停在出点上）时，先回到入点再播
    if (trimEnd > trimStart && v.currentTime >= trimEnd - 0.05) {
      v.currentTime = trimStart;
    }
    void v.play().catch(() => setFailed(true));
  };

  useImperativeHandle(ref, () => ({
    seek: (t: number) => {
      const v = videoRef.current;
      if (!v) return;
      const max = duration || v.duration || 0;
      const target = Math.max(0, Math.min(t, max));
      if (isFinite(target)) {
        v.currentTime = target;
        onTime(target);
      }
    },
    toggle: () => {
      const v = videoRef.current;
      if (!v) return;
      if (v.paused) play();
      else v.pause();
    },
    getElement: () => videoRef.current,
  }));

  // 换素材时把状态清干净
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = 0;
    setFailed(false);
    onPlayingChange(false);
  }, [src, onPlayingChange]);

  // 加载完元数据后主动 seek 一点点，逼浏览器把首帧画出来。
  // 否则 preload 下画面会一直是黑的。
  // 另外很多片源开头有几帧纯黑，停在 0 秒看起来就像「预览坏了」，
  // 所以这里往后探一点找第一帧不是全黑的画面。
  const onLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    const start = trimStart > 0 ? trimStart : 0;
    void findVisibleFrame(v, start, duration).then((t) => {
      // 探测失败时退到一个保守位置：多数片源开头黑帧不超过 1 秒
      const target = t ?? Math.min(start + 1.0, Math.max(duration - 0.1, start));
      if (Math.abs(v.currentTime - target) > 0.01) {
        v.currentTime = target;
      }
      onTime(v.currentTime);
    });
  };

  // 播放到出点自动停 —— 让「预览只覆盖选中片段」这件事肉眼可见
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const onTimeUpdate = () => {
      onTime(v.currentTime);
      if (!v.paused && trimEnd > trimStart && v.currentTime >= trimEnd - 0.02) {
        v.pause();
      }
    };
    const onPlay = () => onPlayingChange(true);
    const onPause = () => onPlayingChange(false);
    const onErr = () => setFailed(true);

    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("error", onErr);
    return () => {
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("error", onErr);
    };
  }, [onTime, onPlayingChange, trimStart, trimEnd]);

  if (!src) {
    return (
      <div className="stage">
        <div className="stage-empty">
          <div style={{ fontSize: 30, opacity: 0.4, marginBottom: 10 }}>▤</div>
          从左侧拖入视频文件
          <br />
          <span style={{ fontSize: 11.5, opacity: 0.7 }}>
            支持 mp4 / mkv / mov / avi / webm 等常见格式
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="stage" onClick={() => videoRef.current?.click()}>
      <video
        ref={videoRef}
        src={src}
        controls={false}
        preload="auto"
        onClick={play}
        onLoadedMetadata={onLoadedMetadata}
      />
      {failed && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.8)",
            color: "var(--text-1)",
            fontSize: 12.5,
            textAlign: "center",
            lineHeight: 1.9,
            padding: 24,
          }}
        >
          这个格式浏览器内核无法直接预览
          <br />
          <span style={{ fontSize: 11.5, color: "var(--text-2)" }}>
            仍可正常加入队列转换
          </span>
        </div>
      )}
    </div>
  );
});

export function TransportBar({
  currentTime,
  duration,
  onToggle,
  onSeek,
  isPlaying,
}: {
  currentTime: number;
  duration: number;
  onToggle: () => void;
  onSeek: (t: number) => void;
  isPlaying: boolean;
}) {
  return (
    <div className="transport">
      <button className="play-btn" onClick={onToggle} title="播放 / 暂停（空格）">
        {isPlaying ? "❚❚" : "▶"}
      </button>
      <div className="time">
        <span className="cur">{fmtDuration(currentTime)}</span>
        <span style={{ opacity: 0.4 }}> / </span>
        {fmtDuration(duration)}
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(duration, 0.1)}
        step={0.05}
        value={Math.min(currentTime, duration)}
        onChange={(e) => onSeek(parseFloat(e.target.value))}
        style={{ flex: 1 }}
        disabled={duration <= 0}
      />
    </div>
  );
}
