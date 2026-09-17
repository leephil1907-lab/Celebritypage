/**
 * client/player.js — the media layer: ambient hero loops and the vault's private stream.
 *
 * Rules this module exists to enforce:
 *  • a still image is always the fallback — a clip fades in only once it can actually play, so a
 *    missing or unsupported file can never leave a black rectangle where the hero should be
 *  • nothing plays while off-screen, while the tab is hidden, or when the OS asks for reduced motion
 *  • nothing is even fetched until it is needed (preload="none" for ambient, "metadata" for the vault)
 *  • the vault player is a real transport: play/pause, buffered + progress, scrubbing, mute,
 *    fullscreen, keyboard, and an honest message when a clip refuses to load
 */

const REDUCED = () => window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
const attr = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const isVideoSrc = (src) => /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(String(src || ''));
const fmt = (t) => {
  if (!Number.isFinite(t) || t < 0) return '0:00';
  const m = Math.floor(t / 60); const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

/* ------------------------------------------------------------------ *
 * ambient: <video> layered over a poster image, fades in when playable
 * ------------------------------------------------------------------ */
let ambientObserver = null;

export function initAmbientVideos(root = document) {
  root.querySelectorAll('video[data-ambient]').forEach((v) => {
    if (v.__ambient) return;
    v.__ambient = true;
    const slide = v.closest('[data-c-slide], .hero-slide, section') || v.parentElement;
    const ready = () => slide?.classList.add('media-ready');
    const fail = () => { slide?.classList.remove('media-ready'); v.dataset.ambientState = 'unavailable'; };
    v.addEventListener('canplay', ready, { once: true });
    v.addEventListener('error', fail, { once: true });
    v.addEventListener('playing', ready);
    v.addEventListener('pause', () => { if (v.currentTime === 0) slide?.classList.remove('media-ready'); });
    if (v.querySelector('source')) v.load();          // kick the loader after the source is parsed
  });

  if (REDUCED()) {                                    // reduced motion: the still image simply stays
    root.querySelectorAll('video[data-ambient]').forEach((v) => { v.removeAttribute('autoplay'); v.pause?.(); });
    return;
  }
  if (!ambientObserver) {
    ambientObserver = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        const v = en.target;
        if (!en.isIntersecting) { if (!v.paused) v.pause(); return; }
        if (document.visibilityState === 'hidden') return;
        const p = v.play();
        if (p?.catch) p.catch(() => { v.dataset.ambientState = 'blocked'; });
      });
    }, { threshold: 0.35 });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') return;
      document.querySelectorAll('video[data-ambient]').forEach((v) => { if (!v.paused) v.pause(); });
    });
  }
  root.querySelectorAll('video[data-ambient]').forEach((v) => ambientObserver.observe(v));
}

/** Build the markup for an ambient slide: poster image first, clip on top. */
export function ambientVideo({ video, poster, alt = '', className = 'hero-media' }) {
  if (!isVideoSrc(video)) return '';
  return `<video class="${className}" data-ambient muted loop playsinline preload="none" autoplay
   poster="${attr(poster || '')}" aria-hidden="true" tabindex="-1">
  <source src="${attr(video)}" type="${/\.webm/i.test(video) ? 'video/webm' : 'video/mp4'}">
</video>`;
}

/* ------------------------------------------------------------------ *
 * the vault transport
 * ------------------------------------------------------------------ */
export function mountPlayer(host, { src, poster = '', title = '', note = '' } = {}) {
  if (!host) return null;
  if (!isVideoSrc(src)) {
    host.innerHTML = `<div class="mp mp--none"><img src="${attr(poster)}" alt="${attr(title)}"><span class="mp-note">${note || 'Still preview — no stream attached to this drop yet.'}</span></div>`;
    return null;
  }
  host.innerHTML = `
    <div class="mp" data-mp role="group" aria-label="${attr(title)} player" tabindex="0">
      <video class="mp-media" src="${attr(src)}" poster="${attr(poster)}" playsinline preload="metadata"></video>
      <div class="mp-scrim" aria-hidden="true"></div>
      <div class="mp-ui">
        <button type="button" class="mp-btn mp-play" data-mp-play aria-label="Play"><span aria-hidden="true">▶</span></button>
        <div class="mp-track">
          <i class="mp-buf" data-mp-buf></i>
          <i class="mp-fill" data-mp-fill></i>
          <input class="mp-seek" data-mp-seek type="range" min="0" max="1000" value="0" step="1" aria-label="Seek through the clip">
        </div>
        <span class="mp-time mono"><b data-mp-now>0:00</b> / <span data-mp-dur>0:00</span></span>
        <button type="button" class="mp-btn" data-mp-mute aria-label="Mute"><span aria-hidden="true">🔊</span></button>
        <button type="button" class="mp-btn" data-mp-full aria-label="Fullscreen"><span aria-hidden="true">⤢</span></button>
      </div>
      <div class="mp-live" aria-hidden="true"><i></i> members only</div>
      <div class="mp-toast" data-mp-msg role="status" aria-live="polite"></div>
    </div>`;

  const q = (s) => host.querySelector(s);
  const wrap = q('[data-mp]'); const video = q('video');
  const playBtn = q('[data-mp-play]'); const seek = q('[data-mp-seek]');
  const fill = q('[data-mp-fill]'); const buf = q('[data-mp-buf]');
  const now = q('[data-mp-now]'); const dur = q('[data-mp-dur]');
  const muteBtn = q('[data-mp-mute]'); const msg = q('[data-mp-msg]');
  let scrubbing = false;

  const say = (text) => { msg.textContent = text || ''; msg.classList.toggle('is-on', !!text); if (text) setTimeout(() => { msg.textContent = ''; msg.classList.remove('is-on'); }, 4200); };
  const setIcon = () => { playBtn.querySelector('span').textContent = video.paused ? '▶' : '❚❚'; playBtn.setAttribute('aria-label', video.paused ? 'Play' : 'Pause'); wrap.classList.toggle('is-playing', !video.paused); };

  const paint = () => {
    const d = video.duration || 0;
    const p = d ? video.currentTime / d : 0;
    fill.style.width = `${(p * 100).toFixed(2)}%`;
    if (!scrubbing) seek.value = String(Math.round(p * 1000));
    now.textContent = fmt(video.currentTime);
    dur.textContent = fmt(d);
    const b = video.buffered?.length ? video.buffered.end(video.buffered.length - 1) : 0;
    buf.style.width = `${(d ? Math.min(100, (b / d) * 100) : 0).toFixed(2)}%`;
  };

  video.addEventListener('loadedmetadata', paint);
  video.addEventListener('timeupdate', paint);
  video.addEventListener('progress', paint);
  video.addEventListener('durationchange', paint);
  video.addEventListener('play', setIcon);
  video.addEventListener('pause', () => { setIcon(); wrap.classList.add('is-paused'); });
  video.addEventListener('waiting', () => say('Buffering…'));
  video.addEventListener('playing', () => say(''));
  video.addEventListener('volumechange', () => { muteBtn.querySelector('span').textContent = video.muted || video.volume === 0 ? '🔇' : '🔊'; muteBtn.setAttribute('aria-pressed', String(!!video.muted)); });
  video.addEventListener('error', () => {
    const err = video.error;
    const why = err?.code === 4 ? 'the browser will not decode this format (use mp4/H.264 or webm)' : 'it could not be fetched';
    say(`This clip stopped — ${why}.`);
    wrap.classList.add('is-broken');
  });

  playBtn.addEventListener('click', () => { if (video.paused) video.play().catch(() => say('Playback was blocked — tap play again.')); else video.pause(); });
  video.addEventListener('click', () => { if (video.paused) video.play().catch(() => {}); else video.pause(); });
  muteBtn.addEventListener('click', () => { video.muted = !video.muted; });
  q('[data-mp-full]').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await wrap.requestFullscreen?.();
    } catch { say('Fullscreen is not available here.'); }
  });
  seek.addEventListener('pointerdown', () => { scrubbing = true; });
  seek.addEventListener('input', () => { fill.style.width = `${(seek.value / 1000) * 100}%`; now.textContent = fmt((seek.value / 1000) * (video.duration || 0)); });
  const commit = () => { scrubbing = false; if (video.duration) video.currentTime = (seek.value / 1000) * video.duration; };
  seek.addEventListener('change', commit);
  seek.addEventListener('pointerup', commit);

  wrap.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'k') { e.preventDefault(); video.paused ? video.play().catch(() => {}) : video.pause(); }
    else if (k === 'm') { video.muted = !video.muted; }
    else if (k === 'f') { wrap.querySelector('[data-mp-full]').click(); }
    else if (k === 'arrowright') { e.preventDefault(); video.currentTime = Math.min(video.duration || 0, video.currentTime + 5); }
    else if (k === 'arrowleft') { e.preventDefault(); video.currentTime = Math.max(0, video.currentTime - 5); }
  });

  setIcon();
  paint();
  if (!REDUCED()) video.play().catch(() => { /* the poster stays; the play button is right there */ });
  return { video, say, destroy: () => { video.pause(); host.innerHTML = ''; } };
}

export { isVideoSrc };
