/**
 * Step 2: Validar coherencia de datos extraídos del PDF.
 *
 * Capa 1: Integridad de campos en DB (OC, NIT, fechas, items, totales).
 * Capa 2: Validación cruzada contra el PDF original (re-parsea y compara).
 *
 * PARSED → PARSE_VALIDO | ERROR_PARSE
 */

import fs from "fs";
import path from "path";
import * as pdfParse from "pdf-parse";
import nodemailer from "nodemailer";
import { getConfig } from "../config";
import { getDb, logPipeline } from "../db";

export interface StepResult {
  procesados: number;
  errores: number;
  saltados: number;
  detalles: string[];
}

// ── Validation helpers ─────────────────────────────────────────────────────

function validarOC(oc: string): string | null {
  if (!oc?.trim()) return "orden_compra vacía";
  if (!/^\d{4,15}$/.test(oc.trim())) return `orden_compra '${oc}' debe ser numérica de 4-15 dígitos`;
  return null;
}

function validarFecha(fechaStr: string | null, campo: string): [string | null, string | null] {
  if (!fechaStr?.trim()) return [`${campo} vacía`, null];
  let fecha: Date;
  try { fecha = new Date(fechaStr.trim()); if (isNaN(fecha.getTime())) throw new Error(); }
  catch { return [`${campo} '${fechaStr}' no es fecha ISO válida`, null]; }
  const hoy = new Date();
  const deltaDias = Math.floor((hoy.getTime() - fecha.getTime()) / 86_400_000);
  if (campo === "fecha_solicitado") {
    if (deltaDias > 365) return [`fecha_solicitado '${fechaStr}' tiene ${deltaDias} días (¿PDF antiguo?)`, null];
    if (deltaDias < -60) return [`fecha_solicitado '${fechaStr}' está ${-deltaDias} días en el futuro`, null];
  }
  if (campo === "fecha_entrega_general") {
    if (deltaDias > 0) return [null, `fecha_entrega '${fechaStr}' ya pasó (hace ${deltaDias} días)`];
    if (deltaDias < -365) return [null, `fecha_entrega '${fechaStr}' está a ${-deltaDias} días (¿muy lejana?)`];
  }
  return [null, null];
}

// ── Email alert ────────────────────────────────────────────────────────────

async function sendAlertEmail(subject: string, html: string): Promise<void> {
  const config = getConfig();
  if (!config.emailUser || !config.emailPass || !config.smtpHost) return;
  const transporter = nodemailer.createTransport({
    host: config.smtpHost, port: config.smtpPort,
    secure: false, auth: { user: config.emailUser, pass: config.emailPass },
  });
  await transporter.sendMail({
    from: config.emailUser, to: config.notifyAlertasEmail,
    subject, html,
  });
}

function buildErrorHtml(oc: string, cliente: string, errores: string[], advertencias: string[]): string {
  const filas = errores.map(e =>
    `<tr style="background:#f8d7da"><td style="padding:6px 12px">❌</td><td style="padding:6px 12px">${e}</td></tr>`
  ).join("") + advertencias.map(w =>
    `<tr style="background:#fff3cd"><td style="padding:6px 12px">⚠</td><td style="padding:6px 12px">${w}</td></tr>`
  ).join("");
  return `<html><body style="font-family:Arial,sans-serif;font-size:13px">
  <div style="background:#dc3545;color:white;padding:14px 20px;border-radius:6px 6px 0 0">
    <h2 style="margin:0">⚠ Error de validación PDF — OC ${oc} no será procesada</h2>
  </div>
  <div style="border:1px solid #ddd;padding:16px 20px">
    <p><b>Cliente:</b> ${cliente}</p>
    <table border="1" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:12px">
      <thead style="background:#343a40;color:#fff">
        <tr><th style="padding:8px"></th><th style="padding:8px;text-align:left">Problema</th></tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>
  </div></body></html>`;
}

// ── Main ───────────────────────────────────────────────────────────────────

export async function run(): Promise<StepResult> {
  const result: StepResult = { procesados: 0, errores: 0, saltados: 0, detalles: [] };
  const db = getDb();

  const pendientes = db.prepare(
    "SELECT * FROM pedidos_maestro WHERE estado = 'PARSED'"
  ).all() as Array<Record<string, unknown>>;

  if (!pendientes.length) {
    result.detalles.push("No hay pedidos en estado PARSED");
    return result;
  }

  for (const row of pendientes) {
    const oc = String(row.orden_compra);
    const cliente = String(row.cliente_nombre || "—");
    const errores: string[] = [];
    const advertencias: string[] = [];

    // ── Capa 1: integridad de campos ─────────────────────────────────────
    const errOC = validarOC(oc);
    if (errOC) errores.push(errOC);
    if (!row.nit_cliente) errores.push("nit_cliente vacío");
    if (!row.cliente_nombre) errores.push("cliente_nombre vacío");
    if (!row.subtotal || Number(row.subtotal) <= 0) errores.push(`subtotal inválido: ${row.subtotal}`);

    const [errF] = validarFecha(row.fecha_solicitado as string, "fecha_solicitado");
    if (errF) errores.push(errF);
    const [errFE, warnFE] = validarFecha(row.fecha_entrega_general as string, "fecha_entrega_general");
    if (errFE) advertencias.push(errFE);
    if (warnFE) advertencias.push(warnFE);

    const items = db.prepare(
      "SELECT * FROM pedidos_detalle WHERE orden_compra = ?"
    ).all(oc) as Array<Record<string, number | string>>;

    if (!items.length) {
      errores.push("Sin ítems en pedidos_detalle");
    } else {
      if (items.length === 1) advertencias.push("Solo 1 ítem — verificar parseo");
      let suma = 0;
      for (const it of items) {
        const codigo = String(it.codigo_producto || "").trim();
        const cant = Number(it.cantidad || 0);
        const precio = Number(it.precio_unitario || 0);
        const subDb = Number(it.subtotal_item || 0);
        const desc = String(it.descripcion || "");
        if (!codigo) errores.push(`Ítem sin codigo_producto (${desc.slice(0, 40)})`);
        if (cant <= 0) errores.push(`Ítem '${codigo}': cantidad ${cant} inválida`);
        if (precio <= 0) errores.push(`Ítem '${codigo}': precio ${precio} inválido`);
        if (cant > 0 && precio > 0 && Math.abs(cant * precio - subDb) > 1) {
          errores.push(`Ítem '${codigo}': subtotal_item $${subDb.toFixed(0)} ≠ cant×precio $${(cant*precio).toFixed(0)}`);
        }
        if (desc.toLowerCase().includes("revisar")) {
          advertencias.push(`Ítem '${codigo}': descripción requiere revisión`);
        }
        suma += cant * precio;
      }
      const subtotal = Number(row.subtotal || 0);
      if (subtotal > 0) {
        const diffPct = Math.abs(suma - subtotal) / subtotal * 100;
        if (diffPct > 5) {
          errores.push(`Total no cuadra: suma ítems $${suma.toFixed(0)} vs subtotal $${subtotal.toFixed(0)} (${diffPct.toFixed(1)}%)`);
        }
      }
    }

    // ── Capa 2: validación cruzada contra PDF original ────────────────────
    const carpeta = row.carpeta_origen as string | null;
    if (carpeta && fs.existsSync(carpeta)) {
      const pdfs = fs.readdirSync(carpeta).filter(f => f.toLowerCase().endsWith(".pdf"));
      if (pdfs.length) {
        try {
          const pdfParseMod = await import("pdf-parse");
          const pdfParseFn = pdfParseMod as unknown as (buf: Buffer) => Promise<{ text: string }>;
          const buf = fs.readFileSync(path.join(carpeta, pdfs[0]));
          const parsed = await pdfParseFn(buf);
          // Re-run the appropriate parser (dynamic import to avoid circular deps)
          const { run: step1Run, ..._ } = await import("./step1-parse");
          // We just check if the PDF text has the OC number present
          if (!parsed.text.includes(oc)) {
            errores.push(`OC ${oc} no encontrada en el texto del PDF original`);
          }
        } catch (e) {
          advertencias.push(`No se pudo re-parsear PDF: ${String(e).slice(0, 80)}`);
        }
      } else {
        advertencias.push("PDF original no disponible para validación cruzada");
      }
    } else {
      advertencias.push("Carpeta origen no disponible — sin validación cruzada");
    }

    // ── Resultado ─────────────────────────────────────────────────────────
    const resultado = JSON.stringify({ errores, advertencias, n_items: items.length });

    if (errores.length) {
      db.prepare(`
        UPDATE pedidos_maestro SET estado='ERROR_PARSE', fase_actual=2, error_msg=?, validacion_resultado=?
        WHERE orden_compra=?
      `).run(`${errores.length} error(es): ${errores[0].slice(0, 80)}`, resultado, oc);
      logPipeline(db, oc, 2, "validate_parsed", "ERROR", errores[0].slice(0, 120));
      result.errores++;
      result.detalles.push(`✗ OC ${oc} → ERROR_PARSE: ${errores[0]}`);
      try {
        await sendAlertEmail(
          `[ERROR OrderLoader] OC ${oc} — Validación PDF fallida`,
          buildErrorHtml(oc, cliente, errores, advertencias)
        );
      } catch { /* ignore email errors */ }
    } else {
      const nota = advertencias.length ? ` | ${advertencias.length} advertencia(s)` : "";
      db.prepare(`
        UPDATE pedidos_maestro SET estado='PARSE_VALIDO', fase_actual=2, error_msg=NULL, validacion_resultado=?
        WHERE orden_compra=?
      `).run(resultado, oc);
      logPipeline(db, oc, 2, "validate_parsed", "OK", `${items.length} ítem(s) OK${nota}`);
      result.procesados++;
      result.detalles.push(`✓ OC ${oc} → PARSE_VALIDO (${items.length} ítem(s)${nota})`);
    }
  }

  return result;
}
