/**
 * BottomBar — sync status, last save, online/offline pill, agent load.
 *
 * Per the plan §7: persistent bottom status. Phase 0 ships static indicators
 * (online / idle); Phase 1 wires real sync + agent load.
 */
import { CheckCircle2, Loader2, WifiOff, Bot } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../../lib/utils/cn";

type SyncState = "idle" | "saving" | "saved" | "offline";

export function BottomBar({ lastSaved }: { lastSaved?: Date }) {
  const [online, setOnline] = useState(true);
  const [sync, setSync] = useState<SyncState>("idle");

  useEffect(() => {
    setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    const goOnline = () => setOnline(true);
    const goOffline = () => {
      setOnline(false);
      setSync("offline");
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return (
    <footer
      className={cn(
        "flex h-6 items-center gap-3 border-t border-[var(--color-line)]",
        "bg-[var(--color-surface)] px-3 text-[10px] text-[var(--color-muted)]",
      )}
    >
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-1.5",
          online ? "bg-[var(--color-tag-teal)]/10 text-[var(--color-teal)]" : "bg-[var(--color-tag-red)]/10 text-[var(--color-ruby)]",
        )}
      >
        {online ? <CheckCircle2 className="size-2.5" /> : <WifiOff className="size-2.5" />}
        {online ? "Online" : "Offline"}
      </span>

      <span className="inline-flex items-center gap-1">
        {sync === "saving" ? <Loader2 className="size-2.5 animate-spin" /> : <CheckCircle2 className="size-2.5" />}
        {sync === "offline"
          ? "Queued"
          : lastSaved
            ? `Saved ${lastSaved.toLocaleTimeString("hy-AM")}`
            : "All changes saved"}
      </span>

      <span className="ml-auto inline-flex items-center gap-1">
        <Bot className="size-2.5 text-[var(--color-agent)]" />
        Agents idle
      </span>
    </footer>
  );
}
