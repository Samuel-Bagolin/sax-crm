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
        const detail = item as { loc?: unknown; msg?: unknown; type?: unknown; ctx?: Record<string, unknown> };
        const campo = Array.isArray(detail.loc) ? String(detail.loc.filter((x) => x !== "body").slice(-1)[0] ?? "campo") : "campo";
        return `${nomeCampo(campo)}: ${mensagemValidacao(detail)}`;
      }).filter(Boolean);
      if (messages.length) return `Revise os dados. ${messages.join("; ")}`;
    }
    if (erro.status === 401) return "Sua sessão expirou. Entre novamente no ERP.";
    if (erro.status >= 500) return "O servidor não concluiu a operação. Atualize a lista antes de tentar novamente.";
  }
  return undefined;
}

// Nomes dos campos como aparecem na tela (o servidor manda o nome técnico).
const CAMPOS: Record<string, string> = {
  admin_email: "E-mail do gestor", admin_nome: "Nome do gestor", email: "E-mail", nome: "Nome", telefone: "Telefone",
  senha: "Senha", documento: "CPF ou CNPJ", cpf_cnpj: "CPF ou CNPJ", preco_venda: "Preço de venda", preco_fipe: "FIPE",
  custo_aquisicao: "Custo de aquisição", valor: "Valor", valor_estimado: "Valor", data: "Data", inicio: "Início", fim: "Fim",
  data_nascimento: "Data de nascimento", km: "Quilometragem", ano_fabricacao: "Ano de fabricação", ano_modelo: "Ano do modelo",
  placa: "Placa", cep: "CEP", slug: "Endereço", titulo: "Título", duracao_min: "Duração", hora: "Hora", repasse_valor: "Repasse",
  comissao_pct: "Comissão", parcelas: "Parcelas", dia_vencimento: "Dia de vencimento", quantidade: "Quantidade",
};

function nomeCampo(campo: string): string {
  if (CAMPOS[campo]) return CAMPOS[campo];
  const t = campo.replace(/_id$/, "").replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Erros de validação do Pydantic em português, sem jargão. */
function mensagemValidacao(d: { msg?: unknown; type?: unknown; ctx?: Record<string, unknown> }): string {
  const tipo = String(d.type ?? "");
  const ctx = d.ctx ?? {};
  const num = (v: unknown) => (typeof v === "number" ? v.toLocaleString("pt-BR") : String(v));
  if (tipo === "missing") return "preencha este campo";
  if (tipo.startsWith("value_error") && String(d.msg ?? "").includes("email")) return "informe um e-mail válido (ex.: nome@empresa.com.br)";
  if (tipo === "greater_than_equal") return `informe um valor igual ou maior que ${num(ctx.ge)}`;
  if (tipo === "greater_than") return `informe um valor maior que ${num(ctx.gt)}`;
  if (tipo === "less_than_equal") return `informe um valor de até ${num(ctx.le)}`;
  if (tipo === "less_than") return `informe um valor menor que ${num(ctx.lt)}`;
  if (tipo === "string_too_short") return `use pelo menos ${num(ctx.min_length)} caracteres`;
  if (tipo === "string_too_long") return `use no máximo ${num(ctx.max_length)} caracteres`;
  if (tipo === "too_long") return `máximo de ${num(ctx.max_length)} itens`;
  if (tipo.endsWith("_parsing") || tipo.endsWith("_type")) return "valor em formato inválido";
  if (tipo === "literal_error" || tipo === "enum") return "escolha uma das opções da lista";
  if (tipo === "string_pattern_mismatch") return "formato inválido";
  const msg = String(d.msg ?? "valor inválido");
  // Mensagens que nós mesmos escrevemos em português chegam como "Value error, ...".
  return msg.replace(/^Value error, /, "");
}
