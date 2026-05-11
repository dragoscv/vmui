"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type SpeechRec = (typeof globalThis & { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown });

interface SRInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: (e: SREvent) => void;
  onerror: (e: { error: string }) => void;
  onend: () => void;
}
interface SREvent { results: { 0: { transcript: string }; isFinal: boolean }[] }

const COMMANDS: { phrases: string[]; href: string; label: string }[] = [
  { phrases: ["dashboard", "home"], href: "/", label: "Dashboard" },
  { phrases: ["instances", "vms", "machines", "servers"], href: "/instances", label: "Instances" },
  { phrases: ["new vm", "new instance", "launch", "create vm"], href: "/instances/new", label: "Launch new VM" },
  { phrases: ["accounts", "providers"], href: "/accounts", label: "Cloud accounts" },
  { phrases: ["costs", "billing"], href: "/costs", label: "Costs" },
  { phrases: ["forecast", "projection"], href: "/forecast", label: "Cost forecast" },
  { phrases: ["anomaly", "anomalies"], href: "/anomalies", label: "Cost anomalies" },
  { phrases: ["recordings", "asciinema", "replay"], href: "/recordings", label: "Recordings" },
  { phrases: ["runbook", "runbooks"], href: "/runbooks", label: "Runbooks" },
  { phrases: ["budget", "budgets"], href: "/budgets", label: "Tag budgets" },
  { phrases: ["auto park", "park"], href: "/auto-park", label: "Idle auto-park" },
  { phrases: ["key rotation", "rotate keys"], href: "/key-rotation", label: "Key rotation" },
  { phrases: ["digest", "what changed"], href: "/digest", label: "Digest" },
  { phrases: ["mesh", "wireguard"], href: "/mesh", label: "Mesh" },
  { phrases: ["ai agent", "ai", "chat"], href: "/ai", label: "AI" },
  { phrases: ["disaster recovery", "dr drill"], href: "/dr", label: "DR drill" },
  { phrases: ["restore"], href: "/restore", label: "Restore" },
  { phrases: ["status"], href: "/status", label: "Status" },
  { phrases: ["teams"], href: "/teams", label: "Teams" },
  { phrases: ["settings"], href: "/settings", label: "Settings" },
];

export function VoiceCommander() {
  const [open, setOpen] = useState(false);
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const recRef = useRef<SRInstance | null>(null);
  const router = useRouter();

  useEffect(() => {
    const w = globalThis as SpeechRec;
    setSupported(Boolean(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const start = () => {
    const w = globalThis as SpeechRec;
    const Ctor = (w.SpeechRecognition || w.webkitSpeechRecognition) as new () => SRInstance;
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "en-US";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      if (!last) return;
      const text = last[0].transcript.trim().toLowerCase();
      setTranscript(text);
      if (last.isFinal) match(text);
    };
    r.onerror = (e) => toast.error(`Voice: ${e.error}`);
    r.onend = () => setListening(false);
    r.start();
    recRef.current = r;
    setListening(true);
    setTranscript("");
  };
  const stop = () => { try { recRef.current?.stop(); } catch { /* noop */ } setListening(false); };

  const match = (text: string) => {
    let best: { score: number; cmd: typeof COMMANDS[number] } | null = null;
    for (const c of COMMANDS) {
      for (const p of c.phrases) {
        if (text.includes(p)) {
          const score = p.length;
          if (!best || score > best.score) best = { score, cmd: c };
        }
      }
    }
    if (best) {
      toast.success(`Going to ${best.cmd.label}`);
      router.push(best.cmd.href);
      setOpen(false);
    } else {
      toast.message(`Heard "${text}" but no command matched.`);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-x-0 bottom-20 z-[90] flex justify-center px-4 sm:bottom-8">
      <div className="flex w-full max-w-md items-center gap-3 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-2xl">
        {!supported ? (
          <span className="px-3 text-sm text-muted">Web Speech not supported in this browser.</span>
        ) : (
          <>
            <button onClick={listening ? stop : start} className={`flex h-9 w-9 items-center justify-center rounded-full ${listening ? "bg-rose-500 text-white animate-pulse" : "bg-[var(--color-primary)] text-white"}`} aria-label={listening ? "Stop listening" : "Start listening"}>
              {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
            <span className="flex-1 truncate font-mono text-xs text-muted">
              {listening ? (transcript || "Listening…") : "Press the mic and say a page name"}
            </span>
          </>
        )}
        <button onClick={() => { stop(); setOpen(false); }} aria-label="Close" className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-[var(--color-surface-muted)]">
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
