/**
 * Step 6: Enviar correo resumen de pedidos procesados.
 *
 * Recoge todos los pedidos en estado terminal (VALIDADO, ERROR_*…),
 * genera un email HTML con resumen + detalle de discrepancias y lo envía.
 * Transiciona los pedidos a NOTIFICADO para que step7 los archive.
 *
 * VALIDADO | ERROR_* | SAP_MONTADO → NOTIFICADO
 */

import nodemailer from "nodemailer";
import { getConfig } from "../config";
import { getDb, logPipeline } from "../db";

export interface StepResult {
  procesados: number;
  errores: number;
  saltados: number;
  detalles: string[];
}

const ESTADOS_A_NOTIFICAR = [
  "VALIDADO", "SAP_MONTADO",
  "ERROR_DUPLICADO", "ERROR_ITEMS", "ERROR_SAP", "ERROR_PARSE", "ERROR_VALIDACION",
] as const;

const ESTADO_COLOR: Record<string, string> = {
  VALIDADO:          "#d4edda",
  SAP_MONTADO:       "#d4edda",
  ERROR_DUPLICADO:   "#f8d7da",
  ERROR_ITEMS:       "#f8d7da",
  ERROR_SAP:         "#f8d7da",
  ERROR_PARSE:       "#f8d7da",
  ERROR_VALIDACION:  "#fff3cd",
};

const SAP_ERROR_CODES: Record<string, string> = {
  "-1116": "Artículo sin precio en la lista de precios de SAP — pedido NO creado",
  "-8112": "Error en datos del documento (serie de numeración o socio de negocio) — pedido NO creado",
  "-10":   "Sin autorización en SAP — pedido NO creado",
};

function parseSapError(errorMsg: string): string {
  const codeMatch = errorMsg.match(/"code"\s*:\s*"(-?\d+)"/);
  if (codeMatch) {
    const code = codeMatch[1];
    if (SAP_ERROR_CODES[code]) return SAP_ERROR_CODES[code];
    const msgMatch = errorMsg.match(/"message"\s*:\s*"([^"]{4,})"/);
    if (msgMatch) return `Error SAP (${code}): ${msgMatch[1].slice(0, 100)} — pedido NO creado`;
    return `Error SAP (código ${code}) — pedido NO creado`;
  }
  return errorMsg.replace(/Error: SAP \w+ https?:\/\/\S+ → \d+:\s*/i, "").slice(0, 120);
}

function buildDetalle(row: Record<string, unknown>): string {
  const estado = String(row.estado);

  let excluidos: string[] = [];
  try {
    if (row.items_excluidos) excluidos = JSON.parse(String(row.items_excluidos)) as string[];
  } catch { /* ignore */ }
  const exclMsg = excluidos.length
    ? ` — sin precio SAP, no subido(s): ${excluidos.join(", ")}` : "";

  if ((estado === "VALIDADO" || estado === "SAP_MONTADO") && row.sap_doc_num) {
    return `DocNum SAP: ${row.sap_doc_num}${exclMsg}`;
  }

  if (estado === "ERROR_VALIDACION" && row.validacion_resultado) {
    try {
      const r = JSON.parse(String(row.validacion_resultado)) as { diferencias?: unknown[]; docNum?: string };
      const docPart = r.docNum ? ` (DocNum SAP: ${r.docNum})` : "";
      if (r.diferencias?.length) return `${r.diferencias.length} diferencia(s)${docPart} — ver detalle abajo${exclMsg}`;
    } catch { /* ignore */ }
  }

  if (row.error_msg) return parseSapError(String(row.error_msg));

  return "";
}

function buildDiscrepanciasHtml(rows: Array<Record<string, unknown>>): string {
  const conDifs = rows.filter(r => r.estado === "ERROR_VALIDACION" && r.validacion_resultado);
  if (!conDifs.length) return "";

  const secciones = conDifs.map(row => {
    let diferencias: Array<{ campo: string; pdf: string | number; sap: string | number }> = [];
    let docNum = row.sap_doc_num ?? "";
    try {
      const r = JSON.parse(String(row.validacion_resultado)) as {
        diferencias?: typeof diferencias;
        docNum?: string;
      };
      diferencias = r.diferencias ?? [];
      if (r.docNum) docNum = r.docNum;
    } catch { /* ignore */ }

    if (!diferencias.length) return "";

    const filas = diferencias.map(d => {
      const esPrecio = String(d.campo).startsWith("Precio");
      const fmt = (v: string | number) =>
        esPrecio && typeof v === "number"
          ? `$${v.toLocaleString("es-CO")}`
          : String(v);
      const esExcluido = String(d.campo).startsWith("Artículo no subido");
      const rowColor = esExcluido ? "#f8d7da" : "#fff3cd";
      return `<tr style="background:${rowColor}">
        <td style="padding:4px 10px">${d.campo}</td>
        <td style="padding:4px 10px">${fmt(d.pdf)}</td>
        <td style="padding:4px 10px">${fmt(d.sap)}</td>
      </tr>`;
    }).join("");

    return `
    <div style="margin:16px 0;border:1px solid #ffc107;border-radius:4px;overflow:hidden">
      <div style="background:#ffc107;padding:6px 12px;font-weight:bold">
        ⚠ OC ${row.orden_compra}${docNum ? ` — DocNum SAP: ${docNum}` : ""} — Discrepancias
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead style="background:#343a40;color:#fff">
          <tr>
            <th style="padding:6px 10px;text-align:left">Campo</th>
            <th style="padding:6px 10px;text-align:left">PDF</th>
            <th style="padding:6px 10px;text-align:left">SAP</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>`;
  }).join("");

  return `<h3 style="margin-top:24px;margin-bottom:8px">Detalle de discrepancias</h3>${secciones}`;
}

function buildHtml(rows: Array<Record<string, unknown>>, fecha: string): string {
  const filas = rows.map(row => {
    const color = ESTADO_COLOR[String(row.estado)] ?? "#ffffff";
    return `<tr style="background:${color}">
      <td style="padding:6px 12px">${row.orden_compra}</td>
      <td style="padding:6px 12px">${row.cliente_nombre}</td>
      <td style="padding:6px 12px"><b>${row.estado}</b></td>
      <td style="padding:6px 12px">${buildDetalle(row)}</td>
    </tr>`;
  }).join("");

  return `<html><body style="font-family:Arial,sans-serif;font-size:13px">
  <h2 style="margin-bottom:4px">Resumen OrderLoader — ${fecha}</h2>
  <table border="1" cellspacing="0" style="border-collapse:collapse;width:100%;margin-top:12px">
    <thead style="background:#343a40;color:#fff">
      <tr>
        <th style="padding:8px">OC</th>
        <th style="padding:8px">Cliente</th>
        <th style="padding:8px">Estado</th>
        <th style="padding:8px;text-align:left">Detalle</th>
      </tr>
    </thead>
    <tbody>${filas}</tbody>
  </table>
  ${buildDiscrepanciasHtml(rows)}
  <p style="color:#888;font-size:11px;margin-top:16px">
    Generado automáticamente por OrderLoader Pipeline · ${fecha}
  </p>
  </body></html>`;
}

export async function run(): Promise<StepResult> {
  const config = getConfig();
  const result: StepResult = { procesados: 0, errores: 0, saltados: 0, detalles: [] };
  const db = getDb();

  const placeholders = ESTADOS_A_NOTIFICAR.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT * FROM pedidos_maestro WHERE estado IN (${placeholders})`
  ).all(...ESTADOS_A_NOTIFICAR) as Array<Record<string, unknown>>;

  if (!rows.length) {
    result.detalles.push("No hay pedidos pendientes de notificación");
    return result;
  }

  if (!config.emailUser || !config.emailPass || !config.smtpHost) {
    for (const row of rows) {
      logPipeline(db, String(row.orden_compra), 6, "notify", "ERROR",
        "Faltan credenciales SMTP — pedido pendiente de notificación");
    }
    result.errores = rows.length;
    result.detalles.push(`✗ Faltan credenciales SMTP — ${rows.length} pedido(s) sin notificar`);
    return result;
  }

  const fecha = new Date().toISOString().split("T")[0];
  const nOk = rows.filter(r => r.estado === "VALIDADO" || r.estado === "SAP_MONTADO").length;
  const nErr = rows.length - nOk;
  const subject = `[OrderLoader] Resumen pedidos — ${fecha} — ${nOk} OK / ${nErr} errores`;
  const html = buildHtml(rows, fecha);

  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: false,
    auth: { user: config.emailUser, pass: config.emailPass },
  });

  try {
    await transporter.sendMail({
      from: config.emailUser,
      to: config.notifyEmail,
      subject,
      html,
    });

    const now = new Date().toISOString();
    const tx = db.transaction(() => {
      for (const row of rows) {
        db.prepare(`
          UPDATE pedidos_maestro SET estado='NOTIFICADO', ts_notified=?, fase_actual=6
          WHERE orden_compra=?
        `).run(now, row.orden_compra);
        logPipeline(db, String(row.orden_compra), 6, "notify", "OK", `Email → ${config.notifyEmail}`);
      }
    });
    tx();

    result.procesados = rows.length;
    result.detalles.push(`✓ Email enviado a ${config.notifyEmail}: ${rows.length} pedido(s) → NOTIFICADO`);
  } catch (e) {
    result.errores = rows.length;
    result.detalles.push(`✗ Error enviando email: ${String(e)}`);
    for (const row of rows) {
      logPipeline(db, String(row.orden_compra), 6, "notify", "ERROR", String(e).slice(0, 120));
    }
  }

  return result;
}
