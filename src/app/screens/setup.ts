import { Component, ElementRef, computed, inject, viewChild } from '@angular/core';
import { DictationStore, Mode, SPEED_VALUES } from '../dictation-store';
import { Lang } from '../i18n';
import { Library, Run, SavedDictation, squash, titleOf } from '../library';
import { PhotoReader } from '../ocr';
import { langTag } from '../speech';
import { Option, OptionGroup, PhotoButtons } from '../ui';

const SPARK_N = 10;
const SPARK_W = 120;
const SPARK_H = 40;
const SPARK_P = 6;

// small line chart of the last scores (0-10, one series); the scores are also written out as text next to it
function sparkData(runs: Run[], lang: Lang, fmt: (n: number) => string) {
  const r = runs.slice(-SPARK_N);
  if (r.length < 2) return null;
  const X = (i: number) => SPARK_P + (i * (SPARK_W - 2 * SPARK_P)) / (r.length - 1);
  const Y = (s: number) => SPARK_H - SPARK_P - (s / 10) * (SPARK_H - 2 * SPARK_P);
  const day = (d: string) => new Date(d).toLocaleDateString(langTag(lang), { day: 'numeric', month: 'short' });
  return {
    base: Y(0),
    points: r.map((x, i) => `${X(i).toFixed(1)},${Y(x.s).toFixed(1)}`).join(' '),
    dots: r.map((x, i) => ({ cx: X(i).toFixed(1), cy: Y(x.s).toFixed(1), title: `${day(x.d)}: ${fmt(x.s)}` })),
  };
}

@Component({
  selector: 'app-setup',
  imports: [OptionGroup, PhotoButtons],
  templateUrl: './setup.html',
})
export class SetupScreen {
  protected readonly store = inject(DictationStore);
  private readonly library = inject(Library);
  protected readonly t = this.store.t;
  protected readonly reader = new PhotoReader(false);
  private readonly startBtn = viewChild.required<ElementRef<HTMLButtonElement>>('startBtn');

  protected readonly spark = { w: SPARK_W, h: SPARK_H, p: SPARK_P };

  protected readonly langs: Option<Lang>[] = [
    { label: '🇪🇸 Español', value: 'es' },
    { label: '🟡 Català', value: 'ca' },
  ];
  protected readonly modes = computed<Option<Mode>[]>(() => [
    { label: this.t().paper, value: 'paper' },
    { label: this.t().pc, value: 'pc' },
  ]);
  protected readonly speeds = computed<Option<number>[]>(() =>
    this.t().speeds.map((label, i) => ({ label, value: SPEED_VALUES[i] })),
  );

  // the heading already says "Hola, name!", so the bubble shows the rest of the greeting
  protected readonly helloRest = computed(
    () => this.store.greeting().replace(/^¡?Hola,[^!]*!\s*/, '') || this.store.greeting(),
  );

  protected readonly saved = computed(() => {
    const x = this.t();
    const lang = this.store.lang();
    const current = squash(this.store.text());
    const fmt = (n: number) => this.store.fmt(n);
    return this.library
      .items()
      .filter((d) => d.lang === lang)
      .map((d) => {
        const n = d.runs.length;
        const title = titleOf(d.text);
        return {
          d,
          title,
          on: squash(d.text) === current,
          meta: n ? x.libMeta(n, fmt(d.runs[n - 1].s)) : x.libNone,
          scores:
            n > 1
              ? x.libScores(
                  d.runs
                    .slice(-5)
                    .map((r) => fmt(r.s))
                    .join(' → '),
                )
              : null,
          delLabel: x.libDel(title),
          spark: sparkData(d.runs, lang, fmt),
        };
      });
  });

  protected pick(d: SavedDictation): void {
    this.store.pickSaved(d);
    this.startBtn().nativeElement.focus();
  }

  protected remove(d: SavedDictation): void {
    if (confirm(this.t().delAsk(titleOf(d.text)))) this.store.removeSaved(d.id);
  }

  protected async readTextPhoto(file: File): Promise<void> {
    const text = await this.reader.read(file, this.store.lang());
    if (text != null) this.store.text.set(text);
  }
}
