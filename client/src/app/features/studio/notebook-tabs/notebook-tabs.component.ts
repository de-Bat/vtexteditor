import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { NotebookService } from '../../../core/services/notebook.service';
import { Notebook } from '../../../core/models/notebook.model';

@Component({
  selector: 'app-notebook-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="notebook-bar" role="tablist" aria-label="Notebooks">
      @for (nb of notebookService.notebooks(); track nb.id) {
        <div
          class="tab"
          role="tab"
          [class.active]="nb.id === notebookService.active()?.id"
          [attr.aria-selected]="nb.id === notebookService.active()?.id"
          [attr.tabindex]="nb.id === notebookService.active()?.id ? 0 : -1"
          (click)="onTabClick(nb)"
          (dblclick)="startRename(nb)"
          (keydown.enter)="onTabClick(nb)"
          (keydown.F2)="startRename(nb)"
        >
          @if (renamingId() === nb.id) {
            <input
              class="rename-input"
              [value]="nb.name"
              (blur)="commitRename(nb, $any($event.target).value)"
              (keydown.enter)="commitRename(nb, $any($event.target).value)"
              (keydown.escape)="renamingId.set(null)"
              (click)="$event.stopPropagation()"
            />
          } @else {
            <span class="tab-name">{{ nb.name }}</span>
            @if (nb.id === notebookService.active()?.id && notebookService.isDirty()) {
              <span class="dirty-dot" aria-label="Unsaved changes" title="Unsaved changes"></span>
            }
          }
          <button
            class="tab-close"
            [attr.aria-label]="'Close ' + nb.name"
            (click)="onCloseClick(nb, $event)"
          >✕</button>
        </div>
      }

      <button
        class="new-tab-btn"
        title="New Notebook"
        aria-label="New Notebook"
        (click)="createNotebook()"
      >✱</button>

      <div class="tab-spacer"></div>

      <button
        class="save-btn"
        [disabled]="!notebookService.isDirty()"
        [attr.aria-disabled]="!notebookService.isDirty()"
        (click)="save()"
        title="Save notebook"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
        Save
      </button>
    </div>
  `,
  styles: [`
    .notebook-bar {
      display: flex;
      align-items: flex-end;
      gap: 2px;
      padding: 0 1rem;
      background: var(--color-bg);
      border-bottom: 2px solid var(--color-accent);
      min-height: 34px;
      flex-shrink: 0;
    }

    .tab {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      border-radius: 6px 6px 0 0;
      font-size: 0.75rem;
      font-weight: 500;
      cursor: pointer;
      background: var(--color-surface-alt);
      color: var(--color-muted);
      border: 1px solid var(--color-border);
      border-bottom: none;
      margin-bottom: -2px;
      transition: background 0.15s;
      user-select: none;

      &:hover {
        background: var(--color-surface);
        color: var(--color-text-secondary);
      }

      &.active {
        background: color-mix(in srgb, var(--color-accent) 10%, var(--color-bg));
        color: var(--color-text);
        font-weight: 600;
        border-color: var(--color-accent);
        border-bottom-color: color-mix(in srgb, var(--color-accent) 10%, var(--color-bg));
        box-shadow: 0 -2px 8px color-mix(in srgb, var(--color-accent) 25%, transparent);
      }
    }

    .tab-name {
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .dirty-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #f59e0b;
      flex-shrink: 0;
    }

    .rename-input {
      background: transparent;
      border: none;
      border-bottom: 1px solid var(--color-accent);
      color: var(--color-text);
      font-size: 0.75rem;
      font-weight: 600;
      font-family: inherit;
      outline: none;
      width: 100px;
      padding: 0;
    }

    .tab-close {
      background: none;
      border: none;
      color: var(--color-muted);
      cursor: pointer;
      font-size: 0.65rem;
      padding: 0 2px;
      line-height: 1;
      opacity: 0.5;
      transition: opacity 0.15s;

      &:hover {
        opacity: 1;
        color: var(--color-text);
      }
    }

    .new-tab-btn {
      background: none;
      border: none;
      color: var(--color-muted);
      cursor: pointer;
      font-size: 1rem;
      font-weight: 700;
      padding: 4px 8px;
      border-radius: 4px;
      align-self: center;
      margin-bottom: 2px;
      transition: color 0.15s;

      &:hover {
        color: var(--color-text);
      }
    }

    .tab-spacer {
      flex: 1;
    }

    .save-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: var(--color-accent);
      color: #fff;
      border: none;
      border-radius: 5px;
      padding: 3px 10px;
      font-size: 0.75rem;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      margin-bottom: 4px;
      transition: opacity 0.15s;

      &:disabled {
        opacity: 0.35;
        cursor: default;
      }

      &:not(:disabled):hover {
        opacity: 0.85;
      }
    }
  `],
})
export class NotebookTabsComponent {
  readonly notebookService = inject(NotebookService);
  readonly renamingId = signal<string | null>(null);

  onTabClick(nb: Notebook): void {
    this.notebookService.switchTo(nb);
  }

  startRename(nb: Notebook): void {
    this.renamingId.set(nb.id);
    // Focus the input on the next tick
    setTimeout(() => {
      const input = document.querySelector('.rename-input') as HTMLInputElement | null;
      input?.select();
    });
  }

  commitRename(nb: Notebook, name: string): void {
    const trimmed = name.trim();
    this.renamingId.set(null);
    if (trimmed && trimmed !== nb.name) {
      this.notebookService.rename(nb.id, trimmed).subscribe();
    }
  }

  onCloseClick(nb: Notebook, event: MouseEvent): void {
    event.stopPropagation();
    this.notebookService.delete(nb.id).subscribe();
  }

  createNotebook(): void {
    this.notebookService.create('Untitled Notebook').subscribe((nb) => {
      this.startRename(nb);
    });
  }

  save(): void {
    this.notebookService.save().subscribe();
  }
}
