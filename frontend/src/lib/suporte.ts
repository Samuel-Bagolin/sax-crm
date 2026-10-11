/* Suporte em outra aba: o Administrador de Sistema abre a empresa numa aba nova (/?suporte=<id>).
   A empresa fica guardada só naquela aba (sessionStorage) e vai em todas as chamadas à API pelo
   cabeçalho X-Sax-Empresa. A aba do plano de controle continua sem empresa, então as duas visões
   ficam separadas. Imagens e arquivos abertos por URL levam o parâmetro _emp (só GET). */

const CHAVE = "sax_suporte_empresa";

export function empresaSuporte(): string | null {
  try {
    return sessionStorage.getItem(CHAVE);
  } catch {
    return null;
  }
}

export function sairDoSuporteNaAba() {
  try {
    sessionStorage.removeItem(CHAVE);
  } catch {
    /* sem armazenamento: nada a limpar */
  }
}

/** Abre a empresa numa aba nova, sem mexer na aba atual. */
export function abrirEmpresaEmNovaAba(empresaId: string) {
  window.open(`/?suporte=${encodeURIComponent(empresaId)}`, "_blank");
}

/** URL de /api para <img>, <a> e window.open: na aba de suporte leva a empresa junto. */
export function urlApi(caminho: string): string {
  const emp = empresaSuporte();
  if (!emp || !caminho.startsWith("/api/") || caminho.startsWith("/api/publico/") || caminho.startsWith("/api/assinatura/")) return caminho;
  return `${caminho}${caminho.includes("?") ? "&" : "?"}_emp=${encodeURIComponent(emp)}`;
}

/** Roda antes do React: lê ?suporte= da URL e passa a mandar a empresa em todo fetch para /api. */
export function iniciarSuporte() {
  try {
    const url = new URL(window.location.href);
    const pedida = url.searchParams.get("suporte");
    if (pedida) {
      sessionStorage.setItem(CHAVE, pedida);
      url.searchParams.delete("suporte");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  } catch {
    /* sem sessionStorage (janela privada restrita): segue sem modo suporte */
  }
  if (!empresaSuporte()) return;
  const original = window.fetch.bind(window);
  window.fetch = (entrada: RequestInfo | URL, init?: RequestInit) => {
    const emp = empresaSuporte();
    const alvo = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    const mesmoSite = alvo.startsWith("/api/") || alvo.startsWith(`${window.location.origin}/api/`);
    if (!emp || !mesmoSite) return original(entrada, init);
    const headers = new Headers(init?.headers ?? (entrada instanceof Request ? entrada.headers : undefined));
    headers.set("X-Sax-Empresa", emp);
    return original(entrada, { ...init, headers });
  };
}
