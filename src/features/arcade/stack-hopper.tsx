import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Gamepad2, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  BEST_SCORE_KEY,
  FIXED_STEP,
  GAME_HEIGHT,
  GAME_WIDTH,
  MAX_FRAME_TIME,
  RENDER_SCALE,
} from "./stack-hopper-config";
import {
  type GamePhase,
  advanceGame,
  boost,
  createGameState,
  finishGame,
} from "./stack-hopper-engine";
import {
  createStackHopperScene,
  disposeStackHopperScene,
  renderStackHopperScene,
} from "./stack-hopper-scene";

type GameActions = { start: () => void; boost: () => void; pause: () => void };
const EMPTY_ACTIONS: GameActions = { start: () => {}, boost: () => {}, pause: () => {} };

function readBestScore() {
  try {
    const value = Number(localStorage.getItem(BEST_SCORE_KEY));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

function saveBestScore(score: number) {
  try {
    localStorage.setItem(BEST_SCORE_KEY, String(score));
  } catch {
    // The game remains playable when storage is unavailable.
  }
}

function GameCanvas({ open }: { open: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const actions = useRef<GameActions>(EMPTY_ACTIONS);
  const [phase, setPhase] = useState<GamePhase>("ready");
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);

  useEffect(() => setBest(readBestScore()), []);

  useEffect(() => {
    if (!open || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const view = createStackHopperScene(canvas);
    let game = createGameState();
    let frame = 0;
    let previousTime = performance.now();
    let accumulator = 0;
    let audioContext: AudioContext | null = null;

    const playBoostSound = () => {
      audioContext ??= new AudioContext();
      const context = audioContext;
      const play = () => {
        if (context.state === "closed") return;
        const now = context.currentTime;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "square";
        oscillator.frequency.setValueAtTime(240, now);
        oscillator.frequency.exponentialRampToValueAtTime(520, now + 0.075);
        gain.gain.setValueAtTime(0.035, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.095);
      };
      if (context.state === "suspended") void context.resume().then(play).catch(() => {});
      else play();
    };

    const changePhase = (next: GamePhase) => {
      game.phase = next;
      setPhase(next);
    };
    const focusCanvas = () => requestAnimationFrame(() => canvas.focus({ preventScroll: true }));
    const endRun = () => {
      if (game.phase !== "running") return;
      finishGame(game);
      setPhase("over");
      setBest((current) => {
        const next = Math.max(current, game.score);
        saveBestScore(next);
        return next;
      });
    };
    const start = () => {
      game = createGameState("running");
      accumulator = 0;
      setScore(0);
      setPhase("running");
      playBoostSound();
      focusCanvas();
    };
    const doBoost = () => {
      if (game.phase === "ready" || game.phase === "over") {
        start();
        return;
      }
      if (game.phase === "paused") changePhase("running");
      else {
        boost(game);
        playBoostSound();
      }
    };
    const pause = () => {
      if (game.phase === "running") changePhase("paused");
      else if (game.phase === "paused") changePhase("running");
      focusCanvas();
    };
    actions.current = { start, boost: doBoost, pause };
    focusCanvas();

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ([" ", "arrowup", "w", "p"].includes(key)) event.preventDefault();
      if (event.repeat) return;
      if ([" ", "arrowup", "w"].includes(key)) doBoost();
      else if (key === "p") pause();
    };
    const onBlur = () => {
      if (game.phase === "running") changePhase("paused");
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", onBlur);

    const loop = (now: number) => {
      const frameTime = Math.min(MAX_FRAME_TIME, Math.max(0, (now - previousTime) / 1000));
      previousTime = now;
      accumulator += frameTime;
      while (accumulator >= FIXED_STEP) {
        const events = advanceGame(game, FIXED_STEP);
        accumulator -= FIXED_STEP;
        if (events.scored) setScore(game.score);
        if (events.finished) {
          endRun();
          accumulator = 0;
          break;
        }
      }
      renderStackHopperScene(view, game);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      actions.current = EMPTY_ACTIONS;
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", onBlur);
      disposeStackHopperScene(view);
      if (audioContext) void audioContext.close();
    };
  }, [open]);

  const actionLabel =
    phase === "ready"
      ? "Start"
      : phase === "over"
        ? "Again"
        : phase === "paused"
          ? "Resume"
          : "Pause";

  return (
    <div className="stack-hopper-shell">
      <div className="stack-hopper-screen">
        <canvas
          ref={canvasRef}
          width={GAME_WIDTH * RENDER_SCALE}
          height={GAME_HEIGHT * RENDER_SCALE}
          tabIndex={0}
          className="stack-hopper-canvas"
          aria-label="Stack Hopper 94. Press Space, W, or the up arrow to boost between the rock formations."
          onPointerDown={() => actions.current.boost()}
        />
        <div className="stack-hopper-hud" aria-live="polite">
          <span>
            Score <b className="tnum">{score.toString().padStart(2, "0")}</b>
          </span>
          <span>
            Best <b className="tnum">{best.toString().padStart(2, "0")}</b>
          </span>
        </div>
        {phase !== "running" ? (
          <div className={`stack-hopper-message ${phase}`}>
            <strong>
              {phase === "over" ? "Stack down" : phase === "paused" ? "Paused" : "Stack Hopper ’94"}
            </strong>
            <p>
              {phase === "over"
                ? `${score} passages`
                : phase === "paused"
                  ? "Press P to continue"
                  : "Space or ↑ to fly"}
            </p>
          </div>
        ) : null}
        <div className="stack-hopper-controls">
          <span className="stack-hopper-shortcut">
            <kbd>Space</kbd>
            <span>/</span>
            <kbd>↑</kbd>
            <em>boost</em>
          </span>
          <Button
            size="sm"
            variant={phase === "running" ? "ghost" : "default"}
            className={phase === "running" ? "stack-hopper-action is-running" : "stack-hopper-action"}
            onClick={() =>
              phase === "ready" || phase === "over"
                ? actions.current.start()
                : actions.current.pause()
            }
          >
            {phase === "over" ? <RotateCcw /> : phase === "running" ? <Pause /> : <Play />}
            {actionLabel}
          </Button>
          <span className="stack-hopper-shortcut stack-hopper-exit-shortcut">
            <kbd>Esc</kbd>
            <em>exit</em>
          </span>
        </div>
      </div>
    </div>
  );
}

export function StackHopperArcade() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="stack-hopper-launcher">
        <Gamepad2 aria-hidden />
        <div>
          <p>Stack Hopper ’94</p>
          <span>A one-button flight through a layered Canvas world.</span>
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          Insert coin
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup
          className="stack-hopper-dialog"
          bottomStickOnMobile={false}
          showCloseButton={false}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Stack Hopper ’94</DialogTitle>
            <DialogDescription className="sr-only">
              Press Space, W, or the up arrow to fly between the rock formations.
            </DialogDescription>
          </DialogHeader>
          <GameCanvas open={open} />
        </DialogPopup>
      </Dialog>
    </>
  );
}
