"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ApiError,
  McpRow,
  ModelRow,
  PROXY_BASE,
  createAgent,
  listMcps,
  listModels,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const DEFAULT_MODEL = "anthropic/claude-haiku-4-5";
const DEFAULT_KEY = "sk-1234";
const NAME_MAX = 64;

function mcpLabel(row: McpRow): string {
  return row.alias ?? row.server_name ?? row.server_id;
}

export default function NewAgentPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [selectedMcps, setSelectedMcps] = useState<Set<string>>(new Set());
  const [apiKey, setApiKey] = useState(DEFAULT_KEY);
  const [baseUrl, setBaseUrl] = useState(PROXY_BASE);

  const [models, setModels] = useState<ModelRow[]>([]);
  const [mcps, setMcps] = useState<McpRow[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setMetaError(null);
      try {
        const [modelsRes, mcpsRes] = await Promise.all([
          listModels().catch(() => [] as ModelRow[]),
          listMcps().catch(() => [] as McpRow[]),
        ]);
        if (cancelled) return;
        setModels(modelsRes);
        setMcps(mcpsRes);
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

  const sortedModels = useMemo(
    () => [...models].sort((a, b) => a.id.localeCompare(b.id)),
    [models],
  );
  const sortedMcps = useMemo(
    () =>
      [...mcps].sort((a, b) =>
        mcpLabel(a).localeCompare(mcpLabel(b)),
      ),
    [mcps],
  );

  function toggleMcp(id: string) {
    setSelectedMcps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function validate(): string | null {
    const trimmedName = name.trim();
    if (!trimmedName) return "Name is required.";
    if (trimmedName.length > NAME_MAX) {
      return `Name must be ${NAME_MAX} characters or fewer.`;
    }
    if (!model.trim()) return "Model is required.";
    if (!systemPrompt.trim()) return "System prompt is required.";
    if (!apiKey.trim()) return "LiteLLM API key is required.";
    if (!baseUrl.trim()) return "LiteLLM base URL is required.";
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

    setSubmitting(true);
    try {
      const created = await createAgent({
        name: name.trim(),
        config: {
          model: model.trim(),
          system_prompt: systemPrompt,
          tools: Array.from(selectedMcps),
          litellm_api_key: apiKey.trim(),
          litellm_base_url: baseUrl.trim(),
        },
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
        Pick a model, write a system prompt, and attach MCP servers. Sandboxes
        are created per session — agents themselves are pure definitions.
      </p>

      <Card className="mt-6">
        <CardHeader className="sr-only">
          <CardTitle>New Agent</CardTitle>
          <CardDescription>
            Pick a model, write a system prompt, and attach MCP servers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={onSubmit} noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
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
              <Label htmlFor="model">Model</Label>
              {sortedModels.length > 0 ? (
                <Select
                  value={model}
                  onValueChange={(v) => setModel(v ?? "")}
                  disabled={submitting}
                >
                  <SelectTrigger id="model" className="w-full font-mono text-xs">
                    <SelectValue placeholder="Select a model" />
                  </SelectTrigger>
                  <SelectContent>
                    {sortedModels.map((m) => (
                      <SelectItem
                        key={m.id}
                        value={m.id}
                        className="font-mono text-xs"
                      >
                        {m.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="model"
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
                    ? `${sortedModels.length} model${sortedModels.length === 1 ? "" : "s"} available on this proxy.`
                    : "No models returned by proxy. Type a model id manually."}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="system-prompt">System prompt</Label>
              <Textarea
                id="system-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="You are a senior engineer reviewing code for clarity, correctness, and security."
                rows={6}
                disabled={submitting}
              />
            </div>

            <div className="space-y-1.5">
              <Label>MCP servers</Label>
              {loadingMeta ? (
                <p className="text-xs text-muted-foreground">
                  Loading MCP servers from proxy…
                </p>
              ) : sortedMcps.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No MCP servers configured on this proxy.
                </p>
              ) : (
                <div className="rounded-lg border bg-card">
                  <ul role="listbox" aria-label="MCP servers" className="divide-y">
                    {sortedMcps.map((m) => {
                      const selected = selectedMcps.has(m.server_id);
                      return (
                        <li key={m.server_id}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={selected}
                            onClick={() => toggleMcp(m.server_id)}
                            disabled={submitting}
                            className={cn(
                              "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                              selected && "bg-accent/30",
                            )}
                          >
                            <span
                              className={cn(
                                "grid size-4 shrink-0 place-items-center rounded-[4px] border transition-colors",
                                selected
                                  ? "border-foreground bg-foreground text-background"
                                  : "border-border bg-transparent",
                              )}
                              aria-hidden
                            >
                              {selected ? <Check className="size-3" /> : null}
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="truncate text-[13px] text-foreground">
                                {mcpLabel(m)}
                              </span>
                              {m.url ? (
                                <span className="truncate font-mono text-[11px] text-muted-foreground">
                                  {m.url}
                                </span>
                              ) : null}
                            </span>
                            {m.transport ? (
                              <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                                {m.transport}
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {selectedMcps.size > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {selectedMcps.size} selected.
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="api-key">LiteLLM API key</Label>
              <Input
                id="api-key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={submitting}
                className="font-mono text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="base-url">LiteLLM base URL</Label>
              <Input
                id="base-url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                disabled={submitting}
                className="font-mono text-xs"
              />
            </div>

            {metaError ? (
              <p className="font-mono text-xs text-muted-foreground">
                Could not load model/MCP lists: {metaError}
              </p>
            ) : null}

            <div className="pt-2">
              <Button type="submit" disabled={submitting}>
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
