import { Sparkles } from "lucide-react";
import { RecipesGrid } from "@/components/recipes/recipes-grid";

export const dynamic = "force-dynamic";

export default function RecipesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Sparkles className="h-6 w-6 text-[var(--color-primary)]" />
          Quick actions
        </h1>
        <p className="text-sm text-muted">
          One-click bulk operations across every connected account. Each recipe shows a preview list
          before you execute it.
        </p>
      </div>
      <RecipesGrid />
    </div>
  );
}
