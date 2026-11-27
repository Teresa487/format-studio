import assert from "node:assert/strict";
import test from "node:test";
import { paramsFromSource, sourceContainer, sourceVideoCodec } from "../src/sourceParams.ts";
import type { MediaInfo } from "../src/types.ts";

const base: MediaInfo = {
  path: "E:/video/1080p.mp4",
  name: "1080p.mp4",
  duration: 60,
  width: 1920,
  height: 1080,
  video_codec: "h264",
  audio_codec: "aac",
  fps: 29.97,
  video_bitrate: 8_000_000,
  audio_bitrate: 192_000,
  audio_channels: 2,
  format_name: "mov,mp4,m4a,3gp,3g2,mj2",
  size_bytes: 60_000_000,
  has_video: true,
  error: null,
};

test("MP4/H.264/AAC 源文件自动匹配", () => {
  const p = paramsFromSource(base, "none");
  assert.equal(p.container, "mp4");
  assert.equal(p.video_codec, "h264");
  assert.equal(p.height, null); // 保持原始 1080p
  assert.equal(p.fps, null); // 保持原始 29.97
  assert.equal(p.audio_codec, "copy");
  assert.equal(p.audio_bitrate, 192);
  assert.equal(p.channels, "stereo");
  assert.equal(p.quality_mode, "bitrate");
  assert.equal(p.bitrate, "8.00M");
});

test("1080p 转 720p 只需要改 height", () => {
  const p = paramsFromSource(base, "none");
  const next = { ...p, height: 720 };
  assert.equal(next.height, 720);
  assert.equal(next.video_codec, "h264");
  assert.equal(next.fps, null);
  assert.equal(next.audio_codec, "copy");
  assert.equal(next.audio_bitrate, 192);
  assert.equal(next.channels, "stereo");
  assert.equal(next.quality_mode, "bitrate");
  assert.equal(next.bitrate, "8.00M");
});

test("MKV/H.265/单声道源文件自动匹配", () => {
  const p = paramsFromSource(
    {
      ...base,
      path: "E:/video/hevc.mkv",
      name: "hevc.mkv",
      video_codec: "hevc",
      audio_codec: "ac3",
      audio_channels: 1,
      audio_bitrate: 384_000,
    },
    "none",
  );
  assert.equal(p.container, "mkv");
  assert.equal(p.video_codec, "h265");
  assert.equal(p.audio_codec, "copy");
  assert.equal(p.audio_bitrate, 384);
  assert.equal(p.channels, "mono");
});

test("WebM 源文件保持 VP9/Opus", () => {
  const p = paramsFromSource(
    {
      ...base,
      path: "E:/video/vp9.webm",
      name: "vp9.webm",
      video_codec: "vp9",
      audio_codec: "opus",
      audio_bitrate: 128_000,
    },
    "none",
  );
  assert.equal(sourceContainer({ ...base, path: "E:/video/vp9.webm" }), "webm");
  assert.equal(sourceVideoCodec({ ...base, video_codec: "vp9" }), "vp9");
  assert.equal(p.container, "webm");
  assert.equal(p.video_codec, "vp9");
  assert.equal(p.audio_codec, "copy");
});

test("MP4 遇到冷门音频自动退回 AAC", () => {
  const p = paramsFromSource(
    {
      ...base,
      audio_codec: "dts",
      audio_bitrate: 768_000,
    },
    "none",
  );
  assert.equal(p.container, "mp4");
  assert.equal(p.audio_codec, "aac");
});

test("读不到源视频码率时退回 RF22", () => {
  const p = paramsFromSource({ ...base, video_bitrate: null }, "none");
  assert.equal(p.quality_mode, "rf");
  assert.equal(p.rf, 22);
  assert.equal(p.bitrate, null);
});

test("纯音频 MP3 不生成视频轨", () => {
  const p = paramsFromSource(
    {
      ...base,
      path: "E:/music/song.mp3",
      name: "song.mp3",
      has_video: false,
      width: 0,
      height: 0,
      video_codec: null,
      video_bitrate: null,
      audio_codec: "mp3",
      audio_bitrate: 320_000,
      fps: 0,
    },
    "none",
  );
  assert.equal(p.container, "mp3");
  assert.equal(p.video_codec, null);
  assert.equal(p.audio_codec, "mp3");
  assert.equal(p.audio_bitrate, 320);
});
