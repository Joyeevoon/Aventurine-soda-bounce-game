'use strict';
/* 汽水弹跳 — charge & bounce soda-bottle platformer (portrait)
   Built from the candy-bounce-game skill: swept landing, snap 6px,
   three platform types (safe yellow bottle / cracked bottle / spiked bottle),
   floating upright-bottle background, single record holder.
   Platform geometry measured from the user's trimmed PNGs (protocol/asset-geometry.json):
     normal  540x146  body top ≈ 0.0411h, solid span 0.046..0.985 of width
     broken  468x211  left-solid top ≈ 0.2464h, solid span 0.103..0.722
     spike   476x195  body top ≈ 0.1333h, solid span 0.029..0.830 */
(function () {
  const QA = /[?&]qa=1/.test(location.search);

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = QA ? mulberry32(20260913) : Math.random;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ---------- dom ---------- */
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const container = document.getElementById('gameContainer');
  const scoreValueEl = document.getElementById('scoreValue');
  const highValueEl = document.getElementById('highScoreValue');
  const barEl = document.getElementById('chargeBar');
  const fillEl = document.getElementById('chargeBarFill');
  const modalEl = document.getElementById('gameOverModal');
  const msgEl = document.getElementById('gameOverMessage');
  const finalEl = document.getElementById('finalScore');
  const finalHighEl = document.getElementById('finalHigh');
  const badgeEl = document.getElementById('newRecordBadge');
  const btnEl = document.getElementById('restartButton');
  const holderEl = document.getElementById('recordHolder');
  const promptEl = document.getElementById('recordPrompt');
  const nameRowEl = document.getElementById('recordNameRow');
  const nameInputEl = document.getElementById('recordNameInput');

  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = container.clientWidth; H = container.clientHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
  }
  window.addEventListener('resize', resize);

  /* ---------- assets ---------- */
  /* ---------- assets ----------
     All three bottle platforms scale by their BOTTLE BODY (cylinder) so the
     bottles render at the same size in-game; shards/spikes are extra above/below.
     bodyHF = body cylinder height / image height (measured, protocol/asset-body-geometry.json):
       normal 0.8973, broken 0.4645 (crack spray included), spike 0.6513 (spikes included).
     drawH = ph × bodyHF(normal) / bodyHF(self). topF anchors the landing surface (body top). */
  const BODY_HF_NORMAL = 0.8973;
  const platformMeta = {
    normal: { src: 'assets/platform-normal.png', w: 540, h: 146, bodyHF: 0.8973, topF: 0.0548, landL: 0.0463, landR: 0.9852 },
    broken: { src: 'assets/platform-broken.png', w: 468, h: 211, bodyHF: 0.4645, topF: 0.2654, landL: 0.1026, landR: 0.7222 },
    spike:  { src: 'assets/platform-spike.png',  w: 476, h: 195, bodyHF: 0.6513, topF: 0.1897, landL: 0.0294, landR: 0.8298 },
  };
  const charMeta = { src: 'assets/character.png', w: 513, h: 920 };
  const decorSrc = 'assets/decor-upright.png';   /* floating background bottles */

  function loadImage(src) {
    return new Promise(res => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = src;
    });
  }

  /* ---------- constants ---------- */
  const HS_KEY = 'sodaBounceHighScore_v1';
  const PHYS = { g: 2200, vxMin: 240, vxMax: 520, vyMin: 600, vyMax: 840, chargeMaxMs: 1000 };
  const SNAP_PX = 6;
  /* desktop web: bottles 15% smaller; phones/tablets with touch stay at full size */
  const DESKTOP_BOTTLE_FACTOR =
    (window.matchMedia && window.matchMedia('(pointer: fine)').matches &&
     Math.max(window.screen.width, window.screen.height) > 900) ? 0.85 : 1;

  const S = {
    mode: 'boot', score: 0,
    high: parseInt(localStorage.getItem(HS_KEY) || '0', 10) || 0,
    startHigh: 0, chargeT0: 0, charge: 0,
    cam: { x: 0, y: 0 }, t: 0,
  };

  let platforms = [];
  let player = null;
  let dust = [];
  let pops = [];
  let bgBottles = [];   /* floating upright bottles in the background */
  let decorW = 124, decorH = 442;   /* natural decor image size, set at boot */

  /* ---------- world gen ---------- */
  const QA_TYPES = ['normal', 'broken', 'normal', 'spike', 'normal', 'normal', 'broken', 'normal', 'spike', 'normal'];
  let genIndex = 0;

  function platformH() { return DESKTOP_BOTTLE_FACTOR * clamp(H * 0.034, 22, 38); }

  function makePlatform(type, centerCx, topY) {
    const m = platformMeta[type];
    const ph = platformH();
    /* scale so the bottle BODY renders at ph — same bottle size for all three types */
    const drawH = ph * (BODY_HF_NORMAL / m.bodyHF);
    const dw = drawH * m.w / m.h;
    return {
      type, meta: m, dw, ph: drawH, centerCx, topY,
      x: centerCx - dw / 2,
      y: topY - m.topF * drawH,
      landL: centerCx + (m.landL - 0.5) * dw,
      landR: centerCx + (m.landR - 0.5) * dw,
      touched: false,
    };
  }

  function gapRange() {
    const dw = platformH() * (platformMeta.normal.w / platformMeta.normal.h);
    const d = difficulty();
    const gapMin = dw * lerp(1.55, 1.85, d);
    const gapMax = Math.max(gapMin + 8, Math.min(0.42 * W, dw * lerp(2.05, 2.75, d)));
    return [gapMin, gapMax];
  }
  function nextGap() {
    const [g0, g1] = gapRange();
    return lerp(g0, g1, rand());
  }
  function nextDy() {
    if (QA) return lerp(-50, 60, rand());
    const d = difficulty();
    return lerp(-lerp(20, 45, d), lerp(70, 100, d), rand());
  }

  function difficulty() {
    if (QA) return 0;
    if (S.score < 100) return 0;
    return clamp((S.score - 100) / 200, 0, 1);
  }
  function nextType() {
    if (QA) return QA_TYPES[genIndex % QA_TYPES.length];
    const d = difficulty();
    if (genIndex < 3) return 'normal';
    const r = rand();
    const prev = platforms[platforms.length - 1];
    const prevHaz = prev && prev.type !== 'normal';
    const brokenP = lerp(0.06, 0.14, d);
    const spikeP = lerp(0.06, 0.16, d);
    if (r < brokenP) return prevHaz ? 'normal' : 'broken';
    if (r < brokenP + spikeP) return prevHaz ? 'normal' : 'spike';
    return 'normal';
  }

  function genAhead() {
    while (true) {
      const last = platforms[platforms.length - 1];
      if (last.centerCx > S.cam.x + W * 2.2) break;
      const type = nextType();
      const gap = nextGap();
      const dy = nextDy();
      const topY = clamp(last.topY + dy, H * 0.20, H * 0.80);
      platforms.push(makePlatform(type, last.centerCx + gap, topY));
      genIndex++;
    }
  }

  /* floating upright bottles across the WHOLE background:
     no two bottles may overlap (AABB + margin), enforced at init and recycle */
  const BOXMARGIN = 10;
  function bottleDims(b, imgW, imgH) {
    const dw = b.size * imgW / imgH;
    return { dw, dh: b.size };
  }
  function bottlesOverlap(a, da, b, db) {
    return Math.abs(a.x - b.x) < (da.dw + db.dw) / 2 + BOXMARGIN &&
           Math.abs(a.y - b.y) < (da.dh + db.dh) / 2 + BOXMARGIN;
  }
  function placeBottle(b, others, imgW, imgH, xBand, tries) {
    const d = bottleDims(b, imgW, imgH);
    for (let i = 0; i < (tries || 40); i++) {
      b.x = lerp(xBand[0], xBand[1], rand());
      b.y = lerp(d.dh / 2 + 8, H - d.dh / 2 - 8, rand());
      const clash = others.some(o => {
        if (o === b) return false;
        const od = bottleDims(o, imgW, imgH);
        return bottlesOverlap(b, d, o, od);
      });
      if (!clash) return true;
    }
    return false;
  }
  function initBgBottles() {
    bgBottles = [];
    const n = 20;
    for (let k = 0; k < n; k++) {
      const b = {
        size: lerp(46, 64, rand()),
        phase: rand() * Math.PI * 2,
        amp: lerp(3, 6, rand()),
        speed: lerp(0.4, 0.7, rand()),
      };
      placeBottle(b, bgBottles, decorW, decorH, [0, W * 1.6]);
      bgBottles.push(b);
    }
  }

  function initWorld() {
    genIndex = 0;
    const start = makePlatform('normal', W * 0.30, H * 0.62);
    platforms = [start];
    S.cam.x = 0; S.cam.y = 0;
    genAhead();

    const pw = clamp(H * 0.055, 46, 58);
    const ph = pw * charMeta.h / charMeta.w;
    player = {
      w: pw, h: ph, vx: 0, vy: 0,
      x: start.centerCx - pw / 2,
      y: start.topY - ph,
      tilt: 0, squash: 0,
    };
    S.cam.x = player.x - W * 0.20;
    S.cam.y = player.y - H * 0.42;

    dust = []; pops = [];
    initBgBottles();
    S.score = 0;
    S.startHigh = S.high;
    S.mode = 'idle';
    scoreValueEl.textContent = '0';
    highValueEl.textContent = S.high;
  }

  /* ---------- input ---------- */
  function startCharge() {
    if (S.mode !== 'idle') return;
    S.mode = 'charging';
    S.chargeT0 = performance.now();
    S.charge = 0;
    barEl.style.display = 'block';
    barEl.classList.remove('flash');
    fillEl.style.width = '0%';
  }

  function startFlight(vx, vy) {
    S.mode = 'flying';
    player.vx = vx; player.vy = vy;
  }

  function releaseCharge() {
    if (S.mode !== 'charging') return;
    const c = S.charge;
    barEl.style.display = 'none';
    barEl.classList.remove('flash');
    sfxBounce.play();
    startFlight(lerp(PHYS.vxMin, PHYS.vxMax, c), -lerp(PHYS.vyMin, PHYS.vyMax, c));
  }

  /* ---------- audio ---------- */
  const bgm = document.getElementById('bgm');
  const musicBtn = document.getElementById('musicToggle');
  const sfxBounce = document.getElementById('sfxBounce');
  const sfxLand = document.getElementById('sfxLand');
  let musicOn = true;
  let sfxReady = false;
  function setMusic(on) {
    musicOn = on;
    musicBtn.classList.toggle('off', !on);
    musicBtn.setAttribute('aria-label', on ? '关闭背景音乐' : '开启背景音乐');
    if (on) bgm.play().catch(() => {}); else bgm.pause();
  }
  musicBtn.addEventListener('click', e => { e.stopPropagation(); setMusic(!musicOn); });
  /* defer audio fetching: bgm loads metadata only; everything streams on first gesture */
  const unlockAudio = () => {
    if (musicOn) bgm.play().catch(() => {});
    sfxBounce.load(); sfxLand.load();
    sfxReady = true;
  };

  container.addEventListener('pointerdown', e => {
    if (!sfxReady) unlockAudio();
    if (e.target.closest('button')) return;
    if (e.target.closest('#recordNameRow')) return;
    if (S.mode === 'over') return;
    e.preventDefault();
    startCharge();
  });
  window.addEventListener('pointerup', releaseCharge);
  window.addEventListener('pointercancel', releaseCharge);
  window.addEventListener('contextmenu', e => e.preventDefault());

  btnEl.addEventListener('click', () => saveRecordName());
  btnEl.addEventListener('click', () => restart());

  /* ---------- single record holder (top-1) ---------- */
  const NAME_KEY = 'sodaBounceRecordName_v1';
  function refreshHolder() {
    const name = localStorage.getItem(NAME_KEY);
    if (S.high > 0 && name) {
      holderEl.textContent = '👑 ' + name;
      holderEl.classList.remove('hidden');
    } else {
      holderEl.classList.add('hidden');
    }
  }
  refreshHolder();

  function saveRecordName() {
    const v = nameInputEl.value.trim();
    if (v) localStorage.setItem(NAME_KEY, v);
    refreshHolder();
    nameRowEl.classList.add('hidden');
  }
  nameInputEl.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { saveRecordName(); nameInputEl.blur(); }
  });
  nameInputEl.addEventListener('blur', saveRecordName);
  nameInputEl.addEventListener('pointerdown', e => e.stopPropagation());

  function restart() {
    modalEl.style.display = 'none';
    S.qaNoLand = false;
    initWorld();
    genAhead();
  }

  /* ---------- game over ---------- */
  function gameOver(msg) {
    S.mode = 'over';
    let isRecord = false;
    if (S.score > S.high) {
      S.high = S.score;
      localStorage.setItem(HS_KEY, String(S.high));
    }
    if (S.score > S.startHigh) isRecord = true;
    highValueEl.textContent = S.high;
    msgEl.textContent = msg;
    finalEl.textContent = S.score;
    finalHighEl.textContent = S.high;
    badgeEl.style.display = isRecord ? 'block' : 'none';
    if (isRecord) {
      promptEl.classList.remove('hidden');
      nameRowEl.classList.remove('hidden');
      nameInputEl.value = '';
      setTimeout(() => nameInputEl.focus({ preventScroll: true }), 120);
    } else {
      promptEl.classList.add('hidden');
      nameRowEl.classList.add('hidden');
    }
    refreshHolder();
    modalEl.style.display = 'flex';
  }

  function land(p) {
    if (p.type === 'normal') {
      player.x = p.centerCx - player.w / 2;
      player.y = p.topY - player.h;
      player.vx = 0; player.vy = 0;
      player.squash = 1;
      S.mode = 'idle';
      if (!p.touched) {
        p.touched = true;
        S.score += 3;
        scoreValueEl.textContent = S.score;
        if (S.score > S.high) highValueEl.textContent = S.score;
        sfxLand.play();
        pops.push({ x: p.centerCx, y: p.topY - 34, vy: -60, life: 1, text: '+3' });
      }
      for (let i = 0; i < 8; i++) {
        dust.push({
          x: p.centerCx + (Math.random() - 0.5) * player.w,
          y: p.topY,
          vx: (Math.random() - 0.5) * 140,
          vy: -Math.random() * 90 - 20,
          life: 0.5 + Math.random() * 0.3, r: 3 + Math.random() * 4,
        });
      }
    } else if (p.type === 'broken') {
      gameOver('汽水瓶碎裂！游戏结束');
    } else {
      gameOver('被尖刺瓶扎到！游戏结束');
    }
  }

  /* ---------- update ---------- */
  function update(dt, now) {
    S.t += dt;

    for (const b of bgBottles) {
      b.phase += dt * b.speed;
      const sx = b.x - S.cam.x * 0.45;
      if (sx < -80) {
        /* recycle: sample until the new spot overlaps nobody */
        placeBottle(b, bgBottles, decorW, decorH, [S.cam.x * 0.45 + W + 60, S.cam.x * 0.45 + W + 320]);
        b.phase += Math.random() * Math.PI;
      }
    }

    if (S.mode === 'charging') {
      S.charge = clamp((now - S.chargeT0) / PHYS.chargeMaxMs, 0, 1);
      fillEl.style.width = (S.charge * 100).toFixed(1) + '%';
      if (S.charge >= 1) barEl.classList.add('flash');
    }

    if (S.mode === 'flying') {
      const prevBottom = player.y + player.h;
      player.vy += PHYS.g * dt;
      player.x += player.vx * dt;
      player.y += player.vy * dt;
      const bottom = player.y + player.h;
      const fx = player.x + player.w / 2;

      if (player.vy > 0 && !S.qaNoLand) {
        for (const p of platforms) {
          const onTop = fx >= p.landL - SNAP_PX && fx <= p.landR + SNAP_PX;
          /* swept crossing: feet were above the bottle top, now at/below it */
          if (prevBottom <= p.topY + 14 && bottom >= p.topY && onTop) { land(p); break; }
        }
      }
      if (S.mode === 'flying' && player.y > S.cam.y + H + player.h + 40) {
        gameOver('坠落！游戏结束');
      }
    }

    if (S.mode === 'flying') {
      const target = clamp(Math.atan2(player.vy, Math.max(player.vx, 120)) * 0.16, -0.2, 0.55);
      player.tilt += (target - player.tilt) * Math.min(1, dt * 10);
    } else {
      player.tilt *= Math.exp(-dt * 10);
    }
    player.squash *= Math.exp(-dt * 7);

    const tx = player.x - W * 0.20;
    const ty = player.y - H * 0.42;
    S.cam.x += (tx - S.cam.x) * Math.min(1, dt * 6);
    if (!(S.mode === 'flying' && player.vy > 60)) {
      S.cam.y += (ty - S.cam.y) * Math.min(1, dt * 4);
    }

    genAhead();
    platforms = platforms.filter(p => p.centerCx > S.cam.x - 900);

    for (const d of dust) { d.life -= dt; d.x += d.vx * dt; d.y += d.vy * dt; d.vy += 300 * dt; }
    dust = dust.filter(d => d.life > 0);
    for (const p of pops) { p.life -= dt * 1.1; p.y += p.vy * dt; }
    pops = pops.filter(p => p.life > 0);
  }

  /* ---------- draw ---------- */
  const imgs = { character: null, platforms: { normal: null, broken: null, spike: null }, decor: null };

  function draw() {
    ctx.clearRect(0, 0, W, H);

    /* floating upright bottles — behind everything */
    for (const b of bgBottles) {
      const img = imgs.decor;
      if (!img) continue;
      const sx = b.x - S.cam.x * 0.45;
      const sy = b.y + Math.sin(b.phase) * b.amp;
      const sc = b.size / Math.max(img.width, img.height);
      const dw = img.width * sc, dh = img.height * sc;
      ctx.globalAlpha = 0.6;
      ctx.drawImage(img, sx - dw / 2, sy - dh / 2, dw, dh);
    }
    ctx.globalAlpha = 1;

    for (const p of platforms) {
      const img = imgs.platforms[p.type];
      if (img) ctx.drawImage(img, p.x - S.cam.x, p.y - S.cam.y, p.dw, p.ph);
    }

    for (const d of dust) {
      ctx.globalAlpha = Math.max(0, d.life) * 1.4;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(d.x - S.cam.x, d.y - S.cam.y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (player) {
      const fx = player.x + player.w / 2 - S.cam.x;
      const fy = player.y + player.h - S.cam.y;
      let sx = 1, sy = 1;
      if (S.mode === 'charging') { sy = 1 - 0.12 * S.charge; sx = 1 + 0.08 * S.charge; }
      else if (S.mode === 'idle') { sy = 1 + Math.sin(S.t * 3) * 0.012; }
      const sq = player.squash;
      sx *= 1 + 0.22 * sq; sy *= 1 - 0.28 * sq;
      ctx.save();
      ctx.translate(fx, fy);
      ctx.rotate(player.tilt);
      ctx.scale(sx, sy);
      if (imgs.character) ctx.drawImage(imgs.character, -player.w / 2, -player.h, player.w, player.h);
      ctx.restore();
    }

    ctx.font = 'bold 22px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    for (const p of pops) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#fff';
      ctx.strokeText(p.text, p.x - S.cam.x, p.y - S.cam.y);
      ctx.fillStyle = '#F0A500';
      ctx.fillText(p.text, p.x - S.cam.x, p.y - S.cam.y);
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- loop ---------- */
  let last = 0;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.04);
    last = now;
    if (S.mode !== 'boot') { update(dt, now); draw(); }
    requestAnimationFrame(frame);
  }

  /* ---------- qa hooks ---------- */
  function stateSnapshot() {
    return {
      mode: S.mode, score: S.score, high: S.high, startHigh: S.startHigh,
      charge: +S.charge.toFixed(3),
      chargeBarVisible: barEl.style.display === 'block',
      chargeBarFlash: barEl.classList.contains('flash'),
      player: { x: Math.round(player.x), y: Math.round(player.y), vx: Math.round(player.vx), vy: Math.round(player.vy), w: Math.round(player.w) },
      modal: modalEl.style.display,
      modalMsg: msgEl.textContent,
      badgeVisible: badgeEl.style.display === 'block',
      platforms: platforms.map(p => ({
        type: p.type, centerCx: Math.round(p.centerCx), topY: Math.round(p.topY),
        landL: Math.round(p.landL), landR: Math.round(p.landR), touched: p.touched,
      })),
      canvasW: W, canvasH: H,
    };
  }
  function qaJumpTo(i) {
    if (S.mode !== 'idle' || !platforms[i]) return { ok: false, reason: 'mode=' + S.mode };
    const p = platforms[i];
    const sx = player.x + player.w / 2, sy = player.y + player.h;
    const tx = p.centerCx, ty = p.topY;
    const dy = ty - sy;
    const vy = -880;
    const disc = vy * vy + 2 * PHYS.g * Math.max(dy, -350);
    if (disc < 0) return { ok: false, reason: 'disc' };
    const t = (-vy + Math.sqrt(disc)) / PHYS.g;
    const vx = (tx - sx) / t;
    if (t < 0.05 || vx < 40) return { ok: false, reason: 't=' + t.toFixed(3) + ' vx=' + vx.toFixed(0) };
    startFlight(vx, vy);
    return { ok: true, t: +t.toFixed(3), vx: Math.round(vx), vy };
  }
  function qaFallThrough() {
    if (S.mode !== 'idle') return { ok: false, reason: 'mode=' + S.mode };
    S.qaNoLand = true;
    startFlight(90, -260);
    return { ok: true };
  }
  if (QA) {
    window.__game = { state: stateSnapshot, startCharge, releaseCharge, qaJumpTo, qaFallThrough, restart,
      get bgBottles() { return bgBottles.map(b => ({ x: b.x, y: b.y, size: b.size })); } };
  }

  /* ---------- boot ---------- */
  Promise.all([
    loadImage(charMeta.src),
    loadImage(platformMeta.normal.src),
    loadImage(platformMeta.broken.src),
    loadImage(platformMeta.spike.src),
    loadImage(decorSrc),
  ]).then(list => {
    imgs.character = list[0];
    imgs.platforms.normal = list[1];
    imgs.platforms.broken = list[2];
    imgs.platforms.spike = list[3];
    imgs.decor = list[4];
    if (imgs.decor) { decorW = imgs.decor.width; decorH = imgs.decor.height; }
    resize();
    initWorld();
    requestAnimationFrame(t => { last = t; frame(t); });
  });
})();
