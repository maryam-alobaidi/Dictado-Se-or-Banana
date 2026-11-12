import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { lowFirst, norm } from '../compare';
import { DictationStore } from '../dictation-store';
import { SpecialLetters } from '../ui';

const PRACTICE_MAX_WORDS = 8;
const PRACTICE_REPS = 5; // the first 2 are copied, the rest from memory
const PRACTICE_COPY_REPS = 2;

/** Each misspelled word is written 5 times: copied twice, then from memory. */
@Component({
  selector: 'app-practice',
  imports: [SpecialLetters],
  template: `
    <div class="card">
      <div class="bar"><i [style.width.%]="progress()"></i></div>
      <p class="counter" [innerHTML]="t().wordN(wordIdx() + 1, words.length)"></p>
      <p class="muted">{{ t().phelp(reps) }}</p>
      <div class="word" aria-live="polite">{{ visible() ? word() : '· · ·' }}</div>
      <div class="dots" aria-hidden="true">
        @for (i of dots; track i) {
          <i [class.f]="i < repsDone()"></i>
        }
      </div>
      <div class="row">
        <button type="button" (click)="hear()">{{ t().listen }}</button>
      </div>
      <input
        #pin
        type="text"
        class="bigInput"
        spellcheck="false"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        [attr.aria-label]="t().pin"
        (keydown.enter)="check()"
      />
      <app-special-letters [target]="pin" />
      <p #warn class="warn" role="alert" [hidden]="!showWord()">{{ t().pwarn }}</p>
      <div class="row">
        <button type="button" class="btn go" (click)="check()">{{ t().check }}</button>
      </div>
    </div>
  `,
})
export class PracticeScreen {
  private readonly store = inject(DictationStore);
  protected readonly t = this.store.t;
  private readonly result = this.store.result()!;
  protected readonly words = this.result.r.wrong.slice(0, PRACTICE_MAX_WORDS);
  protected readonly reps = PRACTICE_REPS;
  protected readonly dots = Array.from({ length: PRACTICE_REPS }, (_, i) => i);

  protected readonly wordIdx = signal(0);
  protected readonly repsDone = signal(0);
  protected readonly showWord = signal(false); // shows the word again after a mistake

  protected readonly word = computed(() => this.words[this.wordIdx()]);
  protected readonly visible = computed(() => this.repsDone() < PRACTICE_COPY_REPS || this.showWord());
  protected readonly progress = computed(() => {
    const done = this.wordIdx() * PRACTICE_REPS + this.repsDone();
    return Math.round((done / (this.words.length * PRACTICE_REPS)) * 100);
  });

  private readonly pin = viewChild.required<ElementRef<HTMLInputElement>>('pin');
  private readonly warn = viewChild.required<ElementRef<HTMLElement>>('warn');

  constructor() {
    this.hear();
  }

  protected hear(): void {
    this.store.halt();
    this.store.say(this.word(), Math.max(0.5, this.store.rate()));
  }

  protected check(): void {
    const field = this.pin().nativeElement;
    const word = this.word();
    const typed = norm(field.value);
    const target = norm(word);
    const right = typed === target || (this.result.r.starts.has(word) && typed === lowFirst(target));
    field.value = '';
    if (!right) {
      this.showWord.set(true);
      const warn = this.warn().nativeElement;
      warn.classList.remove('shake');
      void warn.offsetWidth; // restarts the shake animation
      warn.classList.add('shake');
      return;
    }
    this.showWord.set(false);
    if (this.repsDone() + 1 < PRACTICE_REPS) this.repsDone.update((r) => r + 1);
    else {
      this.repsDone.set(0);
      if (this.wordIdx() + 1 >= this.words.length) return this.store.finishPractice();
      this.wordIdx.update((i) => i + 1);
    }
    this.hear();
  }
}
