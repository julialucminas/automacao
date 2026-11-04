/*
 * Deixa o sistema abrir sem internet (técnico no campo).
 * - páginas: tenta a rede primeiro; sem rede, usa a última cópia
 * - arquivos do sistema (assets com hash no nome) e imagens: guarda na primeira vez
 * - /api nunca passa por aqui (os dados sem sinal ficam na fila do próprio sistema)
 */
const CACHE = 'lucminas-v1';

// já na instalação guarda a página e os arquivos dela (para abrir sem sinal desde a primeira vez)
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    fetch('./index.html', { cache: 'no-store' })
      .then(async (r) => {
        const html = await r.clone().text();
        const arquivos = [...html.matchAll(/(?:src|href)="\.?\/?([^"]*(?:assets\/[^"]+|\.png|\.webmanifest))"/g)].map((m) => './' + m[1]);
        const c = await caches.open(CACHE);
        await c.put('./index.html', r);
        await c.addAll([...new Set(arquivos)]);
      })
      .catch(() => undefined),
  );
});
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname === '/') {
    e.respondWith(
      fetch(req)
        .then((r) => {
          const copia = r.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copia));
          return r;
        })
        .catch(() => caches.match('./index.html').then((r) => r || Response.error())),
    );
    return;
  }
  if (url.pathname.includes('/assets/') || /\.(png|svg|ico|webmanifest|woff2?)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(
        (r) =>
          r ||
          fetch(req).then((resp) => {
            if (resp.ok) {
              const copia = resp.clone();
              caches.open(CACHE).then((c) => c.put(req, copia));
            }
            return resp;
          }),
      ),
    );
  }
});
