import { useCallback, useEffect, useRef, type PointerEvent, type ReactNode } from "react";

interface Props {
  onMove: (dragId: string, targetId: string) => void;
  children: ReactNode;
}

// Cards opt into dragging by rendering a `[data-drag-handle]` control inside a
// `[data-sort-id]` wrapper; the grid only reorders, persistence stays with the
// caller.
export function SortableGrid({ onMove, children }: Props) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: string; pointerId: number; item: HTMLElement } | null>(null);
  const lastTargetRef = useRef<string | null>(null);

  const finish = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.item.removeAttribute("data-dragging");
    if (gridRef.current?.hasPointerCapture(drag.pointerId)) {
      gridRef.current.releasePointerCapture(drag.pointerId);
    }
    dragRef.current = null;
    lastTargetRef.current = null;
  }, []);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const handle = (event.target as Element | null)?.closest("[data-drag-handle]");
    const item = handle?.closest<HTMLElement>("[data-sort-id]");
    const id = item?.getAttribute("data-sort-id");
    if (!item || !id) return;
    event.preventDefault();
    dragRef.current = { id, pointerId: event.pointerId, item };
    lastTargetRef.current = null;
    item.setAttribute("data-dragging", "true");
    gridRef.current?.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const under = document.elementFromPoint(event.clientX, event.clientY);
    const item = under?.closest<HTMLElement>("[data-sort-id]");
    const targetId = item?.getAttribute("data-sort-id") ?? null;
    if (!targetId || targetId === drag.id) {
      lastTargetRef.current = null;
      return;
    }
    if (lastTargetRef.current === targetId) return;
    lastTargetRef.current = targetId;
    onMove(drag.id, targetId);
  };

  useEffect(() => finish, [finish]);

  return (
    <div
      ref={gridRef}
      className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
    >
      {children}
    </div>
  );
}
