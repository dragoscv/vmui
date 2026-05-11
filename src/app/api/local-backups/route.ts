import { NextResponse } from "next/server";
import { listLocalBackupsAction } from "@/server/actions/local-backup";

export async function GET() {
  const files = await listLocalBackupsAction();
  return NextResponse.json(files);
}
