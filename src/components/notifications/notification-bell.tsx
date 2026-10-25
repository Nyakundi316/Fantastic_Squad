"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Item = { id: string; title: string; body: string; link: string | null; read: boolean; createdAt: string };
type Feed = { unread: number; items: Item[] };

function timeAgo(iso: string) {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short" });
}

export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const feed = useQuery<Feed>({ queryKey: ["notifications"], queryFn: () => api<Feed>("/api/notifications"), enabled: open });
  const markRead = useMutation({
    mutationFn: () => api("/api/notifications/read", { method: "POST" }),
    onSuccess: () => queryClient.setQueryData<Feed>(["notifications"], (f) => (f ? { ...f, unread: 0 } : f)),
  });

  const unread = feed.data ? feed.data.unread : initialUnread;

  useEffect(() => {
    if (open && feed.data && feed.data.unread > 0 && !markRead.isPending) markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, feed.data?.unread]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <Bell className="size-[18px]" aria-hidden />
        {unread > 0 && (
          <span className="tabular absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-x-4 top-16 z-40 rounded-xl border border-border bg-surface shadow-pop sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-96">
          <p className="border-b border-border px-4 py-3 text-sm font-semibold">Notifications</p>
          <div className="max-h-[60vh] overflow-y-auto">
            {feed.isLoading && <p className="px-4 py-6 text-sm text-muted-foreground">Loading</p>}
            {feed.data?.items.length === 0 && <p className="px-4 py-6 text-sm text-muted-foreground">Nothing yet. Order and shipping updates appear here.</p>}
            <ul className="divide-y divide-border">
              {feed.data?.items.map((item) => {
                const content = (
                  <>
                    <span className="flex items-baseline justify-between gap-3">
                      <span className={cn("text-sm", !item.read && "font-semibold")}>{item.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(item.createdAt)}</span>
                    </span>
                    <span className="mt-0.5 line-clamp-3 block text-sm text-muted-foreground">{item.body}</span>
                  </>
                );
                return (
                  <li key={item.id} className={cn(!item.read && "bg-primary/[0.03]")}>
                    {item.link ? (
                      <Link href={item.link} onClick={() => setOpen(false)} className="block px-4 py-3 hover:bg-muted/60">
                        {content}
                      </Link>
                    ) : (
                      <div className="px-4 py-3">{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
