use crate::ffmpeg::ffmpeg_path;
use crate::model::HwAccel;
use std::process::Command;

/// 启动时跑一次 `ffmpeg -encoders`，把结果缓存住。
/// 判断依据是「有没有对应的硬件编码器」，而不是「有没有这块显卡」。
pub fn detect() -> HwAccel {
    let out = Command::new(ffmpeg_path())
        .args(["-hide_banner", "-encoders"])
        .output();

    let Ok(out) = out else {
        return HwAccel::None;
    };
    if !out.status.success() {
        return HwAccel::None;
    }

    let text = String::from_utf8_lossy(&out.stdout);
    // 两个编码器都在才认为可用，避免 h264 能用 hevc 不能用的半残状态
    if text.contains("h264_nvenc") && text.contains("hevc_nvenc") {
        HwAccel::Nvenc
    } else if text.contains("h264_qsv") && text.contains("hevc_qsv") {
        HwAccel::Qsv
    } else if text.contains("h264_amf") && text.contains("hevc_amf") {
        HwAccel::Amf
    } else {
        HwAccel::None
    }
}

/// 前端展示用
pub fn label(hw: HwAccel) -> &'static str {
    match hw {
        HwAccel::None => "CPU",
        HwAccel::Nvenc => "NVIDIA NVENC",
        HwAccel::Qsv => "Intel QuickSync",
        HwAccel::Amf => "AMD AMF",
    }
}
