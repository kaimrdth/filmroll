// Builds optimized WebP viewing copies of every photo in photos/<album>/
// and writes src/manifest.json. Source scans are only read, never changed.
// Re-running is cheap: derivatives are reused while their source is unchanged.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const PHOTOS = path.join(ROOT, 'photos');
const OUT = path.join(ROOT, 'public', 'img'); // copied into dist/ by Vite
const MANIFEST = path.join(ROOT, 'src', 'manifest.json');

const WIDTHS = [480, 960, 1600, 2400];
const WEBP = { quality: 82, effort: 5, smartSubsample: true };
const SOURCE_EXT = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp']);
// Part of every derivative name, so changing the settings regenerates everything.
const SETTINGS = createHash('sha1').update(JSON.stringify({ WIDTHS, WEBP, v: 1 })).digest('hex');

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

async function processImage({ album, name, input, hash }) {
  const key = sha1(hash + SETTINGS).slice(0, 10);
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
    const rel = `img/${album}/${base}.${key}-${w}.webp`;
    const file = path.join(ROOT, 'public', rel);
    if (!existsSync(file)) {
      await sharp(input)
        .autoOrient()                 // apply EXIF orientation
        .resize({ width: w, height: h, fit: 'fill', kernel: 'lanczos3' })
        .withIccProfile('srgb')       // convert from the embedded profile (e.g. Display P3) and tag as sRGB
        .webp(WEBP)
        .toFile(file);
      created++;
    }
    sources.push({ w, h, src: rel });
  }
  return { width, height, sources, created };
}

// Clearly labeled stand-ins for an album folder that has no photos yet.
function placeholders(title) {
  const shapes = [[3000, 2000], [2000, 3000], [3000, 2000], [3000, 2000]];
  return shapes.map(([w, h], i) => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <rect width="100%" height="100%" fill="#e9e8e4"/>
      <rect x="40" y="40" width="${w - 80}" height="${h - 80}" fill="none" stroke="#c9c7c0" stroke-width="6" stroke-dasharray="30 20"/>
      <g font-family="Helvetica, Arial, sans-serif" fill="#8a877f" text-anchor="middle">
        <text x="50%" y="46%" font-size="${w / 14}" letter-spacing="${w / 120}">PLACEHOLDER</text>
        <text x="50%" y="56%" font-size="${w / 28}">${title} · ${i + 1} of ${shapes.length} · ${w > h ? 'landscape' : 'portrait'}</text>
      </g></svg>`;
    return { name: `placeholder-${i + 1}.svg`, input: Buffer.from(svg), hash: sha1(svg) };
  });
}

async function run() {
  const started = Date.now();
  const meta = await readJSON(path.join(PHOTOS, 'albums.json'), {});
  const previous = await readJSON(MANIFEST, { albums: [] });
  const known = new Map(previous.albums.flatMap((a) => a.photos.map((p) => [`${a.slug}/${p.file}`, p.source])));

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

    let items;
    if (files.length) {
      items = await Promise.all(files.map(async (file) => {
        const input = path.join(PHOTOS, slug, file);
        const { size, mtimeMs } = await stat(input);
        const prev = known.get(`${slug}/${file}`);
        // Hash only files whose size or modification time changed.
        const hash = prev && prev.size === size && prev.mtimeMs === mtimeMs
          ? prev.hash : sha1(await readFile(input));
        return { name: file, input, hash, source: { size, mtimeMs, hash } };
      }));
    } else {
      items = placeholders(title);
    }

    const album = { slug, title, placeholder: !files.length, cover: 0, photos: [] };
    items.forEach((item, i) => {
      const alt = info.alt?.[item.name]
        ?? (album.placeholder ? `Placeholder image ${i + 1} for ${title}` : `${title}, photo ${i + 1} of ${items.length}`);
      album.photos[i] = { file: item.name, alt, source: item.source };
      jobs.push(async () => Object.assign(album.photos[i], await processImage({ album: slug, ...item })));
    });
    albums.push({ album, coverName: info.cover });
  }

  await Promise.all(slugs.map((slug) => mkdir(path.join(OUT, slug), { recursive: true })));

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

  // Remove derivatives that no photo uses any more.
  const used = new Set(manifest.albums.flatMap((a) => a.photos.flatMap((p) => p.sources.map((s) => s.src))));
  let removed = 0;
  for (const dir of await readdir(OUT, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const f of await readdir(path.join(OUT, dir.name))) {
      if (!used.has(`img/${dir.name}/${f}`)) { await unlink(path.join(OUT, dir.name, f)); removed++; }
    }
  }

  const count = manifest.albums.reduce((n, a) => n + a.photos.length, 0);
  console.log(`images: ${manifest.albums.length} albums, ${count} photos, ${created} derivatives created, `
    + `${used.size - created} reused, ${removed} removed (${((Date.now() - started) / 1000).toFixed(1)}s)`);
}

run().catch((err) => { console.error(err.message); process.exit(1); });
