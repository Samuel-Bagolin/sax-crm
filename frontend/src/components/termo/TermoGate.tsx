import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSignature, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost, detalheErro } from "@/lib/api";
import { useAuth } from "@/lib/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TextoTermo } from "./TextoTermo";

interface Situacao {
  exigir: boolean;
  versao?: string;
  texto?: string;
  hash_versao?: string;
  empresa_nome?: string;
  documento?: string | null;
  sugestao_nome?: string;
  email?: string;
}

function mascaraCpf(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

/** Primeiro acesso do gestor: o sistema só abre depois do aceite do termo de adesão. */
export function TermoGate({ children }: { children: ReactNode }) {
  const { principal } = useAuth();
  const ativo = !!principal?.empresa_id && principal?.papel === "admin" && !principal?.suporte;
  const q = useQuery({ queryKey: ["termo"], queryFn: () => apiGet<Situacao>("/termo"), enabled: ativo, staleTime: 5 * 60_000 });
  if (!ativo || !q.data?.exigir) return <>{children}</>;
  return <TelaTermo s={q.data} />;
}

function TelaTermo({ s }: { s: Situacao }) {
  const qc = useQueryClient();
  const inicio = useRef(Date.now());
  const caixa = useRef<HTMLDivElement>(null);
  const [leuAteOFim, setLeuAteOFim] = useState(false);
  const [f, setF] = useState({ nome: s.sugestao_nome ?? "", cpf: "", cargo: "", documento: "" });
  const [ok, setOk] = useState({ li: false, b2b: false, reembolso: false });

  useEffect(() => {
    const el = caixa.current;
    if (el && el.scrollHeight <= el.clientHeight + 8) setLeuAteOFim(true);
  }, []);

  const aceitar = useMutation({
    mutationFn: () => apiPost("/termo/aceitar", {
      hash_versao: s.hash_versao!, nome: f.nome, cpf: f.cpf, cargo: f.cargo, documento: s.documento ? null : f.documento,
      li_e_aceito: ok.li, uso_empresarial: ok.b2b, ciente_sem_reembolso: ok.reembolso,
      tempo_leitura_s: Math.round((Date.now() - inicio.current) / 1000),
    }),
    onSuccess: () => { toast.success("Termo aceito. Enviamos uma cópia para o seu e-mail."); qc.invalidateQueries({ queryKey: ["termo"] }); },
    onError: (e) => { toast.error(detalheErro(e) ?? "Não foi possível registrar o aceite."); qc.invalidateQueries({ queryKey: ["termo"] }); },
  });

  const pronto = leuAteOFim && ok.li && ok.b2b && ok.reembolso && f.nome.trim().split(/\s+/).length >= 2
    && f.cpf.replace(/\D/g, "").length === 11 && f.cargo.trim().length >= 2 && (!!s.documento || f.documento.replace(/\D/g, "").length >= 11);

  return (
    <div className="mx-auto grid max-w-3xl gap-4" data-testid="termo-gate">
      <div className="flex items-start gap-3">
        <FileSignature className="mt-1 h-6 w-6 shrink-0 text-primary" />
        <div>
          <h1 className="text-xl font-bold">Antes de começar, leia e aceite o termo de adesão</h1>
          <p className="text-sm text-muted-foreground">
            Este é o contrato de uso do SAX CRM entre a SAX e {s.empresa_nome}. O sistema abre logo depois do aceite.
          </p>
        </div>
      </div>

      <div ref={caixa} onScroll={(e) => { const el = e.currentTarget; if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setLeuAteOFim(true); }}
        className="max-h-[52vh] overflow-y-auto rounded-xl border bg-card p-4 sm:p-5" tabIndex={0} aria-label="Texto do termo de adesão">
        <TextoTermo texto={s.texto ?? ""} />
      </div>
      {!leuAteOFim && <p className="text-center text-xs text-muted-foreground">Role o texto até o fim para liberar o aceite.</p>}

      <fieldset disabled={!leuAteOFim} className="grid gap-4 rounded-xl border bg-card p-4 disabled:opacity-60 sm:p-5">
        <legend className="px-1 text-sm font-semibold">Quem está aceitando</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="tm-nome">Nome completo</Label>
            <Input id="tm-nome" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} autoComplete="name" data-testid="termo-nome" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="tm-cpf">CPF</Label>
            <Input id="tm-cpf" value={f.cpf} onChange={(e) => setF({ ...f, cpf: mascaraCpf(e.target.value) })} inputMode="numeric" data-testid="termo-cpf" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="tm-cargo">Cargo</Label>
            <Input id="tm-cargo" value={f.cargo} onChange={(e) => setF({ ...f, cargo: e.target.value })} placeholder="Sócio, diretor..." data-testid="termo-cargo" />
          </div>
          {!s.documento && (
            <div className="grid gap-1.5 sm:col-span-2">
              <Label htmlFor="tm-doc">CNPJ da empresa</Label>
              <Input id="tm-doc" value={f.documento} onChange={(e) => setF({ ...f, documento: e.target.value })} inputMode="numeric" placeholder="Ou CPF, se contratou como profissional" data-testid="termo-documento" />
            </div>
          )}
        </div>
        <div className="grid gap-2.5 text-sm">
          <label className="flex items-start gap-2.5"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#4a03a2]" checked={ok.b2b} onChange={(e) => setOk({ ...ok, b2b: e.target.checked })} data-testid="termo-b2b" />
            <span>Contrato o SAX CRM para uso na atividade da empresa (relação entre empresas) e tenho poderes para representá-la.</span></label>
          <label className="flex items-start gap-2.5"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#4a03a2]" checked={ok.reembolso} onChange={(e) => setOk({ ...ok, reembolso: e.target.checked })} data-testid="termo-reembolso" />
            <span>Estou ciente de que posso cancelar a qualquer momento sem multa e de que <b>mensalidades, anuidades e a implantação já pagas não são devolvidas</b> (cláusula 5).</span></label>
          <label className="flex items-start gap-2.5"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#4a03a2]" checked={ok.li} onChange={(e) => setOk({ ...ok, li: e.target.checked })} data-testid="termo-li" />
            <span>Li e aceito integralmente o Termo de Adesão e Condições de Uso do SAX CRM, versão {s.versao}.</span></label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" /> Registramos data, hora, IP e navegador como prova do aceite. A cópia vai para {s.email}.</p>
          <Button onClick={() => aceitar.mutate()} disabled={!pronto || aceitar.isPending} data-testid="termo-aceitar">
            {aceitar.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Aceitar e entrar
          </Button>
        </div>
      </fieldset>
    </div>
  );
}
