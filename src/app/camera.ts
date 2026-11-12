import {
  Component,
  ElementRef,
  Injectable,
  Injector,
  afterNextRender,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DictationStore } from './dictation-store';

/* Phones and tablets open their own camera from <input capture>. Computers ignore "capture" and only show a
   file picker, so there the app opens the webcam itself in a small window (CameraDialog). */
@Injectable({ providedIn: 'root' })
export class Camera {
  /** set while the webcam window should be open; called with the photo, or null if closed */
  readonly request = signal<((file: File | null) => void) | null>(null);

  canUseWebcam(): boolean {
    return !!navigator.mediaDevices?.getUserMedia && !matchMedia('(pointer: coarse)').matches;
  }

  takePhoto(): Promise<File | null> {
    return new Promise((resolve) => this.request.set(resolve));
  }
}

@Component({
  selector: 'app-camera-dialog',
  template: `
    <dialog #dlg class="camdlg" aria-labelledby="camH" (cancel)="$event.preventDefault(); done(null)">
      <h2 id="camH">{{ t().camH }}</h2>
      <video #video autoplay playsinline muted></video>
      @if (failed()) {
        <p class="warn" role="alert">{{ t().camErr }}</p>
      }
      <div class="row">
        <button #shot type="button" class="btn go" [disabled]="!ready()" (click)="shoot()">{{ t().camShot }}</button>
        <button type="button" (click)="done(null)">{{ t().camCancel }}</button>
      </div>
    </dialog>
  `,
})
export class CameraDialog {
  private readonly camera = inject(Camera);
  private readonly injector = inject(Injector);
  protected readonly t = inject(DictationStore).t;

  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  private readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  private readonly shot = viewChild.required<ElementRef<HTMLButtonElement>>('shot');

  protected readonly ready = signal(false);
  protected readonly failed = signal(false);
  private stream: MediaStream | null = null;

  constructor() {
    effect(() => {
      if (this.camera.request()) untracked(() => this.open());
    });
  }

  private open(): void {
    this.ready.set(false);
    this.failed.set(false);
    this.dlg().nativeElement.showModal();
    this.start();
  }

  // starts the webcam inside the open window; shows a message in the window if it can't
  private async start(): Promise<void> {
    const dialog = this.dlg().nativeElement;
    const video = this.video().nativeElement;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      if (!dialog.open) {
        // the window was closed while the browser was asking for permission
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      video.srcObject = stream;
      await video.play();
      this.ready.set(true);
      afterNextRender(() => this.shot().nativeElement.focus(), { injector: this.injector });
    } catch {
      if (dialog.open) this.failed.set(true);
    }
  }

  protected shoot(): void {
    const video = this.video().nativeElement;
    const c = document.createElement('canvas');
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext('2d')!.drawImage(video, 0, 0);
    c.toBlob((b) => this.done(b ? new File([b], 'foto.jpg', { type: 'image/jpeg' }) : null), 'image/jpeg', 0.92);
  }

  protected done(file: File | null): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video().nativeElement.srcObject = null;
    const dialog = this.dlg().nativeElement;
    if (dialog.open) dialog.close();
    const resolve = this.camera.request();
    this.camera.request.set(null);
    resolve?.(file);
  }
}
