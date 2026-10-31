import './style.css';

const dialog = document.querySelector('.viewer');
if (dialog) initViewer(dialog);

const photoList = document.querySelector('.photos');
if (photoList && matchMedia('(pointer: coarse)').matches) initTouchSettle(photoList);

// Homepage: when a pointer rests on an album (or a finger touches it), start loading
// that album's first photo, so it is ready when the album page opens.
for (const link of document.querySelectorAll('[data-warm-srcset]')) {
  const warm = () => {
    const img = new Image();
    img.sizes = link.dataset.warmSizes;
    img.srcset = link.dataset.warmSrcset;
  };
  link.addEventListener('pointerenter', warm, { once: true });
  link.addEventListener('touchstart', warm, { once: true, passive: true });
  link.addEventListener('focus', warm, { once: true });
}

function initViewer(dialog) {
  const view = dialog.querySelector('.viewer-img');
  const count = dialog.querySelector('.viewer-count');
  const links = [...document.querySelectorAll('.photo')];
  const photos = links.map((link) => {
    const img = link.querySelector('img');
    const sources = img.getAttribute('srcset').split(',').map((entry) => {
      const [url, w] = entry.trim().split(/\s+/);
      return { url: new URL(url, location.href).href, w: parseInt(w, 10) };
    });
    return { img, sources, ratio: img.width / img.height };
  });
  const ready = new Set();   // URLs that are downloaded and decoded
  const pending = new Map(); // URL -> load promise
  let index = 0;
  let shown = null;
  let request = 0;

  const load = (url) => {
    if (!pending.has(url)) {
      const img = new Image();
      img.src = url;
      pending.set(url, img.decode().then(() => ready.add(url)));
    }
    return pending.get(url);
  };

  // The smallest derivative that covers the viewer area at this screen's pixel density.
  const best = (photo) => {
    const box = view.getBoundingClientRect();
    const needed = Math.min(box.width, box.height * photo.ratio) * devicePixelRatio;
    return photo.sources.find((s) => s.w >= needed) ?? photo.sources.at(-1);
  };

  // The largest derivative already in memory: the album image or an earlier viewer image.
  const available = (photo) => {
    const thumb = photo.img.complete && photo.img.naturalWidth ? photo.img.currentSrc : '';
    return photo.sources.filter((s) => ready.has(s.url) || s.url === thumb).at(-1) ?? photo.sources[0];
  };

  const display = (photo, source) => {
    view.style.backgroundImage = photo.img.style.backgroundImage;
    view.src = source.url;
    view.alt = photo.img.alt;
    shown = source;
  };

  function show(i) {
    index = (i + photos.length) % photos.length;
    const photo = photos[index];
    const token = ++request;
    const target = best(photo);
    const now = ready.has(target.url) ? target : available(photo);
    if (shown !== now) display(photo, now);
    count.textContent = `${index + 1} / ${photos.length}`;

    const prefetchNeighbors = () => {
      if (token !== request || photos.length < 2) return;
      for (const j of new Set([index - 1, index + 1])) {
        load(best(photos[(j + photos.length) % photos.length]).url).catch(() => {});
      }
    };
    if (now.w >= target.w) return prefetchNeighbors();
    load(target.url)
      .then(() => { if (token === request) display(photo, target); })
      .catch(() => {})
      .finally(prefetchNeighbors);
  }

  links.forEach((link, i) => link.addEventListener('click', (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; // let the browser open a new tab
    event.preventDefault();
    // A <dialog> returns focus to the element that opened it, which would scroll the page
    // back to the first photo viewed. Removing focus first leaves that to the close handler.
    link.blur();
    shown = null;
    dialog.showModal();
    show(i);
  }));

  // Put the photo that is on screen in the middle of the page while the viewer still covers
  // the page, so the page does not visibly jump when the viewer closes.
  const placePage = () => {
    const link = links[index];
    const rect = link.getBoundingClientRect();
    if (Math.abs(rect.top + rect.height / 2 - innerHeight / 2) > 2) link.scrollIntoView({ block: 'center' });
  };
  dialog.addEventListener('cancel', placePage); // Escape
  dialog.querySelector('.viewer-close').addEventListener('click', () => { placePage(); dialog.close(); });
  dialog.querySelector('.viewer-prev').addEventListener('click', () => show(index - 1));
  dialog.querySelector('.viewer-next').addEventListener('click', () => show(index + 1));

  // Escape is handled natively by <dialog>.
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); show(index - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); show(index + 1); }
  });

  // On close, return to the photo that was last on screen.
  dialog.addEventListener('close', () => {
    view.removeAttribute('src');
    view.style.backgroundImage = '';
    placePage();
    links[index].focus({ preventScroll: true });
  });

  // Horizontal swipe on touch screens. Pinch zoom is left alone.
  let touch = null;
  dialog.addEventListener('touchstart', (e) => {
    touch = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, { passive: true });
  dialog.addEventListener('touchend', (e) => {
    if (!touch || e.changedTouches.length !== 1 || (visualViewport?.scale ?? 1) > 1.05) return;
    const dx = e.changedTouches[0].clientX - touch.x;
    const dy = e.changedTouches[0].clientY - touch.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) show(index + (dx < 0 ? 1 : -1));
    touch = null;
  }, { passive: true });

  // A larger window may need a larger derivative.
  let resizeTimer;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (dialog.open) show(index); }, 150);
  });
}

// Touch screens: native scrolling handles each swipe, momentum included. When the scrolling
// stops, the page glides to the nearest photo, centered. A short swipe that stopped before it
// reached the next photo moves on to that photo, so a small flick is enough to advance.
// (Native proximity snapping would return to the same photo after a short swipe.)
function initTouchSettle(list) {
  const root = document.documentElement;
  const items = [...list.children];
  const NUDGE = 24; // px of scrolling that counts as an intent to move on
  let gesture = null;
  let touching = false;
  let timer;
  root.classList.add('touch-settle');

  // Scroll positions where the page can rest: the top of the page, and each photo centered.
  const stops = () => {
    const max = root.scrollHeight - innerHeight;
    const centers = items.map((li) => {
      const r = li.getBoundingClientRect();
      return Math.round(Math.min(max, Math.max(0, scrollY + r.top + r.height / 2 - innerHeight / 2)));
    });
    return [...new Set([0, ...centers])];
  };
  const nearest = (list, y) => list.reduce((best, s, i) => (Math.abs(s - y) < Math.abs(list[best] - y) ? i : best), 0);

  function settle() {
    clearTimeout(timer);
    if (touching || !gesture || dialogOpen()) return;
    const list = stops();
    const y = scrollY;
    const moved = y - gesture.y;
    const from = gesture.from;
    gesture = null;
    if (Math.abs(moved) < 3) return; // a tap, not a swipe
    let to = nearest(list, y);
    if (to === from && Math.abs(moved) >= NUDGE) to = Math.min(list.length - 1, Math.max(0, to + Math.sign(moved)));
    if (Math.abs(list[to] - y) > 1) scrollTo({ top: list[to], behavior: 'smooth' });
  }
  const dialogOpen = () => !!document.querySelector('.viewer[open]');
  const later = () => { clearTimeout(timer); timer = setTimeout(settle, 150); };

  addEventListener('touchstart', () => {
    touching = true;
    clearTimeout(timer);
    gesture = { y: scrollY, from: nearest(stops(), scrollY) };
  }, { passive: true });
  addEventListener('touchend', () => { touching = false; later(); }, { passive: true });
  addEventListener('touchcancel', () => { touching = false; later(); }, { passive: true });
  // Momentum keeps firing scroll events; settle once they stop. 'scrollend' is sooner where supported.
  addEventListener('scroll', () => { if (gesture && !touching) later(); }, { passive: true });
  addEventListener('scrollend', () => { if (!touching) settle(); });
}
