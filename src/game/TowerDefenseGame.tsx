import { useEffect, useRef, useCallback, useState } from "react";

// ── Types ──────────────────────────────────────────────────────────
interface Point { x: number; y: number }
interface EnemyType { name: string; speed: number; hp: number; reward: number; color: string; radius: number }
interface Enemy {
  t: number; speed: number; baseSpeed: number; type: EnemyType;
  hp: number; maxHp: number; x: number; y: number;
  reachedEnd: boolean; dead: boolean; isBoss: boolean;
}
interface Tower {
  x: number; y: number; type: string; range: number; damage: number;
  fireRate: number; cooldown: number; levelDmg: number; levelRng: number;
  levelSpd: number; targeting: string; shotsFired: number;
}
interface Projectile {
  x: number; y: number; target: Enemy; speed: number; damage: number;
  type: string; splashRadius: number; dead?: boolean;
  special?: "bomb" | "burning" | "rainbow";
}
interface SpawnEntry { typeIndex: number; isBoss?: boolean }
interface MapDef { name: string; description: string; points: Point[]; bgColor1: string; bgColor2: string; pathColor1: string; pathColor2: string }

// ── Constants ──────────────────────────────────────────────────────
const W = 900, H = 600, PATH_WIDTH = 80;

const MAPS: MapDef[] = [
  {
    name: "Loopback Canyon",
    description: "The classic winding path",
    points: [
      { x: 80, y: 520 }, { x: 200, y: 420 }, { x: 200, y: 250 }, { x: 120, y: 150 },
      { x: 300, y: 150 }, { x: 450, y: 260 }, { x: 650, y: 180 }, { x: 820, y: 80 }
    ],
    bgColor1: "#7ee37e", bgColor2: "#4fbf4f", pathColor1: "#d8c39a", pathColor2: "#f0e0b8"
  },
  {
    name: "Serpent's Pass",
    description: "A snaking desert road",
    points: [
      { x: 50, y: 300 }, { x: 180, y: 100 }, { x: 350, y: 500 }, { x: 500, y: 100 },
      { x: 650, y: 500 }, { x: 780, y: 200 }, { x: 860, y: 300 }
    ],
    bgColor1: "#e8d5a3", bgColor2: "#c4a86c", pathColor1: "#8b7355", pathColor2: "#a08868"
  },
  {
    name: "Frozen Lake",
    description: "An icy spiral path",
    points: [
      { x: 450, y: 560 }, { x: 150, y: 480 }, { x: 80, y: 300 }, { x: 200, y: 120 },
      { x: 450, y: 60 }, { x: 700, y: 120 }, { x: 800, y: 300 }, { x: 700, y: 450 },
      { x: 500, y: 400 }, { x: 450, y: 300 }
    ],
    bgColor1: "#a8d8ea", bgColor2: "#7ec8e3", pathColor1: "#e0e8f0", pathColor2: "#f0f4f8"
  }
];

const enemyTypes: EnemyType[] = [
  { name: "Red", speed: 1.4, hp: 20, reward: 10, color: "#ff4b5c", radius: 12 },
  { name: "Blue", speed: 1.8, hp: 35, reward: 15, color: "#4b8cff", radius: 13 },
  { name: "Green", speed: 2.2, hp: 55, reward: 20, color: "#2ecc71", radius: 14 },
  { name: "Yellow", speed: 2.6, hp: 80, reward: 30, color: "#f1c40f", radius: 14 },
  { name: "Pink", speed: 3.0, hp: 120, reward: 40, color: "#e84393", radius: 15 },
];

// 20 waves for base game, boss every 5
function generateWaves(count: number): { typeIndex: number; count: number }[][] {
  const w: { typeIndex: number; count: number }[][] = [];
  for (let i = 0; i < count; i++) {
    const groups: { typeIndex: number; count: number }[] = [];
    const maxType = Math.min(4, Math.floor(i / 3));
    for (let t = 0; t <= maxType; t++) {
      groups.push({ typeIndex: t, count: Math.floor(8 + i * 1.5 - t * 2) });
    }
    w.push(groups.filter(g => g.count > 0));
  }
  return w;
}

const BASE_WAVES = generateWaves(20);

const towerDefs: Record<string, {
  name: string; cost: number; baseRange: number; baseDamage: number;
  baseFireRate: number; projectileSpeed: number; color: string; outline: string;
  splashRadius?: number; description: string; hidden?: boolean;
}> = {
  dart: { name: "Dart Monkey", cost: 100, baseRange: 140, baseDamage: 8, baseFireRate: 30, projectileSpeed: 8, color: "#f1c40f", outline: "#b37b00", description: "Fast, cheap" },
  bomb: { name: "Bomb Tower", cost: 250, baseRange: 150, baseDamage: 18, baseFireRate: 55, projectileSpeed: 5, color: "#e74c3c", outline: "#8e1b10", splashRadius: 60, description: "Splash damage" },
  sniper: { name: "Sniper", cost: 300, baseRange: 9999, baseDamage: 25, baseFireRate: 70, projectileSpeed: 12, color: "#9b59b6", outline: "#5e3370", description: "Infinite range" },
  ice: { name: "Ice Tower", cost: 200, baseRange: 120, baseDamage: 3, baseFireRate: 45, projectileSpeed: 6, color: "#74b9ff", outline: "#2980b9", description: "Slows enemies" },
  omega: { name: "Omega Tower", cost: 800, baseRange: 200, baseDamage: 15, baseFireRate: 25, projectileSpeed: 9, color: "#fff", outline: "#888", description: "Ultimate power", hidden: true },
};

// ── Helpers ────────────────────────────────────────────────────────
function catmullRom(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const t2 = t * t, t3 = t2 * t;
  return {
    x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  };
}

function buildSpline(points: Point[]): Point[] {
  const samples: Point[] = [];
  const pts = [points[0], ...points, points[points.length - 1]];
  for (let i = 0; i < pts.length - 3; i++) {
    for (let j = 0; j <= 40; j++) {
      samples.push(catmullRom(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], j / 40));
    }
  }
  return samples;
}

function dist(a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y); }

function isOnPath(x: number, y: number, spline: Point[]) {
  for (const p of spline) if (Math.hypot(x - p.x, y - p.y) < PATH_WIDTH / 2 + 12) return true;
  return false;
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y); c.lineTo(x + w - r, y);
  c.quadraticCurveTo(x + w, y, x + w, y + r); c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y, x + r, y); c.closePath();
}

type Screen = "menu" | "mapSelect" | "settings" | "extras" | "playing";
type GameMode = "normal" | "endless";

// ── Component ──────────────────────────────────────────────────────
export default function TowerDefenseGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [screen, setScreen] = useState<Screen>("menu");
  const [gameMode, setGameMode] = useState<GameMode>("normal");
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [selectedMapIndex, setSelectedMapIndex] = useState(0);

  // Unlock tracking (persisted in localStorage)
  const [omegaUnlocked, setOmegaUnlocked] = useState(() => {
    return localStorage.getItem("omega_unlocked") === "true";
  });

  const stateRef = useRef<{
    money: number; lives: number; waveIndex: number; inWave: boolean;
    gameOver: boolean; won: boolean; enemies: Enemy[];
    enemiesToSpawn: SpawnEntry[]; spawnTimer: number;
    towers: Tower[]; projectiles: Projectile[];
    selectedTower: Tower | null; selectedTowerType: string;
    spline: Point[]; frame: number; mapIndex: number;
    mode: GameMode; cashMultiplier: number; baseHp: number;
    baseMaxHp: number; baseLevel: number; damageTaken: number;
    wave5NoDamage: boolean; hasAllTowersByWave10: boolean;
    omegaUnlocked: boolean; particles: Particle[];
    endlessWaveNum: number;
  } | null>(null);

  interface Particle {
    x: number; y: number; vx: number; vy: number;
    life: number; maxLife: number; color: string; size: number;
  }

  const uiRef = useRef({ hovering: null as Point | null });

  const startGame = useCallback((mapIdx: number, mode: GameMode) => {
    const map = MAPS[mapIdx];
    stateRef.current = {
      money: 500, lives: 30, waveIndex: 0, inWave: false,
      gameOver: false, won: false, enemies: [], enemiesToSpawn: [],
      spawnTimer: 0, towers: [], projectiles: [],
      selectedTower: null, selectedTowerType: "dart",
      spline: buildSpline(map.points), frame: 0, mapIndex: mapIdx,
      mode, cashMultiplier: 1.0, baseHp: 100, baseMaxHp: 100,
      baseLevel: 1, damageTaken: 0, wave5NoDamage: false,
      hasAllTowersByWave10: false, omegaUnlocked,
      particles: [], endlessWaveNum: 0,
    };
    setSelectedMapIndex(mapIdx);
    setGameMode(mode);
    setScreen("playing");
  }, [omegaUnlocked]);

  // Menu canvas rendering
  useEffect(() => {
    if (screen === "playing") return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let animId: number;
    let menuFrame = 0;

    function drawMenuBg() {
      menuFrame++;
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, "#1a1a2e"); g.addColorStop(0.5, "#16213e"); g.addColorStop(1, "#0f3460");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

      // Animated stars
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      for (let i = 0; i < 60; i++) {
        const x = (i * 137.5 + menuFrame * 0.1) % W;
        const y = (i * 97.3 + Math.sin(menuFrame * 0.02 + i) * 10) % H;
        const s = 1 + Math.sin(menuFrame * 0.05 + i) * 0.5;
        ctx.beginPath(); ctx.arc(x, y, s, 0, Math.PI * 2); ctx.fill();
      }
    }

    function drawWatermark() {
      ctx.save();
      ctx.font = "bold 12px monospace";
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.fillText("Uzxyr", 12, H - 12);
      ctx.restore();
    }

    function drawMenu() {
      drawMenuBg();
      // Title
      ctx.save();
      ctx.textAlign = "center";
      ctx.font = "bold 52px 'Segoe UI', sans-serif";
      ctx.fillStyle = "#ffce3b";
      ctx.shadowColor = "#ffce3b"; ctx.shadowBlur = 30;
      ctx.fillText("TOWER DEFENSE", W / 2, 140);
      ctx.shadowBlur = 0;
      ctx.font = "18px sans-serif"; ctx.fillStyle = "#aaa";
      ctx.fillText("Inspired by Bloons TD", W / 2, 170);

      const buttons = ["Play", "Endless Mode", "Settings", "Extras"];
      const colors = ["#4b8cff", "#e74c3c", "#9b59b6", "#2ecc71"];
      buttons.forEach((label, i) => {
        const bx = W / 2 - 120, by = 210 + i * 65, bw = 240, bh = 48;
        ctx.fillStyle = colors[i];
        roundRect(ctx, bx, by, bw, bh, 24); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 2;
        roundRect(ctx, bx, by, bw, bh, 24); ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.font = "bold 18px sans-serif";
        ctx.fillText(label, W / 2, by + 31);
      });
      ctx.restore();
      drawWatermark();
    }

    function drawMapSelect() {
      drawMenuBg();
      ctx.save(); ctx.textAlign = "center";
      ctx.font = "bold 36px sans-serif"; ctx.fillStyle = "#ffce3b";
      ctx.fillText("SELECT MAP", W / 2, 80);

      MAPS.forEach((map, i) => {
        const bx = 80 + i * 260, by = 130, bw = 220, bh = 320;
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        roundRect(ctx, bx, by, bw, bh, 16); ctx.fill();
        ctx.strokeStyle = "#ffce3b"; ctx.lineWidth = 2;
        roundRect(ctx, bx, by, bw, bh, 16); ctx.stroke();

        // Mini map preview
        const miniSpline = buildSpline(map.points);
        ctx.save();
        ctx.beginPath(); roundRect(ctx, bx + 10, by + 10, 200, 180, 8); ctx.clip();
        const mg = ctx.createLinearGradient(bx, by, bx, by + 180);
        mg.addColorStop(0, map.bgColor1); mg.addColorStop(1, map.bgColor2);
        ctx.fillStyle = mg; ctx.fillRect(bx + 10, by + 10, 200, 180);
        ctx.strokeStyle = map.pathColor1; ctx.lineWidth = 8; ctx.lineCap = "round";
        ctx.beginPath();
        miniSpline.forEach((p, j) => {
          const mx = bx + 10 + (p.x / W) * 200;
          const my = by + 10 + (p.y / H) * 180;
          j ? ctx.lineTo(mx, my) : ctx.moveTo(mx, my);
        });
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = "#fff"; ctx.font = "bold 16px sans-serif";
        ctx.fillText(map.name, bx + bw / 2, by + 220);
        ctx.fillStyle = "#aaa"; ctx.font = "13px sans-serif";
        ctx.fillText(map.description, bx + bw / 2, by + 245);

        // Play button
        ctx.fillStyle = "#4b8cff";
        roundRect(ctx, bx + 40, by + 270, 140, 36, 18); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = "bold 14px sans-serif";
        ctx.fillText("Play", bx + bw / 2, by + 294);
      });

      // Back button
      ctx.fillStyle = "#ff4b5c";
      roundRect(ctx, W / 2 - 60, H - 60, 120, 36, 18); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "bold 14px sans-serif";
      ctx.fillText("Back", W / 2, H - 36);
      ctx.restore();
      drawWatermark();
    }

    function drawSettings() {
      drawMenuBg();
      ctx.save(); ctx.textAlign = "center";
      ctx.font = "bold 36px sans-serif"; ctx.fillStyle = "#ffce3b";
      ctx.fillText("SETTINGS", W / 2, 100);

      const options = [
        { label: "Sound Effects", enabled: soundEnabled },
        { label: "Music", enabled: musicEnabled },
      ];
      options.forEach((opt, i) => {
        const by = 160 + i * 70;
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        roundRect(ctx, W / 2 - 160, by, 320, 50, 14); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = "16px sans-serif"; ctx.textAlign = "left";
        ctx.fillText(opt.label, W / 2 - 140, by + 32);
        // Toggle
        const tx = W / 2 + 100, ty = by + 13;
        ctx.fillStyle = opt.enabled ? "#2ecc71" : "#555";
        roundRect(ctx, tx, ty, 50, 24, 12); ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(opt.enabled ? tx + 38 : tx + 12, ty + 12, 10, 0, Math.PI * 2); ctx.fill();
      });

      ctx.textAlign = "center";
      ctx.fillStyle = "#ff4b5c";
      roundRect(ctx, W / 2 - 60, H - 80, 120, 36, 18); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "bold 14px sans-serif";
      ctx.fillText("Back", W / 2, H - 56);
      ctx.restore();
      drawWatermark();
    }

    function drawExtras() {
      drawMenuBg();
      ctx.save(); ctx.textAlign = "center";
      ctx.font = "bold 36px sans-serif"; ctx.fillStyle = "#ffce3b";
      ctx.fillText("EXTRAS", W / 2, 100);

      ctx.font = "16px sans-serif"; ctx.fillStyle = "#ccc";
      ctx.fillText("Unlockables", W / 2, 160);

      // Omega tower status
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      roundRect(ctx, W / 2 - 180, 190, 360, 80, 14); ctx.fill();
      ctx.fillStyle = omegaUnlocked ? "#ffce3b" : "#555";
      ctx.font = "bold 18px sans-serif";
      ctx.fillText(omegaUnlocked ? "✨ Omega Tower — UNLOCKED" : "🔒 Omega Tower — LOCKED", W / 2, 225);
      ctx.fillStyle = "#aaa"; ctx.font = "12px sans-serif";
      ctx.fillText(omegaUnlocked ? "Available in tower bar" : "Reach wave 5 with 0 damage, have all towers by wave 10", W / 2, 252);

      ctx.fillStyle = "#ff4b5c";
      roundRect(ctx, W / 2 - 60, H - 80, 120, 36, 18); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "bold 14px sans-serif";
      ctx.fillText("Back", W / 2, H - 56);
      ctx.restore();
      drawWatermark();
    }

    function handleMenuClick(e: MouseEvent) {
      const r = canvas.getBoundingClientRect();
      const px = (e.clientX - r.left) * (W / r.width);
      const py = (e.clientY - r.top) * (H / r.height);

      if (screen === "menu") {
        const buttons = ["play", "endless", "settings", "extras"];
        buttons.forEach((id, i) => {
          const bx = W / 2 - 120, by = 210 + i * 65, bw = 240, bh = 48;
          if (px > bx && px < bx + bw && py > by && py < by + bh) {
            if (id === "play") setScreen("mapSelect");
            else if (id === "endless") { setGameMode("endless"); setScreen("mapSelect"); }
            else if (id === "settings") setScreen("settings");
            else if (id === "extras") setScreen("extras");
          }
        });
      } else if (screen === "mapSelect") {
        MAPS.forEach((_, i) => {
          const bx = 80 + i * 260 + 40, by = 130 + 270;
          if (px > bx && px < bx + 140 && py > by && py < by + 36) {
            startGame(i, gameMode);
          }
        });
        if (px > W / 2 - 60 && px < W / 2 + 60 && py > H - 60 && py < H - 24) {
          setScreen("menu"); setGameMode("normal");
        }
      } else if (screen === "settings") {
        // Sound toggle
        if (px > W / 2 + 100 && px < W / 2 + 150 && py > 173 && py < 197) setSoundEnabled(p => !p);
        if (px > W / 2 + 100 && px < W / 2 + 150 && py > 243 && py < 267) setMusicEnabled(p => !p);
        if (px > W / 2 - 60 && px < W / 2 + 60 && py > H - 80 && py < H - 44) setScreen("menu");
      } else if (screen === "extras") {
        if (px > W / 2 - 60 && px < W / 2 + 60 && py > H - 80 && py < H - 44) setScreen("menu");
      }
    }

    function menuLoop() {
      ctx.clearRect(0, 0, W, H);
      if (screen === "menu") drawMenu();
      else if (screen === "mapSelect") drawMapSelect();
      else if (screen === "settings") drawSettings();
      else if (screen === "extras") drawExtras();
      animId = requestAnimationFrame(menuLoop);
    }

    canvas.addEventListener("click", handleMenuClick);
    animId = requestAnimationFrame(menuLoop);
    return () => { cancelAnimationFrame(animId); canvas.removeEventListener("click", handleMenuClick); };
  }, [screen, soundEnabled, musicEnabled, gameMode, omegaUnlocked, startGame]);

  // Game loop
  useEffect(() => {
    if (screen !== "playing") return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const s = stateRef.current!;
    let animId: number;

    const map = MAPS[s.mapIndex];
    const totalWaves = s.mode === "normal" ? 20 : Infinity;

    function getWaveDef(idx: number): { typeIndex: number; count: number }[] {
      if (idx < BASE_WAVES.length) return BASE_WAVES[idx];
      // Endless: scale up
      const scale = 1 + Math.floor(idx / 5) * 0.3;
      const maxType = Math.min(4, Math.floor(idx / 3));
      const groups: { typeIndex: number; count: number }[] = [];
      for (let t = 0; t <= maxType; t++) {
        groups.push({ typeIndex: t, count: Math.floor((10 + idx * 2 - t * 3) * scale) });
      }
      return groups.filter(g => g.count > 0);
    }

    function isBossWave(idx: number) { return (idx + 1) % 5 === 0; }

    // ── Drawing ──
    function drawBg() {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, map.bgColor1); g.addColorStop(1, map.bgColor2);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

      // Grass texture dots
      ctx.fillStyle = "rgba(0,0,0,0.04)";
      for (let i = 0; i < 200; i++) {
        const x = (i * 137.5 + 50) % W;
        const y = (i * 97.3 + 30) % H;
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      }
      // Trees/decoration
      ctx.fillStyle = "rgba(0,100,0,0.15)";
      for (let i = 0; i < 30; i++) {
        const x = (i * 211.7) % W;
        const y = (i * 173.3) % H;
        if (!isOnPath(x, y, s.spline)) {
          ctx.beginPath(); ctx.arc(x, y, 12 + (i % 5) * 3, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    function drawPath() {
      ctx.save();
      ctx.lineCap = "round"; ctx.lineJoin = "round";

      // Shadow
      ctx.lineWidth = PATH_WIDTH + 16;
      ctx.strokeStyle = "rgba(0,0,0,0.2)";
      ctx.beginPath();
      s.spline.forEach((p, i) => i ? ctx.lineTo(p.x, p.y + 4) : ctx.moveTo(p.x, p.y + 4));
      ctx.stroke();

      // Outer
      ctx.lineWidth = PATH_WIDTH + 10;
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, map.pathColor1); g.addColorStop(1, map.pathColor1);
      ctx.strokeStyle = g;
      ctx.beginPath();
      s.spline.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.stroke();

      // Inner
      ctx.lineWidth = PATH_WIDTH - 10;
      ctx.strokeStyle = map.pathColor2;
      ctx.beginPath();
      s.spline.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.stroke();

      // Dashed center line
      ctx.lineWidth = 2; ctx.strokeStyle = "rgba(0,0,0,0.1)"; ctx.setLineDash([8, 12]);
      ctx.beginPath();
      s.spline.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
      ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
    }

    function drawBase() {
      const endP = s.spline[s.spline.length - 1];
      const ratio = s.baseHp / s.baseMaxHp;

      // Base circle
      ctx.save();
      ctx.shadowColor = "rgba(255,0,0,0.4)"; ctx.shadowBlur = 20;
      const hue = ratio * 120; // green to red
      ctx.fillStyle = `hsl(${hue}, 70%, 50%)`;
      ctx.beginPath(); ctx.arc(endP.x, endP.y, 24, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

      ctx.strokeStyle = "#333"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(endP.x, endP.y, 24, 0, Math.PI * 2); ctx.stroke();

      // HP bar
      const bw = 40;
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      ctx.fillRect(endP.x - bw / 2, endP.y - 38, bw, 6);
      ctx.fillStyle = `hsl(${hue}, 70%, 50%)`;
      ctx.fillRect(endP.x - bw / 2, endP.y - 38, bw * ratio, 6);

      // Level
      ctx.fillStyle = "#fff"; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(`Lv${s.baseLevel}`, endP.x, endP.y + 5);
      ctx.textAlign = "start";
    }

    function drawEnemies() {
      s.enemies.forEach(e => {
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 4;
        if (e.isBoss) {
          // Boss glow
          ctx.shadowColor = e.type.color; ctx.shadowBlur = 20;
        }
        ctx.fillStyle = e.type.color;
        const r = e.isBoss ? e.type.radius * 1.8 : e.type.radius;
        ctx.beginPath(); ctx.arc(e.x, e.y, r, 0, Math.PI * 2); ctx.fill();

        if (e.isBoss) {
          // Crown
          ctx.fillStyle = "#ffce3b";
          ctx.beginPath();
          ctx.moveTo(e.x - 10, e.y - r - 2);
          ctx.lineTo(e.x - 6, e.y - r - 10);
          ctx.lineTo(e.x, e.y - r - 4);
          ctx.lineTo(e.x + 6, e.y - r - 10);
          ctx.lineTo(e.x + 10, e.y - r - 2);
          ctx.closePath(); ctx.fill();
        }

        ctx.restore();
        // HP bar
        const bw = e.isBoss ? 40 : 26, ratio = e.hp / e.maxHp;
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillRect(e.x - bw / 2, e.y - r - 12, bw, 5);
        ctx.fillStyle = ratio > 0.5 ? "#2ecc71" : ratio > 0.25 ? "#f39c12" : "#e74c3c";
        ctx.fillRect(e.x - bw / 2, e.y - r - 12, bw * ratio, 5);
      });
    }

    function drawTowers() {
      s.towers.forEach(t => {
        if (t === s.selectedTower) {
          ctx.save();
          ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
          ctx.beginPath(); ctx.arc(t.x, t.y, t.range, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        }
        const def = towerDefs[t.type];

        // Shadow
        ctx.save();
        ctx.fillStyle = "rgba(0,0,0,0.2)";
        ctx.beginPath(); ctx.ellipse(t.x, t.y + 20, 16, 6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();

        // Body
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
        if (t.type === "omega") {
          // Rainbow shimmer
          const hue = (s.frame * 3 + t.x) % 360;
          ctx.fillStyle = `hsl(${hue}, 80%, 70%)`;
        } else {
          ctx.fillStyle = def.color;
        }
        ctx.beginPath(); ctx.arc(t.x, t.y, 18, 0, Math.PI * 2); ctx.fill();
        ctx.restore();

        ctx.strokeStyle = t.type === "omega" ? `hsl(${(s.frame * 3 + t.x + 180) % 360}, 60%, 40%)` : def.outline;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(t.x, t.y, 18, 0, Math.PI * 2); ctx.stroke();

        // Eyes
        ctx.fillStyle = "#111";
        ctx.beginPath(); ctx.arc(t.x - 5, t.y - 4, 3, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(t.x + 5, t.y - 4, 3, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#111"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(t.x, t.y + 3, 6, 0.1, Math.PI - 0.1); ctx.stroke();
      });
    }

    function drawProjectiles() {
      s.projectiles.forEach(p => {
        ctx.save();
        if (p.special === "rainbow") {
          const hue = (s.frame * 10 + p.x) % 360;
          ctx.fillStyle = `hsl(${hue}, 100%, 60%)`;
          ctx.shadowColor = `hsl(${hue}, 100%, 60%)`; ctx.shadowBlur = 15;
          ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); ctx.fill();
        } else if (p.special === "burning") {
          ctx.fillStyle = "#ff6b35";
          ctx.shadowColor = "#ff4500"; ctx.shadowBlur = 12;
          ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.fill();
        } else if (p.special === "bomb" || p.type === "bomb") {
          ctx.fillStyle = "#f39c12";
          ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill();
        } else if (p.type === "ice") {
          ctx.fillStyle = "#74b9ff";
          ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.fillStyle = "#fff";
          ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      });
    }

    function drawParticles() {
      s.particles = s.particles.filter(p => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.life--;
        if (p.life <= 0) return false;
        ctx.save();
        ctx.globalAlpha = p.life / p.maxLife;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        return true;
      });
    }

    function spawnParticles(x: number, y: number, color: string, count: number) {
      for (let i = 0; i < count; i++) {
        s.particles.push({
          x, y, vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4 - 1,
          life: 20 + Math.random() * 20, maxLife: 40, color, size: 2 + Math.random() * 3,
        });
      }
    }

    function drawPlacementPreview() {
      const h = uiRef.current.hovering;
      if (!h || s.selectedTower) return;
      const def = towerDefs[s.selectedTowerType];
      if (!def) return;
      const onPath = isOnPath(h.x, h.y, s.spline);
      const tooClose = s.towers.some(t => dist(h, t) < 36);
      const canPlace = !onPath && !tooClose && s.money >= def.cost;
      ctx.save(); ctx.globalAlpha = 0.5;
      ctx.fillStyle = canPlace ? def.color : "#ff0000";
      ctx.beginPath(); ctx.arc(h.x, h.y, 18, 0, Math.PI * 2); ctx.fill();
      if (canPlace) {
        ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.arc(h.x, h.y, def.baseRange, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }

    function drawHUD() {
      // Top bar
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      roundRect(ctx, 10, 10, 340, 40, 20); ctx.fill();
      ctx.font = "bold 14px sans-serif"; ctx.fillStyle = "#fff";
      const multStr = s.cashMultiplier !== 1 ? ` (×${s.cashMultiplier.toFixed(1)})` : "";
      ctx.fillText(`💰 ${s.money}${multStr}`, 24, 36);
      ctx.fillText(`❤️ ${s.lives}`, 150, 36);
      const waveStr = s.mode === "endless" ? `🌊 ${s.waveIndex}` : `🌊 ${s.waveIndex}/20`;
      ctx.fillText(waveStr, 210, 36);

      // Base HP indicator
      ctx.fillText(`🏠 ${s.baseHp}/${s.baseMaxHp}`, 280, 36);

      // Start wave button
      if (!s.inWave && !s.gameOver && (s.mode === "endless" || s.waveIndex < 20)) {
        ctx.fillStyle = "#4b8cff";
        roundRect(ctx, 360, 10, 120, 40, 20); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 2;
        roundRect(ctx, 360, 10, 120, 40, 20); ctx.stroke();
        ctx.fillStyle = "#fff"; ctx.font = "bold 13px sans-serif";
        ctx.fillText("Start Wave", 378, 36);
      }

      // Back to menu button
      ctx.fillStyle = "rgba(255,75,92,0.8)";
      roundRect(ctx, W - 90, 10, 80, 30, 15); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "bold 11px sans-serif";
      ctx.fillText("Menu", W - 65, 30);

      // Upgrade base button
      const baseCost = s.baseLevel * 150;
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      roundRect(ctx, 10, 56, 180, 30, 15); ctx.fill();
      ctx.fillStyle = s.money >= baseCost ? "#2ecc71" : "#666";
      ctx.font = "bold 11px sans-serif";
      ctx.fillText(`⬆ Upgrade Base ($${baseCost})`, 22, 76);

      // Tower bar
      const availableTowers = Object.entries(towerDefs).filter(([, d]) => !d.hidden || s.omegaUnlocked);
      const barW = availableTowers.length * 95 + 10;
      const barX = (W - barW) / 2;
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      roundRect(ctx, barX, H - 64, barW, 56, 14); ctx.fill();

      availableTowers.forEach(([key, def], i) => {
        const bx = barX + 10 + i * 95;
        const selected = s.selectedTowerType === key && !s.selectedTower;
        ctx.fillStyle = selected ? "#ffce3b" : "rgba(255,255,255,0.12)";
        roundRect(ctx, bx, H - 58, 85, 44, 10); ctx.fill();
        if (selected) {
          ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
          roundRect(ctx, bx, H - 58, 85, 44, 10); ctx.stroke();
        }
        ctx.font = "bold 11px sans-serif"; ctx.fillStyle = selected ? "#111" : "#fff";
        ctx.fillText(key === "omega" ? "Omega" : def.name.split(" ")[0], bx + 6, H - 38);
        ctx.font = "10px sans-serif"; ctx.fillStyle = selected ? "#333" : "#aaa";
        ctx.fillText(`$${def.cost}`, bx + 6, H - 24);
      });

      if (s.selectedTower) drawUpgradePanel();

      // Game over / win
      if (s.gameOver) {
        ctx.fillStyle = "rgba(0,0,0,0.8)"; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "#fff"; ctx.font = "bold 48px sans-serif"; ctx.textAlign = "center";
        ctx.fillText(s.won ? "🎉 Victory!" : "💀 Game Over", W / 2, H / 2 - 30);
        ctx.font = "18px sans-serif"; ctx.fillStyle = "#aaa";
        ctx.fillText(`Waves survived: ${s.waveIndex}`, W / 2, H / 2 + 5);

        ctx.fillStyle = "#ffce3b";
        roundRect(ctx, W / 2 - 70, H / 2 + 25, 140, 44, 22); ctx.fill();
        ctx.fillStyle = "#111"; ctx.font = "bold 16px sans-serif";
        ctx.fillText("Main Menu", W / 2, H / 2 + 53);
        ctx.textAlign = "start";
      }

      // Watermark
      ctx.font = "bold 12px monospace";
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.fillText("Uzxyr", 12, H - 12);
    }

    function drawUpgradePanel() {
      const t = s.selectedTower!;
      const def = towerDefs[t.type];
      const px = W - 225, py = 80, pw = 210, ph = 250;
      ctx.fillStyle = "rgba(0,0,0,0.85)";
      roundRect(ctx, px, py, pw, ph, 14); ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.1)"; ctx.lineWidth = 1;
      roundRect(ctx, px, py, pw, ph, 14); ctx.stroke();

      ctx.fillStyle = "#ffce3b"; ctx.font = "bold 14px sans-serif";
      ctx.fillText(def.name, px + 12, py + 22);
      ctx.font = "11px sans-serif"; ctx.fillStyle = "#aaa";
      ctx.fillText(`DMG: ${t.damage}  RNG: ${t.range}  SPD: ${t.fireRate}`, px + 12, py + 40);

      const upgrades = [
        { label: "Damage +5", cost: t.levelDmg * 70, y: py + 55 },
        { label: "Range +15", cost: t.levelRng * 60, y: py + 82 },
        { label: "Speed -3", cost: t.levelSpd * 65, y: py + 109 },
      ];

      upgrades.forEach(u => {
        const canAfford = s.money >= u.cost && (u.label.includes("Speed") ? t.fireRate > 12 : true);
        ctx.fillStyle = canAfford ? "#ff9f43" : "#444";
        roundRect(ctx, px + 10, u.y, pw - 20, 22, 11); ctx.fill();
        ctx.fillStyle = canAfford ? "#111" : "#888"; ctx.font = "bold 10px sans-serif";
        ctx.fillText(`${u.label} ($${u.cost})`, px + 20, u.y + 15);
      });

      ctx.fillStyle = "#aaa"; ctx.font = "bold 10px sans-serif";
      ctx.fillText("Targeting:", px + 12, py + 148);
      const modes = ["first", "last", "strong"];
      modes.forEach((m, i) => {
        const bx = px + 10 + i * 64;
        ctx.fillStyle = t.targeting === m ? "#ffce3b" : "#4b8cff";
        roundRect(ctx, bx, py + 155, 58, 20, 10); ctx.fill();
        ctx.fillStyle = t.targeting === m ? "#111" : "#fff"; ctx.font = "bold 9px sans-serif";
        ctx.fillText(m[0].toUpperCase() + m.slice(1), bx + 8, py + 169);
      });

      const sellVal = Math.floor(def.cost * 0.7 + (t.levelDmg + t.levelRng + t.levelSpd - 3) * 40);
      ctx.fillStyle = "#ff4b5c";
      roundRect(ctx, px + 10, py + 188, pw - 20, 24, 12); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "bold 11px sans-serif";
      ctx.fillText(`Sell ($${sellVal})`, px + 55, py + 204);

      // Close
      ctx.fillStyle = "#666";
      roundRect(ctx, px + 10, py + 218, pw - 20, 22, 11); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "bold 10px sans-serif";
      ctx.fillText("Close", px + 80, py + 233);
    }

    // ── Game Logic ──
    function spawnEnemy() {
      if (s.enemiesToSpawn.length === 0) {
        if (s.enemies.length === 0) {
          s.inWave = false;
          // Check multipliers
          if (s.mode === "endless" && s.waveIndex % 5 === 0) {
            s.cashMultiplier += 0.5;
          }
          if (s.waveIndex % 3 === 0 && s.waveIndex > 0) {
            s.cashMultiplier += 0.25;
          }
          // Check omega unlock conditions
          if (s.waveIndex === 5 && s.damageTaken === 0) {
            s.wave5NoDamage = true;
          }
          if (s.waveIndex === 10) {
            const types = new Set(s.towers.map(t => t.type));
            if (types.has("dart") && types.has("bomb") && types.has("sniper") && types.has("ice")) {
              s.hasAllTowersByWave10 = true;
            }
            if (s.wave5NoDamage && s.hasAllTowersByWave10) {
              s.omegaUnlocked = true;
              localStorage.setItem("omega_unlocked", "true");
              setOmegaUnlocked(true);
            }
          }
          // Win check for normal mode
          if (s.mode === "normal" && s.waveIndex >= 20) {
            s.gameOver = true; s.won = true;
          }
        }
        return;
      }
      const data = s.enemiesToSpawn.shift()!;
      const type = enemyTypes[data.typeIndex];
      const boss = !!data.isBoss;
      const hpMult = boss ? 10 : 1;
      const speedMult = boss ? 0.33 : 1;
      s.enemies.push({
        t: 0, speed: type.speed * speedMult, baseSpeed: type.speed * speedMult,
        type, hp: type.hp * hpMult, maxHp: type.hp * hpMult,
        x: s.spline[0].x, y: s.spline[0].y,
        reachedEnd: false, dead: false, isBoss: boss,
      });
    }

    function prepareWave(idx: number) {
      const waveDef = getWaveDef(idx);
      s.enemiesToSpawn = [];
      waveDef.forEach(g => {
        for (let i = 0; i < g.count; i++) s.enemiesToSpawn.push({ typeIndex: g.typeIndex });
      });
      // Boss wave every 5
      if (isBossWave(idx)) {
        const bossType = Math.min(4, Math.floor(idx / 4));
        s.enemiesToSpawn.push({ typeIndex: bossType, isBoss: true });
      }
      s.spawnTimer = 0; s.inWave = true; s.waveIndex = idx + 1;
    }

    function moveEnemies() {
      const splineLen = s.spline.length;
      s.enemies.forEach(e => {
        // Arc-length-aware movement for consistent speed
        const step = e.speed * 0.8;
        const curIdx = e.t * (splineLen - 1);
        const i0 = Math.floor(curIdx);
        const i1 = Math.min(splineLen - 1, i0 + 1);
        if (i0 < splineLen - 1) {
          const segLen = dist(s.spline[i0], s.spline[i1]) || 1;
          e.t += step / (segLen * (splineLen - 1));
        } else {
          e.t = 1;
        }

        if (e.t >= 1) { e.reachedEnd = true; return; }

        const idx = e.t * (splineLen - 1);
        const fi = Math.floor(idx);
        const ni = Math.min(splineLen - 1, fi + 1);
        const frac = idx - fi;
        e.x = s.spline[fi].x + (s.spline[ni].x - s.spline[fi].x) * frac;
        e.y = s.spline[fi].y + (s.spline[ni].y - s.spline[fi].y) * frac;
      });

      s.enemies = s.enemies.filter(e => {
        if (e.reachedEnd) {
          const dmg = e.isBoss ? 10 : 1;
          s.baseHp -= dmg;
          s.damageTaken += dmg;
          if (s.baseHp <= 0) { s.lives--; s.baseHp = 0; }
          return false;
        }
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
        t.shotsFired++;

        if (t.type === "omega") {
          // Special omega tower logic
          let special: "bomb" | "burning" | "rainbow" | undefined;
          let dmg = t.damage;
          let splash = 0;
          if (t.shotsFired % 10 === 0) {
            special = "rainbow"; dmg = 250;
          } else if (t.shotsFired % 4 === 0) {
            special = "burning"; dmg = towerDefs.sniper.baseDamage * 4;
          } else if (t.shotsFired % 2 === 0) {
            special = "bomb"; splash = Math.sqrt(W * H * 0.25); // 25% of map area as radius
          }
          s.projectiles.push({
            x: t.x, y: t.y, target, speed: def.projectileSpeed, damage: dmg,
            type: t.type, splashRadius: splash, special,
          });
        } else {
          s.projectiles.push({
            x: t.x, y: t.y, target, speed: def.projectileSpeed, damage: t.damage,
            type: t.type, splashRadius: def.splashRadius || 0,
          });
        }
        t.cooldown = t.fireRate;
      });
    }

    function moveProjectiles() {
      s.projectiles.forEach(p => {
        if (!p.target || p.target.dead || p.target.reachedEnd) { p.dead = true; return; }
        const dx = p.target.x - p.x, dy = p.target.y - p.y, d = Math.hypot(dx, dy);
        if (d < 8) {
          const reward = (amt: number) => { s.money += Math.floor(amt * s.cashMultiplier); };

          if (p.special === "rainbow") {
            // Rainbow hits everything
            s.enemies.forEach(e => {
              e.hp -= p.damage;
              if (e.hp <= 0 && !e.dead) { e.dead = true; reward(e.type.reward); spawnParticles(e.x, e.y, "#ff0", 8); }
            });
            spawnParticles(p.x, p.y, "#ff0", 15);
          } else if (p.special === "bomb" || (p.type === "bomb" && p.splashRadius > 0)) {
            s.enemies.forEach(e => {
              if (dist(p, e) <= p.splashRadius) {
                e.hp -= p.damage;
                if (e.hp <= 0 && !e.dead) { e.dead = true; reward(e.type.reward); spawnParticles(e.x, e.y, "#f90", 5); }
              }
            });
            spawnParticles(p.x, p.y, "#f90", 10);
          } else if (p.special === "burning") {
            p.target.hp -= p.damage;
            spawnParticles(p.x, p.y, "#ff4500", 8);
            if (p.target.hp <= 0 && !p.target.dead) { p.target.dead = true; reward(p.target.type.reward); }
          } else if (p.type === "ice") {
            s.enemies.forEach(e => { if (dist(p, e) <= 60) e.speed = Math.max(0.3, e.baseSpeed * 0.5); });
            p.target.hp -= p.damage;
            if (p.target.hp <= 0 && !p.target.dead) { p.target.dead = true; reward(p.target.type.reward); }
          } else {
            p.target.hp -= p.damage;
            if (p.target.hp <= 0 && !p.target.dead) { p.target.dead = true; reward(p.target.type.reward); spawnParticles(p.x, p.y, "#fff", 4); }
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
      drawBg(); drawPath(); drawBase();
      drawPlacementPreview(); drawTowers(); drawEnemies();
      drawProjectiles(); drawParticles(); drawHUD();

      if (!s.gameOver) {
        if (s.inWave) { s.spawnTimer--; if (s.spawnTimer <= 0) { spawnEnemy(); s.spawnTimer = 28; } }
        if (s.inWave && s.enemiesToSpawn.length === 0 && s.enemies.length === 0) {
          s.inWave = false;
          if (s.mode === "endless" && s.waveIndex % 5 === 0) s.cashMultiplier += 0.5;
          if (s.waveIndex % 3 === 0 && s.waveIndex > 0) s.cashMultiplier += 0.25;
          if (s.mode === "normal" && s.waveIndex >= 20) { s.gameOver = true; s.won = true; }
          // Omega checks
          if (s.waveIndex === 5 && s.damageTaken === 0) s.wave5NoDamage = true;
          if (s.waveIndex === 10) {
            const types = new Set(s.towers.map(tw => tw.type));
            if (types.has("dart") && types.has("bomb") && types.has("sniper") && types.has("ice")) {
              s.hasAllTowersByWave10 = true;
            }
            if (s.wave5NoDamage && s.hasAllTowersByWave10 && !s.omegaUnlocked) {
              s.omegaUnlocked = true;
              localStorage.setItem("omega_unlocked", "true");
              setOmegaUnlocked(true);
            }
          }
        }
        moveEnemies(); towersAct(); moveProjectiles();
        // Gradually restore ice-slowed enemies
        s.enemies.forEach(e => { e.speed = Math.min(e.baseSpeed, e.speed + 0.01); });
        if (s.lives <= 0 || s.baseHp <= 0) { s.gameOver = true; s.won = false; }
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

      // Game over → menu
      if (s.gameOver) {
        if (p.x > W / 2 - 70 && p.x < W / 2 + 70 && p.y > H / 2 + 25 && p.y < H / 2 + 69) {
          setScreen("menu");
        }
        return;
      }

      // Menu button
      if (p.x > W - 90 && p.x < W - 10 && p.y > 10 && p.y < 40) {
        setScreen("menu"); return;
      }

      // Upgrade base
      const baseCost = s.baseLevel * 150;
      if (p.x > 10 && p.x < 190 && p.y > 56 && p.y < 86 && s.money >= baseCost) {
        s.money -= baseCost; s.baseLevel++; s.baseMaxHp += 50; s.baseHp = Math.min(s.baseHp + 50, s.baseMaxHp);
        return;
      }

      // Start wave
      if (!s.inWave && !s.gameOver && (s.mode === "endless" || s.waveIndex < 20)) {
        if (p.x > 360 && p.x < 480 && p.y > 10 && p.y < 50) {
          prepareWave(s.waveIndex); return;
        }
      }

      // Tower bar
      const availableTowers = Object.entries(towerDefs).filter(([, d]) => !d.hidden || s.omegaUnlocked);
      const barW = availableTowers.length * 95 + 10;
      const barX = (W - barW) / 2;
      if (p.y > H - 64) {
        availableTowers.forEach(([key], i) => {
          const bx = barX + 10 + i * 95;
          if (p.x > bx && p.x < bx + 85 && p.y > H - 58 && p.y < H - 14) {
            s.selectedTowerType = key; s.selectedTower = null;
          }
        });
        return;
      }

      // Upgrade panel clicks
      if (s.selectedTower) {
        const t = s.selectedTower;
        const def = towerDefs[t.type];
        const px = W - 225, py = 80;

        if (p.x > px + 10 && p.x < px + 200 && p.y > py + 55 && p.y < py + 77) {
          const cost = t.levelDmg * 70;
          if (s.money >= cost) { s.money -= cost; t.damage += 5; t.levelDmg++; } return;
        }
        if (p.x > px + 10 && p.x < px + 200 && p.y > py + 82 && p.y < py + 104) {
          const cost = t.levelRng * 60;
          if (s.money >= cost) { s.money -= cost; t.range += 15; t.levelRng++; } return;
        }
        if (p.x > px + 10 && p.x < px + 200 && p.y > py + 109 && p.y < py + 131) {
          const cost = t.levelSpd * 65;
          if (s.money >= cost && t.fireRate > 12) { s.money -= cost; t.fireRate = Math.max(10, t.fireRate - 3); t.levelSpd++; } return;
        }
        const modes = ["first", "last", "strong"];
        modes.forEach((m, i) => {
          const bx = px + 10 + i * 64;
          if (p.x > bx && p.x < bx + 58 && p.y > py + 155 && p.y < py + 175) t.targeting = m;
        });
        if (p.x > px + 10 && p.x < px + 200 && p.y > py + 188 && p.y < py + 212) {
          const sellVal = Math.floor(def.cost * 0.7 + (t.levelDmg + t.levelRng + t.levelSpd - 3) * 40);
          s.money += sellVal; s.towers = s.towers.filter(tw => tw !== t); s.selectedTower = null; return;
        }
        if (p.x > px + 10 && p.x < px + 200 && p.y > py + 218 && p.y < py + 240) {
          s.selectedTower = null; return;
        }
        if (p.x > px && p.x < px + 210 && p.y > py && p.y < py + 250) return;
      }

      // Select tower
      for (const t of s.towers) {
        if (dist(p, t) <= 20) { s.selectedTower = t; return; }
      }

      // Place tower
      s.selectedTower = null;
      const def = towerDefs[s.selectedTowerType];
      if (!def || (def.hidden && !s.omegaUnlocked)) return;
      if (s.money < def.cost || isOnPath(p.x, p.y, s.spline) || s.towers.some(t => dist(p, t) < 36)) return;
      s.money -= def.cost;
      s.towers.push({
        x: p.x, y: p.y, type: s.selectedTowerType,
        range: def.baseRange, damage: def.baseDamage, fireRate: def.baseFireRate,
        cooldown: 0, levelDmg: 1, levelRng: 1, levelSpd: 1, targeting: "first", shotsFired: 0,
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
  }, [screen, setScreen, setOmegaUnlocked]);

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
