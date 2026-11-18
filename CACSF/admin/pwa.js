/* CACSF Admin PWA support.
   Keeps service-worker registration for the installed app, but does not show
   an automatic installation suggestion or native install prompt. */
(() => {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js', { scope: './' })
      .catch(error => console.warn('CACSF Admin service worker registration failed:', error));
  });
})();
