import { useCallback, useEffect, useRef, useState } from "react";
import { fmtPrecise } from "../types";

export interface TrimValue {
  start: number;
  end: number;
}

interface Props {
  duration: number;
  value: TrimValue;
  onChange: (v: TrimValue) => void;
  /** 当前播放位置，用于画白色播放头 */
  currentTime: number;
  /** 点击轨道时跳转播放头 */
  onSeek: (t: number) => void;
  frames: string[];
}

type DragTarget = "start" | "end" | null;

/**
 * 剪映式双滑块裁剪条。
 * 交互规则（和剪映一致）：
 *  - 点轨道空白处 → 播放头跳到该处
 *  - 拖左右手柄 → 改入/出点，两个手柄不会互相越过
 *  - 最小保留 0.1 秒
 */
export function TrimBar({ duration, value, onChange, currentTime, onSeek, frames }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragTarget>(null);

  const MIN_SPAN = 0.1;

  // px → 秒
  const toSec = useCallback(
    (clientX: number): number => {
      const el = trackRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const ratio = (clientX - rect.left) / rect.width;
      return Math.min(1, Math.max(0, ratio)) * duration;
    },
    [duration],
  );

  // 全局监听鼠标移动，鼠标移出组件也能继续拖
  useEffect(() => {
    if (!drag) return;

    const onMove = (e: MouseEvent) => {
      const t = toSec(e.clientX);
      if (drag === "start") {
        onChange({ start: Math.min(t, value.end - MIN_SPAN), end: value.end });
      } else {
        onChange({ start: value.start, end: Math.max(t, value.start + MIN_SPAN) });
      }
    };
    const onUp = () => setDrag(null);

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, toSec, onChange, value.start, value.end]);

  const handleTrackClick = (e: React.MouseEvent) => {
    if (drag) return;
    onSeek(toSec(e.clientX));
  };

  const pct = (t: number) => (duration > 0 ? (t / duration) * 100 : 0);
  const leftPct = pct(value.start);
  const rightPct = pct(value.end);
  const playPct = pct(Math.min(currentTime, duration));

  return (
    <>
      <div className="trimbar" ref={trackRef} onMouseDown={handleTrackClick}>
        <div className="trimbar-thumbs">
          {frames.length > 0 ? (
            frames.map((f, i) => <img key={i} src={f} alt="" draggable={false} />)
          ) : (
            <div style={{ flex: 1, background: "var(--bg-3)" }} />
          )}
        </div>

        {/* 选中区间之外的暗色遮罩 */}
        <div className="trimbar-mask" style={{ left: 0, width: `${leftPct}%` }} />
        <div className="trimbar-mask" style={{ left: `${rightPct}%`, right: 0 }} />

        <div
          className="trimbar-selection"
          style={{ left: `${leftPct}%`, width: `${rightPct - leftPct}%` }}
        />

        {duration > 0 && (
          <div className="trimbar-playhead" style={{ left: `${playPct}%` }} />
        )}

        <div
          className="trim-handle left"
          style={{ left: `calc(${leftPct}% - 6px)` }}
          onMouseDown={(e) => {
            e.stopPropagation();
            setDrag("start");
          }}
        >
          <span className="trim-label" style={{ left: 12 }}>
            {fmtPrecise(value.start)}
          </span>
        </div>

        <div
          className="trim-handle right"
          style={{ left: `calc(${rightPct}% - 6px)` }}
          onMouseDown={(e) => {
            e.stopPropagation();
            setDrag("end");
          }}
        >
          <span className="trim-label" style={{ right: 12 }}>
            {fmtPrecise(value.end)}
          </span>
        </div>
      </div>

      <div className="trim-hint">
        <span>入点 {fmtPrecise(value.start)}</span>
        <span>选中 {(value.end - value.start).toFixed(1)} 秒</span>
        <span>出点 {fmtPrecise(value.end)}</span>
      </div>
    </>
  );
}
