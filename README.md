# filmroll

A minimal static site for Kai and Carol's travel film photographs.

Each folder in `photos/` is an album. A build script makes optimized WebP copies of the scans, and Vite writes one static HTML page for the homepage and one for each album.

## Install and run locally

You need Node.js 20.19 or later (22 LTS recommended).

```sh
npm install
npm run dev        # prepares images, then serves the site at http://localhost:5173
```

The first image preparation takes a few minutes, because every scan is decoded. After that it takes about a second.

## Add photographs and albums

1. Make a folder in `photos/`. The folder name becomes the album URL (for example, `photos/kyoto/` becomes `/kyoto/`).
2. Put the scans in the folder (`.jpg`, `.jpeg`, `.png`, `.tif`, `.tiff` or `.webp`). Photos show in filename order (`IMG_2.jpg` comes before `IMG_10.jpg`).
3. Run `npm run images`, or restart `npm run dev`.

The site skips album folders that have no photos.

### Optional metadata: `photos/albums.json`

```json
{
  "hong-kong": {
    "title": "Hong Kong",
    "cover": "IMG_3528.JPG",
    "alt": { "IMG_3525.JPG": "Tram crossing a street at dusk" }
  },
  "tokyo": { "title": "Tokyo" }
}
```

- The order of the albums in this file is the order on the homepage. Albums not in the file come after, in alphabetical order.
- `title`: the place name. If you omit it, the title comes from the folder name (`hong-kong` becomes "Hong Kong").
- `cover`: the cover photo. If you omit it, the cover is the first landscape photo in the album. Covers show in a 3:2 frame.
- `alt`: alt text for each photo, by filename. If you omit it, the alt text is "Tokyo, photo 3 of 32".

## Image preparation

`npm run images` runs `scripts/prepare-images.js`. For each scan, it:

- reads the source file and does not change it;
- applies the EXIF orientation;
- converts from the embedded color profile (for example Display P3) to sRGB, and tags the output as sRGB;
- writes WebP copies at 480, 960, 1200, 1600 and 2400 pixels wide, capped at the original width, to `public/img/<album>/` (quality 82, and 78 for the two largest sizes, which are mostly seen on high-density screens);
- removes all other metadata (EXIF, GPS);
- makes a tiny preview (20 pixels on the long edge, about 200 bytes);
- writes `src/manifest.json` with the albums, photo dimensions, derivative paths and previews.

Each derivative name contains a hash of the source file and the settings. If a source file does not change, the script reuses its derivatives. If you change or delete a source file, the script makes new derivatives and deletes the old ones.

`photos/` is outside `public/`, so the original scans are never part of the deployed site.

## How the images load fast

- Each page contains a blurred preview of every photo (an inlined SVG blur of the tiny preview). The previews show with the first paint, before any image downloads.
- The browser selects the smallest WebP copy that is sharp on the screen (`srcset` and `sizes`). The first photo on a page loads with high priority; the others load as they come near the screen.
- In the album column, desktop screens of 2x density or more get a copy for about 1.3x density. This halves the data of an album scroll. The viewer still loads a copy that is sharp at full density. To turn this off, remove the `min-resolution` line from `photoSizes` in `scripts/render.js`.
- The stylesheet is inlined in each page, so the first paint does not wait for a second request.
- On the homepage, when a pointer rests on an album or a finger touches it, the album's first photo starts to load. Chromium browsers also prefetch the album pages and fully render a page in advance when a pointer rests on its link (speculation rules in `index.html`).
- The viewer shows the photo that is already loaded, loads a copy that suits the screen, and prefetches the two neighboring photos.

## Production build

```sh
npm run build      # prepares images, then writes the static site to dist/
npm run preview    # serves dist/ at http://localhost:4173 to check it
```

## Deploy to Netlify

The repo does not contain the source scans. It contains the WebP copies (`public/img/`) and `src/manifest.json`, which `npm run images` makes on your computer. Netlify builds only the HTML pages (`npm run build:site`), so it does not need the scans. `netlify.toml` holds the build settings and the cache headers.

To set up the site one time, import the `kaimrdth/filmroll` repo from GitHub in Netlify. Keep the settings that Netlify reads from `netlify.toml`.

To publish new or changed photos:

```sh
npm run images
git add photos/albums.json public/img src/manifest.json
git commit -m "Add new photos"
git push
```

Netlify deploys each push to `main`.

### Other static hosts

`npm run build` writes a complete static site to `dist/`. Upload `dist/` to any static host. Each album is a real `<album>/index.html` file, so the host needs no special configuration.

If the site is not at the root of its domain (for example `https://example.com/filmroll/`), set the base path when you build:

```sh
BASE_PATH=/filmroll/ npm run build
```

## Files

```
photos/                  source scans, one folder per album (not deployed)
photos/albums.json       optional titles, covers and alt text
scripts/prepare-images.js  makes the WebP derivatives and the manifest
scripts/render.js        HTML for the homepage and the album pages
src/main.js              the photo viewer (the only client-side JavaScript)
src/style.css            all styles
vite.config.js           makes one static page per album
netlify.toml             Netlify build settings and cache headers
```
