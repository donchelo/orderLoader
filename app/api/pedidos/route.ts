import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const estado = searchParams.get("estado");

    const db = getDb();
    const query = estado
      ? "SELECT * FROM pedidos_maestro WHERE estado = ? ORDER BY fecha_recepcion DESC"
      : "SELECT * FROM pedidos_maestro ORDER BY fecha_recepcion DESC";

    const rows = estado ? db.prepare(query).all(estado) : db.prepare(query).all();

    return NextResponse.json({ ok: true, pedidos: rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
