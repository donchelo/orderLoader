"use client";

import { useState, useEffect, useCallback } from "react";
import PedidoTable, { Pedido } from "@/components/PedidoTable";
import RunPipelineButton from "@/components/RunPipelineButton";
import PedidoDetail from "@/components/PedidoDetail";

export default function Home() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [selectedPedido, setSelectedPedido] = useState<Pedido | null>(null);

  const fetchPedidos = useCallback(async () => {
    try {
      const res = await fetch("/api/pedidos");
      const data = await res.json();
      if (data.ok) {
        setPedidos(data.pedidos);
        setLastRefresh(new Date());
        setError(null);
      } else {
        setError(data.error);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPedidos();
  }, [fetchPedidos]);

  // Auto-refresh each 15s if there are pending orders
  useEffect(() => {
    const hasPending = pedidos.some(p =>
      !["CERRADO", "ERROR_DUPLICADO", "ERROR_ITEMS", "ERROR_SAP", "ERROR_PARSE", "ERROR_VALIDACION"].includes(p.estado)
    );
    if (!hasPending) return;
    const id = setInterval(fetchPedidos, 15_000);
    return () => clearInterval(id);
  }, [pedidos, fetchPedidos]);

  // Stats
  const total = pedidos.length;
  const cerrados = pedidos.filter(p => p.estado === "CERRADO").length;
  const errores = pedidos.filter(p => p.estado.startsWith("ERROR")).length;
  const enProceso = total - cerrados - errores;

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", minHeight: "100vh", background: "#f8f9fa", color: "#000" }}>
      {/* Header */}
      <header style={{
        background: "#f0f2f5", color: "#000", padding: "16px 32px",
        display: "flex", alignItems: "center", gap: 16,
        borderBottom: "1px solid #dee2e6"
      }}>
        <span style={{ fontSize: 28 }}>🖨️</span>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>OrderLoader — SAP B1 Order Pipeline</h1>
          <p style={{ margin: 0, fontSize: 12, color: "#000" }}>
            Automatización Email → SAP B1
          </p>
        </div>
      </header>

      <main style={{ padding: "24px 32px", maxWidth: 1400, margin: "0 auto" }}>
        {/* Stats row */}
        <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
          {[
            { label: "Total pedidos", value: total, bg: "#e9ecef", color: "#000" },
            { label: "En proceso", value: enProceso, bg: "#fff3cd", color: "#000" },
            { label: "Cerrados OK", value: cerrados, bg: "#d1e7dd", color: "#000" },
            { label: "Con errores", value: errores, bg: "#f8d7da", color: "#000" },
          ].map(stat => (
            <div key={stat.label} style={{
              background: stat.bg, color: stat.color,
              padding: "16px 24px", borderRadius: 8, minWidth: 140,
            }}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>{stat.value}</div>
              <div style={{ fontSize: 13 }}>{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Actions row */}
        <div style={{
          background: "#fff", border: "1px solid #dee2e6", borderRadius: 8,
          padding: "20px 24px", marginBottom: 24,
        }}>
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
            <RunPipelineButton onComplete={fetchPedidos} />
            <button
              onClick={fetchPedidos}
              style={{
                background: "#fff", color: "#000", border: "1px solid #000",
                borderRadius: 6, padding: "10px 20px", fontSize: 14, cursor: "pointer",
              }}
            >
              🔄 Actualizar
            </button>
          </div>
          {lastRefresh && (
            <div style={{ marginTop: 8, fontSize: 12, color: "#000" }}>
              Última actualización: {lastRefresh.toLocaleTimeString("es-CO")}
            </div>
          )}
        </div>

        {/* Table */}
        <div style={{
          background: "#fff", border: "1px solid #dee2e6", borderRadius: 8,
          padding: "20px 24px",
        }}>
          <h2 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600, color: "#000" }}>
            Pedidos
          </h2>

          {loading ? (
            <div style={{ padding: "32px 0", textAlign: "center", color: "#000" }}>
              Cargando…
            </div>
          ) : error ? (
            <div style={{ background: "#f8d7da", color: "#000", padding: "12px 16px", borderRadius: 6 }}>
              <strong>Error:</strong> {error}
              <br />
              <small>¿La base de datos fue inicializada? Ejecuta migrate primero.</small>
            </div>
          ) : (
            <PedidoTable
              pedidos={pedidos}
              filtroEstado={filtroEstado}
              onFiltroChange={setFiltroEstado}
              onSelect={setSelectedPedido}
            />
          )}
        </div>
      </main>
      <PedidoDetail
        pedido={selectedPedido}
        onClose={() => setSelectedPedido(null)}
        onRetryDone={() => { fetchPedidos(); setSelectedPedido(null); }}
      />
    </div>
  );
}
