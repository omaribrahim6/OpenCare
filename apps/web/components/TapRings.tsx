import { Icon } from "./Icon";

/** Contactless prompt. Decorative: always pair it with visible text. */
export function TapRings({ size = 200 }: { size?: number }) {
  return (
    <div className="rings" style={{ "--size": `${size}px` } as React.CSSProperties} aria-hidden="true">
      <span />
      <span />
      <span />
      <Icon name="tap" strokeWidth={1.6} />
    </div>
  );
}
