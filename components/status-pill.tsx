import { cn } from "@/lib/utils";
import { LEVEL_DOT, LEVEL_LABEL, LEVEL_STYLE, type Level } from "@/lib/status";

export function StatusPill({ level }: { level: Level }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none",
        LEVEL_STYLE[level],
      )}
    >
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", LEVEL_DOT[level], level === "ok" && "animate-pulse")}
      />
      {LEVEL_LABEL[level]}
    </span>
  );
}
