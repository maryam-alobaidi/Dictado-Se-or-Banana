import { Component, DOCUMENT, computed, effect, inject } from '@angular/core';
import { CameraDialog } from './camera';
import { DictationStore } from './dictation-store';
import { DoneScreen } from './screens/done';
import { PlayScreen } from './screens/play';
import { PracticeScreen } from './screens/practice';
import { ResultScreen } from './screens/result';
import { SetupScreen } from './screens/setup';

@Component({
  selector: 'app-root',
  imports: [SetupScreen, PlayScreen, ResultScreen, PracticeScreen, DoneScreen, CameraDialog],
  template: `
    <header>
      <div class="top">
        <span class="logo">🍌</span>
        <div>
          <b>{{ t().app }}</b><small>{{ t().tagline }}</small>
        </div>
        <button
          type="button"
          class="themeBtn"
          [title]="themeLabel()"
          [attr.aria-label]="themeLabel()"
          [attr.aria-pressed]="store.dark()"
          (click)="store.toggleTheme()"
        >
          {{ store.dark() ? '☀️' : '🌙' }}
        </button>
      </div>
    </header>
    <main>
      @switch (store.screen()) {
        @case ('setup') {
          <app-setup />
        }
        @case ('play') {
          <app-play />
        }
        @case ('result') {
          <app-result />
        }
        @case ('practice') {
          <app-practice />
        }
        @case ('done') {
          <app-done />
        }
      }
    </main>
    <!-- webcam window (computers; phones use their own camera app) -->
    <app-camera-dialog />
  `,
})
export class App {
  protected readonly store = inject(DictationStore);
  protected readonly t = this.store.t;
  protected readonly themeLabel = computed(() => (this.store.dark() ? this.t().themeLight : this.t().themeDark));

  constructor() {
    const doc = inject(DOCUMENT);
    effect(() => {
      doc.documentElement.lang = this.store.lang();
      doc.title = this.t().app;
    });
    // light by default; index.html applies the saved theme before the first paint
    effect(() => {
      if (this.store.dark()) doc.documentElement.dataset['theme'] = 'dark';
      else delete doc.documentElement.dataset['theme'];
    });
    effect(() => {
      this.store.screen();
      scrollTo(0, 0);
    });
  }
}
