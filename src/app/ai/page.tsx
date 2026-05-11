import { AgentChat } from "@/components/ai/agent-chat";

export const dynamic = "force-dynamic";

export default function AiPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">AI Agent</h1>
        <p className="text-sm text-muted">
          Local-first chat powered by Ollama. Set <code className="font-mono text-xs">VMUI_OLLAMA_URL</code> and <code className="font-mono text-xs">VMUI_OLLAMA_MODEL</code> env (defaults: <code>http://127.0.0.1:11434</code> / <code>llama3.2</code>). The agent can list instances, summarize cost, read audit log, and surface optimizer recommendations.
        </p>
      </header>
      <AgentChat />
    </main>
  );
}
