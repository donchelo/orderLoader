"use client";

import { useEffect, useState } from "react";
import PipelineStatus from "./PipelineStatus";
import type { Pedido } from "./PedidoTable";

interface Item {
  id: number;
  codigo_producto: string;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  subtotal_item: number;
  fecha_entrega: string | null;
}

interface LogEntry {
  id: number;
  fase: number;
  fase_nombre: string;
  estado_resultado: string;
  mensaje: string;
  ts: string;
}

interface StepResult {
  step: number;
  name: string;
  procesados: number;
  errores: number;
  saltados: number;
  detalles: string[];
  duracionMs: number;
}

const STEP_LABELS: Record<string, string> = {
  "download": "Descargar", "parse": "Extraer", "validate-parse": "Validar",
  "sap-query": "Consultar SAP", "upload": "Subir a SAP",
  "reconcile": "Reconciliar", "notify": "Notificar", "archive": "Archivar",
};

function formatCOP(v: number) {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(v);
}

interface Props {
  pedido: Pedido | null;
  onClose: () => void;
  onRetryDone: () => void;
}

export default function PedidoDetail({ pedido, onClose, onRetryDone }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const [retrying, setRetrying] = useState(false);
  const [retrySteps, setRetrySteps] = useState<StepResult[]>([]);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [retryDone, setRetryDone] = useState(false);

  useEffect(() => {
    if (!pedido) return;
    setItems([]);
    setLogs([]);
    setRetrying(false);
    setRetrySteps([]);
    setRetryError(null);
    setRetryDone(false);
    setLoading(true);

    fetch(`/api/pedidos/${pedido.id}`)
      .then(r => r.json())
      .then(data => {
        if (data.ok) { setItems(data.items); setLogs(data.logs); }
      })
      .finally(() => setLoading(false));
  }, [pedido]);

  async function handleRetry() {
    if (!pedido) return;
    setRetrying(true);
    setRetrySteps([]);
    setRetryError(null);
    setRetryDone(false);

    try {
      const res = await fetch(`/api/pedidos/${pedido.id}/retry`, { method: "POST" });
      if (!res.body) throw new Error("Sin stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const json = JSON.parse(line.slice(6));
          if (json.type === "step") setRetrySteps(prev => [...prev, json.result]);
          else if (json.type === "done") { setRetryDone(true); onRetryDone(); }
          else if (json.type === "error") setRetryError(json.error);
        }
      }
    } catch (e) {
      setRetryError(String(e));
    } finally {
      setRetrying(false);
    }
  }

  const isError = pedido?.estado.startsWith("ERROR");

  if (!pedido) return null;

  return (
    <>
      {/* Overlay */}
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 40 }}
      />

      {/* Drawer */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 560,
        background: "#fff", zIndex: 50, display: "flex", flexDirection: "column",
        boxShadow: "-4px 0 20px rgba(0,0,0,0.15)",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>OC {pedido.orden_compra}</div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{pedido.cliente_nombre}</div>
          </div>
          <PipelineStatus estado={pedido.estado} />
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#64748b", padding: "0 4px" }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: 32, color: "#64748b" }}>Cargando…</div>
          ) : (
            <>
              {/* Error completo */}
              {pedido.error_msg && (
                <div style={{ background: "#fff1f2", border: "1px solid #fecdd3", borderRadius: 6, padding: "12px 14px", marginBottom: 16, fontSize: 13 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Error</div>
                  <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{pedido.error_msg}</div>
                </div>
              )}

              {/* Retry */}
              {isError && !retryDone && (
                <button
                  onClick={handleRetry}
                  disabled={retrying}
                  style={{
                    width: "100%", padding: "10px", marginBottom: 16,
                    background: retrying ? "#e9ecef" : "#000", color: retrying ? "#000" : "#fff",
                    border: "1px solid #000", borderRadius: 6, fontSize: 14, fontWeight: 600,
                    cursor: retrying ? "not-allowed" : "pointer",
                  }}
                >
                  {retrying ? "⏳ Reintentando…" : "↺ Reintentar pedido"}
                </button>
              )}

              {/* Retry progress */}
              {(retrySteps.length > 0 || retrying) && (
                <div style={{ border: "1px solid #e2e8f0", borderRadius: 6, overflow: "hidden", marginBottom: 16 }}>
                  {retrySteps.map(r => (
                    <div key={`${r.step}-${r.name}`} style={{
                      display: "flex", gap: 10, padding: "7px 12px", fontSize: 12,
                      background: r.errores > 0 ? "#fff1f2" : "#f0fdf4",
                      borderBottom: "1px solid #f1f5f9",
                    }}>
                      <span style={{ color: "#64748b", minWidth: 16 }}>{r.step}</span>
                      <span style={{ flex: 1 }}>{STEP_LABELS[r.name] ?? r.name}</span>
                      <span style={{ color: "#16a34a" }}>✓{r.procesados}</span>
                      {r.errores > 0 && <span style={{ color: "#dc2626" }}>✗{r.errores}</span>}
                      <span style={{ color: "#94a3b8" }}>{r.duracionMs}ms</span>
                    </div>
                  ))}
                  {retrying && (
                    <div style={{ padding: "7px 12px", fontSize: 12, color: "#64748b" }}>⏳ Procesando…</div>
                  )}
                  {retryDone && (
                    <div style={{ padding: "7px 12px", fontSize: 12, color: "#16a34a", fontWeight: 600 }}>✅ Completado</div>
                  )}
                </div>
              )}
              {retryError && (
                <div style={{ background: "#fff1f2", padding: "10px 12px", borderRadius: 6, fontSize: 12, marginBottom: 16 }}>
                  {retryError}
                </div>
              )}

              {/* Ítems */}
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
                Ítems ({items.length})
              </div>
              {items.length === 0 ? (
                <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 16 }}>Sin ítems registrados</div>
              ) : (
                <div style={{ overflowX: "auto", marginBottom: 16 }}>
                  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                        <th style={{ padding: "6px 8px", textAlign: "left" }}>Código</th>
                        <th style={{ padding: "6px 8px", textAlign: "left" }}>Descripción</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>Cant.</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>Precio</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(item => (
                        <tr key={item.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{item.codigo_producto}</td>
                          <td style={{ padding: "5px 8px", color: "#374151" }}>{item.descripcion || "—"}</td>
                          <td style={{ padding: "5px 8px", textAlign: "right" }}>{item.cantidad}</td>
                          <td style={{ padding: "5px 8px", textAlign: "right" }}>{formatCOP(item.precio_unitario)}</td>
                          <td style={{ padding: "5px 8px", textAlign: "right", fontWeight: 600 }}>{formatCOP(item.subtotal_item)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Log */}
              {logs.length > 0 && (
                <>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Historial</div>
                  <div style={{ fontSize: 11, display: "flex", flexDirection: "column", gap: 4 }}>
                    {logs.map(l => (
                      <div key={l.id} style={{ display: "flex", gap: 8, color: l.estado_resultado === "ERROR" ? "#dc2626" : "#374151" }}>
                        <span style={{ color: "#94a3b8", whiteSpace: "nowrap" }}>{l.ts.slice(5, 16)}</span>
                        <span style={{ color: "#94a3b8" }}>f{l.fase}</span>
                        <span style={{ flex: 1 }}>{l.mensaje}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
