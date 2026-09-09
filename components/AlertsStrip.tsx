import type { Meter } from "@/lib/types";

interface AlertsStripProps {
  meters: Meter[];
}

export function AlertsStrip({ meters }: AlertsStripProps) {
  const alerts = meters.filter((m) => m.alert);
  if (alerts.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5" role="alert">
      {alerts.map((m) => (
        <div
          key={m.id}
          className={[
            "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs",
            m.alert?.level === "critical"
              ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
              : "border-amber-400/30 bg-amber-400/10 text-amber-200",
          ].join(" ")}
        >
          <span aria-hidden className="text-[10px]">
            {m.alert?.level === "critical" ? "\u26A0" : "\u25B2"}
          </span>
          <span className="font-medium">{m.name}:</span>
          <span className="text-white/70">{m.alert?.message}</span>
        </div>
      ))}
    </div>
  );
}
