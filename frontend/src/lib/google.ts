import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";

export interface StatusGoogle {
  configurado: boolean;
  conectado: boolean;
  email: string | null;
  sync_agenda: boolean;
  mostrar_agenda: boolean;
  erro: string | null;
  picker_disponivel: boolean;
  no_plano: boolean;
}

export interface EventoGoogle {
  id: string;
  titulo: string;
  inicio: string;
  fim: string;
  dia_todo: boolean;
  link?: string | null;
  corretor_id: string | null;
  privado: boolean;
}

export interface Documento {
  id: string;
  negocio_id: string | null;
  contrato_id: string | null;
  nome: string;
  mime: string;
  tamanho: number | null;
  armazenamento: "drive" | "crm";
  drive_file_id: string | null;
  drive_link: string | null;
  drive_dono: string | null;
  criado_por: string | null;
  criado_por_nome: string | null;
  compartilhado_com: string[];
  created_at: string;
}

export function useGoogle() {
  return useQuery({ queryKey: ["google", "status"], queryFn: () => apiGet<StatusGoogle>("/google/status"), staleTime: 60_000 });
}

/** Envio multipart (o apiPost só fala JSON). */
export async function enviarArquivo<T>(caminho: string, campos: Record<string, string | Blob | null | undefined>): Promise<T> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) if (v != null) fd.append(k, v);
  const r = await fetch(`/api${caminho}`, { method: "POST", body: fd });
  const corpo = await r.json().catch(() => null);
  if (!r.ok) throw new Error((corpo && typeof corpo.detail === "string" && corpo.detail) || "Falha no envio do arquivo");
  return corpo as T;
}

export function tamanhoLegivel(b: number | null | undefined): string {
  if (!b) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

// ---------------------------------------------------------------- seletor do Google Drive

interface JanelaGoogle {
  gapi?: { load: (lib: string, cb: () => void) => void };
  google?: {
    picker: {
      PickerBuilder: new () => {
        addView: (v: unknown) => unknown;
        setOAuthToken: (t: string) => unknown;
        setDeveloperKey: (k: string) => unknown;
        setAppId: (a: string) => unknown;
        setLocale: (l: string) => unknown;
        setCallback: (cb: (d: { action: string; docs?: { id: string; name: string }[] }) => void) => unknown;
        enableFeature: (f: unknown) => unknown;
        build: () => { setVisible: (v: boolean) => void };
      };
      DocsView: new () => { setIncludeFolders: (v: boolean) => unknown };
      Action: { PICKED: string; CANCEL: string };
      Feature: { MULTISELECT_ENABLED: unknown };
    };
  };
}

let carregando: Promise<void> | null = null;
function carregarPicker(): Promise<void> {
  const w = window as unknown as JanelaGoogle;
  if (w.google?.picker) return Promise.resolve();
  carregando ??= new Promise((ok, falha) => {
    const s = document.createElement("script");
    s.src = "https://apis.google.com/js/api.js";
    s.onload = () => w.gapi!.load("picker", () => ok());
    s.onerror = () => falha(new Error("Não foi possível carregar o Google Drive. Verifique sua conexão."));
    document.head.appendChild(s);
  });
  return carregando;
}

/** Abre o seletor oficial do Google Drive e devolve os arquivos escolhidos. */
export async function escolherNoDrive(): Promise<{ id: string; name: string }[]> {
  const cred = await apiGet<{ access_token: string; api_key: string | null; app_id: string | null }>("/google/picker-token");
  if (!cred.api_key || !cred.app_id) throw new Error("Seletor do Drive não configurado (GOOGLE_API_KEY e GOOGLE_APP_ID).");
  await carregarPicker();
  const g = (window as unknown as JanelaGoogle).google!.picker;
  return new Promise((resolve) => {
    const view = new g.DocsView();
    view.setIncludeFolders(true);
    const b = new g.PickerBuilder();
    b.addView(view);
    b.setOAuthToken(cred.access_token);
    b.setDeveloperKey(cred.api_key!);
    b.setAppId(cred.app_id!);
    b.setLocale("pt-BR");
    b.enableFeature(g.Feature.MULTISELECT_ENABLED);
    b.setCallback((d) => {
      if (d.action === g.Action.PICKED) resolve(d.docs ?? []);
      else if (d.action === g.Action.CANCEL) resolve([]);
    });
    b.build().setVisible(true);
  });
}
