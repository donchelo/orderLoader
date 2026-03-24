import { backupDb } from "./db";
import { clearSapClient } from "./sap-client";
import { run as step0 } from "./steps/step0-download";
import { run as step1 } from "./steps/step1-parse";
import { run as step2 } from "./steps/step2-validate-parse";
import { run as step3 } from "./steps/step3-sap-query";
import { run as step4 } from "./steps/step4-items";
import { run as step5 } from "./steps/step5-upload";
import { run as step6 } from "./steps/step6-reconcile";
import { run as step7 } from "./steps/step7-notify";

export interface StepResult {
  step: number;
  name: string;
  procesados: number;
  errores: number;
  saltados: number;
  detalles: string[];
  duracionMs: number;
}

export interface PipelineOptions {
  fromStep?: number;
  toStep?: number;
  onlyStep?: number;
}

const STEPS = [
  { n: 0, name: "download",       fn: step0 },
  { n: 1, name: "parse",          fn: step1 },
  { n: 2, name: "validate-parse", fn: step2 },
  { n: 3, name: "sap-query",      fn: step3 },
  { n: 4, name: "items",          fn: step4 },
  { n: 5, name: "upload",         fn: step5 },
  { n: 6, name: "reconcile",      fn: step6 },
  { n: 7, name: "notify",         fn: step7 },
];

export async function runPipeline(opts: PipelineOptions = {}): Promise<StepResult[]> {
  const { fromStep = 0, toStep = 7, onlyStep } = opts;

  // Backup DB before running
  try { backupDb(); } catch { /* ignore */ }

  // Reset SAP client singleton for fresh connections
  clearSapClient();

  const stepsToRun = onlyStep != null
    ? STEPS.filter(s => s.n === onlyStep)
    : STEPS.filter(s => s.n >= fromStep && s.n <= toStep);

  const results: StepResult[] = [];

  for (const step of stepsToRun) {
    const t0 = Date.now();
    try {
      const r = await step.fn();
      results.push({
        step: step.n,
        name: step.name,
        procesados: r.procesados,
        errores: r.errores,
        saltados: r.saltados,
        detalles: r.detalles,
        duracionMs: Date.now() - t0,
      });
    } catch (e) {
      results.push({
        step: step.n,
        name: step.name,
        procesados: 0,
        errores: 1,
        saltados: 0,
        detalles: [`Error inesperado en step ${step.n}: ${String(e)}`],
        duracionMs: Date.now() - t0,
      });
    }
  }

  // Clean up SAP session
  try {
    const { getSapClient } = await import("./sap-client");
    const sap = await getSapClient().catch(() => null);
    if (sap) await sap.logout();
  } catch { /* ignore */ }
  clearSapClient();

  return results;
}
