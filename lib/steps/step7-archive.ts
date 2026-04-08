/**
 * Step 7: Archivar correos originales en IMAP y cerrar pedidos.
 *
 * Para cada pedido en estado NOTIFICADO:
 *   - Mueve el correo de "A A INGRESAR IA" al destino según resultado:
 *       VALIDADO sin excluidos → "A A INGRESADO"
 *       Cualquier error u observación → "A A REVISAR IA"
 *   - Marca el pedido como CERRADO
 *
 * NOTIFICADO → CERRADO
 */

import fs from "fs";
import path from "path";
import { ImapFlow } from "imapflow";
import { getConfig } from "../config";
import { getDb, logPipeline } from "../db";

export interface StepResult {
  procesados: number;
  errores: number;
  saltados: number;
  detalles: string[];
}

const SOURCE_FOLDER = "A A INGRESAR IA";
const DEST_OK       = "A A INGRESADO";
const DEST_REVISAR  = "A A REVISAR IA";

function isLimpio(estado: string, itemsExcluidosRaw: unknown): boolean {
  if (estado !== "VALIDADO") return false;
  try {
    const arr = JSON.parse(String(itemsExcluidosRaw ?? "[]"));
    return Array.isArray(arr) && arr.length === 0;
  } catch { return false; }
}

export async function run(): Promise<StepResult> {
  const config = getConfig();
  const result: StepResult = { procesados: 0, errores: 0, saltados: 0, detalles: [] };
  const db = getDb();

  const pendientes = db.prepare(
    "SELECT * FROM pedidos_maestro WHERE estado = 'NOTIFICADO'"
  ).all() as Array<Record<string, unknown>>;

  if (!pendientes.length) {
    result.detalles.push("No hay pedidos en estado NOTIFICADO");
    return result;
  }

  // ── Agrupar UIDs por carpeta destino ────────────────────────────────────
  const uidsByDest: Record<string, number[]> = { [DEST_OK]: [], [DEST_REVISAR]: [] };
  const destByOrden: Record<string, string> = {};

  for (const row of pendientes) {
    const carpeta = row.carpeta_origen as string | null;
    if (!carpeta) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(carpeta, "correo_metadata.json"), "utf8"));
      if (!meta.imap_uid) continue;
      const uid = Number(meta.imap_uid);
      const dest = isLimpio(String(row.estado), row.items_excluidos) ? DEST_OK : DEST_REVISAR;
      uidsByDest[dest].push(uid);
      destByOrden[String(row.orden_compra)] = dest;
    } catch { /* metadata no disponible */ }
  }

  // ── Mover correos en IMAP ────────────────────────────────────────────────
  const totalUids = uidsByDest[DEST_OK].length + uidsByDest[DEST_REVISAR].length;
  if (totalUids > 0 && config.emailUser && config.emailPass && config.emailHost) {
    try {
      const imap = new ImapFlow({
        host: config.emailHost, port: config.emailPort, secure: true,
        auth: { user: config.emailUser, pass: config.emailPass },
        logger: false,
      });
      await imap.connect();
      const lock = await imap.getMailboxLock(SOURCE_FOLDER);
      try {
        try { await imap.mailboxCreate(DEST_OK); } catch { /* ya existe */ }
        try { await imap.mailboxCreate(DEST_REVISAR); } catch { /* ya existe */ }
        for (const [dest, uids] of Object.entries(uidsByDest)) {
          if (!uids.length) continue;
          await imap.messageMove(uids.map(String).join(","), dest, { uid: true });
          result.detalles.push(`✓ ${uids.length} correo(s) → ${dest}`);
        }
      } finally {
        lock.release();
      }
      await imap.logout();
    } catch (e) {
      result.detalles.push(`⚠ No se pudieron mover correo(s) IMAP: ${String(e).slice(0, 80)}`);
    }
  }

  // ── Marcar como CERRADO ──────────────────────────────────────────────────
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const row of pendientes) {
      const oc = String(row.orden_compra);
      const dest = destByOrden[oc] ?? DEST_REVISAR;
      db.prepare(`
        UPDATE pedidos_maestro SET estado='CERRADO', fase_actual=7
        WHERE orden_compra=?
      `).run(oc);
      logPipeline(db, oc, 7, "archive", "OK", `CERRADO → ${dest}`);
    }
  });
  tx();

  result.procesados = pendientes.length;
  result.detalles.push(`✓ ${pendientes.length} pedido(s) → CERRADO`);
  return result;
}
