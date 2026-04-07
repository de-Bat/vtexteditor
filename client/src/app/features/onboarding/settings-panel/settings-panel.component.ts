import { Component, OnInit, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AppSettings, SETTING_META, SettingKey, SettingsService } from '../../../core/services/settings.service';

@Component({
  selector: 'app-settings-panel',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings-panel.component.html',
  styleUrl: './settings-panel.component.scss',
})
export class SettingsPanelComponent implements OnInit {
  readonly closed = output<void>();

  readonly keys = Object.keys(SETTING_META) as SettingKey[];
  readonly meta = SETTING_META;

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly error = signal<string | null>(null);

  // Local editable copy; revealed[key] tracks whether a secret field is shown
  draft: Record<string, string> = {};
  revealed: Record<string, boolean> = {};

  constructor(private settingsService: SettingsService) {}

  ngOnInit(): void {
    this.settingsService.load().subscribe({
      next: (settings: AppSettings) => {
        for (const key of this.keys) {
          this.draft[key] = settings[key] ?? '';
        }
        this.loading.set(false);
      },
      error: (err: Error) => {
        this.error.set(err.message);
        this.loading.set(false);
      },
    });
  }

  save(): void {
    this.saving.set(true);
    this.saved.set(false);
    this.error.set(null);
    // Send all fields; server treats empty string as "delete"
    const payload: AppSettings = {};
    for (const key of this.keys) {
      payload[key] = this.draft[key] ?? '';
    }
    this.settingsService.save(payload).subscribe({
      next: () => {
        this.saving.set(false);
        this.saved.set(true);
        setTimeout(() => this.saved.set(false), 2500);
      },
      error: (err: Error) => {
        this.saving.set(false);
        this.error.set(err.message);
      },
    });
  }

  close(): void {
    this.closed.emit();
  }
}
