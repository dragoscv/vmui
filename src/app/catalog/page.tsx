import { CATALOG } from "@/lib/catalog";
import { CatalogCard } from "@/components/catalog/catalog-card";

export const dynamic = "force-static";

export default function CatalogPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Catalog</h1>
        <p className="max-w-2xl text-sm text-muted">
          One-click cloud-init templates for self-hosted services. Save any
          template as a boot script, then attach it when you create a new VM —
          the guest provisions itself on first boot.
        </p>
      </header>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CATALOG.map((t) => (
          <CatalogCard key={t.id} template={t} />
        ))}
      </section>
    </main>
  );
}
