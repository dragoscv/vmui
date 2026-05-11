"use client";

import { useEffect, useState, useTransition } from "react";
import { Send, Bot, User, Wrench, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { askAgentAction, checkOllamaAction } from "@/server/actions/ai";

interface UiMsg {
  role: "user" | "assistant" | "tool";
  content: string;
  tool?: string;
}

export function AgentChat() {
  const [msgs, setMsgs] = useState<UiMsg[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; url: string; model: string; error?: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    void checkOllamaAction().then(setStatus);
  }, []);

  const send = () => {
    if (!input.trim()) return;
    const message = input;
    setInput("");
    const userMsg: UiMsg = { role: "user", content: message };
    setMsgs((m) => [...m, userMsg]);
    start(async () => {
      const history = msgs.map((m) => ({ role: m.role, content: m.content, tool_name: m.tool }));
      const r = await askAgentAction({ message, history });
      if (!r.ok) {
        setMsgs((m) => [...m, { role: "assistant", content: `error: ${r.error}` }]);
        return;
      }
      const newOnes = r.messages.slice(history.length + 1) as UiMsg[];
      setMsgs((m) => [...m, ...newOnes.map((x) => ({ ...x, tool: x.tool }))]);
    });
  };

  return (
    <div className="flex h-[70vh] flex-col gap-3">
      {status ? (
        <div className={`flex items-center gap-2 rounded border px-2 py-1 text-xs ${status.ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-rose-500/40 bg-rose-500/10 text-rose-200"}`}>
          {status.ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
          Ollama @ <code className="font-mono">{status.url}</code> · model <code className="font-mono">{status.model}</code>
          {status.error ? ` · ${status.error}` : ""}
        </div>
      ) : null}
      <div className="flex-1 space-y-3 overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
        {msgs.length === 0 ? (
          <p className="text-xs text-muted">Ask anything about your fleet. Try: <em>"what's idle?"</em> · <em>"what did I do last hour?"</em> · <em>"summarize cost"</em></p>
        ) : null}
        {msgs.map((m, i) => (
          <Bubble key={i} m={m} />
        ))}
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      </div>
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="ask vmui…"
          className="flex-1 rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-2 py-1 text-sm"
        />
        <button type="button" disabled={pending} onClick={send} className="inline-flex items-center gap-1 rounded-md bg-[var(--color-primary)] px-3 py-1 text-sm font-semibold text-[var(--color-primary-fg)] disabled:opacity-40">
          <Send className="h-3 w-3" /> Send
        </button>
      </div>
    </div>
  );
}

function Bubble({ m }: { m: UiMsg }) {
  const Icon = m.role === "user" ? User : m.role === "tool" ? Wrench : Bot;
  return (
    <div className={`flex gap-2 ${m.role === "user" ? "justify-end" : ""}`}>
      <div className={`flex max-w-[85%] gap-2 rounded-lg border p-2 text-xs ${m.role === "user" ? "border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10" : m.role === "tool" ? "border-amber-500/30 bg-amber-500/5 font-mono text-amber-200" : "border-[var(--color-border)] bg-[var(--color-surface)]"}`}>
        <Icon className="mt-[2px] h-3 w-3 shrink-0" />
        <pre className="whitespace-pre-wrap break-words font-sans">{m.content}</pre>
      </div>
    </div>
  );
}
