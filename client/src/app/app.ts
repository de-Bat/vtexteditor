import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastStackComponent } from './shared/components/toast-stack.component';
import { ConfirmDialogComponent } from './shared/components/confirm-dialog/confirm-dialog.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ToastStackComponent, ConfirmDialogComponent],
  template: `
    <router-outlet />
    <app-toast-stack />
    <app-confirm-dialog />
  `,
  styles: [`
    :host { display: block; }
  `]
})
export class App {}
