import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";

export async function GET() {
  const config = getConfig();

  // Check DB
  let dbStatus = "ok";
  let dbCount = 0;
  try {
    const db = getDb();
    dbCount = (db.prepare("SELECT COUNT(*) as c FROM pedidos_maestro").get() as { c: number }).c;
  } catch (e) {
    dbStatus = String(e);
  }

  // Check SAP config (just validate env vars, don't connect)
  const sapConfigured = !!(config.sapUrl && config.sapUser && config.sapPass && config.sapCompany);
  const emailConfigured = !!(config.emailUser && config.emailPass && config.emailHost);

  return NextResponse.json({
    ok: dbStatus === "ok",
    db: { status: dbStatus, pedidos: dbCount },
    sap: { configured: sapConfigured, url: config.sapUrl || "(no configurado)" },
    email: { configured: emailConfigured, user: config.emailUser || "(no configurado)" },
  });
}
