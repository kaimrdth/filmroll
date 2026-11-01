import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { renderAlbum, renderHome, renderNotFound } from './scripts/render.js';

const manifestFile = new URL('./src/manifest.json', import.meta.url);
const loadManifest = () => JSON.parse(readFileSync(manifestFile, 'utf8'));

const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1">';
const fill = (template, { title, body, viewport = VIEWPORT }) =>
  template.replace('<!--viewport-->', viewport).replace('<!--title-->', title).replace('<!--body-->', body);

// Turns index.html into one static page per album, plus the homepage.
function filmrollPages() {
  let base = '/';
  return {
    name: 'filmroll-pages',
    enforce: 'post', // run after Vite has written index.html
    configResolved(config) { base = config.base; },

    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://x');
        const slug = url.pathname.slice(base.length).replace(/\/$/, '');
        if (slug.includes('/') || slug.includes('.')) return next();
        const manifest = loadManifest();
        const album = manifest.albums.find((a) => a.slug === slug);
        if (slug && !album) return next();
        if (slug && !url.pathname.endsWith('/')) { res.writeHead(301, { Location: `${url.pathname}/` }); return res.end(); }
        const template = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
        const page = album ? renderAlbum(album, base, manifest) : renderHome(manifest, base);
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml(req.url, fill(template, page)));
      });
    },

    generateBundle(_, bundle) {
      // Inline the small stylesheet, so the first paint does not wait for a second request.
      let template = bundle['index.html'].source;
      for (const [file, asset] of Object.entries(bundle)) {
        if (!file.endsWith('.css')) continue;
        template = template.replace(new RegExp(`<link rel="stylesheet"[^>]*href="${base}${file}">`), `<style>${asset.source}</style>`);
        delete bundle[file];
      }
      const manifest = loadManifest();
      bundle['index.html'].source = fill(template, renderHome(manifest, base));
      for (const album of manifest.albums) {
        this.emitFile({ type: 'asset', fileName: `${album.slug}/index.html`, source: fill(template, renderAlbum(album, base, manifest)) });
      }
      // Netlify and most static hosts serve 404.html for unknown URLs.
      this.emitFile({ type: 'asset', fileName: '404.html', source: fill(template, renderNotFound(base, manifest)) });
    },
  };
}

export default defineConfig({
  // Set BASE_PATH when the site is served from a subfolder, e.g. BASE_PATH=/filmroll/
  base: process.env.BASE_PATH ?? '/',
  appType: 'mpa', // unknown URLs 404 in dev, as they will on a static host
  plugins: [filmrollPages()],
});
