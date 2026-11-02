import type { ReactNode } from "react";
import type { Currency } from "@/lib/platforms";
import { currencySymbol, formatAmount, formatClock, relativeTime } from "@/lib/format";

interface Props {
  cnyTotal: number;
  usdTotal: number;
  cnyCount: number;
  usdCount: number;
  connected: number;
  platformCount: number;
  alerts: number;
  fetchedAt: string;
  now: number;
}

function Money({ amount, currency }: { amount: number; currency: Currency }) {
  return (
    <>
      <span className="mr-1 text-base font-normal text-muted-foreground">
        {currencySymbol(currency)}
      </span>
      {formatAmount(amount)}
    </>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint: string;
  tone?: "default" | "warn" | "good" | "muted";
}) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`mt-2 flex items-baseline font-mono text-[30px] font-semibold leading-none tracking-tight tabular-nums ${
          tone === "warn"
            ? "text-warning"
            : tone === "good"
            ? "text-success"
            : tone === "muted"
            ? "text-muted-foreground/60"
            : "text-foreground"
        }`}
      >
        {value}
      </dd>
      <p className="mt-2 text-[11px] text-muted-foreground/80">{hint}</p>
    </div>
  );
}

export function SummaryBar({
  cnyTotal,
  usdTotal,
  cnyCount,
  usdCount,
  connected,
  platformCount,
  alerts,
  fetchedAt,
  now,
}: Props) {
  return (
    <dl className="flex flex-wrap gap-x-12 gap-y-6 px-1 py-2">
      <Stat
        label="人民币余额"
        value={cnyCount > 0 ? <Money amount={cnyTotal} currency="CNY" /> : "—"}
        hint={cnyCount > 0 ? `${cnyCount} 个余额账号` : "暂无可用数据"}
        tone={cnyCount > 0 ? "default" : "muted"}
      />
      <Stat
        label="美元余额"
        value={usdCount > 0 ? <Money amount={usdTotal} currency="USD" /> : "—"}
        hint={usdCount > 0 ? `${usdCount} 个余额账号` : "暂无可用数据"}
        tone={usdCount > 0 ? "default" : "muted"}
      />
      <Stat
        label="接入账号"
        value={connected}
        hint={connected === 0 ? "添加账号后开始监控" : `覆盖 ${platformCount} 个平台`}
      />
      <Stat
        label="需要关注"
        value={alerts > 0
          ? (
            <>
              {alerts}
              <span className="ml-1.5 text-base font-normal text-muted-foreground">个</span>
            </>
          )
          : <span className="text-[22px]">全部正常</span>}
        hint={alerts > 0 ? "低余额或查询失败" : "暂无需要关注的账号"}
        tone={alerts > 0 ? "warn" : "good"}
      />
      <Stat
        label="上次同步"
        value={<span className="text-[24px]">{relativeTime(fetchedAt, now)}</span>}
        hint={`本地时间 ${formatClock(fetchedAt)}`}
      />
    </dl>
  );
}
