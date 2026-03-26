/**
 * Step 7: Enviar correo resumen del pipeline y cerrar pedidos.
 *
 * VALIDADO + errores → email HTML → CERRADO
 */

import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
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

function buildDetalle(row: Record<string, unknown>): string {
  const estado = String(row.estado);

  // VALIDADO: mostrar DocNum SAP
  if (estado === "VALIDADO" && row.sap_doc_num) {
    return `DocNum SAP: ${row.sap_doc_num}`;
  }

  // ERROR_VALIDACION: listar diferencias PDF vs SAP
  if (estado === "ERROR_VALIDACION" && row.validacion_resultado) {
    try {
      const r = JSON.parse(String(row.validacion_resultado)) as { diferencias?: Array<{ campo: string; pdf: string | number; sap: string | number }> };
      if (r.diferencias?.length) {
        return r.diferencias
          .map(d => `${d.campo}: PDF=${d.pdf} / SAP=${d.sap}`)
          .join(" | ")
          .slice(0, 200);
      }
    } catch { /* ignore */ }
  }

  // Demás errores: error_msg
  return row.error_msg ? String(row.error_msg).slice(0, 120) : "";
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

    // Mover correos originales de INBOX → INBOX.Ingresados
    const uids: number[] = [];
    for (const row of rows) {
      const carpeta = row.carpeta_origen as string | null;
      if (!carpeta) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(carpeta, "correo_metadata.json"), "utf8"));
        if (meta.imap_uid) uids.push(Number(meta.imap_uid));
      } catch { /* metadata no disponible */ }
    }

    if (uids.length > 0) {
      try {
        const imap = new ImapFlow({
          host: config.emailHost, port: config.emailPort, secure: true,
          auth: { user: config.emailUser, pass: config.emailPass },
          logger: false,
        });
        await imap.connect();
        const lock = await imap.getMailboxLock("INBOX");
        try {
          try { await imap.mailboxCreate("INBOX/Ingresados"); } catch { /* ya existe */ }
          await imap.messageMove(uids.map(String).join(","), "INBOX/Ingresados", { uid: true });
          result.detalles.push(`✓ ${uids.length} correo(s) movidos a INBOX/Ingresados`);
        } finally {
          lock.release();
        }
        await imap.logout();
      } catch (e) {
        result.detalles.push(`⚠ No se pudo mover correo(s) IMAP: ${String(e).slice(0, 80)}`);
      }
    }

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
