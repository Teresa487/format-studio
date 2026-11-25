import { basename, fmtDuration, type Status, type Task } from "../types";

const STATUS_TEXT: Record<Status, string> = {
  queued: "排队中",
  running: "转码中",
  done: "完成",
  failed: "失败",
  cancelled: "已取消",
};

const STATUS_ICON: Record<Status, string> = {
  queued: "○",
  running: "◐",
  done: "✓",
  failed: "✕",
  cancelled: "－",
};

interface Props {
  tasks: Task[];
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onReveal: (path: string) => void;
}

function eta(t: Task): string {
  if (t.status !== "running" || !t.speed || t.speed <= 0) return "";
  const denom = t.trim ? t.trim.end - t.trim.start : t.duration;
  const remain = Math.max(0, denom * (1 - t.progress)) / t.speed;
  return `剩余 ${fmtDuration(remain)}`;
}

export function TaskQueue({ tasks, onCancel, onRetry, onRemove, onReveal }: Props) {
  const running = tasks.filter((t) => t.status === "running" || t.status === "queued").length;

  return (
    <div className="queue">
      <div className="queue-head">
        任务队列
        {tasks.length > 0 && <span className="queue-count">{tasks.length}</span>}
        {running > 0 && (
          <span style={{ color: "var(--accent)", fontSize: 11, letterSpacing: 0 }}>
            {running} 个待处理
          </span>
        )}
      </div>

      <div className="queue-body">
        {tasks.length === 0 ? (
          <div className="queue-empty">选好参数后点「开始转换」，任务会出现在这里</div>
        ) : (
          tasks.map((t) => {
            const pct = Math.round(t.progress * 100);
            const done = t.status === "done";
            return (
              <div key={t.id} className="task-row">
                <div className="task-icon" style={{ color: done ? "var(--accent)" : undefined }}>
                  {STATUS_ICON[t.status]}
                </div>

                <div className="task-name" title={`${t.input} → ${t.output}`}>
                  {basename(t.input)}
                  <span className="sub">
                    → {basename(t.output)} · {t.params.container.toUpperCase()}
                    {t.params.video_codec ? `/${t.params.video_codec.toUpperCase()}` : ""}
                  </span>
                </div>

                <div className="task-bar">
                  <div
                    className={`task-bar-fill ${t.status === "failed" ? "failed" : ""} ${
                      done ? "done" : ""
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <div className="task-pct">
                  <span className={`status-tag ${t.status}`}>{STATUS_TEXT[t.status]}</span>
                  {t.status === "running" && (
                    <span style={{ marginLeft: 6 }}>{pct}%</span>
                  )}
                  {t.status === "running" && t.speed ? (
                    <span style={{ marginLeft: 4, color: "var(--text-2)" }}>
                      {t.speed.toFixed(1)}x
                    </span>
                  ) : null}
                  {eta(t) && (
                    <div style={{ fontSize: 10, color: "var(--text-2)" }}>{eta(t)}</div>
                  )}
                </div>

                <div className="task-actions">
                  {(t.status === "running" || t.status === "queued") && (
                    <button className="btn sm ghost" onClick={() => onCancel(t.id)}>
                      取消
                    </button>
                  )}
                  {(t.status === "failed" || t.status === "cancelled") && (
                    <button className="btn sm ghost" onClick={() => onRetry(t.id)}>
                      重试
                    </button>
                  )}
                  {done && (
                    <button className="btn sm ghost" onClick={() => onReveal(t.output)}>
                      打开
                    </button>
                  )}
                  {t.status !== "running" && (
                    <button
                      className="btn sm danger"
                      onClick={() => onRemove(t.id)}
                      title="从列表移除"
                    >
                      ×
                    </button>
                  )}
                </div>

                {t.error && <div className="task-error">{t.error}</div>}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
