# -*- coding: utf-8 -*-
"""把 bs-sentence/ 下的拆句成果并入词库：
- 句子音频复制到 bambi-pc/media/sentences/<音频名>/NNNN.mp3
- 句子卡（kind='sentence'）写入 bambi-pc/js/data.js（与原有词汇卡合并）

幂等：重跑会先剔除旧句子卡再写入最新结果。
"""
import json, os, subprocess
from concurrent.futures import ThreadPoolExecutor

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, 'bs-sentence')
MEDIA_DST = os.path.join(BASE, 'bambi-pc', 'media', 'sentences')
DATA_JS = os.path.join(BASE, 'bambi-pc', 'js', 'data.js')

def encode_copy(src, dst):
    """句子音频转单声道低码率再入库（语音内容，体积约为原始的 1/3）"""
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if os.path.exists(dst) and os.path.getsize(dst) > 0:
        return
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", src,
                    "-ac", "1", "-codec:a", "libmp3lame", "-q:a", "6", dst],
                   check=True)

def load_cards():
    src = open(DATA_JS, encoding='utf-8').read()
    return json.loads(src[src.index('['):src.rindex(']') + 1])

def save_cards(cards):
    with open(DATA_JS, 'w', encoding='utf-8') as w:
        w.write('// Bambi Transcript Vocab — exported from bambi_vocab.apkg (+ sentences)\n')
        w.write('window.DECK_DATA = ')
        json.dump(cards, w, ensure_ascii=False, separators=(',', ':'))
        w.write(';\n')

def main():
    cards = [c for c in load_cards() if c.get('kind') != 'sentence']
    jobs = []
    new_cards = []
    for folder in sorted(os.listdir(SRC)):
        mdir = os.path.join(SRC, folder)
        mpath = os.path.join(mdir, 'manifest.json')
        if not os.path.isdir(mdir) or not os.path.exists(mpath):
            continue
        manifest = json.load(open(mpath, encoding='utf-8'))
        for seg in manifest:
            src_mp3 = os.path.join(mdir, seg['file'])
            if not os.path.exists(src_mp3):
                continue
            jobs.append((src_mp3, os.path.join(MEDIA_DST, folder, seg['file'])))
            mm, ss = divmod(int(seg['start']), 60)
            new_cards.append({
                'id': f"s-{folder}-{seg['file']}",
                'term': seg['text'],
                'ph': '', 'meaning': '', 'en': '', 'example': '',
                'source': f"{folder} @ {mm}:{ss:02d}",
                'kind': 'sentence',
                'tags': ['sentence'],
                'audio': f"sentences/{folder}/{seg['file']}"
            })
    with ThreadPoolExecutor(max_workers=8) as ex:
        list(ex.map(lambda j: encode_copy(*j), jobs))
    cards.extend(new_cards)
    save_cards(cards)
    print(f"句子卡: {len(new_cards)} | 词库总数: {len(cards)}")

if __name__ == '__main__':
    main()
