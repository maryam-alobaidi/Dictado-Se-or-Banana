import { Component, computed, inject, input, output } from '@angular/core';
import { Camera } from './camera';
import { DictationStore } from './dictation-store';
import { SPECIAL_LETTERS } from './i18n';

export interface Option<T> {
  label: string;
  value: T;
}

/** A row of buttons where one is chosen, marked visibly (.on) and for screen readers (aria-pressed). */
@Component({
  selector: 'app-options',
  host: { class: 'seg', role: 'group' },
  template: `
    @for (o of items(); track o.value) {
      <button
        type="button"
        [class.on]="o.value === value()"
        [attr.aria-pressed]="o.value === value()"
        (click)="picked.emit(o.value)"
      >
        {{ o.label }}
      </button>
    }
  `,
})
export class OptionGroup<T extends string | number> {
  readonly items = input.required<readonly Option<T>[]>();
  readonly value = input.required<T>();
  readonly picked = output<T>();
}

/** Buttons for letters that are hard to type (á, ñ, ç, l·l…); they go into `target` at the cursor. */
@Component({
  selector: 'app-special-letters',
  host: { class: 'sp', role: 'group', '[attr.aria-label]': 't().special' },
  template: `
    @for (l of letters(); track l) {
      <button type="button" (click)="insert(l)">{{ l }}</button>
    }
  `,
})
export class SpecialLetters {
  readonly target = input.required<HTMLInputElement | HTMLTextAreaElement>();
  private readonly store = inject(DictationStore);
  protected readonly t = this.store.t;
  protected readonly letters = computed(() => SPECIAL_LETTERS[this.store.lang()]);

  protected insert(text: string): void {
    const field = this.target();
    const start = field.selectionStart ?? field.value.length;
    const end = field.selectionEnd ?? field.value.length;
    field.setRangeText(text, start, end, 'end');
    field.dispatchEvent(new Event('input')); // updates the signal bound to the field
    field.focus();
  }
}

/** "Take a photo" + "choose from the gallery". The camera is the webcam window on computers and the
    phone's own camera app (<input capture>) elsewhere. */
@Component({
  selector: 'app-photo-buttons',
  styles: ':host{display:block}',
  template: `
    <input #gallery type="file" accept="image/*" hidden (change)="picked(gallery)" />
    <input #cam type="file" accept="image/*" capture="environment" hidden (change)="picked(cam)" />
    <div class="row">
      <button type="button" class="btn hot" [disabled]="busy()" (click)="takePhoto(cam)">{{ camLabel() }}</button>
      <button type="button" [disabled]="busy()" (click)="gallery.click()">{{ galleryLabel() }}</button>
    </div>
  `,
})
export class PhotoButtons {
  readonly camLabel = input.required<string>();
  readonly galleryLabel = input.required<string>();
  readonly busy = input(false);
  readonly photo = output<File>();
  private readonly camera = inject(Camera);

  protected picked(field: HTMLInputElement): void {
    const file = field.files?.[0];
    field.value = ''; // so choosing the same photo again still fires "change"
    if (file) this.photo.emit(file);
  }

  protected async takePhoto(field: HTMLInputElement): Promise<void> {
    if (!this.camera.canUseWebcam()) return field.click();
    const file = await this.camera.takePhoto();
    if (file) this.photo.emit(file);
  }
}

/** 0-10 score as 5 stars */
@Component({
  selector: 'app-stars',
  template: `<div class="stars" role="img" [attr.aria-label]="t().stars(full())">{{ on() }}<span class="off">{{ off() }}</span></div>`,
})
export class Stars {
  readonly score = input.required<number>();
  protected readonly t = inject(DictationStore).t;
  protected readonly full = computed(() => Math.round(this.score() / 2));
  protected readonly on = computed(() => '★'.repeat(this.full()));
  protected readonly off = computed(() => '★'.repeat(5 - this.full()));
}
