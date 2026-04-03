import { getConfig } from "./config";

const SAP_TIMEOUT_MS = 30_000;

interface RequestInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export class SapB1Client {
  private baseUrl: string;
  private user: string;
  private password: string;
  private company: string;
  private cookies: string = "";

  constructor(
    baseUrl: string,
    user: string,
    password: string,
    company: string
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.user = user;
    this.password = password;
    this.company = company;
  }

  async login(): Promise<void> {
    const res = await this._fetch(`${this.baseUrl}/Login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        UserName: this.user,
        Password: this.password,
        CompanyDB: this.company,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`SAP login failed ${res.status}: ${text}`);
    }
    // Collect session cookies from Set-Cookie header
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      this.cookies = setCookie
        .split(",")
        .map((c) => c.split(";")[0].trim())
        .join("; ");
    }
  }

  async logout(): Promise<void> {
    try {
      console.log("SAP: Logging out...");
      await this._fetch(`${this.baseUrl}/Logout`, {
        method: "POST",
        headers: this._headers(),
      });
      console.log("SAP: Logout successful.");
    } catch (e) {
      console.warn("SAP: Logout failed (ignoring):", String(e));
    }
    this.cookies = "";
  }

  async get<T = unknown>(
    endpoint: string,
    params?: Record<string, string>
  ): Promise<T> {
    let url = `${this.baseUrl}/${endpoint.replace(/^\//, "")}`;
    if (params) {
      url += "?" + new URLSearchParams(params).toString();
    }
    return this._request<T>("GET", url);
  }

  async post<T = unknown>(endpoint: string, data: unknown): Promise<T> {
    const url = `${this.baseUrl}/${endpoint.replace(/^\//, "")}`;
    return this._request<T>("POST", url, data);
  }

  async patch(endpoint: string, data: unknown): Promise<void> {
    const url = `${this.baseUrl}/${endpoint.replace(/^\//, "")}`;
    await this._request("PATCH", url, data);
  }

  private async _request<T>(
    method: string,
    url: string,
    body?: unknown
  ): Promise<T> {
    const opts: RequestInit = {
      method,
      headers: this._headers(),
      ...(body ? { body: JSON.stringify(body) } : {}),
    };

    let res = await this._fetch(url, opts);

    // Auto-reconnect on 401
    if (res.status === 401) {
      await this.login();
      opts.headers = this._headers();
      res = await this._fetch(url, opts);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`SAP ${method} ${url} → ${res.status}: ${text}`);
    }

    // PATCH returns 204 No Content
    if (res.status === 204) return undefined as T;
    return res.json() as Promise<T>;
  }

  private _headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(this.cookies ? { Cookie: this.cookies } : {}),
    };
  }

  private async _fetch(url: string, opts: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SAP_TIMEOUT_MS);
    try {
      // SAP B1 often uses self-signed certs — if you get SSL errors,
      // you might need to run with NODE_TLS_REJECT_UNAUTHORIZED=0
      return await fetch(url, { ...opts, signal: controller.signal });
    } catch (e: any) {
      if (e.name === "AbortError") {
        throw new Error(`SAP timeout (${SAP_TIMEOUT_MS}ms) calling ${url}`);
      }
      if (e.code === "CERT_HAS_EXPIRED" || e.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || e.message?.includes("certificate")) {
        throw new Error(`Error de certificado SSL con SAP: ${e.message}. Intenta configurar NODE_TLS_REJECT_UNAUTHORIZED=0 en tu entorno si usas certificados auto-firmados.`);
      }
      throw new Error(`Error de red conectando a SAP (${url}): ${e.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

let _sapClient: SapB1Client | null = null;

export async function getSapClient(): Promise<SapB1Client> {
  const config = getConfig();
  const missing = (["sapUrl", "sapUser", "sapPass", "sapCompany"] as const)
    .filter((k) => !config[k] || String(config[k]).startsWith("{"))
    .map((k) => k.toUpperCase().replace("SAP", "SAP_B1_"));

  if (missing.length) {
    throw new Error(
      `SAP B1 no configurado. Faltan en .env.local: ${missing.join(", ")}`
    );
  }

  if (!_sapClient) {
    _sapClient = new SapB1Client(
      config.sapUrl,
      config.sapUser,
      config.sapPass,
      config.sapCompany
    );
    await _sapClient.login();
  }
  return _sapClient;
}

export async function logoutSapClient(): Promise<void> {
  if (_sapClient) {
    await _sapClient.logout();
    _sapClient = null;
  }
}

export function clearSapClient(): void {
  _sapClient = null;
}
