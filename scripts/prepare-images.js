// Builds optimized WebP viewing copies of every photo in photos/<album>/
// and writes src/manifest.json. Source scans are only read, never changed.
// Re-running is cheap: derivatives are reused while their source is unchanged.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const PHOTOS = path.join(ROOT, 'photos');
const OUT = path.join(ROOT, 'public', 'img'); // copied into dist/ by Vite
const MANIFEST = path.join(ROOT, 'src', 'manifest.json');

// 1200 suits phones (about 1050 px needed at 3x) and portrait photos on 2x laptops.
const WIDTHS = [480, 960, 1200, 1600, 2400];
const WEBP = { quality: 82, effort: 5, smartSubsample: true };
// The two largest sizes are mostly seen on high-density screens, where each image pixel
// is small, so they use a lower quality. This saves about 20% on the largest files.
const QUALITY_BY_WIDTH = { 1600: 78, 2400: 78 };
// The blurred preview that is inlined in the HTML: 20 px on the long edge.
const LQIP = { size: 20, webp: { quality: 50, effort: 6 } };
const LQIP_ID = JSON.stringify(LQIP);
const SOURCE_EXT = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp']);
// The settings for each width are part of that width's filename, so changing them
// regenerates only the files they apply to. Adding or removing a width only creates
// or removes the files for that width.
const webpFor = (w) => ({ ...WEBP, quality: QUALITY_BY_WIDTH[w] ?? WEBP.quality });
const settingsId = (webp) => createHash('sha1').update(JSON.stringify({ WEBP: webp, v: 2 })).digest('hex');
const SETTINGS = settingsId(WEBP);

const naturalSort = (a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });
const titleFromSlug = (slug) => slug.split(/[-_ ]+/).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const sha1 = (data) => createHash('sha1').update(data).digest('hex');

async function readJSON(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw new Error(`Could not read ${path.relative(ROOT, file)}: ${err.message}`);
  }
}

// Derivative widths, capped at the original width.
const widthsFor = (width) => [...new Set(WIDTHS.map((w) => Math.min(w, width)))];

async function processImage({ album, name, input, hash, prev }) {
  const key = sha1(hash + SETTINGS).slice(0, 10);
  const keyFor = (w) => sha1(hash + settingsId(webpFor(w))).slice(0, 10);
  const base = name.toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/g, '-');
  const meta = await sharp(input).metadata();
  // Orientations 5-8 swap width and height.
  const swap = (meta.orientation ?? 1) >= 5;
  const width = swap ? meta.height : meta.width;
  const height = swap ? meta.width : meta.height;

  const sources = [];
  let created = 0;
  for (const w of widthsFor(width)) {
    const h = Math.round((height * w) / width);
    const rel = `img/${album}/${base}.${keyFor(w)}-${w}.webp`;
    const file = path.join(ROOT, 'public', rel);
    if (!existsSync(file)) {
      await sharp(input)
        .autoOrient()                 // apply EXIF orientation
        .resize({ width: w, height: h, fit: 'fill', kernel: 'lanczos3' })
        .withIccProfile('srgb')       // convert from the embedded profile (e.g. Display P3) and tag as sRGB
        .webp(webpFor(w))
        .toFile(file);
      created++;
    }
    sources.push({ w, h, src: rel });
  }

  // A tiny preview, shown blurred while the real image loads. Reused while the source is unchanged.
  let lqip = prev?.key === key && prev.lqipId === LQIP_ID ? prev.lqip : null;
  if (!lqip) {
    // Converted to sRGB but not tagged: the 480-byte profile would be most of the file.
    const buf = await sharp(input)
      .autoOrient()
      .resize({ width: LQIP.size, height: LQIP.size, fit: 'inside' })
      .webp(LQIP.webp)
      .toBuffer();
    lqip = `data:image/webp;base64,${buf.toString('base64')}`;
  }
  return { key, width, height, sources, lqip, lqipId: LQIP_ID, created };
}

async function run() {
  const started = Date.now();
  const meta = await readJSON(path.join(PHOTOS, 'albums.json'), {});
  const previous = await readJSON(MANIFEST, { albums: [] });
  const known = new Map(previous.albums.flatMap((a) => a.photos.map((p) => [`${a.slug}/${p.file}`, p])));

  const dirs = (await readdir(PHOTOS, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name);
  // Albums listed in albums.json come first, in that order; the rest follow by name.
  const listed = Object.keys(meta).filter((slug) => dirs.includes(slug));
  const slugs = [...listed, ...dirs.filter((d) => !listed.includes(d)).sort(naturalSort)];

  const jobs = [];
  const albums = [];
  for (const slug of slugs) {
    const info = meta[slug] ?? {};
    const title = info.title ?? titleFromSlug(slug);
    const files = (await readdir(path.join(PHOTOS, slug)))
      .filter((f) => !f.startsWith('.') && SOURCE_EXT.has(path.extname(f).toLowerCase()))
      .sort(naturalSort);

    if (!files.length) {
      console.log(`images: skipped photos/${slug}/ (no photos)`);
      continue;
    }
    const items = await Promise.all(files.map(async (file) => {
      const input = path.join(PHOTOS, slug, file);
      const { size, mtimeMs } = await stat(input);
      const prev = known.get(`${slug}/${file}`);
      const seen = prev?.source;
      // Hash only files whose size or modification time changed.
      const hash = seen && seen.size === size && seen.mtimeMs === mtimeMs
        ? seen.hash : sha1(await readFile(input));
      return { name: file, input, hash, prev, source: { size, mtimeMs, hash } };
    }));

    const album = { slug, title, cover: 0, photos: [] };
    items.forEach((item, i) => {
      const alt = info.alt?.[item.name] ?? `${title}, photo ${i + 1} of ${items.length}`;
      album.photos[i] = { file: item.name, alt, source: item.source };
      jobs.push(async () => Object.assign(album.photos[i], await processImage({ album: slug, ...item })));
    });
    albums.push({ album, coverName: info.cover });
  }

  if (!albums.length) throw new Error('No photos found. Add photos to photos/<album>/ and run again.');
  await Promise.all(albums.map(({ album }) => mkdir(path.join(OUT, album.slug), { recursive: true })));

  // Process a few images at a time; each one decodes a large scan.
  let next = 0, created = 0, done = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(4, availableParallelism() - 1)) }, async () => {
    while (next < jobs.length) {
      const photo = await jobs[next++]();
      created += photo.created;
      done++;
      if (photo.created) process.stdout.write(`\r  ${done}/${jobs.length} photos`);
    }
  });
  await Promise.all(workers);
  if (created) process.stdout.write('\n');

  for (const { album, coverName } of albums) {
    // Cover: the file named in albums.json, else the first landscape photo, else the first photo.
    const named = album.photos.findIndex((p) => p.file === coverName);
    const landscape = album.photos.findIndex((p) => p.width > p.height);
    album.cover = named >= 0 ? named : Math.max(0, landscape);
    for (const p of album.photos) delete p.created;
  }
  const manifest = { generated: new Date().toISOString(), albums: albums.map((a) => a.album) };
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

  // Remove derivatives that no photo uses any more, and folders of albums that are gone.
  const used = new Set(manifest.albums.flatMap((a) => a.photos.flatMap((p) => p.sources.map((s) => s.src))));
  const current = new Set(manifest.albums.map((a) => a.slug));
  let removed = 0;
  for (const dir of await readdir(OUT, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    if (!current.has(dir.name)) {
      removed += (await readdir(path.join(OUT, dir.name))).length;
      await rm(path.join(OUT, dir.name), { recursive: true, force: true });
      continue;
    }
    for (const f of await readdir(path.join(OUT, dir.name))) {
      if (!used.has(`img/${dir.name}/${f}`)) { await unlink(path.join(OUT, dir.name, f)); removed++; }
    }
  }

  const count = manifest.albums.reduce((n, a) => n + a.photos.length, 0);
  console.log(`images: ${manifest.albums.length} albums, ${count} photos, ${created} derivatives created, `
    + `${used.size - created} reused, ${removed} removed (${((Date.now() - started) / 1000).toFixed(1)}s)`);
}

run().catch((err) => { console.error(err.message); process.exit(1); });
