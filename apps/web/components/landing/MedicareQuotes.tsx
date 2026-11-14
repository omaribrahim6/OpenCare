"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const QUOTES = [
  {
    name: "Abdul El-Sayed",
    line: "Medicare for All would address the porous nature of health insurance by guaranteeing universal health insurance coverage from birth.",
    image: "/characters/abdul-el-sayed.webp",
    source: "https://www.help.senate.gov/imo/media/doc/b89fe0f1-9e63-13b1-7746-d56bc2116816/El-Sayed_Medical_Debt_Testimony.pdf",
    sourceLabel: "Senate testimony",
  },
  {
    name: "Alexandria Ocasio-Cortez",
    line: "Every single person who enters Elmhurst Hospital gets treated regardless of their ability to afford care.",
    image: "/characters/alexandria-ocasio-cortez.webp",
    source: "https://docs.house.gov/meetings/GO/GO00/20220329/114542/HHRG-117-GO00-Transcript-20220329.pdf",
    sourceLabel: "House hearing",
  },
  {
    name: "Bernie Sanders",
    line: "We need to understand that health care is a human right and move toward Medicare for All.",
    image: "/characters/bernie-sanders.webp",
    source: "https://www.sanders.senate.gov/press-releases/news-sanders-statement-on-joining-the-senate-finance-committee/",
    sourceLabel: "Senate statement",
  },
] as const;

export function MedicareQuotes() {
  const [selected, setSelected] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setPlaying(!preference.matches);
    sync();
    preference.addEventListener("change", sync);
    return () => preference.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!playing || hovered) return;
    const timer = window.setInterval(() => setSelected((index) => (index + 1) % QUOTES.length), 8500);
    return () => window.clearInterval(timer);
  }, [playing, hovered]);

  return (
    <section
      className="ln-quotes"
      aria-labelledby="ln-quotes-label"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="ln-quotes-header">
        <h2 id="ln-quotes-label">The case for universal care</h2>
        <div className="ln-quotes-controls">
          <button
            type="button"
            aria-label={playing ? "Pause quotes" : "Play quotes"}
            onClick={() => setPlaying((value) => !value)}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              {playing ? <path d="M5 3h2v10H5zm4 0h2v10H9z" /> : <path d="m5 3 8 5-8 5z" />}
            </svg>
          </button>
          <button
            type="button"
            aria-label="Next quote"
            onClick={() => {
              setPlaying(false);
              setSelected((index) => (index + 1) % QUOTES.length);
            }}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 8h10m-4-4 4 4-4 4" />
            </svg>
          </button>
        </div>
      </div>
      <div className="ln-quotes-slides" aria-live={playing ? "off" : "polite"}>
        {QUOTES.map((quote, index) => {
          const active = index === selected;
          return (
            <figure className="ln-quote" key={quote.name} aria-hidden={!active} data-active={active}>
              <div className="ln-quote-portrait">
                <Image src={quote.image} alt="" width={100} height={140} loading="eager" unoptimized />
              </div>
              <blockquote cite={quote.source}>“{quote.line}”</blockquote>
              <figcaption>
                <strong>{quote.name}</strong>
                <a
                  href={quote.source}
                  target="_blank"
                  rel="noreferrer"
                  tabIndex={active ? 0 : -1}
                  onFocus={() => setPlaying(false)}
                >
                  {quote.sourceLabel} ↗
                </a>
              </figcaption>
            </figure>
          );
        })}
      </div>
    </section>
  );
}

