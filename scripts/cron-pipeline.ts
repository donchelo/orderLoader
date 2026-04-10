import { runPipeline } from "../lib/pipeline";

async function main() {
  console.log(`[${new Date().toISOString()}] Starting scheduled pipeline run...`);
  
  try {
    const results = await runPipeline();
    
    console.log(`[${new Date().toISOString()}] Pipeline finished.`);
    results.forEach(r => {
      const status = r.errores > 0 ? "⚠️" : "✅";
      console.log(`${status} Step ${r.step} (${r.name}): ${r.procesados} processed, ${r.errores} errors, ${r.saltados} skipped (${r.duracionMs}ms)`);
      if (r.errores > 0) {
        r.detalles.forEach(d => console.log(`   - ERROR: ${d}`));
      }
    });

    const totalProcessed = results.reduce((sum, r) => sum + r.procesados, 0);
    const totalErrors = results.reduce((sum, r) => sum + r.errores, 0);
    console.log(`Summary: Total Processed: ${totalProcessed}, Total Errors: ${totalErrors}`);

  } catch (error) {
    console.error(`[${new Date().toISOString()}] CRITICAL ERROR in pipeline:`, error);
    process.exit(1);
  }
}

main();
