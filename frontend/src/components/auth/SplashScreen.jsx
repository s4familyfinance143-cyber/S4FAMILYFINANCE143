import { useEffect, useState } from "react";

/**
 * Architecture splash gate — mirrors desktop QSplashScreen flow:
 * centered framed splash + progress 0→100, then login page.
 * High-contrast mix so brand text + % stay readable on PC and mobile.
 */
export function SplashScreen({ brandTitle = "S4 FAMILY FINANCE 143", hint = "", onDone }) {
  const [progress, setProgress] = useState(0);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    let value = 0;
    let cancelled = false;
    const timer = window.setInterval(() => {
      if (cancelled) return;
      value += 1;
      setProgress(value);
      if (value >= 100) {
        window.clearInterval(timer);
        window.setTimeout(() => {
          if (!cancelled) onDone?.();
        }, 120);
      }
    }, 20);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [onDone]);

  return (
    <div className="splash-root" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
      <div className={`splash-frame${imgFailed ? " splash-frame--fallback" : ""}`}>
        <img
          className="splash-image"
          src="/splash-bg.jpg"
          alt=""
          onError={() => setImgFailed(true)}
        />
        <div className="splash-veil" aria-hidden="true" />
        <div className="splash-copy">
          <p className="splash-eyebrow">S4 Family</p>
          <h1 className="splash-title">{brandTitle}</h1>
          <p className="splash-hint">{hint || "Loading…"}</p>
        </div>
        <div className="splash-progress-wrap">
          <div className="splash-progress-track">
            <div className="splash-progress-chunk" style={{ width: `${progress}%` }} />
          </div>
          <span className="splash-progress-label">{progress}%</span>
        </div>
      </div>
    </div>
  );
}
