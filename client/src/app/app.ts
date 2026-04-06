import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastStackComponent } from './shared/components/toast-stack.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastStackComponent],
  template: `
    <router-outlet />
    <app-toast-stack />
  `,
  styles: [`
    :host { display: block; }
  `]
})
export class App {}
