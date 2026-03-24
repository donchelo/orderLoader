"use client";

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  NUEVO:             { label: "Nuevo",           color: "#6c757d", bg: "#f8f9fa" },
  PARSED:            { label: "Parseado",         color: "#0c63e4", bg: "#cfe2ff" },
  PARSE_VALIDO:      { label: "Parse OK",         color: "#0a3622", bg: "#d1e7dd" },
  SAP_NUEVO:         { label: "SAP: Nuevo",       color: "#664d03", bg: "#fff3cd" },
  SAP_VERIFICADO:    { label: "SAP: Verificado",  color: "#664d03", bg: "#fff3cd" },
  ITEMS_OK:          { label: "Ítems OK",         color: "#0a3622", bg: "#d1e7dd" },
  SAP_MONTADO:       { label: "SAP Subido",       color: "#0a3622", bg: "#d1e7dd" },
  VALIDADO:          { label: "Validado",         color: "#0a3622", bg: "#198754" },
  CERRADO:           { label: "Cerrado",          color: "#ffffff", bg: "#198754" },
  ERROR_PARSE:       { label: "Error Parse",      color: "#ffffff", bg: "#dc3545" },
  ERROR_DUPLICADO:   { label: "Duplicado",        color: "#ffffff", bg: "#dc3545" },
  ERROR_ITEMS:       { label: "Error Ítems",      color: "#ffffff", bg: "#dc3545" },
  ERROR_SAP:         { label: "Error SAP",        color: "#ffffff", bg: "#dc3545" },
  ERROR_VALIDACION:  { label: "Error Validación", color: "#ffffff", bg: "#dc3545" },
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
