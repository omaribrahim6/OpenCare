"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MAX_HARDSHIP_NOTE_CHARS } from "@/lib/types";

/** "Request help" with an optional short hardship note (SPEC rev 5 §4). Mock: the note isn't sent anywhere yet. */
export function RequestHelpForm({ amountLabel }: { amountLabel: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        setSending(true);
        // Kept out of the URL on purpose; the real version POSTs it with the grant request.
        router.push("/kiosk/status?new=1");
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
        />
        <small id="hardship-help" className="muted">
          A person reads this. It doesn&apos;t change your place in line. {note.length}/{MAX_HARDSHIP_NOTE_CHARS}
        </small>
      </div>
      <button className="btn block" type="submit" disabled={sending}>
        {sending ? "Sending…" : `Request help with ${amountLabel}`}
      </button>
    </form>
  );
}
