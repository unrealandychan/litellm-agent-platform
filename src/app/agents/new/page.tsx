"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { PfpUpload } from "@/components/pfp-upload";
import {
  ApiError,
  ModelRow,
  TemplateRow,
  createAgent,
  listModels,
  listTemplates,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const DEFAULT_MODEL = "anthropic/claude-haiku-4-5";
const NAME_MAX = 64;

function repoShortLabel(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\//, "").replace(/\.git$/, "") || u.host;
  } catch {
    return url;
  }
}

export default function NewAgentPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [modelQuery, setModelQuery] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [branchOverride, setBranchOverride] = useState("");
  const [pfpUrl, setPfpUrl] = useState<string | null>(null);

  const [models, setModels] = useState<ModelRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setMetaError(null);
      try {
        const [modelsRes, templatesRes] = await Promise.all([
          listModels().catch(() => [] as ModelRow[]),
          listTemplates().catch(() => [] as TemplateRow[]),
        ]);
        if (cancelled) return;
        setModels(modelsRes);
        setTemplates(templatesRes);
        // Auto-select the first ready template, but the user can change it.
        const firstReady = templatesRes.find((t) => t.build_status === "ready");
        if (firstReady) setTemplateId(firstReady.id);
      } catch (e) {
        if (cancelled) return;
        setMetaError(
          e instanceof ApiError ? e.message : (e as Error).message,
        );
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const sortedTemplates = useMemo(() => {
    // Ready templates first, then alphabetical by display label.
    return [...templates].sort((a, b) => {
      const aReady = a.build_status === "ready";
      const bReady = b.build_status === "ready";
      if (aReady !== bReady) return aReady ? -1 : 1;
      return (a.name?.trim() || a.id).localeCompare(b.name?.trim() || b.id);
    });
  }, [templates]);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === templateId) ?? null,
    [templates, templateId],
  );

  const sortedModels = useMemo(
    () => [...models].sort((a, b) => a.id.localeCompare(b.id)),
    [models],
  );
  const filteredModels = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    if (!q) return sortedModels;
    return sortedModels.filter((m) => m.id.toLowerCase().includes(q));
  }, [sortedModels, modelQuery]);

  function validate(): string | null {
    const trimmedName = name.trim();
    if (trimmedName.length > NAME_MAX) {
      return `Name must be ${NAME_MAX} characters or fewer.`;
    }
    if (!model.trim()) return "Model is required.";
    if (!templateId) return "Pick a sandbox template.";
    return null;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    if (!templateId) return;
    setSubmitting(true);
    try {
      const created = await createAgent({
        name: name.trim() || undefined,
        model: model.trim(),
        prompt: systemPrompt.trim() || undefined,
        template_id: templateId,
        branch: branchOverride.trim() || undefined,
        pfp_url: pfpUrl ?? undefined,
      });
      router.push(`/agents/${created.id}`);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : (err as Error).message;
      setError(msg);
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-8">
      <h1 className="text-[22px] font-semibold tracking-tight">New Agent</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick a sandbox template (harness + repo), a model, and a system prompt.
        Sessions are spawned per-agent — each run gets its own Fargate task.
      </p>

      <Card className="mt-6">
        <CardHeader className="sr-only">
          <CardTitle>New Agent</CardTitle>
          <CardDescription>
            Pick a sandbox template, model, and system prompt.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={onSubmit} noValidate>
            <div className="space-y-1.5">
              <Label>Profile picture</Label>
              <PfpUpload
                name={name}
                value={pfpUrl}
                onChange={setPfpUrl}
                disabled={submitting}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="name">Name (optional)</Label>
              <Input
                id="name"
                value={name}
                maxLength={NAME_MAX}
                onChange={(e) => setName(e.target.value)}
                placeholder="code-reviewer"
                disabled={submitting}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Sandbox</Label>
              {loadingMeta ? (
                <p className="text-xs text-muted-foreground">
                  Loading sandboxes from proxy…
                </p>
              ) : sortedTemplates.length === 0 ? (
                <p className="font-mono text-xs text-destructive">
                  No sandboxes are configured. An admin must run{" "}
                  <span>POST /v1/managed_agents/sandbox-templates</span> first.
                </p>
              ) : (
                <div className="rounded-lg border bg-card">
                  <ul
                    role="listbox"
                    aria-label="Sandbox templates"
                    className="divide-y"
                  >
                    {sortedTemplates.map((t) => {
                      const selected = t.id === templateId;
                      const ready = t.build_status === "ready";
                      return (
                        <li key={t.id}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={selected}
                            onClick={() => setTemplateId(t.id)}
                            disabled={submitting || !ready}
                            className={cn(
                              "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
                              selected && "bg-accent/40",
                            )}
                          >
                            <span
                              className={cn(
                                "grid size-4 shrink-0 place-items-center rounded-full border transition-colors",
                                selected
                                  ? "border-foreground bg-foreground text-background"
                                  : "border-border bg-transparent",
                              )}
                              aria-hidden
                            >
                              {selected ? <Check className="size-3" /> : null}
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <span className="truncate text-[13px] font-medium text-foreground">
                                {repoShortLabel(t.repo_url)}
                              </span>
                              <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                <span>
                                  harness:{" "}
                                  <span className="font-mono text-foreground">
                                    {t.dockerfile_id}
                                  </span>
                                </span>
                                <span aria-hidden>·</span>
                                <span className="font-mono">
                                  {t.default_branch}
                                </span>
                              </span>
                            </span>
                            {!ready ? (
                              <span
                                className={cn(
                                  "shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide",
                                  t.build_status === "failed"
                                    ? "bg-red-50 text-red-700"
                                    : "bg-amber-50 text-amber-700",
                                )}
                              >
                                {t.build_status}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="branch">Branch (optional)</Label>
              <Input
                id="branch"
                value={branchOverride}
                onChange={(e) => setBranchOverride(e.target.value)}
                placeholder={
                  selectedTemplate
                    ? `default: ${selectedTemplate.default_branch}`
                    : "default: main"
                }
                disabled={submitting || !selectedTemplate}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Pin this agent to a specific branch of the sandbox&rsquo;s
                repo. Leave blank to use the default.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="model-search">Model</Label>
              {sortedModels.length > 0 ? (
                <>
                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
                      aria-hidden
                    />
                    <Input
                      id="model-search"
                      type="search"
                      value={modelQuery}
                      onChange={(e) => setModelQuery(e.target.value)}
                      placeholder={`Search ${sortedModels.length} models…`}
                      disabled={submitting}
                      className="pl-8 font-mono text-xs"
                      autoComplete="off"
                    />
                  </div>
                  <div className="rounded-lg border bg-card">
                    {filteredModels.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-muted-foreground">
                        No models match{" "}
                        <span className="font-mono">
                          &quot;{modelQuery.trim()}&quot;
                        </span>
                        .
                      </p>
                    ) : (
                      <ul
                        role="listbox"
                        aria-label="Models"
                        className="max-h-64 divide-y overflow-y-auto"
                      >
                        {filteredModels.map((m) => {
                          const selected = m.id === model;
                          return (
                            <li key={m.id}>
                              <button
                                type="button"
                                role="option"
                                aria-selected={selected}
                                onClick={() => setModel(m.id)}
                                disabled={submitting}
                                className={cn(
                                  "flex w-full items-center gap-3 px-3 py-1.5 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                                  selected && "bg-accent/30",
                                )}
                              >
                                <span
                                  className={cn(
                                    "grid size-4 shrink-0 place-items-center rounded-full border transition-colors",
                                    selected
                                      ? "border-foreground bg-foreground text-background"
                                      : "border-border bg-transparent",
                                  )}
                                  aria-hidden
                                >
                                  {selected ? (
                                    <Check className="size-3" />
                                  ) : null}
                                </span>
                                <span className="truncate font-mono text-xs text-foreground">
                                  {m.id}
                                </span>
                                {m.owned_by ? (
                                  <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                                    {m.owned_by}
                                  </span>
                                ) : null}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </>
              ) : (
                <Input
                  id="model-search"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={DEFAULT_MODEL}
                  disabled={submitting}
                  className="font-mono text-xs"
                />
              )}
              <p className="text-xs text-muted-foreground">
                {loadingMeta
                  ? "Loading models from proxy…"
                  : sortedModels.length > 0
                    ? <>Selected: <span className="font-mono text-foreground">{model}</span></>
                    : "No models returned by proxy. Type a model id manually."}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="system-prompt">System prompt (optional)</Label>
              <Textarea
                id="system-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="You are a senior engineer reviewing code for clarity, correctness, and security."
                rows={6}
                disabled={submitting}
              />
            </div>

            {metaError ? (
              <p className="font-mono text-xs text-muted-foreground">
                Could not load template/model lists: {metaError}
              </p>
            ) : null}

            <div className="pt-2">
              <Button type="submit" disabled={submitting || !templateId}>
                {submitting ? "Creating…" : "Create agent"}
              </Button>
              {error ? (
                <p className="mt-3 font-mono text-xs text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
