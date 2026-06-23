/*
  Platformer Dash - game.js
  - Author: Senior HTML5 Game Dev (AI-assisted)
  - Purpose: Complete, self-contained platformer using canvas, vanilla JS, WebAudio.
  - Architecture: OO classes with CONFIG central.
*/

/* =========================
   CONFIG - all tunables here
   Values are in pixels/sec units where applicable
   ========================= */
const CONFIG = {
  // Canvas
  CANVAS_WIDTH: 800,
  CANVAS_HEIGHT: 600,

  // World
  LEVEL_WIDTH: 3000,
  LEVEL_HEIGHT: 1000,
  DEATH_Y: 700,

  // Physics (converted from px/frame to px/sec)
  GRAVITY: 2160, // ~0.6 px/frame^2 at 60fps -> 0.6 * 60 * 60
  TERMINAL_VELOCITY: 900, // 15 px/frame * 60
  PLAYER_SPEED_MAX: 300, // 5 px/frame * 60
  PLAYER_ACCEL: 2000, // acceleration px/s^2
  PLAYER_DECEL: 2000, // deceleration px/s^2
  PLAYER_WIDTH: 40,
  PLAYER_HEIGHT: 50,

  // Jump (converted)
  JUMP_FORCE: 720, // 12 px/frame * 60
  JUMP_HOLD_MAX_MS: 800, // max hold to increase jump
  JUMP_HOLD_MIN_MS: 200,
  COYOTE_MS: 150, // 150ms coyote time
  JUMP_BUFFER_MS: 150, // buffer input before landing

  // Enemy
  ENEMY_SPEED: 90, // 1.5 px/frame * 60
  ENEMY_WIDTH: 30,
  ENEMY_HEIGHT: 30,

  // Coin
  COIN_SIZE: 15,
  COIN_VALUE: 10,
  COIN_COUNT: 15,

  // Game
  START_LIVES: 3,
  INVINCIBILITY_MS: 1000,
  KNOCKBACK: 300, // px/sec immediate applied as velocityX
  DEBUG: false,

  // Fragile
  FRAGILE_CRACK_MS: 1000,
  FRAGILE_RESPAWN_MS: 5000,

  // Bounce
  BOUNCE_MULT: 1.8,

  // Misc
  TARGET_FPS: 60,
};

/* Difficulty presets - will be applied at game start */
const DIFFICULTIES = {
  EASY: { START_LIVES: 5, ENEMY_SPEED: 60, COIN_COUNT: 10 },
  NORMAL: { START_LIVES: 3, ENEMY_SPEED: 90, COIN_COUNT: 15 },
  HARD: { START_LIVES: 2, ENEMY_SPEED: 130, COIN_COUNT: 20 },
};

/* =========================
   Utility functions
   ========================= */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const nowMs = () => performance.now();
const rand = (a, b) => a + Math.random() * (b - a);

/* =========================
   AudioManager - WebAudio procedural sounds
   ========================= */
class AudioManager {
  constructor() {
    this.enabled = true;
    this.volume = parseFloat(localStorage.getItem("pd_volume") || 0.6);
    this.muted = localStorage.getItem("pd_muted") === "true";
    this._initContext();
  }

  _initContext() {
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      this.ctx = new C();
    } catch (e) {
      console.warn("WebAudio not supported");
      this.ctx = null;
      this.enabled = false;
    }
  }

  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    localStorage.setItem("pd_volume", this.volume);
  }
  setMute(b) {
    this.muted = !!b;
    localStorage.setItem("pd_muted", this.muted);
  }

  playTone({
    freq = 440,
    type = "sine",
    time = 0.1,
    attack = 0.01,
    decay = 0.1,
    volume = 0.5,
  }) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = 0;
    o.connect(g);
    g.connect(this.ctx.destination);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, volume * this.volume),
      t + attack,
    );
    g.gain.exponentialRampToValueAtTime(0.0001, t + time);
    o.start(t);
    o.stop(t + time + 0.02);
  }

  playJump() {
    this.playTone({
      freq: 420,
      type: "sine",
      time: 0.18,
      attack: 0.01,
      volume: 0.5,
    });
  }
  playCoin() {
    this.playTone({
      freq: 880,
      type: "sine",
      time: 0.28,
      attack: 0.001,
      volume: 0.7,
    });
  }
  playHit() {
    this.playTone({
      freq: 200,
      type: "square",
      time: 0.24,
      attack: 0.001,
      volume: 0.6,
    });
  }
  playGameOver() {
    this.playTone({
      freq: 400,
      type: "sine",
      time: 0.9,
      attack: 0.05,
      volume: 0.7,
    });
    this.playTone({
      freq: 260,
      type: "sine",
      time: 0.9,
      attack: 0.05,
      volume: 0.6,
    });
  }
  playVictory() {
    this.playTone({ freq: 880, time: 0.18, volume: 0.7 });
    setTimeout(
      () => this.playTone({ freq: 660, time: 0.18, volume: 0.7 }),
      180,
    );
    setTimeout(
      () => this.playTone({ freq: 880, time: 0.24, volume: 0.8 }),
      360,
    );
  }
}

/* =========================
   Particle & Pool (object pooling)
   ========================= */
class Particle {
  constructor() {
    this.reset();
  }
  reset(x = 0, y = 0, vx = 0, vy = 0, size = 4, color = "#fff", life = 600) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.size = size;
    this.color = color;
    this.life = life;
    this.age = 0;
    this.alive = true;
  }
  update(dt) {
    if (!this.alive) return;
    this.age += dt;
    if (this.age >= this.life) {
      this.alive = false;
      return;
    }
    this.vy += 300 * (dt / 1000); // light gravity on particles
    this.x += this.vx * (dt / 1000);
    this.y += this.vy * (dt / 1000);
    this.size *= 0.995;
  }
  render(ctx, camera) {
    if (!this.alive) return;
    ctx.globalAlpha = 1 - this.age / this.life;
    ctx.fillStyle = this.color;
    ctx.fillRect(
      this.x - camera.x - this.size / 2,
      this.y - camera.y - this.size / 2,
      this.size,
      this.size,
    );
    ctx.globalAlpha = 1;
  }
}

class ParticlePool {
  constructor(size = 200) {
    this.pool = new Array(size).fill(null).map(() => new Particle());
    this.active = [];
  }
  spawn(x, y, vx, vy, size, color, life) {
    const p = this.pool.find((p) => !p.alive) || new Particle();
    p.reset(x, y, vx, vy, size, color, life);
    if (!this.pool.includes(p)) this.pool.push(p);
    this.active.push(p);
    return p;
  }
  update(dt) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.update(dt);
      if (!p.alive) this.active.splice(i, 1);
    }
  }
  render(ctx, camera) {
    this.active.forEach((p) => p.render(ctx, camera));
  }
}

/* =========================
   Camera
   ========================= */
class Camera {
  constructor(width, height, worldWidth) {
    this.x = 0;
    this.y = 0;
    this.width = width;
    this.height = height;
    this.worldWidth = worldWidth;
  }
  follow(player) {
    this.x = clamp(
      player.x + player.width / 2 - this.width / 2,
      0,
      this.worldWidth - this.width,
    );
    this.y = 0; // fixed vertical
  }
}

/* =========================
   Entities: Player, Platform, Coin, Enemy
   ========================= */
class Player {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.width = CONFIG.PLAYER_WIDTH;
    this.height = CONFIG.PLAYER_HEIGHT;
    this.vx = 0;
    this.vy = 0;
    this.onGround = false;
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    this.jumpHoldTimer = 0;
    this.holdingJump = false;
    this.direction = 1;
    this.invTime = 0;
    this.lives = CONFIG.START_LIVES;
    this.coins = 0;
    this.score = 0;
    this.spawnX = x;
    this.spawnY = y;
    this.flash = false;
    this.lastDamageMs = 0;
    this.animationTimer = 0;
  }

  resetState() {
    this.x = this.spawnX;
    this.y = this.spawnY;
    this.vx = 0;
    this.vy = 0;
    this.onGround = false;
    this.coyoteTimer = 0;
    this.invTime = 0;
    this.lives = CONFIG.START_LIVES;
    this.coins = 0;
    this.score = 0;
  }

  update(dt, input, platforms) {
    const sdt = dt / 1000;

    // Horizontal input
    let targetVX = 0;
    if (input.left) targetVX = -CONFIG.PLAYER_SPEED_MAX;
    if (input.right) targetVX = CONFIG.PLAYER_SPEED_MAX;
    if (targetVX !== 0) this.direction = Math.sign(targetVX);

    const accel = targetVX === 0 ? CONFIG.PLAYER_DECEL : CONFIG.PLAYER_ACCEL;
    // accelerate toward targetVX
    if (this.vx < targetVX) this.vx = Math.min(this.vx + accel * sdt, targetVX);
    else if (this.vx > targetVX)
      this.vx = Math.max(this.vx - accel * sdt, targetVX);

    // Gravity
    this.vy += CONFIG.GRAVITY * sdt;
    this.vy = Math.min(this.vy, CONFIG.TERMINAL_VELOCITY);

    // Apply velocity
    this.x += this.vx * sdt;
    this.y += this.vy * sdt;

    // Boundaries horizontally
    this.x = clamp(this.x, 0, CONFIG.LEVEL_WIDTH - this.width);

    // Timers
    if (this.onGround) this.coyoteTimer = CONFIG.COYOTE_MS;
    else this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);

    if (this.jumpBufferTimer > 0)
      this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);

    if (this.invTime > 0) this.invTime = Math.max(0, this.invTime - dt);

    // Platform collisions (AABB) - check top surfaces primarily for standing
    this.onGround = false;
    for (const p of platforms) {
      if (p.checkCollision(this)) {
        // Resolve collision: only consider collision from above
        const playerBottom = this.y + this.height;
        const prevBottom = playerBottom - this.vy * sdt;
        // Snap on top only if falling or slight overlap
        if (this.vy >= 0 && prevBottom <= p.y + 5) {
          this.y = p.y - this.height;
          this.vy = 0;
          this.onGround = true;
          // Move with platform if moving
          if (p.vx || p.vy) {
            this.x += p.vx * sdt;
            this.y += p.vy * sdt;
          }
          // fragile handling
          if (p.type === "fragile" && !p.cracking) {
            p.startCrack();
          }
        } else {
          // Hitting platform from side/bottom -> simple resolution: push out horizontally
          if (this.x + this.width > p.x && this.x < p.x + p.width) {
            // vertical overlap but not from top: avoid sticking
            if (this.x < p.x) this.x = p.x - this.width - 0.1;
            else this.x = p.x + p.width + 0.1;
            this.vx = 0;
          }
        }
      } else {
        // if stepping away from fragile, stop its crack timer
        if (p.type === "fragile" && p.cracking && !p.hasPlayer) {
          // nothing here; fragile will manage based on player detection
        }
      }
    }

    // Jump buffer / coyote time combined
    if (this.jumpBufferTimer > 0 && (this.onGround || this.coyoteTimer > 0)) {
      this._doJump();
      this.jumpBufferTimer = 0;
    }

    // variable jump hold: if holding jump and jumpHoldTimer < max, apply small upward impulse
    if (
      this.holdingJump &&
      this.isJumping &&
      this.jumpHoldTimer < CONFIG.JUMP_HOLD_MAX_MS
    ) {
      // reduce gravity while holding to allow taller jump
      this.vy -= 1200 * sdt; // small assist; tuned for feel
      this.jumpHoldTimer += dt;
    }

    // Death by falling
    if (this.y > CONFIG.DEATH_Y) {
      this.loseLife(true);
    }
  }

  _doJump() {
    this.vy = -CONFIG.JUMP_FORCE;
    this.onGround = false;
    this.isJumping = true;
    this.holdingJump = true;
    this.jumpHoldTimer = 0;
  }

  pressJump() {
    this.jumpBufferTimer = CONFIG.JUMP_BUFFER_MS;
    if (this.onGround || this.coyoteTimer > 0) {
      this._doJump();
      this.jumpBufferTimer = 0;
    }
  }

  releaseJump() {
    this.holdingJump = false;
    this.isJumping = false;
    // Shorten jump if releasing early
    if (this.vy < 0) this.vy *= 0.5;
  }

  takeDamage(fromX) {
    if (this.invTime > 0) return false;
    this.lives = Math.max(0, this.lives - 1);
    this.invTime = CONFIG.INVINCIBILITY_MS;
    const dir = Math.sign(this.x - fromX) || 1;
    this.vx = dir * CONFIG.KNOCKBACK;
    this.vy = -CONFIG.KNOCKBACK * 0.35;
    this.lastDamageMs = nowMs();
    return true;
  }

  loseLife(respawn = false) {
    this.lives = Math.max(0, this.lives - 1);
    this.invTime = CONFIG.INVINCIBILITY_MS;
    if (this.lives <= 0) return;
    if (respawn) {
      this.x = this.spawnX;
      this.y = this.spawnY;
      this.vx = 0;
      this.vy = 0;
    }
  }

  render(ctx, camera) {
    const sx = this.x - camera.x;
    const sy = this.y - camera.y;
    // Flash when invincible
    if (this.invTime > 0 && Math.floor(this.invTime / 100) % 2 === 0) {
      ctx.fillStyle = "#FFFFFF";
    } else ctx.fillStyle = "#FF6B6B";
    ctx.fillRect(sx, sy, this.width, this.height);
    // eyes
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.arc(sx + 12, sy + 16, 3, 0, Math.PI * 2);
    ctx.arc(sx + 28, sy + 16, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

class Platform {
  constructor(x, y, width, height = 15, type = "static") {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.type = type;
    this.vx = 0;
    this.vy = 0;
    this.moveRange = 0;
    this.moveSpeed = 0;
    this.axis = "h";
    this.origX = x;
    this.origY = y;
    this.cracking = false;
    this.crackTimer = 0;
    this.removed = false;
    this.respawnTimer = 0;
    this.hasPlayer = false;
  }

  makeMoving(axis = "h", range = 200, speed = 60) {
    this.type = "moving";
    this.axis = axis;
    this.moveRange = range;
    this.moveSpeed = speed;
    this._dir = 1;
  }

  makeFragile() {
    this.type = "fragile";
    this.cracking = false;
    this.crackTimer = 0;
    this.removed = false;
    this.respawnTimer = 0;
  }

  makeBouncy() {
    this.type = "bouncy";
  }

  startCrack() {
    if (this.type !== "fragile" || this.cracking || this.removed) return;
    this.cracking = true;
    this.crackTimer = CONFIG.FRAGILE_CRACK_MS;
  }

  update(dt) {
    const sdt = dt / 1000;
    if (this.type === "moving") {
      if (this.axis === "h") {
        this.vx = this.moveSpeed * this._dir;
        this.x += this.vx * sdt;
        if (Math.abs(this.x - this.origX) >= this.moveRange) {
          this._dir *= -1;
        }
      } else {
        this.vy = this.moveSpeed * this._dir;
        this.y += this.vy * sdt;
        if (Math.abs(this.y - this.origY) >= this.moveRange) this._dir *= -1;
      }
    }
    if (this.type === "fragile") {
      if (this.cracking) {
        this.crackTimer -= dt;
        if (this.crackTimer <= 0 && !this.removed) {
          // fall
          this.removed = true;
          this.respawnTimer = CONFIG.FRAGILE_RESPAWN_MS;
        }
      }
      if (this.removed) {
        this.respawnTimer -= dt;
        if (this.respawnTimer <= 0) {
          this.removed = false;
          this.cracking = false;
          this.crackTimer = 0;
          this.x = this.origX;
          this.y = this.origY;
        }
      }
    }
  }

  render(ctx, camera) {
    if (this.type === "fragile" && this.removed) return;
    const sx = this.x - camera.x;
    const sy = this.y - camera.y;
    switch (this.type) {
      case "static":
        ctx.fillStyle = "#8B4513";
        break;
      case "moving":
        ctx.fillStyle = "#D2691E";
        break;
      case "fragile":
        ctx.fillStyle = "#CD853F";
        break;
      case "bouncy":
        ctx.fillStyle = "#FF69B4";
        break;
      default:
        ctx.fillStyle = "#8B4513";
    }
    if (this.type === "fragile" && this.cracking) {
      ctx.globalAlpha = Math.max(
        0.2,
        this.crackTimer / CONFIG.FRAGILE_CRACK_MS,
      );
    }
    ctx.fillRect(sx, sy, this.width, this.height);
    // edge highlight
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(sx, sy, this.width, 1);
    ctx.globalAlpha = 1;
  }

  checkCollision(player) {
    if (this.type === "fragile" && this.removed) return false;
    // AABB collision
    if (
      player.x < this.x + this.width &&
      player.x + player.width > this.x &&
      player.y < this.y + this.height &&
      player.y + player.height > this.y
    ) {
      // flag hasPlayer for fragile detection
      if (this.type === "fragile") {
        this.hasPlayer = true;
      }
      return true;
    } else {
      if (this.type === "fragile") this.hasPlayer = false;
      return false;
    }
  }
}

class Coin {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.size = CONFIG.COIN_SIZE;
    this.collected = false;
    this.rot = 0;
    this.floatOffset = rand(-6, 6);
  }
  update(dt) {
    if (this.collected) return;
    this.rot += Math.PI * 2 * (dt / 2000); // full rotation every 2s
    this.floatOffset = Math.sin(nowMs() / 600 + this.x) * 6;
  }
  render(ctx, camera) {
    if (this.collected) return;
    const sx = this.x - camera.x;
    const sy = this.y - camera.y + this.floatOffset;
    ctx.save();
    ctx.translate(sx + this.size / 2, sy + this.size / 2);
    ctx.rotate(this.rot);
    ctx.fillStyle = "#FFD700";
    ctx.beginPath();
    ctx.arc(0, 0, this.size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
  checkCollect(player) {
    if (this.collected) return false;
    const cx = this.x + this.size / 2,
      cy = this.y + this.size / 2;
    const px = player.x + player.width / 2,
      py = player.y + player.height / 2;
    const dx = cx - px,
      dy = cy - py;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 30) {
      // collection radius
      this.collected = true;
      return true;
    }
    return false;
  }
}

class Enemy {
  constructor(x, y, a, b, speed) {
    this.x = x;
    this.y = y;
    this.width = CONFIG.ENEMY_WIDTH;
    this.height = CONFIG.ENEMY_HEIGHT;
    this.a = a;
    this.b = b;
    this.speed = speed || CONFIG.ENEMY_SPEED;
    this.dir = 1;
  }
  update(dt) {
    const sdt = dt / 1000;
    this.x += this.speed * this.dir * sdt;
    if (this.x >= this.b) {
      this.x = this.b;
      this.dir = -1;
    }
    if (this.x <= this.a) {
      this.x = this.a;
      this.dir = 1;
    }
  }
  render(ctx, camera) {
    const sx = this.x - camera.x;
    const sy = this.y - camera.y;
    ctx.fillStyle = "#FFA500";
    ctx.fillRect(sx, sy, this.width, this.height);
    ctx.fillStyle = "#000";
    ctx.fillRect(sx + 6, sy + 8, 5, 5);
    ctx.fillRect(sx + this.width - 11, sy + 8, 5, 5);
    ctx.fillRect(sx + 5, sy + 6, 6, 2);
    ctx.fillRect(sx + this.width - 11, sy + 6, 6, 2);
  }
  checkCollision(player) {
    return (
      player.x < this.x + this.width &&
      player.x + player.width > this.x &&
      player.y < this.y + this.height &&
      player.y + player.height > this.y
    );
  }
}

/* =========================
   Level generator - creates platforms, coins, enemies according to 4 zones
   ========================= */
function buildLevel(difficulty = "NORMAL") {
  const diff = DIFFICULTIES[difficulty] || DIFFICULTIES.NORMAL;
  CONFIG.START_LIVES = diff.START_LIVES;
  CONFIG.ENEMY_SPEED = diff.ENEMY_SPEED;
  CONFIG.COIN_COUNT = diff.COIN_COUNT;

  const platforms = [];
  const coins = [];
  const enemies = [];

  const ZW = CONFIG.LEVEL_WIDTH / 4;

  (() => {
    const baseY = 500;
    platforms.push(new Platform(60, baseY, 200));
    platforms.push(new Platform(320, baseY - 80, 120));
    platforms.push(new Platform(480, baseY - 40, 140));
    coins.push(new Coin(120, baseY - 30));
    coins.push(new Coin(360, baseY - 110));
    coins.push(new Coin(540, baseY - 70));
  })();

  (() => {
    const start = ZW,
      end = ZW * 2;
    platforms.push(new Platform(start + 40, 480, 160));
    const mp1 = new Platform(start + 260, 420, 130);
    mp1.makeMoving("h", 220, 80);
    platforms.push(mp1);
    const mp2 = new Platform(start + 560, 380, 120);
    mp2.makeMoving("v", 140, 100);
    platforms.push(mp2);
    platforms.push(new Platform(start + 760, 460, 160));
    coins.push(new Coin(start + 100, 440));
    coins.push(new Coin(start + 300, 380));
    coins.push(new Coin(start + 560, 340));
    coins.push(new Coin(start + 770, 420));
  })();

  (() => {
    const start = ZW * 2;
    platforms.push(new Platform(start + 40, 420, 120));
    const f1 = new Platform(start + 200, 360, 120);
    f1.makeFragile();
    platforms.push(f1);
    const f2 = new Platform(start + 360, 300, 110);
    f2.makeFragile();
    platforms.push(f2);
    platforms.push(new Platform(start + 520, 420, 140));
    enemies.push(
      new Enemy(start + 160, 380, start + 140, start + 260, CONFIG.ENEMY_SPEED),
    );
    enemies.push(
      new Enemy(start + 520, 380, start + 480, start + 620, CONFIG.ENEMY_SPEED),
    );
    coins.push(new Coin(start + 70, 380));
    coins.push(new Coin(start + 220, 320));
    coins.push(new Coin(start + 380, 260));
    coins.push(new Coin(start + 560, 380));
  })();

  (() => {
    const start = ZW * 3;
    platforms.push(new Platform(start + 40, 420, 100));
    const mp = new Platform(start + 180, 360, 150);
    mp.makeMoving("h", 260, 100);
    platforms.push(mp);
    const f = new Platform(start + 420, 340, 110);
    f.makeFragile();
    platforms.push(f);
    const b = new Platform(start + 640, 460, 140);
    b.makeBouncy();
    platforms.push(b);
    platforms.push(new Platform(CONFIG.LEVEL_WIDTH - 140, 180, 120));
    enemies.push(
      new Enemy(start + 120, 400, start + 80, start + 220, CONFIG.ENEMY_SPEED),
    );
    enemies.push(
      new Enemy(start + 480, 320, start + 440, start + 540, CONFIG.ENEMY_SPEED),
    );
    coins.push(new Coin(start + 60, 380));
    coins.push(new Coin(start + 240, 320));
    coins.push(new Coin(start + 460, 300));
    coins.push(new Coin(start + 700, 420));
    coins.push(new Coin(CONFIG.LEVEL_WIDTH - 100, 140));
  })();

  while (coins.length < CONFIG.COIN_COUNT) {
    const x = rand(150, CONFIG.LEVEL_WIDTH - 150);
    const y = rand(200, 520);
    coins.push(new Coin(x, y));
  }

  for (let x = 0; x < CONFIG.LEVEL_WIDTH; x += 200) {
    if (Math.random() < 0.4)
      platforms.push(new Platform(x + 40, 520 - Math.random() * 120, 120));
  }

  return { platforms, coins, enemies };
}

/* =========================
   Game: main controller
   ========================= */
class Game {
  constructor() {
    this.canvas = document.getElementById("gameCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.setCanvasSize(CONFIG.CANVAS_WIDTH, CONFIG.CANVAS_HEIGHT);

    this.camera = new Camera(
      this.canvas.width,
      this.canvas.height,
      CONFIG.LEVEL_WIDTH,
    );
    this.particles = new ParticlePool(300);
    this.audio = new AudioManager();

    this.input = { left: false, right: false, jump: false, pause: false };
    this._bindInputs();

    this.state = "MENU";
    this.level = null;
    this.player = null;
    this.lastTs = 0;
    this.elapsedMs = 0;
    this.startTime = 0;
    this.pausedAt = 0;
    this.difficulty = localStorage.getItem("pd_diff") || "NORMAL";
    this.highScores = JSON.parse(localStorage.getItem("pd_scores") || "[]");

    // FPS tracking for HUD (smoothed)
    this._fpsAccumMs = 0;
    this._fpsFrames = 0;
    this._fpsUpdateInterval = 250; // ms

    this._wireUI();
    window.addEventListener("gamepadconnected", (e) => {
      this._gamepadIndex = e.gamepad.index;
    });
    window.addEventListener("gamepaddisconnected", (e) => {
      if (this._gamepadIndex === e.gamepad.index) this._gamepadIndex = null;
    });

    window.addEventListener("resize", () => this._onResize());
    this._onResize();

    requestAnimationFrame((ts) => this.loop(ts));
  }

  setCanvasSize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
  }

  _onResize() {
    const maxW = window.innerWidth - 20;
    const maxH = window.innerHeight - 20;
    let scale = Math.min(
      maxW / CONFIG.CANVAS_WIDTH,
      maxH / CONFIG.CANVAS_HEIGHT,
      1,
    );
    this.canvas.style.width = `${CONFIG.CANVAS_WIDTH * scale}px`;
    this.canvas.style.height = `${CONFIG.CANVAS_HEIGHT * scale}px`;

    const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    document
      .getElementById("touchControls")
      .classList.toggle("hidden", !isTouch);
  }

  _bindInputs() {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      switch (e.code) {
        case "ArrowLeft":
        case "KeyA":
          this.input.left = true;
          break;
        case "ArrowRight":
        case "KeyD":
          this.input.right = true;
          break;
        case "ArrowUp":
        case "KeyW":
        case "Space":
          this.input.jump = true;
          if (this.player) this.player.pressJump();
          break;
        case "Escape":
          this.togglePause();
          break;
        case "KeyM":
          this.audio.setMute(!this.audio.muted);
          break;
      }
    });
    window.addEventListener("keyup", (e) => {
      switch (e.code) {
        case "ArrowLeft":
        case "KeyA":
          this.input.left = false;
          break;
        case "ArrowRight":
        case "KeyD":
          this.input.right = false;
          break;
        case "ArrowUp":
        case "KeyW":
        case "Space":
          this.input.jump = false;
          if (this.player) this.player.releaseJump();
          break;
      }
    });

    const leftBtn = document.getElementById("touchLeft");
    const rightBtn = document.getElementById("touchRight");
    const jumpBtn = document.getElementById("touchJump");
    ["touchstart", "mousedown"].forEach((ev) => {
      leftBtn.addEventListener(ev, (e) => {
        e.preventDefault();
        this.input.left = true;
      });
      rightBtn.addEventListener(ev, (e) => {
        e.preventDefault();
        this.input.right = true;
      });
      jumpBtn.addEventListener(ev, (e) => {
        e.preventDefault();
        this.input.jump = true;
        if (this.player) this.player.pressJump();
      });
    });
    ["touchend", "mouseup", "mouseleave", "touchcancel"].forEach((ev) => {
      leftBtn.addEventListener(ev, (e) => {
        e.preventDefault();
        this.input.left = false;
      });
      rightBtn.addEventListener(ev, (e) => {
        e.preventDefault();
        this.input.right = false;
      });
      jumpBtn.addEventListener(ev, (e) => {
        e.preventDefault();
        this.input.jump = false;
        if (this.player) this.player.releaseJump();
      });
    });
  }

  _wireUI() {
    document
      .getElementById("startBtn")
      .addEventListener("click", () => this.startGame());
    document
      .getElementById("settingsBtn")
      .addEventListener("click", () => this.showScreen("settings"));
    document
      .getElementById("scoresBtn")
      .addEventListener("click", () => this.showScores());
    document
      .getElementById("settingsBackBtn")
      .addEventListener("click", () => this.showScreen("menu"));
    document.getElementById("saveSettingsBtn").addEventListener("click", () => {
      const diff = document.getElementById("difficulty").value;
      const vol = parseFloat(document.getElementById("volume").value);
      const muted = document.getElementById("mute").checked;
      this.difficulty = diff;
      this.audio.setVolume(vol);
      this.audio.setMute(muted);
      localStorage.setItem("pd_diff", diff);
      this.showScreen("menu");
    });
    document
      .getElementById("scoresBackBtn")
      .addEventListener("click", () => this.showScreen("menu"));

    document
      .getElementById("resumeBtn")
      .addEventListener("click", () => this.resume());
    document
      .getElementById("restartBtn")
      .addEventListener("click", () => this.restart());
    document
      .getElementById("mainMenuBtn")
      .addEventListener("click", () => this.toMenu());

    document
      .getElementById("retryBtn")
      .addEventListener("click", () => this.restart());
    document
      .getElementById("gameOverMainBtn")
      .addEventListener("click", () => this.toMenu());
    document
      .getElementById("playAgainBtn")
      .addEventListener("click", () => this.restart());
    document
      .getElementById("victoryMainBtn")
      .addEventListener("click", () => this.toMenu());

    document.getElementById("difficulty").value = this.difficulty;
    document.getElementById("volume").value = this.audio.volume;
    document.getElementById("mute").checked = this.audio.muted;
    document.getElementById("coinsTotal").textContent = CONFIG.COIN_COUNT;
  }

  showScreen(id) {
    const screens = document.querySelectorAll(".screen");
    screens.forEach((s) => s.classList.remove("active"));
    if (id) document.getElementById(id).classList.add("active");
  }

  showScores() {
    this.showScreen("scores");
    const list = document.getElementById("scoresList");
    list.innerHTML = "";
    this.highScores.slice(0, 5).forEach((s) => {
      const li = document.createElement("li");
      li.textContent = `${s.name || "---"} — ${s.score} — ${s.date} — ${s.difficulty}`;
      list.appendChild(li);
    });
  }

  startGame() {
    this.level = buildLevel(this.difficulty);
    this.player = new Player(100, 450);
    this.player.lives = CONFIG.START_LIVES;
    this.player.spawnX = 100;
    this.player.spawnY = 450;
    this.lastTs = performance.now();
    this.elapsedMs = 0;
    this.startTime = performance.now();
    document.getElementById("hud-difficulty").textContent = this.difficulty;
    document.getElementById("coinsTotal").textContent = CONFIG.COIN_COUNT;
    this.level.coins.forEach((c) => (c.collected = false));
    this.state = "PLAYING";
    this.showScreen("");
  }

  restart() {
    if (!this.level) return this.startGame();
    this.player.x = this.player.spawnX;
    this.player.y = this.player.spawnY;
    this.player.vx = 0;
    this.player.vy = 0;
    this.player.lives = CONFIG.START_LIVES;
    this.player.coins = 0;
    this.player.score = 0;
    this.level.coins.forEach((c) => (c.collected = false));
    this.state = "PLAYING";
    this.showScreen("");
  }

  toMenu() {
    this.state = "MENU";
    this.showScreen("menu");
  }

  togglePause() {
    if (this.state === "PLAYING") this.pause();
    else if (this.state === "PAUSED") this.resume();
  }

  pause() {
    if (this.state !== "PLAYING") return;
    this.state = "PAUSED";
    this.pausedAt = performance.now();
    this.showScreen("paused");
  }

  resume() {
    if (this.state !== "PAUSED") return;
    this.state = "PLAYING";
    const diff = performance.now() - this.pausedAt;
    this.startTime += diff;
    this.showScreen("");
  }

  gameOver() {
    this.state = "GAME_OVER";
    this.showScreen("gameOver");
    document.getElementById("gameOverStats").textContent =
      `Final Score: ${this.player.score} • Coins: ${this.player.coins}/${CONFIG.COIN_COUNT}`;
    this.audio.playGameOver();
    this._saveScore();
  }

  victory() {
    this.state = "VICTORY";
    this.showScreen("victory");
    const t = Math.floor((performance.now() - this.startTime) / 1000);
    const mins = Math.floor(t / 60),
      secs = t % 60;
    document.getElementById("victoryStats").textContent =
      `Score: ${this.player.score} • Coins: ${this.player.coins}/${CONFIG.COIN_COUNT} • Time: ${mins}:${secs.toString().padStart(2, "0")}`;
    this.audio.playVictory();
    this._saveScore();
  }

  _saveScore() {
    const scoreObj = {
      score: this.player.score,
      date: new Date().toLocaleDateString(),
      difficulty: this.difficulty,
      name: "Player",
    };
    this.highScores.push(scoreObj);
    this.highScores.sort((a, b) => b.score - a.score);
    this.highScores = this.highScores.slice(0, 10);
    localStorage.setItem("pd_scores", JSON.stringify(this.highScores));
  }

  update(dt) {
    if (this.state !== "PLAYING") return;
    this.elapsedMs += dt;

    if (this._gamepadIndex !== null) {
      const gp = navigator.getGamepads()[this._gamepadIndex];
      if (gp) {
        const lx = gp.axes[0] || 0;
        this.input.left = lx < -0.3;
        this.input.right = lx > 0.3;
        if (gp.buttons[0].pressed) {
          if (!this.input.jump) {
            this.input.jump = true;
            this.player && this.player.pressJump();
          }
        } else {
          if (this.input.jump) {
            this.input.jump = false;
            this.player && this.player.releaseJump();
          }
        }
      }
    }

    this.level.platforms.forEach((p) => p.update(dt));
    this.level.enemies.forEach((e) => e.update(dt));
    this.level.coins.forEach((c) => c.update(dt));
    this.player.update(dt, this.input, this.level.platforms);

    for (const c of this.level.coins) {
      if (c.checkCollect(this.player)) {
        this.player.coins += 1;
        this.player.score += CONFIG.COIN_VALUE;
        this.audio.playCoin();
        for (let i = 0; i < 8; i++) {
          this.particles.spawn(
            c.x + rand(-4, 4),
            c.y + rand(-4, 4),
            rand(-80, 80),
            rand(-80, -20),
            4,
            "#FFD700",
            600,
          );
        }
      }
    }

    for (const e of this.level.enemies) {
      if (e.checkCollision(this.player)) {
        if (this.player.invTime <= 0) {
          const damaged = this.player.takeDamage(e.x + e.width / 2);
          if (damaged) {
            this.audio.playHit();
            for (let i = 0; i < 12; i++)
              this.particles.spawn(
                this.player.x + this.player.width / 2,
                this.player.y + this.player.height / 2,
                rand(-200, 200),
                rand(-200, 80),
                4,
                "#FF6B6B",
                800,
              );
          }
          if (this.player.lives <= 0) {
            this.gameOver();
            return;
          }
        }
      }
    }

    const allCollected = this.level.coins.every((c) => c.collected);
    const nearGoal = this.player.x > CONFIG.LEVEL_WIDTH - 200;
    if (allCollected || nearGoal) {
      this.victory();
    }

    this.particles.update(dt);
    this.camera.follow(this.player);

    document.getElementById("score").textContent = this.player.score;
    document.getElementById("coins").textContent = this.player.coins;
    document.getElementById("lives").textContent = this.player.lives;
    const elapsedSecs = Math.floor((performance.now() - this.startTime) / 1000);
    document.getElementById("time").textContent =
      `${Math.floor(elapsedSecs / 60)}:${(elapsedSecs % 60).toString().padStart(2, "0")}`;
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const g = ctx.createLinearGradient(0, 0, 0, this.canvas.height);
    g.addColorStop(0, "#87CEEB");
    g.addColorStop(1, "#E6F7FF");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    this._renderParallax();

    this.level.platforms.forEach((p) => p.render(ctx, this.camera));
    this.level.coins.forEach((c) => c.render(ctx, this.camera));
    this.level.enemies.forEach((e) => e.render(ctx, this.camera));
    this.player.render(ctx, this.camera);
    this.particles.render(ctx, this.camera);

    if (CONFIG.DEBUG) {
      ctx.strokeStyle = "red";
      ctx.strokeRect(
        this.player.x - this.camera.x,
        this.player.y - this.camera.y,
        this.player.width,
        this.player.height,
      );
      this.level.enemies.forEach((e) =>
        ctx.strokeRect(
          e.x - this.camera.x,
          e.y - this.camera.y,
          e.width,
          e.height,
        ),
      );
    }
  }

  _renderParallax() {
    const ctx = this.ctx;
    const camX = this.camera.x;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    for (let i = 0; i < 8; i++) {
      const px = ((i * 400 - camX * 0.3) % CONFIG.LEVEL_WIDTH) - 60;
      const py = 80 + (i % 3) * 30;
      ctx.beginPath();
      ctx.ellipse(px, py, 60, 24, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#B0C4DE";
    for (let i = 0; i < 6; i++) {
      const px = ((i * 600 - camX * 0.1) % CONFIG.LEVEL_WIDTH) - 120;
      ctx.beginPath();
      ctx.moveTo(px, 520);
      ctx.lineTo(px + 120, 280);
      ctx.lineTo(px + 240, 520);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "#654321";
    ctx.fillRect(-this.camera.x, 560, CONFIG.LEVEL_WIDTH, 40);
  }

  loop(ts) {
    const dt = Math.min(40, ts - this.lastTs || 16.67);
    this.lastTs = ts;
    if (this.state === "PLAYING") {
      this.update(dt);
      this.render();
    } else {
      if (this.level && this.player) {
        this.render();
      }
    }
    // FPS accumulation & periodic DOM update (smoothed)
    this._fpsAccumMs += dt;
    this._fpsFrames += 1;
    if (this._fpsAccumMs >= this._fpsUpdateInterval) {
      const fps = Math.round((this._fpsFrames / this._fpsAccumMs) * 1000) || 0;
      const el = document.getElementById("fps");
      if (el) el.textContent = fps;
      this._fpsAccumMs = 0;
      this._fpsFrames = 0;
    }

    requestAnimationFrame((t) => this.loop(t));
  }
}

/* =========================
   Initialize game instance
   ========================= */
window.addEventListener("load", () => {
  const game = new Game();
  window.platformerGame = game;
  document.body.addEventListener(
    "pointerdown",
    () => {
      if (game.audio && game.audio.ctx && game.audio.ctx.state === "suspended")
        game.audio.ctx.resume();
    },
    { once: true },
  );
});
