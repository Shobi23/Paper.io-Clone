import { useCallback, useEffect, useRef, useState } from "react";
import {
  createGame,
  getStandings,
  renderGame,
  resetGame,
  resizeGameCanvas,
  setPlayerColor,
  stepGame,
  turnPlayer,
  type DirectionName,
  type Game,
  type GameEvent,
  type Standing,
} from "./game";

type Phase = "menu" | "playing" | "paused" | "gameover";

type Gesture = {
  active: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const PLAYER_COLORS = ["#6857f5", "#ff6b57", "#12b98c", "#ef4f9a", "#249ee5"];

const EMPTY_GESTURE: Gesture = {
  active: false,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
};

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`game-logo ${compact ? "game-logo--compact" : ""}`} aria-label="Paper Trail">
      <span>PAPER</span>
      <span className="game-logo__slash">//</span>
      <span className="game-logo__trail">TRAIL</span>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
  active = false,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? "icon-button--active" : ""}`}
      onClick={onClick}
      aria-label={label}
    >
      {children}
    </button>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 9v6h4l5 4V5L9 9H5Z" />
      {muted
        ? <path d="m17 9 4 6m0-6-4 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        : <path d="M17 8.5c1.4 2 1.4 5 0 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
    </svg>
  );
}

function ArrowIcon({ direction }: { direction: DirectionName }) {
  const rotation = { up: 0, right: 90, down: 180, left: 270 }[direction];
  return (
    <svg style={{ transform: `rotate(${rotation}deg)` }} viewBox="0 0 24 24" aria-hidden="true">
      <path d="m12 5-7 8h4v6h6v-6h4l-7-8Z" />
    </svg>
  );
}

function playTone(
  contextRef: React.MutableRefObject<AudioContext | null>,
  enabled: boolean,
  kind: "turn" | "capture" | "hit" | "start",
) {
  if (!enabled) return;
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass) return;
  if (!contextRef.current) contextRef.current = new AudioContextClass();
  const context = contextRef.current;
  if (context.state === "suspended") void context.resume();

  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;
  const frequencies = { turn: 260, capture: 560, hit: 105, start: 390 };
  oscillator.type = kind === "hit" ? "sawtooth" : "sine";
  oscillator.frequency.setValueAtTime(frequencies[kind], now);
  if (kind === "capture") oscillator.frequency.exponentialRampToValueAtTime(840, now + 0.12);
  if (kind === "start") oscillator.frequency.exponentialRampToValueAtTime(620, now + 0.14);
  gain.gain.setValueAtTime(kind === "turn" ? 0.025 : 0.055, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + (kind === "hit" ? 0.28 : 0.18));
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + (kind === "hit" ? 0.3 : 0.2));
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const frameRef = useRef<number>(0);
  const phaseRef = useRef<Phase>("menu");
  const colorRef = useRef(PLAYER_COLORS[0]);
  const soundEnabledRef = useRef(true);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gestureOriginRef = useRef({ x: 0, y: 0 });
  const toastTimerRef = useRef<number | null>(null);

  const [phase, setPhase] = useState<Phase>("menu");
  const [selectedColor, setSelectedColor] = useState(PLAYER_COLORS[0]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [score, setScore] = useState(0);
  const [rank, setRank] = useState(1);
  const [kills, setKills] = useState(0);
  const [bestScore, setBestScore] = useState(() => Number(localStorage.getItem("paper-trail-best") ?? 0));
  const [standings, setStandings] = useState<Standing[]>([]);
  const [toast, setToast] = useState("");
  const [showTutorial, setShowTutorial] = useState(false);
  const [gesture, setGesture] = useState<Gesture>(EMPTY_GESTURE);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  const changePhase = useCallback((nextPhase: Phase) => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = window.setTimeout(() => setToast(""), 1200);
  }, []);

  const handleGameEvent = useCallback((event: GameEvent) => {
    if (event.type === "standings") {
      setStandings(event.standings);
      setRank(event.rank);
      setScore(event.percent);
      return;
    }
    if (event.type === "capture") {
      setScore(event.percent);
      showToast(`+${event.amount} tiles`);
      playTone(audioContextRef, soundEnabledRef.current, "capture");
      return;
    }
    if (event.type === "elimination") {
      showToast(`${event.name} was cut off`);
      return;
    }
    setScore(event.percent);
    setKills(event.kills);
    const nextBest = Math.max(event.percent, Number(localStorage.getItem("paper-trail-best") ?? 0));
    localStorage.setItem("paper-trail-best", nextBest.toFixed(2));
    setBestScore(nextBest);
    playTone(audioContextRef, soundEnabledRef.current, "hit");
    changePhase("gameover");
  }, [changePhase, showToast]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const game = createGame(colorRef.current);
    gameRef.current = game;
    resizeGameCanvas(canvas, game);
    setStandings(getStandings(game));

    const resize = () => resizeGameCanvas(canvas, game);
    window.addEventListener("resize", resize);
    let previousTime = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(0.04, Math.max(0, (now - previousTime) / 1000));
      previousTime = now;
      if (phaseRef.current === "playing") {
        const events = stepGame(game, dt, now);
        events.forEach(handleGameEvent);
      }
      renderGame(canvas, game, phaseRef.current === "menu");
      frameRef.current = requestAnimationFrame(frame);
    };
    frameRef.current = requestAnimationFrame(frame);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(frameRef.current);
    };
  }, [handleGameEvent]);

  useEffect(() => {
    colorRef.current = selectedColor;
    if (gameRef.current) setPlayerColor(gameRef.current, selectedColor);
  }, [selectedColor]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    setIsInstalled(standalone);
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const markInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", markInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("appinstalled", markInstalled);
    };
  }, []);

  const steer = useCallback((direction: DirectionName, withSound = true) => {
    const game = gameRef.current;
    if (!game || phaseRef.current !== "playing") return;
    turnPlayer(game, direction);
    if (withSound) playTone(audioContextRef, soundEnabledRef.current, "turn");
  }, []);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      const keyDirections: Record<string, DirectionName | undefined> = {
        ArrowUp: "up",
        w: "up",
        W: "up",
        ArrowDown: "down",
        s: "down",
        S: "down",
        ArrowLeft: "left",
        a: "left",
        A: "left",
        ArrowRight: "right",
        d: "right",
        D: "right",
      };
      const direction = keyDirections[event.key];
      if (direction) {
        event.preventDefault();
        steer(direction);
      }
      if (event.code === "Space" || event.key === "Escape") {
        event.preventDefault();
        if (phaseRef.current === "playing") changePhase("paused");
        else if (phaseRef.current === "paused") changePhase("playing");
      }
    };
    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  }, [changePhase, steer]);

  const startGame = () => {
    const game = gameRef.current;
    if (!game) return;
    resetGame(game, colorRef.current);
    const initialStandings = getStandings(game);
    setStandings(initialStandings);
    setScore(initialStandings.find((standing) => standing.id === 0)?.percent ?? 0);
    setRank(initialStandings.findIndex((standing) => standing.id === 0) + 1);
    setKills(0);
    setToast("");
    setShowTutorial(true);
    window.setTimeout(() => setShowTutorial(false), 2700);
    changePhase("playing");
    playTone(audioContextRef, soundEnabledRef.current, "start");
  };

  const goHome = () => {
    const game = gameRef.current;
    if (game) resetGame(game, colorRef.current);
    changePhase("menu");
  };

  const handleInstall = async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "accepted") setInstallPrompt(null);
      return;
    }
    setShowInstallGuide(true);
  };

  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (phase !== "playing") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureOriginRef.current = { x: event.clientX, y: event.clientY };
    setGesture({
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
    });
  };

  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!gesture.active || phase !== "playing") return;
    const dx = event.clientX - gestureOriginRef.current.x;
    const dy = event.clientY - gestureOriginRef.current.y;
    setGesture((current) => ({ ...current, currentX: event.clientX, currentY: event.clientY }));
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    const direction: DirectionName = Math.abs(dx) > Math.abs(dy)
      ? dx > 0 ? "right" : "left"
      : dy > 0 ? "down" : "up";
    steer(direction);
    gestureOriginRef.current = { x: event.clientX, y: event.clientY };
  };

  const pointerUp = () => setGesture(EMPTY_GESTURE);

  const knobOffset = gesture.active ? {
    x: Math.max(-30, Math.min(30, gesture.currentX - gesture.startX)),
    y: Math.max(-30, Math.min(30, gesture.currentY - gesture.startY)),
  } : { x: 0, y: 0 };

  return (
    <main className="game-shell">
      <canvas ref={canvasRef} className="game-canvas" aria-label="Paper Trail game arena" />
      <div
        className={`game-input-layer ${phase === "playing" ? "game-input-layer--active" : ""}`}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={pointerUp}
      />
      <div className={`screen-vignette ${phase === "menu" ? "screen-vignette--menu" : ""}`} />

      {phase === "menu" && (
        <section className="menu-screen" aria-labelledby="game-title">
          <div className="menu-brand" id="game-title">
            <Logo />
            <p>Leave your mark. Close the loop. Own the arena.</p>
          </div>

          <div className="menu-actions">
            <div className="color-select" aria-label="Choose your trail color">
              {PLAYER_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`color-choice ${selectedColor === color ? "color-choice--selected" : ""}`}
                  style={{ "--choice-color": color } as React.CSSProperties}
                  onClick={() => setSelectedColor(color)}
                  aria-label={`Choose ${color}`}
                  aria-pressed={selectedColor === color}
                />
              ))}
            </div>
            <button type="button" className="play-button" onClick={startGame}>
              <span>PLAY NOW</span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 8 6-8 6V6Z" /></svg>
            </button>
            <p className="control-hint">
              <span className="mobile-only">Swipe anywhere to turn</span>
              <span className="desktop-only">Arrow keys or WASD to turn</span>
            </p>
          </div>

          <div className="menu-footer">
            {!isInstalled && (
              <button type="button" className="install-link" onClick={handleInstall}>
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 17v3h14v-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Install on your phone
              </button>
            )}
            {isInstalled && <span className="offline-label">Installed and ready offline</span>}
            <span>Offline arcade edition</span>
          </div>
        </section>
      )}

      {(phase === "playing" || phase === "paused") && (
        <header className="game-hud">
          <div className="hud-left">
            <Logo compact />
            <div className="territory-score">
              <strong>{score.toFixed(1)}%</strong>
              <span>territory</span>
            </div>
          </div>
          <div className="hud-actions">
            <IconButton
              label={soundEnabled ? "Mute sound" : "Turn sound on"}
              onClick={() => setSoundEnabled((enabled) => !enabled)}
              active={!soundEnabled}
            >
              <SoundIcon muted={!soundEnabled} />
            </IconButton>
            <IconButton label="Pause game" onClick={() => changePhase("paused")}>
              <PauseIcon />
            </IconButton>
          </div>
        </header>
      )}

      {(phase === "playing" || phase === "paused") && (
        <aside className="leaderboard" aria-label="Leaderboard">
          <div className="leaderboard__heading">
            <span>ARENA</span>
            <strong>#{rank}</strong>
          </div>
          {standings.slice(0, 4).map((standing, index) => (
            <div className={`leaderboard__row ${standing.id === 0 ? "leaderboard__row--you" : ""}`} key={standing.id}>
              <span className="leaderboard__rank">{index + 1}</span>
              <i style={{ backgroundColor: standing.color }} />
              <span className="leaderboard__name">{standing.name}</span>
              <strong>{standing.percent.toFixed(1)}</strong>
            </div>
          ))}
        </aside>
      )}

      {phase === "playing" && (
        <div className="direction-pad" aria-label="Direction controls">
          <button type="button" className="direction-button direction-button--up" onPointerDown={(event) => { event.stopPropagation(); steer("up"); }} aria-label="Turn up"><ArrowIcon direction="up" /></button>
          <button type="button" className="direction-button direction-button--left" onPointerDown={(event) => { event.stopPropagation(); steer("left"); }} aria-label="Turn left"><ArrowIcon direction="left" /></button>
          <span className="direction-pad__center" />
          <button type="button" className="direction-button direction-button--right" onPointerDown={(event) => { event.stopPropagation(); steer("right"); }} aria-label="Turn right"><ArrowIcon direction="right" /></button>
          <button type="button" className="direction-button direction-button--down" onPointerDown={(event) => { event.stopPropagation(); steer("down"); }} aria-label="Turn down"><ArrowIcon direction="down" /></button>
        </div>
      )}

      {gesture.active && phase === "playing" && (
        <div className="swipe-indicator" style={{ left: gesture.startX, top: gesture.startY }}>
          <span style={{ transform: `translate(${knobOffset.x}px, ${knobOffset.y}px)` }} />
        </div>
      )}

      {showTutorial && phase === "playing" && (
        <div className="tutorial-callout">
          <span className="tutorial-callout__gesture"><i /><i /><i /></span>
          <strong>Swipe to steer</strong>
          <span>Return to your color to close the loop</span>
        </div>
      )}

      {toast && phase === "playing" && <div className="game-toast">{toast}</div>}

      {phase === "paused" && (
        <section className="modal-layer" aria-labelledby="pause-title">
          <div className="game-dialog">
            <span className="dialog-kicker">Take a breath</span>
            <h2 id="pause-title">PAUSED</h2>
            <p>Your arena is frozen. Jump back in when you are ready.</p>
            <button type="button" className="dialog-primary" onClick={() => changePhase("playing")}>RESUME</button>
            <button type="button" className="dialog-secondary" onClick={goHome}>Exit to menu</button>
          </div>
        </section>
      )}

      {phase === "gameover" && (
        <section className="modal-layer modal-layer--gameover" aria-labelledby="gameover-title">
          <div className="game-dialog game-dialog--result">
            <span className="dialog-kicker">Trail cut</span>
            <h2 id="gameover-title">GAME OVER</h2>
            <div className="result-score">
              <strong>{score.toFixed(1)}%</strong>
              <span>arena claimed</span>
            </div>
            <div className="result-details">
              <span>Best <strong>{bestScore.toFixed(1)}%</strong></span>
              <span>Knockouts <strong>{kills}</strong></span>
            </div>
            <button type="button" className="dialog-primary" onClick={startGame}>PLAY AGAIN</button>
            <button type="button" className="dialog-secondary" onClick={goHome}>Back to menu</button>
          </div>
        </section>
      )}

      {showInstallGuide && (
        <section className="modal-layer modal-layer--install" aria-labelledby="install-title">
          <div className="game-dialog install-dialog">
            <button type="button" className="dialog-close" onClick={() => setShowInstallGuide(false)} aria-label="Close install guide">x</button>
            <span className="install-app-icon"><i /><i /></span>
            <span className="dialog-kicker">Play full screen and offline</span>
            <h2 id="install-title">INSTALL PAPER TRAIL</h2>
            <p><strong>Android Chrome:</strong> open the browser menu and tap <b>Install app</b> or <b>Add to Home screen</b>.</p>
            <p><strong>iPhone Safari:</strong> tap Share, then choose <b>Add to Home Screen</b>.</p>
            <button type="button" className="dialog-primary" onClick={() => setShowInstallGuide(false)}>GOT IT</button>
          </div>
        </section>
      )}
    </main>
  );
}
