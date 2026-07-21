export const WORLD_SIZE = 112;

export type DirectionName = "up" | "down" | "left" | "right";

type Direction = { x: number; y: number };

export type Standing = {
  id: number;
  name: string;
  color: string;
  percent: number;
};

export type GameEvent =
  | { type: "capture"; amount: number; percent: number }
  | { type: "elimination"; name: string }
  | { type: "gameover"; percent: number; kills: number }
  | { type: "standings"; standings: Standing[]; rank: number; percent: number };

type Entity = {
  id: number;
  name: string;
  color: string;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  direction: Direction;
  desired: Direction;
  speed: number;
  alive: boolean;
  outside: boolean;
  trailCells: Set<number>;
  lastCell: number;
  respawnAt: number;
  nextDecision: number;
  trailGoal: number;
  kills: number;
};

type Particle = {
  x: number;
  y: number;
  color: string;
  life: number;
  size: number;
  vx: number;
  vy: number;
};

type CaptureRing = {
  x: number;
  y: number;
  color: string;
  life: number;
};

export type Game = {
  owner: Int16Array;
  trail: Int16Array;
  entities: Entity[];
  cameraX: number;
  cameraY: number;
  viewWidth: number;
  viewHeight: number;
  dpr: number;
  ended: boolean;
  started: boolean;
  lastStandingUpdate: number;
  particles: Particle[];
  rings: CaptureRing[];
};

const DIRECTIONS: Record<DirectionName, Direction> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const BOT_DATA = [
  { name: "Coral", color: "#ff6f61", x: 22, y: 23, direction: "right" as DirectionName },
  { name: "Moss", color: "#23c89b", x: 89, y: 22, direction: "down" as DirectionName },
  { name: "Sunny", color: "#f6bf3e", x: 90, y: 88, direction: "left" as DirectionName },
  { name: "Berry", color: "#ed5da8", x: 22, y: 89, direction: "up" as DirectionName },
  { name: "Sky", color: "#37a6e9", x: 56, y: 17, direction: "right" as DirectionName },
];

const NEUTRAL = -1;

function cellIndex(x: number, y: number) {
  return y * WORLD_SIZE + x;
}

function copyDirection(direction: Direction) {
  return { x: direction.x, y: direction.y };
}

function makeEntity(
  id: number,
  name: string,
  color: string,
  x: number,
  y: number,
  direction: DirectionName,
): Entity {
  return {
    id,
    name,
    color,
    x,
    y,
    homeX: x,
    homeY: y,
    direction: copyDirection(DIRECTIONS[direction]),
    desired: copyDirection(DIRECTIONS[direction]),
    speed: id === 0 ? 8.4 : 6.4 + Math.random() * 1.35,
    alive: true,
    outside: false,
    trailCells: new Set<number>(),
    lastCell: cellIndex(Math.floor(x), Math.floor(y)),
    respawnAt: 0,
    nextDecision: 0,
    trailGoal: 13 + Math.floor(Math.random() * 18),
    kills: 0,
  };
}

function seedTerritory(game: Game, entity: Entity, radius = 6) {
  const cx = Math.floor(entity.x);
  const cy = Math.floor(entity.y);
  for (let y = cy - radius; y <= cy + radius; y += 1) {
    for (let x = cx - radius; x <= cx + radius; x += 1) {
      if (x < 0 || y < 0 || x >= WORLD_SIZE || y >= WORLD_SIZE) continue;
      const distance = Math.hypot(x - cx, y - cy);
      if (distance <= radius + 0.25) game.owner[cellIndex(x, y)] = entity.id;
    }
  }
}

export function createGame(playerColor: string): Game {
  const game: Game = {
    owner: new Int16Array(WORLD_SIZE * WORLD_SIZE),
    trail: new Int16Array(WORLD_SIZE * WORLD_SIZE),
    entities: [],
    cameraX: WORLD_SIZE / 2,
    cameraY: WORLD_SIZE / 2,
    viewWidth: window.innerWidth,
    viewHeight: window.innerHeight,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
    ended: false,
    started: false,
    lastStandingUpdate: 0,
    particles: [],
    rings: [],
  };
  resetGame(game, playerColor);
  return game;
}

export function resetGame(game: Game, playerColor: string) {
  game.owner.fill(NEUTRAL);
  game.trail.fill(NEUTRAL);
  game.ended = false;
  game.started = true;
  game.lastStandingUpdate = 0;
  game.particles = [];
  game.rings = [];

  const player = makeEntity(0, "You", playerColor, 56, 56, "right");
  game.entities = [player];
  BOT_DATA.forEach((bot, index) => {
    game.entities.push(makeEntity(index + 1, bot.name, bot.color, bot.x, bot.y, bot.direction));
  });
  game.entities.forEach((entity) => seedTerritory(game, entity));
  game.cameraX = player.x;
  game.cameraY = player.y;
}

export function setPlayerColor(game: Game, color: string) {
  if (game.entities[0]) game.entities[0].color = color;
}

export function resizeGameCanvas(canvas: HTMLCanvasElement, game: Game) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  game.viewWidth = width;
  game.viewHeight = height;
  game.dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(width * game.dpr);
  canvas.height = Math.floor(height * game.dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
}

export function turnPlayer(game: Game, directionName: DirectionName) {
  const player = game.entities[0];
  if (!player?.alive || game.ended) return;
  const next = DIRECTIONS[directionName];
  const isReverse = next.x === -player.direction.x && next.y === -player.direction.y;
  if (!isReverse) player.desired = copyDirection(next);
}

function percentOwned(game: Game, id: number) {
  let cells = 0;
  for (let index = 0; index < game.owner.length; index += 1) {
    if (game.owner[index] === id) cells += 1;
  }
  return (cells / game.owner.length) * 100;
}

export function getStandings(game: Game) {
  const standings = game.entities.map((entity) => ({
    id: entity.id,
    name: entity.name,
    color: entity.color,
    percent: percentOwned(game, entity.id),
  }));
  standings.sort((a, b) => b.percent - a.percent);
  return standings;
}

function addCaptureEffects(game: Game, entity: Entity, gained: number) {
  const amount = Math.min(26, Math.max(8, Math.floor(gained / 2)));
  for (let index = 0; index < amount; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 5;
    game.particles.push({
      x: entity.x,
      y: entity.y,
      color: entity.color,
      life: 0.6 + Math.random() * 0.45,
      size: 0.16 + Math.random() * 0.24,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
    });
  }
  game.rings.push({ x: entity.x, y: entity.y, color: entity.color, life: 0.8 });
}

// A boundary flood-fill leaves only the area enclosed by the player's new loop.
function captureEnclosedArea(game: Game, entity: Entity) {
  let gained = 0;
  entity.trailCells.forEach((index) => {
    if (game.owner[index] !== entity.id) gained += 1;
    game.owner[index] = entity.id;
    game.trail[index] = NEUTRAL;
  });
  entity.trailCells.clear();

  const visited = new Uint8Array(game.owner.length);
  const queue = new Int32Array(game.owner.length);
  let head = 0;
  let tail = 0;

  const enqueue = (x: number, y: number) => {
    const index = cellIndex(x, y);
    if (visited[index] || game.owner[index] === entity.id) return;
    visited[index] = 1;
    queue[tail] = index;
    tail += 1;
  };

  for (let edge = 0; edge < WORLD_SIZE; edge += 1) {
    enqueue(edge, 0);
    enqueue(edge, WORLD_SIZE - 1);
    enqueue(0, edge);
    enqueue(WORLD_SIZE - 1, edge);
  }

  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % WORLD_SIZE;
    const y = Math.floor(index / WORLD_SIZE);
    if (x > 0) enqueue(x - 1, y);
    if (x < WORLD_SIZE - 1) enqueue(x + 1, y);
    if (y > 0) enqueue(x, y - 1);
    if (y < WORLD_SIZE - 1) enqueue(x, y + 1);
  }

  for (let index = 0; index < game.owner.length; index += 1) {
    if (!visited[index] && game.owner[index] !== entity.id) {
      game.owner[index] = entity.id;
      game.trail[index] = NEUTRAL;
      gained += 1;
    }
  }
  addCaptureEffects(game, entity, gained);
  return gained;
}

function clearEntityTrail(game: Game, entity: Entity) {
  entity.trailCells.forEach((index) => {
    if (game.trail[index] === entity.id) game.trail[index] = NEUTRAL;
  });
  entity.trailCells.clear();
}

function eliminate(
  game: Game,
  targetId: number,
  killerId: number,
  now: number,
  events: GameEvent[],
) {
  const target = game.entities[targetId];
  if (!target?.alive) return;
  target.alive = false;
  clearEntityTrail(game, target);

  if (killerId >= 0 && killerId !== targetId) {
    const killer = game.entities[killerId];
    if (killer) killer.kills += 1;
  }

  if (targetId === 0) {
    game.ended = true;
    events.push({
      type: "gameover",
      percent: percentOwned(game, 0),
      kills: target.kills,
    });
    return;
  }

  for (let index = 0; index < game.owner.length; index += 1) {
    if (game.owner[index] === targetId) game.owner[index] = NEUTRAL;
  }
  target.respawnAt = now + 1800 + Math.random() * 1200;
  events.push({ type: "elimination", name: target.name });
}

function findRespawnPoint(game: Game) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const x = 11 + Math.floor(Math.random() * (WORLD_SIZE - 22));
    const y = 11 + Math.floor(Math.random() * (WORLD_SIZE - 22));
    let open = true;
    for (let oy = -5; oy <= 5 && open; oy += 1) {
      for (let ox = -5; ox <= 5; ox += 1) {
        if (game.owner[cellIndex(x + ox, y + oy)] !== NEUTRAL) {
          open = false;
          break;
        }
      }
    }
    if (open) return { x, y };
  }
  return {
    x: 10 + Math.floor(Math.random() * (WORLD_SIZE - 20)),
    y: 10 + Math.floor(Math.random() * (WORLD_SIZE - 20)),
  };
}

function respawnBot(game: Game, entity: Entity, now: number) {
  const point = findRespawnPoint(game);
  entity.x = point.x;
  entity.y = point.y;
  entity.homeX = point.x;
  entity.homeY = point.y;
  entity.direction = copyDirection(DIRECTIONS.right);
  entity.desired = copyDirection(DIRECTIONS.right);
  entity.alive = true;
  entity.outside = false;
  entity.lastCell = cellIndex(Math.floor(point.x), Math.floor(point.y));
  entity.nextDecision = now + 800;
  entity.trailGoal = 12 + Math.floor(Math.random() * 18);
  seedTerritory(game, entity, 5);
}

function chooseBotDirection(entity: Entity, now: number) {
  if (now < entity.nextDecision) return;
  entity.nextDecision = now + 360 + Math.random() * 700;

  const x = entity.x;
  const y = entity.y;
  let preferred: Direction | null = null;
  if (x < 7) preferred = DIRECTIONS.right;
  else if (x > WORLD_SIZE - 7) preferred = DIRECTIONS.left;
  else if (y < 7) preferred = DIRECTIONS.down;
  else if (y > WORLD_SIZE - 7) preferred = DIRECTIONS.up;

  if (!preferred && entity.outside && entity.trailCells.size >= entity.trailGoal) {
    const dx = entity.homeX - entity.x;
    const dy = entity.homeY - entity.y;
    preferred = Math.abs(dx) > Math.abs(dy)
      ? dx > 0 ? DIRECTIONS.right : DIRECTIONS.left
      : dy > 0 ? DIRECTIONS.down : DIRECTIONS.up;
  }

  const options = Object.values(DIRECTIONS).filter((direction) => (
    direction.x !== -entity.direction.x || direction.y !== -entity.direction.y
  ));
  const keepMoving = Math.random() < (entity.outside ? 0.55 : 0.38);
  const next = preferred ?? (keepMoving
    ? entity.direction
    : options[Math.floor(Math.random() * options.length)]);
  entity.desired = copyDirection(next);
}

function moveEntity(game: Game, entity: Entity, dt: number, now: number, events: GameEvent[]) {
  if (!entity.alive) {
    if (entity.id !== 0 && now >= entity.respawnAt) respawnBot(game, entity, now);
    return;
  }

  if (entity.id !== 0) chooseBotDirection(entity, now);
  const reversing = entity.desired.x === -entity.direction.x
    && entity.desired.y === -entity.direction.y;
  if (!reversing) entity.direction = copyDirection(entity.desired);

  entity.x += entity.direction.x * entity.speed * dt;
  entity.y += entity.direction.y * entity.speed * dt;

  if (entity.x < 0.5 || entity.y < 0.5 || entity.x >= WORLD_SIZE - 0.5 || entity.y >= WORLD_SIZE - 0.5) {
    eliminate(game, entity.id, -1, now, events);
    return;
  }

  const cellX = Math.floor(entity.x);
  const cellY = Math.floor(entity.y);
  const index = cellIndex(cellX, cellY);
  if (index === entity.lastCell) return;
  entity.lastCell = index;

  const trailOwner = game.trail[index];
  if (trailOwner === entity.id) {
    eliminate(game, entity.id, entity.id, now, events);
    return;
  }
  if (trailOwner !== NEUTRAL && trailOwner !== entity.id) {
    eliminate(game, trailOwner, entity.id, now, events);
  }

  if (game.owner[index] !== entity.id) {
    entity.outside = true;
    game.trail[index] = entity.id;
    entity.trailCells.add(index);
    return;
  }

  if (entity.outside && entity.trailCells.size > 1) {
    const gained = captureEnclosedArea(game, entity);
    entity.outside = false;
    entity.homeX = entity.x;
    entity.homeY = entity.y;
    entity.trailGoal = 12 + Math.floor(Math.random() * 24);
    if (entity.id === 0) {
      events.push({ type: "capture", amount: gained, percent: percentOwned(game, 0) });
    }
  }
}

function updateEffects(game: Game, dt: number) {
  game.particles.forEach((particle) => {
    particle.life -= dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vx *= 0.95;
    particle.vy *= 0.95;
  });
  game.particles = game.particles.filter((particle) => particle.life > 0);
  game.rings.forEach((ring) => { ring.life -= dt; });
  game.rings = game.rings.filter((ring) => ring.life > 0);
}

export function stepGame(game: Game, dt: number, now: number) {
  const events: GameEvent[] = [];
  if (game.ended) return events;

  game.entities.forEach((entity) => {
    if (!game.ended) moveEntity(game, entity, dt, now, events);
  });
  updateEffects(game, dt);

  const player = game.entities[0];
  if (player?.alive) {
    const smoothing = 1 - Math.pow(0.001, dt);
    game.cameraX += (player.x - game.cameraX) * smoothing;
    game.cameraY += (player.y - game.cameraY) * smoothing;
  }

  if (now - game.lastStandingUpdate > 800) {
    game.lastStandingUpdate = now;
    const standings = getStandings(game);
    events.push({
      type: "standings",
      standings,
      rank: standings.findIndex((standing) => standing.id === 0) + 1,
      percent: standings.find((standing) => standing.id === 0)?.percent ?? 0,
    });
  }
  return events;
}

function hexToRgba(hex: string, alpha: number) {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
}

function drawEntity(
  context: CanvasRenderingContext2D,
  entity: Entity,
  cameraX: number,
  cameraY: number,
  scale: number,
  width: number,
  height: number,
) {
  if (!entity.alive) return;
  const screenX = (entity.x - cameraX) * scale + width / 2;
  const screenY = (entity.y - cameraY) * scale + height / 2;
  const size = scale * 1.5;
  if (screenX < -size || screenY < -size || screenX > width + size || screenY > height + size) return;

  context.save();
  context.shadowColor = hexToRgba(entity.color, 0.36);
  context.shadowBlur = entity.id === 0 ? scale * 1.3 : scale * 0.7;
  context.shadowOffsetY = scale * 0.25;
  roundedRect(context, screenX - size / 2, screenY - size / 2, size, size, scale * 0.34);
  context.fillStyle = entity.color;
  context.fill();
  context.restore();

  const forwardX = entity.direction.x * scale * 0.22;
  const forwardY = entity.direction.y * scale * 0.22;
  const sideX = -entity.direction.y * scale * 0.25;
  const sideY = entity.direction.x * scale * 0.25;
  context.fillStyle = "rgba(255,255,255,0.95)";
  for (const side of [-1, 1]) {
    context.beginPath();
    context.arc(
      screenX + forwardX + sideX * side,
      screenY + forwardY + sideY * side,
      scale * 0.13,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
  context.fillStyle = "#1f2430";
  for (const side of [-1, 1]) {
    context.beginPath();
    context.arc(
      screenX + forwardX * 1.12 + sideX * side,
      screenY + forwardY * 1.12 + sideY * side,
      scale * 0.055,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
}

export function renderGame(canvas: HTMLCanvasElement, game: Game, menuMode = false) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const width = game.viewWidth;
  const height = game.viewHeight;
  context.setTransform(game.dpr, 0, 0, game.dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#f4f1e8";
  context.fillRect(0, 0, width, height);

  const scale = Math.max(8.2, Math.min(13, Math.min(width / 39, height / 66)));
  const cameraX = menuMode ? WORLD_SIZE / 2 : game.cameraX;
  const cameraY = menuMode ? WORLD_SIZE / 2 : game.cameraY;
  const minX = Math.max(0, Math.floor(cameraX - width / scale / 2) - 1);
  const maxX = Math.min(WORLD_SIZE - 1, Math.ceil(cameraX + width / scale / 2) + 1);
  const minY = Math.max(0, Math.floor(cameraY - height / scale / 2) - 1);
  const maxY = Math.min(WORLD_SIZE - 1, Math.ceil(cameraY + height / scale / 2) + 1);

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const index = cellIndex(x, y);
      const territoryOwner = game.owner[index];
      const trailOwner = game.trail[index];
      const screenX = Math.floor((x - cameraX) * scale + width / 2);
      const screenY = Math.floor((y - cameraY) * scale + height / 2);
      if (territoryOwner !== NEUTRAL) {
        const entity = game.entities[territoryOwner];
        if (entity) {
          context.fillStyle = hexToRgba(entity.color, menuMode ? 0.5 : 0.62);
          context.fillRect(screenX, screenY, Math.ceil(scale + 0.5), Math.ceil(scale + 0.5));
        }
      }
      if (trailOwner !== NEUTRAL) {
        const entity = game.entities[trailOwner];
        if (entity) {
          context.fillStyle = entity.color;
          context.fillRect(screenX, screenY, Math.ceil(scale + 0.5), Math.ceil(scale + 0.5));
        }
      }
    }
  }

  context.strokeStyle = "rgba(51, 55, 66, 0.055)";
  context.lineWidth = 1;
  context.beginPath();
  for (let x = Math.floor(minX / 5) * 5; x <= maxX; x += 5) {
    const screenX = Math.round((x - cameraX) * scale + width / 2) + 0.5;
    context.moveTo(screenX, 0);
    context.lineTo(screenX, height);
  }
  for (let y = Math.floor(minY / 5) * 5; y <= maxY; y += 5) {
    const screenY = Math.round((y - cameraY) * scale + height / 2) + 0.5;
    context.moveTo(0, screenY);
    context.lineTo(width, screenY);
  }
  context.stroke();

  game.rings.forEach((ring) => {
    const screenX = (ring.x - cameraX) * scale + width / 2;
    const screenY = (ring.y - cameraY) * scale + height / 2;
    context.beginPath();
    context.arc(screenX, screenY, (1 - ring.life) * scale * 5, 0, Math.PI * 2);
    context.strokeStyle = hexToRgba(ring.color, Math.max(0, ring.life) * 0.6);
    context.lineWidth = scale * 0.25;
    context.stroke();
  });

  game.particles.forEach((particle) => {
    const screenX = (particle.x - cameraX) * scale + width / 2;
    const screenY = (particle.y - cameraY) * scale + height / 2;
    context.beginPath();
    context.arc(screenX, screenY, particle.size * scale, 0, Math.PI * 2);
    context.fillStyle = hexToRgba(particle.color, Math.min(1, particle.life * 1.8));
    context.fill();
  });

  game.entities.forEach((entity) => {
    drawEntity(context, entity, cameraX, cameraY, scale, width, height);
  });

  const borderX = (0 - cameraX) * scale + width / 2;
  const borderY = (0 - cameraY) * scale + height / 2;
  context.strokeStyle = "rgba(31, 36, 48, 0.18)";
  context.lineWidth = 3;
  context.strokeRect(borderX, borderY, WORLD_SIZE * scale, WORLD_SIZE * scale);
}
