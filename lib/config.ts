import path from "path";

export interface Config {
  // Paths
  workspaceRoot: string;
  dbPath: string;
  pedidosRawDir: string;
  pedidosBackupsDir: string;
  pedidosReportsDir: string;

  // IMAP
  emailUser: string;
  emailPass: string;
  emailHost: string;
  emailPort: number;

  // SMTP
  smtpHost: string;
  smtpPort: number;
  notifyEmail: string;
  notifyAlertasEmail: string;

  // SAP B1
  sapUrl: string;
  sapUser: string;
  sapPass: string;
  sapCompany: string;
  sapPriceList: number;
  sapPriceTolerance: number;

  // NIT → CardCode mapping
  nitToCardCode: Record<string, string>;

  // Cliente → keywords para clasificar correos reenviados
  clientKeywords: Record<string, string[]>;
}

let _config: Config | null = null;

export function getConfig(): Config {
  if (_config) return _config;

  // Workspace root = parent of this file's directory (orderloader/..)
  // In Next.js, process.cwd() is the project root
  const appRoot = process.cwd();
  // The original workspace is one level up from the app
  const workspaceRoot = path.resolve(appRoot, "..");

  const emailUser = process.env.EMAIL_USER ?? "";
  const emailHost = process.env.EMAIL_HOST ?? "";
  const smtpHost =
    process.env.EMAIL_SMTP_HOST ||
    emailHost.replace("imap.", "smtp.") ||
    "";

  _config = {
    workspaceRoot,
    dbPath: path.join(workspaceRoot, "orderloader.db"),
    pedidosRawDir: path.join(workspaceRoot, "pedidos", "raw"),
    pedidosBackupsDir: path.join(workspaceRoot, "pedidos", "backups"),
    pedidosReportsDir: path.join(workspaceRoot, "pedidos", "reports"),

    emailUser,
    emailPass: process.env.EMAIL_PASS ?? "",
    emailHost,
    emailPort: parseInt(process.env.EMAIL_PORT ?? "993"),

    smtpHost,
    smtpPort: parseInt(process.env.EMAIL_SMTP_PORT ?? "587"),
    notifyEmail: process.env.NOTIFY_EMAIL ?? emailUser,
    notifyAlertasEmail:
      process.env.NOTIFY_ALERTAS_EMAIL ||
      process.env.NOTIFY_EMAIL ||
      emailUser,

    sapUrl: (process.env.SAP_B1_URL ?? "").replace(/\/$/, ""),
    sapUser: process.env.SAP_B1_USER ?? "",
    sapPass: process.env.SAP_B1_PASS ?? "",
    sapCompany: process.env.SAP_B1_COMPANY ?? "",
    sapPriceList: parseInt(process.env.SAP_B1_PRICE_LIST ?? "1"),
    sapPriceTolerance: parseFloat(process.env.SAP_B1_PRICE_TOLERANCE ?? "2.0"),

    nitToCardCode: {
      "890924167-6": "C_HERMECO",
      "800069933":   "CN800069933",
      "9008516551":  "C_EXITO",
    },

    clientKeywords: {
      "Comodin": ["gco", "comodin", "americanino", "800069933", "gco.com.co"],
      "Hermeco": ["hermeco", "offcorss", "890924167", "offcorss.com"],
      "Exito":   ["exito", "grupo-exito", "9008516551", "grupo-exito.com"],
    },
  };

  return _config;
}
