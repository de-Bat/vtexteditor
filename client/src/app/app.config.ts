import { ApplicationConfig, ErrorHandler } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';

import { routes } from './app.routes';
import { httpErrorInterceptor } from './core/interceptors/http-error.interceptor';
import { GlobalErrorHandler } from './core/handlers/global-error.handler';

export const appConfig: ApplicationConfig = {
  providers: [
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    provideRouter(routes),
    provideHttpClient(withInterceptors([httpErrorInterceptor])),
    provideAnimations(),
  ]
};
