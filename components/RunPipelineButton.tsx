"use client";

import { useState } from "react";

interface StepResult {
  step: number;
  name: string;
  procesados: number;
  errores: number;
  saltados: number;
  detalles: string[];
  duracionMs: number;
}

interface Props {
  onComplete?: () => void;
}

export default function RunPipelineButton({ onComplete }: Props) {
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<StepResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRun() {
    setRunning(true);
    setResults(null);
    setError(null);

    try {
      const res = await fetch("/api/pipeline/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.ok) {
        setResults(data.results);
        onComplete?.();
      } else {
        setError(data.error ?? "Error desconocido");
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <button
        onClick={handleRun}
        disabled={running}
        style={{
          background: running ? "#6c757d" : "#0d6efd",
          color: "#fff",
          border: "none",
          borderRadius: "6px",
          padding: "10px 24px",
          fontSize: "14px",
          fontWeight: 600,
          cursor: running ? "not-allowed" : "pointer",
        }}
      >
        {running ? "⏳ Ejecutando pipeline…" : "▶ Correr Pipeline"}
      </button>

      {error && (
        <div style={{ marginTop: 12, background: "#f8d7da", color: "#842029", padding: "10px 14px", borderRadius: 6 }}>
          Error: {error}
        </div>
      )}

      {results && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ margin: "0 0 8px" }}>Resultados del pipeline</h3>
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#343a40", color: "#fff" }}>
                <th style={{ padding: "6px 12px", textAlign: "left" }}>Step</th>
                <th style={{ padding: "6px 12px" }}>Procesados</th>
                <th style={{ padding: "6px 12px" }}>Errores</th>
                <th style={{ padding: "6px 12px" }}>Saltados</th>
                <th style={{ padding: "6px 12px" }}>Tiempo</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} style={{ background: r.errores > 0 ? "#f8d7da" : "#d1e7dd" }}>
                  <td style={{ padding: "6px 12px" }}>{r.step}: {r.name}</td>
                  <td style={{ padding: "6px 12px", textAlign: "center" }}>{r.procesados}</td>
                  <td style={{ padding: "6px 12px", textAlign: "center" }}>{r.errores}</td>
                  <td style={{ padding: "6px 12px", textAlign: "center" }}>{r.saltados}</td>
                  <td style={{ padding: "6px 12px", textAlign: "center" }}>{r.duracionMs}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: "pointer", fontSize: 13, color: "#6c757d" }}>Ver detalles</summary>
            <pre style={{ background: "#f8f9fa", padding: 12, borderRadius: 6, fontSize: 12, overflowX: "auto" }}>
              {results.flatMap(r => r.detalles).join("\n")}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}
