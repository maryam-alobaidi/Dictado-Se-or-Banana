import { Injectable, computed, inject, signal } from '@angular/core';
import { Lang, Texts } from './i18n';

/* Photo -> text, in the browser with tesseract.js (the photo is not stored). */

interface TesseractWorker {
  recognize(image: HTMLCanvasElement): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
}
interface TesseractLib {
  createWorker(
    langs: string,
    oem: number,
    options: { logger: (m: { status: string; progress: number }) => void },
    config: Record<string, string>,
  ): Promise<TesseractWorker>;
}
declare global {
  interface Window {
    Tesseract?: TesseractLib;
  }
}

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const TESSERACT_SRI = 'sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F';

// scales the photo down and makes it grey and contrasted, which Tesseract reads better
async function photoToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file);
  try {
    const k = Math.min(1, 2200 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    const g = canvas.getContext('2d')!;
    g.filter = 'grayscale(1) contrast(1.3)';
    g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bmp.close(); // a phone photo holds tens of MB until released
  }
}

const cleanOcrText = (text: string) =>
  text
    .replace(/-\n(?=\p{Ll})/gu, '') // words split with a hyphen at the end of a line
    .replace(/\n{2,}/g, '\n\n')
    .replace(/(?<!\n)\n(?!\n)/g, ' ') // single line breaks are just the width of the sheet
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

@Injectable({ providedIn: 'root' })
export class Ocr {
  private loading: Promise<void> | null = null;
  // Workers are slow to start (they load the language data), so they are kept between photos:
  // one for printed text and one for handwriting, for the current language.
  private readonly workers = new Map<string, Promise<TesseractWorker>>();
  private onProgress: (p: number) => void = () => {};

  constructor() {
    addEventListener('pagehide', () => this.dispose());
  }

  private load(): Promise<void> {
    if (window.Tesseract) return Promise.resolve();
    this.loading ??= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = TESSERACT_URL;
      s.integrity = TESSERACT_SRI;
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve();
      s.onerror = () => {
        s.remove();
        this.loading = null; // allow a retry, e.g. once back online
        reject(new Error('tesseract.js failed to load'));
      };
      document.head.append(s);
    });
    return this.loading;
  }

  private worker(lang: Lang, handwriting: boolean) {
    const key = `${lang}|${handwriting}`;
    if (!this.workers.has(key)) {
      const worker = window.Tesseract!.createWorker(
        lang === 'es' ? 'spa' : 'cat',
        1,
        {
          logger: (m) => {
            if (m.status === 'recognizing text') this.onProgress(Math.round(m.progress * 100));
          },
        },
        // for a handwritten sheet the dictionary is switched off, otherwise Tesseract
        // "fixes" the child's misspellings into real words and hides the mistakes
        handwriting ? { load_system_dawg: '0', load_freq_dawg: '0' } : {},
      );
      worker.catch(() => this.workers.delete(key));
      this.workers.set(key, worker);
    }
    return { key, worker: this.workers.get(key)! };
  }

  dispose(): void {
    for (const worker of this.workers.values()) worker.then((w) => w.terminate()).catch(() => {});
    this.workers.clear();
  }

  /** reads a photo into text; onProgress gets 0..100 */
  async read(file: Blob, lang: Lang, handwriting: boolean, onProgress: (p: number) => void): Promise<string> {
    await this.load();
    const canvas = await photoToCanvas(file);
    const { key, worker } = this.worker(lang, handwriting);
    const w = await worker;
    this.onProgress = onProgress;
    try {
      const { data } = await w.recognize(canvas);
      return cleanOcrText(data.text);
    } catch (e) {
      // a worker that failed may be broken: start a fresh one next time
      if (this.workers.get(key) === worker) {
        this.workers.delete(key);
        w.terminate().catch(() => {});
      }
      throw e;
    } finally {
      this.onProgress = () => {};
    }
  }
}

/** The status line, error and busy state of one "read a photo" card. */
export class PhotoReader {
  private readonly ocr = inject(Ocr);
  /** null = idle, 'prep' = loading, number = % read */
  readonly progress = signal<null | 'prep' | number>(null);
  readonly failed = signal(false);
  readonly busy = computed(() => this.progress() !== null);

  constructor(private readonly handwriting: boolean) {}

  status(t: Texts): string {
    const p = this.progress();
    return p === null ? t.photoSafe : p === 'prep' ? t.preparing : t.reading(p);
  }

  async read(file: File, lang: Lang): Promise<string | null> {
    this.failed.set(false);
    this.progress.set('prep');
    try {
      return await this.ocr.read(file, lang, this.handwriting, (p) => this.progress.set(p));
    } catch {
      this.failed.set(true);
      return null;
    } finally {
      this.progress.set(null);
    }
  }
}
