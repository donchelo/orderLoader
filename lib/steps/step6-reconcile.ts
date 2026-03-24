/**
 * Step 6: Comparar pedido DB vs SAP B1 (GET PurchaseOrder).
 *
 * SAP_MONTADO → VALIDADO | ERROR_VALIDACION
 */

import { getDb, logPipeline } from "../db";
import { getSapClient, clearSapClient } from "../sap-client";

export interface StepResult {
  procesados: number;
  errores: number;
  saltados: number;
  detalles: string[];
}

function precioDifiere(dbPrecio: number, sapPrecio: number, toleranciaPct = 0.005): boolean {
  if (dbPrecio === 0 && sapPrecio === 0) return false;
  if (dbPrecio === 0) return true;
  return Math.abs(dbPrecio - sapPrecio) / dbPrecio > toleranciaPct;
}

export async function run(): Promise<StepResult> {
  const result: StepResult = { procesados: 0, errores: 0, saltados: 0, detalles: [] };
  const db = getDb();

  const pendientes = db.prepare(
    "SELECT * FROM pedidos_maestro WHERE estado IN ('SAP_MONTADO', 'SAP_VERIFICADO')"
  ).all() as Array<Record<string, unknown>>;

  if (!pendientes.length) {
    result.detalles.push("No hay pedidos en estado SAP_MONTADO / SAP_VERIFICADO");
    return result;
  }

  let sap;
  try {
    sap = await getSapClient();
  } catch (e) {
    result.detalles.push(`SAP no configurado: ${String(e)}`);
    clearSapClient();
    return result;
  }

  for (const row of pendientes) {
    const oc = String(row.orden_compra);
    const docEntry = row.sap_doc_entry;
    const now = new Date().toISOString();

    try {
      const sapOrder = await sap.get<Record<string, unknown>>(`PurchaseOrders(${docEntry})`);
      const sapLines = (sapOrder.DocumentLines as Array<Record<string, unknown>>) ?? [];

      const dbItems = db.prepare(
        "SELECT * FROM pedidos_detalle WHERE orden_compra = ?"
      ).all(oc) as Array<Record<string, unknown>>;

      const discrepancias: Array<Record<string, unknown>> = [];

      for (const dbItem of dbItems) {
        const codigo = String(dbItem.codigo_producto);
        const sapLine = sapLines.find(l => l.ItemCode === codigo);
        if (!sapLine) {
          discrepancias.push({ tipo: "FALTANTE", codigo, detalle: "Línea no encontrada en SAP" });
        } else {
          if (Math.abs(Number(sapLine.Quantity ?? 0) - Number(dbItem.cantidad)) > 0.001) {
            discrepancias.push({ tipo: "CANTIDAD", codigo, db: dbItem.cantidad, sap: sapLine.Quantity });
          }
          if (precioDifiere(Number(dbItem.precio_unitario), Number(sapLine.Price ?? 0))) {
            discrepancias.push({ tipo: "PRECIO", codigo, db: dbItem.precio_unitario, sap: sapLine.Price });
          }
        }
      }

      const dbTotal = dbItems.reduce((s, it) => s + Number(it.subtotal_item ?? 0), 0);
      const resultado = {
        ok: discrepancias.length === 0,
        discrepancias,
        total_db: dbTotal,
        total_sap: sapOrder.DocTotal ?? 0,
      };
      const nuevoEstado = resultado.ok ? "VALIDADO" : "ERROR_VALIDACION";

      db.prepare(`
        UPDATE pedidos_maestro SET estado=?, validacion_resultado=?, ts_validated=?, fase_actual=5
        WHERE orden_compra=?
      `).run(nuevoEstado, JSON.stringify(resultado), now, oc);
      logPipeline(db, oc, 6, "validador", resultado.ok ? "OK" : "ERROR", `${discrepancias.length} discrepancias`);

      if (resultado.ok) {
        result.procesados++;
        result.detalles.push(`✓ OC ${oc} → VALIDADO`);
      } else {
        result.errores++;
        result.detalles.push(`⚠ OC ${oc} → ERROR_VALIDACION (${discrepancias.length} diferencias)`);
      }
    } catch (e) {
      db.prepare(`UPDATE pedidos_maestro SET estado='ERROR_SAP', error_msg=? WHERE orden_compra=?`)
        .run(String(e).slice(0, 250), oc);
      logPipeline(db, oc, 6, "validador", "ERROR", String(e).slice(0, 120));
      result.errores++;
      result.detalles.push(`✗ OC ${oc}: ${String(e).slice(0, 120)}`);
    }
  }

  return result;
}
