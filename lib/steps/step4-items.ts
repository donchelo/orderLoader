/**
 * Step 4: Confirmar que hay ítems en el pedido y avanzar a ITEMS_OK.
 *
 * La validación de existencia en SAP ocurre en step 5 cuando se postea la orden.
 * SAP resuelve SupplierCatNum → ItemCode internamente.
 *
 * SAP_NUEVO → ITEMS_OK | ERROR_ITEMS
 */

import { getDb, logPipeline } from "../db";

export interface StepResult {
  procesados: number;
  errores: number;
  saltados: number;
  detalles: string[];
}

export async function run(): Promise<StepResult> {
  const result: StepResult = { procesados: 0, errores: 0, saltados: 0, detalles: [] };
  const db = getDb();

  const pendientes = db.prepare(
    "SELECT * FROM pedidos_maestro WHERE estado = 'SAP_NUEVO'"
  ).all() as Array<Record<string, unknown>>;

  if (!pendientes.length) {
    result.detalles.push("No hay pedidos en estado SAP_NUEVO");
    return result;
  }

  for (const row of pendientes) {
    const oc = String(row.orden_compra);

    const items = db.prepare(
      "SELECT * FROM pedidos_detalle WHERE orden_compra = ?"
    ).all(oc) as Array<Record<string, unknown>>;

    if (!items.length) {
      db.prepare(`UPDATE pedidos_maestro SET estado='ERROR_ITEMS', error_msg=? WHERE orden_compra=?`)
        .run("Sin ítems en pedidos_detalle", oc);
      logPipeline(db, oc, 4, "items_validator", "ERROR", "Sin ítems en pedidos_detalle");
      result.errores++;
      result.detalles.push(`✗ OC ${oc} → ERROR_ITEMS (sin ítems)`);
      continue;
    }

    db.prepare(`UPDATE pedidos_maestro SET estado='ITEMS_OK', fase_actual=3, error_msg=NULL WHERE orden_compra=?`)
      .run(oc);
    logPipeline(db, oc, 4, "items_validator", "OK", `${items.length} artículo(s) listos para SAP`);
    result.procesados++;
    result.detalles.push(`✓ OC ${oc} → ITEMS_OK (${items.length} artículos)`);
  }

  return result;
}
