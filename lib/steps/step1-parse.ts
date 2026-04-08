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
import { sendAlertEmail } from "../mailer";

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
  UnitPrice?: number;      // Extraído del PDF para referencia/validación — nunca se envía a SAP
  DeliveryDate?: string;   // Fecha de entrega por línea (YYYYMMDD). Si no existe en el PDF, hereda DocDueDate del pedido
}

export interface SapB1Order {
  DocType: "dDocument_Items";
  NumAtCard: string;
  CardCode: string;
  DocDate: string;    // YYYYMMDD
  DocDueDate: string; // YYYYMMDD
  TaxDate: string;    // YYYYMMDD
  Comments: string;   // Observaciones del PDF → campo Observaciones de la OV
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
  * Observations / remarks (Comments) → Copy verbatim any text found in an "Observaciones", "Remarks", "Notas", or similar section of the document. Use empty string "" if none found.
* **Individual items**: For each product extract:
  * Product code/reference (SupplierCatNum) — **remove any leading zeros** (e.g., "014007383001" → "14007383001")
  * Requested quantity (Quantity)
  * Unit price (UnitPrice) — the price per unit as printed in the document
  * Line delivery date (DeliveryDate) — the specific delivery date for this line if printed. If the line has no individual date, use the general order delivery date (DocDueDate). Always in YYYYMMDD format.

### 3. DATA TRANSFORMATION
Apply these mandatory conversion rules:

**Dates**: Convert to YYYYMMDD format exclusively (e.g., March 25, 2026 → "20260325")

**Buyer NIT (CardCode)**: Always use "CN800069933" regardless of original value

**DocDate**: Always use today's date at time of processing in YYYYMMDD format (NOT any date from the document)

**Numbers** (CRITICAL FOR CONSISTENCY):
* Colombian format uses "." as thousands separator and "," as decimal separator
* Quantity (Quantity): Values like "1.000" mean one thousand units, not one. Remove the thousand separator and convert to integer.
  * "1.000" → 1000
  * "9.000" → 9000
  * "126.000" → 126000
* For integers: Use whole numbers without decimals: 6000 (not 6000.00)
* UnitPrice (UnitPrice): Decimal number. Remove thousands separator (dot) and convert decimal comma to decimal point.
  * "12.500,50" → 12500.50
  * "8.900" → 8900
  * Use 0 if the price is not printed in the document.

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
* UnitPrice is a decimal number per item (0 if not present in document)
* DeliveryDate is present on every line in YYYYMMDD format (line-specific date or DocDueDate if not specified per line)
* Comments contains the verbatim observations from the document (or "" if none)
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
- **Observations / remarks**: Verbatim text from any "Observaciones", "Remarks", "Notas", or similar section → maps to Comments. Use "" if none found.
- **Individual line items**: For each product:
  - Supplier catalog number / product code
  - Ordered quantity
  - Unit price as printed in the document
  - Line delivery date — the specific delivery date for this line if printed. If the line has no individual date, use the general order delivery date (DocDueDate). Always in YYYYMMDD format.

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

**UnitPrice**: Decimal number. Colombian format uses "." as thousands separator and "," as decimal separator. Remove thousands separator (dot) and convert decimal comma to decimal point. Example: "12.500,50" → 12500.50. Use 0 if not printed.

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
| Observaciones / Remarks section | \`Comments\`          | Verbatim text, "" if absent    |
| Item product/catalog code       | \`DocumentLines[].SupplierCatNum\` | String              |
| Item quantity                   | \`DocumentLines[].Quantity\`       | Integer             |
| Item unit price                 | \`DocumentLines[].UnitPrice\`      | Decimal, 0 if absent|
| Item delivery date              | \`DocumentLines[].DeliveryDate\`   | YYYYMMDD — line-specific date or DocDueDate if not specified per line |

### 5. FINAL VALIDATION
Before responding, verify:
- ✅ \`DocDate\` is today's date in YYYYMMDD (not a date from the document)
- ✅ \`TaxDate\` is the OC emission date in YYYYMMDD
- ✅ \`DocDueDate\` is the delivery date in YYYYMMDD
- ✅ \`CardCode\` is exactly \`"CN890900608"\`
- ✅ \`DocType\` is exactly \`"dDocument_Items"\`
- ✅ \`Comments\` contains verbatim observations from the document (or "" if none)
- ✅ \`DocumentLines\` contains one entry per unique line item with UnitPrice and DeliveryDate
- ✅ All quantities are whole integers without decimals
- ✅ All DeliveryDate values are in YYYYMMDD format
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
- **Observations / remarks** (Comments): Verbatim text from any "Observaciones", "Remarks", "Notas", or similar section. Use "" if none found.
- **Line items**: For each product extract:
  - Supplier catalog number / product code (SupplierCatNum) — **remove any leading zeros** (e.g., "0201931" → "201931")
  - Ordered quantity (Quantity)
  - Unit price as printed in the document (UnitPrice)
  - Line delivery date (DeliveryDate) — the specific delivery date for this line if printed. If the line has no individual date, use the general order delivery date (DocDueDate). Always in YYYYMMDD format.

### 3. DATA TRANSFORMATION

**MANDATORY conversion rules:**

**Dates**: Convert ALL dates to YYYYMMDD format (e.g., March 25 2026 → "20260325")

**CardCode** (CRITICAL):
- Extract the buyer's NIT from the document
- Format ALWAYS as: "CN" + numeric digits only, no hyphens, no spaces, no check digit separator
- Example: NIT "890.924.167-6" → "CN890924167"

**DocType**: Always use the fixed value \`"dDocument_Items"\` — no exceptions

**Quantities**: Use whole numbers without decimals (6000 not 6000.00)

**UnitPrice**: Decimal number. Colombian format uses "." as thousands separator and "," as decimal separator. Remove thousands separator (dot) and convert decimal comma to decimal point. Example: "12.500,50" → 12500.50. Use 0 if not printed.

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
- ✅ DocumentLines array contains one object per unique line item with UnitPrice and DeliveryDate
- ✅ All DeliveryDate values are in YYYYMMDD format (line-specific date or DocDueDate if not specified per line)
- ✅ SupplierCatNum values have NO leading zeros (e.g., "0201931" → "201931")
- ✅ Comments contains verbatim observations from the document (or "" if none)
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
    VALUES (?, ?, '', ?, ?, ?, ?)
  `);
  for (const line of order.DocumentLines) {
    const precio = line.UnitPrice ?? 0;
    const subtotal = precio * line.Quantity;
    const fechaLinea = line.DeliveryDate ? yyyymmddToIso(line.DeliveryDate) : fechaG;
    ins.run(order.NumAtCard, line.SupplierCatNum, line.Quantity, precio, subtotal, fechaLinea);
  }
}

// ── Identificación Tamaprint ──────────────────────────────────────────────────
// Cualquier variante del NIT o nombre que aparezca en un PDF dirigido a nosotros.
const TAMAPRINT_KEYWORDS = [
  "tamaprint",
  "tama print",
  "900851655",   // NIT sin dígito de verificación
  "9008516551",  // NIT con dígito de verificación
  "900.851.655", // NIT con puntos
];

function esDirigidoATamaprint(pdfText: string): boolean {
  const lower = pdfText.toLowerCase();
  return TAMAPRINT_KEYWORDS.some(kw => lower.includes(kw));
}

async function notificarPDFNoTamaprint(
  cliente: string,
  carpeta: string,
  pdfNombre: string,
): Promise<void> {
  const fecha = new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" });
  await sendAlertEmail(
    `[OrderLoader] ⚠ PDF no dirigido a Tamaprint — ${cliente}/${carpeta}`,
    `<html><body style="font-family:Arial,sans-serif;font-size:13px">
      <h3 style="color:#856404;background:#fff3cd;padding:10px;border-radius:4px">
        ⚠ PDF recibido no está dirigido a Tamaprint
      </h3>
      <table style="border-collapse:collapse">
        <tr><td style="padding:4px 12px 4px 0"><b>Cliente:</b></td><td>${cliente}</td></tr>
        <tr><td style="padding:4px 12px 4px 0"><b>Carpeta:</b></td><td>${carpeta}</td></tr>
        <tr><td style="padding:4px 12px 4px 0"><b>Archivo:</b></td><td>${pdfNombre}</td></tr>
        <tr><td style="padding:4px 12px 4px 0"><b>Fecha:</b></td><td>${fecha}</td></tr>
      </table>
      <p style="margin-top:16px">
        El PDF fue recibido pero <b>no contiene el NIT ni el nombre de Tamaprint</b> como proveedor.<br>
        Verificar manualmente si corresponde a otro proveedor.
      </p>
      <p style="color:#888;font-size:11px;margin-top:16px">Generado automáticamente por OrderLoader Pipeline</p>
    </body></html>`,
  );
}

// ── Clientes soportados ───────────────────────────────────────────────────────

const CLIENTES: Array<{ carpeta: string; nombre: string; prompt: string }> = [
  { carpeta: "Comodin", nombre: "COMODIN", prompt: PROMPT_COMODIN },
  { carpeta: "Exito",   nombre: "EXITO",   prompt: PROMPT_EXITO   },
  { carpeta: "Hermeco", nombre: "HERMECO", prompt: PROMPT_HERMECO },
];

// Todas las carpetas a escanear (incluye "Otros" para PDFs mal clasificados en step0)
const CARPETAS_A_ESCANEAR = [...CLIENTES.map(c => c.carpeta), "Otros"];

// ── Detección de cliente desde el PDF (fuente de verdad) ─────────────────────
// Los NITs son la señal más confiable: aparecen en toda OC como identificador del comprador.
// Se normalizan quitando puntos para matchear "800.069.933" y "800069933" por igual.

const CLIENT_NITS: Array<{ carpeta: string; nits: string[] }> = [
  { carpeta: "Comodin", nits: ["800069933"] },
  { carpeta: "Hermeco", nits: ["890924167"] },
  { carpeta: "Exito",   nits: ["890900608"] },
];

// Keywords de texto como fallback (evitar falsos positivos — se usan solo si no hay NIT)
const CLIENT_TEXT_KEYWORDS: Array<{ carpeta: string; keywords: string[] }> = [
  { carpeta: "Comodin", keywords: ["gco", "comodin", "americanino", "gco.com.co"] },
  { carpeta: "Hermeco", keywords: ["hermeco", "offcorss", "offcorss.com"] },
  { carpeta: "Exito",   keywords: ["grupoexito", "grupo-exito", "grupo exito", "grupo éxito"] },
];

function detectClientFromPdf(pdfText: string): string | null {
  // Paso 1: buscar NIT (se quitan puntos para normalizar formato colombiano)
  const normalized = pdfText.replace(/\./g, "");
  for (const { carpeta, nits } of CLIENT_NITS) {
    if (nits.some(nit => normalized.includes(nit))) return carpeta;
  }

  // Paso 2: keywords de marca como fallback
  const lower = pdfText.toLowerCase();
  for (const { carpeta, keywords } of CLIENT_TEXT_KEYWORDS) {
    if (keywords.some(kw => lower.includes(kw))) return carpeta;
  }

  return null;
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
    "PARSE_VALIDO", "SAP_NUEVO", "SAP_MONTADO",
    "VALIDADO", "ERROR_VALIDACION",
    "NOTIFICADO", "CERRADO",
    "ERROR_DUPLICADO", "ERROR_ITEMS", "ERROR_SAP",
  ]);

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParseFn = require("pdf-parse/lib/pdf-parse") as (buf: Buffer) => Promise<{ text: string }>;

  for (const carpeta of CARPETAS_A_ESCANEAR) {
    const clienteDir = path.join(config.pedidosRawDir, carpeta);
    if (!fs.existsSync(clienteDir)) continue;

    for (const carpetaNombre of fs.readdirSync(clienteDir).sort()) {
      const carpetaPath = path.join(clienteDir, carpetaNombre);
      if (!fs.statSync(carpetaPath).isDirectory()) continue;

      // Solo carpetas de correo (tienen EML). Los sub-folders de OC no lo tienen.
      if (!fs.existsSync(path.join(carpetaPath, "correo_original.eml"))) continue;

      const pdfs = fs.readdirSync(carpetaPath).filter(f => f.toLowerCase().endsWith(".pdf"));
      if (!pdfs.length) continue;

      // Procesar TODOS los PDFs del correo — cada uno puede ser una OC distinta
      for (const pdfFile of pdfs) {
        const skipMarker = path.join(carpetaPath, `${pdfFile}.skip`);
        const doneMarker = path.join(carpetaPath, `${pdfFile}.done`);

        // Idempotencia por PDF: ya fue procesado o descartado explícitamente
        if (fs.existsSync(skipMarker) || fs.existsSync(doneMarker)) {
          result.saltados++;
          continue;
        }

        const retriesPath = path.join(carpetaPath, `${pdfFile}.retries`);
        const errorPath   = path.join(carpetaPath, `${pdfFile}.error`);

        if (fs.existsSync(errorPath)) {
          result.saltados++;
          result.detalles.push(`⚠ ${pdfFile}: omitido (max reintentos AI alcanzados)`);
          continue;
        }

        result.detalles.push(`Procesando: ${carpeta}/${carpetaNombre}/${pdfFile}`);

        try {
          const buffer = fs.readFileSync(path.join(carpetaPath, pdfFile));
          const parsed = await pdfParseFn(buffer);

          // PDF no dirigido a Tamaprint → silencio + marker de skip + alerta
          if (!esDirigidoATamaprint(parsed.text)) {
            result.saltados++;
            result.detalles.push(`  → No dirigido a Tamaprint — omitido`);
            logPipeline(db, carpetaNombre, 1, "parse", "OK", `${pdfFile}: no es pedido Tamaprint`);
            fs.writeFileSync(skipMarker, "");
            await notificarPDFNoTamaprint(carpeta, carpetaNombre, pdfFile).catch(() => {});
            continue;
          }

          // ── Detectar cliente desde el PDF (fuente de verdad) ──────────────
          const detectedCarpeta = detectClientFromPdf(parsed.text);
          const clienteInfo = CLIENTES.find(c => c.carpeta === detectedCarpeta);

          if (!clienteInfo) {
            result.saltados++;
            result.detalles.push(`  ⚠ No se identificó cliente en el PDF — omitido (carpeta email: ${carpeta})`);
            logPipeline(db, carpetaNombre, 1, "parse", "WARN", `${pdfFile}: cliente no detectado en PDF`);
            fs.writeFileSync(skipMarker, "no-client-detected");
            await sendAlertEmail(
              `[OrderLoader] ⚠ Cliente no identificado en PDF — ${carpeta}/${carpetaNombre}`,
              `<html><body style="font-family:Arial,sans-serif;font-size:13px">
                <h3 style="color:#856404;background:#fff3cd;padding:10px;border-radius:4px">
                  ⚠ No se pudo identificar el cliente desde el PDF
                </h3>
                <p>El PDF <b>${pdfFile}</b> está dirigido a Tamaprint pero no contiene
                el NIT ni keywords de ningún cliente registrado.</p>
                <p><b>Carpeta:</b> ${carpeta}/${carpetaNombre}</p>
                <p>Verificar manualmente si corresponde a un cliente nuevo.</p>
              </body></html>`
            ).catch(() => {});
            continue;
          }

          if (detectedCarpeta !== carpeta) {
            result.detalles.push(`  ⚠ Mismatch: correo en carpeta "${carpeta}", PDF identifica cliente "${detectedCarpeta}" — usando prompt correcto`);
            logPipeline(db, carpetaNombre, 1, "parse", "WARN", `${pdfFile}: carpeta=${carpeta} pdf_cliente=${detectedCarpeta}`);
          }

          const [order, status] = await parseWithAI(parsed.text, clienteInfo.prompt);

          if (!order) {
            result.errores++;
            result.detalles.push(`  ✗ ${status}`);
            logPipeline(db, carpetaNombre, 1, "parse", "ERROR", `AI parse fallido: ${status}`);
            const retries = fs.existsSync(retriesPath)
              ? parseInt(fs.readFileSync(retriesPath, "utf8") || "0") + 1 : 1;
            if (retries >= 3) {
              fs.writeFileSync(errorPath, status);
              fs.rmSync(retriesPath, { force: true });
              await sendAlertEmail(
                `[ERROR OrderLoader] PDF ${pdfFile} — fallo de parseo repetido`,
                `<p>El archivo <b>${pdfFile}</b> falló ${retries} veces. Último error:</p><pre>${status}</pre>`
              ).catch(() => {});
            } else {
              fs.writeFileSync(retriesPath, String(retries));
            }
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
            fs.writeFileSync(doneMarker, order.NumAtCard);
            continue;
          }

          // Sub-folder por OC: carpeta_origen independiente para cada pedido del correo
          const ocFolder = path.join(carpetaPath, order.NumAtCard);
          fs.mkdirSync(ocFolder, { recursive: true });

          // Copiar correo_metadata.json al sub-folder (step7 lo necesita para IMAP)
          const metaSrc = path.join(carpetaPath, "correo_metadata.json");
          if (fs.existsSync(metaSrc)) {
            fs.copyFileSync(metaSrc, path.join(ocFolder, "correo_metadata.json"));
          }

          const tx = db.transaction(() => {
            insertSapOrder(db, order, ocFolder, clienteInfo.nombre); // carpeta_origen = sub-folder de la OC
            logPipeline(db, order.NumAtCard, 1, "parse", "OK", `PDF: ${pdfFile}`);
          });
          tx();

          fs.writeFileSync(
            path.join(ocFolder, "data_extraida.json"),
            JSON.stringify({ ...order, pdf: pdfFile, ts: new Date().toISOString() }, null, 2)
          );

          // Marker de éxito en la carpeta del correo (referencia la OC)
          fs.writeFileSync(doneMarker, order.NumAtCard);
          fs.rmSync(retriesPath, { force: true });

          result.procesados++;
          result.detalles.push(`  ✓ OC ${order.NumAtCard} → PARSED (${order.DocumentLines.length} items)`);
        } catch (e) {
          result.errores++;
          result.detalles.push(`  ✗ Error en ${pdfFile}: ${String(e)}`);
          const retries = fs.existsSync(retriesPath)
            ? parseInt(fs.readFileSync(retriesPath, "utf8") || "0") + 1 : 1;
          if (retries >= 3) {
            fs.writeFileSync(errorPath, String(e));
            fs.rmSync(retriesPath, { force: true });
            await sendAlertEmail(
              `[ERROR OrderLoader] PDF ${pdfFile} — fallo repetido`,
              `<p>El archivo <b>${pdfFile}</b> falló ${retries} veces. Último error:</p><pre>${String(e)}</pre>`
            ).catch(() => {});
          } else {
            fs.writeFileSync(retriesPath, String(retries));
          }
        }
      }
    }
  }

  return result;
}
