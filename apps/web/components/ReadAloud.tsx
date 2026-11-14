"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icon";

/** "Read aloud" via the browser's speechSynthesis (SPEC §4). Hidden where unsupported. */
export function ReadAloud({ text, className = "btn btn-lg" }: { text: string; className?: string }) {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    setSupported(typeof window !== "undefined" && "speechSynthesis" in window);
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  if (!supported) return null;

  function toggle() {
    const synth = window.speechSynthesis;
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 0.95;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    synth.cancel();
    synth.speak(u);
    setSpeaking(true);
  }

  return (
    <button type="button" className={className} onClick={toggle} aria-pressed={speaking}>
      <Icon name={speaking ? "stop" : "speaker"} />
      {speaking ? "Stop reading" : "Read aloud"}
    </button>
  );
}
