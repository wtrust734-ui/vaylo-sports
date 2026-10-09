/* ============================================================================
   Vaylo Sports — ad timeline engine
   ----------------------------------------------------------------------------
   Frame-accurate and fully scrubbable. Every cue is a Web Animations API
   animation whose total duration equals the ad duration, positioned by
   keyframe offset. That means playhead time maps 1:1 to animation.currentTime,
   so dragging the scrubber moves the actual pixels — not a CSS approximation.

   The CSS in core.css holds only *resting* styles and simple primitive
   keyframes; anything that has to land on a beat is driven from here.
   ========================================================================== */

class VayloAd {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.stage   the 1080-wide canvas
   * @param {number}      opts.duration seconds
   * @param {string}      opts.title
   */
  constructor({ stage, duration, title }) {
    this.stage = stage;
    this.T = duration;
    this.title = title;
    this.cues = [];
    this.scenes = [];
    this.drivers = [];
    this.beats = [];
    this.checks = [];
    this.cueMeta = [];
    this.t = 0;
    this.raf = null;
    this.startedAt = 0;
    this.playing = false;
    this.loop = true;
  }

  /**
   * Add a keyframed cue. `from`/`to` are seconds on the ad timeline.
   *
   * fill defaults to 'forwards', deliberately. With 'both' the first keyframe
   * is applied for the WHOLE timeline before the cue starts, so any cue that
   * opens on opacity 0 silently hides its element until that cue is reached —
   * which quietly kills a scene for its entire life. Scene visibility is
   * already owned by ad.scene() (display), so 'forwards' is the safe default;
   * elements that animate in are hidden by an inline opacity instead.
   */
  add(el, keyframes, { from = 0, to = this.T, easing = 'linear', fill = 'forwards' } = {}) {
    if (!el) throw new Error('VayloAd.add: target element not found');
    const span = Math.max(to - from, 0.0001);
    // keyframe offsets are authored as 0..1 within the cue's own window, then
    // mapped onto the ad timeline. The final keyframe must land on `to` and be
    // HELD there — pinning it to offset 1 instead would smear the end value
    // across the rest of the film and the element would never arrive.
    const kf = keyframes.map((k) => ({
      ...k,
      offset: Math.min(Math.max((from + (k.offset ?? 0) * span) / this.T, 0), 1),
    }));
    const end = kf[kf.length - 1].offset;
    if (end < 1) kf.push({ ...kf[kf.length - 1], offset: 1 });

    /* Easing belongs on the KEYFRAMES, not on the effect. The effect-level
       `easing` is the easing of the whole iteration — putting a
       cubic-bezier(.7,0,.2,1) there warps global progress, so a cue set to
       run 0.42s->0.42s gets remapped to run at 0.4% of the film and appears
       never to land. In WAAPI a keyframe's easing governs the interval that
       STARTS at that keyframe, which is what "this cue eases in like that"
       actually means. Effect easing stays linear. */
    for (const k of kf) k.easing = easing;

    // an element whose cue opens on opacity 0 must not be visible before that
    // cue arrives. The animation overrides this while active and after.
    if (keyframes[0] && keyframes[0].opacity === 0 && fill === 'forwards') {
      el.style.opacity = '0';
    }

    // NB: WAAPI duration is MILLISECONDS. this.T is seconds. Getting this
    // wrong makes every cue 25ms long, which parks it permanently on its last
    // keyframe — the whole film renders as hard cuts with no animation.
    const anim = el.animate(kf, { duration: this.T * 1000, easing: 'linear', fill });
    anim.pause();
    this.cues.push(anim);
    this.cueMeta.push({ el, from, to });
    // record where this cue is supposed to have landed, so the audit can prove
    // it actually arrived. A cue that never reaches its end state is invisible
    // and the geometry checks below cannot see it.
    const last = keyframes[keyframes.length - 1];
    if (typeof last.opacity === 'number') {
      this.checks.push({ el, at: to, opacity: last.opacity });
    }
    return anim;
  }

  /** Shorthand: a cue that plays `keyframes` and returns to the start frame. */
  once(el, keyframes, opts = {}) {
    const { hold = 0, ...rest } = opts;
    const to = rest.to ?? (rest.from ?? 0) + 0.001;
    this.add(el, keyframes, { ...rest, to, fill: 'both' });
    if (hold) this.add(el, [keyframes[keyframes.length - 1]], { from: to, to: to + hold, fill: 'both' });
  }

  /** Show/hide a block for a window. Pure render pass, always scrub-exact. */
  scene(el, t0, t1) {
    if (!el) return;
    this.scenes.push({ el, t0, t1 });
  }

  /** Value driver — counters, bars, rings. fn(value, t) with value 0→1. */
  drive(t0, t1, fn, easing = easeOutCubic) {
    this.drivers.push({ t0, t1, fn, easing });
  }

  /** Count a number element up across a window. */
  count(el, t0, t1, from, to, { prefix = '', pad = 0 } = {}) {
    if (!el) return;
    this.drive(t0, t1, (p) => {
      const v = from + (to - from) * p;
      el.textContent = prefix + (pad ? String(Math.round(v)).padStart(pad, '0') : String(Math.round(v)));
    });
  }

  /** Mark a cut point for the scrubber beat ruler. */
  beat(t, label = '') {
    this.beats.push({ t, label });
  }

  /* ------------------------------------------------------------------ */

  render(t) {
    this.t = t;
    const ms = Math.min(Math.max(t, 0) * 1000, this.T * 1000);
    for (const a of this.cues) a.currentTime = ms;

    for (const s of this.scenes) {
      const on = t >= s.t0 && t < s.t1;
      if (s.el._on !== on) {
        s.el._on = on;
        s.el.style.display = on ? '' : 'none';
        s.el.setAttribute('aria-hidden', on ? 'false' : 'true');
      }
    }

    for (const d of this.drivers) {
      const raw = d.t1 > d.t0 ? (t - d.t0) / (d.t1 - d.t0) : t >= d.t1 ? 1 : 0;
      d.fn(d.easing(Math.min(Math.max(raw, 0), 1)), t);
    }

    if (this.onFrame) this.onFrame(t);
    if (this.tcEl) {
      this.tcEl.textContent = `${fmt(t)} / ${fmt(this.T)}`;
    }
  }

  play() {
    if (this.playing) return;
    this.playing = true;
    this.startedAt = performance.now() - this.t * 1000;
    const step = () => {
      if (!this.playing) return;
      let t = (performance.now() - this.startedAt) / 1000;
      if (t >= this.T) {
        if (this.loop) { this.startedAt = performance.now(); t = 0; }
        else { this.render(this.T); this.pause(); return; }
      }
      this.render(t);
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
    if (this.onPlayState) this.onPlayState(true);
  }

  pause() {
    this.playing = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    if (this.onPlayState) this.onPlayState(false);
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  seek(t) {
    this.t = Math.min(Math.max(t, 0), this.T);
    this.startedAt = performance.now() - this.t * 1000;
    this.render(this.t);
  }

  restart() { this.seek(0); this.play(); }

  /** Scale the true-pixel stage to fit the window. */
  fit() {
    const w = this.stage.offsetWidth;
    const h = this.stage.offsetHeight;
    const box = this.stage.closest('.deck') || document.body;
    const r = box.getBoundingClientRect();
    const pad = 40;
    const s = Math.min((r.width - pad) / w, (r.height - pad) / h);
    this.stage.style.transform = `scale(${s})`;
    this.stage.parentElement.style.width = `${w * s}px`;
    this.stage.parentElement.style.height = `${h * s}px`;
  }
}

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);

function fmt(s) {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`;
}

/* ============================================================================
   Player chrome
   ========================================================================== */

function mountPlayer(ad, opts = {}) {
  const deck = document.querySelector('.deck');
  const hud = document.querySelector('.hud');
  const scrub = document.getElementById('scrub');
  const beatsRow = document.querySelector('.beats');
  const playBtn = document.getElementById('play');

  ad.tcEl = document.getElementById('tc');
  ad.onPlayState = (p) => { playBtn.textContent = p ? '❚❚  Pause' : '▶  Play'; };
  ad.onFrame = (t) => { scrub.value = String(t); };

  // beat ruler
  for (const b of ad.beats) {
    const i = document.createElement(b.label ? 'b' : 'i');
    i.style.left = `${(b.t / ad.T) * 100}%`;
    if (b.label) { i.title = `${b.t.toFixed(1)}s — ${b.label}`; i.style.height = '12px'; }
    beatsRow.appendChild(i);
  }

  scrub.max = String(ad.T);
  scrub.step = '0.01';
  scrub.addEventListener('input', () => { ad.pause(); ad.seek(parseFloat(scrub.value)); });

  playBtn.addEventListener('click', () => ad.toggle());
  document.getElementById('restart').addEventListener('click', () => ad.restart());
  document.getElementById('loop').addEventListener('click', (e) => {
    ad.loop = !ad.loop;
    e.currentTarget.setAttribute('aria-pressed', String(ad.loop));
  });
  document.getElementById('guides').addEventListener('click', (e) => {
    const on = document.body.dataset.guides === '1';
    document.body.dataset.guides = on ? '0' : '1';
    e.currentTarget.setAttribute('aria-pressed', String(!on));
  });
  document.getElementById('clean').addEventListener('click', () => {
    // record mode: chrome off, stage untouched
    document.body.dataset.clean = document.body.dataset.clean === '1' ? '0' : '1';
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); ad.toggle(); }
    if (e.key === 'r' || e.key === 'R') ad.restart();
    if (e.key === 'g' || e.key === 'G') document.getElementById('guides').click();
    if (e.key === 'ArrowRight') { ad.pause(); ad.seek(ad.t + (e.shiftKey ? 1 : 1 / 30)); }
    if (e.key === 'ArrowLeft') { ad.pause(); ad.seek(ad.t - (e.shiftKey ? 1 : 1 / 30)); }
  });

  // click the stage to play/pause
  deck.addEventListener('click', (e) => { if (!e.target.closest('.hud')) ad.toggle(); });

  ad.fit();
  window.addEventListener('resize', ad.fit.bind(ad));

  /* ---- frame addressing --------------------------------------------
     ?t=12.5   freeze on that timecode (a still)
     ?t=12.5&play  start there and run
     ?clean=1  hide all chrome
     ?guides=1 show safe areas
     Any ad can therefore be opened as a still frame, which is what makes
     the keyframe contact sheets and a frame-by-frame export possible. */
  const q = new URLSearchParams(location.search);
  const t0 = parseFloat(q.get('t'));
  if (!Number.isNaN(t0)) {
    ad.pause();
    ad.seek(t0);
    if (q.get('play') === '1') ad.play();
  } else if (opts.autoplay !== false) {
    ad.play();
  }
  if (q.get('clean') === '1') document.body.dataset.clean = '1';
  if (q.get('guides') === '1') document.body.dataset.guides = '1';

  return ad;
}

/* ============================================================================
   Compliance audit — walks the timeline and checks every frame against the
   platform rules that actually get ads rejected or buried:

     · text must not sit under Reels/TikTok chrome (bottom bar, right rail)
     · nothing may overflow the canvas
     · nothing may render below a legibility floor
     · exactly one scene must be live at a time (no double-exposed cuts)

   Measures the real ink box of each text node via Range, not the element box,
   so a centred short line inside a full-width block is not falsely flagged.
   Call it from the console:  vayloAudit()
   ========================================================================== */

function vayloAudit(options = {}) {
  const ad = options.ad || window.ad;
  const stage = ad.stage;
  const W = stage.offsetWidth;
  const H = stage.offsetHeight;
  const ratio = W / H;
  // Reels/TikTok chrome, in stage pixels, scaled from the 9:16 reference
  const is916 = Math.abs(ratio - 9 / 16) < 0.02;
  const safe = is916
    ? { bottom: Math.round(H * 0.156), right: Math.round(W * 0.14), top: Math.round(H * 0.057) }
    : { bottom: Math.round(H * 0.09), right: Math.round(W * 0.06), top: Math.round(H * 0.05) };
  const minFont = options.minFont ?? 20;
  // text inside a device mock is imagery, not ad copy — it is judged against a
  // lower floor, because that is what real device footage looks like
  const minDeviceFont = options.minDeviceFont ?? 15;
  const deviceSel = options.device ?? '.phone';
  const exemptSel = options.exempt ?? '.compliance';
  const allowBottom = new Set(options.allowBottom || []);
  const fps = 30;

  const issues = new Map();

  /* on-screen check: the frame has to actually be visible in the window.
     A stage scaled about its centre inside a smaller wrapper ends up rendered
     off-screen while every element-relative measurement still looks perfect,
     so this has to be asserted against the real viewport. */
  {
    const r = stage.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    if (r.width < 60 || r.height < 60) {
      issues.set('STAGE-TINY', { kind: 'STAGE-TINY', count: 1, samples: [`frame is only ${Math.round(r.width)}x${Math.round(r.height)}px on screen`] });
    } else if (r.top < -1 || r.left < -1 || r.bottom > vh + 1 || r.right > vw + 1) {
      issues.set('STAGE-OFFSCREEN', {
        kind: 'STAGE-OFFSCREEN', count: 1,
        samples: [`frame sits at [${Math.round(r.left)},${Math.round(r.top)}] ${Math.round(r.width)}x${Math.round(r.height)} in a ${vw}x${vh} window`],
      });
    }
  }

  const note = (kind, msg) => {
    if (!issues.has(kind)) issues.set(kind, { kind, count: 0, samples: [] });
    const e = issues.get(kind);
    e.count++;
    if (e.samples.length < 4 && !e.samples.includes(msg)) e.samples.push(msg);
  };

  const inkBox = (el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const b = r.getBoundingClientRect();
    if (b.width > 0.5 && b.height > 0.5) return b;
    return el.getBoundingClientRect();
  };

  const scale = stage.getBoundingClientRect().width / W;
  const typeMax = new Map();

  ad.pause();
  for (let f = 0; f < Math.round(ad.T * fps); f++) {
    const t = f / fps;
    ad.seek(t);
    const live = [...stage.querySelectorAll('.scene')].filter((s) => s.style.display !== 'none');
    if (live.length > 1) note('DOUBLE-EXPOSED', `t=${t.toFixed(2)}s — ${live.length} scenes live at once`);

    for (const sc of live) {
      sc.querySelectorAll('*').forEach((el) => {
        if (el.childElementCount) return;
        const txt = (el.textContent || '').trim();
        if (!txt) return;
        const cs = getComputedStyle(el);
        if (+cs.opacity < 0.08 || cs.visibility === 'hidden' || cs.display === 'none') return;

        const b = inkBox(el);
        if (b.width < 2 || b.height < 2) return;
        const left = (b.left - stage.getBoundingClientRect().left) / scale;
        const right = (b.right - stage.getBoundingClientRect().left) / scale;
        const bottom = (b.bottom - stage.getBoundingClientRect().top) / scale;
        const top = (b.top - stage.getBoundingClientRect().top) / scale;

        // Type size in stage px, at rest.
        // eb/offsetWidth carries every transform: the stage scale, the phone
        // zoom, AND the element's own animated scale-in. The own-scale is
        // divided back out so a transient scale-in is not mistaken for small
        // type — what matters is the size the copy is authored at.
        const eb = el.getBoundingClientRect();
        const total = eb.width / (el.offsetWidth || eb.width);
        const m = new DOMMatrixReadOnly(cs.transform === 'none' ? undefined : cs.transform);
        const own = (Math.abs(m.a) > 0.001 ? Math.abs(m.a) : 1) * (Math.abs(m.d) > 0.001 ? Math.abs(m.d) : 1);
        const fontPx = (parseFloat(cs.fontSize) * (total / own)) / scale;

        const isDevice = el.closest(deviceSel) !== null;
        const isExempt = el.closest(exemptSel) !== null;
        const floor = isDevice ? minDeviceFont : minFont;

        // Type is judged at REST, not mid-animation. A cue that scales in from
        // 0.9 briefly renders everything 10% smaller; that is a transient, not
        // a legibility problem, so remember the largest size each element ever
        // reaches while visible and judge that.
        if (!isExempt) {
          const prev = typeMax.get(el) || 0;
          if (fontPx > prev) typeMax.set(el, { fontPx, floor, isDevice, txt });
        }

        if (bottom > H - safe.bottom && !isExempt && !allowBottom.has(el.id)) {
          note('UNDER-CHROME', `t=${t.toFixed(2)}s "${txt.slice(0, 30)}" bottom=${Math.round(bottom)} limit=${H - safe.bottom}`);
        }
        if (right > W - safe.right) {
          note('RIGHT-RAIL', `t=${t.toFixed(2)}s "${txt.slice(0, 30)}" right=${Math.round(right)} limit=${W - safe.right}`);
        }
        if (left < -1 || top < -1 || right > W + 1 || bottom > H + 1) {
          note('OVERFLOW', `t=${t.toFixed(2)}s "${txt.slice(0, 30)}" box=[${Math.round(left)},${Math.round(top)},${Math.round(right)},${Math.round(bottom)}]`);
        }
        if (fontPx < floor && !isExempt && t > 0.5) {
          // only a coarse early-warning here; the authoritative judgement is
          // the at-rest check below
        }
      });
    }
  }
  ad.seek(0);

  /* at-rest type check */
  for (const [, v] of typeMax) {
    if (v.fontPx < v.floor) {
      note(v.isDevice ? 'TINY-DEVICE-TYPE' : 'TINY-TYPE',
        `${v.fontPx.toFixed(1)}px at rest (min ${v.floor}) "${v.txt.slice(0, 26)}"`);
    }
  }

  /* arrival check: every cue that is supposed to be visible must actually be
     visible once its window has passed. This is the check that catches an
     animation that quietly never lands. */
  for (const c of ad.checks) {
    if (c.opacity < 0.9) continue;               // only assert on show-cues
    if (c.at >= ad.T - 0.05) continue;
    const at = Math.min(c.at + 0.2, ad.T);
    // a later cue on the same element is allowed to override this one — an
    // element that animates in and is then deliberately faded out has not
    // "failed to arrive". The takeover may begin exactly when this cue ends,
    // so the window is inclusive of c.at.
    const superseded = ad.cueMeta.some(
      (m) => m.el === c.el && m.from >= c.at - 0.01 && m.from <= at + 0.15
    );
    if (superseded) continue;
    ad.seek(at);
    const actual = +getComputedStyle(c.el).opacity;
    if (actual < c.opacity - 0.15) {
      note('NEVER-ARRIVES', `"${(c.el.textContent || c.el.className || '').trim().slice(0, 26)}" lands at ${Math.round(c.at * 100) / 100}s but opacity is ${actual.toFixed(2)} (expected ${c.opacity})`);
    }
  }

  ad.seek(0);
  ad.play();

  return {
    stage: `${W}x${H}`,
    safeArea: safe,
    duration: ad.T,
    issues: [...issues.values()].map((e) => ({ kind: e.kind, frames: e.count, samples: e.samples })),
    verdict: issues.size === 0 ? 'CLEAN' : `${issues.size} issue class(es)`,
  };
}

window.vayloAudit = vayloAudit;

/* Every ad file does:  const ad = mountPlayer(new VayloAd({...}))  */
