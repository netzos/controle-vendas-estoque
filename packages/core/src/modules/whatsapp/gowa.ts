import { createHmac, timingSafeEqual } from "node:crypto";

// Ponte do WhatsApp por QR Code: o GOWA (go-whatsapp-web-multidevice), o mesmo
// do NetzOS (netzos/netzos, netzv4/internal/whatsapp/gowa). Ele roda num servidor
// sempre ligado; o netzsales só conversa com ele por HTTPS, com usuário e senha.
// Variáveis na Vercel: WHATSAPP_GOWA_URL, WHATSAPP_GOWA_USER, WHATSAPP_GOWA_PASSWORD,
// WHATSAPP_WEBHOOK_SECRET e, opcional, WHATSAPP_DEVICE_ID (padrão "netzsales").
// Os testes trocam a ponte por uma falsa.

export interface WhatsAppStatus {
  connected: boolean;
  loggedIn: boolean;
  /** Número conectado, só dígitos (55...), quando o WhatsApp informa. */
  phone: string | null;
}

export interface WhatsAppApi {
  status(): Promise<WhatsAppStatus>;
  /** Cria o aparelho (se faltar) e devolve o QR em data URI PNG. */
  loginQr(): Promise<{ image: string; expiresIn: number }>;
  logout(): Promise<void>;
  send(jid: string, text: string): Promise<void>;
  typing(jid: string, on: boolean): Promise<void>;
  /** Baixa um arquivo que a ponte guardou (áudio, foto). */
  download(path: string): Promise<{ data: Uint8Array<ArrayBuffer>; mimeType: string | null }>;
}

const env = (name: string) => (process.env[name] ?? "").trim();

export function whatsappConfigured(): boolean {
  return !!env("WHATSAPP_GOWA_URL") && !!env("WHATSAPP_WEBHOOK_SECRET");
}

export function whatsappDeviceId(): string {
  return env("WHATSAPP_DEVICE_ID") || "netzsales";
}

/** Confere a assinatura X-Hub-Signature-256 (sha256=hex) que a ponte manda em cada aviso. */
export function verifyWhatsAppSignature(body: string, header: string | null): boolean {
  const secret = env("WHATSAPP_WEBHOOK_SECRET");
  if (!secret || !header?.startsWith("sha256=")) return false;
  const got = Buffer.from(header.slice(7), "hex");
  const want = createHmac("sha256", secret).update(body).digest();
  return got.length === want.length && timingSafeEqual(got, want);
}

// Conversa privada: número de telefone com @s.whatsapp.net (nunca grupo nem LID).
const PRIVATE_JID = /^[1-9][0-9]{7,14}@s\.whatsapp\.net$/;
export const isPrivateJid = (jid: string) => PRIVATE_JID.test(jid);
const STATICS = /^statics\/[A-Za-z0-9._@/+-]+$/;
export const isStaticsPath = (p: string) => STATICS.test(p) && !p.includes("..");

function base(): string {
  const url = env("WHATSAPP_GOWA_URL").replace(/\/+$/, "");
  if (!url) throw new Error("WHATSAPP_GOWA_URL ausente");
  return url;
}

function headers(json = true): Record<string, string> {
  const h: Record<string, string> = { "X-Device-Id": whatsappDeviceId() };
  if (json) h["content-type"] = "application/json";
  const user = env("WHATSAPP_GOWA_USER");
  if (user) h.authorization = `Basic ${Buffer.from(`${user}:${env("WHATSAPP_GOWA_PASSWORD")}`).toString("base64")}`;
  return h;
}

class GowaError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: headers(),
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => null)) as { code?: string; message?: string; results?: T } | null;
  if (!res.ok || data?.code !== "SUCCESS") throw new GowaError(res.status, `WhatsApp ${path}: ${data?.message ?? data?.code ?? res.status}`);
  return data.results as T;
}

const device = () => `/devices/${encodeURIComponent(whatsappDeviceId())}`;
// A v9.6.0 responde 500 "device X not found" para aparelho que ainda não existe.
const missing = (err: unknown) => err instanceof GowaError && (err.status === 404 || err.message.includes(`device ${whatsappDeviceId()} not found`));

async function ensureDevice(): Promise<void> {
  try {
    await request("GET", `${device()}/status`);
  } catch (err) {
    if (!missing(err)) throw err;
    await request("POST", "/devices", { device_id: whatsappDeviceId() }).catch(async (e) => {
      // Outro pedido pode ter criado o mesmo aparelho ao mesmo tempo.
      await request("GET", `${device()}/status`).catch(() => {
        throw e;
      });
    });
  }
}

export const gowaApi: WhatsAppApi = {
  async status() {
    let s: { is_connected?: boolean; is_logged_in?: boolean };
    try {
      s = await request("GET", `${device()}/status`);
    } catch (err) {
      if (missing(err)) return { connected: false, loggedIn: false, phone: null };
      throw err;
    }
    let phone: string | null = null;
    if (s.is_logged_in) {
      const info = await request<{ phone_number?: string; jid?: string }>("GET", device()).catch(() => null);
      const raw = info?.phone_number || (info?.jid?.endsWith("@s.whatsapp.net") ? info.jid.split("@")[0]!.split(":")[0]! : "");
      phone = /^[0-9]{8,15}$/.test(raw ?? "") ? raw! : null;
    }
    return { connected: !!s.is_connected, loggedIn: !!s.is_logged_in, phone };
  },
  async loginQr() {
    await ensureDevice();
    const r = await request<{ qr_link: string; qr_duration?: number }>("GET", `${device()}/login`);
    // Só busca a imagem no próprio servidor da ponte, na pasta de QR Codes.
    const url = new URL(r.qr_link, `${base()}/`);
    if (url.origin !== new URL(base()).origin || !url.pathname.startsWith("/statics/qrcode/") || !url.pathname.endsWith(".png")) {
      throw new Error("Endereço do QR Code inesperado");
    }
    const res = await fetch(url, { headers: headers(false), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`QR Code: ${res.status}`);
    const png = Buffer.from(await res.arrayBuffer());
    const duration = r.qr_duration && r.qr_duration > 0 && r.qr_duration <= 120 ? r.qr_duration : 30;
    return { image: `data:image/png;base64,${png.toString("base64")}`, expiresIn: duration };
  },
  async logout() {
    try {
      await request("POST", `${device()}/logout`);
    } catch (err) {
      if (!missing(err)) throw err;
    }
  },
  async send(jid, text) {
    if (!isPrivateJid(jid)) throw new Error("Conversa inválida");
    await request("POST", "/send/message", { phone: jid, message: text });
  },
  async typing(jid, on) {
    await request("POST", "/send/chat-presence", { phone: jid, action: on ? "start" : "stop" });
  },
  async download(path) {
    if (!isStaticsPath(path)) throw new Error("Arquivo inválido");
    const res = await fetch(`${base()}/${path}`, { headers: headers(false), signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`WhatsApp download: ${res.status}`);
    return { data: new Uint8Array(await res.arrayBuffer()), mimeType: res.headers.get("content-type") };
  },
};
