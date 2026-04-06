import { Routes } from '@angular/router';
import { OnboardingComponent } from './features/onboarding/onboarding.component';
import { StudioComponent } from './features/studio/studio.component';

export const routes: Routes = [
  { path: '', component: OnboardingComponent },
  { path: 'studio', component: StudioComponent },
  { path: '**', redirectTo: '' },
];
