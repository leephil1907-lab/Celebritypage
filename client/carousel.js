/**
 * client/carousel.js — one carousel engine for the whole site.
 * Modes: fade (hero) | rail (cards, drag-scroll) | coverflow (media).
 * Autoplay + progress, keyboard, pointer drag/swipe, dots/thumbs, loop, swipe velocity,
 * reduced-motion aware, ARIA live + tablist dots. Works with JS disabled? Content is server
 * rendered; this only adds motion, and if anything throws the markup stays usable.
 */

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;

function numberAttr(el, name, fb) {
  const v = Number(el.dataset[name]);
  return Number.isFinite(v) && v > 0 ? v : fb;
}

export class Carousel {
  constructor(root, opts = {}) {
    if (root.__carousel) return root.__carousel;
    this.root = root;
    this.track = root.querySelector('[data-c-track]');
    this.viewport = root.querySelector('[data-c-viewport]') || root.querySelector('.c-viewport');
    this.items = [...root.querySelectorAll('[data-c-slide]')];
    this.dotsWrap = root.querySelector('[data-c-dots]');
    this.arrows = { prev: root.querySelector('[data-c-prev]'), next: root.querySelector('[data-c-next]') };
    this.progress = root.querySelector('[data-c-progress] i, [data-c-progress] > *');
    this.counter = root.querySelector('[data-c-counter]');
    this.media = [...root.querySelectorAll('[data-c-media]')];

    this.opts = {
      mode: opts.mode || root.dataset.cMode || (this.items.length && this.track ? 'fade' : 'rail'),
      interval: numberAttr(root, 'cInterval', 6000),
      autoplay: (root.dataset.cAutoplay ?? '1') !== '0',
      loop: (root.dataset.cLoop ?? '1') !== '0',
      perView: numberAttr(root, 'cPerView', 1),
      gap: numberAttr(root, 'cGap', 16),
      parallax: root.dataset.cParallax !== '0',
      kenburns: root.dataset.cKenburns !== '0',
      swipeThreshold: numberAttr(root, 'cSwipe', 45),
    };
    this.i = clamp(numberAttr(root, 'cStart', 1) - 1, 0, Math.max(0, this.items.length - 1));
    this.timer = null;
    this.paused = false;
    this.drag = null;

    this.root.__carousel = this;
    this.root.classList.add('carousel', `is-${this.opts.mode}`);
    this.items.forEach((el) => el.setAttribute('role', 'group'));
    this.build();
    this.bind();
    this.go(this.i, { instant: true });
    if (this.opts.autoplay && !reduced()) this.play();
    this.observe();
  }

  get count() { return this.items.length || 1; }
  get perView() {
    if (this.opts.mode === 'fade') return 1;
    const w = this.viewport?.clientWidth || window.innerWidth;
    const auto = Number(this.opts.perView);
    if (w < 560) return Math.min(1.15, auto);
    if (w < 900) return Math.min(2, auto);
    return auto;
  }

  build() {
    if (this.opts.mode === 'fade') {
      this.items.forEach((el, i) => el.setAttribute('aria-hidden', i === this.i ? 'false' : 'true'));
    }
    if (this.dotsWrap) {
      this.dotsWrap.innerHTML = '';
      this.dots = this.items.map((el, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'c-dot';
        b.dataset.cDot = String(i);
        b.setAttribute('aria-label', `Slide ${i + 1} of ${this.count}`);
        b.innerHTML = `<i></i><span>${String(i + 1).padStart(2, '0')}</span>`;
        this.dotsWrap.appendChild(b);
        return b;
      });
    }
    if (this.counter) this.paintCounter();
  }

  bind() {
    this.onKey = (e) => {
      if (['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) {
        if (e.key === 'ArrowRight') { this.next(); e.preventDefault(); }
        if (e.key === 'ArrowLeft') { this.prev(); e.preventDefault(); }
        if (e.key === 'Home') { this.go(0); e.preventDefault(); }
        if (e.key === 'End') { this.go(this.count - 1); e.preventDefault(); }
        this.restart();
      }
      if (e.key === 'Escape' && this.root.dataset.cLightbox === '1') this.root.dispatchEvent(new CustomEvent('carousel:close'));
    };
    this.root.addEventListener('keydown', this.onKey);

    this.arrows.prev?.addEventListener('click', () => { this.prev(); this.restart(); });
    this.arrows.next?.addEventListener('click', () => { this.next(); this.restart(); });
    this.root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-c-dot]');
      if (!b) return;
      e.preventDefault();
      this.go(Number(b.dataset.cDot));
      this.restart();
    });

    const hoverPause = () => { this.paused = true; this.root.classList.add('is-paused'); };
    const hoverResume = () => { this.paused = false; this.root.classList.remove('is-paused'); this.startTimer(); };
    this.root.addEventListener('mouseenter', hoverPause);
    this.root.addEventListener('mouseleave', hoverResume);
    this.root.addEventListener('focusin', hoverPause);
    this.root.addEventListener('focusout', () => { if (!this.root.contains(document.activeElement)) hoverResume(); });

    const toggle = this.root.querySelector('[data-c-toggle]');
    toggle?.addEventListener('click', () => {
      this.opts.autoplay = !this.opts.autoplay;
      this.opts.autoplay ? this.play() : this.stop();
      toggle.setAttribute('aria-pressed', String(this.opts.autoplay));
      toggle.textContent = this.opts.autoplay ? '❚❚' : '▶';
    });

    // pointer drag / swipe
    const vp = this.viewport || this.root;
    vp.addEventListener('pointerdown', (e) => this.dragStart(e));
    vp.addEventListener('pointermove', (e) => this.dragMove(e));
    vp.addEventListener('pointerup', (e) => this.dragEnd(e));
    vp.addEventListener('pointercancel', () => this.dragEnd());
    vp.addEventListener('dragstart', (e) => e.preventDefault());

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stopTimer(); else this.startTimer();
    });

    this.onResize = () => this.layout();
    window.addEventListener('resize', this.onResize, { passive: true });
  }

  observe() {
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        this.inView = en.isIntersecting;
        if (this.inView) this.startTimer(); else this.stopTimer();
      });
    }, { threshold: 0.25 });
    io.observe(this.root);
    this.io = io;
  }

  dragStart(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('a,button,input,select,textarea') && e.pointerType === 'mouse') return;
    this.drag = { x: e.clientX, y: e.clientY, dx: 0, id: e.pointerId, t: Date.now(), captured: false };
    this.stopTimer();
  }

  dragMove(e) {
    if (!this.drag) return;
    this.drag.dx = e.clientX - this.drag.x;
    // only take the pointer once the drag is real — capturing on pointerdown would retarget the
    // click away from cards inside the slide (vault, releases, shop) and swallow their handlers
    if (!this.drag.captured && Math.abs(this.drag.dx) > 8) {
      this.drag.captured = true;
      this.root.classList.add('is-dragging');
      this.viewport?.setPointerCapture?.(this.drag.id);
    }
    if (Math.abs(this.drag.dx) > 6) e.preventDefault?.();
    if (this.opts.mode === 'rail' || this.opts.mode === 'coverflow') {
      const w = this.slotWidth();
      this.track.style.transition = 'none';
      this.track.style.transform = `translate3d(${-this.i * w + this.drag.dx}px,0,0)`;
    } else {
      const op = clamp(1 - Math.abs(this.drag.dx) / 600, 0.35, 1);
      this.items[this.i].style.opacity = String(op);
    }
  }

  dragEnd() {
    if (!this.drag) return;
    const { dx, t, captured } = this.drag;
    const dt = Math.max(Date.now() - t, 1);
    const v = Math.abs(dx) / dt;
    this.root.classList.remove('is-dragging');
    if (!captured) { this.drag = null; this.startTimer(); return; }   // a click, not a swipe
    this.items.forEach((el) => { el.style.opacity = ''; });
    if (Math.abs(dx) > this.opts.swipeThreshold || v > 0.55) {
      dx < 0 ? this.next() : this.prev();
    } else {
      this.go(this.i);
    }
    this.drag = null;
    this.startTimer();
  }

  slotWidth() {
    const gap = this.opts.gap;
    const w = (this.viewport?.clientWidth || this.root.clientWidth) - gap * (this.perView - 1);
    return w / this.perView;
  }

  layout() {
    if (this.opts.mode === 'fade') return;
    const per = this.perView;
    const w = this.slotWidth();
    this.items.forEach((el) => { el.style.flex = `0 0 ${w}px`; el.style.marginRight = `${this.opts.gap}px`; });
    this.track.style.transition = 'none';
    this.track.style.transform = `translate3d(${-this.i * w}px,0,0)`;
    requestAnimationFrame(() => { this.track.style.transition = ''; });
  }

  paintCounter() {
    if (this.counter) this.counter.textContent = `${String(this.i + 1).padStart(2, '0')} / ${String(this.count).padStart(2, '0')}`;
  }

  go(n, { instant = false } = {}) {
    const max = this.opts.mode === 'fade' ? this.count : Math.max(1, this.count - Math.floor(this.perView));
    let i = n;
    if (this.opts.loop) i = ((n % this.count) + this.count) % this.count;
    else i = clamp(n, 0, max - 1);
    const prev = this.i;
    this.i = i;

    if (this.opts.mode === 'fade') {
      this.items.forEach((el, k) => {
        const on = k === i;
        el.classList.toggle('is-active', on);
        el.setAttribute('aria-hidden', on ? 'false' : 'true');
        if (on) {
          el.querySelectorAll('[data-c-in]').forEach((n2, j) => {
            n2.classList.remove('c-in');
            void n2.offsetWidth;
            n2.style.animationDelay = `${j * 90}ms`;
            n2.classList.add('c-in');
          });
          const img = el.querySelector('[data-c-ken], img');
          if (img && this.opts.kenburns && !reduced() && !instant) {
            img.classList.remove('c-ken'); void img.offsetWidth; img.classList.add('c-ken');
          }
        }
      });
      // crossfade the outer media (side art) when present
      this.media.forEach((m, k) => m.classList.toggle('is-active', k === i));
    } else {
      const w = this.slotWidth();
      if (instant) this.track.style.transition = 'none';
      this.track.style.transform = `translate3d(${-i * w}px,0,0)`;
      if (instant) requestAnimationFrame(() => { this.track.style.transition = ''; });
      this.items.forEach((el, k) => el.classList.toggle('is-active', k === i));
    }

    this.root.querySelectorAll('[data-c-dot]').forEach((d, k) => {
      if (this.dotsWrap && this.dotsWrap.contains(d)) return;
      d.classList.toggle('is-active', k === i);
    });
    this.dots?.forEach((d, k) => {
      const on = k === i;
      d.classList.toggle('is-active', on);
      d.setAttribute('aria-current', on ? 'true' : 'false');
      const bar = d.querySelector('i');
      if (bar) { bar.style.animation = 'none'; if (on && this.opts.autoplay && !reduced() && !this.paused) bar.style.animation = `c-fill ${this.opts.interval}ms linear forwards`; }
    });

    if (this.progress) {
      this.progress.style.transition = 'none';
      this.progress.style.width = '0%';
      requestAnimationFrame(() => {
        if (this.opts.autoplay && !reduced() && !this.paused) {
          this.progress.style.transition = `width ${this.opts.interval}ms linear`;
          this.progress.style.width = '100%';
        }
      });
    }

    this.paintCounter();
    if (prev !== i) this.root.dispatchEvent(new CustomEvent('carousel:change', { bubbles: true, detail: { index: i, previous: prev, slide: this.items[i] } }));
  }

  next() { this.go(this.i + 1); }
  prev() { this.go(this.i - 1); }

  startTimer() {
    if (!this.opts.autoplay || reduced() || this.paused || this.inView === false || this.timer) return;
    this.timer = setInterval(() => { if (!this.paused) this.next(); }, this.opts.interval);
  }
  stopTimer() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }
  play() { this.opts.autoplay = true; this.startTimer(); }
  stop() { this.opts.autoplay = false; this.stopTimer(); }
  restart() { this.stopTimer(); this.startTimer(); }

  destroy() {
    this.stopTimer();
    this.io?.disconnect();
    window.removeEventListener('resize', this.onResize);
    this.root.removeEventListener('keydown', this.onKey);
    this.root.__carousel = null;
  }
}

/** Lightbox with carousel — any [data-lightbox] gallery becomes swipeable. */
export function lightbox(root) {
  if (root.__lb) return;
  root.__lb = true;
  let layer, car;
  const openAt = (idx) => {
    const slides = [...root.querySelectorAll('[data-lb-item]')];
    layer = document.createElement('div');
    layer.className = 'c-lightbox';
    layer.innerHTML = `
      <div class="c-lb-shell" data-c-track>
        <div class="c-lb-viewport" data-c-viewport>
          <div class="c-lb-slides">${slides.map((s, i) => `
            <div class="c-lb-slide ${i === idx ? 'is-active' : ''}" data-c-slide>
              <img src="${s.dataset.lbFull || s.querySelector('img')?.src || ''}" alt="${s.getAttribute('aria-label') || s.querySelector('img')?.alt || ''}">
              <div class="c-lb-cap">${s.dataset.lbCap || s.querySelector('.c-lb-cap')?.textContent || ''}</div>
            </div>`).join('')}</div>
        </div>
        <button class="c-lb-x" data-lb-close aria-label="Close">✕</button>
        <button class="c-lb-nav prev" data-c-prev aria-label="Previous image">‹</button>
        <button class="c-lb-nav next" data-c-next aria-label="Next image">›</button>
        <div class="c-lb-dots" data-c-dots></div>
      </div>`;
    document.body.appendChild(layer);
    document.documentElement.classList.add('c-lock');
    car = new Carousel(layer, { mode: 'fade', autoplay: false, interval: 9000 });
    car.go(idx, { instant: true });
    layer.addEventListener('click', (e) => { if (e.target === layer || e.target.closest('[data-lb-close]')) close(); });
    const esc = (e) => { if (e.key === 'Escape') close(); };
    const close = () => { document.removeEventListener('keydown', esc); car?.destroy(); layer.remove(); document.documentElement.classList.remove('c-lock'); };
    document.addEventListener('keydown', esc);
  };
  root.addEventListener('click', (e) => {
    const item = e.target.closest('[data-lb-item]');
    if (!item) return;
    e.preventDefault();
    openAt([...root.querySelectorAll('[data-lb-item]')].indexOf(item));
  });
}

export function initCarousels(scope = document) {
  const out = [];
  scope.querySelectorAll('[data-carousel]').forEach((el) => {
    if (el.__carousel) { out.push(el.__carousel); return; }
    try { out.push(new Carousel(el, {})); } catch (err) { console.warn('[carousel] skipped', el.dataset.carousel, err); }
  });
  scope.querySelectorAll('[data-lightbox]').forEach((el) => { try { lightbox(el); } catch (err) { console.warn('[lightbox]', err); } });
  return out;
}

export default initCarousels;
