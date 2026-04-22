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
  enemyVariants: loadImage("assets/enemy-variants-v1.png"),
  bg: loadImage("assets/bg-mobile-highway-v1.png"),
};

const enemySpriteFrames = {
  sprinter: { sx: 38, sy: 94, sw: 344, sh: 488, scale: 1.02 },
  crawler: { sx: 390, sy: 306, sw: 420, sh: 286, scale: 1.06 },
  brute: { sx: 828, sy: 116, sw: 368, sh: 474, scale: 1.16 },
  runner: { sx: 1284, sy: 90, sw: 330, sh: 504, scale: 1.06 },
  boss: { sx: 1640, sy: 70, sw: 484, sh: 536, scale: 1.22 },
};

const starterWeapons = {
  rifle: {
    name: "RIFLE",
    desc: "가장 안정적인 기본 총기.",
    apply: (player) => {
      player.weaponType = "bullet";
      player.damage = 2;
      player.projectilesPerShot = 1;
      player.pierce = 0;
    },
  },
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
    key: "rate",
    title: "고속 장전",
    desc: "발사 간격 감소, 체감 화력이 크게 오릅니다.",
    apply: (state) => state.player.fireRate = Math.max(0.07, state.player.fireRate - 0.018),
  },
  {
    key: "multishot",
    title: "전방 사격",
    desc: "탄환 수 +1, 전방 화력이 강해집니다.",
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
    waveCount: 0,
    difficulty: 1,
    stage: 1,
    stageTime: 0,
    stageDuration: 60,
    stageBossesSpawned: 0,
    stageBossesDefeated: 0,
    stageStartScore: 0,
    stageClear: false,
    pendingClear: false,
    stageKills: 0,
    stageItems: 0,
    enemyLane: Math.random() < 0.5 ? "left" : "right",
    pendingStageBonus: 0,
    started: false,
    gameOver: false,
    audioHintTimer: 4,
    flash: 0,
    horizonPulse: 0,
    player: {
      x: laneX("left"),
      y: HEIGHT - 190,
      w: 58,
      h: 78,
      lane: "left",
      switchCooldown: 0,
      roll: 0,
      fireRate: 0.32,
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
      hitFlash: 0,
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
  showStartScreen();
  audio.sequenceStep = 0;
  audio.musicClock = 0;
}

function startGame(weaponKey = "rifle") {
  state = createState();
  const starter = starterWeapons[weaponKey] || starterWeapons.rifle;
  starter.apply(state.player);
  state.started = true;
  overlay.className = "overlay hidden";
  overlay.innerHTML = "";
  audio.sequenceStep = 0;
  audio.musicClock = 0;
  addBannerText(`${starter.name} READY`, "#ffd6a5");
  const enemyLabel = state.enemyLane === "left" ? "◀ 왼쪽 = 적" : "오른쪽 = 적 ▶";
  setTimeout(() => addBannerText(enemyLabel, "#ef476f"), 700);
}

function laneX(side) {
  return side === "left" ? WIDTH * 0.34 : WIDTH * 0.66;
}

function resetWeaponLoadout() {
  const player = state.player;
  player.weaponType = "bullet";
  player.damage = 2;
  player.projectilesPerShot = 1;
  player.fireRate = 0.32;
  player.projectileSpeed = 760;
  player.spread = 0.1;
  player.pierce = 0;
  player.fireTimer = 0;
  player.companionCount = 0;
  state.companions = [];
}

function spawnEnemy(kind = "normal", x = null) {
  const t = state.time;
  const intensity = 1 + Math.min(3.6, t / 40) + (state.stage - 1) * 0.28;
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

  const uniformSpeed = 72 + intensity * 18;

  const base = {
    x: x ?? rand(state.player.laneMinX + 14, state.player.laneMaxX - 14),
    y: -40,
    w: 30,
    h: 40,
    speed: uniformSpeed,
    hp: 3 + Math.floor(intensity * 1.2),
    maxHp: 3 + Math.floor(intensity * 1.2),
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
    base.hp = Math.max(3, base.hp - 1);
    base.maxHp = base.hp;
    base.value += 2;
    base.color = "#ff7b00";
    base.w = 26;
    base.scale *= 0.92;
  }

  if (variant === "crawler") {
    base.hp += 3;
    base.maxHp = base.hp;
    base.damage = 9;
    base.value += 3;
    base.color = "#8ecae6";
    base.scale *= 0.82;
  }

  if (variant === "brute") {
    base.hp += 8;
    base.maxHp = base.hp;
    base.damage = 18;
    base.value += 7;
    base.color = "#ffb703";
    base.w = 44;
    base.h = 54;
    base.scale *= 1.28;
  }

  if (tankType) {
    base.hp += 5;
    base.maxHp = base.hp;
    base.damage = 16;
    base.value += 5;
    base.color = "#c77dff";
    base.w = 40;
    base.h = 48;
    base.scale *= 1.22;
  }

  if (variant === "sprinter") {
    base.hp += 1;
    base.maxHp = base.hp;
    base.value += 2;
    base.color = "#7cc6fe";
    base.scale *= 0.9;
  }

  if (kind === "boss") {
    const bossLane = state.enemyLane;
    base.x = laneX(bossLane);
    base.y = -70;
    base.w = 64;
    base.h = 72;
    base.speed = uniformSpeed * 0.85;
    base.hp = 32 + Math.floor(intensity * 11);
    base.maxHp = base.hp;
    base.damage = 24;
    base.value = 36;
    base.color = "#ffd166";
    base.scale = 1.85;
    base.variant = "boss";
    base.bossLane = bossLane;
    base.laneSwitchTimer = Infinity;
  }

  base.laneCenter = laneX(base.x < WIDTH * 0.5 ? "left" : "right");
  state.enemies.push(base);
}

function fireShot() {
  const player = state.player;
  if (player.weaponType === "laser") {
    fireLaser(player.x, player.y - player.h * 0.5, player.damage, 1);
    audio.shot();
    state.flash = 0.14;
    state.player.muzzleTimer = 0.08;
    return;
  }

  const count = player.projectilesPerShot;

  if (player.weaponType === "flame") {
    const flameRange = clamp(250 + state.level * 28 + count * 34, 280, HEIGHT * 0.5);
    for (let i = 0; i < Math.max(5, count * 4); i += 1) {
      const ySpeed = player.projectileSpeed * rand(0.42, 0.58);
      state.bullets.push({
        x: player.x + rand(-8, 8),
        y: player.y - player.h * 0.5,
        r: rand(7, 13),
        speed: ySpeed,
        vx: rand(-0.045, 0.045) * player.projectileSpeed,
        vy: -ySpeed,
        damage: Math.max(1, Math.ceil(player.damage * 0.55)),
        pierce: 0,
        type: "flame",
        life: (flameRange / ySpeed) * rand(0.86, 1.08),
      });
    }
    audio.shot();
    state.flash = 0.12;
    state.player.muzzleTimer = 0.08;
    return;
  }

  for (let i = 0; i < count; i += 1) {
    const offset = (i - (count - 1) / 2) * 8;
    state.bullets.push({
      x: player.x + offset,
      y: player.y - player.h * 0.5,
      r: 5,
      speed: player.projectileSpeed,
      vx: 0,
      vy: -player.projectileSpeed,
      damage: player.damage,
      pierce: player.pierce || 0,
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
  const count = Math.min(1, lanes);
  const center = (count - 1) / 2;
  for (let i = 0; i < count; i += 1) {
    offsets.push((i - center) * 24);
  }

  for (const offset of offsets) {
    const beamX = x + offset;
    state.beams.push({ x: beamX, y1: 18, y2: y, life: 0.1, width: 8 });
    let targetEnemy = null;
    let targetIndex = -1;
    for (const enemy of state.enemies) {
      const horizontal = Math.abs(enemy.x - beamX) < enemy.w * 0.8 + 18;
      const vertical = enemy.y < y + enemy.h * 0.5 && enemy.y > 0;
      if (horizontal && vertical) {
        if (!targetEnemy || enemy.y > targetEnemy.y) {
          targetEnemy = enemy;
          targetIndex = state.enemies.indexOf(enemy);
        }
      }
    }
    if (targetEnemy) {
      targetEnemy.hp -= damage * 2.2;
      targetEnemy.hitTimer = 0.16;
      spawnHitParticles(targetEnemy.x, targetEnemy.y, targetEnemy.color);
      if (targetEnemy.hp <= 0) {
        defeatEnemy(targetIndex);
      }
      continue;
    }

    let targetItem = null;
    let targetItemIndex = -1;
    for (let i = state.gates.length - 1; i >= 0; i -= 1) {
      const item = state.gates[i];
      const horizontal = Math.abs(item.x - beamX) < item.width * 0.5 + 12;
      const vertical = item.y < y && item.y > 0;
      if (horizontal && vertical) {
        if (!targetItem || item.y > targetItem.y) {
          targetItem = item;
          targetItemIndex = i;
        }
      }
    }
    if (targetItem) {
      targetItem.hp -= damage * 2.2;
      spawnHitParticles(targetItem.x, targetItem.y, targetItem.option.color);
      if (targetItem.hp <= 0) {
        collectItemBox(targetItemIndex);
      }
    }
  }
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
    defeatEnemy(i);
  }
}

function defeatEnemy(index) {
  const enemy = state.enemies[index];
  if (!enemy) return;
  state.stageKills += 1;
  if (enemy.kind === "boss") {
    state.stageBossesDefeated += 1;
    addBannerText(`BOSS ${state.stageBossesDefeated}/2 DOWN`, "#ffd166");
    if (state.stageBossesDefeated >= 2 && !state.stageClear) {
      state.pendingClear = true;
    }
  }
  gainXp(enemy.value, enemy.x, enemy.y);
  audio.enemyDown();
  state.flash = Math.max(state.flash, 0.12);
  state.enemies.splice(index, 1);
}

function removeEnemyWithoutKill(index) {
  const enemy = state.enemies[index];
  if (!enemy) return;
  if (enemy.kind === "boss") {
    state.stageBossesSpawned = Math.max(state.stageBossesDefeated, state.stageBossesSpawned - 1);
  }
  state.enemies.splice(index, 1);
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
      label: "SHOT",
      tier: 1,
      color: "#72efdd",
      apply: () => {
        state.player.projectilesPerShot = Math.min(5, state.player.projectilesPerShot + 1);
        addBannerText("SHOT +1", "#72efdd");
      },
    },
    {
      label: "POWER",
      tier: 1,
      color: "#ffd166",
      apply: () => {
        state.player.damage = Math.min(12, state.player.damage + 1);
        addBannerText("POWER +1", "#ffd166");
      },
    },
    {
      label: "RATE",
      tier: 2,
      color: "#caffbf",
      apply: () => {
        state.player.fireRate = Math.max(0.08, state.player.fireRate - 0.045);
        addBannerText("RATE UP", "#caffbf");
      },
    },
    {
      label: "PIERCE",
      tier: 2,
      color: "#bde0fe",
      apply: () => {
        state.player.pierce = Math.min(3, (state.player.pierce || 0) + 1);
        addBannerText(`PIERCE +1`, "#bde0fe");
      },
    },
    {
      label: "SPEED",
      tier: 2,
      color: "#80ffdb",
      apply: () => {
        state.player.projectileSpeed = Math.min(1400, state.player.projectileSpeed + 120);
        addBannerText("BULLET SPEED UP", "#80ffdb");
      },
    },
    {
      label: "DMG x2",
      tier: 3,
      color: "#ff9770",
      apply: () => {
        state.player.damage = Math.min(14, Math.max(state.player.damage + 1, state.player.damage * 2));
        addBannerText("DAMAGE x2", "#ff9770");
      },
    },
    {
      label: "ALLY",
      tier: 2,
      color: "#f1c0e8",
      apply: () => {
        state.player.companionCount = Math.min(4, (state.player.companionCount || 0) + 1);
        syncCompanions();
        addBannerText("ALLY +1", "#f1c0e8");
      },
    },
    {
      label: "ALLY x2",
      tier: 3,
      color: "#ff99c8",
      apply: () => {
        state.player.companionCount = Math.min(4, Math.max(1, (state.player.companionCount || 0) * 2));
        syncCompanions();
        addBannerText("ALLY x2", "#ff99c8");
      },
    },
  ];

  const choices = optionPool.filter((option) => option.tier <= powerTier);
  return choices[randInt(0, choices.length - 1)];
}

function spawnChoiceWave() {
  state.waveCount += 1;
  const enemySide = state.enemyLane;
  spawnEnemy("normal", laneX(enemySide));

  // Item lane: rare, deliberate decision points
  const shouldSpawnItem = state.waveCount % 6 === 0 || (state.waveCount > 10 && Math.random() < 0.06);
  if (!shouldSpawnItem) {
    return;
  }

  const itemSide = enemySide === "left" ? "right" : "left";
  const playerDamage = Math.max(1, state.player.damage || 1);
  const shotsRequired = clamp(5 + Math.floor(state.stage * 0.6) + Math.floor(state.difficulty * 0.7), 5, 11);
  const hp = Math.ceil(playerDamage * shotsRequired);
  state.gates.push({
    x: laneX(itemSide),
    y: -48,
    vy: 118 + state.stage * 4,
    width: 116,
    height: 52,
    hp,
    maxHp: hp,
    option: createGateOption(),
  });
}

function collectItemBox(index) {
  const item = state.gates[index];
  if (!item) return;
  item.option.apply();
  state.score += 18;
  state.stageItems += 1;
  audio.levelUp();
  state.gates.splice(index, 1);
}

function addFloatingText(text, x, y, color = "#ffffff") {
  state.floatingTexts.push({ text, x, y, color, life: 0.7 });
}

function addBannerText(text, color = "#ffffff") {
  state.floatingTexts.push({
    text,
    x: WIDTH * 0.5,
    y: 128,
    color,
    life: 1.25,
    banner: true,
  });
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

function showStartScreen() {
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="card start-card">
      <p class="start-kicker">LANE SURVIVOR</p>
      <h2>출격 준비</h2>
      <p>← → 키 (또는 화면 좌우 터치)로 라인 전환. 한쪽 라인엔 적이, 반대쪽엔 아이템 상자가 내려옵니다. 상자마다 몇 발이 필요한지 표시되니 신중히 선택하세요.</p>
      <button class="choice start-big" type="button" data-weapon="rifle">
        <strong>START</strong>
        <span>RIFLE 장착 후 출격</span>
      </button>
    </div>
  `;
}

function showGameOver() {
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="card">
      <h2>작전 종료</h2>
      <p>총점 ${Math.floor(state.score)}점 / 생존 ${state.time.toFixed(1)}초 / 스테이지 ${state.stage}</p>
      <button class="choice restart-choice" type="button" data-restart="true">다시 무기 선택하기</button>
    </div>
  `;
}

function showStageClear() {
  state.stageClear = true;
  const hpBonus = Math.floor(state.player.hp * 2);
  const killBonus = state.stageKills * 6;
  const itemBonus = state.stageItems * 30;
  state.pendingStageBonus = Math.floor(
    240 + state.stage * 90 + hpBonus + state.stageBossesDefeated * 180 + killBonus + itemBonus,
  );
  const stageScore = Math.max(0, Math.floor(state.score - state.stageStartScore));
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="card stage-clear-card">
      <p class="start-kicker">STAGE ${state.stage} CLEAR</p>
      <h2>전장 돌파 성공</h2>
      <div class="score-grid">
        <div><span>Stage Score</span><strong>${stageScore}</strong></div>
        <div><span>Kills</span><strong>${state.stageKills}</strong></div>
        <div><span>Items</span><strong>${state.stageItems}</strong></div>
        <div><span>Boss Down</span><strong>${state.stageBossesDefeated}/2</strong></div>
        <div><span>Survived HP</span><strong>${Math.ceil(state.player.hp)}/${state.player.maxHp}</strong></div>
        <div><span>Clear Bonus</span><strong>+${state.pendingStageBonus}</strong></div>
      </div>
      <p class="stage-clear-note">다음 스테이지에서 무기가 <strong>RIFLE 기본값으로 리셋</strong>됩니다. 다시 아이템을 모아 빌드를 완성하세요.</p>
      <p class="stage-clear-total">TOTAL <strong>${Math.floor(state.score + state.pendingStageBonus)}</strong></p>
      <button class="choice restart-choice" type="button" data-next-stage="true">다음 스테이지 진입</button>
    </div>
  `;
}

function advanceStage() {
  state.score += state.pendingStageBonus;
  state.stage += 1;
  state.stageTime = 0;
  state.stageBossesSpawned = 0;
  state.stageBossesDefeated = 0;
  state.stageStartScore = state.score;
  state.waveCount = 0;
  state.stageClear = false;
  state.pendingClear = false;
  state.pendingStageBonus = 0;
  state.enemyTimer = 1.2;
  state.stageKills = 0;
  state.stageItems = 0;
  state.enemyLane = Math.random() < 0.5 ? "left" : "right";
  const enemyLabel = state.enemyLane === "left" ? "◀ 왼쪽 = 적" : "오른쪽 = 적 ▶";
  addBannerText(enemyLabel, "#ef476f");
  state.enemies = [];
  state.bullets = [];
  state.beams = [];
  state.gates = [];
  resetWeaponLoadout();
  addBannerText("WEAPON RESET", "#ffd6a5");
  state.player.hp = clamp(state.player.hp + state.player.maxHp * 0.28, 0, state.player.maxHp);
  state.player.shield = Math.min(60, state.player.shield + 18);
  state.horizonPulse = 1;
  state.flash = Math.max(state.flash, 0.2);
  audio.levelUp();
  overlay.className = "overlay hidden";
  overlay.innerHTML = "";
  addBannerText(`STAGE ${state.stage}`, "#ffd166");
}

function rectsOverlap(a, b) {
  return (
    Math.abs(a.x - b.x) * 2 < (a.w + b.w) &&
    Math.abs(a.y - b.y) * 2 < (a.h + b.h)
  );
}

function update(dt) {
  if (!state.started || state.gameOver || state.stageClear) {
    return;
  }

  state.time += dt;
  state.stageTime += dt;
  state.distance += dt * 18;
  state.difficulty = 1 + Math.min(1.4, state.stageTime / 92) + (state.stage - 1) * 0.34;

  const player = state.player;

  // Lane switching: keyboard or touch
  if (pointerState.active) {
    player.lane = pointerState.x < WIDTH * 0.5 ? "left" : "right";
  } else if (player.switchCooldown <= 0) {
    if ((keys.has("ArrowLeft") || keys.has("KeyA")) && player.lane !== "left") {
      player.lane = "left";
      player.switchCooldown = 0.28;
    } else if ((keys.has("ArrowRight") || keys.has("KeyD")) && player.lane !== "right") {
      player.lane = "right";
      player.switchCooldown = 0.28;
    }
  }
  player.switchCooldown = Math.max(0, player.switchCooldown - dt);

  // Smooth slide to lane
  const targetX = laneX(player.lane);
  const distToTarget = targetX - player.x;
  player.x += distToTarget * Math.min(1, dt * 14);

  // Roll tilt during lane change
  player.roll += ((Math.abs(distToTarget) > 8 ? Math.sign(distToTarget) * 0.08 : 0) - player.roll) * Math.min(1, dt * 10);

  player.fireTimer -= dt;
  player.hitFlash = Math.max(0, player.hitFlash - dt * 4);
  player.muzzleTimer = Math.max(0, player.muzzleTimer - dt);
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
    spawnChoiceWave();
    const baseRate = 1.35 - Math.min(0.48, state.stageTime * 0.0044) - (state.stage - 1) * 0.05;
    const spawnRate = Math.max(0.55, baseRate);
    state.enemyTimer = rand(spawnRate * 0.65, spawnRate);
  }

  const bossTimes = [22, 46];
  if (
    state.stageBossesSpawned < 2 &&
    state.stageTime >= bossTimes[state.stageBossesSpawned]
  ) {
    spawnEnemy("boss");
    state.stageBossesSpawned += 1;
    addBannerText(`BOSS ${state.stageBossesSpawned}/2 INCOMING`, "#ffd166");
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

    if (enemy.kind === "boss") {
      enemy.bossLane = state.enemyLane;
      enemy.laneCenter = laneX(state.enemyLane);
      enemy.x += (enemy.laneCenter - enemy.x) * Math.min(1, dt * 1.6);
    } else {
      enemy.x += Math.sin(enemy.frame) * 18 * dt;
    }

    const lanePad = enemy.kind === "boss" ? 28 : 58;
    enemy.x = clamp(enemy.x, (enemy.laneCenter || WIDTH * 0.5) - lanePad, (enemy.laneCenter || WIDTH * 0.5) + lanePad);
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

    let bulletRemoved = false;
    for (let j = state.gates.length - 1; j >= 0; j -= 1) {
      const item = state.gates[j];
      const hit =
        bullet.x > item.x - item.width * 0.5 &&
        bullet.x < item.x + item.width * 0.5 &&
        bullet.y > item.y - item.height * 0.5 &&
        bullet.y < item.y + item.height * 0.5;

      if (!hit) continue;
      item.hp -= bullet.damage;
      spawnHitParticles(bullet.x, bullet.y, item.option.color);
      audio.hit();
      if (item.hp <= 0) {
        collectItemBox(j);
      }
      state.bullets.splice(i, 1);
      bulletRemoved = true;
      break;
    }
    if (bulletRemoved) {
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
        defeatEnemy(j);
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
      removeEnemyWithoutKill(i);
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
      removeEnemyWithoutKill(i);
      applyPlayerDamage(enemy.damage);
      state.player.hitFlash = 1;
      state.flash = 0.35;
      audio.playerHurt();
    }
  }

  for (let i = state.gates.length - 1; i >= 0; i -= 1) {
    const item = state.gates[i];
    if (item.y > HEIGHT + 60) {
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
  } else if (state.pendingClear || state.stageBossesDefeated >= 2) {
    state.pendingClear = false;
    showStageClear();
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

    const enemyImage = assets.enemyVariants;
    const frame = enemySpriteFrames[enemy.variant] || enemySpriteFrames.runner;
    if (enemyImage.complete && enemyImage.naturalWidth > 0) {
      const drawH = enemy.h * enemy.scale * (frame.scale || 1) * 2.25;
      const drawW = drawH * (frame.sw / frame.sh);
      ctx.filter = "brightness(0.86) saturate(0.78) contrast(1.02)";
      ctx.globalAlpha = 0.94;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        enemyImage,
        frame.sx,
        frame.sy,
        frame.sw,
        frame.sh,
        -drawW * 0.5,
        -drawH * 0.72,
        drawW,
        drawH,
      );
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
    ctx.fillStyle = "rgba(0,0,0,0.34)";
    ctx.beginPath();
    ctx.ellipse(0, 28, 24, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(114, 239, 221, 0.82)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, -14, 38, 0, Math.PI * 2);
    ctx.stroke();
    if (assets.hero.complete && assets.hero.naturalWidth > 0) {
      ctx.globalAlpha = 0.96;
      ctx.filter = "brightness(1.1) saturate(0.95) hue-rotate(155deg) contrast(1.08)";
      ctx.drawImage(assets.hero, -52, -74, 104, 104);
      ctx.filter = "none";
    }
    ctx.fillStyle = "#72efdd";
    ctx.font = "800 13px 'Space Grotesk'";
    ctx.textAlign = "center";
    ctx.fillText("ALLY", 0, -54);
    ctx.textAlign = "start";
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
    const color = bullet.type === "flame" ? "255, 132, 56" : "255, 228, 148";
    const radius = bullet.type === "flame" ? bullet.r * 1.8 : 10;
    const glow = ctx.createRadialGradient(bullet.x, bullet.y, 1, bullet.x, bullet.y, radius);
    glow.addColorStop(0, `rgba(${color}, 0.95)`);
    glow.addColorStop(1, `rgba(${color}, 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = bullet.type === "flame" ? "#ff7b00" : "#ffe8a3";
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, bullet.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGates() {
  const playerDmg = Math.max(1, state.player.damage || 1);
  for (const item of state.gates) {
    const hpRatio = clamp(item.hp / item.maxHp, 0, 1);
    const x = item.x - item.width * 0.5;
    const y = item.y - item.height * 0.5;
    const glow = ctx.createRadialGradient(item.x, item.y, 8, item.x, item.y, 82);
    glow.addColorStop(0, `${item.option.color}55`);
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(item.x, item.y, 82, 0, Math.PI * 2);
    ctx.fill();
    roundRect(x, y, item.width, item.height, 12, "rgba(9, 15, 22, 0.82)", item.option.color);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(x + 8, y + 8, item.width - 16, 8);
    ctx.fillStyle = item.option.color;
    ctx.fillRect(x + 8, y + 8, (item.width - 16) * hpRatio, 8);

    // Option label (centered)
    ctx.fillStyle = item.option.color;
    ctx.font = "900 22px 'Space Grotesk'";
    ctx.textAlign = "center";
    ctx.fillText(item.option.label, item.x, item.y + 10);

    // Shots-to-break indicator (above the box)
    const shotsNeeded = Math.max(1, Math.ceil(item.hp / playerDmg));
    const badgeW = 64;
    const badgeH = 24;
    const badgeY = item.y - item.height * 0.5 - 30;
    roundRect(item.x - badgeW * 0.5, badgeY, badgeW, badgeH, 12, "rgba(5, 9, 14, 0.88)", item.option.color);
    ctx.fillStyle = item.option.color;
    ctx.font = "900 16px 'Space Grotesk'";
    ctx.fillText(`${shotsNeeded}`, item.x - 10, badgeY + 17);
    ctx.font = "800 10px 'Space Grotesk'";
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.fillText("SHOTS", item.x + 14, badgeY + 16);
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
  ctx.textAlign = "center";
  for (const text of state.floatingTexts) {
    ctx.globalAlpha = Math.min(1, Math.max(0, text.life * 1.5));
    if (text.banner) {
      const width = Math.min(460, 112 + text.text.length * 16);
      roundRect(text.x - width * 0.5, text.y - 28, width, 44, 20, "rgba(4, 8, 13, 0.82)", "rgba(255,255,255,0.16)");
      ctx.font = "900 24px 'Space Grotesk'";
    } else {
      ctx.font = "800 17px 'Space Grotesk'";
    }
    ctx.fillStyle = text.color;
    ctx.fillText(text.text, text.x, text.y);
  }
  ctx.globalAlpha = 1;
}

function drawHud() {
  const { player } = state;
  const stageLeft = Math.max(0, Math.ceil(state.stageDuration - state.stageTime));
  const weaponName = {
    bullet: "RIFLE",
    laser: "LASER",
    flame: "FLAMER",
  }[player.weaponType] || player.weaponType.toUpperCase();

  // 3 panels: Status | HP/XP | Weapon — 220px each, 12px gap, 18px side margin
  const panelY = 18;
  const panelH = 120;
  const leftX = 18;
  const midX = 250;
  const rightX = 482;
  const panelW = 220;

  roundRect(leftX, panelY, panelW, panelH, 22, "rgba(10, 14, 20, 0.72)", "rgba(255,255,255,0.08)");
  roundRect(midX, panelY, panelW, panelH, 22, "rgba(10, 14, 20, 0.72)", "rgba(255,255,255,0.08)");
  roundRect(rightX, panelY, panelW, panelH, 22, "rgba(10, 14, 20, 0.72)", "rgba(255,255,255,0.08)");

  // Left panel — score & stage
  ctx.fillStyle = "#f7fbff";
  ctx.font = "700 15px 'Space Grotesk'";
  ctx.fillText("SCORE", leftX + 20, panelY + 24);
  ctx.font = "700 26px 'Space Grotesk'";
  ctx.fillText(`${Math.floor(state.score)}`, leftX + 20, panelY + 56);
  ctx.font = "600 13px 'Space Grotesk'";
  ctx.fillStyle = "rgba(255,255,255,0.68)";
  ctx.fillText(`Stage ${state.stage}`, leftX + 20, panelY + 82);
  ctx.fillText(`Boss ${state.stageBossesDefeated}/2`, leftX + 100, panelY + 82);
  ctx.fillText(`${stageLeft}s left`, leftX + 20, panelY + 104);

  // Middle panel — HP / XP / Shield bars with labels
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.font = "700 12px 'Space Grotesk'";
  ctx.fillText("HP", midX + 16, panelY + 22);
  ctx.fillText("XP", midX + 16, panelY + 60);
  const barX = midX + 44;
  const barW = 160;
  bar(barX, panelY + 12, barW, 14, player.hp / player.maxHp, "#ff6b6b");
  bar(barX, panelY + 50, barW, 10, state.xp / state.nextXp, "#72efdd");
  ctx.fillStyle = "#f7fbff";
  ctx.font = "600 11px 'Space Grotesk'";
  ctx.fillText(`${Math.ceil(player.hp)}/${player.maxHp}`, barX + 4, panelY + 23);
  ctx.fillText(`Lv ${state.level}`, barX + 4, panelY + 59);
  if (player.shield > 0) {
    ctx.fillStyle = "rgba(255,255,255,0.72)";
    ctx.font = "700 12px 'Space Grotesk'";
    ctx.fillText("SH", midX + 16, panelY + 88);
    bar(barX, panelY + 80, barW, 8, player.shield / 60, "#bde0fe");
  }
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "600 11px 'Space Grotesk'";
  ctx.fillText(`Combo x${state.combo}`, midX + 16, panelY + 108);

  // Right panel — weapon
  ctx.fillStyle = "#f7fbff";
  ctx.font = "700 15px 'Space Grotesk'";
  ctx.fillText("WEAPON", rightX + 20, panelY + 24);
  ctx.font = "700 13px 'Space Grotesk'";
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fillText(`${weaponName}`, rightX + 20, panelY + 48);
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.font = "600 12px 'Space Grotesk'";
  ctx.fillText(`PWR  ${player.damage}`, rightX + 20, panelY + 68);
  ctx.fillText(`BURST  ${player.projectilesPerShot}`, rightX + 20, panelY + 86);
  ctx.fillText(`FIRE  ${player.fireRate.toFixed(2)}s`, rightX + 20, panelY + 104);

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
  drawAtmosphere();
  drawHud();
  drawFloatingTexts();
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
  if (state.stageClear && event.code === "Enter") {
    advanceStage();
  }
});

overlay.addEventListener("click", (event) => {
  const weaponButton = event.target.closest("[data-weapon]");
  if (weaponButton) {
    if (!audio.ready) audio.ensureReady();
    startGame(weaponButton.dataset.weapon);
    return;
  }

  const restartButton = event.target.closest("[data-restart]");
  if (restartButton) {
    resetGame();
    return;
  }

  const nextStageButton = event.target.closest("[data-next-stage]");
  if (nextStageButton) {
    if (!audio.ready) audio.ensureReady();
    advanceStage();
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
