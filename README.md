# Bambi Vocab · 背单词应用（PWA）

从 `bambi_vocab.apkg`（Anki 牌组）移植的背单词应用，PC 与 iPhone 通用。
**零安装、零依赖**：整个应用就是几个静态文件，浏览器打开即用。

## 使用方法

**PC**：直接双击 `index.html`（或 `启动.bat`），推荐 Chrome / Edge。

**iPhone**：把本仓库部署到 GitHub Pages / Vercel 后，用 Safari 打开网址 →
分享按钮 →「添加到主屏幕」。之后从主屏幕图标打开，全屏、可离线，
体验和原生 App 基本一致。

> 注意：iOS 上「主屏幕 App」和「Safari 标签页」是两套独立存储，
> 请固定从主屏幕图标打开，不要两边混用，否则进度不互通。

## 部署（GitHub Pages）

```bash
# 在本目录下（已初始化 git 仓库）
git add -A && git commit -m "Bambi Vocab PWA"
git remote add origin https://github.com/<你的用户名>/bambi-vocab.git
git push -u origin main
```

然后到仓库 **Settings → Pages → Build and deployment → Source: Deploy from a branch →
Branch: main / (root)**，保存。约 1 分钟后应用上线：
`https://<你的用户名>.github.io/bambi-vocab/`

## 部署（Vercel，备选）

把本仓库导入 Vercel（New Project → Import），框架选 Other，无需任何配置，
自动获得 `https://<项目名>.vercel.app` 域名并在每次 push 后自动更新。

## 功能

| 模块 | 说明 |
|------|------|
| 学习 | 翻卡式学习（正面：单词+音标+发音；背面：中文释义+英文释义+例句+出处） |
| 间隔重复 | 简化 SM-2 算法：重来(10分钟) / 困难 / 认识 / 简单(4天)，进度存于浏览器 localStorage |
| 浏览 | 4385 条全部词条，支持搜索（单词/中文/英文/出处）与分类筛选（单词/短语/俚语） |
| 统计 | 掌握数、到期数、未来 7 天到期预测、词库构成 |
| 设置 | 每日新卡数量（默认 20）、翻卡自动发音开关 |

## 快捷键

- `空格` / `回车`：翻面（翻面后等价于"认识"）
- `1` `2` `3` `4`：重来 / 困难 / 认识 / 简单
- `L`：重播发音

## 关于发音

原牌组 4385 张卡各带一个 TTS 音频，但导出包里**只有 27 个音频文件实际包含在内**
（Anki 导出时媒体缺失）。本仓库已用 edge-tts（en-US-AriaNeural 女声）**补齐全部
4385 条音频**，放在 `media/` 目录，总计约 20MB：

- 在线时首次播放自动缓存，之后离线也能听
- 设置里有「下载全部音频供离线使用」按钮，一键把整个词库音频缓存到设备
- 想换音色：在项目根目录运行 `python generate_audio.py <音色名> --force`
  （音色列表：`edge-tts --list-voices`，推荐 en-US-JennyNeural / en-US-AriaNeural 等），
  然后重新提交 media/ 目录即可
- 音频不可用时（如本地 file:// 直开且缺文件），自动回退到浏览器实时语音合成

## 进度备份

学习进度保存在浏览器 localStorage。换电脑/换浏览器前，请到「统计」页点
**导出学习进度**，在新环境用**导入学习进度**恢复。

## 文件结构

```
bambi-pc/
├── index.html        入口（双击打开）
├── 启动.bat          等价于双击 index.html
├── manifest.json     PWA 清单
├── sw.js             Service Worker（离线缓存）
├── icons/            应用图标
├── css/style.css     界面样式
├── js/app.js         应用逻辑（含 SM-2 调度）
├── js/data.js        词库数据（4385 条，从 apkg 导出）
└── media/            TTS 音频（4385 个，edge-tts 补齐）
```
