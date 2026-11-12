import { isDevMode } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { appConfig } from './app/app.config';

bootstrapApplication(App, appConfig).catch((err) => console.error(err));

// offline support (production builds only, so `ng serve` never serves a stale copy)
if (!isDevMode() && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
