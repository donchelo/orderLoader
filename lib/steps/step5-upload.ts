/**
 * Step 5: Crear Sales Order en SAP B1.
 *
 * Lee data_extraida.json y sube directamente a Orders con SupplierCatNum + Quantity.
 * SAP resuelve el item internamente. No se envía precio.
 *
 * ITEMS_OK → SAP_MONTADO | ERROR_SAP
 */

import fs from "fs";
import path from "path";
import { getDb, logPipeline } from "../db";
import { getSapClient, clearSapClient } from "../sap-client";
import type { SapB1Order } from "./step1-parse";

export interface StepResult {
  procesados: number;
  errores: number;
  saltados: number;
  detalles: string[];
}

function yyyymmddToIso(d: string): string {
  if (/^\d{8}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
  return d;
}

export async function run(): Promise<StepResult> {
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
    const now = new Date().toISOString();

    // Leer data_extraida.json — fuente autoritativa del AI
    const carpeta = row.carpeta_origen as string | null;
    const markerPath = carpeta ? path.join(carpeta, "data_extraida.json") : null;

    if (!markerPath || !fs.existsSync(markerPath)) {
      const msg = "data_extraida.json no encontrado";
      db.prepare(`UPDATE pedidos_maestro SET estado='ERROR_SAP', error_msg=? WHERE orden_compra=?`).run(msg, oc);
      logPipeline(db, oc, 5, "sap_upload", "ERROR", msg);
      result.errores++;
      result.detalles.push(`✗ OC ${oc}: ${msg}`);
      continue;
    }

    let aiData: SapB1Order;
    try {
      aiData = JSON.parse(fs.readFileSync(markerPath, "utf8")) as SapB1Order;
    } catch (e) {
      const msg = `data_extraida.json inválido: ${String(e).slice(0, 80)}`;
      db.prepare(`UPDATE pedidos_maestro SET estado='ERROR_SAP', error_msg=? WHERE orden_compra=?`).run(msg, oc);
      logPipeline(db, oc, 5, "sap_upload", "ERROR", msg);
      result.errores++;
      result.detalles.push(`✗ OC ${oc}: ${msg}`);
      continue;
    }

    const payload = {
      CardCode:   aiData.CardCode,
      NumAtCard:  aiData.NumAtCard,
      DocDate:    yyyymmddToIso(aiData.DocDate),
      DocDueDate: yyyymmddToIso(aiData.DocDueDate),
      TaxDate:    yyyymmddToIso(aiData.TaxDate),
      DocumentLines: aiData.DocumentLines.map(l => ({
        SupplierCatNum: l.SupplierCatNum,
        Quantity:       l.Quantity,
      })),
    };

    try {
      const response = await sap.post<Record<string, unknown>>("Orders", payload);
      const docEntry = response.DocEntry;
      const docNum = String(response.DocNum ?? "");

      db.prepare(`
        UPDATE pedidos_maestro SET
          estado='SAP_MONTADO', sap_doc_entry=?, sap_doc_num=?,
          ts_sap_upload=?, fase_actual=5, error_msg=NULL
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
