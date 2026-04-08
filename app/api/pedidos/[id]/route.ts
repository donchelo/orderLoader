import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = getDb();

    const pedido = db.prepare("SELECT * FROM pedidos_maestro WHERE id = ?").get(id);
    if (!pedido) return NextResponse.json({ ok: false, error: "No encontrado" }, { status: 404 });

    const oc = (pedido as Record<string, unknown>).orden_compra as string;
    const items = db.prepare("SELECT * FROM pedidos_detalle WHERE orden_compra = ? ORDER BY id").all(oc);
    const logs = db.prepare(
      "SELECT * FROM pipeline_log WHERE orden_compra = ? ORDER BY ts DESC LIMIT 30"
    ).all(oc);

    return NextResponse.json({ ok: true, pedido, items, logs });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
