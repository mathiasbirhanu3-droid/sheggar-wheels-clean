"use client";
// FR-46: bell with unread count, polled every 30s; recent items dropdown.
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

type Recent = { id: string; title: string; body: string; link: string | null; read: boolean };

export function NotificationBell() {
  const [count, setCount] = useState(0);
  const [recent, setRecent] = useState<Recent[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications/summary", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { unread: number; recent: Recent[] };
      setCount(data.unread);
      setRecent(data.recent);
    } catch {
      // silent — the bell must never break the page
    }
  }, []);

  useEffect(() => {
    // Initial fetch deferred off the effect body (React compiler rule: no sync setState in effect).
    const initial = setTimeout(load, 0);
    const t = setInterval(load, 30000);
    return () => { clearTimeout(initial); clearInterval(t); };
  }, [load]);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications, ${count} unread`}>
          <Bell className="h-5 w-5" />
          {count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-brand-foreground" aria-hidden>
              {count > 9 ? "9+" : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b px-3 py-2 text-sm font-medium">Notifications</div>
        <div className="max-h-80 overflow-y-auto">
          {recent.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">No notifications yet.</p>}
          {recent.map((n) => (
            <Link key={n.id} href={n.link ?? "/notifications"} onClick={load} className="block border-b px-3 py-2.5 text-sm last:border-0 hover:bg-muted/50">
              <p className="flex items-center gap-2 font-medium">
                {!n.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-label="unread" />}
                {n.title}
              </p>
              <p className="line-clamp-2 text-muted-foreground">{n.body}</p>
            </Link>
          ))}
        </div>
        <div className="border-t p-2">
          <Button asChild variant="ghost" size="sm" className="w-full">
            <Link href="/notifications">View all</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
