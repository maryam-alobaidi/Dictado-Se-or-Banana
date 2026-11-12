import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';

// zoneless change detection is the default since Angular 21; all state is in signals
export const appConfig: ApplicationConfig = {
  providers: [provideBrowserGlobalErrorListeners()],
};
