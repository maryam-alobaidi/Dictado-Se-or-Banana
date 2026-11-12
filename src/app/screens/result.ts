import { Component, ElementRef, Injector, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { OP, tok } from '../compare';
import { DictationStore } from '../dictation-store';
import { PhotoReader } from '../ocr';
import { PhotoButtons, Stars } from '../ui';

@Component({
  selector: 'app-result',
  imports: [PhotoButtons, Stars],
  templateUrl: './result.html',
})
export class ResultScreen {
  protected readonly store = inject(DictationStore);
  private readonly injector = inject(Injector);
  protected readonly t = this.store.t;
  protected readonly OP = OP;

  /* paper mode: correct the sheet from a photo */
  protected readonly reader = new PhotoReader(true);
  protected readonly sheetText = signal('');
  protected readonly reviewing = signal(false);
  protected readonly sheetEmpty = signal(false);
  private readonly sheetField = viewChild<ElementRef<HTMLTextAreaElement>>('sheet');

  /* paper mode: count the mistakes by hand */
  protected readonly note = signal<{ score: number; message: string; prev: number | null } | null>(null);

  protected async readSheet(file: File): Promise<void> {
    const text = await this.reader.read(file, this.store.lang());
    if (text == null) return;
    this.sheetText.set(text);
    this.reviewing.set(true);
    afterNextRender(() => this.sheetField()?.nativeElement.focus(), { injector: this.injector });
  }

  protected checkSheet(): void {
    const written = this.sheetText();
    this.sheetEmpty.set(!written.trim());
    if (written.trim()) this.store.correct(written);
  }

  protected seeNote(field: HTMLInputElement): void {
    const total = Math.max(1, tok(this.store.text(), false).length);
    // the field accepts anything typed (-3, 2.5, 999): keep a whole number between 0 and the word count
    const errors = Math.min(Math.max(Math.round(+field.value || 0), 0), total);
    field.value = String(errors);
    const score = Math.round(((total - errors) / total) * 100) / 10;
    const message = this.store.celebrate(score);
    const prev = this.store.recordScore(score);
    this.note.set({ score, message, prev });
  }
}
