"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { KioskSession } from "@/components/KioskSession";
import { extractDocument } from "@/lib/mock";
import type { ExtractedFields } from "@/lib/types";

type Phase = "camera" | "extracting" | "review";

// Screen 3: Capture / review. Camera first, file upload as fallback (SPEC §3 P0).
export default function CaptureReview() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>("camera");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [fields, setFields] = useState<ExtractedFields | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (phase !== "camera") return;
    let cancelled = false;
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment" }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        streamRef.current = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(() => setCameraError("We couldn't open the camera. You can upload a photo instead."));
    if (!navigator.mediaDevices) setCameraError("This browser can't use the camera. Upload a photo instead.");
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [phase]);

  async function runExtraction(url: string) {
    setImageUrl(url);
    setPhase("extracting");
    setFields(await extractDocument());
    setPhase("review");
  }

  function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")?.drawImage(v, 0, 0);
    runExtraction(c.toDataURL("image/jpeg", 0.85));
  }

  function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) runExtraction(URL.createObjectURL(f));
  }

  function retake() {
    setImageUrl(null);
    setFields(null);
    setConfirmed(false);
    setPhase("camera");
  }

  return (
    <KioskSession step={2}>
      {phase === "camera" && (
        <>
          <h1>Take a photo of your bill</h1>
          <p className="muted">Lay it flat in good light so all the text is visible.</p>
          <div className="doc-preview">
            {cameraError ? <p style={{ padding: 16 }}>{cameraError}</p> : <video ref={videoRef} autoPlay playsInline muted />}
          </div>
          <div className="stack" style={{ marginTop: 16 }}>
            {!cameraError && (
              <button className="btn block" onClick={capture}>
                Take photo
              </button>
            )}
            <label className="btn secondary block" style={{ margin: 0 }}>
              Upload a photo instead
              <input type="file" accept="image/*" onChange={upload} className="sr-only" />
            </label>
          </div>
        </>
      )}

      {phase === "extracting" && (
        <div role="status" aria-live="polite" className="card" style={{ textAlign: "center" }}>
          <h1>Reading your bill…</h1>
          <p className="muted">This takes a few seconds.</p>
        </div>
      )}

      {phase === "review" && fields && (
        <>
          <h1>Check what we read</h1>
          <p className="muted">Fix anything that&apos;s wrong. Blank means we couldn&apos;t find it.</p>
          <div className="grid2">
            <div className="doc-preview">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {imageUrl ? <img src={imageUrl} alt="Your bill" /> : "Bill image"}
            </div>
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                router.push("/kiosk/explain");
              }}
            >
              <Field id="provider" label="Provider" value={fields.provider.value} evidence={fields.provider.evidence} />
              <Field id="type" label="Type of document" value={fields.documentType.value} evidence={fields.documentType.evidence} />
              <Field
                id="total"
                label="Amount you owe (USD)"
                value={fields.totalCents.value == null ? null : (fields.totalCents.value / 100).toFixed(2)}
                evidence={fields.totalCents.evidence}
                inputMode="decimal"
              />
              <Field id="date" label="Date" value={fields.date.value} evidence={fields.date.evidence} type="date" />
              <label className="row" style={{ fontWeight: 400, gap: 10 }}>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  style={{ width: 28, minHeight: 28 }}
                />
                I checked these details and they match my bill.
              </label>
              <button className="btn block" type="submit" disabled={!confirmed}>
                Continue
              </button>
              <button className="btn secondary block" type="button" onClick={retake}>
                Retake photo
              </button>
            </form>
          </div>
        </>
      )}
    </KioskSession>
  );
}

function Field({
  id,
  label,
  value,
  evidence,
  type = "text",
  inputMode,
}: {
  id: string;
  label: string;
  value: string | null;
  evidence?: string;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
}) {
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <input id={id} name={id} type={type} inputMode={inputMode} defaultValue={value ?? ""} placeholder="Not found" />
      <small className="muted">{evidence ? `From the bill: “${evidence}”` : "Not found on the bill"}</small>
    </div>
  );
}
