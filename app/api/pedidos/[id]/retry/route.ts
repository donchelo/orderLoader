import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { runPipeline } from "@/lib/pipeline";

// Maps an error state + fase_actual to { resetTo, fromStep }
function retryConfig(estado: string, fase: number): { resetTo: string; fromStep: number } | null {
  if (estado === "ERROR_PARSE") {
    return fase <= 1
      ? { resetTo: "NUEVO",   fromStep: 1 }
      : { resetTo: "PARSED",  fromStep: 2 };
  }
  if (estado === "ERROR_ITEMS" || estado === "ERROR_SAP") {
    return { resetTo: "PARSE_VALIDO", fromStep: 3 };
  }
  if (estado === "ERROR_VALIDACION") {
    return { resetTo: "SAP_MONTADO", fromStep: 5 };
  }
  return null;
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();

  const pedido = db.prepare("SELECT * FROM pedidos_maestro WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;

  if (!pedido) {
    return new Response(`data: ${JSON.stringify({ type: "error", error: "Pedido no encontrado" })}\n\n`, {
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  const cfg = retryConfig(String(pedido.estado), Number(pedido.fase_actual));
  if (!cfg) {
    return new Response(
      `data: ${JSON.stringify({ type: "error", error: `No se puede reintentar desde estado ${pedido.estado}` })}\n\n`,
      { headers: { "Content-Type": "text/event-stream" } }
    );
  }

  // Reset order state
  db.prepare("UPDATE pedidos_maestro SET estado = ?, error_msg = NULL WHERE id = ?")
    .run(cfg.resetTo, id);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      try {
        await runPipeline({
          fromStep: cfg.fromStep,
          onStep: (result) => emit({ type: "step", result }),
        });
        emit({ type: "done" });
      } catch (e) {
        emit({ type: "error", error: String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
