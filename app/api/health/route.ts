import { NextResponse, NextRequest } from "next/server";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { getSapClient, clearSapClient } from "@/lib/sap-client";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const checkSap = searchParams.get("check_sap") === "true";
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

  // Check SAP config
  const sapConfigured = !!(config.sapUrl && config.sapUser && config.sapPass && config.sapCompany);
  let sapStatus = sapConfigured ? "configured" : "missing_vars";
  let sapError = null;

  if (checkSap && sapConfigured) {
    try {
      // Force a fresh login to test current credentials
      clearSapClient(); 
      await getSapClient();
      sapStatus = "ok";
    } catch (e) {
      sapStatus = "error";
      sapError = String(e);
    }
  }

  const emailConfigured = !!(config.emailUser && config.emailPass && config.emailHost);

  return NextResponse.json({
    ok: dbStatus === "ok" && (!checkSap || sapStatus === "ok"),
    db: { status: dbStatus, pedidos: dbCount },
    sap: { 
      status: sapStatus, 
      configured: sapConfigured, 
      url: config.sapUrl || "(no configurado)",
      error: sapError
    },
    email: { configured: emailConfigured, user: config.emailUser || "(no configurado)" },
  });
}
