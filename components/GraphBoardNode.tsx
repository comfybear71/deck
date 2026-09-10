"use client";

import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { NodePosition } from "@/lib/graphLayout";
import { clamp } from "@/lib/graphLayout";

interface GraphBoardNodeProps {
  position: NodePosition;
  width: number;
  zIndex: number;
  containerRef: RefObject<HTMLDivElement | null>;
  isDragging: boolean;
  onActivate: () => void;
  onDragStart: () => void;
  onDragMove: (pos: NodePosition) => void;
  onDragEnd: (pos: NodePosition) => void;
  children: React.ReactNode;
}

interface DragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  nodeHeightPx: number;
  moved: boolean;
}

/** Pointer must move at least this many CSS px before a press counts as a
 * drag instead of a tap — small enough to feel responsive, big enough that
 * a finger/stylus tap on iPad Safari doesn't accidentally nudge a node. */
const DRAG_THRESHOLD_PX = 6;

/**
 * One draggable node on the GraphBoard canvas (see components/GraphBoard.tsx).
 * Absolutely positioned by percentage of the canvas, dragged with Pointer
 * Events (works for mouse, touch, and Apple Pencil alike — including
 * iPadOS Safari) and a movement threshold so a plain tap still falls
 * through to the wrapped node card's own `onClick` (which opens its detail
 * sheet) instead of being swallowed by the drag handler.
 *
 * Deliberately does NOT use `setPointerCapture`: capturing the pointer on
 * this wrapper `<div>` retargets every subsequent pointer *and* the
 * resulting synthetic mouse `click` event to the capturing element — since
 * the wrapper is an *ancestor* of the actual `<button>` card, that click
 * would never reach the button's own `onClick` (DOM events only bubble
 * from the target up through ancestors, not back down into descendants),
 * so taps would silently stop opening detail sheets the moment dragging
 * was wired up. Tracking the drag via `window`-level listeners (attached
 * on pointerdown, removed on pointerup/cancel) gets the same "keep
 * tracking the pointer outside the node's bounds" behavior without ever
 * touching the native click target.
 *
 * The drag-vs-tap split: pointerdown arms a `dragRef` and attaches the
 * window listeners; pointermove only starts actually moving the node once
 * it clears `DRAG_THRESHOLD_PX`, at which point it also flips
 * `suppressClickRef` so the *next* click event (fired by the browser right
 * after pointerup) gets caught and cancelled in the capture phase.
 */
export function GraphBoardNode({
  position,
  width,
  zIndex,
  containerRef,
  isDragging,
  onActivate,
  onDragStart,
  onDragMove,
  onDragEnd,
  children,
}: GraphBoardNodeProps) {
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Belt-and-braces: if this node unmounts mid-drag (shouldn't normally
  // happen — the node list is static — but defends against it anyway),
  // don't leak the window listeners.
  useEffect(() => () => cleanupRef.current?.(), []);

  const computeNextPosition = useCallback(
    (drag: DragState, clientX: number, clientY: number): NodePosition => {
      const container = containerRef.current;
      if (!container) return { x: drag.startX, y: drag.startY };
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return { x: drag.startX, y: drag.startY };
      }
      const dx = clientX - drag.startClientX;
      const dy = clientY - drag.startClientY;
      const widthPct = (width / rect.width) * 100;
      const heightPct = (drag.nodeHeightPx / rect.height) * 100;
      return {
        x: clamp(drag.startX + (dx / rect.width) * 100, 0, Math.max(0, 100 - widthPct)),
        y: clamp(drag.startY + (dy / rect.height) * 100, 0, Math.max(0, 100 - heightPct)),
      };
    },
    [containerRef, width]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (!containerRef.current) return;

      // Bring to front on any press (tap or drag) — on a freeform board,
      // overlapping nodes are expected, and the one you just touched
      // should never end up stuck behind another node's z-order.
      onActivate();

      const drag: DragState = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startX: position.x,
        startY: position.y,
        nodeHeightPx: e.currentTarget.getBoundingClientRect().height,
        moved: false,
      };
      dragRef.current = drag;

      const handleWindowMove = (ev: PointerEvent) => {
        if (ev.pointerId !== drag.pointerId) return;
        const dx = ev.clientX - drag.startClientX;
        const dy = ev.clientY - drag.startClientY;
        if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

        if (!drag.moved) {
          drag.moved = true;
          suppressClickRef.current = true;
          onDragStart();
        }
        ev.preventDefault();
        onDragMove(computeNextPosition(drag, ev.clientX, ev.clientY));
      };

      const handleWindowUp = (ev: PointerEvent) => {
        if (ev.pointerId !== drag.pointerId) return;
        cleanupRef.current?.();
        cleanupRef.current = null;
        if (drag.moved) {
          onDragEnd(computeNextPosition(drag, ev.clientX, ev.clientY));
        }
        dragRef.current = null;
      };

      window.addEventListener("pointermove", handleWindowMove);
      window.addEventListener("pointerup", handleWindowUp);
      window.addEventListener("pointercancel", handleWindowUp);
      cleanupRef.current = () => {
        window.removeEventListener("pointermove", handleWindowMove);
        window.removeEventListener("pointerup", handleWindowUp);
        window.removeEventListener("pointercancel", handleWindowUp);
      };
    },
    [
      containerRef,
      computeNextPosition,
      onActivate,
      onDragEnd,
      onDragMove,
      onDragStart,
      position.x,
      position.y,
    ]
  );

  const handleClickCapture = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  return (
    <div
      onPointerDown={handlePointerDown}
      onClickCapture={handleClickCapture}
      className={[
        "absolute touch-none select-none",
        isDragging ? "cursor-grabbing" : "cursor-grab",
      ].join(" ")}
      style={{
        left: `${position.x}%`,
        top: `${position.y}%`,
        width: `${width}px`,
        zIndex: isDragging ? 9999 : zIndex,
      }}
    >
      <div
        className={[
          "transition-[transform,filter] duration-150",
          isDragging
            ? "scale-[1.03] drop-shadow-[0_18px_40px_rgba(0,0,0,0.55)]"
            : "scale-100",
        ].join(" ")}
      >
        {children}
      </div>
    </div>
  );
}
