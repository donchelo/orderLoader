import { NextRequest } from "next/server";
import { runPipeline } from "@/lib/pipeline";

export async function POST(req: NextRequest) {
  // Security check for automated triggers
  const authHeader = req.headers.get("Authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { 
      status: 401, 
      headers: { "Content-Type": "application/json" } 
    });
  }

  const body = await req.json().catch(() => ({}));
  const { fromStep, toStep, onlyStep } = body as Record<string, number | undefined>;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        await runPipeline({
          fromStep, toStep, onlyStep,
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
