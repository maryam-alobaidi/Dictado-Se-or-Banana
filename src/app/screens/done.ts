import { Component, inject } from '@angular/core';
import { DictationStore } from '../dictation-store';

@Component({
  selector: 'app-done',
  template: `
    <div class="card center">
      <div class="mascot" aria-hidden="true">🏆</div>
      <h2>{{ t().doneH(store.childName()) }}</h2>
      <p>{{ t().doneP }}</p>
      <button type="button" class="btn go" (click)="store.newDictation()">{{ t().another }}</button>
    </div>
  `,
})
export class DoneScreen {
  protected readonly store = inject(DictationStore);
  protected readonly t = this.store.t;
}
