# 格式工作台

剪映式预览工作台 + HandBrake 式常用参数，做日常格式转换用。替代格式工厂那类工具。

## 现在能做什么

- 拖入或导入多个视频，显示时长 / 分辨率 / 编码 / 体积
- 原生 `<video>` 预览，自动走 GPU 硬解
- 时间轴双滑块设定入点 / 出点，只转选中片段
- 9 个内置预设，也可手动调 12 项参数
- 批量队列串行转码，实时进度 / 速度 / ETA，可取消、可重试
- GPU 硬件编码（NVENC / QSV / AMF）自动检测，默认开启

## 技术栈

- **Tauri 2**（Rust）+ React 19 + TypeScript
- **ffmpeg / ffprobe** 作为转码引擎，随安装包分发

## 开发

```bash
npm install
npm run tauri dev
```

要求：Node 18+，Rust 1.77+（MSVC 工具链），系统需装 WebView2（Win10/11 通常自带）。

## 构建

```bash
npm run tauri build
```

产物在 `src-tauri/target/release/`：

- `format-studio.exe` — 便携版，直接双击运行
- `ffmpeg.exe` / `ffprobe.exe` — 与主程序同行即可
- `bundle/nsis/*.exe` — 安装包

> 只想要便携版、不打包安装程序：`npm run tauri build -- --no-bundle`

## ffmpeg 二进制

`src-tauri/binaries/` 里是两个静态链接的 ffmpeg 构建，文件名必须带目标三元组后缀：

```
ffmpeg-x86_64-pc-windows-msvc.exe
ffprobe-x86_64-pc-windows-msvc.exe
```

程序启动时优先找 exe 同目录的 ffmpeg，找不到才退回 PATH 里的。所以开发时也可以直接用系统装的 ffmpeg。

## 项目结构

```
src/                        React 前端
  App.tsx                   顶层状态与编排
  types.ts                  与 Rust 类型一一对应
  styles.css                深色主题与布局
  components/
    FileList.tsx            素材列表
    Preview.tsx             预览播放器 + 播放控制条
    TrimBar.tsx             双滑块裁剪条
    ParamPanel.tsx          12 项参数面板
    TaskQueue.tsx           任务队列
src-tauri/
  src/
    model.rs                数据类型、参数规范化
    ffmpeg.rs               参数 → 命令行（含各编码器词表翻译 + 单测）
    probe.rs                ffprobe 读元数据
    hw.rs                   GPU 编码器探测
    transcode.rs            串行队列、进度解析、取消、原子改名
    lib.rs                  Tauri commands 与状态
  presets/daily.json        内置预设
  tests/smoke.rs            端到端真实转码测试
```

## 几个关键实现点

**参数翻译**：`ffmpeg.rs` 里一个函数搞定。同一个 RF 值在不同编码器下写法完全不同 —— x264 用 `-crf`，NVENC 用 `-cq`，QSV 用 `-global_quality`，AMF 用 `-qp_i/-qp_p`。速度预设也一样（x264 是词表，NVENC 是 p1–p7，SVT-AV1 是数字）。这部分有单测覆盖。

**取消不留残骸**：输出先写 `xxx.tmp.mp4`，ffmpeg 成功退出后才 `rename` 成正式文件名。取消或崩溃时删临时文件，用户永远不会看到半个坏文件。

**串行队列**：消费级显卡的 NVENC 有并发会话数限制，同时开多个任务后几个会直接失败。所以默认单线程串行，稳。

**进度**：解析 `-progress pipe:1` 的输出。注意 `out_time_ms` 实际单位是**微秒**，这是 ffmpeg 的历史遗留命名坑。

## 测试

```bash
# 参数生成单测（不依赖 ffmpeg）
cargo test --manifest-path src-tauri/Cargo.toml --lib

# 端到端真实转码（需要 PATH 里有 ffmpeg）
cargo test --manifest-path src-tauri/Cargo.toml --test smoke -- --nocapture
```

## 已知限制

- 裁剪是秒级精度的快速 seek（`-ss` 放在 `-i` 前），不是帧精确
- 浏览器内核无法解码的格式（如某些 RMVB、老 VC-1）预览会黑屏，但仍可正常转换
- 暂不支持多音轨 / 字幕轨选择、合并多个片段
- 任务队列不持久化，关闭程序后清空
