/**
 * Step 7: Archivar correos originales en IMAP y cerrar pedidos.
 *
 * Para cada pedido en estado NOTIFICADO:
 *   - Mueve el correo original de INBOX → INBOX/Ingresados
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

  // ── Recopilar UIDs IMAP ──────────────────────────────────────────────────
  const uids: number[] = [];
  for (const row of pendientes) {
    const carpeta = row.carpeta_origen as string | null;
    if (!carpeta) continue;
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(carpeta, "correo_metadata.json"), "utf8"));
      if (meta.imap_uid) uids.push(Number(meta.imap_uid));
    } catch { /* metadata no disponible */ }
  }

  // ── Mover correos en IMAP ────────────────────────────────────────────────
  if (uids.length > 0 && config.emailUser && config.emailPass && config.emailHost) {
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
      result.detalles.push(`⚠ No se pudieron mover correo(s) IMAP: ${String(e).slice(0, 80)}`);
    }
  }

  // ── Marcar como CERRADO ──────────────────────────────────────────────────
  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const row of pendientes) {
      db.prepare(`
        UPDATE pedidos_maestro SET estado='CERRADO', fase_actual=7
        WHERE orden_compra=?
      `).run(row.orden_compra);
      logPipeline(db, String(row.orden_compra), 7, "archive", "OK", "CERRADO");
    }
  });
  tx();

  result.procesados = pendientes.length;
  result.detalles.push(`✓ ${pendientes.length} pedido(s) → CERRADO`);
  return result;
}
