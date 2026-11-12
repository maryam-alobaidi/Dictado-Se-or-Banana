import { Injectable, signal } from '@angular/core';
import { Lang } from './i18n';
import { store } from './storage';

/* Saved dictations: kept on this device, with their scores.
   sb-dictados = [{id, lang, text, created, runs:[{d: ISO date, s: score 0-10}]}], most recently used first */
export interface Run {
  d: string;
  s: number;
}
export interface SavedDictation {
  id: string;
  lang: Lang;
  text: string;
  created: string;
  runs: Run[];
}

const LIB = 'sb-dictados';
const LIB_MAX = 30;
const RUNS_MAX = 50;

export const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
export const titleOf = (s: string) => {
  const w = squash(s).split(' ');
  return w.slice(0, 6).join(' ') + (w.length > 6 ? '…' : '');
};

function load(): SavedDictation[] {
  try {
    const list = JSON.parse(store.get(LIB) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

@Injectable({ providedIn: 'root' })
export class Library {
  readonly items = signal<SavedDictation[]>(load());

  private commit(list: SavedDictation[]): void {
    this.items.set(list);
    store.set(LIB, JSON.stringify(list));
  }

  /** saves the dictation (or moves it to the top if it is already saved) and returns its id */
  save(text: string, lang: Lang): string {
    const list = structuredClone(this.items());
    let d = list.find((x) => x.lang === lang && squash(x.text) === squash(text));
    if (d) list.splice(list.indexOf(d), 1);
    else d = { id: Date.now().toString(36), lang, text: text.trim(), created: new Date().toISOString(), runs: [] };
    list.unshift(d);
    list.length = Math.min(list.length, LIB_MAX);
    this.commit(list);
    return d.id;
  }

  /**
   * Stores an attempt's score. runIdx -1 adds a new run; otherwise that run is updated (correcting again).
   * Returns the run's index and the previous score, or null if the dictation is gone.
   */
  recordScore(id: string | null, runIdx: number, score: number): { runIdx: number; prev: number | null } | null {
    const list = structuredClone(this.items());
    const d = list.find((x) => x.id === id);
    if (!d) return null;
    if (runIdx < 0) {
      d.runs.push({ d: new Date().toISOString(), s: score });
      runIdx = d.runs.length - 1;
    } else d.runs[runIdx].s = score;
    if (d.runs.length > RUNS_MAX) {
      d.runs.shift();
      runIdx--;
    }
    this.commit(list);
    return { runIdx, prev: runIdx > 0 ? d.runs[runIdx - 1].s : null };
  }

  remove(id: string): void {
    this.commit(this.items().filter((x) => x.id !== id));
  }
}
