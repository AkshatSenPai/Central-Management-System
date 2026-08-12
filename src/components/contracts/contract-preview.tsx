"use client";

import { useEffect, useRef, useState } from "react";

/** A4 at 96dpi, which is the size the document lays itself out at: 210mm and
 * 297mm converted at 25.4mm to the inch. The templates size everything in
 * millimetres, so the frame has to be given these pixel dimensions and then
 * scaled — sizing the frame to the container instead does nothing, because a
 * document measured in mm does not reflow to fit its viewport. */
const A4_WIDTH = 794;
const A4_HEIGHT = 1123;

/** The contract, shown at whatever scale fits.
 *
 * At desktop widths the card is a little under A4 and this renders 1:1, which
 * is what it always did. At 375px it used to render 1:1 as well — so a phone
 * showed the top-left corner of the cover and clipped the rest, with no way
 * to reach the remainder except scrolling inside a frame most people would
 * not realise was scrollable.
 *
 * `transform: scale()` rather than resizing the frame, because the document's
 * layout is fixed in millimetres. Scaling shrinks the rendered result; it
 * does not ask the document to be narrower, which it cannot be.
 *
 * Never scales *up*. `Math.min(1, …)` keeps a wide card at 1:1 rather than
 * blowing a 794px document up to fill it, which would soften every glyph for
 * no gain.
 *
 * The wrapper's height tracks the scaled height, so the card closes just
 * under the document instead of leaving 1123px of empty box beneath a
 * shrunken page. */
export function ContractPreview({
  src,
  title,
  frameId,
}: {
  src: string;
  title: string;
  frameId: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    // ResizeObserver rather than a window resize listener: the card also
    // changes width when the sidebar collapses, which fires no window event.
    const observer = new ResizeObserver(() => {
      setScale(Math.min(1, el.clientWidth / A4_WIDTH));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={wrap}
      className="w-full overflow-hidden"
      style={{ height: Math.round(A4_HEIGHT * scale) }}
    >
      <iframe
        id={frameId}
        src={src}
        title={title}
        // `origin-top-left` matters: the default origin is the centre, which
        // would scale the page towards the middle of the box and leave it
        // offset by half the difference on both axes.
        className="origin-top-left rounded-md border border-[var(--border)] bg-[var(--surface)]"
        style={{ width: A4_WIDTH, height: A4_HEIGHT, transform: `scale(${scale})` }}
      />
    </div>
  );
}
