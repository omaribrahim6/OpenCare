"use client";

import { useState } from "react";
import { isNoSession, requestHelp } from "@/lib/api";
import { usd } from "@/lib/format";
import { MAX_HARDSHIP_NOTE_CHARS } from "@/lib/types";

/** Ask the community care fund for the remaining balance, with an optional note (never scored). */
export function RequestHelpForm({
  visitId,
  remainingCents,
  onSent,
}: {
  visitId: string;
  remainingCents: number;
  onSent: () => void;
}) {
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        if (sending) return;
        setSending(true);
        setError(null);
        try {
          // The note goes in the request body only, never the URL.
          await requestHelp({ visitId, hardshipNote: note.trim() || undefined });
          onSent();
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
      <details className="patient-note">
        <summary>Add an optional note</summary>
        <label htmlFor="hardship">Anything you’d like the reviewer to know?</label>
        <textarea
          id="hardship"
          rows={3}
          maxLength={MAX_HARDSHIP_NOTE_CHARS}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={sending}
        />
      </details>
      {error && (
        <p role="alert" className="badge bad">
          {error}
        </p>
      )}
      <button className="btn block" type="submit" disabled={sending}>
        {sending ? "Sending…" : `Request help with ${usd(remainingCents)}`}
      </button>
    </form>
  );
}
