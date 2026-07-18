const IMAGE_CACHE = 'musickey-images-v1';
const IMAGE_HOSTS = new Set([
  'i.ytimg.com',
  'lh3.googleusercontent.com',
  'yt3.googleusercontent.com',
  'yt3.ggpht.com'
]);

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== IMAGE_CACHE).map(key => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== 'GET' || !IMAGE_HOSTS.has(requestUrl.hostname)) return;

  event.respondWith(
    caches.open(IMAGE_CACHE).then(async cache => {
      const cached = await cache.match(event.request);
      if (cached) return cached;

      try {
        const response = await fetch(event.request);
        if (response.ok || response.type === 'opaque') {
          cache.put(event.request, response.clone()).catch(() => {});
        }
        return response;
      } catch (error) {
        return new Response('', { status: 504, statusText: 'Image unavailable' });
      }
    })
  );
});
