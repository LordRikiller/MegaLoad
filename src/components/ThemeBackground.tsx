import { useEffect, useRef } from "react";
import { ThemeEngine } from "../theme/engine";
import { resolvePalette, resolveAnim, type ThemePrefs } from "../theme/apply";
import { useThemeStore } from "../stores/themeStore";

// The ambient biome backdrop: a single fixed, full-viewport canvas that sits
// behind the whole app. Glass panels are translucent, so the biome gradient +
// animation reads through them. Motion pauses when the window is hidden
// (minimised) so it never steals frames from a fullscreen game; it keeps
// running when the window is merely unfocused.

function configureFromStore(eng: ThemeEngine) {
  const st = useThemeStore.getState();
  const prefs: ThemePrefs = {
    theme: st.theme,
    palette: st.palette,
    anim: st.anim,
    motion: st.motion,
    intensity: st.intensity,
    sync: st.sync,
  };
  const pal = resolvePalette(prefs);
  const anim = st.motion ? resolveAnim(prefs) : null;
  eng.configure(pal, anim, st.intensity);
  // Only run the rAF loop when there's actually something moving. The default
  // theme's "None" animation (and motion-off) is a static gradient, so we paint
  // one frame and idle rather than redrawing an unchanging gradient at 60fps.
  const animating = st.motion && !!anim && anim.layers.length > 0 && !document.hidden;
  if (animating) {
    eng.start();
  } else {
    eng.stop();
    eng.step(0);
  }
}

export function ThemeBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<ThemeEngine | null>(null);

  const theme = useThemeStore((s) => s.theme);
  const palette = useThemeStore((s) => s.palette);
  const anim = useThemeStore((s) => s.anim);
  const motion = useThemeStore((s) => s.motion);
  const intensity = useThemeStore((s) => s.intensity);

  // Create the engine once and wire resize + visibility handling.
  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const eng = new ThemeEngine(cvs);
    engineRef.current = eng;
    eng.resize();
    configureFromStore(eng);

    let ro: ResizeObserver | null = null;
    const onResize = () => {
      eng.resize();
      configureFromStore(eng);
    };
    try {
      ro = new ResizeObserver(onResize);
      ro.observe(cvs);
    } catch {
      window.addEventListener("resize", onResize);
    }

    const onVis = () => {
      if (document.hidden) eng.stop();
      else configureFromStore(eng);
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVis);
      eng.stop();
      engineRef.current = null;
    };
  }, []);

  // Reconfigure whenever the selection changes.
  useEffect(() => {
    const eng = engineRef.current;
    if (eng) configureFromStore(eng);
  }, [theme, palette, anim, motion, intensity]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full z-0 pointer-events-none"
      aria-hidden="true"
    />
  );
}
