import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { NotificationService } from '../services/notification.service';

export const httpErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const notifications = inject(NotificationService);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse) {
        const serverMessage = typeof error.error === 'object' && error.error !== null ? (error.error as { error?: string }).error : undefined;
        const message = serverMessage || error.message || 'Request failed.';
        notifications.error(message);
      } else {
        notifications.error('Unexpected error during request.');
      }

      return throwError(() => error);
    }),
  );
};
