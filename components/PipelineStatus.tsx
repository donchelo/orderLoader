"use client";

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  NUEVO:             { label: "Nuevo",           color: "#000", bg: "#f8f9fa" },
  PARSED:            { label: "Parseado",         color: "#000", bg: "#cfe2ff" },
  PARSE_VALIDO:      { label: "Parse OK",         color: "#000", bg: "#d1e7dd" },
  SAP_NUEVO:         { label: "SAP: Nuevo",       color: "#000", bg: "#fff3cd" },
  SAP_VERIFICADO:    { label: "SAP: Verificado",  color: "#000", bg: "#fff3cd" },
  ITEMS_OK:          { label: "Ítems OK",         color: "#000", bg: "#d1e7dd" },
  SAP_MONTADO:       { label: "SAP Subido",       color: "#000", bg: "#d1e7dd" },
  VALIDADO:          { label: "Validado",         color: "#000", bg: "#198754" },
  CERRADO:           { label: "Cerrado",          color: "#000", bg: "#198754" },
  ERROR_PARSE:       { label: "Error Parse",      color: "#000", bg: "#dc3545" },
  ERROR_DUPLICADO:   { label: "Duplicado",        color: "#000", bg: "#dc3545" },
  ERROR_ITEMS:       { label: "Error Ítems",      color: "#000", bg: "#dc3545" },
  ERROR_SAP:         { label: "Error SAP",        color: "#000", bg: "#dc3545" },
  ERROR_VALIDACION:  { label: "Error Validación", color: "#000", bg: "#dc3545" },
};

export default function PipelineStatus({ estado }: { estado: string }) {
  const cfg = STATUS_CONFIG[estado] ?? { label: estado, color: "#333", bg: "#e9ecef" };
  return (
    <span
      style={{
        background: cfg.bg,
        color: cfg.color,
        padding: "2px 10px",
        borderRadius: "12px",
        fontSize: "12px",
        fontWeight: 600,
        whiteSpace: "nowrap",
      }}
    >
      {cfg.label}
    </span>
  );
}
