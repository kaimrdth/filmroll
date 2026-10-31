// Renders the static HTML for the homepage and each album from src/manifest.json.
// Used by the Vite plugin in vite.config.js, for both `vite` and `vite build`.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Widths below must match the layout in src/style.css.
// Covers: one column up to 640px, two columns above, 1440px max container.
const COVER_SIZES = '(max-width: 640px) calc(100vw - 40px), (max-width: 1400px) 44vw, (max-width: 1552px) calc(50vw - 84px), 692px';
// Album photos: each photo fills a viewport-height section, scaled to fit (object-fit: contain),
// so its width is min(viewport width, viewport height x aspect ratio).
// On desktop screens of 2x density or more, a copy for about 1.3x density is requested
// (65% of the layout width), which halves the data of an album scroll. The viewer still
// loads a copy that is sharp at full density. Phones (up to 640px wide) are not capped.
const photoSizes = (p) => {
  const ar = p.width / p.height;
  const fit = (k) => `min(${k}vw, calc(${(k * ar).toFixed(2)}vh))`;
  return `(max-width: 640px) ${fit(100)}, (min-resolution: 2dppx) ${fit(65)}, ${fit(100)}`;
};

// The inlined preview, blurred by an SVG filter. The tiny image is drawn larger than the
// frame so that the blur does not fade to transparent at the edges.
export function blurredPreview(p) {
  const h = Math.round((320 * p.height) / p.width);
  // Explicit width and height give the SVG the photo's aspect ratio, so background-size
  // contain places the preview exactly over the photo's own area.
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='${h}' viewBox='0 0 320 ${h}'>`
    + `<filter id='b'><feGaussianBlur stdDeviation='11'/></filter>`
    + `<image x='-40' y='-40' width='400' height='${h + 80}' preserveAspectRatio='none' filter='url(#b)' href='${p.lqip}'/></svg>`;
  return `data:image/svg+xml,${svg.replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E')}`;
}

const srcset = (p, base) => p.sources.map((s) => `${base}${s.src} ${s.w}w`).join(', ');

function img(p, base, { sizes, eager = false, auto = true, alt = p.alt, position = '', cls = '' }) {
  const fallback = p.sources.find((s) => s.w >= 960) ?? p.sources.at(-1);
  // A crop position applies to the photo and to its blurred preview alike.
  const pos = position ? `;object-position:${esc(position)};background-position:${esc(position)}` : '';
  // Lazy images may use sizes="auto": the browser then uses the real layout width.
  return `<img${cls ? ` class="${cls}"` : ''} src="${base}${fallback.src}" srcset="${srcset(p, base)}" `
    + `sizes="${eager || !auto ? sizes : `auto, ${sizes}`}" width="${p.width}" height="${p.height}" alt="${esc(alt)}" `
    + `decoding="async" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} style="background-image:url(&quot;${blurredPreview(p)}&quot;)${pos}">`;
}

// Each album link contains its cover (empty alt, decorative) and its name, so the link's
// accessible name is the album name.
export function renderHome(manifest, base) {
  const items = manifest.albums.map((a, i) => `
      <li>
        <a class="album-link" href="${base}${a.slug}/" data-warm-srcset="${srcset(a.photos[0], base)}" data-warm-sizes="${photoSizes(a.photos[0])}">
          <span class="cover">${img(a.photos[a.cover], base, { sizes: COVER_SIZES, eager: i < 2, alt: '', position: a.coverPosition })}</span>
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
        <a class="photo" href="${base}${largest.src}" aria-label="Open photo ${i + 1} of ${n}">
          ${img(p, base, { sizes: photoSizes(p), eager: i === 0, auto: false })}
        </a>
      </li>`;
  }).join('');
  return {
    title: `${album.title} · filmroll`,
    body: `
  <header class="album-header">
    <a class="back" href="${base}"><span aria-hidden="true">←</span> filmroll</a>
    <h1 class="album-title">${esc(album.title)}</h1>
  </header>
  <main class="album">
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

export function renderNotFound(base) {
  return {
    title: 'Not found · filmroll',
    body: `
  <header class="album-header">
    <a class="back" href="${base}"><span aria-hidden="true">←</span> filmroll</a>
    <h1 class="album-title">Page not found</h1>
  </header>`,
  };
}
