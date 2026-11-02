import { cn } from "@/lib/utils";

const ICP = (import.meta.env.VITE_ICP_NUMBER ?? "").trim();

export function SiteFooter({ className }: { className?: string }) {
  return (
    <p className={cn("text-center text-[11px] leading-relaxed text-muted-foreground/70", className)}>
      <span>© {new Date().getFullYear()} Token 余量面板</span>
      {ICP ? (
        <>
          <span aria-hidden className="mx-1.5 text-muted-foreground/40">
            ·
          </span>
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-foreground"
          >
            {ICP}
          </a>
        </>
      ) : null}
    </p>
  );
}
