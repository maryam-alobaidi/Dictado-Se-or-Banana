'use strict';
/* global T, PUNCT, SPECIAL_LETTERS, OP, norm, tok, compare, lowFirst, Tesseract */

/* ---------- helpers ---------- */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// localStorage can be blocked (private mode, school policies): never let that break the app
const store = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  },
};

const SPEED_VALUES = [0.25, 0.4, 0.55, 0.75, 1];
const FINISH_ICON = '🏁';
const PRACTICE_MAX_WORDS = 8;
const PRACTICE_REPS = 5; // the first 2 are copied, the rest from memory
const PRACTICE_COPY_REPS = 2;

/* ---------- state ---------- */
const S = {
  lang: store.get('sb-lang') === 'ca' ? 'ca' : 'es',
  mode: 'pc', // 'paper' | 'pc'
  rate: 0.4,
  sentences: [],
  idx: 0, // current sentence
  run: 0, // bumped by halt() to cancel any speech or wait in progress
  playing: false,
  timer: null,
  release: null,
  cur: null, // library id of the dictation being done
  runIdx: -1, // index of this attempt in its library runs (-1 = not scored yet)
  res: null, // last correction result
  words: [], // words to practise
  wordIdx: 0,
  repsDone: 0,
  showWord: false, // shows the word again after a mistake
};

const tr = () => T[S.lang];
const langTag = (l) => (l === 'es' ? 'es-ES' : 'ca-ES');

function showScreen(id) {
  ['setup', 'play', 'result', 'practice', 'done'].forEach((x) => ($('#s-' + x).hidden = x !== id));
  if (id === 'setup') paintLibrary();
  scrollTo(0, 0);
}

/* ---------- greeting ---------- */
// one greeting per language ('sb-msg' keeps the Spanish one saved by earlier versions)
const msgKey = () => (S.lang === 'es' ? 'sb-msg' : 'sb-msg-ca');
$('#nameIn').value = store.get('sb-name') || 'Haidar';
const childName = () => $('#nameIn').value.trim() || tr().friend;
// a function replacement, so "$" in a name is not read as a replacement pattern
const greeting = () => $('#msgIn').value.replace(/\{(nombre|nom)\}/g, () => childName());

function loadMsg() {
  $('#msgIn').value = store.get(msgKey()) || tr().defMsg;
}
function paintHello() {
  $('#helloH').textContent = tr().hi(childName());
  // the heading already says "Hola, name!", so the bubble shows the rest of the greeting
  $('#helloP').textContent = greeting().replace(/^¡?Hola,[^!]*!\s*/, '') || greeting();
}
$('#nameIn').oninput = () => {
  store.set('sb-name', $('#nameIn').value);
  paintHello();
};
$('#msgIn').oninput = () => {
  store.set(msgKey(), $('#msgIn').value);
  paintHello();
};
$('#hearHello').onclick = () => {
  halt();
  say(greeting(), S.lang, 0.9);
};

/* ---------- voices ---------- */
// some browsers can't read aloud at all: without this guard the whole script would stop here
const hasTTS = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
const voicesFor = (l) =>
  (hasTTS ? speechSynthesis.getVoices() : []).filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(l));
const bestVoice = (l) => {
  const voices = voicesFor(l);
  return (
    voices.find((v) => /natural|neural|online/i.test(v.name)) ||
    voices.find((v) => v.lang.replace('_', '-') === langTag(l)) ||
    voices[0]
  );
};

function loadVoices() {
  const voices = voicesFor(S.lang);
  const sel = $('#voice');
  const keep = sel.value;
  sel.innerHTML =
    voices.map((v) => `<option>${esc(v.name)}</option>`).join('') ||
    `<option value="">${esc(tr().defVoice)}</option>`;
  const pick = voices.some((v) => v.name === keep) ? keep : bestVoice(S.lang)?.name;
  if (pick) sel.value = pick;
  $('#noVoice').hidden = voices.length > 0;
}
if (hasTTS) speechSynthesis.addEventListener('voiceschanged', loadVoices);

function say(text, lang = S.lang, rate = S.rate) {
  return new Promise((resolve) => {
    if (!hasTTS) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = langTag(lang);
    u.rate = rate;
    u.pitch = 1.05;
    const voice =
      lang === S.lang ? voicesFor(lang).find((x) => x.name === $('#voice').value) || bestVoice(lang) : bestVoice(lang);
    if (voice) u.voice = voice;
    u.onend = u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

// a pause that halt() can cut short
const wait = (ms) =>
  new Promise((resolve) => {
    S.release = resolve;
    S.timer = setTimeout(() => {
      S.release = null;
      resolve();
    }, ms);
  });

// stops speech and pauses, and invalidates whatever was reading
function halt() {
  S.run++;
  if (hasTTS) speechSynthesis.cancel();
  clearTimeout(S.timer);
  if (S.release) {
    S.release();
    S.release = null;
  }
}
$('#testVoice').onclick = () => {
  halt();
  say(tr().testSay);
};

/* ---------- reading like a dictation ---------- */
const splitSentences = (text) =>
  text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?…])\s+/u)
    .filter(Boolean);

// cuts a sentence into short pieces at commas and every few words
function chunks(sentence) {
  const short = $('#short').checked;
  const size = short ? 2 : 5;
  const limit = short ? 2 : 7;
  const tail = short ? 1 : 2; // never leave fewer words than this alone at the end
  const out = [];
  for (const part of sentence.split(/(?<=[,;:])\s+/u)) {
    const words = part.split(' ');
    if (words.length <= limit) {
      out.push(part);
      continue;
    }
    for (let i = 0; i < words.length; ) {
      let end = Math.min(i + size, words.length);
      if (words.length - end <= tail) end = words.length;
      out.push(words.slice(i, end).join(' '));
      i = end;
    }
  }
  return out;
}

const spoken = (chunk) =>
  chunk
    .replace(/[,.;:?¿!¡…"«»()]/g, (m) => ` ${PUNCT[S.lang][m] || ''}, `)
    .replace(/\s+/g, ' ')
    .trim();
const wordCount = (s) => s.split(' ').length;

// whole sentence, then piece by piece with time to write, then whole again; false if interrupted
async function readSentence(sentence, runId) {
  const stillCurrent = () => runId === S.run;
  const slow = Math.max(1, 0.8 / S.rate);
  await say(sentence);
  if (!stillCurrent()) return false;
  for (const chunk of chunks(sentence)) {
    await say($('#punct').checked ? spoken(chunk) : chunk);
    if (!stillCurrent()) return false;
    await wait((1500 + wordCount(chunk) * 900) * slow);
    if (!stillCurrent()) return false;
  }
  await say(sentence);
  if (!stillCurrent()) return false;
  await wait((1500 + wordCount(sentence) * 400) * slow);
  return stillCurrent();
}

const finishLabel = () => (S.mode === 'pc' ? tr().finishPc : tr().finishPaper);

async function play() {
  halt();
  const runId = S.run;
  S.playing = true;
  ui();
  while (S.playing && runId === S.run) {
    if (!(await readSentence(S.sentences[S.idx], runId))) return;
    if (S.idx < S.sentences.length - 1) {
      S.idx++;
      ui();
    } else {
      S.playing = false;
      ui(tr().ended(finishLabel()));
    }
  }
}
function pause() {
  halt();
  S.playing = false;
  ui();
}
function goTo(i, forcePlay) {
  S.idx = Math.min(Math.max(i, 0), S.sentences.length - 1);
  if (S.playing || forcePlay) play();
  else {
    halt();
    ui();
  }
}

function ui(msg) {
  const n = S.sentences.length;
  $('#counter').innerHTML = tr().sentence(S.idx + 1, n);
  $('#status').textContent = msg || (S.playing ? tr().listening : tr().paused);
  $('#seek').max = n - 1;
  $('#seek').value = S.idx;
  $('#fill').style.width = ((S.idx + 1) / n) * 100 + '%';
  $('#play').textContent = S.playing ? tr().pause : tr().play;
  $('#prev').disabled = S.idx === 0;
  $('#next').disabled = S.idx >= n - 1;
  const box = $('#sentence');
  box.hidden = !$('#showText').checked;
  box.textContent = S.sentences[S.idx] || '';
}

/* ---------- option buttons ---------- */
// marks the chosen button of a group, visibly (.on) and for screen readers (aria-pressed)
function markSelected(groupId, value) {
  $$(groupId + ' button').forEach((b) => {
    const on = b.dataset.v === String(value);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}
function optionGroup(groupId, items, current, onPick) {
  const el = $(groupId);
  el.innerHTML = items.map(([label, v]) => `<button type="button" data-v="${esc(v)}">${label}</button>`).join('');
  markSelected(groupId, current);
  el.onclick = (e) => {
    const b = e.target.closest('button');
    if (b) onPick(b.dataset.v);
  };
}

function paintSpeed() {
  markSelected('#speedSeg', S.rate);
  markSelected('#speedSeg2', S.rate);
}
function setRate(v) {
  S.rate = +v;
  paintSpeed();
  if (S.playing) play();
}
function setMode(v) {
  S.mode = v;
  markSelected('#modeSeg', v);
  paintMode();
}
function setLang(v) {
  S.lang = v;
  store.set('sb-lang', v);
  markSelected('#langSeg', v);
  disposeOcrWorkers();
  applyTexts();
}

// speed and mode buttons have translated labels, so they are rebuilt on every language change
function paintOptionGroups() {
  const speeds = tr().speeds.map((label, i) => [label, SPEED_VALUES[i]]);
  optionGroup('#speedSeg', speeds, S.rate, setRate);
  optionGroup('#speedSeg2', speeds, S.rate, setRate);
  optionGroup('#modeSeg', [[tr().paper, 'paper'], [tr().pc, 'pc']], S.mode, setMode);
}
optionGroup('#langSeg', [['🇪🇸 Español', 'es'], ['🟡 Català', 'ca']], S.lang, setLang);

/* ---------- light / dark theme (light by default) ---------- */
const isDark = () => document.documentElement.dataset.theme === 'dark';
function paintTheme() {
  const btn = $('#themeBtn');
  const label = isDark() ? tr().themeLight : tr().themeDark;
  btn.textContent = isDark() ? '☀️' : '🌙';
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.setAttribute('aria-pressed', String(isDark()));
}
$('#themeBtn').addEventListener('click', () => {
  if (isDark()) delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = 'dark';
  store.set('sb-theme', isDark() ? 'dark' : 'light');
  paintTheme();
});

function paintMode() {
  $('#modeHelp').textContent = S.mode === 'paper' ? tr().paperHelp : tr().pcHelp;
}

function applyTexts() {
  const x = tr();
  document.documentElement.lang = S.lang;
  document.title = x.app;
  $$('[data-t]').forEach((el) => (el.textContent = x[el.dataset.t]));
  $$('[data-tp]').forEach((el) => (el.placeholder = x[el.dataset.tp]));
  $$('[data-ta]').forEach((el) => el.setAttribute('aria-label', x[el.dataset.ta]));
  paintTheme();
  paintOptionGroups();
  paintMode();
  loadMsg();
  paintHello();
  paintSpecialLetters();
  loadVoices();
  paintLibrary();
  $('#ocrStatus').textContent = $('#sheetStatus').textContent = x.photoSafe;
}

/* ---------- special letters ---------- */
function insertAt(field, text) {
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? field.value.length;
  field.setRangeText(text, start, end, 'end');
  field.dispatchEvent(new Event('input'));
  field.focus();
}
function paintSpecialLetters() {
  [
    ['#spW', '#written'],
    ['#spP', '#pin'],
  ].forEach(([groupId, fieldId]) => {
    const group = $(groupId);
    group.innerHTML = SPECIAL_LETTERS[S.lang].map((l) => `<button type="button">${l}</button>`).join('');
    group.onclick = (e) => {
      const b = e.target.closest('button');
      if (b) insertAt($(fieldId), b.textContent);
    };
  });
  $('#spHelp').textContent = tr().how;
}

function updateStartBtn() {
  $('#startBtn').disabled = !splitSentences($('#text').value).length;
}
$('#text').oninput = updateStartBtn;

/* ---------- saved dictations: kept on this device, with their scores ---------- */
// sb-dictados = [{id, lang, text, created, runs:[{d: ISO date, s: score 0-10}]}], most recently used first
const LIB = 'sb-dictados';
const LIB_MAX = 30;
const RUNS_MAX = 50;
const SPARK_N = 10;
const lib = {
  all() {
    try {
      return JSON.parse(store.get(LIB)) || [];
    } catch {
      return [];
    }
  },
  save(list) {
    store.set(LIB, JSON.stringify(list));
  },
};
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const fmt = (n) => n.toLocaleString(langTag(S.lang), { maximumFractionDigits: 1 });
const titleOf = (s) => {
  const w = squash(s).split(' ');
  return w.slice(0, 6).join(' ') + (w.length > 6 ? '…' : '');
};

// saves the dictation (or moves it to the top if it is already saved) and returns its id
function saveDictation(text) {
  const list = lib.all();
  let d = list.find((x) => x.lang === S.lang && squash(x.text) === squash(text));
  if (d) list.splice(list.indexOf(d), 1);
  else d = { id: Date.now().toString(36), lang: S.lang, text: text.trim(), created: new Date().toISOString(), runs: [] };
  list.unshift(d);
  list.length = Math.min(list.length, LIB_MAX);
  lib.save(list);
  return d.id;
}

// stores this attempt's score (once per attempt; correcting again updates it) and returns the previous score
function recordScore(score) {
  const list = lib.all();
  const d = list.find((x) => x.id === S.cur);
  if (!d) return null;
  if (S.runIdx < 0) {
    d.runs.push({ d: new Date().toISOString(), s: score });
    S.runIdx = d.runs.length - 1;
  } else d.runs[S.runIdx].s = score;
  if (d.runs.length > RUNS_MAX) {
    d.runs.shift();
    S.runIdx--;
  }
  lib.save(list);
  return S.runIdx > 0 ? d.runs[S.runIdx - 1].s : null;
}

function progressLine(prev, score) {
  if (prev == null) return '';
  const x = tr();
  const diff = Math.round((score - prev) * 10) / 10;
  const text = diff > 0 ? x.better(fmt(prev), fmt(diff)) : diff === 0 ? x.same(fmt(prev)) : x.lower(fmt(prev));
  return `<p class="progress">${text}</p>`;
}

// small line chart of the last scores (0-10, one series); the scores are also written out as text next to it
function spark(runs) {
  const r = runs.slice(-SPARK_N);
  if (r.length < 2) return '';
  const W = 120;
  const H = 40;
  const P = 6;
  const X = (i) => P + (i * (W - 2 * P)) / (r.length - 1);
  const Y = (s) => H - P - (s / 10) * (H - 2 * P);
  const points = r.map((x, i) => `${X(i).toFixed(1)},${Y(x.s).toFixed(1)}`).join(' ');
  const day = (d) => new Date(d).toLocaleDateString(langTag(S.lang), { day: 'numeric', month: 'short' });
  const dots = r
    .map(
      (x, i) =>
        `<circle cx="${X(i).toFixed(1)}" cy="${Y(x.s).toFixed(1)}" r="4"><title>${esc(day(x.d))}: ${fmt(x.s)}</title></circle>`,
    )
    .join('');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
    <line x1="${P}" x2="${W - P}" y1="${Y(0)}" y2="${Y(0)}" class="base"/><polyline points="${points}"/>${dots}</svg>`;
}

function libraryItem(d, currentText) {
  const x = tr();
  const n = d.runs.length;
  const title = titleOf(d.text);
  const scores = d.runs
    .slice(-5)
    .map((r) => fmt(r.s))
    .join(' → ');
  const meta = n ? x.libMeta(n, fmt(d.runs[n - 1].s)) : x.libNone;
  const delLabel = esc(x.libDel(title));
  return `<li>
    <button type="button" class="libItem${squash(d.text) === currentText ? ' on' : ''}" data-id="${esc(d.id)}">
      <span class="libTitle">${esc(title)}</span>
      <span class="libMeta">${meta}</span>
      ${n > 1 ? `<span class="libMeta">${x.libScores(scores)}</span>` : ''}
      ${spark(d.runs)}
    </button>
    <button type="button" class="libDel" data-del="${esc(d.id)}" aria-label="${delLabel}" title="${delLabel}">🗑️</button>
  </li>`;
}

function paintLibrary() {
  const list = lib.all().filter((d) => d.lang === S.lang);
  const currentText = squash($('#text').value);
  $('#libBox').hidden = !list.length;
  $('#libList').innerHTML = list.map((d) => libraryItem(d, currentText)).join('');
}

$('#libList').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const list = lib.all();
  if (b.dataset.del) {
    const d = list.find((x) => x.id === b.dataset.del);
    if (d && confirm(tr().delAsk(titleOf(d.text)))) {
      lib.save(list.filter((x) => x !== d));
      paintLibrary();
    }
    return;
  }
  const d = list.find((x) => x.id === b.dataset.id);
  if (!d) return;
  $('#text').value = d.text;
  updateStartBtn();
  paintLibrary();
  $('#startBtn').focus();
};

/* ---------- dictation screen ---------- */
$('#startBtn').onclick = async () => {
  const text = $('#text').value;
  S.cur = saveDictation(text);
  S.runIdx = -1;
  S.sentences = splitSentences(text);
  S.idx = 0;
  S.playing = false;
  $('#written').value = '';
  $('#writeCard').hidden = S.mode !== 'pc';
  $('#finish').textContent = `${FINISH_ICON} ${finishLabel()}`;
  showScreen('play');
  halt();
  const runId = S.run;
  ui('💬 ' + greeting());
  await say(greeting(), S.lang, 0.9);
  if (runId === S.run) play();
};

function newDictation() {
  halt();
  $('#text').value = '';
  updateStartBtn();
  showScreen('setup');
}

$('#back').onclick = () => {
  pause();
  showScreen('setup');
};
$('#play').onclick = () => (S.playing ? pause() : play());
$('#prev').onclick = () => goTo(S.idx - 1);
$('#next').onclick = () => goTo(S.idx + 1);
$('#again').onclick = () => goTo(S.idx, true);
$('#seek').oninput = (e) => {
  S.idx = +e.target.value;
  ui();
};
$('#seek').onchange = () => {
  if (S.playing) play();
};
$('#showText').onchange = () => ui();
$('#again2').onclick = newDictation;

/* ---------- correction ---------- */
function stars(score) {
  const full = Math.round(score / 2);
  return `<div class="stars" aria-label="${esc(tr().stars(full))}">${'★'.repeat(full)}<span class="off">${'★'.repeat(5 - full)}</span></div>`;
}
const cheer = (score) => {
  const level = score >= 9.5 ? 0 : score >= 8 ? 1 : score >= 6 ? 2 : score >= 4 ? 3 : 4;
  return tr().cheer[level](childName());
};
// says the cheer message (and throws confetti for good grades); returns the message
function celebrate(score) {
  const message = cheer(score);
  halt();
  say(message, S.lang, 0.9);
  if (score >= 8) confetti();
  return message;
}

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div');
  box.className = 'confetti';
  box.setAttribute('aria-hidden', 'true');
  const emoji = ['🎉', '⭐', '🧡', '💚', '💜', '✨'];
  for (let i = 0; i < 36; i++) {
    const s = document.createElement('span');
    s.textContent = emoji[i % emoji.length];
    s.style.left = Math.random() * 100 + '%';
    s.style.animationDelay = Math.random() * 1.2 + 's';
    s.style.fontSize = 1 + Math.random() * 1.2 + 'rem';
    box.append(s);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 4800);
}

function markedWord(it) {
  switch (it.op) {
    case OP.OK:
      return `<span>${esc(it.expected)}</span>`;
    case OP.WRONG:
      return `<span class="w"><s>${esc(it.written)}</s> <b>${esc(it.expected)}</b></span>`;
    case OP.ACCENT:
      return `<span class="w a"><s>${esc(it.written)}</s> <b>${esc(it.expected)}</b></span>`;
    case OP.MISSING:
      return `<span class="m">${esc(it.expected)}</span>`;
    default: // OP.EXTRA
      return `<s class="x">${esc(it.written)}</s>`;
  }
}

// full correction (used by "computer" mode and by the photo of a paper sheet)
function showCorrection(r) {
  const x = tr();
  const message = celebrate(r.score);
  const prev = recordScore(r.score);
  S.res = r;
  $('#sheetBox').hidden = true;
  const next = r.wrong.length
    ? `<button type="button" class="btn hot" id="goPractice">${x.practice}</button>`
    : `<p class="msg ok">${x.noErr}</p>`;
  $('#resBox').innerHTML = `<h2>${x.correct}</h2>${stars(r.score)}
    <p class="msg">${esc(message)}</p>${progressLine(prev, r.score)}
    <div class="stats">
      <div class="a"><b>${fmt(r.score)}</b><span>${x.grade}</span></div>
      <div class="b"><b>${r.ok}</b><span>${x.good}</span></div>
      <div class="c"><b>${fmt(r.errors)}</b><span>${x.bad}</span></div>
    </div>
    <p class="marked">${r.items.map(markedWord).join('')}</p>
    <p class="muted">${x.legend}</p>
    <div class="row">${next}<button type="button" class="btn violet" id="newOne">${x.another}</button></div>`;
  $('#goPractice')?.addEventListener('click', startPractice);
  $('#newOne').onclick = newDictation;
  showScreen('result');
}

// paper mode, counting the mistakes by hand
function showManualCount(text) {
  const x = tr();
  $('#resBox').innerHTML = `<h2>${x.orCount}</h2><p class="muted">${x.compareP}</p><p class="model">${esc(text)}</p>
    <div class="row">
      <label for="errN"><b>${x.myErr}</b></label>
      <input type="number" id="errN" min="0" step="1" value="0">
      <button type="button" class="btn go" id="seeNote">${x.seeNote}</button>
    </div>
    <div id="noteOut"></div>
    <div class="row"><button type="button" class="btn violet" id="newOne">${x.another}</button></div>`;
  $('#seeNote').onclick = () => {
    const total = Math.max(1, tok(text, false).length);
    // the field accepts anything typed (-3, 2.5, 999): keep a whole number between 0 and the word count
    const errors = Math.min(Math.max(Math.round(+$('#errN').value || 0), 0), total);
    $('#errN').value = errors;
    const score = Math.round(((total - errors) / total) * 100) / 10;
    const message = celebrate(score);
    const prev = recordScore(score);
    $('#noteOut').innerHTML = `${stars(score)}<p class="msg">${esc(message)}</p>${progressLine(prev, score)}
      <p class="muted">${x.note(fmt(score))}</p>`;
  };
  $('#newOne').onclick = newDictation;
}

$('#finish').onclick = () => {
  halt();
  S.playing = false;
  const text = $('#text').value;
  if (S.mode === 'pc') return showCorrection(compare(text, $('#written').value, $('#countPunct').checked));
  // paper: correct from a photo of the sheet (#sheetBox), or count the mistakes by hand (#resBox)
  $('#sheetBox').hidden = false;
  $('#sheetReview').hidden = true;
  $('#sheetText').value = '';
  $('#sheetErr').hidden = true;
  $('#sheetEmpty').hidden = true;
  showManualCount(text);
  showScreen('result');
};

$('#sheetFileBtn').onclick = () => $('#sheetFile').click();
$('#sheetCheck').onclick = () => {
  const written = $('#sheetText').value;
  $('#sheetEmpty').hidden = !!written.trim();
  if (written.trim()) showCorrection(compare($('#text').value, written, $('#countPunct').checked));
};

/* ---------- word practice ---------- */
function startPractice() {
  S.words = S.res.wrong.slice(0, PRACTICE_MAX_WORDS);
  S.wordIdx = 0;
  S.repsDone = 0;
  S.showWord = false;
  $('#pin').value = '';
  showScreen('practice');
  paintPractice();
  hearWord();
}
const hearWord = () => {
  halt();
  say(S.words[S.wordIdx], S.lang, Math.max(0.5, S.rate));
};

function paintPractice() {
  const word = S.words[S.wordIdx];
  const visible = S.repsDone < PRACTICE_COPY_REPS || S.showWord;
  $('#pcount').innerHTML = tr().wordN(S.wordIdx + 1, S.words.length);
  $('#phelp').textContent = tr().phelp(PRACTICE_REPS);
  $('#pword').textContent = visible ? word : '· · ·';
  $('#pdots').innerHTML = Array.from(
    { length: PRACTICE_REPS },
    (_, i) => `<i class="${i < S.repsDone ? 'f' : ''}"></i>`,
  ).join('');
  const done = S.wordIdx * PRACTICE_REPS + S.repsDone;
  $('#pfill').style.width = Math.round((done / (S.words.length * PRACTICE_REPS)) * 100) + '%';
  $('#pwarn').hidden = !S.showWord;
}

function checkWord() {
  const word = S.words[S.wordIdx];
  const typed = norm($('#pin').value);
  const target = norm(word);
  const right = typed === target || (S.res.starts.has(word) && typed === lowFirst(target));
  $('#pin').value = '';
  if (!right) {
    S.showWord = true;
    paintPractice();
    const warn = $('#pwarn');
    warn.classList.remove('shake');
    void warn.offsetWidth; // restarts the shake animation
    warn.classList.add('shake');
    return;
  }
  S.showWord = false;
  if (S.repsDone + 1 < PRACTICE_REPS) S.repsDone++;
  else {
    S.repsDone = 0;
    if (S.wordIdx + 1 >= S.words.length) return finishPractice();
    S.wordIdx++;
  }
  paintPractice();
  hearWord();
}
function finishPractice() {
  $('#doneH').textContent = tr().doneH(childName());
  showScreen('done');
  confetti();
  halt();
  say(tr().doneSay(childName()), S.lang, 0.9);
}
$('#pcheck').onclick = checkWord;
$('#pin').onkeydown = (e) => {
  if (e.key === 'Enter') checkWord();
};
$('#phear').onclick = hearWord;

/* ---------- photo -> text (in the browser; the photo is not stored) ---------- */
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const TESSERACT_SRI = 'sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F';
let tesseractLoading = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve();
  tesseractLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_URL;
    s.integrity = TESSERACT_SRI;
    s.crossOrigin = 'anonymous';
    s.onload = resolve;
    s.onerror = () => {
      s.remove();
      tesseractLoading = null; // allow a retry, e.g. once back online
      reject(new Error('tesseract.js failed to load'));
    };
    document.head.append(s);
  });
  return tesseractLoading;
}

// Workers are slow to start (they load the language data), so they are kept between photos:
// one for printed text and one for handwriting, for the current language.
const ocrWorkers = new Map();
let ocrProgress = () => {};
function ocrWorker(handwriting) {
  const key = `${S.lang}|${handwriting}`;
  if (!ocrWorkers.has(key)) {
    const worker = Tesseract.createWorker(
      S.lang === 'es' ? 'spa' : 'cat',
      1,
      {
        logger: (m) => {
          if (m.status === 'recognizing text') ocrProgress(Math.round(m.progress * 100));
        },
      },
      // for a handwritten sheet the dictionary is switched off, otherwise Tesseract
      // "fixes" the child's misspellings into real words and hides the mistakes
      handwriting ? { load_system_dawg: '0', load_freq_dawg: '0' } : {},
    );
    worker.catch(() => ocrWorkers.delete(key));
    ocrWorkers.set(key, worker);
  }
  return { key, worker: ocrWorkers.get(key) };
}
function disposeOcrWorkers() {
  for (const worker of ocrWorkers.values()) worker.then((w) => w.terminate()).catch(() => {});
  ocrWorkers.clear();
}
addEventListener('pagehide', disposeOcrWorkers);

// scales the photo down and makes it grey and contrasted, which Tesseract reads better
async function photoToCanvas(file) {
  const bmp = await createImageBitmap(file);
  try {
    const k = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    const g = canvas.getContext('2d');
    g.filter = 'grayscale(1) contrast(1.3)';
    g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bmp.close(); // a phone photo holds tens of MB until released
  }
}

const cleanOcrText = (text) =>
  text
    .replace(/-\n(?=\p{Ll})/gu, '') // words split with a hyphen at the end of a line
    .replace(/\n{2,}/g, '\n\n')
    .replace(/(?<!\n)\n(?!\n)/g, ' ') // single line breaks are just the width of the sheet
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

// reads a photo into text; onProgress gets 0..100
async function ocr(file, onProgress, handwriting) {
  await loadTesseract();
  const canvas = await photoToCanvas(file);
  const { key, worker } = ocrWorker(handwriting);
  const w = await worker;
  ocrProgress = onProgress;
  try {
    const { data } = await w.recognize(canvas);
    return cleanOcrText(data.text);
  } catch (e) {
    // a worker that failed may be broken: start a fresh one next time
    if (ocrWorkers.get(key) === worker) {
      ocrWorkers.delete(key);
      w.terminate().catch(() => {});
    }
    throw e;
  } finally {
    ocrProgress = () => {};
  }
}

// runs OCR with the status line, error box and buttons of one card
async function readPhotoInto({ statusId, errorId, buttonIds, handwriting }, file) {
  const status = $(statusId);
  const error = $(errorId);
  const buttons = buttonIds.map($);
  error.hidden = true;
  buttons.forEach((b) => (b.disabled = true));
  status.textContent = tr().preparing;
  try {
    return await ocr(file, (p) => (status.textContent = tr().reading(p)), handwriting);
  } catch {
    error.textContent = tr().photoErr;
    error.hidden = false;
    return null;
  } finally {
    buttons.forEach((b) => (b.disabled = false));
    status.textContent = tr().photoSafe;
  }
}

async function readTextPhoto(file) {
  const text = await readPhotoInto(
    { statusId: '#ocrStatus', errorId: '#err', buttonIds: ['#photoBtn', '#camBtn'], handwriting: false },
    file,
  );
  if (text == null) return;
  $('#text').value = text;
  updateStartBtn();
}

/* ---------- camera ---------- */
// Phones and tablets open their own camera from <input capture>. Computers ignore "capture" and only show a
// file picker, so there the app opens the webcam itself in a small window.
const canUseWebcam = () => !!navigator.mediaDevices?.getUserMedia && !matchMedia('(pointer: coarse)').matches;
let camStream = null;
function stopCam() {
  camStream?.getTracks().forEach((track) => track.stop());
  camStream = null;
}

// starts the webcam inside the open window; shows a message in the window if it can't
async function startWebcam(dialog, video, shotBtn, msg) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    if (!dialog.open) {
      // the window was closed while the browser was asking for permission
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    camStream = stream;
    video.srcObject = stream;
    await video.play();
    shotBtn.disabled = false;
    shotBtn.focus();
  } catch {
    if (!dialog.open) return;
    msg.textContent = tr().camErr;
    msg.hidden = false;
  }
}

// resolves with the photo as a File, or null if the window was closed
function webcamPhoto() {
  const dialog = $('#camDlg');
  const video = $('#camVideo');
  const msg = $('#camMsg');
  const shotBtn = $('#camShot');
  msg.hidden = true;
  shotBtn.disabled = true;

  const photo = new Promise((resolve) => {
    const done = (file) => {
      stopCam();
      video.srcObject = null;
      if (dialog.open) dialog.close();
      resolve(file);
    };
    $('#camCancel').onclick = () => done(null);
    dialog.oncancel = (e) => {
      e.preventDefault();
      done(null);
    };
    shotBtn.onclick = () => {
      const c = document.createElement('canvas');
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      c.toBlob((b) => done(b ? new File([b], 'foto.jpg', { type: 'image/jpeg' }) : null), 'image/jpeg', 0.92);
    };
  });

  dialog.showModal();
  startWebcam(dialog, video, shotBtn, msg);
  return photo;
}

// a hidden <input type=file>: onPhoto gets the chosen File
function fileInput(inputId, onPhoto) {
  $(inputId).onchange = (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // so choosing the same photo again still fires "change"
    if (file) onPhoto(file);
  };
}
// a camera button: the webcam window on computers, the phone's camera app (<input capture>) elsewhere
function cameraButton(btnId, inputId, onPhoto) {
  fileInput(inputId, onPhoto);
  $(btnId).onclick = async () => {
    if (!canUseWebcam()) return $(inputId).click();
    const file = await webcamPhoto();
    if (file) onPhoto(file);
  };
}

$('#photoBtn').onclick = () => $('#file').click();
cameraButton('#camBtn', '#cam', readTextPhoto);
fileInput('#file', readTextPhoto);

/* ---------- paper dictation: correct it with a photo of the sheet ---------- */
async function readSheetPhoto(file) {
  const text = await readPhotoInto(
    {
      statusId: '#sheetStatus',
      errorId: '#sheetErr',
      buttonIds: ['#sheetCamBtn', '#sheetFileBtn'],
      handwriting: true,
    },
    file,
  );
  if (text == null) return;
  $('#sheetText').value = text;
  $('#sheetReview').hidden = false;
  $('#sheetText').focus();
}
cameraButton('#sheetCamBtn', '#sheetCam', readSheetPhoto);
fileInput('#sheetFile', readSheetPhoto);

/* ---------- start ---------- */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
applyTexts();
