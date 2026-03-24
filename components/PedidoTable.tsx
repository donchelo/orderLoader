"use client";

import PipelineStatus from "./PipelineStatus";

export interface Pedido {
  id: number;
  orden_compra: string;
  cliente_nombre: string;
  nit_cliente: string;
  fecha_solicitado: string;
  fecha_entrega_general: string;
  subtotal: number;
  estado: string;
  fase_actual: number;
  error_msg: string | null;
  sap_doc_num: string | null;
  ts_sap_upload: string | null;
}

interface Props {
  pedidos: Pedido[];
  filtroEstado: string;
  onFiltroChange: (estado: string) => void;
}

const ESTADOS = [
  "todos", "NUEVO", "PARSED", "PARSE_VALIDO", "SAP_NUEVO",
  "ITEMS_OK", "SAP_MONTADO", "VALIDADO", "CERRADO",
  "ERROR_PARSE", "ERROR_DUPLICADO", "ERROR_ITEMS", "ERROR_SAP", "ERROR_VALIDACION",
];

function formatCOP(value: number): string {
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(value);
}

function formatDate(d: string | null): string {
  if (!d) return "—";
  return d.split("T")[0];
}

export default function PedidoTable({ pedidos, filtroEstado, onFiltroChange }: Props) {
  const filtered = filtroEstado === "todos" ? pedidos : pedidos.filter(p => p.estado === filtroEstado);

  return (
    <div>
      {/* Filtro */}
      <div style={{ marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 13, color: "#6c757d" }}>Filtrar:</span>
        {ESTADOS.map(e => (
          <button
            key={e}
            onClick={() => onFiltroChange(e)}
            style={{
              padding: "3px 10px",
              borderRadius: 12,
              border: "1px solid",
              borderColor: filtroEstado === e ? "#0d6efd" : "#dee2e6",
              background: filtroEstado === e ? "#0d6efd" : "#fff",
              color: filtroEstado === e ? "#fff" : "#333",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {e === "todos" ? `Todos (${pedidos.length})` : e}
          </button>
        ))}
      </div>

      {/* Tabla */}
      {filtered.length === 0 ? (
        <div style={{ padding: "32px 0", textAlign: "center", color: "#6c757d" }}>
          No hay pedidos{filtroEstado !== "todos" ? ` en estado ${filtroEstado}` : ""}.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#343a40", color: "#fff" }}>
                <th style={{ padding: "8px 12px", textAlign: "left" }}>OC</th>
                <th style={{ padding: "8px 12px", textAlign: "left" }}>Cliente</th>
                <th style={{ padding: "8px 12px", textAlign: "left" }}>Solicitado</th>
                <th style={{ padding: "8px 12px", textAlign: "left" }}>Entrega</th>
                <th style={{ padding: "8px 12px", textAlign: "right" }}>Subtotal</th>
                <th style={{ padding: "8px 12px", textAlign: "center" }}>Estado</th>
                <th style={{ padding: "8px 12px", textAlign: "left" }}>SAP Doc</th>
                <th style={{ padding: "8px 12px", textAlign: "left" }}>Nota</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr
                  key={p.orden_compra}
                  style={{
                    borderBottom: "1px solid #dee2e6",
                    background: p.estado.startsWith("ERROR") ? "#fff5f5" : undefined,
                  }}
                >
                  <td style={{ padding: "7px 12px", fontWeight: 600 }}>{p.orden_compra}</td>
                  <td style={{ padding: "7px 12px" }}>{p.cliente_nombre}</td>
                  <td style={{ padding: "7px 12px" }}>{formatDate(p.fecha_solicitado)}</td>
                  <td style={{ padding: "7px 12px" }}>{formatDate(p.fecha_entrega_general)}</td>
                  <td style={{ padding: "7px 12px", textAlign: "right" }}>{formatCOP(p.subtotal)}</td>
                  <td style={{ padding: "7px 12px", textAlign: "center" }}>
                    <PipelineStatus estado={p.estado} />
                  </td>
                  <td style={{ padding: "7px 12px", color: "#6c757d" }}>{p.sap_doc_num ?? "—"}</td>
                  <td style={{ padding: "7px 12px", color: "#dc3545", fontSize: 12 }}>
                    {p.error_msg ? p.error_msg.slice(0, 60) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 8, fontSize: 12, color: "#6c757d" }}>
            {filtered.length} pedido(s) mostrado(s)
          </div>
        </div>
      )}
    </div>
  );
}
