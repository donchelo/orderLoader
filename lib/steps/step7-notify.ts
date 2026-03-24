/**
 * Step 7: Enviar correo resumen del pipeline y cerrar pedidos.
 *
 * VALIDADO + errores → email HTML → CERRADO
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
  "ERROR_DUPLICADO", "ERROR_ITEMS", "ERROR_SAP", "ERROR_PARSE",
] as const;

const ESTADO_COLOR: Record<string, string> = {
  VALIDADO: "#d4edda",
  SAP_MONTADO: "#d4edda",
  ERROR_DUPLICADO: "#f8d7da",
  ERROR_ITEMS: "#f8d7da",
  ERROR_SAP: "#f8d7da",
  ERROR_PARSE: "#f8d7da",
};

function buildHtml(rows: Array<Record<string, unknown>>, fecha: string): string {
  const filas = rows.map(row => {
    const color = ESTADO_COLOR[String(row.estado)] ?? "#ffffff";
    const detalle = row.error_msg ? String(row.error_msg).slice(0, 80) : "";
    return `<tr style="background:${color}">
      <td style="padding:6px 12px">${row.orden_compra}</td>
      <td style="padding:6px 12px">${row.cliente_nombre}</td>
      <td style="padding:6px 12px">${row.estado}</td>
      <td style="padding:6px 12px;text-align:right">$${Number(row.subtotal ?? 0).toLocaleString("es-CO")}</td>
      <td style="padding:6px 12px">${detalle}</td>
    </tr>`;
  }).join("");

  return `<html><body style="font-family:Arial,sans-serif;font-size:13px">
  <h2>Resumen de pedidos OrderLoader — ${fecha}</h2>
  <table border="1" cellspacing="0" style="border-collapse:collapse;width:100%">
    <thead style="background:#343a40;color:#fff">
      <tr>
        <th style="padding:8px">OC</th>
        <th style="padding:8px">Cliente</th>
        <th style="padding:8px">Estado</th>
        <th style="padding:8px">Subtotal</th>
        <th style="padding:8px">Detalle</th>
      </tr>
    </thead>
    <tbody>${filas}</tbody>
  </table>
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
    result.detalles.push("Faltan credenciales SMTP en .env.local");
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
          UPDATE pedidos_maestro SET estado='CERRADO', ts_notified=?, fase_actual=6
          WHERE orden_compra=?
        `).run(now, row.orden_compra);
        logPipeline(db, String(row.orden_compra), 7, "notifier", "OK", `Email → ${config.notifyEmail}`);
      }
    });
    tx();

    result.procesados = rows.length;
    result.detalles.push(`✓ Email enviado a ${config.notifyEmail}: ${rows.length} pedidos → CERRADO`);
  } catch (e) {
    result.errores = rows.length;
    result.detalles.push(`✗ Error enviando email: ${String(e)}`);
    for (const row of rows) {
      logPipeline(db, String(row.orden_compra), 7, "notifier", "ERROR", String(e).slice(0, 120));
    }
  }

  return result;
}
