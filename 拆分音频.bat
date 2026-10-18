@echo off
rem 音频拆句工具：把音频文件（或整个文件夹）拖到本 bat 上即可运行
set PATH=%PATH%;%USERPROFILE%\Downloads\ffmpeg\bin
set HF_ENDPOINT=https://hf-mirror.com
if "%~1"=="" (
  echo 用法：把音频文件或文件夹拖到本文件上
  echo 或：  拆分音频.bat "音频文件或文件夹路径"
  pause
  exit /b 1
)
cd /d "%~dp0"
python split_audio.py "%~1" --out bs-sentence
python build_sentences.py
echo.
echo 拆分完成并已并入词库。
pause
