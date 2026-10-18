# BS_app · Bambi 词汇/句子学习项目

| 路径 | 说明 |
|------|------|
| `bambi_vocab.apkg` | 原始 Anki 牌组（4385 词汇卡） |
| `bambi-pc/` | 背单词 PWA 应用（PC 双击即用，可部署 GitHub Pages/Vercel） |
| `bs-sentence/` | 拆句成果：每个音频一个文件夹，内含逐句 mp3 + manifest.json |
| `split_audio.py` | 音频拆句工具（whisper 识别 + 转写文本对齐 + ffmpeg 切段） |
| `build_sentences.py` | 把 bs-sentence 的句子并入应用词库（kind=sentence） |
| `generate_audio.py` | 词汇卡 TTS 音频批量生成（edge-tts） |
| `拆分音频.bat` | 拖放式入口：把音频文件/文件夹拖上去即拆分并入库 |

## 拆句工具用法

```bash
# 单个文件
python split_audio.py "…\01 Sleepygirl Salon.mp3"
# 整个文件夹（自动匹配同级 "_Transcripts (Visible Triggers)" 里的同名 txt）
python split_audio.py "…\07 BambiLite Mental Makeover"
# 更高精度（慢 2~3 倍）：换 small.en 模型
python split_audio.py "…" --model small.en
```

- 需要 ffmpeg 在 PATH（或用 拆分音频.bat，已内置路径）
- 输出：`bs-sentence/<音频名>/0001.mp3 …` + `manifest.json`（时间戳+文本）
- 已完成过的音频会自动跳过；删掉对应文件夹可重做
- 拆完运行 `python build_sentences.py` 并入应用词库（bat 已自动执行）

## 学习规则

- 每日新卡默认 20 张（设置可调），其中**俚语+句子 ≥50%**，配额内句子优先
- 句子卡为听力模式：正面只放音频，回忆后翻面看文本+中文对照

## 部署

整个仓库（应用 + bs-sentence 拆句数据 + 工具）一次 push 全部上 GitHub：

```bash
git remote add origin https://github.com/<你的用户名>/bambi-vocab.git
git push -u origin main
```

- GitHub Pages：Settings → Pages → main / (root)，应用地址为
  `https://<你的用户名>.github.io/bambi-vocab/bambi-pc/`（注意带 /bambi-pc/ 路径）
- Vercel：导入仓库时 Root Directory 选 `bambi-pc`，得到无子路径的干净域名
- 注意：GitHub Pages 免费版只支持**公开**仓库；私有仓库想用 Pages 需 GitHub Pro，
  或改用 Vercel / Cloudflare Pages（免费版均支持私有仓库）
