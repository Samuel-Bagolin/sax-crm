import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { CalendarDays, Camera, MoreHorizontal, Plus, Power, Trash2, Pencil } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, detalheErro } from "@/lib/api";
import { brlCompacto } from "@/lib/format";
import { CORES_EQUIPE, corDoMembro, useEquipe } from "@/lib/crm";
import { useAuth } from "@/lib/useAuth";
import type { Papel2, UsuarioPublico } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import PlanoUso from "@/components/shared/PlanoUso";
import Avatar from "@/components/shared/Avatar";
import FotoUploader from "@/components/shared/FotoUploader";
import { cn } from "@/lib/utils";
import { useSegmento } from "@/lib/segmento";

const PAPEL_LABEL: Record<Papel2, string> = { sysadmin: "Administrador de sistema", admin: "Gestor", corretor: "Corretor" };

interface Form {
  nome: string;
  email: string;
  senha: string;
  papel: Papel2;
  telefone: string;
  cargo: string;
  creci: string;
  cor: string;
  gerencia_site: boolean;
}

/** Registro profissional por segmento: CRECI, CRO, CRP/CRFa. Barbearia e loja não têm. */
function rotuloRegistro(seg: string): string | null {
  return seg === "imobiliaria" ? "CRECI" : seg === "odontologia" ? "CRO" : seg === "terapia" ? "CRP ou CRFa" : seg === "estetica" ? "Registro profissional" : null;
}
function cargoPadrao(seg: string, profissional: string): string {
  return seg === "imobiliaria" ? "Corretor de imóveis" : profissional;
}

function ConsultorDialog({ usuario, aberto, onClose, onFoto }: { usuario: UsuarioPublico | null; aberto: boolean; onClose: () => void; onFoto: (u: UsuarioPublico) => void }) {
  const qc = useQueryClient();
  const seg = useSegmento();
  const registro = rotuloRegistro(seg.chave);
  const { isSysadmin, principal } = useAuth();
  const [f, setF] = useState<Form>({ nome: "", email: "", senha: "", papel: "corretor", telefone: "", cargo: "", creci: "", cor: "", gerencia_site: false });
  useEffect(() => {
    if (!aberto) return;
    setF(
      usuario
        ? { nome: usuario.nome, email: usuario.email, senha: "", papel: usuario.papel, telefone: usuario.telefone ?? "", cargo: usuario.cargo ?? "", creci: usuario.creci ?? "", cor: usuario.cor ?? "", gerencia_site: !!usuario.gerencia_site }
        : { nome: "", email: "", senha: "", papel: "corretor", telefone: "", cargo: cargoPadrao(seg.chave, seg.termos.profissional), creci: "", cor: "", gerencia_site: false },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, usuario]);

  const salvar = useMutation({
    mutationFn: () => {
      const extra = { telefone: f.telefone.trim() || null, cargo: f.cargo.trim() || null, creci: f.creci.trim() || null, cor: f.cor || null, gerencia_site: f.papel === "corretor" ? f.gerencia_site : false };
      if (usuario) {
        return apiPatch<UsuarioPublico>(`/usuarios/${usuario.id}`, {
          nome: f.nome.trim(),
          papel: usuario.id === principal?.usuario_id ? undefined : f.papel,
          senha: f.senha || undefined,
          ...extra,
        });
      }
      return apiPost<UsuarioPublico>("/usuarios", { nome: f.nome.trim(), email: f.email.trim(), senha: f.senha, papel: f.papel, ...extra });
    },
    onSuccess: (u) => {
      qc.invalidateQueries({ queryKey: ["usuarios"] });
      qc.invalidateQueries({ queryKey: ["equipe"] });
      qc.invalidateQueries({ queryKey: ["pessoas"] });
      toast.success(usuario ? "Cadastro atualizado" : `Conta de ${u.nome} criada`, {
        action: usuario ? undefined : { label: "Adicionar foto", onClick: () => onFoto(u) },
      });
      onClose();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar"),
  });

  const valido = f.nome.trim().length >= 2 && (usuario || (f.email.includes("@") && f.senha.length >= 6)) && (!f.senha || f.senha.length >= 6);

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{usuario ? `Editar ${usuario.nome.split(" ")[0]}` : "Novo consultor"}</DialogTitle>
          <DialogDescription>{usuario ? "Dados de contato, perfil de acesso e cor na agenda." : `A pessoa entra com este e-mail e senha. ${seg.termos.profissional} vê apenas os próprios ${seg.vendas ? "negócios" : seg.termos.clientes.toLowerCase()}.`}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (valido) salvar.mutate();
          }}
        >
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="us-nome">Nome completo</Label>
            <Input id="us-nome" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} data-testid="usuario-nome" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="us-email">E-mail de acesso</Label>
            <Input id="us-email" type="email" value={f.email} disabled={!!usuario} onChange={(e) => setF({ ...f, email: e.target.value })} data-testid="usuario-email" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="us-senha">{usuario ? "Nova senha (opcional)" : "Senha inicial"}</Label>
            <Input id="us-senha" type="password" value={f.senha} onChange={(e) => setF({ ...f, senha: e.target.value })} placeholder="mínimo 6 caracteres" data-testid="usuario-senha" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="us-tel">WhatsApp</Label>
            <Input id="us-tel" value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} />
          </div>
          {registro && (
            <div className="space-y-1.5">
              <Label htmlFor="us-creci">{registro}</Label>
              <Input id="us-creci" value={f.creci} onChange={(e) => setF({ ...f, creci: e.target.value })} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="us-cargo">Cargo</Label>
            <Input id="us-cargo" value={f.cargo} onChange={(e) => setF({ ...f, cargo: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="us-papel">Perfil de acesso</Label>
            <select
              id="us-papel"
              value={f.papel}
              disabled={usuario?.id === principal?.usuario_id}
              onChange={(e) => setF({ ...f, papel: e.target.value as Papel2 })}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm dark:bg-input/30"
            >
              <option value="corretor">{seg.termos.profissional}</option>
              <option value="admin">Gestor</option>
              {isSysadmin && !principal?.empresa_id && <option value="sysadmin">Administrador de sistema</option>}
            </select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Cor na agenda da equipe</Label>
            <div className="flex flex-wrap gap-2">
              {CORES_EQUIPE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setF({ ...f, cor: c })}
                  className={cn("h-7 w-7 rounded-full transition-transform", f.cor === c && "scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-background")}
                  style={{ backgroundColor: c }}
                  aria-label={`Cor ${c}`}
                />
              ))}
              <button type="button" onClick={() => setF({ ...f, cor: "" })} className={cn("h-7 rounded-full border px-2 text-xs", !f.cor && "border-primary")}>
                Automática
              </button>
            </div>
          </div>
          {f.papel === "corretor" && seg.vendas && (
            <label className="flex items-start gap-2.5 rounded-lg border p-3 text-sm sm:col-span-2">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
                checked={f.gerencia_site}
                onChange={(e) => setF({ ...f, gerencia_site: e.target.checked })}
                data-testid="usuario-gerencia-site"
              />
              <span>
                <span className="font-medium">Pode editar o site da {seg.veiculos ? "loja" : "imobiliária"}</span>
                <span className="block text-xs text-muted-foreground">Muda marca e textos do site e decide quais {seg.termos.itens.toLowerCase()} aparecem, reservados ou fora do site.</span>
              </span>
            </label>
          )}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!valido || salvar.isPending} data-testid="usuario-salvar">
              {usuario ? "Salvar" : "Criar conta"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Usuarios() {
  const seg = useSegmento();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { principal } = useAuth();
  const { data: usuarios = [], isLoading } = useQuery({ queryKey: ["usuarios"], queryFn: () => apiGet<UsuarioPublico[]>("/usuarios") });
  const { data: equipe = [] } = useEquipe();
  const [editar, setEditar] = useState<{ u: UsuarioPublico | null } | null>(null);
  const [foto, setFoto] = useState<UsuarioPublico | null>(null);

  const invalidar = () => {
    qc.invalidateQueries({ queryKey: ["usuarios"] });
    qc.invalidateQueries({ queryKey: ["equipe"] });
    qc.invalidateQueries({ queryKey: ["auth", "me"] });
    qc.invalidateQueries({ queryKey: ["kanban"] });
  };

  const enviarFoto = useMutation({
    mutationFn: ({ u, dataUrl }: { u: UsuarioPublico; dataUrl: string }) => apiPut<UsuarioPublico>(`/usuarios/${u.id}/foto`, { base64: dataUrl, mime: "image/jpeg" }),
    onSuccess: () => {
      toast.success("Foto atualizada");
      setFoto(null);
      invalidar();
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível salvar a foto"),
  });
  const removerFoto = useMutation({
    mutationFn: (u: UsuarioPublico) => apiDelete(`/usuarios/${u.id}/foto`),
    onSuccess: () => invalidar(),
  });
  const alternarAtivo = useMutation({
    mutationFn: (u: UsuarioPublico) => apiPatch<UsuarioPublico>(`/usuarios/${u.id}`, { ativo: !u.ativo }),
    onSuccess: (u) => {
      invalidar();
      toast.success(u.ativo ? "Acesso reativado" : "Acesso desativado");
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível alterar"),
  });
  const excluir = useMutation({
    mutationFn: (id: string) => apiDelete(`/usuarios/${id}`),
    onSuccess: () => {
      invalidar();
      toast.success("Conta excluída");
    },
    onError: (e) => toast.error(detalheErro(e) ?? "Não foi possível excluir. Desative a conta para manter o histórico."),
  });

  const ativos = usuarios.filter((u) => u.ativo);
  const inativos = usuarios.filter((u) => !u.ativo);

  const Cartao = ({ u, i }: { u: UsuarioPublico; i: number }) => {
    const m = equipe.find((x) => x.usuario_id === u.id);
    const cor = corDoMembro({ cor: u.cor, pessoa_id: u.pessoa_id, usuario_id: u.id }, i);
    return (
      <article className={cn("flex flex-col rounded-lg border bg-card", !u.ativo && "opacity-60")} data-testid={`usuario-row-${u.id}`}>
        <div className="h-1.5 rounded-t-lg" style={{ backgroundColor: cor }} />
        <div className="flex items-start gap-3 p-4">
          <button type="button" onClick={() => setFoto(u)} className="group relative rounded-full" aria-label={`Alterar foto de ${u.nome}`}>
            <Avatar nome={u.nome} usuarioId={u.id} temFoto={u.tem_foto} versao={u.foto_v} cor={cor} tamanho="lg" />
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
              <Camera className="h-5 w-5" />
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-semibold">{u.nome}</h3>
            <p className="truncate text-xs text-muted-foreground">{u.cargo || PAPEL_LABEL[u.papel]}</p>
            <p className="mt-1 flex flex-wrap gap-1">
              <span className={cn("rounded-sm px-1.5 text-[11px] font-medium", u.papel === "corretor" ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}>{u.papel === "corretor" ? seg.termos.profissional : PAPEL_LABEL[u.papel]}</span>
              {u.creci && <span className="rounded-sm bg-muted px-1.5 text-[11px] text-muted-foreground">{rotuloRegistro(seg.chave) ?? "Registro"} {u.creci}</span>}
              {u.papel === "corretor" && u.gerencia_site && <span className="rounded-sm bg-primary/10 px-1.5 text-[11px] text-primary">Edita o site</span>}
              {!u.ativo && <span className="rounded-sm bg-atrasada/10 px-1.5 text-[11px] text-atrasada">Inativo</span>}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Mais ações" />}>
              <MoreHorizontal className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => setEditar({ u })}>
                <Pencil className="h-4 w-4" /> Editar
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setFoto(u)}>
                <Camera className="h-4 w-4" /> {u.tem_foto ? "Trocar foto" : "Adicionar foto"}
              </DropdownMenuItem>
              {u.tem_foto && (
                <DropdownMenuItem onClick={() => removerFoto.mutate(u)}>
                  <Trash2 className="h-4 w-4" /> Remover foto
                </DropdownMenuItem>
              )}
              {u.id !== principal?.usuario_id && (
                <>
                  <DropdownMenuItem onClick={() => alternarAtivo.mutate(u)}>
                    <Power className="h-4 w-4" /> {u.ativo ? "Desativar acesso" : "Reativar acesso"}
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onClick={() => excluir.mutate(u.id)}>
                    <Trash2 className="h-4 w-4" /> Excluir conta
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="space-y-0.5 px-4 text-xs text-muted-foreground">
          <p className="truncate">{u.email}</p>
          {u.telefone && <p>{u.telefone}</p>}
        </div>
        {m && u.pessoa_id ? (
          <dl className="mt-3 grid grid-cols-3 border-t text-center">
            <div className="px-2 py-2.5">
              <dt className="text-[11px] text-muted-foreground">Em andamento</dt>
              <dd className="num text-sm font-semibold">{m.negocios_abertos}</dd>
            </div>
            <div className="border-x px-2 py-2.5">
              <dt className="text-[11px] text-muted-foreground">Ganho no mês</dt>
              <dd className="num text-sm font-semibold">{brlCompacto(m.valor_ganho_mes)}</dd>
            </div>
            <div className="px-2 py-2.5">
              <dt className="text-[11px] text-muted-foreground">Atrasadas</dt>
              <dd className={cn("num text-sm font-semibold", m.atividades_atrasadas > 0 && "text-atrasada")}>{m.atividades_atrasadas}</dd>
            </div>
          </dl>
        ) : (
          <div className="mt-3 border-t" />
        )}
        <div className="mt-auto flex gap-2 p-3 pt-2">
          {u.pessoa_id && (
            <Button variant="outline" size="sm" className="flex-1" onClick={() => navigate(`/agenda?corretor=${u.pessoa_id}`)}>
              <CalendarDays className="h-3.5 w-3.5" /> Agenda
            </Button>
          )}
          <Button variant="ghost" size="sm" className="flex-1" onClick={() => setEditar({ u })}>
            <Pencil className="h-3.5 w-3.5" /> Editar
          </Button>
        </div>
      </article>
    );
  };

  return (
    <div className="space-y-5">
      <PlanoUso compacto />
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">
          {ativos.length} {ativos.length === 1 ? "pessoa ativa" : "pessoas ativas"}. Clique na foto para trocar.
        </p>
        <Button className="ml-auto" onClick={() => setEditar({ u: null })} data-testid="btn-new-usuario">
          <Plus className="h-4 w-4" /> {seg.termos.profissional}
        </Button>
      </div>
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-56 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="usuarios-tabela">
          {ativos.map((u, i) => (
            <Cartao key={u.id} u={u} i={i} />
          ))}
        </div>
      )}
      {inativos.length > 0 && (
        <>
          <h2 className="pt-2 text-sm font-semibold text-muted-foreground">Acessos desativados</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {inativos.map((u, i) => (
              <Cartao key={u.id} u={u} i={i} />
            ))}
          </div>
        </>
      )}

      <ConsultorDialog aberto={!!editar} usuario={editar?.u ?? null} onClose={() => setEditar(null)} onFoto={(u) => setFoto(u)} />
      <FotoUploader
        open={!!foto}
        onClose={() => setFoto(null)}
        salvando={enviarFoto.isPending}
        onConfirmar={(dataUrl) => foto && enviarFoto.mutate({ u: foto, dataUrl })}
      />
    </div>
  );
}
