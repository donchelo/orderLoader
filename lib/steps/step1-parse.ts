/**
 * Step 1: PDF → DB (estado PARSED).
 *
 * Comodin + Exito: Claude AI extrae directamente el JSON SAP B1.
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

// ── Prompts por cliente ───────────────────────────────────────────────────────

const PROMPT_COMODIN = `# PURCHASE ORDER EXTRACTION AGENT

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
  * Document date (DocDate) → Today's date at time of processing (NOT from the document)
  * Tax date (TaxDate) → Corresponds to the "fecha de elaboración" or document date printed on the PDF
* **Individual items**: For each product extract:
  * Product code/reference (SupplierCatNum) — **remove any leading zeros** (e.g., "014007383001" → "14007383001")
  * Requested quantity (Quantity)

### 3. DATA TRANSFORMATION
Apply these mandatory conversion rules:

**Dates**: Convert to YYYYMMDD format exclusively (e.g., March 25, 2026 → "20260325")

**Buyer NIT (CardCode)**: Always use "CN800069933" regardless of original value

**DocDate**: Always use today's date at time of processing in YYYYMMDD format (NOT any date from the document)

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
* DocDate is today's date at time of processing (NOT from the document)
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

const PROMPT_EXITO = `# PURCHASE ORDER EXTRACTION AGENT
## ROLE
You are a Purchase Order Analyzer specialized in extracting structured information
from purchase documents and converting it to JSON format with absolute precision
for SAP Business One API integration.

## OBJECTIVE
Analyze the provided purchase order document and generate a JSON object following
the SAP B1 schema defined below. Output must be valid JSON only — no explanations,
no markdown, no comments.

## EXTRACTION PROCESS

### 1. INITIAL ANALYSIS
- Completely examine the purchase order document
- Identify all unique line items/products
- Locate the order emission date, delivery date, and line item codes/quantities
- Mentally record item count for validation

### 2. DATA EXTRACTION
Extract the following from the document:
- **Order number**: Supplier's purchase order reference number
- **OC emission date**: Date printed on the purchase order document → maps to TaxDate
- **Delivery date**: General/expected delivery date → maps to DocDueDate
- **Today's date**: The current date at time of processing → maps to DocDate
- **Individual line items**: For each product:
  - Supplier catalog number / product code
  - Ordered quantity

### 3. DATA TRANSFORMATION

**MANDATORY RULES:**

**Dates — ALL dates use YYYYMMDD format (no separators, no slashes, no dashes)**
- Example: March 25, 2026 → \`"20260325"\`
- \`DocDate\` = today's date at time of processing (NOT from the document)
- \`TaxDate\` = emission date printed on the OC document
- \`DocDueDate\` = delivery date from the OC document

**CardCode**: ALWAYS \`"CN890900608"\` — no exceptions, regardless of document content.

**DocType**: ALWAYS \`"dDocument_Items"\` — fixed constant.

**Quantities**: Whole integers only — \`6000\` not \`6000.00\`. Remove thousand separators: \`"6.000"\` → \`6000\`.

**Missing fields**: Use empty string \`""\`

### 4. FIELD MAPPING

| Source                          | JSON Field          | Notes                          |
|---------------------------------|---------------------|--------------------------------|
| Fixed constant                  | \`DocType\`           | Always \`"dDocument_Items"\`     |
| OC reference/order number       | \`NumAtCard\`         | String                         |
| Fixed constant                  | \`CardCode\`          | Always \`"CN890900608"\`         |
| Today's date (processing date)  | \`DocDate\`           | YYYYMMDD — NOT from document   |
| OC delivery date                | \`DocDueDate\`        | YYYYMMDD — from document       |
| OC emission date (printed date) | \`TaxDate\`           | YYYYMMDD — from document       |
| Item product/catalog code       | \`DocumentLines[].SupplierCatNum\` | String              |
| Item quantity                   | \`DocumentLines[].Quantity\`       | Integer             |

### 5. FINAL VALIDATION
Before responding, verify:
- ✅ \`DocDate\` is today's date in YYYYMMDD (not a date from the document)
- ✅ \`TaxDate\` is the OC emission date in YYYYMMDD
- ✅ \`DocDueDate\` is the delivery date in YYYYMMDD
- ✅ \`CardCode\` is exactly \`"CN890900608"\`
- ✅ \`DocType\` is exactly \`"dDocument_Items"\`
- ✅ \`DocumentLines\` contains one entry per unique line item
- ✅ All quantities are whole integers without decimals
- ✅ Valid JSON syntax — no trailing commas, no extra fields

## RESPONSE FORMAT
Your response must contain ONLY the JSON object.
No explanations. No comments. No markdown. No preamble. No confirmations.`;

const PROMPT_HERMECO = `# PURCHASE ORDER EXTRACTION AGENT
## ROLE
You are a Purchase Order Analyzer specialized in extracting structured information from purchase documents and converting it to JSON format with absolute precision for SAP Business One integration.

## OBJECTIVE
Analyze the provided purchase order document and generate a JSON object following the SAP B1 schema defined below, without errors or omissions.

## EXTRACTION PROCESS

### 1. INITIAL ANALYSIS
- Examine the purchase order document completely
- Identify: order number, dates, buyer code, and all line items with their codes and quantities
- Navigate to the last page to locate summary totals

### 2. DATA EXTRACTION
- **Order number** (NumAtCard): The purchase order number issued by the buyer
- **Buyer code** (CardCode): The buyer's NIT/code as it appears in the document — **MUST always be formatted as "CN" followed by the numeric NIT without hyphens or spaces**
- **Document date** (DocDate): The date the order was issued
- **Delivery date** (DocDueDate): The requested delivery date
- **Tax date** (TaxDate): The invoice/tax reference date (use document date if not explicitly stated)
- **Line items**: For each product extract:
  - Supplier catalog number / product code (SupplierCatNum) — **remove any leading zeros** (e.g., "0201931" → "201931")
  - Ordered quantity (Quantity)

### 3. DATA TRANSFORMATION

**MANDATORY conversion rules:**

**Dates**: Convert ALL dates to YYYYMMDD format (e.g., March 25 2026 → "20260325")

**CardCode** (CRITICAL):
- Extract the buyer's NIT from the document
- Format ALWAYS as: "CN" + numeric digits only, no hyphens, no spaces, no check digit separator
- Example: NIT "890.924.167-6" → "CN890924167"

**DocType**: Always use the fixed value \`"dDocument_Items"\` — no exceptions

**Quantities**: Use whole numbers without decimals (6000 not 6000.00)

**Missing fields**: Use empty string \`""\`

### 4. JSON FORMATTING RULES
- No trailing commas before closing brackets
- Numbers without quotes: \`6000\` not \`"6000"\`
- Dates as strings in quotes: \`"20260325"\`
- No special characters that break JSON parsing

### 5. FINAL VALIDATION
Before generating the response, verify:
- ✅ DocType is exactly \`"dDocument_Items"\`
- ✅ CardCode starts with "CN" followed by digits only
- ✅ All dates are in YYYYMMDD format (8 digits, no separators)
- ✅ Quantities are whole numbers (no decimals)
- ✅ DocumentLines array contains one object per unique line item
- ✅ SupplierCatNum values have NO leading zeros (e.g., "0201931" → "201931")
- ✅ Valid JSON syntax

## RESPONSE FORMAT
**CRITICAL**: Your response must contain ONLY the JSON object. No explanations, no comments, no markdown, no preamble.`;

// ── AI Parser ─────────────────────────────────────────────────────────────────

async function parseWithAI(pdfText: string, prompt: string): Promise<[SapB1Order | null, string]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [null, "ANTHROPIC_API_KEY no configurado en .env"];

  const client = new Anthropic({ apiKey });

  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    temperature: 0,
    system: prompt,
    messages: [{ role: "user", content: pdfText }],
  });

  const text = msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
  if (!text) return [null, "Respuesta vacía del modelo"];

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
  carpeta: string,
  clienteNombre: string
): void {
  const now = new Date().toISOString();
  const nit = order.CardCode.replace(/^CN/, "");
  const fechaP = yyyymmddToIso(order.DocDate);
  const fechaG = yyyymmddToIso(order.DocDueDate);

  db.prepare(`
    INSERT OR REPLACE INTO pedidos_maestro
      (nit_cliente, orden_compra, fecha_solicitado, fecha_entrega_general,
       cliente_nombre, subtotal, notas, estado, ts_parsed, fase_actual, carpeta_origen)
    VALUES (?, ?, ?, ?, ?, 0, ?, 'PARSED', ?, 1, ?)
  `).run(nit, order.NumAtCard, fechaP, fechaG, clienteNombre, `TaxDate:${order.TaxDate}`, now, carpeta);

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

// ── Clientes soportados ───────────────────────────────────────────────────────

const CLIENTES: Array<{ carpeta: string; nombre: string; prompt: string }> = [
  { carpeta: "Comodin", nombre: "COMODIN", prompt: PROMPT_COMODIN },
  { carpeta: "Exito",   nombre: "EXITO",   prompt: PROMPT_EXITO   },
  { carpeta: "Hermeco", nombre: "HERMECO", prompt: PROMPT_HERMECO },
];

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

  for (const { carpeta, nombre, prompt } of CLIENTES) {
    const clienteDir = path.join(config.pedidosRawDir, carpeta);
    if (!fs.existsSync(clienteDir)) continue;

    for (const carpetaNombre of fs.readdirSync(clienteDir).sort()) {
      const carpetaPath = path.join(clienteDir, carpetaNombre);
      if (!fs.statSync(carpetaPath).isDirectory()) continue;

      const marker = path.join(carpetaPath, "data_extraida.json");
      if (fs.existsSync(marker)) { result.saltados++; continue; }

      const pdfs = fs.readdirSync(carpetaPath).filter(f => f.toLowerCase().endsWith(".pdf"));
      if (!pdfs.length) continue;

      const pdfPath = path.join(carpetaPath, pdfs[0]);
      result.detalles.push(`Procesando: ${carpeta}/${carpetaNombre}/${pdfs[0]}`);

      try {
        const buffer = fs.readFileSync(pdfPath);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const pdfParseFn = require("pdf-parse/lib/pdf-parse") as (buf: Buffer) => Promise<{ text: string }>;
        const parsed = await pdfParseFn(buffer);

        const [order, status] = await parseWithAI(parsed.text, prompt);

        if (!order) {
          result.errores++;
          result.detalles.push(`  ✗ ${status}`);
          logPipeline(db, carpetaNombre, 1, "parse", "ERROR", `AI parse fallido: ${status}`);
          continue;
        }

        // DocDate siempre es la fecha de hoy — no depender del AI
        const hoy = new Date();
        order.DocDate = `${hoy.getFullYear()}${String(hoy.getMonth()+1).padStart(2,"0")}${String(hoy.getDate()).padStart(2,"0")}`;

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
          insertSapOrder(db, order, carpetaPath, nombre);
          logPipeline(db, order.NumAtCard, 1, "parse", "OK", `PDF: ${pdfs[0]}`);
        });
        tx();

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
  }

  return result;
}
