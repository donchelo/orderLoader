import { getDb } from "../lib/db";

const PRICING = {
  inputPer1M: 3.0,
  outputPer1M: 15.0,
  trm: 4000
};

async function calculate() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT 
      SUM(input_tokens) as total_input,
      SUM(output_tokens) as total_output,
      COUNT(*) as total_orders
    FROM pipeline_log
    WHERE input_tokens IS NOT NULL
  `).get() as { total_input: number, total_output: number, total_orders: number };

  if (!rows || !rows.total_input) {
    console.log("No hay datos de consumo registrados todavía.");
    return;
  }

  const costInputUsd = (rows.total_input / 1000000) * PRICING.inputPer1M;
  const costOutputUsd = (rows.total_output / 1000000) * PRICING.outputPer1M;
  const totalUsd = costInputUsd + costOutputUsd;
  const totalCop = totalUsd * PRICING.trm;

  console.log("=== Reporte de Costos de IA (Anthropic) ===");
  console.log(`Pedidos procesados: ${rows.total_orders}`);
  console.log(`Input Tokens:     ${rows.total_input.toLocaleString()}`);
  console.log(`Output Tokens:    ${rows.total_output.toLocaleString()}`);
  console.log("-------------------------------------------");
  console.log(`Costo Total (USD): $${totalUsd.toFixed(4)}`);
  console.log(`Costo Total (COP): $${totalCop.toLocaleString()} (TRM $${PRICING.trm})`);
  console.log(`Promedio por OC:   $${(totalCop / rows.total_orders).toFixed(0)} COP`);
}

calculate().catch(console.error);
