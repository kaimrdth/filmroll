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

An empty album folder shows labeled placeholder images until you add photos (`photos/seoul/` is empty now).

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
- writes WebP copies (quality 82) at 480, 960, 1600 and 2400 pixels wide, capped at the original width, to `public/img/<album>/`;
- removes all other metadata (EXIF, GPS);
- writes `src/manifest.json` with the albums, photo dimensions and derivative paths.

Each derivative name contains a hash of the source file and the settings. If a source file does not change, the script reuses its derivatives. If you change or delete a source file, the script makes new derivatives and deletes the old ones.

`photos/` is outside `public/`, so the original scans are never part of the deployed site.

## Production build

```sh
npm run build      # prepares images, then writes the static site to dist/
npm run preview    # serves dist/ at http://localhost:4173 to check it
```

## Deploy

`dist/` is a complete static site. Upload it to any static host, for example Netlify, Cloudflare Pages, GitHub Pages, or an S3 bucket. No server configuration is necessary, because each album is a real `<album>/index.html` file.

If the site is not at the root of its domain (for example `https://example.com/filmroll/`), set the base path when you build:

```sh
BASE_PATH=/filmroll/ npm run build
```

The derivative filenames change when their content changes, so the host can cache `/img/` and `/assets/` for a long time.

## Files

```
photos/                  source scans, one folder per album (not deployed)
photos/albums.json       optional titles, covers and alt text
scripts/prepare-images.js  makes the WebP derivatives and the manifest
scripts/render.js        HTML for the homepage and the album pages
src/main.js              the photo viewer (the only client-side JavaScript)
src/style.css            all styles
vite.config.js           makes one static page per album
```
