"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createGrant, isNoSession } from "@/lib/api";
import { formatCents } from "@/lib/mock";
import { MAX_HARDSHIP_NOTE_CHARS } from "@/lib/types";

/** "Request help" with an optional short hardship note (SPEC rev 5 §4): POST /api/grants. */
export function RequestHelpForm({
  documentId,
  providerId,
  requestedCents,
}: {
  documentId: string;
  providerId: string;
  requestedCents: number;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (sending || !providerId) return;
        setSending(true);
        setError(null);
        try {
          const trimmed = note.trim();
          await createGrant({ documentId, providerId, requestedCents, hardshipNote: trimmed || undefined });
          // The note goes in the request body only, never the URL.
          router.push("/kiosk/status?new=1");
        } catch (err) {
          setError(
            isNoSession(err)
              ? "Your session has ended. Please tap your CareCard again."
              : err instanceof Error
                ? err.message
                : "We couldn't send your request. Please try again.",
          );
          setSending(false);
        }
      }}
    >
      <div>
        <label htmlFor="hardship">Anything you&apos;d like the caseworker to know? (optional)</label>
        <textarea
          id="hardship"
          rows={3}
          maxLength={MAX_HARDSHIP_NOTE_CHARS}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-describedby="hardship-help"
          disabled={sending}
        />
        <small id="hardship-help" className="muted">
          A person reads this. It doesn&apos;t change your place in line. {note.length}/{MAX_HARDSHIP_NOTE_CHARS}
        </small>
      </div>
      {error && (
        <p role="alert" className="badge bad">
          {error}
        </p>
      )}
      <button className="btn block" type="submit" disabled={sending || !providerId}>
        {sending ? "Sending…" : `Request help with ${formatCents(requestedCents)}`}
      </button>
    </form>
  );
}
