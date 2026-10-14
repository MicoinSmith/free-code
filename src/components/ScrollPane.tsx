import React, { type ReactNode, useCallback, useRef } from 'react';
import {
  computeWheelStep,
  initWheelAccel,
  readScrollSpeedBase,
  scrollUp,
  type WheelAccelState,
} from './ScrollKeybindingHandler.js';
import { useKeybindings } from '../keybindings/useKeybinding.js';
import { Box } from '../ink.js';
import ScrollBox, {
  type ScrollBoxHandle,
} from '../ink/components/ScrollBox.js';
import { isXtermJs } from '../ink/terminal.js';

type BoxProps = React.ComponentProps<typeof Box>;

type Props = {
  /**
   * Explicit viewport height, in rows.
   *
   * MUST be a number, not `maxHeight`/`flexGrow`. This is the only recipe that
   * bounds reliably: a numeric height is absolute — it does not depend on the
   * ancestor flex chain, and it sidesteps Yoga's `minHeight: auto` (which,
   * unlike CSS, `overflow` does NOT reset, so `flexShrink` cannot pull a box
   * below its CONTENT height). With `flexGrow`/`maxHeight` the content grows
   * the box past the screen and the ScrollBox viewport stays equal to its
   * content (maxScroll 0 → nothing scrolls).
   *
   * The caller owns this number because only the caller knows its chrome
   * budget (header/footer rows). Prefer measuring over guessing where a
   * measurement is available.
   */
  height: number;
  /** Handle to the inner ScrollBox. Also used to wire the standard wheel. */
  scrollRef?: React.RefObject<ScrollBoxHandle | null>;
  /**
   * Register the standard mouse-wheel bindings on the `'Scroll'` context
   * (up/down with the shared accel curve). Default true. Set false only when
   * the caller maps wheel to something else (e.g. list navigation).
   */
  wheel?: boolean;
  children: ReactNode;
} & Omit<BoxProps, 'height' | 'flexShrink' | 'overflow'>;

/**
 * A bounded, scrollable region — the single place that encodes both
 * "how to make a scroll area that actually scrolls" AND "how the wheel drives
 * it":
 *
 * - an outer box with an EXPLICIT height + `overflow="hidden"`;
 * - a `ScrollBox` that fills it (`flexGrow=1`, `minHeight=0`);
 * - optional standard wheel bindings (the shared `'Scroll'` engine).
 *
 * Do NOT hand-roll this inline elsewhere — that is exactly how the `/btw`
 * multi-turn overflow bug happened (each surface re-derived the recipe
 * slightly wrong, and each re-implemented the wheel handler).
 */
export function ScrollPane({
  height,
  scrollRef,
  wheel = true,
  children,
  ...rest
}: Props) {
  const wheelAccelRef = useRef<WheelAccelState | null>(null);

  const wheelScroll = useCallback(
    (dir: 1 | -1) => {
      const box = scrollRef?.current;
      // Content fits: nothing to scroll, don't touch the position.
      if (!box || box.getScrollHeight() <= box.getViewportHeight()) return;
      wheelAccelRef.current ??= initWheelAccel(
        isXtermJs(),
        readScrollSpeedBase(),
      );
      const step = computeWheelStep(
        wheelAccelRef.current,
        dir,
        performance.now(),
      );
      if (dir < 0) {
        scrollUp(box, step);
        return;
      }
      const max = Math.max(0, box.getScrollHeight() - box.getViewportHeight());
      // Include pendingDelta — scrollBy accumulates without moving scrollTop,
      // so getScrollTop() alone is stale inside a burst of wheel events.
      if (box.getScrollTop() + box.getPendingDelta() + step >= max) {
        box.scrollToBottom();
        return;
      }
      box.scrollBy(step);
    },
    [scrollRef],
  );

  useKeybindings(
    {
      'scroll:lineUp': () => {
        wheelScroll(-1);
      },
      'scroll:lineDown': () => {
        wheelScroll(1);
      },
    },
    { context: 'Scroll', isActive: wheel },
  );

  return (
    <Box height={height} flexShrink={0} overflow="hidden" {...rest}>
      <ScrollBox
        ref={scrollRef}
        flexDirection="column"
        flexGrow={1}
        minHeight={0}
      >
        {children}
      </ScrollBox>
    </Box>
  );
}
