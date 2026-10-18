# -*- coding: utf-8 -*-
"""音频拆句工具：把整段音频按句子拆成多个 mp3，并与转写文本逐句对齐。

原理：faster-whisper 语音识别（带 VAD，可压过背景音乐）给出每句的时间戳，
再用 difflib 把转写文本的每一行对齐到对应时间段，按时间戳用 ffmpeg 切音频。

用法：
    python split_audio.py "<音频文件或目录>" [--model base.en] [--out bs-sentence]

输出结构（每个音频文件一个文件夹）：
    bs-sentence/
      01 Sleepygirl Salon/
        0001.mp3
        0002.mp3
        ...
        manifest.json      # [{"file","start","end","text","source"}]
        _whisper.json      # 识别缓存（调试用/重跑省时）

需要：ffmpeg 在 PATH 中；模型首次运行自动下载（可用 HF_ENDPOINT 环境变量走镜像）。
"""
import argparse, difflib, json, os, re, subprocess, sys, time

def log(*a): print(*a, flush=True)

# ---------------- 音频解码（绕开 PyAV 兼容问题） ----------------
def load_audio(path):
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-i", path,
           "-f", "f32le", "-ac", "1", "-ar", "16000", "pipe:1"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    import numpy as np
    return np.frombuffer(raw, dtype=np.float32)

# ---------------- whisper 转写 ----------------
def transcribe(model, audio_path, cache_path):
    if os.path.exists(cache_path):
        log("  使用缓存", os.path.basename(cache_path))
        return json.load(open(cache_path, encoding="utf-8"))
    t0 = time.time()
    segments, _ = model.transcribe(
        audio_path if isinstance(audio_path, str) else audio_path,
        vad_filter=True, vad_parameters=dict(min_silence_duration_ms=500),
        beam_size=5)
    segs = [{"start": round(s.start, 2), "end": round(s.end, 2),
             "text": s.text.strip()} for s in segments]
    log(f"  转写完成 {time.time()-t0:.0f}s → {len(segs)} 段")
    json.dump(segs, open(cache_path, "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    return segs

# ---------------- 文本对齐 ----------------
def tokens(s):
    return re.findall(r"[a-z0-9']+", s.lower())

def align(transcript_lines, segs):
    """把每一行转写文本映射到一个 whisper 段；返回 {seg_idx: [line,...]}, 对齐得分"""
    w_tok = []          # [(token, seg_idx)]
    for i, s in enumerate(segs):
        for t in tokens(s["text"]):
            w_tok.append((t, i))
    t_tok = []          # [(token, line_idx)]
    for i, ln in enumerate(transcript_lines):
        for t in tokens(ln):
            t_tok.append((t, i))

    sm = difflib.SequenceMatcher(None, [t for t, _ in w_tok],
                                 [t for t, _ in t_tok], autojunk=False)
    # 转写 token 位置 → whisper 段号（来自匹配块）
    line2seg = {}
    matched_t_tokens = 0
    for w0, t0, size in sm.get_matching_blocks():
        matched_t_tokens += size
        for k in range(size):
            line_idx = t_tok[t0 + k][1]
            # 该行第一个被对齐的 token 决定归属段
            line2seg.setdefault(line_idx, w_tok[w0 + k][1])

    # 未对齐行：并入前一行的段（顺序兜底）
    for i in range(len(transcript_lines)):
        if i not in line2seg:
            line2seg[i] = line2seg.get(i - 1, 0)

    groups = {}
    for line_idx, seg_idx in sorted(line2seg.items()):
        groups.setdefault(seg_idx, []).append(transcript_lines[line_idx].strip())

    score = matched_t_tokens / max(1, len(t_tok))
    return groups, score

# ---------------- ffmpeg 切段 ----------------
def cut(audio_path, start, end, out_path):
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-y",
           "-ss", f"{max(0, start - 0.05):.2f}", "-to", f"{end + 0.15:.2f}",
           "-i", audio_path, "-codec:a", "libmp3lame", "-q:a", "4", out_path]
    subprocess.run(cmd, check=True)

# ---------------- 单文件处理 ----------------
def norm_name(name):
    return re.sub(r"^\d+\s*", "", os.path.splitext(name)[0]).strip().lower()

def find_transcript(audio_name, tx_dir):
    target = norm_name(audio_name)
    for f in os.listdir(tx_dir):
        if f.endswith(".txt") and "_ORIGINAL SERIES" not in f:
            if norm_name(f) == target:
                return os.path.join(tx_dir, f)
    return None

def process_file(model, audio_path, tx_dir, out_root):
    name = os.path.splitext(os.path.basename(audio_path))[0]
    out_dir = os.path.join(out_root, name)
    manifest_path = os.path.join(out_dir, "manifest.json")
    if os.path.exists(manifest_path):
        log(f"跳过（已完成）: {name}")
        return "skip"
    tx_path = find_transcript(os.path.basename(audio_path), tx_dir) if tx_dir else None
    if not tx_path:
        log(f"跳过（无转写文本）: {name}")
        return "no-transcript"

    log(f"处理: {name}")
    os.makedirs(out_dir, exist_ok=True)
    lines = [l.strip() for l in open(tx_path, encoding="utf-8", errors="replace")
             .read().splitlines() if l.strip()]
    segs = transcribe(model, load_audio(audio_path), os.path.join(out_dir, "_whisper.json"))
    groups, score = align(lines, segs)
    log(f"  文本 {len(lines)} 行 ↔ 语音 {len(segs)} 段 | 对齐得分 {score:.1%}")

    manifest = []
    n = 0
    for seg_idx in sorted(groups):
        seg = segs[seg_idx]
        text = " ".join(groups[seg_idx])
        if not text:
            continue
        n += 1
        fname = f"{n:04d}.mp3"
        cut(audio_path, seg["start"], seg["end"], os.path.join(out_dir, fname))
        manifest.append({
            "file": fname,
            "start": seg["start"], "end": seg["end"],
            "dur": round(seg["end"] - seg["start"], 2),
            "text": text,
            "source": name
        })
    json.dump(manifest, open(manifest_path, "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    durs = [m["dur"] for m in manifest]
    log(f"  输出 {n} 句 → {out_dir} | 句均 {sum(durs)/max(1,len(durs)):.1f}s")
    return "ok"

# ---------------- 入口 ----------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input", help="音频文件或包含音频的目录")
    ap.add_argument("--model", default="base.en")
    ap.add_argument("--out", default="bs-sentence")
    ap.add_argument("--transcripts", default=None,
                    help="转写文本目录（默认找音频旁的 _Transcripts (Visible Triggers)）")
    args = ap.parse_args()

    if os.path.isfile(args.input):
        files = [args.input]
        base_dir = os.path.dirname(args.input)
    else:
        base_dir = args.input
        files = [os.path.join(base_dir, f) for f in sorted(os.listdir(base_dir))
                 if f.lower().endswith((".mp3", ".m4a", ".wav", ".flac", ".ogg"))]

    tx_dir = args.transcripts
    if not tx_dir:
        cand = os.path.join(base_dir, "_Transcripts (Visible Triggers)")
        tx_dir = cand if os.path.isdir(cand) else None

    log(f"共 {len(files)} 个音频 | 转写目录: {tx_dir or '未找到'}")
    from faster_whisper import WhisperModel
    model = WhisperModel(args.model, device="cpu", compute_type="int8")

    stats = {"ok": 0, "skip": 0, "no-transcript": 0}
    for f in files:
        try:
            r = process_file(model, f, tx_dir, args.out)
            stats[r] = stats.get(r, 0) + 1
        except Exception as e:
            log(f"失败: {os.path.basename(f)}: {e}")
    log("完成:", stats)

if __name__ == "__main__":
    main()
