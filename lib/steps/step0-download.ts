/**
 * Step 0: Descarga correos de pedidos desde IMAP y organiza archivos.
 *
 * Por cada correo no leído en INBOX:
 *   - Identifica el cliente (Hermeco / Comodin / Exito / Otros)
 *   - Guarda en pedidos/raw/CLIENTE/YYYYMMDD_HHMMSS_ASUNTO/:
 *       correo_original.txt, correo_original.eml, correo_metadata.json,
 *       estado_pipeline.json, adjuntos PDF
 *   - Mueve el correo en el servidor a Pedidos/Procesados/CLIENTE
 */

import { ImapFlow } from "imapflow";
import fs from "fs";
import path from "path";
import { getConfig } from "../config";
import { getDb, logPipeline, ensureWorkspaceDirs } from "../db";

export interface StepResult {
  procesados: number;
  errores: number;
  saltados: number;
  detalles: string[];
}

function clean(text: string): string {
  return text.replace(/[^a-zA-Z0-9\-_.]/g, "_");
}

function getClientFolder(sender: string, subject: string): string {
  const s = sender.toLowerCase();
  const sub = subject.toLowerCase();
  if (s.includes("offcorss.com") || sub.includes("hermeco") || sub.includes("offcorss")) return "Hermeco";
  if (s.includes("gco.com.co") || sub.includes("comodin") || sub.includes("gco")) return "Comodin";
  if (s.includes("grupo-exito.com") || sub.includes("exito")) return "Exito";
  return "Otros";
}

export async function run(): Promise<StepResult> {
  const config = getConfig();
  ensureWorkspaceDirs();

  const result: StepResult = { procesados: 0, errores: 0, saltados: 0, detalles: [] };

  if (!config.emailUser || !config.emailPass || !config.emailHost) {
    result.detalles.push("Faltan credenciales de email en .env.local");
    return result;
  }

  const client = new ImapFlow({
    host: config.emailHost,
    port: config.emailPort,
    secure: true,
    auth: { user: config.emailUser, pass: config.emailPass },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    const createdFolders = new Set<string>();

    try {
      const messages = [];
      for await (const msg of client.fetch("1:*", {
        uid: true,
        flags: true,
        envelope: true,
        source: true,
      })) {
        if (!msg.flags?.has("\\Seen")) {
          messages.push(msg);
        }
      }

      if (messages.length === 0) {
        result.detalles.push("No hay correos nuevos en INBOX");
        return result;
      }

      result.detalles.push(`Encontrados ${messages.length} correo(s) no leído(s)`);

      for (const msg of messages) {
        try {
          const envelope = msg.envelope;
          const subject = envelope?.subject ?? "Sin asunto";
          const sender = envelope?.from?.[0]?.address ?? "";
          const dateHeader = envelope?.date?.toISOString() ?? new Date().toISOString();

          const client_folder = getClientFolder(sender, subject);
          const ts = new Date()
            .toISOString()
            .replace(/[-:T]/g, (c) => (c === "T" ? "_" : c))
            .split(".")[0];
          let folderName = `${ts}_${clean(subject).slice(0, 50) || "sin_asunto"}`;

          let idx = 1;
          while (createdFolders.has(folderName)) {
            folderName = `${ts}_${clean(subject).slice(0, 50)}_${String(idx).padStart(2, "0")}`;
            idx++;
          }
          createdFolders.add(folderName);

          const pedidoPath = path.join(config.pedidosRawDir, client_folder, folderName);
          fs.mkdirSync(pedidoPath, { recursive: true });

          // Save raw source as EML
          if (msg.source) {
            fs.writeFileSync(path.join(pedidoPath, "correo_original.eml"), msg.source);
          }

          // Parse EML to extract body and attachments
          let bodyText = `De: ${sender}\nAsunto: ${subject}\nFecha: ${dateHeader}\n\n`;
          let pdfCount = 0;

          if (msg.source) {
            // Use simple boundary parsing to extract attachments
            const raw = msg.source.toString("utf8");

            // Extract text/plain body
            const plainMatch = raw.match(/Content-Type: text\/plain[^\r\n]*\r?\n(?:[^\r\n]+:\s*[^\r\n]*\r?\n)*\r?\n([\s\S]*?)(?=\r?\n--|\r?\n\r?\n--)/i);
            if (plainMatch) {
              bodyText += plainMatch[1];
            }

            fs.writeFileSync(path.join(pedidoPath, "correo_original.txt"), bodyText, "utf8");

            // Extract attachments using boundary
            const boundaryMatch = raw.match(/boundary="?([^"\r\n;]+)"?/i);
            if (boundaryMatch) {
              const boundary = "--" + boundaryMatch[1];
              const parts = raw.split(boundary);
              for (const part of parts) {
                const filenameMatch = part.match(/filename[*]?=(?:UTF-8''|"?)([^"\r\n;]+)"?/i);
                if (filenameMatch) {
                  const filename = decodeURIComponent(filenameMatch[1].trim());
                  const safeName = clean(filename) || "adjunto";
                  // Find content after headers
                  const contentStart = part.indexOf("\r\n\r\n");
                  if (contentStart !== -1) {
                    const encodingMatch = part.match(/Content-Transfer-Encoding:\s*(\S+)/i);
                    const encoding = encodingMatch?.[1]?.toLowerCase() ?? "7bit";
                    let content = part.slice(contentStart + 4).replace(/--$/, "").trim();
                    let buf: Buffer;
                    if (encoding === "base64") {
                      buf = Buffer.from(content.replace(/\s+/g, ""), "base64");
                    } else {
                      buf = Buffer.from(content, "binary");
                    }
                    fs.writeFileSync(path.join(pedidoPath, safeName), buf);
                    if (safeName.toLowerCase().endsWith(".pdf")) pdfCount++;
                  }
                }
              }
            }
          } else {
            fs.writeFileSync(path.join(pedidoPath, "correo_original.txt"), bodyText, "utf8");
          }

          const destFolder = `Pedidos/Procesados/${client_folder}`;

          // Write metadata
          const metadata = {
            from: sender,
            subject,
            date: dateHeader,
            client: client_folder,
            folder_local: `pedidos/raw/${client_folder}/${folderName}`,
            folder_server: destFolder,
            n_adjuntos_pdf: pdfCount,
            ts_download: new Date().toISOString(),
          };
          fs.writeFileSync(
            path.join(pedidoPath, "correo_metadata.json"),
            JSON.stringify(metadata, null, 2),
            "utf8"
          );

          fs.writeFileSync(
            path.join(pedidoPath, "estado_pipeline.json"),
            JSON.stringify({ fase: 0, estado: "DESCARGADO", ts: new Date().toISOString() }, null, 2),
            "utf8"
          );

          // Mark as seen and move to processed folder
          await client.messageFlagsAdd({ uid: msg.uid }, ["\\Seen"]);
          try {
            await client.mailboxCreate(destFolder);
          } catch {
            /* already exists */
          }
          try {
            await client.messageMove({ uid: msg.uid }, destFolder);
          } catch {
            /* keep in INBOX if move fails */
          }

          // Log to DB
          try {
            const db = getDb();
            logPipeline(db, folderName, 0, "download", "OK",
              `Correo de ${client_folder} descargado: ${pdfCount} PDF(s)`);
          } catch {
            /* DB might not exist yet */
          }

          result.procesados++;
          result.detalles.push(`OK: pedidos/raw/${client_folder}/${folderName} (${pdfCount} PDF)`);
        } catch (e) {
          result.errores++;
          result.detalles.push(`ERROR en mensaje: ${String(e)}`);
        }
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (e) {
    result.errores++;
    result.detalles.push(`Error de conexión IMAP: ${String(e)}`);
  }

  return result;
}
