import { DOCUMENT, Injectable, inject } from '@angular/core';

const EMOJI = ['🎉', '⭐', '🧡', '💚', '💜', '✨'];

@Injectable({ providedIn: 'root' })
export class Confetti {
  private readonly doc = inject(DOCUMENT);

  throw(): void {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const box = this.doc.createElement('div');
    box.className = 'confetti';
    box.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 36; i++) {
      const s = this.doc.createElement('span');
      s.textContent = EMOJI[i % EMOJI.length];
      s.style.left = Math.random() * 100 + '%';
      s.style.animationDelay = Math.random() * 1.2 + 's';
      s.style.fontSize = 1 + Math.random() * 1.2 + 'rem';
      box.append(s);
    }
    this.doc.body.append(box);
    setTimeout(() => box.remove(), 4800);
  }
}
