import { DiffView, type DiffOp } from "@/components/ops/diff-view";
import { Button, EmptyState, Field, PageHeader, PageSection, PageShell } from "@/components/ui";
import { db } from "@/lib/db";
import { bootScripts } from "@/lib/db/schema";
import { asc } from "drizzle-orm";
import { ArrowRight, ChevronDown, GitCompare } from "lucide-react";
import { getTranslations } from "next-intl/server";
import type * as React from "react";
import "server-only";

export const dynamic = "force-dynamic";

const SELECT_CLASS =
  "flex h-9 w-full appearance-none items-center truncate rounded-[var(--radius-md)] border border-border bg-surface px-3 pr-9 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50";

function NativeSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block">
      <select {...props} className={SELECT_CLASS} />
      <ChevronDown className="pointer-events-none absolute inset-y-0 right-3 my-auto size-4 opacity-60" aria-hidden />
    </span>
  );
}

/** Tiny LCS-based line diff. O(n*m) – fine for boot scripts. */
function diffLines(a: string, b: string): DiffOp[] {
  const A = a.split("\n");
  const B = b.split("\n");
  const m = A.length, n = B.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      const dpi = dp[i]!; const dpi1 = dp[i + 1]!;
      dpi[j] = A[i] === B[j] ? (dpi1[j + 1] ?? 0) + 1 : Math.max(dpi1[j] ?? 0, dpi[j + 1] ?? 0);
    }
  }
  const out: DiffOp[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (A[i] === B[j]) { out.push({ type: "ctx", line: A[i] ?? "" }); i++; j++; }
    else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) { out.push({ type: "del", line: A[i] ?? "" }); i++; }
    else { out.push({ type: "add", line: B[j] ?? "" }); j++; }
  }
  while (i < m) { out.push({ type: "del", line: A[i] ?? "" }); i++; }
  while (j < n) { out.push({ type: "add", line: B[j] ?? "" }); j++; }
  return out;
}

export default async function BootScriptDiffPage(props: { searchParams?: Promise<{ a?: string; b?: string }> }) {
  const t = await getTranslations("ops.bootScriptDiff");
  const sp = (await props.searchParams) ?? {};
  const scripts = await db.select().from(bootScripts).orderBy(asc(bootScripts.name));
  const a = scripts.find((s) => s.id === sp.a);
  const b = scripts.find((s) => s.id === sp.b);
  const ops = a && b ? diffLines(a.body, b.body) : null;

  const options = scripts.map((s) => (
    <option key={s.id} value={s.id}>
      {s.name} ({s.kind})
    </option>
  ));

  return (
    <PageShell>
      <PageHeader title={t("title")} description={t("description")} icon={<GitCompare />} />

      <PageSection title={t("pickTitle")} description={t("pickDescription")}>
        <form method="GET" className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto]">
          <Field label={t("scriptA")}>
            <NativeSelect name="a" defaultValue={sp.a ?? ""} required>
              <option value="">{t("selectPlaceholder")}</option>
              {options}
            </NativeSelect>
          </Field>
          <ArrowRight className="hidden size-4 self-center text-fg-muted sm:mb-2.5 sm:block" aria-hidden />
          <Field label={t("scriptB")}>
            <NativeSelect name="b" defaultValue={sp.b ?? ""} required>
              <option value="">{t("selectPlaceholder")}</option>
              {options}
            </NativeSelect>
          </Field>
          <Button type="submit" className="w-full sm:w-auto">
            <GitCompare className="size-4" aria-hidden /> {t("compare")}
          </Button>
        </form>
      </PageSection>

      <PageSection title={t("resultTitle")} description={a && b ? t("resultDescription", { a: a.name, b: b.name }) : undefined}>
        {ops ? (
          <DiffView ops={ops} addedLabel={t("added")} removedLabel={t("removed")} />
        ) : (
          <EmptyState compact icon={<GitCompare />} title={t("empty")} description={t("emptyHint")} />
        )}
      </PageSection>
    </PageShell>
  );
}
