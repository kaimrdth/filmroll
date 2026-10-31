import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { renderAlbum, renderHome } from './scripts/render.js';

const manifestFile = new URL('./src/manifest.json', import.meta.url);
const loadManifest = () => JSON.parse(readFileSync(manifestFile, 'utf8'));

const fill = (template, { title, body }) =>
  template.replace('<!--title-->', title).replace('<!--body-->', body);

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
        const page = album ? renderAlbum(album, base) : renderHome(manifest, base);
        res.setHeader('Content-Type', 'text/html');
        res.end(await server.transformIndexHtml(req.url, fill(template, page)));
      });
    },

    generateBundle(_, bundle) {
      const template = bundle['index.html'].source;
      const manifest = loadManifest();
      bundle['index.html'].source = fill(template, renderHome(manifest, base));
      for (const album of manifest.albums) {
        this.emitFile({ type: 'asset', fileName: `${album.slug}/index.html`, source: fill(template, renderAlbum(album, base)) });
      }
    },
  };
}

export default defineConfig({
  // Set BASE_PATH when the site is served from a subfolder, e.g. BASE_PATH=/filmroll/
  base: process.env.BASE_PATH ?? '/',
  appType: 'mpa', // unknown URLs 404 in dev, as they will on a static host
  plugins: [filmrollPages()],
});
