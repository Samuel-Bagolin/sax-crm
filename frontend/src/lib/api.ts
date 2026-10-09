// Typed fetch layer over the FastAPI backend. Base is the relative "/api" prefix so the
// same code works in dev (Vite proxies /api → :8001) and behind a single origin in prod.
const BASE = "/api";

// Fields are declared, not constructor parameter properties: tsconfig sets
// erasableSyntaxOnly, which rejects `constructor(readonly status: number)`.
export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`request failed with ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type JsonBody = unknown;

async function request<T>(method: string, path: string, body?: JsonBody): Promise<T> {
  // Auth rides the httpOnly session cookie automatically — never add auth headers here.
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // FastAPI reports request-validation failures as 422 with a {detail: [...]} body.
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new ApiError(res.status, errBody);
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json();
  const next = res.headers.get("X-Next-Offset");
  if (method === "GET" && next && Array.isArray(data)) {
    const url = new URL(path, window.location.origin);
    url.searchParams.set("offset", next);
    return [...data, ...await request<unknown[]>("GET", url.pathname + url.search)] as T;
  }
  return data as T;
}

// The response type is yours to declare: nothing infers across the Python boundary, so a
// TS interface here mirrors the endpoint's Pydantic model by hand — keep the two in sync.
export const apiGet = <T>(path: string) => request<T>("GET", path);
export const apiPost = <T>(path: string, body?: JsonBody) => request<T>("POST", path, body ?? null);
export const apiPut = <T>(path: string, body?: JsonBody) => request<T>("PUT", path, body ?? null);
export const apiPatch = <T>(path: string, body?: JsonBody) =>
  request<T>("PATCH", path, body ?? null);
export const apiDelete = <T>(path: string) => request<T>("DELETE", path);

// Extrai a mensagem `detail` de um corpo de erro FastAPI (ex.: 409 com regra de negócio).
export function detalheErro(erro: unknown): string | undefined {
  if (erro instanceof ApiError) {
    const corpo = erro.body as { detail?: unknown } | null;
    if (corpo && typeof corpo.detail === "string") return corpo.detail;
    if (corpo && Array.isArray(corpo.detail)) {
      const messages = corpo.detail.map((item: unknown) => {
        if (!item || typeof item !== "object") return "";
        const detail = item as { loc?: unknown; msg?: unknown };
        const field = Array.isArray(detail.loc) ? detail.loc.filter(x => x !== "body").join(".") : "campo";
        return typeof detail.msg === "string" ? `${field}: ${detail.msg}` : "";
      }).filter(Boolean);
      if (messages.length) return `Revise os dados: ${messages.join("; ")}`;
    }
    if (erro.status === 401) return "Sua sessão expirou. Entre novamente no ERP.";
    if (erro.status >= 500) return "O servidor não concluiu a operação. Atualize a lista antes de tentar novamente.";
  }
  return undefined;
}
