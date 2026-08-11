import { useEffect, useRef, useState } from "react";

export function GroceryBarcodeCamera({ open, onClose, onScanned, t }) {
  const [error, setError] = useState("");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const lockedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      lockedRef.current = false;
      setError("");
      stopCamera();
      return;
    }
    lockedRef.current = false;
    void startCamera();
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleCode(code) {
    const value = String(code || "").trim();
    if (!value || lockedRef.current) return;
    lockedRef.current = true;
    onScanned?.(value);
    onClose?.();
    stopCamera();
  }

  function stopCamera() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  async function startCamera() {
    setError("");
    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        setError(t?.("cameraUnavailable") || "Camera API unavailable in this browser.");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      await new Promise((resolve) => setTimeout(resolve, 50));
      const video = videoRef.current;
      if (!video) {
        setError(t?.("videoMissing") || "Video element missing.");
        return;
      }
      video.srcObject = stream;
      await video.play();

      const Detector = window.BarcodeDetector;
      if (!Detector) {
        setError(
          t?.("barcodeDetectorUnsupported") ||
            "BarcodeDetector not supported — type the barcode manually."
        );
        return;
      }
      const detector = new Detector({
        formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "qr_code"],
      });
      timerRef.current = window.setInterval(async () => {
        try {
          if (!videoRef.current || lockedRef.current) return;
          const codes = await detector.detect(videoRef.current);
          const raw = codes?.[0]?.rawValue;
          if (raw) handleCode(String(raw));
        } catch {
          // keep scanning
        }
      }, 400);
    } catch (err) {
      setError(err instanceof Error ? err.message : t?.("cameraPermissionDenied") || "Camera permission denied");
    }
  }

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t?.("cameraBarcodeScan") || "Camera barcode scan"}
    >
      <div
        style={{
          width: "min(480px, 100%)",
          background: "#06130f",
          borderRadius: 16,
          border: "1px solid #1c3b32",
          padding: 16,
          color: "#fff",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <strong style={{ fontSize: 18 }}>{t?.("cameraBarcodeScan") || "Camera barcode scan"}</strong>
          <button type="button" className="btn" onClick={() => { stopCamera(); onClose?.(); }}>
            {t?.("close") || "Close"}
          </button>
        </div>
        <div
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: "4 / 3",
            borderRadius: 12,
            overflow: "hidden",
            background: "#000",
            border: "1px solid #1c3b32",
          }}
        >
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>
        <p style={{ color: "#9bb9ae", textAlign: "center", marginTop: 12, fontWeight: 700 }}>
          {error || t?.("pointAtBarcode") || "Point the camera at a barcode"}
        </p>
      </div>
    </div>
  );
}
