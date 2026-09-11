/**
 * BobCall Service Worker
 * vite-plugin-pwa generates a full workbox SW for production.
 * This minimal sw.js is used only as a fallback during `vite dev`
 * to allow the PWA install prompt and Notification API to work.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// No caching strategy here — workbox handles it in the production build.
self.addEventListener("fetch", () => {});
