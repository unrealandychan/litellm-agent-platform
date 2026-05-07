"use client";

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Play, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AgentRow,
  ApiError,
  SessionRow,
  TemplateRow,
  getAgent,
  listSessions,
  listTemplates,
  spawnSession,
} from "@/lib/api";

interface PageProps {
  params: Promise<{ id: string }>;
}

function formatTime(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function statusVariant(
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "ready") return "default";
  if (status === "creating") return "secondary";
  if (status === "failed") return "destructive";
  return "outline";
}

export default function AgentDetailPage({ params }: PageProps) {
  const router = useRouter();
  const { id } = use(params);

  const [agent, setAgent] = useState<AgentRow | null>(null);
  const [template, setTemplate] = useState<TemplateRow | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [spawning, setSpawning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Load agent + sessions in parallel; templates separately because the
      // template lookup is "best effort" — a 5xx on /sandbox-templates
      // shouldn't break the page.
      const [a, s] = await Promise.all([
        getAgent(id),
        listSessions(id),
      ]);
      setAgent(a);
      setSessions(s);
      try {
        const templates = await listTemplates();
        setTemplate(templates.find((t) => t.id === a.template_id) ?? null);
      } catch {
        setTemplate(null);
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSpawn() {
    if (!agent || spawning) return;
    setSpawning(true);
    setError(null);
    try {
      const session = await spawnSession(agent.id, {});
      router.push(`/sessions/${session.id}`);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      setError(msg);
      setSpawning(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading || spawning}
          aria-label="Refresh"
        >
          <RefreshCw className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
        <Button
          size="sm"
          onClick={() => void handleSpawn()}
          disabled={!agent || spawning}
        >
          <Play />
          {spawning ? "Spawning…" : "Spawn session"}
        </Button>
      </div>

      {error ? (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 font-mono text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {spawning ? (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Provisioning Fargate task and harness — this typically takes 50–90
          seconds. Don&rsquo;t leave the page.
        </div>
      ) : null}

      {agent ? (
        <>
          <div className="mt-6">
            <h1 className="text-[22px] font-semibold tracking-tight">
              {agent.name ?? agent.id}
            </h1>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {agent.id}
            </p>
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Configuration</CardTitle>
                <CardDescription>
                  Model, sandbox template, and branch override.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                    Model
                  </div>
                  <div className="font-mono text-sm">{agent.model}</div>
                </div>

                <Separator />

                <div>
                  <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                    Sandbox template
                  </div>
                  {template ? (
                    <div className="space-y-1">
                      <div className="text-sm">
                        {template.name?.trim() || template.id}
                        <Badge variant="secondary" className="ml-2 font-mono text-[11px]">
                          {template.dockerfile_id}
                        </Badge>
                      </div>
                      <div className="font-mono text-xs text-muted-foreground break-all">
                        {template.repo_url}
                      </div>
                    </div>
                  ) : (
                    <div className="font-mono text-xs text-muted-foreground">
                      {agent.template_id}
                    </div>
                  )}
                </div>

                <div>
                  <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
                    Branch
                  </div>
                  <div className="font-mono text-sm">{agent.branch}</div>
                </div>

                <Separator />

                <div className="text-xs tabular-nums text-muted-foreground">
                  Created {formatTime(agent.created_at)}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Sessions</CardTitle>
                <CardDescription>
                  Running and past sessions for this agent.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {sessions.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No sessions yet. Click <span className="font-medium">Spawn session</span> to create one.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Status</TableHead>
                        <TableHead>ID</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sessions.map((session) => (
                        <TableRow
                          key={session.id}
                          onClick={() => router.push(`/sessions/${session.id}`)}
                          className="cursor-pointer hover:bg-muted/40"
                        >
                          <TableCell>
                            <Badge variant={statusVariant(session.status)}>
                              {session.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {session.id}
                          </TableCell>
                          <TableCell className="text-xs tabular-nums text-muted-foreground">
                            {formatTime(session.created_at)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : !loading && !error ? (
        <div className="py-16 text-center text-sm text-muted-foreground">
          Agent not found.
        </div>
      ) : null}
    </div>
  );
}
