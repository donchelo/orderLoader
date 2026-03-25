/**
 * Step 5: Crear PurchaseOrder en SAP B1.
 *
 * ITEMS_OK → SAP_MONTADO | ERROR_SAP
 */

import fs from "fs";
import path from "path";
import { getConfig } from "../config";
import { getDb, logPipeline } from "../db";
import { getSapClient, clearSapClient } from "../sap-client";
import type { SapB1Order } from "./step1-parse";

export interface StepResult {
  procesados: number;
  errores: number;
  saltados: number;
  detalles: string[];
}

export async function run(): Promise<StepResult> {
  const config = getConfig();
  const result: StepResult = { procesados: 0, errores: 0, saltados: 0, detalles: [] };
  const db = getDb();

  const pendientes = db.prepare(
    "SELECT * FROM pedidos_maestro WHERE estado = 'ITEMS_OK'"
  ).all() as Array<Record<string, unknown>>;

  if (!pendientes.length) {
    result.detalles.push("No hay pedidos en estado ITEMS_OK");
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
    const nit = String(row.nit_cliente);
    const now = new Date().toISOString();

    const cardCode = config.nitToCardCode[nit];
    if (!cardCode) {
      const msg = `NIT '${nit}' no tiene CardCode configurado en nitToCardCode`;
      db.prepare(`UPDATE pedidos_maestro SET estado='ERROR_SAP', error_msg=? WHERE orden_compra=?`)
        .run(msg, oc);
      logPipeline(db, oc, 5, "sap_upload", "ERROR", msg);
      result.errores++;
      result.detalles.push(`✗ OC ${oc}: ${msg}`);
      continue;
    }

    const items = db.prepare(
      "SELECT * FROM pedidos_detalle WHERE orden_compra = ?"
    ).all(oc) as Array<Record<string, unknown>>;

    if (!items.length) {
      const msg = "Sin ítems en DB";
      db.prepare(`UPDATE pedidos_maestro SET estado='ERROR_SAP', error_msg=? WHERE orden_compra=?`).run(msg, oc);
      logPipeline(db, oc, 5, "sap_upload", "ERROR", msg);
      result.errores++;
      result.detalles.push(`✗ OC ${oc}: ${msg}`);
      continue;
    }

    // Comodin (AI-parsed): usar data_extraida.json directamente como payload SAP
    const carpeta = row.carpeta_origen as string | null;
    const markerPath = carpeta ? path.join(carpeta, "data_extraida.json") : null;
    const aiData = markerPath && fs.existsSync(markerPath)
      ? (() => { try { return JSON.parse(fs.readFileSync(markerPath, "utf8")) as SapB1Order; } catch { return null; } })()
      : null;

    const payload = aiData?.DocType === "dDocument_Items"
      ? {
          DocType: aiData.DocType,
          CardCode: aiData.CardCode,
          NumAtCard: aiData.NumAtCard,
          DocDate: aiData.DocDate,
          DocDueDate: aiData.DocDueDate,
          TaxDate: aiData.TaxDate,
          DocumentLines: aiData.DocumentLines.map(l => ({
            SupplierCatNum: l.SupplierCatNum,
            Quantity: l.Quantity,
          })),
        }
      : {
          CardCode: cardCode,
          NumAtCard: oc,
          DocDate: row.fecha_solicitado as string,
          DocumentLines: items.map(it => ({
            ItemCode: it.codigo_producto,
            Quantity: it.cantidad,
            Price: it.precio_unitario,
            ShipDate: it.fecha_entrega || row.fecha_entrega_general,
          })),
        };

    try {
      const response = await sap.post<Record<string, unknown>>("PurchaseOrders", payload);
      const docEntry = response.DocEntry;
      const docNum = String(response.DocNum ?? "");

      db.prepare(`
        UPDATE pedidos_maestro SET
          estado='SAP_MONTADO', sap_doc_entry=?, sap_doc_num=?,
          ts_sap_upload=?, fase_actual=4, error_msg=NULL
        WHERE orden_compra=?
      `).run(docEntry, docNum, now, oc);
      logPipeline(db, oc, 5, "sap_upload", "OK", `DocEntry=${docEntry} DocNum=${docNum}`);
      result.procesados++;
      result.detalles.push(`✓ OC ${oc} → SAP_MONTADO (DocEntry ${docEntry})`);
    } catch (e) {
      db.prepare(`UPDATE pedidos_maestro SET estado='ERROR_SAP', error_msg=? WHERE orden_compra=?`)
        .run(String(e).slice(0, 250), oc);
      logPipeline(db, oc, 5, "sap_upload", "ERROR", String(e).slice(0, 120));
      result.errores++;
      result.detalles.push(`✗ OC ${oc}: ${String(e).slice(0, 120)}`);
    }
  }

  return result;
}
