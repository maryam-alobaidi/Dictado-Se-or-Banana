import { Injectable, computed, inject, linkedSignal, signal } from '@angular/core';
import { CompareResult, compare } from './compare';
import { Confetti } from './confetti';
import { Lang, PUNCT, T } from './i18n';
import { Library, SavedDictation } from './library';
import { Ocr } from './ocr';
import { Speech, bestVoice, langTag } from './speech';
import { store } from './storage';

export type Mode = 'paper' | 'pc';
export type Screen = 'setup' | 'play' | 'result' | 'practice' | 'done';

export const SPEED_VALUES = [0.25, 0.4, 0.55, 0.75, 1];
export const FINISH_ICON = '🏁';

/** a correction shown on the result screen */
export interface Scored {
  r: CompareResult;
  message: string;
  prev: number | null;
}

// one greeting per language ('sb-msg' keeps the Spanish one saved by earlier versions)
const msgKey = (l: Lang) => (l === 'es' ? 'sb-msg' : 'sb-msg-ca');

export const splitSentences = (text: string) =>
  text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?…])\s+/u)
    .filter(Boolean);

const wordCount = (s: string) => s.split(' ').length;

/** All the app state and the dictation flow. Screens are thin views over this. */
@Injectable({ providedIn: 'root' })
export class DictationStore {
  private readonly speech = inject(Speech);
  private readonly library = inject(Library);
  private readonly ocr = inject(Ocr);
  private readonly confetti = inject(Confetti);

  readonly lang = signal<Lang>(store.get('sb-lang') === 'ca' ? 'ca' : 'es');
  readonly t = computed(() => T[this.lang()]);
  readonly screen = signal<Screen>('setup');
  readonly mode = signal<Mode>('pc');
  readonly rate = signal(0.4);
  readonly dark = signal(store.get('sb-theme') === 'dark');

  /* ---------- greeting ---------- */
  readonly name = signal(store.get('sb-name') || 'Haidar');
  readonly message = linkedSignal(() => store.get(msgKey(this.lang())) || T[this.lang()].defMsg);
  readonly childName = computed(() => this.name().trim() || this.t().friend);
  // a function replacement, so "$" in a name is not read as a replacement pattern
  readonly greeting = computed(() => this.message().replace(/\{(nombre|nom)\}/g, () => this.childName()));

  /* ---------- voices ---------- */
  readonly voices = computed(() => this.speech.voicesFor(this.lang()));
  // keeps the chosen voice while it exists for the language, otherwise picks the best one
  readonly voiceName = linkedSignal<SpeechSynthesisVoice[], string>({
    source: this.voices,
    computation: (voices, previous) =>
      previous && voices.some((v) => v.name === previous.value)
        ? previous.value
        : (bestVoice(voices, this.lang())?.name ?? ''),
  });

  /* ---------- dictation text and options ---------- */
  readonly text = signal('');
  readonly canStart = computed(() => splitSentences(this.text()).length > 0);
  readonly readPunct = signal(true);
  readonly shortChunks = signal(false);
  readonly showText = signal(false);
  readonly countPunct = signal(false);

  /* ---------- dictation in progress ---------- */
  readonly sentences = signal<string[]>([]);
  readonly idx = signal(0); // current sentence
  readonly playing = signal(false);
  private readonly statusMsg = signal<string | null>(null);
  readonly status = computed(() => this.statusMsg() ?? (this.playing() ? this.t().listening : this.t().paused));
  readonly finishLabel = computed(() => (this.mode() === 'pc' ? this.t().finishPc : this.t().finishPaper));
  readonly written = signal(''); // what the child types in "computer" mode

  /* ---------- correction ---------- */
  private cur: string | null = null; // library id of the dictation being done
  private runIdx = -1; // index of this attempt in its library runs (-1 = not scored yet)
  readonly result = signal<Scored | null>(null);

  /* ---------- settings ---------- */
  setLang(l: Lang): void {
    this.lang.set(l);
    store.set('sb-lang', l);
    this.ocr.dispose();
  }
  setName(v: string): void {
    this.name.set(v);
    store.set('sb-name', v);
  }
  setMessage(v: string): void {
    this.message.set(v);
    store.set(msgKey(this.lang()), v);
  }
  setRate(v: number): void {
    this.rate.set(v);
    if (this.playing()) this.play();
  }
  toggleTheme(): void {
    this.dark.update((d) => !d);
    store.set('sb-theme', this.dark() ? 'dark' : 'light');
  }

  /* ---------- speech ---------- */
  say(text: string, rate = this.rate()): Promise<void> {
    const voices = this.voices();
    const voice = voices.find((v) => v.name === this.voiceName()) ?? bestVoice(voices, this.lang());
    return this.speech.say(text, this.lang(), rate, voice);
  }
  halt(): void {
    this.speech.halt();
  }
  hearHello(): void {
    this.halt();
    this.say(this.greeting(), 0.9);
  }
  testVoice(): void {
    this.halt();
    this.say(this.t().testSay);
  }

  /* ---------- reading like a dictation ---------- */
  // cuts a sentence into short pieces at commas and every few words
  private chunks(sentence: string): string[] {
    const short = this.shortChunks();
    const size = short ? 2 : 5;
    const limit = short ? 2 : 7;
    const tail = short ? 1 : 2; // never leave fewer words than this alone at the end
    const out: string[] = [];
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

  private spoken(chunk: string): string {
    const marks = PUNCT[this.lang()];
    return chunk
      .replace(/[,.;:?¿!¡…"«»()]/g, (m) => ` ${marks[m] || ''}, `)
      .replace(/\s+/g, ' ')
      .trim();
  }

  // whole sentence, then piece by piece with time to write, then whole again; false if interrupted
  private async readSentence(sentence: string, runId: number): Promise<boolean> {
    const stillCurrent = () => this.speech.isCurrent(runId);
    const slow = Math.max(1, 0.8 / this.rate());
    await this.say(sentence);
    if (!stillCurrent()) return false;
    for (const chunk of this.chunks(sentence)) {
      await this.say(this.readPunct() ? this.spoken(chunk) : chunk);
      if (!stillCurrent()) return false;
      await this.speech.wait((1500 + wordCount(chunk) * 900) * slow);
      if (!stillCurrent()) return false;
    }
    await this.say(sentence);
    if (!stillCurrent()) return false;
    await this.speech.wait((1500 + wordCount(sentence) * 400) * slow);
    return stillCurrent();
  }

  async play(): Promise<void> {
    this.halt();
    const runId = this.speech.runId;
    this.playing.set(true);
    this.statusMsg.set(null);
    while (this.playing() && this.speech.isCurrent(runId)) {
      if (!(await this.readSentence(this.sentences()[this.idx()], runId))) return;
      if (this.idx() < this.sentences().length - 1) {
        this.idx.update((i) => i + 1);
        this.statusMsg.set(null);
      } else {
        this.playing.set(false);
        this.statusMsg.set(this.t().ended(this.finishLabel()));
      }
    }
  }
  pause(): void {
    this.halt();
    this.playing.set(false);
    this.statusMsg.set(null);
  }
  togglePlay(): void {
    if (this.playing()) this.pause();
    else this.play();
  }
  goTo(i: number, forcePlay = false): void {
    this.idx.set(Math.min(Math.max(i, 0), this.sentences().length - 1));
    this.statusMsg.set(null);
    if (this.playing() || forcePlay) this.play();
    else this.halt();
  }
  /** the slider moves without restarting the reading; it restarts when released */
  seek(i: number): void {
    this.idx.set(i);
    this.statusMsg.set(null);
  }
  seekDone(): void {
    if (this.playing()) this.play();
  }

  async start(): Promise<void> {
    const text = this.text();
    this.cur = this.library.save(text, this.lang());
    this.runIdx = -1;
    this.sentences.set(splitSentences(text));
    this.idx.set(0);
    this.playing.set(false);
    this.written.set('');
    this.result.set(null);
    this.screen.set('play');
    this.halt();
    const runId = this.speech.runId;
    this.statusMsg.set('💬 ' + this.greeting());
    await this.say(this.greeting(), 0.9);
    if (this.speech.isCurrent(runId)) this.play();
  }

  back(): void {
    this.pause();
    this.screen.set('setup');
  }

  newDictation(): void {
    this.halt();
    this.text.set('');
    this.screen.set('setup');
  }

  pickSaved(d: SavedDictation): void {
    this.text.set(d.text);
  }
  removeSaved(id: string): void {
    this.library.remove(id);
  }

  /* ---------- correction ---------- */
  finish(): void {
    this.halt();
    this.playing.set(false);
    if (this.mode() === 'pc') return this.correct(this.written());
    // paper: correct from a photo of the sheet, or count the mistakes by hand (result screen)
    this.result.set(null);
    this.screen.set('result');
  }

  /** full correction (used by "computer" mode and by the photo of a paper sheet) */
  correct(written: string): void {
    const r = compare(this.text(), written, this.countPunct());
    const message = this.celebrate(r.score);
    const prev = this.recordScore(r.score);
    this.result.set({ r, message, prev });
    this.screen.set('result');
  }

  // says the cheer message (and throws confetti for good grades); returns the message
  celebrate(score: number): string {
    const level = score >= 9.5 ? 0 : score >= 8 ? 1 : score >= 6 ? 2 : score >= 4 ? 3 : 4;
    const message = this.t().cheer[level](this.childName());
    this.halt();
    this.say(message, 0.9);
    if (score >= 8) this.confetti.throw();
    return message;
  }

  // stores this attempt's score (once per attempt; correcting again updates it) and returns the previous score
  recordScore(score: number): number | null {
    const saved = this.library.recordScore(this.cur, this.runIdx, score);
    if (!saved) return null;
    this.runIdx = saved.runIdx;
    return saved.prev;
  }

  fmt(n: number): string {
    return n.toLocaleString(langTag(this.lang()), { maximumFractionDigits: 1 });
  }

  progressText(prev: number | null, score: number): string | null {
    if (prev == null) return null;
    const x = this.t();
    const diff = Math.round((score - prev) * 10) / 10;
    return diff > 0
      ? x.better(this.fmt(prev), this.fmt(diff))
      : diff === 0
        ? x.same(this.fmt(prev))
        : x.lower(this.fmt(prev));
  }

  finishPractice(): void {
    this.screen.set('done');
    this.confetti.throw();
    this.halt();
    this.say(this.t().doneSay(this.childName()), 0.9);
  }
}
