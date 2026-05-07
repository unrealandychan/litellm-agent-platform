"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeft, Plus, Search } from "lucide-react";

import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import {
  AgentRow,
  SessionRow,
  listAgents,
  listSessions,
} from "@/lib/api";

const REPO_URL = "https://github.com/BerriAI/litellm-agent-platform";
const POLL_INTERVAL_MS = 10000;
const RECENT_SESSION_LIMIT = 8;

function statusDotClass(status: string): string {
  switch (status) {
    case "ready":
      return "bg-emerald-500";
    case "creating":
      return "bg-amber-500";
    case "failed":
      return "bg-red-500";
    case "dead":
      return "bg-muted-foreground";
    default:
      return "bg-muted-foreground";
  }
}

function shortId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

function agentLabel(a: AgentRow): string {
  return a.name?.trim() || a.id;
}

export function Sidebar() {
  const pathname = usePathname() ?? "";

  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [a, s] = await Promise.all([
          listAgents().catch(() => null),
          listSessions().catch(() => null),
        ]);
        if (cancelled) return;
        if (a) setAgents(a);
        if (s) setSessions(s);
      } catch {
        // silent — sidebar shouldn't crash on transient proxy errors
      }
    }
    void load();
    const id = window.setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const sortedAgents = useMemo(
    () => [...agents].sort((a, b) => agentLabel(a).localeCompare(agentLabel(b))),
    [agents],
  );

  const recentSessions = useMemo(
    () =>
      [...sessions]
        .sort((a, b) => {
          const at = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
          return bt - at;
        })
        .slice(0, RECENT_SESSION_LIMIT),
    [sessions],
  );

  const agentNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents) m.set(a.id, agentLabel(a));
    return m;
  }, [agents]);

  return (
    <aside
      className="sticky top-0 flex h-screen w-[240px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
      aria-label="Primary sidebar"
    >
      {/* Wordmark */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <Link
          href="/agents"
          aria-label="LiteLLM Agent Platform home"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <span
            aria-hidden
            className="grid h-[18px] w-[18px] place-items-center rounded-[4px] bg-foreground text-[9px] font-semibold tracking-tight text-background"
          >
            L
          </span>
          <span className="text-[13px] font-semibold tracking-tight text-foreground">
            LiteLLM
          </span>
        </Link>
      </div>

      {/* Search row */}
      <div className="flex items-center gap-1.5 px-3 pb-2">
        <button
          type="button"
          aria-label="Collapse sidebar"
          title="Collapse sidebar (coming soon)"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <PanelLeft className="size-3.5" aria-hidden />
        </button>
        <div
          className="flex flex-1 items-center gap-1.5 rounded-md border border-sidebar-border px-2 py-1 text-[11px] text-muted-foreground"
          aria-hidden
        >
          <Search className="size-3" />
          <span className="flex-1">Search</span>
          <kbd className="font-sans text-[10px] tabular-nums">⌘K</kbd>
        </div>
      </div>

      {/* New Agent CTA */}
      <div className="px-2 pb-2">
        <Link
          href="/agents/new"
          aria-current={pathname === "/agents/new" ? "page" : undefined}
          className={cn(
            "flex h-7 items-center gap-2 rounded-md px-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            pathname === "/agents/new"
              ? "bg-sidebar-accent text-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
          )}
        >
          <Plus
            className={cn(
              "size-[14px] shrink-0",
              pathname === "/agents/new"
                ? "text-foreground"
                : "text-muted-foreground",
            )}
            aria-hidden
          />
          <span className="truncate">New Agent</span>
        </Link>
      </div>

      {/* Lists */}
      <nav
        aria-label="Agents and sessions"
        className="flex-1 overflow-y-auto px-2 pb-2"
      >
        {/* Agents section */}
        <SectionHeader label="Agents" count={sortedAgents.length} />
        <ul className="mb-3 space-y-px">
          {sortedAgents.length === 0 ? (
            <li className="px-2 py-1 text-[11px] text-muted-foreground">
              No agents yet.
            </li>
          ) : (
            sortedAgents.map((a) => {
              const href = `/agents/${a.id}`;
              const active = pathname === href;
              const label = agentLabel(a);
              return (
                <li key={a.id}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-7 items-center gap-2 rounded-md px-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      active
                        ? "bg-sidebar-accent text-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                    )}
                    title={label}
                  >
                    <span
                      aria-hidden
                      className="size-1.5 shrink-0 rounded-full bg-muted-foreground/60"
                    />
                    <span className="truncate">{label}</span>
                  </Link>
                </li>
              );
            })
          )}
        </ul>

        {/* Sessions section */}
        <SectionHeader
          label="Recent sessions"
          count={recentSessions.length}
          href="/sessions"
          active={pathname === "/sessions"}
        />
        <ul className="space-y-px">
          {recentSessions.length === 0 ? (
            <li className="px-2 py-1 text-[11px] text-muted-foreground">
              No sessions yet.
            </li>
          ) : (
            recentSessions.map((s) => {
              const href = `/sessions/${s.id}`;
              const active = pathname === href;
              const agentName = agentNameById.get(s.agent_id);
              return (
                <li key={s.id}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-7 items-center gap-2 rounded-md px-2 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      active
                        ? "bg-sidebar-accent text-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
                    )}
                    title={`${agentName ? `${agentName} · ` : ""}${s.id}`}
                  >
                    <span
                      aria-hidden
                      title={s.status}
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        statusDotClass(s.status),
                      )}
                    />
                    <span className="truncate">
                      {agentName ?? <span className="font-mono text-xs">{shortId(s.id)}</span>}
                    </span>
                  </Link>
                </li>
              );
            })
          )}
        </ul>
      </nav>

      {/* Sticky footer */}
      <div className="sticky bottom-0 flex items-center gap-0.5 border-t border-sidebar-border bg-sidebar px-2 py-1.5">
        <ThemeToggle />
        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View repository on GitHub"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <svg
            className="size-3.5"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden
          >
            <path d="M12 .5C5.65.5.5 5.65.5 12.04c0 5.1 3.29 9.42 7.86 10.95.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.87-1.54-3.87-1.54-.52-1.34-1.27-1.7-1.27-1.7-1.04-.72.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.77 2.69 1.26 3.34.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.18-3.1-.12-.3-.51-1.46.11-3.05 0 0 .96-.31 3.16 1.18.92-.26 1.9-.39 2.88-.39.98 0 1.96.13 2.88.39 2.2-1.49 3.16-1.18 3.16-1.18.62 1.59.23 2.75.11 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.41-5.25 5.7.41.36.78 1.06.78 2.14 0 1.55-.01 2.8-.01 3.18 0 .31.21.68.8.56 4.57-1.53 7.85-5.85 7.85-10.95C23.5 5.65 18.35.5 12 .5z" />
          </svg>
        </a>
      </div>
    </aside>
  );
}

interface SectionHeaderProps {
  label: string;
  count: number;
  href?: string;
  active?: boolean;
}

function SectionHeader({ label, count, href, active }: SectionHeaderProps) {
  const inner = (
    <>
      <span className="truncate">{label}</span>
      <span className="ml-auto tabular-nums text-muted-foreground/60">
        {count}
      </span>
    </>
  );
  return (
    <div className="mt-1 mb-1">
      {href ? (
        <Link
          href={href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex h-6 items-center gap-2 rounded-md px-2 text-[10px] font-medium uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            active
              ? "bg-sidebar-accent text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {inner}
        </Link>
      ) : (
        <div className="flex h-6 items-center gap-2 px-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {inner}
        </div>
      )}
    </div>
  );
}
