import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-studio',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="studio-placeholder">
      <h1>Studio</h1>
      <p>The editing studio is coming in Phase 6.</p>
      <a routerLink="/">← Back to Onboarding</a>
    </div>
  `,
  styles: [`
    .studio-placeholder {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; min-height: 100vh;
      color: var(--color-text);
      gap: 1rem;
    }
    a { color: var(--color-accent); text-decoration: none; }
  `]
})
export class StudioComponent {}
