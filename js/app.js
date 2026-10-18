/* Bambi Vocab — PC 背单词应用
 * 数据来源：bambi_vocab.apkg（Anki 导出）
 * 调度算法：简化版 SM-2 间隔重复
 */
'use strict';

const CARDS = window.DECK_DATA;
const DAY = 86400000;

/* ================= 存储 ================= */
const store = {
  load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  },
  save(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
};

// progress[cardId] = { e: ease, i: interval(days), due: ts, reps, lapses, st: 'new'|'learning'|'review' }
let progress = store.load('bambi-progress-v1', {});
let settings = Object.assign({ newPerDay: 20, autoplay: true }, store.load('bambi-settings-v1', {}));
let daily = store.load('bambi-daily-v1', { date: todayStr(), newCount: 0 });
if (daily.date !== todayStr()) daily = { date: todayStr(), newCount: 0 };

function todayStr() { return new Date().toISOString().slice(0, 10); }
function saveAll() {
  store.save('bambi-progress-v1', progress);
  store.save('bambi-settings-v1', settings);
  store.save('bambi-daily-v1', daily);
}
function stateOf(id) {
  return progress[id] || { e: 2.5, i: 0, due: 0, reps: 0, lapses: 0, st: 'new' };
}

/* ================= SM-2 调度 ================= */
// rating: 0=重来 1=困难 2=认识 3=简单 → 返回新状态（不写库）
function schedule(card, rating, now = Date.now()) {
  const s = { ...stateOf(card.id) };
  if (s.st === 'new') { s.st = 'learning'; s.i = 0; }

  if (rating === 0) {                       // 重来：10 分钟后重学
    s.st = 'learning'; s.i = 0;
    s.e = Math.max(1.3, s.e - 0.2);
    s.lapses++; s.reps = 0;
    s.due = now + 10 * 60000;
    return s;
  }
  const easeDelta = rating === 1 ? -0.15 : rating === 3 ? 0.15 : 0;
  s.e = Math.max(1.3, s.e + easeDelta);

  if (s.st === 'learning') {                // 学习阶段毕业
    if (rating === 1) { s.due = now + 15 * 60000; return s; }  // 困难：再看一次
    s.st = 'review';
    s.i = rating === 3 ? 4 : 1;
  } else {                                  // 复习阶段
    if (rating === 1) s.i = Math.max(1, Math.round(s.i * 1.2));
    else if (rating === 2) s.i = Math.max(1, Math.round(s.i * s.e));
    else s.i = Math.max(1, Math.round(s.i * s.e * 1.3));
  }
  s.reps++;
  s.due = now + s.i * DAY;
  return s;
}

function previewInterval(card, rating) {
  const s = schedule(card, rating);
  const ms = s.due - Date.now();
  if (ms < 3600000) return Math.round(ms / 60000) + '分钟';
  const d = ms / DAY;
  if (d < 30) return (d < 1.5 ? '1' : Math.round(d)) + '天';
  if (d < 365) return Math.round(d / 30.4) + '个月';
  return (d / 365).toFixed(1) + '年';
}

/* ================= 学习队列 ================= */
let queue = [];        // [{card, learning:boolean}]
let current = null;
let flipped = false;
let sessionDone = 0;
let sessionTotal = 0;
let extraNew = 0;      // 用户要求“多学一点”的额度

function buildQueue() {
  const now = Date.now();
  const due = [], fresh = [];
  for (const c of CARDS) {
    const s = stateOf(c.id);
    if (s.st === 'new') fresh.push(c);
    else if (s.due <= now) due.push({ card: c, learning: s.st === 'learning' });
  }
  due.sort((a, b) => stateOf(a.card.id).due - stateOf(b.card.id).due);
  // 新卡洗牌后按每日额度取
  for (let i = fresh.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [fresh[i], fresh[j]] = [fresh[j], fresh[i]];
  }
  const allowance = Math.max(0, settings.newPerDay + extraNew - daily.newCount);
  // 每日新卡中俚语+句子占比 ≥50%；配额内句子优先于俚语，保证句子稳定出现
  const sents  = fresh.filter(c => c.kind === 'sentence');
  const slangs = fresh.filter(c => c.kind === 'slang');
  const others = fresh.filter(c => c.kind !== 'slang' && c.kind !== 'sentence');
  const quotaA = Math.ceil(allowance * 0.5);
  const nSent  = Math.min(sents.length, Math.ceil(quotaA / 2));
  const nSlang = Math.min(slangs.length, quotaA - nSent);
  let picked = sents.slice(0, nSent).concat(slangs.slice(0, nSlang));
  const nOther = Math.min(others.length, allowance - picked.length);
  picked = picked.concat(others.slice(0, nOther));
  const rest = allowance - picked.length;
  if (rest > 0) picked = picked.concat(sents.slice(nSent, nSent + rest), slangs.slice(nSlang, nSlang + rest));
  for (let i = picked.length - 1; i > 0; i--) {   // 打乱，避免句子卡扎堆
    const j = Math.floor(Math.random() * (i + 1));
    [picked[i], picked[j]] = [picked[j], picked[i]];
  }
  const newItems = picked.map(card => ({ card, learning: false }));
  queue = due.concat(newItems);
  sessionTotal = queue.length;
  sessionDone = 0;
}

function nextCard() {
  const now = Date.now();
  // 优先取出已到期的时间卡（重来/困难的 10~15 分钟卡）
  const li = queue.findIndex(q => q.learning && stateOf(q.card.id).due <= now);
  if (li >= 0) return queue.splice(li, 1)[0];
  const ni = queue.findIndex(q => !q.learning);
  if (ni >= 0) return queue.splice(ni, 1)[0];
  // 只剩未到期的时间卡 → 今天收工
  return null;
}

function updateSessionBar() {
  const pct = sessionTotal ? Math.round(sessionDone / sessionTotal * 100) : 100;
  document.getElementById('progressFill').style.width = pct + '%';
  const dueLeft = queue.filter(q => !q.learning).length;
  const learning = queue.filter(q => q.learning).length;
  document.getElementById('sessionInfo').textContent =
    `本次 ${sessionDone}/${sessionTotal} · 队列剩 ${dueLeft} · 重学 ${learning}`;
}

function showCard(item) {
  current = item; flipped = false;
  const card = item.card;
  const el = document.getElementById('card');
  el.classList.remove('flipped');
  fillFace(document.querySelector('.face.front'), card, true);
  fillFace(document.querySelector('.face.back'), card, false);
  document.getElementById('showAnswerBtn').classList.remove('hidden');
  document.getElementById('answerBar').classList.add('hidden');
  document.getElementById('donePanel').classList.add('hidden');
  document.getElementById('cardScene').classList.remove('hidden');
  updateSessionBar();
  if (settings.autoplay) speak(card);
}

function fillFace(face, card, isFront) {
  const isSentence = card.kind === 'sentence';
  face.querySelector('.kind-badge').textContent = kindLabel(card.kind);
  face.querySelector('.kind-badge').className = 'kind-badge ' + card.kind;
  const termEl = face.querySelector('.term');
  const phEl = face.querySelector('.phonetic');
  if (isFront && isSentence) {
    // 句子卡正面：听力模式，只放声音不露文本
    termEl.textContent = '🎧';
    termEl.classList.remove('sentence-back');
    phEl.textContent = '仔细听，回忆这句说了什么';
  } else {
    termEl.textContent = card.term;
    termEl.classList.toggle('sentence-back', isSentence);
    phEl.textContent = card.ph ? '/' + card.ph + '/' : '';
  }
  if (!isFront) {
    face.querySelector('.meaning').innerHTML = card.meaning;
    face.querySelector('.en-def').textContent = card.en;
    face.querySelector('.example').innerHTML = card.example || '';
    face.querySelector('.source').textContent = card.source ? '📺 ' + card.source : '';
  }
}

function kindLabel(k) {
  return { word: '单词', phrase: '短语', slang: '俚语', sentence: '句子' }[k] || k;
}

function flip() {
  if (!current || flipped) return;
  flipped = true;
  document.getElementById('card').classList.add('flipped');
  document.getElementById('showAnswerBtn').classList.add('hidden');
  const bar = document.getElementById('answerBar');
  bar.classList.remove('hidden');
  bar.querySelectorAll('.rate').forEach(btn => {
    btn.querySelector('small').textContent = previewInterval(current.card, +btn.dataset.r);
  });
}

function rate(rating) {
  if (!current || !flipped) return;
  const card = current.card;
  const wasNew = stateOf(card.id).st === 'new';
  const s = schedule(card, rating);
  progress[card.id] = s;
  if (wasNew) daily.newCount++;
  sessionDone++;
  if (rating === 0 || (rating === 1 && s.st === 'learning')) {
    queue.push({ card, learning: true });   // 稍后重见
  }
  saveAll();
  advance();
}

function advance() {
  const item = nextCard();
  if (item) { showCard(item); return; }
  // 完成
  current = null;
  document.getElementById('cardScene').classList.add('hidden');
  document.getElementById('showAnswerBtn').classList.add('hidden');
  document.getElementById('answerBar').classList.add('hidden');
  const learned = Object.values(progress).filter(p => p.st === 'review').length;
  document.getElementById('doneStats').textContent =
    `本次完成 ${sessionDone} 张 · 今日新学 ${daily.newCount} 张 · 累计掌握 ${learned} 张`;
  document.getElementById('donePanel').classList.remove('hidden');
  updateSessionBar();
}

/* ================= 发音 ================= */
let audioEl = null;
function speak(card) {
  stopSpeak();
  if (card.audio) {
    audioEl = new Audio('media/' + card.audio);
    audioEl.play().catch(() => tts(card.term));
  } else {
    tts(card.term);
  }
}
function tts(text) {
  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text.replace(/<[^>]+>/g, ''));
  u.lang = 'en-US'; u.rate = 0.92;
  const voices = speechSynthesis.getVoices();
  const v = voices.find(v => /en[-_]US/i.test(v.lang) && /female|zira|samantha|aria/i.test(v.name))
         || voices.find(v => /en[-_]US/i.test(v.lang))
         || voices.find(v => /^en/i.test(v.lang));
  if (v) u.voice = v;
  speechSynthesis.speak(u);
}
function stopSpeak() {
  if (audioEl) { audioEl.pause(); audioEl = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}
if ('speechSynthesis' in window) speechSynthesis.getVoices(); // 预热语音列表

/* ================= 浏览 ================= */
let browseFilter = { q: '', kind: '' };
let browseShown = 0;
const PAGE = 80;

function filteredCards() {
  const q = browseFilter.q.trim().toLowerCase();
  return CARDS.filter(c => {
    if (browseFilter.kind && c.kind !== browseFilter.kind) return false;
    if (!q) return true;
    return c.term.toLowerCase().includes(q)
        || c.meaning.toLowerCase().includes(q)
        || c.en.toLowerCase().includes(q)
        || (c.source || '').toLowerCase().includes(q);
  });
}

function renderBrowse(reset = true) {
  if (reset) { browseShown = 0; document.getElementById('wordList').innerHTML = ''; }
  const list = filteredCards();
  const slice = list.slice(browseShown, browseShown + PAGE);
  const frag = document.createDocumentFragment();
  for (const c of slice) {
    const st = stateOf(c.id);
    const div = document.createElement('div');
    div.className = 'word-item';
    div.innerHTML =
      `<div class="wi-term"><span class="${st.st === 'review' ? 'learned-dot' : 'learned-dot new-dot'}" title="${st.st === 'review' ? '已掌握' : '未掌握'}"></span>${escapeHtml(c.term)}${c.ph ? `<span class="ph">/${escapeHtml(c.ph)}/</span>` : ''}</div>
       <div class="wi-meaning">${escapeHtml(c.meaning.replace(/<br\s*\/?>/gi, ' '))}</div>
       <span class="wi-kind ${c.kind}">${kindLabel(c.kind)}</span>
       <button class="wi-audio" title="发音">🔊</button>`;
    div.querySelector('.wi-audio').addEventListener('click', e => { e.stopPropagation(); speak(c); });
    div.addEventListener('click', () => openModal(c));
    frag.appendChild(div);
  }
  document.getElementById('wordList').appendChild(frag);
  browseShown += slice.length;
  document.getElementById('browseCount').textContent = `共 ${list.length} 条`;
  document.getElementById('loadMoreBtn').classList.toggle('hidden', browseShown >= list.length);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

/* ================= 详情弹窗 ================= */
function openModal(c) {
  const m = document.getElementById('modal');
  m.querySelector('.kind-badge').textContent = kindLabel(c.kind);
  m.querySelector('.kind-badge').className = 'kind-badge ' + c.kind;
  m.querySelector('.term').textContent = c.term;
  m.querySelector('.phonetic').textContent = c.ph ? '/' + c.ph + '/' : '';
  m.querySelector('.meaning').innerHTML = c.meaning;
  m.querySelector('.en-def').textContent = c.en;
  m.querySelector('.example').innerHTML = c.example || '';
  m.querySelector('.source').textContent = c.source ? '📺 ' + c.source : '';
  m.classList.remove('hidden');
  m.querySelector('.audio-btn').onclick = () => speak(c);
  if (settings.autoplay) speak(c);
}
function closeModals() {
  stopSpeak();
  document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
}

/* ================= 统计 ================= */
function renderStats() {
  const now = Date.now();
  let learned = 0, learning = 0, dueNow = 0;
  const forecast = new Array(7).fill(0);
  for (const c of CARDS) {
    const s = stateOf(c.id);
    if (s.st === 'review') {
      learned++;
      if (s.due <= now) dueNow++;
      else {
        const d = Math.floor((s.due - now) / DAY);
        if (d < 7) forecast[d]++;
      }
    } else if (s.st === 'learning') {
      learning++;
      if (s.due <= now) dueNow++;
    }
  }
  const total = CARDS.length;
  const fresh = total - learned - learning;
  document.getElementById('statCards').innerHTML = [
    [total, '词库总数'], [learned, '已掌握'], [learning, '学习中'],
    [fresh, '未学习'], [dueNow, '当前到期'], [daily.newCount, '今日新学']
  ].map(([n, l]) => `<div class="stat-card"><div class="num">${n}</div><div class="lbl">${l}</div></div>`).join('');

  const maxF = Math.max(1, ...forecast);
  const days = ['今天', '明天', '后天'];
  document.getElementById('forecast').innerHTML = forecast.map((n, i) => {
    const d = new Date(now + (i + 1) * DAY);
    const lbl = i < 3 ? days[i] : `${d.getMonth() + 1}/${d.getDate()}`;
    return `<div class="fc-col"><div class="fc-bar" style="height:${Math.round(n / maxF * 100)}%" title="${n} 张"></div><div class="fc-lbl">${lbl}<br>${n}</div></div>`;
  }).join('');

  const kinds = {};
  for (const c of CARDS) {
    kinds[c.kind] = kinds[c.kind] || { total: 0, learned: 0 };
    kinds[c.kind].total++;
    if (stateOf(c.id).st === 'review') kinds[c.kind].learned++;
  }
  const colors = { word: 'var(--easy)', phrase: 'var(--accent2)', slang: 'var(--accent)', sentence: 'var(--good)' };
  document.getElementById('kindBreakdown').innerHTML = Object.entries(kinds).map(([k, v]) => {
    const pct = Math.round(v.learned / v.total * 100);
    return `<div class="kb-row"><span>${kindLabel(k)} (${v.total})</span>
      <div class="kb-track"><div class="kb-fill" style="width:${pct}%;background:${colors[k] || 'var(--accent)'}"></div></div>
      <span class="pct">${v.learned} · ${pct}%</span></div>`;
  }).join('');
}

/* ================= 视图切换 ================= */
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + t.dataset.view));
  if (t.dataset.view === 'stats') renderStats();
  if (t.dataset.view === 'browse') renderBrowse(true);
}));

/* ================= 事件绑定 ================= */
document.getElementById('card').addEventListener('click', e => {
  if (e.target.closest('.audio-btn')) return;
  flip();
});
document.querySelectorAll('.face .audio-btn').forEach(b =>
  b.addEventListener('click', e => { e.stopPropagation(); if (current) speak(current.card); }));
document.getElementById('showAnswerBtn').addEventListener('click', flip);
document.querySelectorAll('.rate').forEach(b => b.addEventListener('click', () => rate(+b.dataset.r)));
document.getElementById('extraStudyBtn').addEventListener('click', () => {
  extraNew += 10; buildQueue(); advance();
});

document.getElementById('searchInput').addEventListener('input', e => {
  browseFilter.q = e.target.value; renderBrowse(true);
});
document.querySelectorAll('#kindChips .chip').forEach(ch => ch.addEventListener('click', () => {
  document.querySelectorAll('#kindChips .chip').forEach(x => x.classList.toggle('active', x === ch));
  browseFilter.kind = ch.dataset.kind; renderBrowse(true);
}));
document.getElementById('loadMoreBtn').addEventListener('click', () => renderBrowse(false));

document.querySelectorAll('.modal-close').forEach(b => b.addEventListener('click', closeModals));
document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => {
  if (e.target === m) closeModals();
}));

/* 设置 */
document.getElementById('settingsBtn').addEventListener('click', () => {
  document.getElementById('setNewPerDay').value = settings.newPerDay;
  document.getElementById('setAutoplay').checked = settings.autoplay;
  document.getElementById('settingsModal').classList.remove('hidden');
});
document.getElementById('saveSettingsBtn').addEventListener('click', () => {
  settings.newPerDay = Math.max(1, Math.min(200, +document.getElementById('setNewPerDay').value || 20));
  settings.autoplay = document.getElementById('setAutoplay').checked;
  saveAll(); closeModals(); buildQueue();
  if (!current) advance(); else updateSessionBar();
});

/* 进度导入导出 */
document.getElementById('exportBtn').addEventListener('click', async () => {
  const payload = JSON.stringify({ progress, daily, settings, exportedAt: Date.now() });
  // iPhone（PWA/Safari）：走系统分享面板，可直接存到“文件”/iCloud
  const file = new File([payload], 'bambi-vocab-progress.json', { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Bambi Vocab 进度备份' }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  // 桌面：直接下载
  const blob = new Blob([payload], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bambi-vocab-progress.json';
  a.click();
  URL.revokeObjectURL(a.href);
});
document.getElementById('importBtn').addEventListener('click', () => {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json';
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    f.text().then(t => {
      try {
        const d = JSON.parse(t);
        if (d.progress) progress = d.progress;
        if (d.daily) daily = d.daily;
        if (d.settings) settings = Object.assign(settings, d.settings);
        saveAll(); buildQueue(); renderStats(); advance();
        alert('进度导入成功');
      } catch { alert('文件格式不正确'); }
    });
  };
  inp.click();
});
document.getElementById('resetBtn').addEventListener('click', () => {
  if (!confirm('确定清空全部学习记录？此操作不可撤销。')) return;
  progress = {}; daily = { date: todayStr(), newCount: 0 }; extraNew = 0;
  saveAll(); buildQueue(); renderStats(); advance();
});

/* 键盘 */
document.addEventListener('keydown', e => {
  if (e.target instanceof Element && e.target.matches('input, textarea')) return;
  if (!document.getElementById('view-study').classList.contains('active')) return;
  if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); flipped ? rate(2) : flip(); }
  else if (flipped && ['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) {
    rate(+e.code.slice(-1) - 1);
  }
  else if (e.code === 'KeyL' && current) speak(current.card);
});

/* ================= 启动 ================= */
buildQueue();
advance();

/* ================= PWA：Service Worker 与离线音频 ================= */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

document.getElementById('cacheAllBtn').addEventListener('click', () => {
  const files = [...new Set(CARDS.filter(c => c.audio).map(c => c.audio))];
  const status = document.getElementById('cacheAllStatus');
  if (!files.length) { status.textContent = '当前词库没有音频文件'; return; }
  if (!('serviceWorker' in navigator)) { status.textContent = '当前环境不支持离线缓存'; return; }
  const btn = document.getElementById('cacheAllBtn');
  btn.disabled = true;
  status.textContent = '准备下载…';
  const chan = new MessageChannel();
  chan.port1.onmessage = e => {
    const d = e.data;
    if (d.finished) {
      status.textContent = `完成：${d.done}/${d.total} 条已可离线播放` + (d.failed ? `（${d.failed} 条失败）` : '');
      btn.disabled = false;
    } else {
      status.textContent = `下载中… ${d.done + d.failed}/${d.total}`;
    }
  };
  navigator.serviceWorker.ready.then(reg => {
    reg.active.postMessage({ type: 'CACHE_ALL_MEDIA', files }, [chan.port2]);
  }).catch(() => { status.textContent = 'Service Worker 未就绪，请稍后再试'; btn.disabled = false; });
});
