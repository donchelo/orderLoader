import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { getConfig } from "./config";

export interface PedidoMaestro {
  id: number;
  nit_cliente: string;
  orden_compra: string;
  fecha_recepcion: string;
  fecha_solicitado: string;
  fecha_entrega_general: string;
  cliente_nombre: string;
  subtotal: number;
  estado: string;
  notas: string;
  fase_actual: number;
  ts_parsed: string | null;
  ts_sap_query: string | null;
  ts_sap_upload: string | null;
  ts_validated: string | null;
  ts_notified: string | null;
  sap_doc_entry: number | null;
  sap_doc_num: string | null;
  sap_existe: number | null;
  sap_query_resultado: string | null;
  validacion_resultado: string | null;
  items_excluidos: string | null;
  error_msg: string | null;
  carpeta_origen: string | null;
}

export interface PedidoDetalle {
  id: number;
  orden_compra: string;
  codigo_producto: string;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  subtotal_item: number;
  fecha_entrega: string | null;
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const config = getConfig();
  if (!fs.existsSync(config.dbPath)) {
    throw new Error(
      `orderloader.db no encontrado en ${config.dbPath}. Ejecuta migrate primero.`
    );
  }
  _db = new Database(config.dbPath);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
  return _db;
}

export function migrate(): void {
  const config = getConfig();
  const db = new Database(config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS pedidos_maestro (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      nit_cliente           TEXT NOT NULL,
      orden_compra          TEXT NOT NULL UNIQUE,
      fecha_recepcion       TEXT DEFAULT (datetime('now')),
      fecha_solicitado      TEXT,
      fecha_entrega_general TEXT,
      cliente_nombre        TEXT,
      subtotal              REAL,
      estado                TEXT NOT NULL DEFAULT 'NUEVO',
      notas                 TEXT,
      fase_actual           INTEGER DEFAULT 0,
      ts_parsed             TEXT,
      ts_sap_query          TEXT,
      ts_sap_upload         TEXT,
      ts_validated          TEXT,
      ts_notified           TEXT,
      sap_doc_entry         INTEGER,
      sap_doc_num           TEXT,
      sap_existe            INTEGER,
      sap_query_resultado   TEXT,
      validacion_resultado  TEXT,
      items_excluidos       TEXT,
      error_msg             TEXT,
      carpeta_origen        TEXT
    );

    CREATE TABLE IF NOT EXISTS pedidos_detalle (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      orden_compra     TEXT NOT NULL REFERENCES pedidos_maestro(orden_compra),
      codigo_producto  TEXT NOT NULL,
      descripcion      TEXT,
      cantidad         REAL NOT NULL,
      precio_unitario  REAL NOT NULL,
      subtotal_item    REAL,
      fecha_entrega    TEXT
    );

    CREATE TABLE IF NOT EXISTS pipeline_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      orden_compra    TEXT,
      fase            INTEGER,
      fase_nombre     TEXT,
      estado_resultado TEXT,
      mensaje         TEXT,
      ts              TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_maestro_estado ON pedidos_maestro(estado);
    CREATE INDEX IF NOT EXISTS idx_maestro_fecha  ON pedidos_maestro(fecha_recepcion);
    CREATE INDEX IF NOT EXISTS idx_detalle_oc     ON pedidos_detalle(orden_compra);
    CREATE INDEX IF NOT EXISTS idx_log_oc         ON pipeline_log(orden_compra);
  `);

  // Migraciones para columnas agregadas después de la creación inicial
  try { db.exec(`ALTER TABLE pedidos_maestro ADD COLUMN items_excluidos TEXT`); } catch { /* ya existe */ }

  db.close();
  console.log("DB migrada correctamente:", config.dbPath);
}

export function logPipeline(
  db: Database.Database,
  oc: string | null,
  fase: number,
  faseNombre: string,
  estado: "OK" | "ERROR" | "WARN",
  mensaje: string
): void {
  db.prepare(
    `INSERT INTO pipeline_log (orden_compra, fase, fase_nombre, estado_resultado, mensaje)
     VALUES (?, ?, ?, ?, ?)`
  ).run(oc, fase, faseNombre, estado, mensaje);
}

export function backupDb(): string | null {
  const config = getConfig();
  if (!fs.existsSync(config.dbPath)) return null;

  try {
    const db = new Database(config.dbPath, { readonly: true });
    const count = (
      db.prepare("SELECT COUNT(*) as c FROM pedidos_maestro").get() as {
        c: number;
      }
    ).c;
    db.close();
    if (count === 0) return null;
  } catch {
    return null;
  }

  const ts = new Date()
    .toISOString()
    .replace(/[-:T]/g, (c) => (c === "T" ? "_" : c))
    .split(".")[0];
  fs.mkdirSync(config.pedidosBackupsDir, { recursive: true });
  const dest = path.join(config.pedidosBackupsDir, `orderloader_${ts}.db`);
  fs.copyFileSync(config.dbPath, dest);

  // Keep only the 7 most recent backups
  const backups = fs
    .readdirSync(config.pedidosBackupsDir)
    .filter((f) => f.startsWith("orderloader_") && f.endsWith(".db"))
    .sort();
  for (const old of backups.slice(0, -7)) {
    try {
      fs.unlinkSync(path.join(config.pedidosBackupsDir, old));
    } catch {
      /* ignore */
    }
  }

  return dest;
}

export function ensureWorkspaceDirs(): void {
  const config = getConfig();
  for (const client of ["Hermeco", "Comodin", "Exito", "Otros"]) {
    fs.mkdirSync(path.join(config.pedidosRawDir, client), { recursive: true });
  }
  fs.mkdirSync(config.pedidosBackupsDir, { recursive: true });
  fs.mkdirSync(config.pedidosReportsDir, { recursive: true });
}
