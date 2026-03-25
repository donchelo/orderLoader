/**
 * Step 1: PDF → DB (estado PARSED).
 *
 * Comodin: Claude AI extrae directamente el JSON SAP B1.
 * Es idempotente: carpetas con data_extraida.json se saltan.
 */

import fs from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import { getConfig } from "../config";
import { getDb, logPipeline } from "../db";

export interface StepResult {
  procesados: number;
  errores: number;
  saltados: number;
  detalles: string[];
}

// ── SAP B1 output schema ─────────────────────────────────────────────────────

export interface DocumentLine {
  SupplierCatNum: string;
  Quantity: number;
}

export interface SapB1Order {
  DocType: "dDocument_Items";
  NumAtCard: string;
  CardCode: string;
  DocDate: string;    // YYYYMMDD
  DocDueDate: string; // YYYYMMDD
  TaxDate: string;    // YYYYMMDD
  DocumentLines: DocumentLine[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function yyyymmddToIso(d: string): string {
  if (/^\d{8}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
  return d;
}

// ── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `# PURCHASE ORDER EXTRACTION AGENT

## ROLE
You are a Purchase Order Analyzer specialized in extracting structured information from purchase documents and converting it to JSON format with absolute precision.

## OBJECTIVE
Analyze the provided purchase order document and generate a JSON object that faithfully replicates all contained information, following the defined schema without errors or omissions.

## EXTRACTION PROCESS

### 1. INITIAL ANALYSIS
* Completely examine the purchase order document
* Identify and count the total number of unique items/products
* Navigate to the last page to locate the summary totals
* Extract the total number of items and total amount as displayed (do not calculate, only copy)
* Mentally record this information for subsequent validation

### 2. DATA EXTRACTION
* **Buyer information**: NIT and relevant data
* **Order details**:
  * Order number (NumAtCard)
  * General delivery date (DocDueDate)
  * Document date (DocDate) → Corresponds to the "fecha de elaboración" in the PDF
  * Tax date (TaxDate) → Corresponds to the "fecha de la factura" or invoice/tax reference date in the PDF
* **Individual items**: For each product extract:
  * Product code/reference (SupplierCatNum)
  * Requested quantity (Quantity)

### 3. DATA TRANSFORMATION
Apply these mandatory conversion rules:

**Dates**: Convert to YYYYMMDD format exclusively (e.g., March 25, 2026 → "20260325")

**Buyer NIT (CardCode)**: Always use "CN800069933" regardless of original value

**Numbers** (CRITICAL FOR CONSISTENCY):
* Remove thousand separators: "5.300" → 5300
* Quantity (Quantity): Values like "1.000" mean one thousand units, not one. Remove the thousand separator and convert to integer.
  * "1.000" → 1000
  * "9.000" → 9000
  * "126.000" → 126000
* For integers: Use whole numbers without decimals: 6000 (not 6000.00)

**Missing fields**: Use empty string ""

### 4. JSON FORMATTING RULES
**CRITICAL**: Ensure proper JSON syntax:
* No trailing commas before closing brackets
* Proper number formatting without quotes: 6000 not "6000"
* No special characters that break JSON parsing
* DocType is always the fixed string "dDocument_Items"

### 5. FINAL VALIDATION
Before generating the response, verify:
* Item count in DocumentLines matches exactly with initial count
* All required fields are present
* Date formats are correct (YYYYMMDD)
* CardCode is "CN800069933"
* DocType is "dDocument_Items"
* Quantities correctly reflect thousands (e.g., "126.000" → 126000)
* Valid JSON syntax (no trailing commas, proper brackets)

## RESPONSE FORMAT
**CRITICAL INSTRUCTION**: Your response must contain ONLY the JSON object. Do not include:
* Explanations
* Comments
* Additional text
* Markdown code blocks
* Confirmations`;

// ── AI Parser (Comodin) ──────────────────────────────────────────────────────

async function parseComodinWithAI(pdfText: string): Promise<[SapB1Order | null, string]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [null, "ANTHROPIC_API_KEY no configurado en .env"];

  const client = new Anthropic({ apiKey });

  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: pdfText }],
  });

  const text = msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
  if (!text) return [null, "Respuesta vacía del modelo"];

  // Strip markdown code fences if model includes them despite instructions
  const clean = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();

  try {
    const order = JSON.parse(clean) as SapB1Order;
    if (!order.NumAtCard) return [null, "JSON inválido: falta NumAtCard"];
    if (!Array.isArray(order.DocumentLines) || !order.DocumentLines.length) {
      return [null, "JSON inválido: DocumentLines vacío"];
    }
    return [order, "OK"];
  } catch (e) {
    return [null, `JSON parse error: ${String(e).slice(0, 80)} | Respuesta: ${clean.slice(0, 200)}`];
  }
}

// ── DB helpers ───────────────────────────────────────────────────────────────

function insertSapOrder(
  db: ReturnType<typeof getDb>,
  order: SapB1Order,
  carpeta: string
): void {
  const now = new Date().toISOString();
  const nit = order.CardCode.replace(/^CN/, "");
  const fechaP = yyyymmddToIso(order.DocDate);
  const fechaG = yyyymmddToIso(order.DocDueDate);

  db.prepare(`
    INSERT OR REPLACE INTO pedidos_maestro
      (nit_cliente, orden_compra, fecha_solicitado, fecha_entrega_general,
       cliente_nombre, subtotal, notas, estado, ts_parsed, fase_actual, carpeta_origen)
    VALUES (?, ?, ?, ?, 'COMODIN', 0, ?, 'PARSED', ?, 1, ?)
  `).run(nit, order.NumAtCard, fechaP, fechaG, `TaxDate:${order.TaxDate}`, now, carpeta);

  db.prepare("DELETE FROM pedidos_detalle WHERE orden_compra = ?").run(order.NumAtCard);

  const ins = db.prepare(`
    INSERT INTO pedidos_detalle
      (orden_compra, codigo_producto, descripcion, cantidad, precio_unitario, subtotal_item, fecha_entrega)
    VALUES (?, ?, '', ?, 0, 0, ?)
  `);
  for (const line of order.DocumentLines) {
    ins.run(order.NumAtCard, line.SupplierCatNum, line.Quantity, fechaG);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

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

  const clienteDir = path.join(config.pedidosRawDir, "Comodin");
  if (!fs.existsSync(clienteDir)) {
    result.detalles.push("No existe pedidos/raw/Comodin");
    return result;
  }

  for (const carpetaNombre of fs.readdirSync(clienteDir).sort()) {
    const carpetaPath = path.join(clienteDir, carpetaNombre);
    if (!fs.statSync(carpetaPath).isDirectory()) continue;

    const marker = path.join(carpetaPath, "data_extraida.json");
    if (fs.existsSync(marker)) { result.saltados++; continue; }

    const pdfs = fs.readdirSync(carpetaPath).filter(f => f.toLowerCase().endsWith(".pdf"));
    if (!pdfs.length) continue;

    const pdfPath = path.join(carpetaPath, pdfs[0]);
    result.detalles.push(`Procesando: Comodin/${carpetaNombre}/${pdfs[0]}`);

    try {
      const buffer = fs.readFileSync(pdfPath);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParseFn = require("pdf-parse/lib/pdf-parse") as (buf: Buffer) => Promise<{ text: string }>;
      const parsed = await pdfParseFn(buffer);

      const [order, status] = await parseComodinWithAI(parsed.text);

      if (!order) {
        result.errores++;
        result.detalles.push(`  ✗ ${status}`);
        logPipeline(db, carpetaNombre, 1, "parse", "ERROR", `AI parse fallido: ${status}`);
        continue;
      }

      // Saltar si OC ya avanzó en el pipeline
      const existente = db.prepare(
        "SELECT estado FROM pedidos_maestro WHERE orden_compra = ?"
      ).get(order.NumAtCard) as { estado: string } | undefined;

      if (existente && ESTADOS_AVANZADOS.has(existente.estado)) {
        result.saltados++;
        result.detalles.push(`  [skip] OC ${order.NumAtCard} ya en ${existente.estado}`);
        fs.writeFileSync(marker, JSON.stringify(
          { ...order, skip_reason: existente.estado, ts: new Date().toISOString() }, null, 2
        ));
        continue;
      }

      const tx = db.transaction(() => {
        insertSapOrder(db, order, carpetaPath);
        logPipeline(db, order.NumAtCard, 1, "parse", "OK", `PDF: ${pdfs[0]}`);
      });
      tx();

      // data_extraida.json contiene el payload SAP B1 listo para usar en step5
      fs.writeFileSync(marker, JSON.stringify(
        { ...order, pdf: pdfs[0], ts: new Date().toISOString() }, null, 2
      ));

      result.procesados++;
      result.detalles.push(`  ✓ OC ${order.NumAtCard} → PARSED (${order.DocumentLines.length} items)`);
    } catch (e) {
      result.errores++;
      result.detalles.push(`  ✗ Error: ${String(e)}`);
    }
  }

  return result;
}
