import { Injectable, signal } from '@angular/core';
import { Lang } from './i18n';

export const langTag = (l: Lang) => (l === 'es' ? 'es-ES' : 'ca-ES');

// prefers natural/neural voices, then one for the exact region, then any
export function bestVoice(voices: SpeechSynthesisVoice[], lang: Lang): SpeechSynthesisVoice | undefined {
  return (
    voices.find((v) => /natural|neural|online/i.test(v.name)) ||
    voices.find((v) => v.lang.replace('_', '-') === langTag(lang)) ||
    voices[0]
  );
}

/** Text-to-speech, plus pauses that can be cut short. halt() cancels whatever is reading. */
@Injectable({ providedIn: 'root' })
export class Speech {
  // some browsers can't read aloud at all
  readonly supported = typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
  private readonly allVoices = signal<SpeechSynthesisVoice[]>([]);

  private run = 0; // bumped by halt() to cancel any speech or wait in progress
  private timer?: ReturnType<typeof setTimeout>;
  private release: (() => void) | null = null;

  constructor() {
    if (!this.supported) return;
    const load = () => this.allVoices.set(speechSynthesis.getVoices());
    load();
    speechSynthesis.addEventListener('voiceschanged', load);
  }

  voicesFor(lang: Lang): SpeechSynthesisVoice[] {
    return this.allVoices().filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(lang));
  }

  /** id of the current run: compare later with isCurrent() to know if halt() was called since */
  get runId(): number {
    return this.run;
  }
  isCurrent(id: number): boolean {
    return id === this.run;
  }

  say(text: string, lang: Lang, rate: number, voice?: SpeechSynthesisVoice): Promise<void> {
    return new Promise((resolve) => {
      if (!this.supported) return resolve();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = langTag(lang);
      u.rate = rate;
      u.pitch = 1.05;
      if (voice) u.voice = voice;
      u.onend = u.onerror = () => resolve();
      speechSynthesis.speak(u);
    });
  }

  // a pause that halt() can cut short
  wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.release = resolve;
      this.timer = setTimeout(() => {
        this.release = null;
        resolve();
      }, ms);
    });
  }

  // stops speech and pauses, and invalidates whatever was reading
  halt(): void {
    this.run++;
    if (this.supported) speechSynthesis.cancel();
    clearTimeout(this.timer);
    if (this.release) {
      this.release();
      this.release = null;
    }
  }
}
