import { Component, computed, inject } from '@angular/core';
import { DictationStore, FINISH_ICON, SPEED_VALUES } from '../dictation-store';
import { Option, OptionGroup, SpecialLetters } from '../ui';

@Component({
  selector: 'app-play',
  imports: [OptionGroup, SpecialLetters],
  templateUrl: './play.html',
})
export class PlayScreen {
  protected readonly store = inject(DictationStore);
  protected readonly t = this.store.t;
  protected readonly finishIcon = FINISH_ICON;

  protected readonly n = computed(() => this.store.sentences().length);
  protected readonly progress = computed(() => ((this.store.idx() + 1) / this.n()) * 100);
  protected readonly sentence = computed(() => this.store.sentences()[this.store.idx()] ?? '');
  protected readonly speeds = computed<Option<number>[]>(() =>
    this.t().speeds.map((label, i) => ({ label, value: SPEED_VALUES[i] })),
  );
}
