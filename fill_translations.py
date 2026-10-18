# -*- coding: utf-8 -*-
"""把 translate_zh/ 下的中文翻译并入 data.js 句子卡的 meaning 字段。
校验全覆盖后才写入；幂等，可重跑。"""
import json, os, glob, sys

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_JS = os.path.join(BASE, 'bambi-pc', 'js', 'data.js')

zh = {}
for f in sorted(glob.glob(os.path.join(BASE, 'translate_zh', 'chunk_*.json'))):
    try:
        zh.update(json.load(open(f, encoding='utf-8')))
    except Exception as e:
        print('损坏的文件:', f, e); sys.exit(1)
print('翻译条目:', len(zh))

src = open(DATA_JS, encoding='utf-8').read()
cards = json.loads(src[src.index('['):src.rindex(']') + 1])
filled, missing = 0, []
for c in cards:
    if c.get('kind') != 'sentence':
        continue
    t = zh.get(c['id'], '').strip()
    if t:
        c['meaning'] = t
        filled += 1
    else:
        missing.append(c['id'])
print(f'句子卡: {filled + len(missing)} | 填入翻译: {filled} | 缺翻译: {len(missing)}')
for m in missing[:10]:
    print('  缺:', m)
if missing:
    sys.exit(2)

with open(DATA_JS, 'w', encoding='utf-8') as w:
    w.write('// Bambi Transcript Vocab — exported from bambi_vocab.apkg (+ sentences + zh)\n')
    w.write('window.DECK_DATA = ')
    json.dump(cards, w, ensure_ascii=False, separators=(',', ':'))
    w.write(';\n')
print('data.js 已更新')
