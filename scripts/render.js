// Renders the static HTML for the homepage and each album from src/manifest.json.
// Used by the Vite plugin in vite.config.js, for both `vite` and `vite build`.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Widths below must match the layout in src/style.css.
// Covers: one column up to 640px, two columns above, 1440px max container.
const COVER_SIZES = '(max-width: 640px) calc(100vw - 40px), (max-width: 1400px) 44vw, (max-width: 1552px) calc(50vw - 84px), 692px';
// Album photos: the column is 1280px max and each photo is at most 88% of the viewport height.
const photoSizes = (p) => `(max-width: 640px) calc(100vw - 40px), min(1280px, 92vw, calc(88vh * ${(p.width / p.height).toFixed(3)}))`;

function img(p, base, { sizes, eager = false, cls = '' }) {
  const srcset = p.sources.map((s) => `${base}${s.src} ${s.w}w`).join(', ');
  const fallback = p.sources.find((s) => s.w >= 960) ?? p.sources.at(-1);
  // Lazy images may use sizes="auto": the browser then uses the real layout width.
  return `<img${cls ? ` class="${cls}"` : ''} src="${base}${fallback.src}" srcset="${srcset}" `
    + `sizes="${eager ? sizes : `auto, ${sizes}`}" width="${p.width}" height="${p.height}" alt="${esc(p.alt)}" `
    + `decoding="async" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'}>`;
}

export function renderHome(manifest, base) {
  const items = manifest.albums.map((a, i) => `
      <li>
        <a class="album-link" href="${base}${a.slug}/">
          <span class="cover">${img(a.photos[a.cover], base, { sizes: COVER_SIZES, eager: i < 2 })}</span>
          <span class="album-name">${esc(a.title)}</span>
        </a>
      </li>`).join('');
  return {
    title: 'filmroll',
    body: `
  <header class="site-header"><h1 class="wordmark">filmroll</h1></header>
  <main>
    <ul class="albums">${items}
    </ul>
  </main>`,
  };
}

export function renderAlbum(album, base) {
  const n = album.photos.length;
  const photos = album.photos.map((p, i) => {
    const largest = p.sources.at(-1);
    return `
      <li>
        <a class="photo" href="${base}${largest.src}" aria-label="Open photo ${i + 1} of ${n}" style="--ar: ${(p.width / p.height).toFixed(4)}">
          ${img(p, base, { sizes: photoSizes(p), eager: i === 0 })}
        </a>
      </li>`;
  }).join('');
  return {
    title: `${album.title} · filmroll`,
    body: `
  <header class="site-header">
    <a class="back" href="${base}"><span aria-hidden="true">←</span> filmroll</a>
    <h1 class="album-title">${esc(album.title)}</h1>
    ${album.placeholder ? '<p class="note">Placeholder images. Add photos to this album’s folder to replace them.</p>' : ''}
  </header>
  <main>
    <ol class="photos">${photos}
    </ol>
  </main>
  <dialog class="viewer" aria-label="${esc(album.title)} photo viewer">
    <img class="viewer-img" alt="">
    <p class="viewer-count" aria-live="polite"></p>
    <button class="viewer-btn viewer-close" type="button" aria-label="Close" autofocus>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
    </button>
    <button class="viewer-btn viewer-prev" type="button" aria-label="Previous photo">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
    </button>
    <button class="viewer-btn viewer-next" type="button" aria-label="Next photo">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
    </button>
  </dialog>`,
  };
}
