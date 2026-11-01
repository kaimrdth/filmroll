// Renders the static HTML for the homepage and each album from src/manifest.json.
// Used by the Vite plugin in vite.config.js, for both `vite` and `vite build`.

// The site's name, as shown in the wordmark, the back links and the browser tab titles.
const SITE_NAME = 'kai film roll';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Widths below must match the layout in src/style.css.
// Album pages have a bar at the top (BAR_HEIGHT, --bar in src/style.css). Each photo fills
// the viewport below it, scaled to fit (object-fit: contain), so its width is
// min(viewport width, (viewport height - bar) x aspect ratio).
// On desktop screens of 2x density or more, a copy for about 1.3x density is requested
// (65% of the layout width), which halves the data of an album scroll. Phones (up to
// 640px wide) are not capped.
const BAR_HEIGHT = 44;
const photoSizes = (p) => {
  const ar = p.width / p.height;
  const fit = (k) => `min(${k}vw, calc((100vh - ${BAR_HEIGHT}px) * ${((k / 100) * ar).toFixed(4)}))`;
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

// Homepage background: one photo fills the viewport (object-fit: cover). Screens narrower
// than 5:8 (phones held upright) get a portrait crop of it, made by scripts/prepare-images.js
// from photos/home.json. Keep PORTRAIT_MEDIA in step with the media query in src/style.css.
const PORTRAIT_MEDIA = '(max-aspect-ratio: 5/8)';
// With object-fit: cover, the image is drawn at max(viewport width, viewport height x aspect
// ratio). As on album pages, screens of 2x density or more get a copy for about 1.3x density.
const coverSizes = (p) => {
  const ar = p.width / p.height;
  const fill = (k) => `max(${k}vw, ${(k * ar).toFixed(1)}vh)`;
  return `(min-resolution: 2dppx) ${fill(65)}, ${fill(100)}`;
};

function background(home, base) {
  const { wide, portrait } = home;
  const vars = [
    `--bg-wide:url(&quot;${blurredPreview(wide)}&quot;)`,
    `--pos-wide:${esc(home.position)}`,
    ...(portrait ? [`--bg-portrait:url(&quot;${blurredPreview(portrait)}&quot;)`, `--pos-portrait:${esc(home.portraitPosition)}`] : []),
  ].join(';');
  const fallback = wide.sources.find((s) => s.w >= 1600) ?? wide.sources.at(-1);
  return `
    <picture class="home-bg">${portrait ? `
      <source media="${PORTRAIT_MEDIA}" srcset="${srcset(portrait, base)}" sizes="${coverSizes(portrait)}" width="${portrait.width}" height="${portrait.height}">` : ''}
      <img src="${base}${fallback.src}" srcset="${srcset(wide, base)}" sizes="${coverSizes(wide)}" width="${wide.width}" height="${wide.height}"
        alt="${esc(home.alt)}" fetchpriority="high" decoding="async" style="${vars}">
    </picture>`;
}

export function renderHome(manifest, base) {
  // Each link warms up its album's first photo on hover or touch (src/main.js).
  const links = manifest.albums.map((a) => `
          <li><a class="album-link" href="${base}${a.slug}/" data-warm-srcset="${srcset(a.photos[0], base)}" data-warm-sizes="${photoSizes(a.photos[0])}">${esc(a.title)}</a></li>`).join('');
  return {
    title: SITE_NAME,
    viewport: '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    body: `
  <main class="home">${manifest.home ? background(manifest.home, base) : ''}
    <div class="home-nav">
      <h1 class="wordmark">${SITE_NAME}</h1>
      <nav aria-label="Albums">
        <ul class="album-nav">${links}
        </ul>
      </nav>
    </div>
  </main>`,
  };
}

// The bar at the top of album pages: the site name (a link home) and every album, with the
// current one marked. The Space-key hint is shown by src/main.js on desktop only.
function albumBar(manifest, base, current = '') {
  const links = manifest.albums.map((a) => {
    const here = a.slug === current;
    const warm = here ? '' : ` data-warm-srcset="${srcset(a.photos[0], base)}" data-warm-sizes="${photoSizes(a.photos[0])}"`;
    return `
        <li><a class="bar-link" href="${base}${a.slug}/"${here ? ' aria-current="page"' : ''}${warm}><span>${esc(a.title)}</span></a></li>`;
  }).join('');
  return `
  <header class="album-bar">
    <a class="bar-home" href="${base}">${SITE_NAME}</a>
    <nav class="bar-nav" aria-label="Albums">
      <ul>${links}
      </ul>
    </nav>
    <p class="key-hint" hidden><kbd>Space</kbd> next <span aria-hidden="true">&middot;</span> <kbd>Shift</kbd> <kbd>Space</kbd> back</p>
  </header>`;
}

export function renderAlbum(album, base, manifest) {
  const photos = album.photos.map((p, i) => `
      <li style="--ar: ${(p.width / p.height).toFixed(4)}">
        <div class="photo">
          ${img(p, base, { sizes: photoSizes(p), eager: i === 0, auto: false })}
        </div>
      </li>`).join('');
  return {
    title: `${esc(album.title)} · ${SITE_NAME}`,
    body: `${albumBar(manifest, base, album.slug)}
  <main class="album">
    <h1 class="visually-hidden">${esc(album.title)}</h1>
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

export function renderNotFound(base, manifest) {
  return {
    title: `Not found · ${SITE_NAME}`,
    body: `${albumBar(manifest, base)}
  <main class="notfound">
    <h1>Page not found</h1>
  </main>`,
  };
}
