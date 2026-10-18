# -*- coding: utf-8 -*-
"""批量生成 4385 条词条的 TTS 音频（edge-tts），断点续跑。
用法: python generate_audio.py [voice] [--force]
默认音色 en-US-AriaNeural；--force 重新生成已存在的文件。
"""
import asyncio, json, os, re, sqlite3, sys, random

VOICE = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else 'en-US-AriaNeural'
FORCE = '--force' in sys.argv
BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, 'bambi-pc', 'media')
CONCURRENCY = 6
MAX_RETRY = 4

def load_jobs():
    con = sqlite3.connect(os.path.join(BASE, 'extracted', 'collection.anki2'))
    jobs = []
    for (flds,) in con.execute('SELECT flds FROM notes'):
        f = flds.split('\x1f')
        m = re.search(r'\[sound:([^\]]+)\]', f[7] if len(f) > 7 else '')
        if not m:
            continue
        text = re.sub(r'<[^>]+>', '', f[0]).strip()
        if text:
            jobs.append((m.group(1), text))
    return jobs

async def gen_one(sem, client_lock, fname, text, idx, total):
    path = os.path.join(OUT, fname)
    if not FORCE and os.path.exists(path) and os.path.getsize(path) > 0:
        return 'skip'
    async with sem:
        import edge_tts
        for attempt in range(1, MAX_RETRY + 1):
            try:
                await edge_tts.Communicate(text, VOICE).save(path)
                if idx % 100 == 0:
                    print(f'[{idx}/{total}] {fname}', flush=True)
                return 'ok'
            except Exception as e:
                if attempt == MAX_RETRY:
                    print(f'FAIL {fname}: {e}', flush=True)
                    return 'fail'
                await asyncio.sleep(attempt * 2 + random.random() * 2)

async def main():
    os.makedirs(OUT, exist_ok=True)
    jobs = load_jobs()
    todo = [(fn, tx) for fn, tx in jobs if FORCE or not (os.path.exists(os.path.join(OUT, fn)) and os.path.getsize(os.path.join(OUT, fn)) > 0)]
    print(f'voice={VOICE} total={len(jobs)} todo={len(todo)}', flush=True)
    sem = asyncio.Semaphore(CONCURRENCY)
    tasks = [gen_one(sem, None, fn, tx, i + 1, len(jobs)) for i, (fn, tx) in enumerate(jobs)]
    results = await asyncio.gather(*tasks)
    ok = sum(1 for r in results if r == 'ok')
    skip = sum(1 for r in results if r == 'skip')
    fail = sum(1 for r in results if r == 'fail')
    print(f'DONE ok={ok} skip={skip} fail={fail}', flush=True)
    if fail:
        print('重跑本脚本即可续传失败项', flush=True)

if __name__ == '__main__':
    asyncio.run(main())
