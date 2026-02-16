import { useEffect, useRef, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────
interface Point { x: number; y: number }
interface EnemyType { name: string; speed: number; hp: number; reward: number; color: string; radius: number }
interface Enemy { t: number; speed: number; type: EnemyType; hp: number; maxHp: number; x: number; y: number; reachedEnd: boolean; dead: boolean }
interface Tower { x: number; y: number; type: string; range: number; damage: number; fireRate: number; cooldown: number; levelDmg: number; levelRng: number; levelSpd: number; targeting: string }
interface Projectile { x: number; y: number; target: Enemy; speed: number; damage: number; type: string; splashRadius: number; dead?: boolean }
interface SpawnEntry { typeIndex: number }

// ── Constants ──────────────────────────────────────────────────────
const W = 900, H = 600, PATH_WIDTH = 80;

const pathPoints: Point[] = [
  { x: 80, y: 520 }, { x: 200, y: 420 }, { x: 200, y: 250 }, { x: 120, y: 150 },
  { x: 300, y: 150 }, { x: 450, y: 260 }, { x: 650, y: 180 }, { x: 820, y: 80 }
];

const enemyTypes: EnemyType[] = [
  { name: "Red", speed: 1.4, hp: 20, reward: 10, color: "#ff4b5c", radius: 12 },
  { name: "Blue", speed: 1.8, hp: 35, reward: 15, color: "#4b8cff", radius: 13 },
  { name: "Green", speed: 2.2, hp: 55, reward: 20, color: "#2ecc71", radius: 14 },
  { name: "Yellow", speed: 2.6, hp: 80, reward: 30, color: "#f1c40f", radius: 14 },
  { name: "Pink", speed: 3.0, hp: 120, reward: 40, color: "#e84393", radius: 15 },
];

const waves: { typeIndex: number; count: number }[][] = [
  [{ typeIndex: 0, count: 15 }],
  [{ typeIndex: 0, count: 10 }, { typeIndex: 1, count: 8 }],
  [{ typeIndex: 1, count: 14 }, { typeIndex: 2, count: 6 }],
  [{ typeIndex: 2, count: 16 }],
  [{ typeIndex: 1, count: 10 }, { typeIndex: 2, count: 14 }],
  [{ typeIndex: 2, count: 12 }, { typeIndex: 3, count: 8 }],
  [{ typeIndex: 3, count: 18 }],
  [{ typeIndex: 3, count: 10 }, { typeIndex: 4, count: 8 }],
  [{ typeIndex: 4, count: 20 }],
  [{ typeIndex: 0, count: 30 }, { typeIndex: 1, count: 20 }, { typeIndex: 2, count: 15 }, { typeIndex: 3, count: 10 }, { typeIndex: 4, count: 8 }],
];

const towerDefs: Record<string, { name: string; cost: number; baseRange: number; baseDamage: number; baseFireRate: number; projectileSpeed: number; color: string; outline: string; splashRadius?: number; description: string }> = {
  dart: { name: "Dart Monkey", cost: 100, baseRange: 140, baseDamage: 8, baseFireRate: 30, projectileSpeed: 8, color: "#f1c40f", outline: "#b37b00", description: "Fast, cheap" },
  bomb: { name: "Bomb Tower", cost: 250, baseRange: 150, baseDamage: 18, baseFireRate: 55, projectileSpeed: 5, color: "#e74c3c", outline: "#8e1b10", splashRadius: 60, description: "Splash damage" },
  sniper: { name: "Sniper", cost: 300, baseRange: 9999, baseDamage: 25, baseFireRate: 70, projectileSpeed: 12, color: "#9b59b6", outline: "#5e3370", description: "Infinite range" },
  ice: { name: "Ice Tower", cost: 200, baseRange: 120, baseDamage: 3, baseFireRate: 45, projectileSpeed: 6, color: "#74b9ff", outline: "#2980b9", description: "Slows enemies" },
};

// ── Helpers ────────────────────────────────────────────────────────
function catmullRom(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

function buildSpline(): Point[] {
  const samples: Point[] = [];
  const pts = [pathPoints[0], ...pathPoints, pathPoints[pathPoints.length - 1]];
  for (let i = 0; i < pts.length - 3; i++) {
    for (let j = 0; j <= 30; j++) {
      samples.push(catmullRom(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], j / 30));
    }
  }
  return samples;
}

function dist(a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y); }

function isOnPath(x: number, y: number, spline: Point[]) {
  for (const p of spline) if (Math.hypot(x - p.x, y - p.y) < PATH_WIDTH / 2 + 8) return true;
  return false;
}

// ── Component ──────────────────────────────────────────────────────
export default function TowerDefenseGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({
    money: 500, lives: 30, waveIndex: 0, inWave: false, gameOver: false, won: false,
    enemies: [] as Enemy[], enemiesToSpawn: [] as SpawnEntry[], spawnTimer: 0,
    towers: [] as Tower[], projectiles: [] as Projectile[],
    selectedTower: null as Tower | null, selectedTowerType: "dart",
    spline: buildSpline(), frame: 0,
  });

  const uiRef = useRef({
    hovering: null as Point | null,
  });

  const resetGame = useCallback(() => {
    const s = stateRef.current;
    s.money = 500; s.lives = 30; s.waveIndex = 0; s.inWave = false; s.gameOver = false; s.won = false;
    s.enemies = []; s.enemiesToSpawn = []; s.spawnTimer = 0;
    s.towers = []; s.projectiles = []; s.selectedTower = null;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const s = stateRef.current;
    let animId: number;

    // ── Drawing ──
    function drawBg() {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#7ee37e"); g.addColorStop(1, "#4fbf4f");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }

    function drawPath() {
      ctx.lineCap = "round";
      ctx.lineWidth = PATH_WIDTH + 10;
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "#d8c39a"); g.addColorStop(1, "#b89a6b");
      ctx.strokeStyle = g;
      ctx.beginPath();
      s.spline.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.stroke();
      ctx.lineWidth = PATH_WIDTH - 10;
      ctx.strokeStyle = "#f0e0b8";
      ctx.beginPath();
      s.spline.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.stroke();
    }

    function drawEnemies() {
      s.enemies.forEach(e => {
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 4;
        ctx.fillStyle = e.type.color;
        ctx.beginPath(); ctx.arc(e.x, e.y, e.type.radius, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        // HP bar
        const bw = 26, ratio = e.hp / e.maxHp;
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillRect(e.x - bw / 2, e.y - e.type.radius - 10, bw, 5);
        ctx.fillStyle = "#2ecc71";
        ctx.fillRect(e.x - bw / 2, e.y - e.type.radius - 10, bw * ratio, 5);
      });
    }

    function drawTowers() {
      s.towers.forEach(t => {
        if (t === s.selectedTower) {
          ctx.save();
          ctx.strokeStyle = "rgba(255,255,255,0.4)"; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
          ctx.beginPath(); ctx.arc(t.x, t.y, t.range, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }
        const def = towerDefs[t.type];
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 10; ctx.shadowOffsetY = 5;
        ctx.fillStyle = def.color;
        ctx.beginPath(); ctx.arc(t.x, t.y, 18, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.strokeStyle = def.outline; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(t.x, t.y, 18, 0, Math.PI * 2); ctx.stroke();
        // Face
        ctx.fillStyle = "#111";
        ctx.beginPath(); ctx.arc(t.x - 6, t.y - 4, 4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(t.x + 6, t.y - 4, 4, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#111"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(t.x, t.y + 4, 8, 0, Math.PI); ctx.stroke();
      });
    }

    function drawProjectiles() {
      s.projectiles.forEach(p => {
        ctx.fillStyle = p.type === "bomb" ? "#f39c12" : p.type === "ice" ? "#74b9ff" : "#fff";
        ctx.beginPath(); ctx.arc(p.x, p.y, p.type === "bomb" ? 6 : 3, 0, Math.PI * 2); ctx.fill();
      });
    }

    function drawPlacementPreview() {
      const h = uiRef.current.hovering;
      if (!h || s.selectedTower) return;
      const onPath = isOnPath(h.x, h.y, s.spline);
      const tooClose = s.towers.some(t => dist(h, t) < 30);
      const canPlace = !onPath && !tooClose && s.money >= towerDefs[s.selectedTowerType].cost;
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = canPlace ? towerDefs[s.selectedTowerType].color : "#ff0000";
      ctx.beginPath(); ctx.arc(h.x, h.y, 18, 0, Math.PI * 2); ctx.fill();
      if (canPlace) {
        ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.arc(h.x, h.y, towerDefs[s.selectedTowerType].baseRange, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }

    function drawHUD() {
      // Top bar
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      roundRect(ctx, 10, 10, 260, 36, 18);
      ctx.fill();
      ctx.font = "bold 14px sans-serif"; ctx.fillStyle = "#fff";
      ctx.fillText(`💰 ${s.money}`, 24, 34);
      ctx.fillText(`❤️ ${s.lives}`, 110, 34);
      ctx.fillText(`🌊 ${s.waveIndex}/${waves.length}`, 180, 34);

      // Start wave button
      if (!s.inWave && s.waveIndex < waves.length && !s.gameOver) {
        ctx.fillStyle = "#4b8cff";
        roundRect(ctx, 280, 10, 110, 36, 18); ctx.fill();
        ctx.strokeStyle = "#111"; ctx.lineWidth = 2;
        roundRect(ctx, 280, 10, 110, 36, 18); ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.font = "bold 13px sans-serif";
        ctx.fillText("Start Wave", 298, 34);
      }

      // Tower bar at bottom
      const types = Object.keys(towerDefs);
      const barW = types.length * 95 + 10;
      const barX = (W - barW) / 2;
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      roundRect(ctx, barX, H - 60, barW, 52, 14); ctx.fill();

      types.forEach((key, i) => {
        const def = towerDefs[key];
        const bx = barX + 10 + i * 95;
        const selected = s.selectedTowerType === key && !s.selectedTower;
        ctx.fillStyle = selected ? "#ffce3b" : "rgba(255,255,255,0.15)";
        roundRect(ctx, bx, H - 54, 85, 40, 10); ctx.fill();
        if (selected) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; roundRect(ctx, bx, H - 54, 85, 40, 10); ctx.stroke(); }
        ctx.font = "bold 12px sans-serif"; ctx.fillStyle = selected ? "#111" : "#fff";
        ctx.fillText(def.name.split(" ")[0], bx + 6, H - 36);
        ctx.font = "11px sans-serif"; ctx.fillStyle = selected ? "#333" : "#aaa";
        ctx.fillText(`$${def.cost}`, bx + 6, H - 22);
      });

      // Upgrade panel
      if (s.selectedTower) drawUpgradePanel();

      // Game over / win
      if (s.gameOver) {
        ctx.fillStyle = "rgba(0,0,0,0.75)"; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "#fff"; ctx.font = "bold 48px sans-serif"; ctx.textAlign = "center";
        ctx.fillText(s.won ? "You Win!" : "Game Over", W / 2, H / 2 - 20);
        ctx.fillStyle = "#ffce3b";
        roundRect(ctx, W / 2 - 60, H / 2 + 10, 120, 40, 20); ctx.fill();
        ctx.fillStyle = "#111"; ctx.font = "bold 16px sans-serif";
        ctx.fillText("Restart", W / 2, H / 2 + 36);
        ctx.textAlign = "start";
      }
    }

    function drawUpgradePanel() {
      const t = s.selectedTower!;
      const def = towerDefs[t.type];
      const px = W - 220, py = 80, pw = 200, ph = 240;
      ctx.fillStyle = "rgba(0,0,0,0.85)";
      roundRect(ctx, px, py, pw, ph, 14); ctx.fill();
      ctx.strokeStyle = "#333"; ctx.lineWidth = 2;
      roundRect(ctx, px, py, pw, ph, 14); ctx.stroke();

      ctx.fillStyle = "#fff"; ctx.font = "bold 14px sans-serif";
      ctx.fillText(def.name, px + 12, py + 22);
      ctx.font = "12px sans-serif"; ctx.fillStyle = "#aaa";
      ctx.fillText(`DMG: ${t.damage}  RNG: ${t.range}  SPD: ${t.fireRate}`, px + 12, py + 42);

      const upgrades = [
        { label: "Damage +5", cost: t.levelDmg * 70, y: py + 60 },
        { label: "Range +15", cost: t.levelRng * 60, y: py + 90 },
        { label: "Speed -3", cost: t.levelSpd * 65, y: py + 120 },
      ];

      upgrades.forEach(u => {
        const canAfford = s.money >= u.cost && (u.label.includes("Speed") ? t.fireRate > 12 : true);
        ctx.fillStyle = canAfford ? "#ff9f43" : "#555";
        roundRect(ctx, px + 12, u.y, pw - 24, 24, 12); ctx.fill();
        ctx.fillStyle = canAfford ? "#111" : "#999"; ctx.font = "bold 11px sans-serif";
        ctx.fillText(`${u.label} ($${u.cost})`, px + 22, u.y + 16);
      });

      // Targeting
      ctx.fillStyle = "#aaa"; ctx.font = "bold 11px sans-serif";
      ctx.fillText("Targeting:", px + 12, py + 160);
      const modes = ["first", "last", "strong"];
      modes.forEach((m, i) => {
        const bx = px + 12 + i * 62;
        ctx.fillStyle = t.targeting === m ? "#ffce3b" : "#4b8cff";
        roundRect(ctx, bx, py + 168, 56, 22, 11); ctx.fill();
        ctx.fillStyle = t.targeting === m ? "#111" : "#fff"; ctx.font = "bold 10px sans-serif";
        ctx.fillText(m[0].toUpperCase() + m.slice(1), bx + 6, py + 183);
      });

      // Sell
      const sellVal = Math.floor(def.cost * 0.7 + (t.levelDmg + t.levelRng + t.levelSpd - 3) * 40);
      ctx.fillStyle = "#ff4b5c";
      roundRect(ctx, px + 12, py + 200, pw - 24, 26, 13); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "bold 12px sans-serif";
      ctx.fillText(`Sell ($${sellVal})`, px + 50, py + 218);
    }

    function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
      c.beginPath();
      c.moveTo(x + r, y);
      c.lineTo(x + w - r, y);
      c.quadraticCurveTo(x + w, y, x + w, y + r);
      c.lineTo(x + w, y + h - r);
      c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      c.lineTo(x + r, y + h);
      c.quadraticCurveTo(x, y + h, x, y + h - r);
      c.lineTo(x, y + r);
      c.quadraticCurveTo(x, y, x + r, y);
      c.closePath();
    }

    // ── Game Logic ──
    function spawnEnemy() {
      if (s.enemiesToSpawn.length === 0) {
        if (s.enemies.length === 0) {
          s.inWave = false;
          // Auto-advance & check win
          if (s.waveIndex >= waves.length && s.lives > 0) {
            s.gameOver = true; s.won = true;
          }
        }
        return;
      }
      const data = s.enemiesToSpawn.shift()!;
      const type = enemyTypes[data.typeIndex];
      s.enemies.push({ t: 0, speed: type.speed, type, hp: type.hp, maxHp: type.hp, x: s.spline[0].x, y: s.spline[0].y, reachedEnd: false, dead: false });
    }

    function prepareWave(idx: number) {
      if (idx >= waves.length) return;
      s.enemiesToSpawn = [];
      waves[idx].forEach(g => { for (let i = 0; i < g.count; i++) s.enemiesToSpawn.push({ typeIndex: g.typeIndex }); });
      s.spawnTimer = 0; s.inWave = true; s.waveIndex = idx + 1;
    }

    function moveEnemies() {
      s.enemies.forEach(e => {
        e.t += e.speed / 800;
        if (e.t >= 1) { e.reachedEnd = true; return; }
        const idx = e.t * (s.spline.length - 1);
        const i0 = Math.floor(idx), i1 = Math.min(s.spline.length - 1, i0 + 1), frac = idx - i0;
        e.x = s.spline[i0].x + (s.spline[i1].x - s.spline[i0].x) * frac;
        e.y = s.spline[i0].y + (s.spline[i1].y - s.spline[i0].y) * frac;
      });
      s.enemies = s.enemies.filter(e => {
        if (e.reachedEnd) { s.lives--; return false; }
        return !e.dead;
      });
    }

    function towersAct() {
      s.towers.forEach(t => {
        if (t.cooldown > 0) { t.cooldown--; return; }
        let cands = s.enemies.filter(e => dist(t, e) <= t.range);
        if (!cands.length) return;
        if (t.targeting === "first") cands.sort((a, b) => b.t - a.t);
        else if (t.targeting === "last") cands.sort((a, b) => a.t - b.t);
        else cands.sort((a, b) => b.hp - a.hp);
        const target = cands[0];
        const def = towerDefs[t.type];
        s.projectiles.push({ x: t.x, y: t.y, target, speed: def.projectileSpeed, damage: t.damage, type: t.type, splashRadius: def.splashRadius || 0 });
        t.cooldown = t.fireRate;
      });
    }

    function moveProjectiles() {
      s.projectiles.forEach(p => {
        if (!p.target || p.target.dead || p.target.reachedEnd) { p.dead = true; return; }
        const dx = p.target.x - p.x, dy = p.target.y - p.y, d = Math.hypot(dx, dy);
        if (d < 6) {
          if (p.type === "bomb" && p.splashRadius > 0) {
            s.enemies.forEach(e => { if (dist(p, e) <= p.splashRadius) { e.hp -= p.damage; if (e.hp <= 0) { e.dead = true; s.money += e.type.reward; } } });
          } else if (p.type === "ice") {
            // Ice slows enemies in range
            s.enemies.forEach(e => { if (dist(p, e) <= 60) e.speed = Math.max(0.4, e.speed * 0.7); });
            p.target.hp -= p.damage;
            if (p.target.hp <= 0) { p.target.dead = true; s.money += p.target.type.reward; }
          } else {
            p.target.hp -= p.damage;
            if (p.target.hp <= 0) { p.target.dead = true; s.money += p.target.type.reward; }
          }
          p.dead = true; return;
        }
        p.x += dx / d * p.speed; p.y += dy / d * p.speed;
      });
      s.projectiles = s.projectiles.filter(p => !p.dead);
      s.enemies = s.enemies.filter(e => !e.dead);
    }

    // ── Loop ──
    function loop() {
      s.frame++;
      ctx.clearRect(0, 0, W, H);
      drawBg(); drawPath();
      drawPlacementPreview();
      drawTowers(); drawEnemies(); drawProjectiles();
      drawHUD();

      if (!s.gameOver) {
        if (s.inWave) { s.spawnTimer--; if (s.spawnTimer <= 0) { spawnEnemy(); s.spawnTimer = 30; } }
        // Check wave end (all spawned and killed)
        if (s.inWave && s.enemiesToSpawn.length === 0 && s.enemies.length === 0) {
          s.inWave = false;
          if (s.waveIndex >= waves.length) { s.gameOver = true; s.won = true; }
        }
        moveEnemies(); towersAct(); moveProjectiles();
        if (s.lives <= 0) { s.gameOver = true; s.won = false; }
      }

      animId = requestAnimationFrame(loop);
    }

    // ── Input ──
    function getPos(e: MouseEvent): Point {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
    }

    function handleClick(e: MouseEvent) {
      const p = getPos(e);

      // Game over restart
      if (s.gameOver) {
        if (p.x > W / 2 - 60 && p.x < W / 2 + 60 && p.y > H / 2 + 10 && p.y < H / 2 + 50) {
          resetGame();
        }
        return;
      }

      // Start wave button
      if (!s.inWave && s.waveIndex < waves.length && p.x > 280 && p.x < 390 && p.y > 10 && p.y < 46) {
        prepareWave(s.waveIndex);
        return;
      }

      // Tower bar
      const types = Object.keys(towerDefs);
      const barW = types.length * 95 + 10;
      const barX = (W - barW) / 2;
      if (p.y > H - 60) {
        types.forEach((key, i) => {
          const bx = barX + 10 + i * 95;
          if (p.x > bx && p.x < bx + 85 && p.y > H - 54 && p.y < H - 14) {
            s.selectedTowerType = key; s.selectedTower = null;
          }
        });
        return;
      }

      // Upgrade panel clicks
      if (s.selectedTower) {
        const t = s.selectedTower;
        const def = towerDefs[t.type];
        const px = W - 220, py = 80;

        // Damage upgrade
        if (p.x > px + 12 && p.x < px + 188 && p.y > py + 60 && p.y < py + 84) {
          const cost = t.levelDmg * 70;
          if (s.money >= cost) { s.money -= cost; t.damage += 5; t.levelDmg++; }
          return;
        }
        // Range upgrade
        if (p.x > px + 12 && p.x < px + 188 && p.y > py + 90 && p.y < py + 114) {
          const cost = t.levelRng * 60;
          if (s.money >= cost) { s.money -= cost; t.range += 15; t.levelRng++; }
          return;
        }
        // Speed upgrade
        if (p.x > px + 12 && p.x < px + 188 && p.y > py + 120 && p.y < py + 144) {
          const cost = t.levelSpd * 65;
          if (s.money >= cost && t.fireRate > 12) { s.money -= cost; t.fireRate = Math.max(10, t.fireRate - 3); t.levelSpd++; }
          return;
        }
        // Targeting
        const modes = ["first", "last", "strong"];
        modes.forEach((m, i) => {
          const bx = px + 12 + i * 62;
          if (p.x > bx && p.x < bx + 56 && p.y > py + 168 && p.y < py + 190) t.targeting = m;
        });
        // Sell
        if (p.x > px + 12 && p.x < px + 188 && p.y > py + 200 && p.y < py + 226) {
          const sellVal = Math.floor(def.cost * 0.7 + (t.levelDmg + t.levelRng + t.levelSpd - 3) * 40);
          s.money += sellVal; s.towers = s.towers.filter(tw => tw !== t); s.selectedTower = null;
          return;
        }
        // Check if clicking inside panel
        if (p.x > px && p.x < px + 200 && p.y > py && p.y < py + 240) return;
      }

      // Select existing tower
      for (const t of s.towers) {
        if (dist(p, t) <= 20) { s.selectedTower = t; return; }
      }

      // Place new tower
      s.selectedTower = null;
      const def = towerDefs[s.selectedTowerType];
      if (s.money < def.cost || isOnPath(p.x, p.y, s.spline) || s.towers.some(t => dist(p, t) < 30)) return;
      s.money -= def.cost;
      s.towers.push({
        x: p.x, y: p.y, type: s.selectedTowerType,
        range: def.baseRange, damage: def.baseDamage, fireRate: def.baseFireRate,
        cooldown: 0, levelDmg: 1, levelRng: 1, levelSpd: 1, targeting: "first",
      });
    }

    function handleMove(e: MouseEvent) {
      uiRef.current.hovering = getPos(e);
    }

    canvas.addEventListener("click", handleClick);
    canvas.addEventListener("mousemove", handleMove);
    animId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animId);
      canvas.removeEventListener("click", handleClick);
      canvas.removeEventListener("mousemove", handleMove);
    };
  }, [resetGame]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-background overflow-hidden">
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        className="rounded-xl border-[6px] border-border shadow-2xl cursor-crosshair"
        style={{ maxWidth: "100vw", maxHeight: "100vh" }}
      />
    </div>
  );
}
