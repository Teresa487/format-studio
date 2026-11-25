import { fmtBytes, fmtDuration, type MediaInfo } from "../types";

interface Props {
  files: MediaInfo[];
  activePath: string | null;
  thumbnails: Record<string, string>;
  onSelect: (path: string) => void;
  onRemove: (path: string) => void;
}

function subLine(f: MediaInfo): string {
  if (f.error) return f.error;
  const parts: string[] = [];
  if (f.has_video) parts.push(`${f.width}×${f.height}`);
  parts.push(fmtDuration(f.duration));
  parts.push(fmtBytes(f.size_bytes));
  return parts.join(" · ");
}

export function FileList({ files, activePath, thumbnails, onSelect, onRemove }: Props) {
  if (files.length === 0) {
    return (
      <div className="empty-hint">
        <div className="big">＋</div>
        还没有素材
        <br />
        把视频文件拖进窗口
        <br />
        或点顶部「导入」
      </div>
    );
  }

  return (
    <>
      {files.map((f) => (
        <div
          key={f.path}
          className={`file-item ${f.path === activePath ? "active" : ""}`}
          onClick={() => onSelect(f.path)}
          title={f.path}
        >
          <div
            className="file-thumb"
            style={
              thumbnails[f.path]
                ? { backgroundImage: `url("${thumbnails[f.path]}")` }
                : undefined
            }
          >
            {!thumbnails[f.path] && (f.has_video ? "▤" : "♪")}
          </div>
          <div className="file-meta">
            <div className="file-name">{f.name}</div>
            <div className="file-sub" style={f.error ? { color: "var(--danger)" } : undefined}>
              {subLine(f)}
            </div>
          </div>
          <button
            className="file-remove"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(f.path);
            }}
            title="移除"
          >
            ×
          </button>
        </div>
      ))}
    </>
  );
}
