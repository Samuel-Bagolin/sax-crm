import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Loader2, Pencil, Plus, ShieldAlert, Smartphone, Trash2, Users } from "lucide-react";
import { apiDelete, apiGet, apiPost, apiPut, detalheErro } from "@/lib/api";
import { useEquipe } from "@/lib/crm";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/useAuth";

export interface Conexao {
  id: string; nome: string; status: "conectado" | "conectando" | "desconectado" | "aguardando_qr"; numero: string | null; perfil: string | null;
  criado_em: string | null; setor_id: string | null; responsaveis: string[];
  no_site?: boolean; nome_site?: string | null; ordem_site?: number;
  pessoal?: boolean; dono_usuario_id?: string | null; dono_nome?: string | null;
}
export interface Setor { id: string; nome: string; membros: string[] }

type Pessoa = { id: string; nome: string };

/** Equipe ativa com cadastro de pessoa (é o id que vai em responsáveis e membros). */
export function usePessoasEquipe(): Pessoa[] {
  const { data = [] } = useEquipe();
  return data.filter((m) => m.pessoa_id && m.ativo !== false).map((m) => ({ id: m.pessoa_id!, nome: m.nome })).sort((a, b) => a.nome.localeCompare(b.nome));
}

function nomes(ids: string[], pessoas: Pessoa[]) {
  const mapa = Object.fromEntries(pessoas.map((p) => [p.id, p.nome]));
  return ids.map((i) => mapa[i]).filter(Boolean).join(", ");
}

const STATUS: Record<Conexao["status"], { rotulo: string; cor: string }> = {
  conectado: { rotulo: "Conectado", cor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  conectando: { rotulo: "Conectando", cor: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  aguardando_qr: { rotulo: "Falta ler o QR code", cor: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  desconectado: { rotulo: "Desconectado", cor: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
};

function numeroBonito(n: string | null) {
  if (!n) return "";
  const d = n.replace(/\D/g, "");
  return d.length >= 12 ? `+${d.slice(0, 2)} (${d.slice(2, 4)}) ${d.slice(4, d.length - 4)}-${d.slice(-4)}` : `+${d}`;
}

/** Números de WhatsApp conectados ao CRM. Só o gestor conecta e desconecta. */
export function NumerosWhatsApp({ conexoes, setores, podeGerir }: { conexoes: Conexao[]; setores: Setor[]; podeGerir: boolean }) {
  const qc = useQueryClient();
  const pessoas = usePessoasEquipe();
  const { principal } = useAuth();
  const meu = (c: Conexao) => podeGerir || (!!c.dono_usuario_id && c.dono_usuario_id === principal?.usuario_id);
  const [novo, setNovo] = useState(false);
  const [qr, setQr] = useState<Conexao | null>(null);
  const [editar, setEditar] = useState<Conexao | null>(null);
  const nomeSetor = Object.fromEntries(setores.map((x) => [x.id, x.nome]));
  const remover = useMutation({
    mutationFn: (id: string) => apiDelete(`/whatsapp/conexoes/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["wa"] }); toast.success("Número desconectado do CRM."); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível desconectar."),
  });

  return (
    <div className="grid content-start gap-4 overflow-y-auto">
      <section className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Números de WhatsApp</h2>
          <p className="text-sm text-muted-foreground">
            {podeGerir ? "Conecte o WhatsApp da empresa lendo o QR code no celular, como no WhatsApp Web. Número ligado por alguém da equipe é só dessa pessoa; você, como gestor, vê todos."
              : "Conecte o seu WhatsApp lendo o QR code no celular. As conversas desse número são só suas (o gestor também vê)."}
          </p>
        </div>
        <Button onClick={() => setNovo(true)} data-testid="wa-conectar"><Plus className="h-4 w-4" /> {podeGerir ? "Conectar número" : "Conectar meu WhatsApp"}</Button>
      </section>

      <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
        A conexão por QR code não é a API oficial do WhatsApp. Use para atender clientes um a um. Mandar mensagem em massa para quem não te procurou pode fazer o WhatsApp bloquear o número.
      </p>

      {conexoes.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">Nenhum número conectado ainda.</div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card" data-testid="wa-numeros">
          {conexoes.map((c) => (
            <li key={c.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"><Smartphone className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.nome}{c.perfil ? <span className="text-muted-foreground"> · {c.perfil}</span> : null}</p>
                  <p className="text-xs text-muted-foreground">{c.numero ? numeroBonito(c.numero) : "Número aparece depois de ler o QR code"}</p>
                  <p className="mt-0.5 text-xs" data-testid="wa-numero-acesso">
                    {c.setor_id && nomeSetor[c.setor_id] && <span className="mr-1.5 rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">{nomeSetor[c.setor_id]}</span>}
                    {c.responsaveis.length > 0 && <span className="text-muted-foreground">Responsáveis: {nomes(c.responsaveis, pessoas)}</span>}
                    {c.pessoal ? <span className="text-muted-foreground">Celular de {c.dono_nome ?? "um usuário"}: só essa pessoa e o gestor veem</span>
                      : !c.setor_id && c.responsaveis.length === 0 && <span className="text-muted-foreground">Aberto para toda a equipe</span>}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-[52px] sm:pl-0">
                <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", STATUS[c.status]?.cor)} data-testid="wa-status">{STATUS[c.status]?.rotulo ?? c.status}</span>
                {podeGerir && !c.pessoal && <Button size="sm" variant="outline" onClick={() => setEditar(c)} data-testid="wa-editar-numero"><Pencil className="h-4 w-4" /> Setor e responsáveis</Button>}
                {meu(c) && c.status !== "conectado" && <Button size="sm" variant="outline" onClick={() => setQr(c)}>Ler QR code</Button>}
                {meu(c) && (
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => window.confirm(`Desconectar o número ${c.nome} do CRM? As conversas ficam guardadas.`) && remover.mutate(c.id)}>
                    <Trash2 className="h-4 w-4" /> Desconectar
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Setores setores={setores} pessoas={pessoas} podeGerir={podeGerir} conexoes={conexoes} />

      {novo && <NovoNumero onClose={() => setNovo(false)} onCriado={(c) => { setNovo(false); setQr(c); }} />}
      {qr && <LerQr conexao={qr} onClose={() => setQr(null)} />}
      {editar && <EditarNumero conexao={editar} setores={setores} pessoas={pessoas} onClose={() => setEditar(null)} />}
    </div>
  );
}

function Marcar({ pessoas, valor, onChange, testid }: { pessoas: Pessoa[]; valor: string[]; onChange: (v: string[]) => void; testid: string }) {
  if (!pessoas.length) return <p className="text-sm text-muted-foreground">Cadastre a equipe em Usuários para escolher aqui.</p>;
  return (
    <div className="grid max-h-56 gap-1 overflow-y-auto rounded-lg border p-2" data-testid={testid}>
      {pessoas.map((p) => (
        <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted">
          <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={valor.includes(p.id)}
            onChange={(e) => onChange(e.target.checked ? [...valor, p.id] : valor.filter((x) => x !== p.id))} />
          {p.nome}
        </label>
      ))}
    </div>
  );
}

function EditarNumero({ conexao, setores, pessoas, onClose }: { conexao: Conexao; setores: Setor[]; pessoas: Pessoa[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [nome, setNome] = useState(conexao.nome);
  const [setor, setSetor] = useState(conexao.setor_id ?? "");
  const [resp, setResp] = useState<string[]>(conexao.responsaveis);
  const [noSite, setNoSite] = useState(conexao.no_site ?? true);
  const [nomeSite, setNomeSite] = useState(conexao.nome_site ?? "");
  const salvar = useMutation({
    mutationFn: () => apiPut<Conexao>(`/whatsapp/conexoes/${conexao.id}`, {
      nome: nome.trim(), setor_id: setor || null, responsaveis: resp, no_site: noSite, nome_site: nomeSite.trim() || null, ordem_site: conexao.ordem_site ?? 50,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["wa"] }); toast.success("Número atualizado."); onClose(); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar."),
  });
  const membrosSetor = setores.find((x) => x.id === setor)?.membros ?? [];
  const quem = [...new Set([...resp, ...membrosSetor])];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quem atende este número</DialogTitle>
          <DialogDescription>Com setor ou responsáveis, só essas pessoas veem as conversas deste número. O gestor vê tudo.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); salvar.mutate(); }}>
          <div className="grid gap-1.5"><Label htmlFor="wa-num-nome">Nome do número</Label>
            <Input id="wa-num-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={40} /></div>
          <div className="grid gap-1.5"><Label htmlFor="wa-num-setor">Setor</Label>
            <select id="wa-num-setor" value={setor} onChange={(e) => setSetor(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm" data-testid="wa-num-setor">
              <option value="">Sem setor</option>
              {setores.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select>
            {!setores.length && <p className="text-xs text-muted-foreground">Crie setores logo abaixo da lista de números.</p>}
          </div>
          <div className="grid gap-1.5"><Label>Responsáveis</Label><Marcar pessoas={pessoas} valor={resp} onChange={setResp} testid="wa-num-responsaveis" /></div>
          <div className="grid gap-2 rounded-lg border p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={noSite} onChange={(e) => setNoSite(e.target.checked)} data-testid="wa-num-no-site" />
              Mostrar no balão de WhatsApp do site
            </label>
            {noSite && (
              <div className="grid gap-1.5">
                <Label htmlFor="wa-num-nome-site" className="text-xs">Nome que o cliente vê no site</Label>
                <Input id="wa-num-nome-site" value={nomeSite} onChange={(e) => setNomeSite(e.target.value)} maxLength={50} placeholder={`Ex.: Curitiba - Batel (vazio usa "${nome || "o nome do número"}")`} />
                <p className="text-xs text-muted-foreground">Com mais de um número no site, o cliente escolhe a loja e a conversa cai direto no número dela.</p>
              </div>
            )}
          </div>
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            {quem.length === 0 ? "Sem setor e sem responsáveis: toda a equipe vê as conversas sem dono deste número."
              : quem.length === 1 ? "Só uma pessoa atende: as conversas novas já chegam com ela."
              : `${quem.length} pessoas atendem. Conversa nova fica sem dono até alguém responder.`}
          </p>
          <Button type="submit" disabled={nome.trim().length < 2 || salvar.isPending} data-testid="wa-num-salvar">{salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Setores({ setores, pessoas, podeGerir, conexoes }: { setores: Setor[]; pessoas: Pessoa[]; podeGerir: boolean; conexoes: Conexao[] }) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState<Setor | "novo" | null>(null);
  const remover = useMutation({
    mutationFn: (id: string) => apiDelete(`/whatsapp/setores/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["wa"] }); toast.success("Setor removido."); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível remover."),
  });
  if (!podeGerir && !setores.length) return null;
  return (
    <section className="grid gap-3 rounded-xl border bg-card p-4" data-testid="wa-setores">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-semibold"><Users className="h-4 w-4" /> Setores</h2>
          <p className="text-sm text-muted-foreground">Agrupe a equipe por departamento, como Comercial, Financeiro ou Operações, e ligue cada número a um setor.</p>
        </div>
        {podeGerir && <Button variant="outline" onClick={() => setAberto("novo")} data-testid="wa-novo-setor"><Plus className="h-4 w-4" /> Novo setor</Button>}
      </div>
      {setores.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">Nenhum setor criado.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {setores.map((x) => {
            const nums = conexoes.filter((c) => c.setor_id === x.id).map((c) => c.nome);
            return (
              <li key={x.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center" data-testid="wa-setor">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{x.nome}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {x.membros.length ? nomes(x.membros, pessoas) : "Sem pessoas"}{nums.length ? ` · Números: ${nums.join(", ")}` : ""}
                  </p>
                </div>
                {podeGerir && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setAberto(x)} aria-label={`Editar ${x.nome}`}><Pencil className="h-4 w-4" /> Editar</Button>
                    <Button size="sm" variant="ghost" className="text-destructive" aria-label={`Remover ${x.nome}`}
                      onClick={() => window.confirm(`Remover o setor ${x.nome}? Os números dele ficam só com os responsáveis.`) && remover.mutate(x.id)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {aberto && <SetorDialog setor={aberto === "novo" ? null : aberto} pessoas={pessoas} onClose={() => setAberto(null)} />}
    </section>
  );
}

function SetorDialog({ setor, pessoas, onClose }: { setor: Setor | null; pessoas: Pessoa[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [nome, setNome] = useState(setor?.nome ?? "");
  const [membros, setMembros] = useState<string[]>(setor?.membros ?? []);
  const salvar = useMutation({
    mutationFn: () => (setor ? apiPut(`/whatsapp/setores/${setor.id}`, { nome: nome.trim(), membros }) : apiPost("/whatsapp/setores", { nome: nome.trim(), membros })),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["wa"] }); toast.success(setor ? "Setor atualizado." : "Setor criado."); onClose(); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar o setor."),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{setor ? "Editar setor" : "Novo setor"}</DialogTitle>
          <DialogDescription>Quem está no setor vê as conversas dos números ligados a ele.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); salvar.mutate(); }}>
          <div className="grid gap-1.5"><Label htmlFor="wa-setor-nome">Nome do setor</Label>
            <Input id="wa-setor-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={40} placeholder="Comercial" autoFocus data-testid="wa-setor-nome" /></div>
          <div className="grid gap-1.5"><Label>Pessoas do setor</Label><Marcar pessoas={pessoas} valor={membros} onChange={setMembros} testid="wa-setor-membros" /></div>
          <Button type="submit" disabled={nome.trim().length < 2 || salvar.isPending} data-testid="wa-setor-salvar">{salvar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar setor</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NovoNumero({ onClose, onCriado }: { onClose: () => void; onCriado: (c: Conexao) => void }) {
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const criar = useMutation({
    mutationFn: () => apiPost<Conexao & { qr: string | null }>("/whatsapp/conexoes", { nome: nome.trim() }),
    onSuccess: (c) => { qc.invalidateQueries({ queryKey: ["wa"] }); onCriado(c); },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível criar a conexão."),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Conectar número</DialogTitle>
          <DialogDescription>Dê um nome para reconhecer o número na equipe, como Comercial ou Recepção.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); criar.mutate(); }}>
          <div className="grid gap-1.5"><Label htmlFor="wa-nome">Nome do número</Label>
            <Input id="wa-nome" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={40} placeholder="Comercial" autoFocus data-testid="wa-nome" /></div>
          <Button type="submit" disabled={nome.trim().length < 2 || criar.isPending} data-testid="wa-gerar-qr">{criar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Gerar QR code</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LerQr({ conexao, onClose }: { conexao: Conexao; onClose: () => void }) {
  const qc = useQueryClient();
  // O QR do WhatsApp troca a cada ~20 s: busca de novo a cada 5 s até conectar.
  const q = useQuery({
    queryKey: ["wa", "qr", conexao.id],
    queryFn: () => apiGet<{ conectado: boolean; qr: string | null; codigo: string | null }>(`/whatsapp/conexoes/${conexao.id}/qr`),
    refetchInterval: (query) => (query.state.data?.conectado ? false : 5000),
    retry: 1,
  });
  const conectado = !!q.data?.conectado;
  useEffect(() => {
    if (conectado) {
      qc.invalidateQueries({ queryKey: ["wa", "situacao"] });
      toast.success("WhatsApp conectado. As conversas começam a chegar.");
    }
  }, [conectado, qc]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ler QR code: {conexao.nome}</DialogTitle>
          <DialogDescription>No celular, abra o WhatsApp, toque em Mais opções (ou Configurações), Aparelhos conectados, Conectar um aparelho, e aponte para o código.</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-[288px] items-center justify-center rounded-xl border bg-white p-4" data-testid="wa-qr">
          {conectado ? (
            <div className="grid justify-items-center gap-2 text-center text-emerald-700"><CheckCircle2 className="h-12 w-12" /><p className="font-semibold">Conectado</p></div>
          ) : q.isError ? (
            <p className="text-center text-sm text-destructive">{detalheErro(q.error) ?? "Não foi possível gerar o QR code."}</p>
          ) : q.data?.qr ? (
            <img src={q.data.qr} alt="QR code para conectar o WhatsApp" className="h-64 w-64" style={{ imageRendering: "pixelated" }} />
          ) : (
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          )}
        </div>
        {!conectado && <p className="text-center text-xs text-muted-foreground">O código se renova sozinho. Esta janela fecha quando conectar.</p>}
        {conectado && <Button onClick={onClose}>Ir para as conversas</Button>}
      </DialogContent>
    </Dialog>
  );
}
