/**
 * Step 3: Verificar si OC existe en SAP B1.
 *
 * PARSE_VALIDO → SAP_NUEVO | ERROR_DUPLICADO
 */

import nodemailer from "nodemailer";
import { getConfig } from "../config";
import { getDb, logPipeline } from "../db";
import { getSapClient, clearSapClient } from "../sap-client";

export interface StepResult {
  procesados: number;
  errores: number;
  saltados: number;
  detalles: string[];
}

async function sendAlertEmail(subject: string, html: string): Promise<void> {
  const config = getConfig();
  if (!config.emailUser || !config.emailPass || !config.smtpHost) return;
  const t = nodemailer.createTransport({
    host: config.smtpHost, port: config.smtpPort,
    secure: false, auth: { user: config.emailUser, pass: config.emailPass },
  });
  await t.sendMail({ from: config.emailUser, to: config.notifyAlertasEmail, subject, html });
}

export async function run(): Promise<StepResult> {
  const result: StepResult = { procesados: 0, errores: 0, saltados: 0, detalles: [] };
  const db = getDb();

  const pendientes = db.prepare(
    "SELECT * FROM pedidos_maestro WHERE estado = 'PARSE_VALIDO'"
  ).all() as Array<Record<string, unknown>>;

  if (!pendientes.length) {
    result.detalles.push("No hay pedidos en estado PARSE_VALIDO");
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
    const cliente = String(row.cliente_nombre || "—");
    const now = new Date().toISOString();
    const fecha = new Date().toISOString().split("T")[0];

    try {
      const res = await sap.get<{ value: Array<Record<string, unknown>> }>(
        "PurchaseOrders",
        { "$filter": `NumAtCard eq '${oc}'`, "$select": "DocEntry,DocNum,DocTotal,CardCode" }
      );
      const valor = res.value ?? [];

      if (valor.length) {
        const doc = valor[0];
        const errorMsg = `OC duplicada en SAP: DocEntry=${doc.DocEntry}, DocNum=${doc.DocNum}`;
        db.prepare(`
          UPDATE pedidos_maestro SET
            estado='ERROR_DUPLICADO', sap_existe=1, sap_doc_entry=?, sap_doc_num=?,
            sap_query_resultado=?, ts_sap_query=?, fase_actual=2, error_msg=?
          WHERE orden_compra=?
        `).run(doc.DocEntry, String(doc.DocNum), JSON.stringify(doc), now, errorMsg, oc);
        logPipeline(db, oc, 3, "sap_query", "ERROR", `Duplicado: DocEntry=${doc.DocEntry}`);
        result.errores++;
        result.detalles.push(`✗ OC ${oc} → ERROR_DUPLICADO (DocEntry ${doc.DocEntry})`);

        const html = `<html><body style="font-family:Arial,sans-serif"><div style="background:#dc3545;color:white;padding:14px 20px">
          <h2>OC Duplicada en SAP B1</h2></div>
          <div style="padding:16px"><table>
            <tr><td><b>OC:</b></td><td>${oc}</td></tr>
            <tr><td><b>Cliente:</b></td><td>${cliente}</td></tr>
            <tr><td><b>DocEntry SAP:</b></td><td>${doc.DocEntry}</td></tr>
            <tr><td><b>DocNum SAP:</b></td><td>${doc.DocNum}</td></tr>
          </table>
          <p>La OC fue marcada como <b>ERROR_DUPLICADO</b> y no se subirá a SAP.</p>
          </div></body></html>`;
        try {
          await sendAlertEmail(`[ERROR OrderLoader] OC ${oc} — Duplicada en SAP B1`, html);
        } catch { /* ignore */ }
      } else {
        db.prepare(`
          UPDATE pedidos_maestro SET
            estado='SAP_NUEVO', sap_existe=0, sap_query_resultado='[]', ts_sap_query=?, fase_actual=2
          WHERE orden_compra=?
        `).run(now, oc);
        logPipeline(db, oc, 3, "sap_query", "OK", "No existe en SAP → SAP_NUEVO");
        result.procesados++;
        result.detalles.push(`✓ OC ${oc} → SAP_NUEVO`);
      }
    } catch (e) {
      db.prepare(`UPDATE pedidos_maestro SET estado='ERROR_SAP', error_msg=? WHERE orden_compra=?`)
        .run(String(e), oc);
      logPipeline(db, oc, 3, "sap_query", "ERROR", String(e).slice(0, 120));
      result.errores++;
      result.detalles.push(`✗ OC ${oc}: ${String(e)}`);
    }
  }

  return result;
}
