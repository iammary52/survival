const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const overlay = document.getElementById("overlay");

const WIDTH = canvas.width;
const HEIGHT = canvas.height;

const keys = new Set();
const pointerState = {
  active: false,
  x: WIDTH * 0.5,
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rand = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max + 1));

const assets = {
  hero: loadImage("assets/hero-set-v3.png"),
  enemy: loadImage("assets/enemy-set-v3.png"),
  bg: loadImage("assets/bg-mobile-highway-v1.png"),
};

function loadImage(src) {
  const image = new Image();
  image.src = src;
  return image;
}


class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.music = null;
    this.compressor = null;
    this.lowpass = null;
    this.ready = false;
    this.muted = false;
    this.musicClock = 0;
    this.sequenceStep = 0;
    this.lastShotAt = 0;
  }

  ensureReady() {
    if (this.ready) {
      if (this.ctx.state === "suspended") this.ctx.resume();
      return;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.72;

    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 20;
    this.compressor.ratio.value = 10;

    this.lowpass = this.ctx.createBiquadFilter();
    this.lowpass.type = "lowpass";
    this.lowpass.frequency.value = 2400;
    this.lowpass.Q.value = 0.3;

    this.music = this.ctx.createGain();
    this.music.gain.value = 0.22;

    this.music.connect(this.lowpass);
    this.lowpass.connect(this.compressor);
    this.master.connect(this.compressor);
    this.compressor.connect(this.ctx.destination);

    this.ready = true;
  }

  setMuted(muted) {
    this.ensureReady();
    this.muted = muted;
    if (!this.master || !this.music) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.music.gain.cancelScheduledValues(t);
    this.master.gain.linearRampToValueAtTime(muted ? 0.0001 : 0.72, t + 0.08);
    this.music.gain.linearRampToValueAtTime(muted ? 0.0001 : 0.22, t + 0.12);
  }

  tone({
    freq = 440,
    type = "sine",
    duration = 0.12,
    volume = 0.2,
    attack = 0.002,
    release = 0.12,
    slideTo = null,
    destination = null,
  }) {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + duration);
    }

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(volume, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + release);

    osc.connect(gain);
    gain.connect(destination || this.master);
    osc.start(t);
    osc.stop(t + duration);
  }

  noise({ duration = 0.08, volume = 0.1, highpass = 800, destination = null }) {
    if (!this.ready || this.muted) return;
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = highpass;

    const gain = this.ctx.createGain();
    const t = this.ctx.currentTime;
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(destination || this.master);
    source.start(t);
  }

  shot() {
    this.ensureReady();
    if (!this.ready || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastShotAt < 0.045) return;
    this.lastShotAt = now;
    this.tone({ freq: 220, slideTo: 120, type: "square", duration: 0.05, release: 0.05, volume: 0.08 });
    this.tone({ freq: 860, slideTo: 420, type: "triangle", duration: 0.04, release: 0.04, volume: 0.045 });
    this.noise({ duration: 0.03, volume: 0.018, highpass: 1500 });
  }

  hit() {
    this.ensureReady();
    this.tone({ freq: 180, slideTo: 70, type: "sawtooth", duration: 0.08, release: 0.08, volume: 0.05 });
    this.noise({ duration: 0.04, volume: 0.02, highpass: 1000 });
  }

  enemyDown() {
    this.ensureReady();
    this.tone({ freq: 360, slideTo: 220, type: "triangle", duration: 0.07, release: 0.07, volume: 0.06 });
  }

  playerHurt() {
    this.ensureReady();
    this.tone({ freq: 140, slideTo: 55, type: "square", duration: 0.15, release: 0.15, volume: 0.1 });
    this.noise({ duration: 0.08, volume: 0.03, highpass: 700 });
  }

  levelUp() {
    this.ensureReady();
    const notes = [392, 523.25, 659.25];
    notes.forEach((freq, index) => {
      setTimeout(() => {
        this.tone({ freq, slideTo: freq * 1.04, type: "triangle", duration: 0.24, release: 0.22, volume: 0.09 });
      }, index * 80);
    });
  }

  gameOver() {
    this.ensureReady();
    this.tone({ freq: 210, slideTo: 90, type: "sawtooth", duration: 0.42, release: 0.4, volume: 0.11 });
    setTimeout(() => {
      this.tone({ freq: 130, slideTo: 45, type: "square", duration: 0.34, release: 0.32, volume: 0.08 });
    }, 140);
  }

  updateMusic(dt, intensity) {
    this.ensureReady();
    if (!this.ready || this.muted || !this.music) return;

    const bpm = 94 + intensity * 8;
    const stepLength = 60 / bpm / 2;
    this.musicClock += dt;

    const bassline = [98, 98, 123.47, 98, 146.83, 123.47, 98, 82.41];
    const lead = [392, 440, 392, 523.25, 440, 392, 329.63, 392];

    while (this.musicClock >= stepLength) {
      this.musicClock -= stepLength;
      const bassFreq = bassline[this.sequenceStep % bassline.length];
      const leadFreq = lead[this.sequenceStep % lead.length];
      this.tone({
        freq: bassFreq,
        slideTo: bassFreq * 0.98,
        type: "sine",
        duration: stepLength * 0.9,
        release: stepLength * 0.85,
        volume: 0.05,
        destination: this.music,
      });

      if (this.sequenceStep % 2 === 0) {
        this.tone({
          freq: leadFreq,
          slideTo: leadFreq * 1.01,
          type: "triangle",
          duration: stepLength * 0.55,
          release: stepLength * 0.5,
          volume: 0.028 + Math.min(0.015, intensity * 0.003),
          destination: this.music,
        });
      }

      if (this.sequenceStep % 4 === 2) {
        this.noise({ duration: 0.025, volume: 0.008, highpass: 2600, destination: this.music });
      }

      this.sequenceStep += 1;
    }
  }
}

const upgradePool = [
  {
    key: "power",
    title: "고압탄",
    desc: "탄환 피해 +1, 적을 더 빠르게 녹입니다.",
    apply: (state) => state.player.damage += 1,
  },
  {
    key: "speed",
    title: "터보 부츠",
    desc: "이동 속도와 가속이 높아져 라인 전환이 쉬워집니다.",
    apply: (state) => {
      state.player.maxSpeed += 55;
      state.player.accel += 160;
    },
  },
  {
    key: "rate",
    title: "고속 장전",
    desc: "발사 간격 감소, 체감 화력이 크게 오릅니다.",
    apply: (state) => state.player.fireRate = Math.max(0.07, state.player.fireRate - 0.018),
  },
  {
    key: "multishot",
    title: "분산 사격",
    desc: "탄환 수 +1, 넓은 라인 커버가 가능해집니다.",
    apply: (state) => state.player.projectilesPerShot = Math.min(5, state.player.projectilesPerShot + 1),
  },
  {
    key: "heal",
    title: "응급 패치",
    desc: "최대 체력의 35%를 즉시 회복합니다.",
    apply: (state) => {
      state.player.hp = clamp(state.player.hp + state.player.maxHp * 0.35, 0, state.player.maxHp);
    },
  },
  {
    key: "pierce",
    title: "관통 탄두",
    desc: "탄환 관통력 +1, 적이 겹쳐도 화력이 유지됩니다.",
    apply: (state) => state.player.pierce += 1,
  },
];

function pickUpgrades() {
  const bag = [...upgradePool];
  const picks = [];
  while (picks.length < 3 && bag.length) {
    picks.push(...bag.splice(randInt(0, bag.length - 1), 1));
  }
  return picks;
}

function createState() {
  return {
    time: 0,
    score: 0,
    distance: 0,
    combo: 0,
    comboTimer: 0,
    enemies: [],
    bullets: [],
    gates: [],
    companions: [],
    beams: [],
    particles: [],
    floatingTexts: [],
    xp: 0,
    level: 1,
    nextXp: 18,
    enemyTimer: 0,
    gateTimer: 5,
    nextBossTime: 45,
    difficulty: 1,
    gameOver: false,
    audioHintTimer: 4,
    flash: 0,
    horizonPulse: 0,
    player: {
      x: WIDTH * 0.5,
      y: HEIGHT - 190,
      w: 58,
      h: 78,
      vx: 0,
      maxSpeed: 560,
      accel: 2600,
      drag: 0.82,
      fireRate: 0.16,
      fireTimer: 0,
      projectileSpeed: 760,
      projectilesPerShot: 1,
      spread: 0.1,
      damage: 2,
      weaponType: "bullet",
      pierce: 0,
      maxHp: 100,
      hp: 100,
      shield: 0,
      dashCooldown: 0,
      hitFlash: 0,
      roll: 0,
      muzzleTimer: 0,
      companionCount: 0,
      laneMinX: WIDTH * 0.25,
      laneMaxX: WIDTH * 0.75,
    },
  };
}

let state = createState();
const audio = new AudioEngine();

function resetGame() {
  state = createState();
  overlay.className = "overlay hidden";
  overlay.innerHTML = "";
  audio.sequenceStep = 0;
  audio.musicClock = 0;
}

function spawnEnemy(kind = "normal") {
  const t = state.time;
  const intensity = 1 + Math.min(3.2, t / 38);
  const eliteRoll = Math.random();
  const fastType = eliteRoll < 0.18 + intensity * 0.025;
  const tankType = kind === "boss" || eliteRoll > 0.86;
  const variantRoll = Math.random();
  const variant = kind === "boss"
    ? "boss"
    : variantRoll < 0.28
      ? "sprinter"
      : variantRoll < 0.48
        ? "crawler"
        : variantRoll < 0.62
          ? "brute"
          : "runner";

  const base = {
    x: rand(state.player.laneMinX + 14, state.player.laneMaxX - 14),
    y: -40,
    w: 30,
    h: 40,
    speed: rand(74, 112) * intensity,
    hp: 1 + Math.floor(intensity * 0.72),
    maxHp: 1 + Math.floor(intensity * 0.72),
    damage: 9,
    value: 6,
    color: "#ef476f",
    scale: rand(0.92, 1.08),
    frame: rand(0, Math.PI * 2),
    hitTimer: 0,
    sprite: "enemy",
    kind,
    variant,
  };

  if (fastType || variant === "sprinter") {
    base.speed *= 1.28;
    base.hp = Math.max(2, base.hp - 1);
    base.maxHp = base.hp;
    base.value += 2;
    base.color = "#ff7b00";
    base.w = 26;
    base.scale *= 0.92;
  }

  if (variant === "crawler") {
    base.speed *= 0.78;
    base.hp += 2;
    base.maxHp = base.hp;
    base.damage = 7;
    base.value += 3;
    base.color = "#8ecae6";
    base.scale *= 0.76;
  }

  if (variant === "brute") {
    base.speed *= 0.74;
    base.hp += 5;
    base.maxHp = base.hp;
    base.damage = 16;
    base.value += 7;
    base.color = "#ffb703";
    base.w = 44;
    base.h = 54;
    base.scale *= 1.28;
  }

  if (tankType) {
    base.speed *= 0.76;
    base.hp += 3;
    base.maxHp = base.hp;
    base.damage = 14;
    base.value += 5;
    base.color = "#c77dff";
    base.w = 40;
    base.h = 48;
    base.scale *= 1.22;
  }

  if (variant === "sprinter") {
    base.speed *= 1.08;
    base.hp += 1;
    base.maxHp = base.hp;
    base.value += 2;
    base.color = "#7cc6fe";
    base.scale *= 0.88;
  }

  if (kind === "boss") {
    base.x = WIDTH * 0.5;
    base.y = -70;
    base.w = 64;
    base.h = 72;
    base.speed = 52 + intensity * 8;
    base.hp = 26 + Math.floor(intensity * 9);
    base.maxHp = base.hp;
    base.damage = 24;
    base.value = 36;
    base.color = "#ffd166";
    base.scale = 1.85;
    base.variant = "boss";
  }

  state.enemies.push(base);
}

function fireShot() {
  const player = state.player;
  if (player.weaponType === "laser") {
    fireLaser(player.x, player.y - player.h * 0.5, player.damage, player.projectilesPerShot);
    audio.shot();
    state.flash = 0.14;
    state.player.muzzleTimer = 0.08;
    return;
  }

  const count = player.projectilesPerShot;
  const center = (count - 1) / 2;

  if (player.weaponType === "flame") {
    for (let i = 0; i < Math.max(5, count * 4); i += 1) {
      const spread = rand(-0.42, 0.42) + (i - center) * 0.02;
      state.bullets.push({
        x: player.x + rand(-8, 8),
        y: player.y - player.h * 0.5,
        r: rand(7, 13),
        speed: player.projectileSpeed * rand(0.28, 0.46),
        vx: spread * player.projectileSpeed,
        vy: -player.projectileSpeed * rand(0.28, 0.46),
        damage: Math.max(1, Math.ceil(player.damage * 0.55)),
        pierce: 0,
        type: "flame",
        life: rand(0.28, 0.48),
      });
    }
    audio.shot();
    state.flash = 0.12;
    state.player.muzzleTimer = 0.08;
    return;
  }

  for (let i = 0; i < count; i += 1) {
    const offset = (i - center) * player.spread;
    const isSpread = player.weaponType === "spread";
    state.bullets.push({
      x: player.x,
      y: player.y - player.h * 0.5,
      r: 5,
      speed: player.projectileSpeed,
      vx: offset * player.projectileSpeed * (isSpread ? 1.45 : 1),
      vy: -player.projectileSpeed,
      damage: player.damage,
      pierce: player.pierce,
      type: player.weaponType,
    });
  }

  for (let i = 0; i < 6; i += 1) {
    state.particles.push({
      x: player.x,
      y: player.y - 22,
      vx: rand(-80, 80),
      vy: rand(-140, -40),
      life: rand(0.08, 0.18),
      size: rand(2, 4),
      color: "#ffd166",
    });
  }

  audio.shot();
  state.flash = 0.2;
  state.player.muzzleTimer = 0.08;
}

function fireLaser(x, y, damage, lanes = 1) {
  const offsets = [];
  const count = Math.min(4, lanes);
  const center = (count - 1) / 2;
  for (let i = 0; i < count; i += 1) {
    offsets.push((i - center) * 24);
  }

  for (const offset of offsets) {
    const beamX = x + offset;
    state.beams.push({ x: beamX, y1: 18, y2: y, life: 0.1, width: 8 });
    for (const enemy of state.enemies) {
      const horizontal = Math.abs(enemy.x - beamX) < enemy.w * 0.8 + 18;
      const vertical = enemy.y < y + enemy.h * 0.5 && enemy.y > 0;
      if (horizontal && vertical) {
        enemy.hp -= damage * 2.2;
        enemy.hitTimer = 0.16;
        spawnHitParticles(enemy.x, enemy.y, enemy.color);
      }
    }
  }
  cleanupDeadEnemies();
}

function spawnHitParticles(x, y, color) {
  for (let p = 0; p < 5; p += 1) {
    state.particles.push({
      x,
      y,
      vx: rand(-90, 90),
      vy: rand(-90, 60),
      life: rand(0.12, 0.24),
      size: rand(2, 4),
      color,
    });
  }
}

function cleanupDeadEnemies() {
  for (let i = state.enemies.length - 1; i >= 0; i -= 1) {
    const enemy = state.enemies[i];
    if (enemy.hp > 0) {
      continue;
    }
    gainXp(enemy.value, enemy.x, enemy.y);
    audio.enemyDown();
    state.flash = Math.max(state.flash, 0.12);
    state.enemies.splice(i, 1);
  }
}

function fireCompanionShot(companion) {
  const target = findNearestEnemy(companion.x, companion.y);
  if (state.player.weaponType === "laser") {
    fireLaser(companion.x, companion.y - 20, Math.max(1, Math.floor(state.player.damage * 0.55)), 1);
    return;
  }
  let vx = 0;
  let vy = -state.player.projectileSpeed * 0.92;
  if (target) {
    const dx = target.x - companion.x;
    const dy = target.y - companion.y;
    const len = Math.hypot(dx, dy) || 1;
    vx = (dx / len) * state.player.projectileSpeed * 0.34;
    vy = (dy / len) * state.player.projectileSpeed * 0.92;
  }
  state.bullets.push({
    x: companion.x,
    y: companion.y - 20,
    r: 4,
    speed: state.player.projectileSpeed * 0.92,
    vx,
    vy,
    damage: Math.max(1, Math.floor(state.player.damage * 0.7)),
    pierce: 0,
    type: "bullet",
  });
}

function findNearestEnemy(x, y) {
  let best = null;
  let bestDist = Infinity;
  for (const enemy of state.enemies) {
    const dx = enemy.x - x;
    const dy = enemy.y - y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = enemy;
    }
  }
  return best;
}

function syncCompanions() {
  const desired = state.player.companionCount || 0;
  while (state.companions.length < desired) {
    state.companions.push({
      angle: 0,
      fireTimer: rand(0.05, 0.2),
      x: state.player.x,
      y: state.player.y,
    });
  }
  while (state.companions.length > desired) {
    state.companions.pop();
  }
}

function createGateOption() {
  const powerTier = state.time < 35 ? 1 : state.time < 75 ? 2 : 3;
  const optionPool = [
    {
      label: "+1",
      tier: 1,
      color: "#72efdd",
      apply: () => {
        state.player.projectilesPerShot = Math.min(5, state.player.projectilesPerShot + 1);
        addFloatingText("SHOT +1", state.player.x, state.player.y - 60, "#72efdd");
      },
    },
    {
      label: "x2",
      tier: 3,
      color: "#ffd166",
      apply: () => {
        state.player.damage = Math.min(10, Math.max(state.player.damage + 1, state.player.damage * 2));
        addFloatingText("DAMAGE x2", state.player.x, state.player.y - 60, "#ffd166");
      },
    },
    {
      label: "SPD",
      tier: 1,
      color: "#a0c4ff",
      apply: () => {
        state.player.maxSpeed += 30;
        state.player.accel += 120;
        addFloatingText("SPEED UP", state.player.x, state.player.y - 60, "#a0c4ff");
      },
    },
    {
      label: "HP+",
      tier: 1,
      color: "#ffadad",
      apply: () => {
        state.player.hp = clamp(state.player.hp + 18, 0, state.player.maxHp);
        addFloatingText("HP +18", state.player.x, state.player.y - 60, "#ffadad");
      },
    },
    {
      label: "MAX HP",
      tier: 2,
      color: "#ffadad",
      apply: () => {
        state.player.maxHp += 18;
        state.player.hp = clamp(state.player.hp + 28, 0, state.player.maxHp);
        addFloatingText("MAX HP UP", state.player.x, state.player.y - 60, "#ffadad");
      },
    },
    {
      label: "SHIELD",
      tier: 1,
      color: "#bde0fe",
      apply: () => {
        state.player.shield = Math.min(60, state.player.shield + 24);
        addFloatingText("SHIELD +24", state.player.x, state.player.y - 60, "#bde0fe");
      },
    },
    {
      label: "LASER",
      tier: 2,
      color: "#80ffdb",
      apply: () => {
        state.player.weaponType = "laser";
        state.player.damage += 1;
        state.player.pierce = Math.max(state.player.pierce, 1);
        addFloatingText("LASER + POWER", state.player.x, state.player.y - 60, "#80ffdb");
      },
    },
    {
      label: "FLAME",
      tier: 2,
      color: "#ffb703",
      apply: () => {
        state.player.weaponType = "flame";
        state.player.fireRate = Math.max(0.075, state.player.fireRate - 0.02);
        state.player.damage += 1;
        addFloatingText("FLAMER + POWER", state.player.x, state.player.y - 60, "#ffb703");
      },
    },
    {
      label: "SPREAD",
      tier: 1,
      color: "#ffc6ff",
      apply: () => {
        state.player.weaponType = "spread";
        state.player.projectilesPerShot = Math.min(5, state.player.projectilesPerShot + 1);
        state.player.spread = Math.max(state.player.spread, 0.16);
        addFloatingText("SPREAD +1", state.player.x, state.player.y - 60, "#ffc6ff");
      },
    },
    {
      label: "ALLY",
      tier: 2,
      color: "#f1c0e8",
      apply: () => {
        state.player.companionCount = Math.min(4, (state.player.companionCount || 0) + 1);
        syncCompanions();
        addFloatingText("ALLY +1", state.player.x, state.player.y - 60, "#f1c0e8");
      },
    },
    {
      label: "ALLY x2",
      tier: 3,
      color: "#ff99c8",
      apply: () => {
        state.player.companionCount = Math.min(4, Math.max(1, (state.player.companionCount || 0) * 2));
        syncCompanions();
        addFloatingText("ALLY x2", state.player.x, state.player.y - 60, "#ff99c8");
      },
    },
    {
      label: "PIERCE",
      tier: 2,
      color: "#fdffb6",
      apply: () => {
        state.player.pierce = Math.min(4, state.player.pierce + 1);
        addFloatingText("PIERCE +1", state.player.x, state.player.y - 60, "#fdffb6");
      },
    },
    {
      label: "WIDE",
      tier: 2,
      color: "#cdb4db",
      apply: () => {
        state.player.spread = Math.min(0.22, state.player.spread + 0.035);
        addFloatingText("SPREAD UP", state.player.x, state.player.y - 60, "#cdb4db");
      },
    },
  ];

  const choices = optionPool.filter((option) => option.tier <= powerTier);
  return choices[randInt(0, choices.length - 1)];
}

function spawnGatePair() {
  const leftX = WIDTH * 0.34;
  const rightX = WIDTH * 0.66;
  const left = createGateOption();
  let right = createGateOption();
  while (right.label === left.label) {
    right = createGateOption();
  }

  state.gates.push({
    y: -60,
    vy: 210,
    leftX,
    rightX,
    width: 132,
    height: 42,
    passed: false,
    left,
    right,
  });
}

function addFloatingText(text, x, y, color = "#ffffff") {
  state.floatingTexts.push({ text, x, y, color, life: 0.7 });
}

function gainXp(amount, x, y) {
  state.xp += amount;
  state.score += amount * 10;
  state.combo += 1;
  state.comboTimer = 1.8;

  if (state.combo > 1) {
    state.score += state.combo * 2;
  }

  while (state.xp >= state.nextXp) {
    state.xp -= state.nextXp;
    state.level += 1;
    state.nextXp = Math.floor(state.nextXp * 1.22);
    audio.levelUp();
    state.horizonPulse = 1;
    state.score += 40;
    addFloatingText(`LEVEL ${state.level}`, state.player.x, state.player.y - 54, "#ffd166");
  }

  if (x !== undefined) {
    addFloatingText(`+${amount} XP`, x, y, "#8ecae6");
  }
}

function showGameOver() {
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="card">
      <h2>작전 종료</h2>
      <p>점수 ${Math.floor(state.score)}점, 생존 ${state.time.toFixed(1)}초, 레벨 ${state.level}까지 버텼습니다.</p>
      <p>Enter를 누르면 즉시 다시 시작합니다.</p>
    </div>
  `;
}

function rectsOverlap(a, b) {
  return (
    Math.abs(a.x - b.x) * 2 < (a.w + b.w) &&
    Math.abs(a.y - b.y) * 2 < (a.h + b.h)
  );
}

function update(dt) {
  if (state.gameOver) {
    return;
  }

  state.time += dt;
  state.distance += dt * 18;
  state.difficulty = 1 + Math.min(3.2, state.time / 42);

  const player = state.player;
  const movingLeft = keys.has("ArrowLeft") || keys.has("KeyA");
  const movingRight = keys.has("ArrowRight") || keys.has("KeyD");
  let moveAxis = (movingRight ? 1 : 0) - (movingLeft ? 1 : 0);

  if (pointerState.active) {
    const diff = pointerState.x - player.x;
    if (Math.abs(diff) > 12) {
      moveAxis = diff > 0 ? 1 : -1;
    } else {
      moveAxis = 0;
    }
  }

  if (pointerState.active) {
    const diff = pointerState.x - player.x;
    player.vx = clamp(diff * 9, -player.maxSpeed, player.maxSpeed);
  } else if (moveAxis !== 0) {
    player.vx += moveAxis * player.accel * dt;
  } else {
    player.vx *= Math.pow(player.drag, dt * 60);
  }

  if ((keys.has("ShiftLeft") || keys.has("ShiftRight")) && player.dashCooldown <= 0 && moveAxis !== 0) {
    player.vx = moveAxis * (player.maxSpeed + 240);
    player.dashCooldown = 1.3;
  }

  player.dashCooldown = Math.max(0, player.dashCooldown - dt);
  player.vx = clamp(player.vx, -player.maxSpeed, player.maxSpeed);
  player.x = clamp(player.x + player.vx * dt, player.laneMinX, player.laneMaxX);
  player.fireTimer -= dt;
  player.hitFlash = Math.max(0, player.hitFlash - dt * 4);
  player.muzzleTimer = Math.max(0, player.muzzleTimer - dt);
  player.roll += (moveAxis * 0.08 - player.roll) * Math.min(1, dt * 10);
  syncCompanions();

  if (player.fireTimer <= 0) {
    fireShot();
    player.fireTimer = player.fireRate;
  }

  state.companions.forEach((companion, index) => {
    const orbitRadius = 46 + index * 18;
    companion.angle += dt * 1.8;
    const side = index % 2 === 0 ? -1 : 1;
    companion.x += ((player.x + side * orbitRadius) - companion.x) * Math.min(1, dt * 8);
    companion.y += ((player.y - 8 - Math.sin(companion.angle) * 10) - companion.y) * Math.min(1, dt * 8);
    companion.fireTimer -= dt;
    if (companion.fireTimer <= 0 && state.enemies.length) {
      fireCompanionShot(companion);
      companion.fireTimer = 0.34 + index * 0.05;
    }
  });

  state.enemyTimer -= dt;
  if (state.enemyTimer <= 0) {
    spawnEnemy();
    const baseRate = 1.08 - Math.min(0.44, state.time * 0.006);
    state.enemyTimer = rand(baseRate * 0.65, baseRate);
  }

  if (state.time >= state.nextBossTime) {
    spawnEnemy("boss");
    state.nextBossTime += 55;
    addFloatingText("BOSS INCOMING", WIDTH * 0.5, 148, "#ffd166");
  }

  state.gateTimer -= dt;
  if (state.gateTimer <= 0) {
    spawnGatePair();
    state.gateTimer = rand(7.5, 11);
  }

  for (const bullet of state.bullets) {
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    if (bullet.life !== undefined) {
      bullet.life -= dt;
      bullet.r *= 0.992;
    }
  }

  for (let i = state.beams.length - 1; i >= 0; i -= 1) {
    const beam = state.beams[i];
    beam.life -= dt;
    if (beam.life <= 0) {
      state.beams.splice(i, 1);
    }
  }

  for (const enemy of state.enemies) {
    enemy.y += enemy.speed * dt;
    enemy.frame += dt * (2 + enemy.speed * 0.01);
    enemy.hitTimer = Math.max(0, enemy.hitTimer - dt);
    enemy.x += Math.sin(enemy.frame) * 20 * dt;
    enemy.x = clamp(enemy.x, player.laneMinX + 20, player.laneMaxX - 20);
  }

  for (const gate of state.gates) {
    gate.y += gate.vy * dt;
  }

  for (let i = state.bullets.length - 1; i >= 0; i -= 1) {
    const bullet = state.bullets[i];
    if (bullet.y < -20 || bullet.x < -20 || bullet.x > WIDTH + 20 || bullet.life <= 0) {
      state.bullets.splice(i, 1);
      continue;
    }

    for (let j = state.enemies.length - 1; j >= 0; j -= 1) {
      const enemy = state.enemies[j];
      const hit =
        bullet.x > enemy.x - enemy.w * 0.5 &&
        bullet.x < enemy.x + enemy.w * 0.5 &&
        bullet.y > enemy.y - enemy.h * 0.5 &&
        bullet.y < enemy.y + enemy.h * 0.5;

      if (!hit) continue;

      enemy.hp -= bullet.damage;
      enemy.hitTimer = 0.12;
      bullet.pierce -= 1;

      spawnHitParticles(bullet.x, bullet.y, enemy.color);

      if (enemy.hp <= 0) {
        gainXp(enemy.value, enemy.x, enemy.y);
        audio.enemyDown();
        state.flash = Math.max(state.flash, 0.12);
        state.enemies.splice(j, 1);
      }

      audio.hit();
      if (bullet.pierce < 0) {
        state.bullets.splice(i, 1);
        break;
      }
    }
  }

  for (let i = state.enemies.length - 1; i >= 0; i -= 1) {
    const enemy = state.enemies[i];
    if (enemy.y > HEIGHT + 40) {
      state.enemies.splice(i, 1);
      applyPlayerDamage(enemy.damage * 0.42);
      state.player.hitFlash = 1;
      state.flash = 0.35;
      audio.playerHurt();
      continue;
    }

    if (rectsOverlap(
      { x: player.x, y: player.y, w: player.w, h: player.h },
      enemy,
    )) {
      state.enemies.splice(i, 1);
      applyPlayerDamage(enemy.damage);
      state.player.hitFlash = 1;
      state.flash = 0.35;
      audio.playerHurt();
    }
  }

  for (let i = state.gates.length - 1; i >= 0; i -= 1) {
    const gate = state.gates[i];
    if (gate.y > HEIGHT + 60) {
      state.gates.splice(i, 1);
      continue;
    }

    if (!gate.passed && gate.y >= player.y - 8) {
      gate.passed = true;
      const chosen = player.x < WIDTH * 0.5 ? gate.left : gate.right;
      chosen.apply();
      audio.levelUp();
      state.gates.splice(i, 1);
    }
  }

  for (let i = state.particles.length - 1; i >= 0; i -= 1) {
    const particle = state.particles[i];
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.life -= dt;
    if (particle.life <= 0) {
      state.particles.splice(i, 1);
    }
  }

  for (let i = state.floatingTexts.length - 1; i >= 0; i -= 1) {
    const text = state.floatingTexts[i];
    text.y -= 28 * dt;
    text.life -= dt;
    if (text.life <= 0) {
      state.floatingTexts.splice(i, 1);
    }
  }

  if (state.comboTimer > 0) {
    state.comboTimer -= dt;
    if (state.comboTimer <= 0) {
      state.combo = 0;
    }
  }

  state.audioHintTimer = Math.max(0, state.audioHintTimer - dt);
  state.flash = Math.max(0, state.flash - dt * 1.4);
  state.horizonPulse = Math.max(0, state.horizonPulse - dt * 0.6);
  audio.updateMusic(dt, state.difficulty);

  if (state.player.hp <= 0) {
    state.player.hp = 0;
    state.gameOver = true;
    audio.gameOver();
    showGameOver();
  }
}

function applyPlayerDamage(amount) {
  if (state.player.shield > 0) {
    const blocked = Math.min(state.player.shield, amount);
    state.player.shield -= blocked;
    amount -= blocked;
  }
  state.player.hp -= amount;
}

function drawBackground() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  if (assets.bg.complete && assets.bg.naturalWidth > 0) {
    ctx.filter = "brightness(0.74) saturate(0.72) contrast(0.95)";
    ctx.drawImage(assets.bg, 0, 0, WIDTH, HEIGHT);
    ctx.filter = "none";
  } else {
    const fallback = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    fallback.addColorStop(0, "#0b0e13");
    fallback.addColorStop(1, "#1a2028");
    ctx.fillStyle = fallback;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  const laneGlow = ctx.createRadialGradient(WIDTH * 0.5, HEIGHT * 0.18, 20, WIDTH * 0.5, HEIGHT * 0.18, 260);
  laneGlow.addColorStop(0, `rgba(226, 158, 104, ${0.1 + state.horizonPulse * 0.08})`);
  laneGlow.addColorStop(1, "rgba(226, 158, 104, 0)");
  ctx.fillStyle = laneGlow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = "rgba(88, 100, 112, 0.08)";
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const vignette = ctx.createRadialGradient(WIDTH * 0.5, HEIGHT * 0.56, 260, WIDTH * 0.5, HEIGHT * 0.54, 860);
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.46)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function drawPlayer() {
  const player = state.player;
  const ready = assets.hero.complete && assets.hero.naturalWidth > 0;
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(player.roll);

  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  ctx.beginPath();
  ctx.ellipse(0, 36, 32, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  if (ready) {
    ctx.filter = "brightness(0.86) saturate(0.72) contrast(0.97)";
    ctx.globalAlpha = 0.96;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(assets.hero, -92, -152, 184, 184);
    ctx.filter = "none";
    if (player.muzzleTimer > 0) {
      ctx.fillStyle = "rgba(255, 213, 128, 0.9)";
      ctx.beginPath();
      ctx.arc(28, -28, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 230, 170, 0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(12, -24);
      ctx.lineTo(44, -32);
      ctx.stroke();
    }
    if (player.hitFlash > 0) {
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = "rgba(255, 122, 100, 0.12)";
      ctx.beginPath();
      ctx.arc(0, -20, 42, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.fillStyle = player.hitFlash > 0 ? "#ff6b6b" : "#8ecae6";
    ctx.beginPath();
    ctx.moveTo(0, -32);
    ctx.lineTo(18, 14);
    ctx.lineTo(0, 24);
    ctx.lineTo(-18, 14);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawEnemies() {
  for (const enemy of state.enemies) {
    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    ctx.fillStyle = "rgba(0, 0, 0, 0.32)";
    ctx.beginPath();
    ctx.ellipse(0, enemy.h * 0.7, enemy.w * 0.6, enemy.h * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();

    const enemyImage = assets.enemy;
    if (enemyImage.complete && enemyImage.naturalWidth > 0) {
      const size = 118 * enemy.scale;
      const filter = enemy.variant === "sprinter"
        ? "brightness(0.86) saturate(0.82) hue-rotate(180deg) contrast(1)"
        : enemy.variant === "crawler"
          ? "brightness(0.75) saturate(0.55) hue-rotate(120deg) contrast(0.9)"
          : enemy.variant === "brute" || enemy.variant === "boss"
            ? "brightness(0.88) saturate(0.78) hue-rotate(300deg) contrast(1.04)"
            : "brightness(0.8) saturate(0.64) contrast(0.94)";
      ctx.filter = filter;
      ctx.globalAlpha = 0.94;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(enemyImage, -size * 0.48, -size * 0.68, size * 0.96, size * 0.96);
      ctx.filter = "none";
      if (enemy.hitTimer > 0) {
        ctx.globalCompositeOperation = "screen";
        ctx.fillStyle = "rgba(255, 120, 96, 0.12)";
        ctx.beginPath();
        ctx.arc(0, -8, 34, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
      }
    } else {
      ctx.fillStyle = enemy.color;
      ctx.fillRect(-enemy.w * 0.5, -enemy.h * 0.5, enemy.w, enemy.h);
    }

    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fillRect(-enemy.w * 0.28, -enemy.h * 0.18, enemy.w * 0.56, 8);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(-enemy.w * 0.5, -enemy.h * 0.64, enemy.w, 6);
    ctx.fillStyle = enemy.kind === "boss" ? "#ffd166" : "#72efdd";
    ctx.fillRect(-enemy.w * 0.5, -enemy.h * 0.64, enemy.w * (enemy.hp / enemy.maxHp), 6);
    ctx.restore();
  }
}

function drawCompanions() {
  for (const companion of state.companions) {
    ctx.save();
    ctx.translate(companion.x, companion.y);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(0, 20, 14, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    if (assets.hero.complete && assets.hero.naturalWidth > 0) {
      ctx.globalAlpha = 0.88;
      ctx.filter = "brightness(0.9) saturate(0.6) contrast(0.96)";
      ctx.drawImage(assets.hero, -36, -50, 72, 72);
      ctx.filter = "none";
    }
    ctx.restore();
  }
}

function drawBullets() {
  for (const beam of state.beams) {
    const alpha = Math.max(0, beam.life / 0.1);
    ctx.strokeStyle = `rgba(128, 255, 219, ${0.28 * alpha})`;
    ctx.lineWidth = beam.width + 10;
    ctx.beginPath();
    ctx.moveTo(beam.x, beam.y2);
    ctx.lineTo(beam.x, beam.y1);
    ctx.stroke();
    ctx.strokeStyle = `rgba(220, 255, 248, ${0.92 * alpha})`;
    ctx.lineWidth = beam.width * 0.45;
    ctx.beginPath();
    ctx.moveTo(beam.x, beam.y2);
    ctx.lineTo(beam.x, beam.y1);
    ctx.stroke();
  }

  for (const bullet of state.bullets) {
    const color = bullet.type === "flame" ? "255, 132, 56" : bullet.type === "spread" ? "255, 198, 255" : "255, 228, 148";
    const radius = bullet.type === "flame" ? bullet.r * 1.8 : 10;
    const glow = ctx.createRadialGradient(bullet.x, bullet.y, 1, bullet.x, bullet.y, radius);
    glow.addColorStop(0, `rgba(${color}, 0.95)`);
    glow.addColorStop(1, `rgba(${color}, 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = bullet.type === "flame" ? "#ff7b00" : bullet.type === "spread" ? "#ffc6ff" : "#ffe8a3";
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, bullet.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGates() {
  for (const gate of state.gates) {
    const drawOption = (x, option) => {
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(x - gate.width * 0.5, gate.y - gate.height * 0.5, gate.width, gate.height);
      ctx.strokeStyle = option.color;
      ctx.lineWidth = 3;
      ctx.strokeRect(x - gate.width * 0.5, gate.y - gate.height * 0.5, gate.width, gate.height);
      ctx.fillStyle = option.color;
      ctx.font = "700 24px 'Space Grotesk'";
      ctx.textAlign = "center";
      ctx.fillText(option.label, x, gate.y + 8);
    };

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(WIDTH * 0.5, gate.y - 38);
    ctx.lineTo(WIDTH * 0.5, gate.y + 38);
    ctx.stroke();

    drawOption(gate.leftX, gate.left);
    drawOption(gate.rightX, gate.right);
    ctx.textAlign = "start";
  }
}

function drawParticles() {
  for (const particle of state.particles) {
    ctx.globalAlpha = Math.max(0, particle.life * 4);
    ctx.fillStyle = particle.color;
    ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
  }
  ctx.globalAlpha = 1;
}

function drawFloatingTexts() {
  ctx.font = "700 16px 'Space Grotesk'";
  ctx.textAlign = "center";
  for (const text of state.floatingTexts) {
    ctx.globalAlpha = Math.max(0, text.life * 1.5);
    ctx.fillStyle = text.color;
    ctx.fillText(text.text, text.x, text.y);
  }
  ctx.globalAlpha = 1;
}

function drawHud() {
  const { player } = state;
  const compact = window.innerWidth <= 640;
  const weaponName = {
    bullet: "RIFLE",
    laser: "LASER",
    flame: "FLAMER",
    spread: "SPREAD",
  }[player.weaponType] || player.weaponType.toUpperCase();

  if (compact) {
    roundRect(14, 14, 198, 92, 18, "rgba(10, 14, 20, 0.78)", "rgba(255,255,255,0.1)");
    roundRect(WIDTH - 306, 14, 292, 92, 18, "rgba(10, 14, 20, 0.78)", "rgba(255,255,255,0.1)");
    ctx.fillStyle = "#f7fbff";
    ctx.font = "800 28px 'Space Grotesk'";
    ctx.fillText(`${Math.floor(state.score)}`, 30, 48);
    ctx.font = "700 15px 'Space Grotesk'";
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.fillText(`LV ${state.level}`, 30, 74);
    ctx.fillText(`${state.time.toFixed(0)}s`, 100, 74);

    ctx.fillStyle = "#f7fbff";
    ctx.font = "800 18px 'Space Grotesk'";
    ctx.fillText(weaponName, WIDTH - 288, 42);
    ctx.font = "800 15px 'Space Grotesk'";
    ctx.fillText(`ATK ${player.damage}`, WIDTH - 288, 72);
    ctx.fillText(`SHOT ${player.projectilesPerShot}`, WIDTH - 206, 72);
    ctx.fillText(`ALLY ${player.companionCount}`, WIDTH - 112, 72);
    ctx.font = "700 13px 'Space Grotesk'";
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.fillText(`PIERCE ${player.pierce}`, WIDTH - 288, 92);
    bar(WIDTH - 154, 86, 112, 8, state.xp / state.nextXp, "#72efdd");
    bar(WIDTH - 154, 28, 112, 12, player.hp / player.maxHp, "#ff6b6b");
    if (player.shield > 0) {
      bar(WIDTH - 154, 46, 112, 7, player.shield / 60, "#bde0fe");
    }
    ctx.fillStyle = "#fff";
    ctx.font = "800 12px 'Space Grotesk'";
    ctx.fillText("HP", WIDTH - 36, 38);
    ctx.fillText("XP", WIDTH - 36, 94);

    if (!audio.ready || audio.muted || state.audioHintTimer > 0) {
      roundRect(WIDTH * 0.5 - 120, HEIGHT - 46, 240, 30, 15, "rgba(10, 14, 20, 0.74)", "rgba(255,255,255,0.08)");
      ctx.fillStyle = "#f7fbff";
      ctx.textAlign = "center";
      ctx.font = "600 12px 'Space Grotesk'";
      ctx.fillText(audio.muted ? "M: sound on" : "Tap to enable sound", WIDTH * 0.5, HEIGHT - 27);
      ctx.textAlign = "start";
    }

    if (state.flash > 0) {
      ctx.fillStyle = `rgba(255, 120, 95, ${state.flash * 0.18})`;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
    return;
  }

  roundRect(18, 18, 302, 112, 22, "rgba(10, 14, 20, 0.72)", "rgba(255,255,255,0.08)");
  roundRect(WIDTH - 242, 18, 224, 112, 22, "rgba(10, 14, 20, 0.72)", "rgba(255,255,255,0.08)");
  roundRect(336, 18, 308, 70, 22, "rgba(10, 14, 20, 0.72)", "rgba(255,255,255,0.08)");

  ctx.fillStyle = "#f7fbff";
  ctx.font = "700 17px 'Space Grotesk'";
  ctx.fillText("SURVIVOR STATUS", 38, 42);
  ctx.font = "700 24px 'Space Grotesk'";
  ctx.fillText(`${Math.floor(state.score)}`, 38, 74);
  ctx.font = "600 14px 'Space Grotesk'";
  ctx.fillStyle = "rgba(255,255,255,0.68)";
  ctx.fillText(`Level ${state.level}`, 40, 100);
  ctx.fillText(`Combo x${Math.max(1, state.combo)}`, 126, 100);
  ctx.fillText(`${state.time.toFixed(1)} sec`, 218, 100);

  bar(356, 34, 236, 14, player.hp / player.maxHp, "#ff6b6b");
  bar(356, 60, 236, 10, state.xp / state.nextXp, "#72efdd");
  if (player.shield > 0) {
    bar(356, 78, 236, 8, player.shield / 60, "#bde0fe");
  }
  ctx.fillStyle = "#fff";
  ctx.font = "600 13px 'Space Grotesk'";
  ctx.fillText("HP", 602, 46);
  ctx.fillText("XP", 602, 66);

  ctx.fillStyle = "#f7fbff";
  ctx.font = "700 17px 'Space Grotesk'";
  ctx.fillText("WEAPON", WIDTH - 222, 42);
  ctx.font = "700 14px 'Space Grotesk'";
    ctx.fillText(`${weaponName} ${player.damage}`, WIDTH - 222, 68);
    ctx.fillText(`Burst ${player.projectilesPerShot}`, WIDTH - 222, 90);
    ctx.fillText(`Fire ${player.fireRate.toFixed(2)}s`, WIDTH - 222, 112);

  ctx.font = "600 12px 'Space Grotesk'";
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.fillText("Choose gates by moving left / right", WIDTH - 222, 132);

  if (!audio.ready || audio.muted || state.audioHintTimer > 0) {
    roundRect(WIDTH * 0.5 - 160, HEIGHT - 56, 320, 34, 17, "rgba(10, 14, 20, 0.74)", "rgba(255,255,255,0.08)");
    ctx.fillStyle = "#f7fbff";
    ctx.textAlign = "center";
    ctx.fillText(audio.muted ? "M 키로 사운드 다시 켜기" : "아무 키나 눌러 사운드 활성화 / M 음소거", WIDTH * 0.5, HEIGHT - 34);
    ctx.textAlign = "start";
  }

  if (state.flash > 0) {
    ctx.fillStyle = `rgba(255, 120, 95, ${state.flash * 0.18})`;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
}

function roundRect(x, y, w, h, r, fill, stroke) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function bar(x, y, w, h, ratio, color) {
  roundRect(x, y, w, h, h / 2, "rgba(255,255,255,0.12)");
  roundRect(x, y, w * clamp(ratio, 0, 1), h, h / 2, color);
}

function draw() {
  drawBackground();
  drawBullets();
  drawGates();
  drawEnemies();
  drawCompanions();
  drawPlayer();
  drawParticles();
  drawFloatingTexts();
  drawAtmosphere();
  drawHud();
}

function drawAtmosphere() {
  const fog = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  fog.addColorStop(0, "rgba(146, 132, 118, 0.03)");
  fog.addColorStop(0.55, "rgba(76, 86, 96, 0.035)");
  fog.addColorStop(1, "rgba(18, 22, 26, 0.14)");
  ctx.fillStyle = fog;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

window.addEventListener("keydown", (event) => {
  if (!audio.ready) audio.ensureReady();
  keys.add(event.code);
  if (event.code === "KeyM") {
    audio.setMuted(!audio.muted);
  }
  if (state.gameOver && event.code === "Enter") {
    resetGame();
  }
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.code);
});

window.addEventListener("pointerdown", () => {
  if (!audio.ready) audio.ensureReady();
});

function updatePointerFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = WIDTH / rect.width;
  pointerState.x = clamp((event.clientX - rect.left) * scaleX, 0, WIDTH);
}

canvas.addEventListener("pointerdown", (event) => {
  pointerState.active = true;
  updatePointerFromEvent(event);
  if (!audio.ready) audio.ensureReady();
});

canvas.addEventListener("pointermove", (event) => {
  if (!pointerState.active) return;
  updatePointerFromEvent(event);
});

function releasePointer() {
  pointerState.active = false;
}

canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);
canvas.addEventListener("pointerleave", releasePointer);

resetGame();
requestAnimationFrame(loop);
