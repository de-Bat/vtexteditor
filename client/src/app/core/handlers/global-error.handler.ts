import { ErrorHandler, Injectable, Injector } from '@angular/core';
import { NotificationService } from '../services/notification.service';

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  constructor(private injector: Injector) {}

  handleError(error: any): void {
    const notifications = this.injector.get(NotificationService);
    
    // What: Error message
    const message = error.message ? error.message : error.toString();
    
    // Where: Extract first line of stack trace if available
    let location = 'Unknown location';
    if (error.stack) {
      const stackLines = error.stack.split('\n');
      // usually the second line has the exact location
      location = stackLines[1] ? stackLines[1].trim() : 'Unknown location';
    }

    console.error('Global Error:', error);
    notifications.error(`[Frontend Error] ${message}\nAt: ${location}`);
  }
}
