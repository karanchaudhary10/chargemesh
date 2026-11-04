import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import jsQR from "jsqr";
import { AlertTriangle, Camera, CameraOff, ImagePlus, Keyboard, RefreshCw, ScanLine, Upload, X } from "lucide-react";
import { Alert } from "../components/ui.js";

type ScannerStatus = "starting" | "scanning" | "error" | "decoding";

/**
 * Camera + decoder for the renter's wallet QR.
 *
 * Uses `jsQR` on frames from `getUserMedia`, so it works in Chrome, Safari and
 * Firefox. The uploaded-image and pasted-code paths cover browsers or devices
 * where the camera is unavailable (or the wallet QR is on the same phone).
 */
export function WalletQrScanner({
  onCapture,
  onClose
}: {
  onCapture: (payload: string) => void;
  onClose?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const [status, setStatus] = useState<ScannerStatus>("starting");
  const [error, setError] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualValue, setManualValue] = useState("");

  const stopCamera = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const fail = useCallback(
    (message: string) => {
      stopCamera();
      setStatus("error");
      setError(message);
    },
    [stopCamera]
  );

  const startCamera = useCallback(async () => {
    setError(null);
    setStatus("starting");

    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      fail(
        "This browser does not support camera access. Upload a screenshot of the wallet QR or paste the code instead."
      );
      return;
    }
    if (typeof window !== "undefined" && !window.isSecureContext) {
      fail(
        "The camera needs HTTPS (or localhost). Open ChargeMesh on a secure address, or upload a screenshot of the wallet QR."
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) {
        fail("The camera preview could not start. Please try again.");
        return;
      }
      video.srcObject = stream;
      await video.play();
      if (!mountedRef.current) return;
      setStatus("scanning");

      let lastFrame = 0;
      const tick = (now: number) => {
        if (!mountedRef.current) return;
        frameRef.current = requestAnimationFrame(tick);
        // Roughly six decodes a second keeps the preview smooth on phones.
        if (now - lastFrame < 160) return;
        lastFrame = now;
        decodeVideoFrame();
      };
      frameRef.current = requestAnimationFrame(tick);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        fail(
          "Camera permission was blocked. Allow camera access in your browser settings, then try again — or upload a screenshot of the wallet QR."
        );
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        fail("No camera was found on this device. Upload a screenshot of the wallet QR instead.");
      } else if (name === "NotReadableError") {
        fail("The camera is already in use by another app. Close that app and try again.");
      } else {
        fail("The camera could not be opened. Upload a screenshot of the wallet QR or paste the code.");
      }
    }
  }, [fail]);

  const decodeVideoFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2 || !video.videoWidth) return;

    const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
    const payload = code?.data?.trim();
    if (!payload) return;

    stopCamera();
    onCapture(payload);
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setStatus("decoding");
    setError(null);
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = canvasRef.current ?? document.createElement("canvas");
      const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas unavailable");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
      const payload = code?.data?.trim();
      if (!payload) {
        setStatus("error");
        setError("No wallet QR was found in that image. Try a sharper screenshot or paste the code below.");
        return;
      }
      stopCamera();
      onCapture(payload);
    } catch {
      setStatus("error");
      setError("That image could not be read. Try a PNG or JPEG screenshot of the wallet QR.");
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    void startCamera();
    return () => {
      mountedRef.current = false;
      stopCamera();
    };
    // The scanner owns the camera for as long as it is mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scanning = status === "scanning";
  const busy = status === "starting" || status === "decoding";

  return (
    <div className="space-y-3">
      <div className="relative w-full max-w-sm mx-auto aspect-square rounded-2xl overflow-hidden bg-slate-900 border border-slate-800">
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          aria-label="Camera preview for scanning a wallet QR"
          className={`w-full h-full object-cover transition-opacity ${scanning ? "opacity-100" : "opacity-25"}`}
        />

        {scanning && (
          <>
            <div className="pointer-events-none absolute inset-6 rounded-xl border-2 border-white/70 shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]" />
            <div className="pointer-events-none absolute inset-x-10 top-1/2 h-0.5 bg-blue-400/90 shadow-[0_0_12px_2px_rgba(96,165,250,0.8)] animate-pulse" />
            <span className="absolute left-1/2 -translate-x-1/2 bottom-4 inline-flex items-center gap-1.5 rounded-full bg-slate-900/80 px-3 py-1.5 text-[11px] font-semibold text-white">
              <ScanLine className="w-3.5 h-3.5" />
              Align the wallet QR inside the frame
            </span>
          </>
        )}

        {!scanning && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-white">
            <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center">
              {status === "error" ? (
                <CameraOff className="w-6 h-6" />
              ) : status === "decoding" ? (
                <ImagePlus className="w-6 h-6 animate-pulse" />
              ) : (
                <Camera className="w-6 h-6 animate-pulse" />
              )}
            </div>
            <p className="text-xs font-semibold">
              {status === "starting"
                ? "Starting the camera…"
                : status === "decoding"
                  ? "Reading the image…"
                  : "Camera is off"}
            </p>
            {status === "starting" && (
              <p className="text-[11px] text-slate-300">Allow camera access when your browser asks.</p>
            )}
          </div>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />

      {error && (
        <Alert kind="error">
          <span className="flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
            {error}
          </span>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2">
        {scanning ? (
          <button
            type="button"
            onClick={() => {
              stopCamera();
              setStatus("error");
              setError(null);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-semibold text-slate-700"
          >
            <X className="w-3.5 h-3.5" />
            Stop camera
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void startCamera()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-60 text-[11px] font-semibold text-slate-700"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
            {status === "error" ? "Try camera again" : "Start camera"}
          </button>
        )}

        <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-semibold text-slate-700 cursor-pointer">
          <Upload className="w-3.5 h-3.5" />
          Upload QR image
          <input type="file" accept="image/*" onChange={(event) => void handleUpload(event)} className="sr-only" />
        </label>

        <button
          type="button"
          onClick={() => setManualOpen((open) => !open)}
          aria-expanded={manualOpen}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-semibold text-slate-700"
        >
          <Keyboard className="w-3.5 h-3.5" />
          Paste code
        </button>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-transparent hover:bg-slate-100 text-[11px] font-semibold text-slate-500"
          >
            Cancel
          </button>
        )}
      </div>

      {manualOpen && (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <label htmlFor="wallet-qr-code" className="block text-[11px] font-semibold text-slate-700">
            Paste the wallet QR contents
          </label>
          <textarea
            id="wallet-qr-code"
            rows={3}
            maxLength={4096}
            value={manualValue}
            onChange={(event) => setManualValue(event.target.value)}
            placeholder="For example: fonepay://pay?pa=98XXXXXXXX&am=2400"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            disabled={!manualValue.trim()}
            onClick={() => {
              const payload = manualValue.trim();
              if (!payload) return;
              stopCamera();
              onCapture(payload);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white text-[11px] font-semibold"
          >
            Use this code
          </button>
        </div>
      )}

      <p className="text-[11px] text-slate-500 text-center leading-relaxed">
        The wallet QR can be on another phone, a printed slip, or a screenshot. Nothing leaves your
        device until you confirm the payment.
      </p>
    </div>
  );
}
