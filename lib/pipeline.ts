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

async function runSteps(stepsToRun: typeof STEPS): Promise<StepResult[]> {
  const results: StepResult[] = [];
  for (const step of stepsToRun) {
    const t0 = Date.now();
    try {
      const r = await step.fn();
      results.push({
        step: step.n, name: step.name,
        procesados: r.procesados, errores: r.errores,
        saltados: r.saltados, detalles: r.detalles,
        duracionMs: Date.now() - t0,
      });
    } catch (e) {
      results.push({
        step: step.n, name: step.name,
        procesados: 0, errores: 1, saltados: 0,
        detalles: [`Error inesperado en step ${step.n}: ${String(e)}`],
        duracionMs: Date.now() - t0,
      });
    }
  }
  return results;
}

export async function runPipeline(opts: PipelineOptions = {}): Promise<StepResult[]> {
  const { fromStep = 0, toStep = 7, onlyStep } = opts;

  // Backup DB before running
  try { backupDb(); } catch { /* ignore */ }

  clearSapClient();

  // Modo onlyStep o fromStep > 0: ejecución directa sin loop
  if (onlyStep != null || fromStep > 0) {
    const stepsToRun = onlyStep != null
      ? STEPS.filter(s => s.n === onlyStep)
      : STEPS.filter(s => s.n >= fromStep && s.n <= toStep);
    const results = await runSteps(stepsToRun);
    clearSapClient();
    return results;
  }

  // Flujo completo (fromStep=0): loop unitario — 1 correo a la vez hasta vaciar bandeja
  const allResults: StepResult[] = [];
  const processingSteps = STEPS.filter(s => s.n >= 1 && s.n <= toStep);
  let iteration = 0;

  while (true) {
    iteration++;
    clearSapClient();

    // Step 0: descargar 1 correo
    const t0 = Date.now();
    let downloadResult: StepResult;
    try {
      const r = await step0();
      downloadResult = {
        step: 0, name: "download",
        procesados: r.procesados, errores: r.errores,
        saltados: r.saltados, detalles: r.detalles,
        duracionMs: Date.now() - t0,
      };
    } catch (e) {
      downloadResult = {
        step: 0, name: "download",
        procesados: 0, errores: 1, saltados: 0,
        detalles: [`Error en download: ${String(e)}`],
        duracionMs: Date.now() - t0,
      };
    }

    allResults.push(downloadResult);

    // Si no hubo correos nuevos, terminar
    if (downloadResult.procesados === 0) break;

    // Pasos 1-7 para el correo recién descargado
    const stepResults = await runSteps(processingSteps);
    allResults.push(...stepResults);
  }

  // Clean up SAP session
  try {
    const { getSapClient } = await import("./sap-client");
    const sap = await getSapClient().catch(() => null);
    if (sap) await sap.logout();
  } catch { /* ignore */ }
  clearSapClient();

  return allResults;
}
