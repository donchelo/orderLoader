/**
 * Step 4: Validar artículos del pedido contra catálogo SAP B1.
 *
 * SAP_NUEVO → ITEMS_OK | ERROR_ITEMS
 * Artículos con precio diferente se corrigen al precio SAP y continúan como ITEMS_OK.
 */

import nodemailer from "nodemailer";
import { getConfig } from "../config";
import { getDb, logPipeline } from "../db";
import { getSapClient, clearSapClient } from "../sap-client";

export interface StepResult {
  procesados: number;
  errores: number;
  saltados: number;
  detalles: string[];
}

interface Discrepancia {
  tipo: string;
  codigo: string;
  nombre_sap?: string;
  precio_db?: number;
  precio_sap?: number;
  detalle?: string;
}

async function getItemFromSap(sap: Awaited<ReturnType<typeof getSapClient>>, codigo: string) {
  try {
    return await sap.get<Record<string, unknown>>(
      `Items('${codigo}')`,
      { "$select": "ItemCode,ItemName,ItemPrices" }
    );
  } catch (e) {
    const msg = String(e);
    if (msg.includes("404") || msg.includes("Not Found") || msg.toLowerCase().includes("does not exist")) {
      return null;
    }
    throw e;
  }
}

function getSapPrice(itemData: Record<string, unknown>, priceListNum: number): number {
  const prices = (itemData.ItemPrices as Array<Record<string, unknown>>) ?? [];
  const entry = prices.find(p => p.PriceList === priceListNum);
  return entry ? Number(entry.Price ?? 0) : 0;
}

function precioDifiere(precioDb: number, precioSap: number, toleranciaPct: number): boolean {
  if (precioDb === 0 && precioSap === 0) return false;
  if (precioDb === 0) return precioSap > 0;
  return Math.abs(precioDb - precioSap) / precioDb > toleranciaPct / 100;
}

async function sendAlertEmail(subject: string, html: string): Promise<void> {
  const config = getConfig();
  if (!config.emailUser || !config.emailPass || !config.smtpHost) return;
  const t = nodemailer.createTransport({
    host: config.smtpHost, port: config.smtpPort,
    secure: false, auth: { user: config.emailUser, pass: config.emailPass },
  });
  await t.sendMail({ from: config.emailUser, to: config.notifyAlertasEmail, subject, html });
}

function buildAlertHtml(
  oc: string, cliente: string,
  discrepancias: Discrepancia[], tipo: "ERROR" | "ALERTA"
): string {
  const colorHeader = tipo === "ERROR" ? "#dc3545" : "#e67e22";
  const filas = discrepancias.map(d => {
    const bg = d.tipo === "NO_EXISTE" || d.tipo === "ERROR_CONSULTA" ? "#f8d7da" : "#fff3cd";
    const pDb = d.precio_db != null ? `$${d.precio_db.toFixed(0)}` : "—";
    const pSap = d.precio_sap != null ? `$${d.precio_sap.toFixed(0)}` : "—";
    return `<tr style="background:${bg}">
      <td style="padding:6px 12px"><code>${d.codigo}</code></td>
      <td style="padding:6px 12px">${d.nombre_sap ?? "—"}</td>
      <td style="padding:6px 12px"><b>${d.tipo}</b></td>
      <td style="padding:6px 12px;text-align:right">${pDb}</td>
      <td style="padding:6px 12px;text-align:right">${pSap}</td>
      <td style="padding:6px 12px">${d.detalle ?? ""}</td>
    </tr>`;
  }).join("");
  return `<html><body style="font-family:Arial,sans-serif;font-size:13px">
  <div style="background:${colorHeader};color:white;padding:14px 20px">
    <h2 style="margin:0">OC ${oc} — ${tipo === "ERROR" ? "Artículos no encontrados" : "Precios corregidos"}</h2>
  </div>
  <div style="padding:16px"><p><b>Cliente:</b> ${cliente}</p>
  <table border="1" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:12px">
    <thead style="background:#343a40;color:#fff">
      <tr><th style="padding:8px">Código</th><th>Nombre SAP</th><th>Tipo</th>
          <th>Precio pedido</th><th>Precio SAP</th><th>Detalle</th></tr>
    </thead>
    <tbody>${filas}</tbody>
  </table></div></body></html>`;
}

export async function run(): Promise<StepResult> {
  const config = getConfig();
  const result: StepResult = { procesados: 0, errores: 0, saltados: 0, detalles: [] };
  const db = getDb();

  const pendientes = db.prepare(
    "SELECT * FROM pedidos_maestro WHERE estado = 'SAP_NUEVO'"
  ).all() as Array<Record<string, unknown>>;

  if (!pendientes.length) {
    result.detalles.push("No hay pedidos en estado SAP_NUEVO");
    return result;
  }

  let sap;
  try {
    sap = await getSapClient();
  } catch (e) {
    result.detalles.push(`SAP no configurado: ${String(e)}`);
    clearSapClient();
    return result;
  }

  for (const row of pendientes) {
    const oc = String(row.orden_compra);
    const cliente = String(row.cliente_nombre || "—");
    const fecha = new Date().toISOString().split("T")[0];

    const items = db.prepare(
      "SELECT * FROM pedidos_detalle WHERE orden_compra = ?"
    ).all(oc) as Array<Record<string, unknown>>;

    if (!items.length) {
      db.prepare(`UPDATE pedidos_maestro SET estado='ERROR_ITEMS', error_msg=? WHERE orden_compra=?`)
        .run("Sin ítems en pedidos_detalle", oc);
      logPipeline(db, oc, 4, "items_validator", "ERROR", "Sin ítems en pedidos_detalle");
      result.errores++;
      result.detalles.push(`✗ OC ${oc} → ERROR_ITEMS (sin ítems)`);
      continue;
    }

    const discrepancias: Discrepancia[] = [];
    const noEncontrados: string[] = [];

    for (const item of items) {
      const codigo = String(item.codigo_producto);
      const precioDb = Number(item.precio_unitario ?? 0);

      try {
        const sapItem = await getItemFromSap(sap, codigo);
        if (!sapItem) {
          discrepancias.push({ tipo: "NO_EXISTE", codigo, detalle: "Artículo no encontrado en catálogo SAP" });
          noEncontrados.push(codigo);
          result.detalles.push(`  [${codigo}] NO EXISTE en SAP`);
          continue;
        }
        const nombreSap = String(sapItem.ItemName ?? codigo);
        const precioSap = getSapPrice(sapItem, config.sapPriceList);

        if (precioSap === 0 && precioDb > 0) {
          discrepancias.push({ tipo: "SIN_PRECIO", codigo, nombre_sap: nombreSap, precio_db: precioDb, precio_sap: 0, detalle: `Sin precio en lista ${config.sapPriceList}` });
        } else if (precioDifiere(precioDb, precioSap, config.sapPriceTolerance)) {
          const diffPct = precioDb > 0 ? Math.abs(precioDb - precioSap) / precioDb * 100 : 100;
          discrepancias.push({ tipo: "PRECIO_DIFIERE", codigo, nombre_sap: nombreSap, precio_db: precioDb, precio_sap: precioSap, detalle: `Diferencia ${diffPct.toFixed(1)}%` });
          result.detalles.push(`  [${codigo}] PRECIO DIFIERE — pedido $${precioDb.toFixed(0)} / SAP $${precioSap.toFixed(0)}`);
        } else {
          result.detalles.push(`  [${codigo}] OK — $${precioSap.toFixed(0)}`);
        }
      } catch (e) {
        discrepancias.push({ tipo: "ERROR_CONSULTA", codigo, detalle: String(e).slice(0, 120) });
      }
    }

    const resumenJson = JSON.stringify({ discrepancias, precio_lista: config.sapPriceList });

    if (!discrepancias.length) {
      db.prepare(`UPDATE pedidos_maestro SET estado='ITEMS_OK', fase_actual=3, error_msg=NULL, validacion_resultado=? WHERE orden_compra=?`)
        .run(resumenJson, oc);
      logPipeline(db, oc, 4, "items_validator", "OK", `${items.length} artículo(s) OK`);
      result.procesados++;
      result.detalles.push(`✓ OC ${oc} → ITEMS_OK (${items.length} artículos)`);
    } else if (noEncontrados.length) {
      db.prepare(`UPDATE pedidos_maestro SET estado='ERROR_ITEMS', fase_actual=3, error_msg=?, validacion_resultado=? WHERE orden_compra=?`)
        .run(`${noEncontrados.length} artículo(s) no existen: ${noEncontrados.slice(0, 5).join(", ")}`, resumenJson, oc);
      logPipeline(db, oc, 4, "items_validator", "ERROR", `No existen: ${noEncontrados.slice(0, 3).join(", ")}`);
      result.errores++;
      result.detalles.push(`✗ OC ${oc} → ERROR_ITEMS (${noEncontrados.length} no encontrados)`);
      try { await sendAlertEmail(`[ERROR OrderLoader] OC ${oc} — Artículos inexistentes`, buildAlertHtml(oc, cliente, discrepancias, "ERROR")); } catch { /* ignore */ }
    } else {
      // Solo discrepancias de precio → corregir al precio SAP y continuar
      const tx = db.transaction(() => {
        for (const d of discrepancias) {
          if (d.precio_sap && d.precio_sap > 0) {
            db.prepare(`UPDATE pedidos_detalle SET precio_unitario=? WHERE orden_compra=? AND codigo_producto=?`)
              .run(d.precio_sap, oc, d.codigo);
          }
        }
      });
      tx();
      const nota = `${discrepancias.length} precio(s) corregido(s) al precio SAP`;
      const resumenCorregido = JSON.stringify({ discrepancias, precios_corregidos: true, nota });
      db.prepare(`UPDATE pedidos_maestro SET estado='ITEMS_OK', fase_actual=3, error_msg=NULL, validacion_resultado=? WHERE orden_compra=?`)
        .run(resumenCorregido, oc);
      logPipeline(db, oc, 4, "items_validator", "OK", nota);
      result.procesados++;
      result.detalles.push(`✓ OC ${oc} → ITEMS_OK (${discrepancias.length} precio(s) corregido(s))`);
      try { await sendAlertEmail(`[ALERTA OrderLoader] OC ${oc} — Precios corregidos`, buildAlertHtml(oc, cliente, discrepancias, "ALERTA")); } catch { /* ignore */ }
    }
  }

  return result;
}
