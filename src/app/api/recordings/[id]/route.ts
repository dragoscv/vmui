import { db } from "@/lib/db";
import { terminalRecordings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireRole("viewer");
  const { id } = await ctx.params;
  const row = await db.select().from(terminalRecordings).where(eq(terminalRecordings.id, id)).get();
  if (!row) return new NextResponse("Not found", { status: 404 });
  try {
    const data = await readFile(row.path);
    return new NextResponse(data as unknown as BodyInit, {
      headers: {
        "content-type": "application/x-asciicast",
        "content-disposition": `attachment; filename="${row.id}.cast"`,
      },
    });
  } catch {
    return new NextResponse("File missing", { status: 410 });
  }
}
