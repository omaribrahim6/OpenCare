// Web NFC (Android Chrome only) as a "something was tapped" sensor for the kiosk charge.
// A bank card or a phone wallet isn't an NDEF tag, so Chrome fires "readingerror" for it; a
// sticker or NFC tag fires "reading". Either one counts as the tap. Nothing from the tag is read
// or kept: the handlers never look at the event. iOS Safari has no Web NFC, so the caller keeps
// hold-to-tap as the fallback. scan() needs HTTPS and must start from a user gesture.

type NdefReader = EventTarget & {
  scan(options?: { signal?: AbortSignal }): Promise<void>;
  onreading: ((event: Event) => void) | null;
  onreadingerror: ((event: Event) => void) | null;
};
type NdefReaderClass = new () => NdefReader;

function readerClass(): NdefReaderClass | null {
  if (typeof window === "undefined" || !window.isSecureContext) return null;
  return ((window as unknown as { NDEFReader?: NdefReaderClass }).NDEFReader) ?? null;
}

/** True where Web NFC exists (Android Chrome over HTTPS). */
export const hasWebNfc = () => readerClass() !== null;

export type NfcWatch = {
  /** Resolves once scanning is on, or rejects (permission denied, NFC off, no gesture). */
  ready: Promise<void>;
  stop: () => void;
};

/**
 * Starts listening for a tap. Call it from a click handler. `onTap` fires at most once, then the
 * scan stops. Returns null where Web NFC isn't available.
 */
export function watchForTap(onTap: () => void): NfcWatch | null {
  const Reader = readerClass();
  if (!Reader) return null;
  const abort = new AbortController();
  let fired = false;
  const stop = () => abort.abort();
  const tapped = () => {
    if (fired || abort.signal.aborted) return;
    fired = true;
    stop();
    onTap();
  };
  let reader: NdefReader;
  try {
    reader = new Reader();
  } catch (error) {
    return { ready: Promise.reject(error), stop };
  }
  reader.onreading = tapped;
  reader.onreadingerror = tapped;
  return { ready: reader.scan({ signal: abort.signal }), stop };
}
