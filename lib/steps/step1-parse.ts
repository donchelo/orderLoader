/**
 * Step 1: PDF → DB (estado PARSED).
 *
 * Escanea pedidos/raw/ buscando carpetas sin data_extraida.json.
 * Por cada PDF encontrado, parsea e inserta en orderloader.db.
 * Es idempotente: carpetas con data_extraida.json se saltan.
 */

import fs from "fs";
import path from "path";
import * as pdfParse from "pdf-parse";
import { getConfig } from "../config";
import { getDb, logPipeline } from "../db";

export interface StepResult {
  procesados: number;
  errores: number;
  saltados: number;
  detalles: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function safeFloat(text: string | undefined): number {
  if (!text) return 0;
  let clean = text.replace(/[^\d,\.]/g, "");
  if (clean.includes(",") && clean.includes(".")) {
    if (clean.lastIndexOf(".") > clean.lastIndexOf(",")) {
      clean = clean.replace(/,/g, "");
    } else {
      clean = clean.replace(/\./g, "").replace(",", ".");
    }
  } else if (clean.includes(",")) {
    clean = clean.replace(",", ".");
  } else if (clean.includes(".")) {
    const parts = clean.split(".");
    if (parts[parts.length - 1].length === 3) {
      clean = clean.replace(/\./g, "");
    }
  }
  return parseFloat(clean) || 0;
}

function normalizeDate(dateStr: string): string {
  const m = dateStr.match(/(\d{2})[./](\d{2})[./](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return dateStr;
}

// ── Parsers por cliente ────────────────────────────────────────────────────

interface ParsedOrder {
  nit: string;
  oc: string;
  fecha_p: string;
  fecha_g: string;
  items: Array<[string, string, number, number, string]>; // [codigo, desc, cantidad, precio, fecha_ent]
  total: number;
  notas: string;
  cliente: string;
}

function parseHermeco(text: string): [ParsedOrder | null, string] {
  const nit = "890924167-6";
  const ocMatch = text.match(/Número\/Number\s+(\d+)/);
  if (!ocMatch) return [null, "OC no encontrada"];
  const oc = ocMatch[1];

  const fechaPMatch = text.match(/Fecha\/Date\s+(\d{2}\/\d{2}\/\d{4})/);
  const fecha_p = fechaPMatch ? normalizeDate(fechaPMatch[1]) : "";

  let notas = "";
  const obsMatch = text.match(/Observaciones:(.*?)MONEDA/s);
  if (obsMatch) notas = obsMatch[1].trim();

  const items: Array<[string, string, number, number, string]> = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^(\d{5})\s+(\d{6})\s+(.*?)\s+(\d{8})\s+.*?\s+UN\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/);
    if (m) {
      const rawF = m[4];
      const fechaEnt = `${rawF.slice(0, 4)}-${rawF.slice(4, 6)}-${rawF.slice(6)}`;
      items.push([m[2], m[3].trim(), safeFloat(m[5]), safeFloat(m[6]), fechaEnt]);
    } else if (line.includes(" UN ")) {
      const parts = line.split(/\s+/);
      const unIdx = parts.indexOf("UN");
      const codM = line.match(/(\d{6})/);
      if (unIdx > 0 && codM) {
        const codigo = codM[1];
        const cantidad = safeFloat(parts[unIdx + 1]);
        const precio = safeFloat(parts[unIdx + 2]);
        const fM = line.match(/(\d{8})/);
        let fechaEnt = "";
        if (fM) {
          const rawF = fM[1];
          fechaEnt = `${rawF.slice(0, 4)}-${rawF.slice(4, 6)}-${rawF.slice(6)}`;
        }
        if (!items.some((it) => it[0] === codigo && it[2] === cantidad)) {
          items.push([codigo, "Revisar Descripción", cantidad, precio, fechaEnt]);
        }
      }
    }
  }

  if (!items.length) return [null, "Sin items detectados"];

  const fechas = items.map((it) => it[4]).filter(Boolean);
  const fecha_g = fechas.length ? fechas.sort().at(-1)! : fecha_p;
  const total = items.reduce((s, it) => s + it[2] * it[3], 0);

  return [{ nit, oc, fecha_p, fecha_g, items, total, notas, cliente: "HERMECO" }, "OK"];
}

function parseComodin(text: string): [ParsedOrder | null, string] {
  const ocMatch = text.match(/Número OC:\s+(\d+)/);
  if (!ocMatch) return [null, "OC no encontrada"];
  const oc = ocMatch[1];

  const fechaEMatch = text.match(/Fecha elaboración:\s+(\d{2}\/\d{2}\/\d{4})/);
  const fecha_p = fechaEMatch ? normalizeDate(fechaEMatch[1]) : "";

  const objMatch = text.match(/TOTAL\s+[\d.]+\s+([\d.]+)/);
  const subtotalObj = objMatch ? safeFloat(objMatch[1]) : 0;

  const items: Array<[string, string, number, number, string]> = [];
  let suma = 0;
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d{11})\s+.*?\s+(\d{2}\.\d{2}\.\d{4})\s+.*?\s+([\d.]+)\s+UN\s+([\d.]+)\s+([\d.]+)/);
    if (m) {
      const fechaEnt = normalizeDate(m[3]);
      const cantidad = safeFloat(m[4]);
      const precio = safeFloat(m[5]);
      const subLinea = safeFloat(m[6]);
      items.push([m[2], "Producto Comodín", cantidad, precio, fechaEnt]);
      suma += subLinea;
    }
  }

  if (!items.length) return [null, "Sin items detectados"];
  if (subtotalObj > 0 && Math.abs(suma - subtotalObj) > 10) {
    return [null, `Total no cuadra: PDF $${subtotalObj.toFixed(0)} vs suma $${suma.toFixed(0)}`];
  }

  return [{
    nit: "800069933", oc, fecha_p,
    fecha_g: items[0][4] || fecha_p,
    items,
    total: subtotalObj || suma,
    notas: "Pedido Comodín",
    cliente: "COMODIN",
  }, "OK"];
}

function parseExito(text: string): [ParsedOrder | null, string] {
  const ocMatch = text.match(/Número de Orden\s+(\d+)/);
  if (!ocMatch) return [null, "OC no encontrada"];
  const oc = ocMatch[1];

  const fpMatch = text.match(/Día\s+Mes\s+Año\s*\n\s*(\d+)\s+(\d+)\s+(\d+)/);
  const fecha_p = fpMatch
    ? `${fpMatch[3]}-${fpMatch[2].padStart(2, "0")}-${fpMatch[1].padStart(2, "0")}`
    : "";

  const feMatch = text.match(/Fecha de Ejecución:\s*(\d{2}\.\d{2}\.\d{4})/);
  const fecha_g = feMatch ? normalizeDate(feMatch[1]) : fecha_p;

  const objMatch = text.match(/Valor Base\s*:\s*([\d.,]+)/);
  const subtotalObj = objMatch ? safeFloat(objMatch[1]) : 0;

  const items: Array<[string, string, number, number, string]> = [];
  let suma = 0;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(\d{5})\s+(\d{7})/.test(line)) {
      const parts = line.split(/\s+/);
      const codigo = parts[1];
      const unIdx = parts.indexOf("UN");
      if (unIdx > 0) {
        const precio = safeFloat(parts[unIdx + 1]);
        const subLinea = safeFloat(parts[unIdx + 2]);
        let cant = 0;
        for (const p of parts.slice(0, unIdx)) {
          if (/^[\d.]+$/.test(p) && p.length > 1) cant = safeFloat(p);
        }
        if (cant === 0 && i + 1 < lines.length) {
          const next = lines[i + 1].split(/\s+/);
          if (next[0] && /^[\d.]+$/.test(next[0])) cant = safeFloat(next[0]);
        }
        if (cant > 0) {
          items.push([codigo, "Producto Éxito", cant, precio, fecha_g]);
          suma += subLinea;
        }
      }
    }
  }

  if (!items.length) return [null, "Sin items detectados"];
  if (subtotalObj > 0 && Math.abs(suma - subtotalObj) > 10) {
    return [null, `Total no cuadra: PDF $${subtotalObj.toFixed(0)} vs suma $${suma.toFixed(0)}`];
  }

  return [{
    nit: "9008516551", oc, fecha_p, fecha_g,
    items,
    total: subtotalObj || suma,
    notas: "Pedido Éxito",
    cliente: "EXITO",
  }, "OK"];
}

const PARSERS: Record<string, (text: string) => [ParsedOrder | null, string]> = {
  Hermeco: parseHermeco,
  Comodin: parseComodin,
  Exito: parseExito,
};

// ── DB helpers ─────────────────────────────────────────────────────────────

function insertOrden(db: ReturnType<typeof getDb>, data: ParsedOrder, carpeta: string): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO pedidos_maestro
      (nit_cliente, orden_compra, fecha_solicitado, fecha_entrega_general,
       cliente_nombre, subtotal, notas, estado, ts_parsed, fase_actual, carpeta_origen)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'PARSED', ?, 1, ?)
  `).run(data.nit, data.oc, data.fecha_p, data.fecha_g, data.cliente, data.total, data.notas, now, carpeta);

  db.prepare("DELETE FROM pedidos_detalle WHERE orden_compra = ?").run(data.oc);
  const insertDetail = db.prepare(`
    INSERT INTO pedidos_detalle
      (orden_compra, codigo_producto, descripcion, cantidad, precio_unitario, subtotal_item, fecha_entrega)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const [codigo, desc, cantidad, precio, fechaEnt] of data.items) {
    insertDetail.run(data.oc, codigo, desc, cantidad, precio, cantidad * precio, fechaEnt);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

export async function run(): Promise<StepResult> {
  const config = getConfig();
  const result: StepResult = { procesados: 0, errores: 0, saltados: 0, detalles: [] };

  if (!fs.existsSync(config.pedidosRawDir)) {
    result.detalles.push("No existe pedidos/raw. Ejecuta step0 primero.");
    return result;
  }

  const db = getDb();
  const ESTADOS_AVANZADOS = new Set([
    "SAP_NUEVO", "ITEMS_OK", "SAP_MONTADO", "CERRADO",
    "ERROR_DUPLICADO", "ERROR_ITEMS", "ERROR_SAP",
  ]);

  for (const [cliente, parser] of Object.entries(PARSERS)) {
    const clienteDir = path.join(config.pedidosRawDir, cliente);
    if (!fs.existsSync(clienteDir)) continue;

    for (const carpetaNombre of fs.readdirSync(clienteDir).sort()) {
      const carpetaPath = path.join(clienteDir, carpetaNombre);
      if (!fs.statSync(carpetaPath).isDirectory()) continue;

      const marker = path.join(carpetaPath, "data_extraida.json");
      if (fs.existsSync(marker)) { result.saltados++; continue; }

      const pdfs = fs.readdirSync(carpetaPath).filter((f) => f.toLowerCase().endsWith(".pdf"));
      if (!pdfs.length) continue;

      const pdfPath = path.join(carpetaPath, pdfs[0]);
      result.detalles.push(`Procesando: ${cliente}/${carpetaNombre}/${pdfs[0]}`);

      try {
        const buffer = fs.readFileSync(pdfPath);
        const parsed = await (pdfParse as unknown as (buf: Buffer) => Promise<{ text: string }>)(buffer);
        const text = parsed.text;

        const [data, status] = parser(text);

        if (!data) {
          result.errores++;
          result.detalles.push(`  ✗ ${status}`);
          try {
            logPipeline(db, carpetaNombre, 1, "parse", "ERROR", `Parse fallido: ${status}`);
          } catch { /* ignore */ }
          continue;
        }

        // Skip if OC already advanced in pipeline
        const existente = db.prepare(
          "SELECT estado FROM pedidos_maestro WHERE orden_compra = ?"
        ).get(data.oc) as { estado: string } | undefined;

        if (existente && ESTADOS_AVANZADOS.has(existente.estado)) {
          result.saltados++;
          result.detalles.push(`  [skip] OC ${data.oc} ya en ${existente.estado}`);
          fs.writeFileSync(marker, JSON.stringify({ oc: data.oc, skip_reason: existente.estado, ts: new Date().toISOString() }, null, 2));
          continue;
        }

        const tx = db.transaction(() => {
          insertOrden(db, data, carpetaPath);
          logPipeline(db, data.oc, 1, "parse", "OK", `PDF: ${pdfs[0]}`);
        });
        tx();

        fs.writeFileSync(marker, JSON.stringify({
          oc: data.oc, cliente: data.cliente, pdf: pdfs[0], ts: new Date().toISOString(),
        }, null, 2));

        result.procesados++;
        result.detalles.push(`  ✓ OC ${data.oc} → PARSED (${data.items.length} items)`);
      } catch (e) {
        result.errores++;
        result.detalles.push(`  ✗ Error: ${String(e)}`);
      }
    }
  }

  return result;
}
