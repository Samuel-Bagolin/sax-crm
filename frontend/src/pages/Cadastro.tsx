import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  Car,
  Check,
  CreditCard,
  HeartPulse,
  Loader2,
  Lock,
  Scissors,
  Smile,
  Sparkles,
} from "lucide-react";
import { apiGet, apiPost, detalheErro } from "@/lib/api";
import { brl } from "@/lib/format";
import type { SegmentoChave, SegmentoInfo } from "@/lib/types";
import MarcaSax from "@/components/shared/MarcaSax";
import { cn } from "@/lib/utils";

interface PlanoOpcao {
  chave: string;
  nome: string;
  resumo: string;
  preco_mensal: number;
  preco_anual: number;
  usuarios: number | null;
  imoveis: number | null;
  unidades: number | null;
  recursos: string[];
}
interface Opcoes {
  categorias: Record<string, string>;
  segmentos: SegmentoInfo[];
  planos: Record<string, PlanoOpcao[]>;
  pagamento_online: boolean;
}

const ICONES: Record<SegmentoChave, typeof Building2> = {
  imobiliaria: Building2,
  veiculos: Car,
  odontologia: Smile,
  terapia: HeartPulse,
  barbearia: Scissors,
  estetica: Sparkles,
};

const PASSOS = ["Segmento", "Plano", "Sua empresa", "Pagamento"];

function digitos(v: string) {
  return v.replace(/\D/g, "");
}
function mascaraCartao(v: string) {
  return digitos(v).slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 ");
}
function mascaraValidade(v: string) {
  const d = digitos(v).slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}
function mascaraDoc(v: string) {
  const d = digitos(v).slice(0, 14);
  if (d.length <= 11) return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  return d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
}
function mascaraTelefone(v: string) {
  const d = digitos(v).slice(0, 11);
  if (d.length <= 10) return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
}
function bandeira(n: string): string | null {
  const d = digitos(n);
  if (/^4/.test(d)) return "Visa";
  if (/^(5[1-5]|2[2-7])/.test(d)) return "Mastercard";
  if (/^3[47]/.test(d)) return "Amex";
  if (/^(4011|4312|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)/.test(d)) return "Elo";
  if (/^(606282|3841)/.test(d)) return "Hipercard";
  return null;
}
function luhn(n: string) {
  const d = digitos(n);
  if (d.length < 13) return false;
  let soma = 0;
  [...d].reverse().forEach((c, i) => {
    let x = Number(c);
    if (i % 2) {
      x *= 2;
      if (x > 9) x -= 9;
    }
    soma += x;
  });
  return soma % 10 === 0;
}
function limite(v: number | null, sing: string, plur: string) {
  return v == null ? `${plur} sem limite` : `${v} ${v === 1 ? sing : plur}`;
}

export default function Cadastro() {
  const opcoes = useQuery({ queryKey: ["cadastro-opcoes"], queryFn: () => apiGet<Opcoes>("/publico/cadastro/opcoes") });
  const [passo, setPasso] = useState(0);
  const [segmento, setSegmento] = useState<SegmentoChave | null>(null);
  const [plano, setPlano] = useState<string | null>(null);
  const [anual, setAnual] = useState(false);
  const [f, setF] = useState({ empresa_nome: "", documento: "", nome: "", email: "", telefone: "", senha: "", cep: "", numero_endereco: "" });
  const [c, setC] = useState({ numero: "", nome: "", validade: "", cvv: "" });
  const [aceite, setAceite] = useState(false);
  const [chave, setChave] = useState(() => crypto.randomUUID().replace(/-/g, ""));
  const [isca, setIsca] = useState("");
  const [tentou, setTentou] = useState(false);

  useEffect(() => {
    document.title = "Criar conta | SAX CRM";
  }, []);

  const seg = opcoes.data?.segmentos.find((s) => s.chave === segmento);
  const planos = segmento ? opcoes.data?.planos[segmento] ?? [] : [];
  const escolhido = planos.find((p) => p.chave === plano);
  const valor = escolhido ? (anual ? escolhido.preco_anual : escolhido.preco_mensal) : 0;

  const assinar = useMutation({
    mutationFn: () =>
      apiPost<{ ok: boolean; demo: boolean }>("/publico/cadastro", {
        chave, segmento, plano, periodicidade: anual ? "anual" : "mensal", ...f, aceite, site: isca || null,
        cartao: { numero: digitos(c.numero), nome: c.nome, validade: c.validade, cvv: c.cvv },
      }),
    onSuccess: () => {
      window.location.href = "/";
    },
    onError: () => setChave(crypto.randomUUID().replace(/-/g, "")),
  });

  const erroDados = useMemo(() => {
    if (f.empresa_nome.trim().length < 2) return "Informe o nome da empresa.";
    const d = digitos(f.documento);
    if (d.length !== 11 && d.length !== 14) return "Informe um CPF ou CNPJ.";
    if (f.nome.trim().split(" ").length < 2) return "Informe seu nome completo.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) return "Informe um e-mail válido.";
    if (digitos(f.telefone).length < 10) return "Informe o celular com DDD.";
    if (f.senha.length < 10) return "A senha precisa de pelo menos 10 caracteres.";
    return null;
  }, [f]);
  const erroCartao = useMemo(() => {
    if (!luhn(c.numero)) return "Número do cartão inválido.";
    if (c.nome.trim().length < 3) return "Informe o nome impresso no cartão.";
    if (!/^\d{2}\/\d{2}$/.test(c.validade)) return "Validade no formato MM/AA.";
    if (c.cvv.length < 3) return "Informe o CVV.";
    if (digitos(f.cep).length !== 8) return "Informe o CEP do titular.";
    if (!f.numero_endereco.trim()) return "Informe o número do endereço.";
    if (!aceite) return "Aceite os termos para continuar.";
    return null;
  }, [c, f.cep, f.numero_endereco, aceite]);

  const categorias = opcoes.data ? Object.entries(opcoes.data.categorias) : [];

  return (
    <div className="min-h-dvh bg-[#f6f4fb] text-[#1d1530] lg:grid lg:grid-cols-[380px_1fr]">
      {/* Coluna da marca: o que a pessoa ganha e em que passo está */}
      <aside className="relative overflow-hidden bg-[#140634] px-6 py-6 text-white lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:px-9 lg:py-10">
        <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-[#6d28d9]/40 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 right-[-60px] h-64 w-64 rounded-full bg-[#ff7a00]/25 blur-3xl" />
        <div className="relative flex items-center justify-between lg:block">
          <Link to="/login" aria-label="Voltar para o login">
            <MarcaSax className="w-24 text-white lg:w-28" />
          </Link>
          <span className="text-sm text-white/70 lg:hidden">Passo {passo + 1} de 4</span>
        </div>
        <div className="relative mt-10 hidden lg:block">
          <h1 className="text-[28px] font-bold leading-tight">O CRM feito para o seu tipo de negócio.</h1>
          <p className="mt-3 text-[15px] leading-relaxed text-white/75">
            Menu, funil e agenda já chegam prontos para a sua rotina. Você entra usando no mesmo dia.
          </p>
        </div>
        <ol className="relative mt-10 hidden flex-col gap-1 lg:flex" aria-label="Etapas do cadastro">
          {PASSOS.map((p, i) => (
            <li key={p} className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm", i === passo ? "bg-white/10 font-semibold" : "text-white/60")}>
              <span className={cn("flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold", i < passo ? "bg-[#ff7a00] text-white" : i === passo ? "bg-white text-[#140634]" : "border border-white/30")}>
                {i < passo ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              {p}
              {i === 0 && seg && i < passo && <span className="ml-auto truncate text-xs font-normal text-white/60">{seg.nome}</span>}
              {i === 1 && escolhido && i < passo && <span className="ml-auto truncate text-xs font-normal text-white/60">{escolhido.nome}</span>}
            </li>
          ))}
        </ol>
        <p className="relative mt-auto hidden items-center gap-2 pt-10 text-xs text-white/55 lg:flex">
          <Lock className="h-3.5 w-3.5" /> Pagamento processado pelo Asaas. O número do cartão não fica guardado no SAX.
        </p>
      </aside>

      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8 lg:py-12">
        {opcoes.isLoading && <div className="h-64 animate-pulse rounded-2xl bg-white" />}
        {opcoes.isError && <p className="rounded-xl bg-white p-6">Não foi possível carregar os planos. Atualize a página.</p>}

        {opcoes.data && passo === 0 && (
          <Etapa titulo="Qual é o seu negócio?" sub="Escolha o segmento. O sistema monta menu, funil e agenda para ele.">
            <div className="grid gap-8">
              {categorias.map(([ck, cn_]) => (
                <section key={ck} aria-labelledby={`cat-${ck}`}>
                  <h3 id={`cat-${ck}`} className="mb-3 text-sm font-semibold text-[#6b5f86]">{cn_}</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {opcoes.data.segmentos.filter((s) => s.categoria === ck).map((s) => {
                      const Icone = ICONES[s.chave];
                      const ativo = segmento === s.chave;
                      return (
                        <button
                          key={s.chave}
                          type="button"
                          onClick={() => {
                            setSegmento(s.chave);
                            setPlano(null);
                            setPasso(1);
                          }}
                          className={cn(
                            "group flex items-start gap-4 rounded-2xl border-2 bg-white p-4 text-left transition hover:border-[#4a03a2]/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#4a03a2]",
                            ativo ? "border-[#4a03a2]" : "border-transparent shadow-[0_1px_0_rgba(20,6,52,.06)]",
                          )}
                          data-testid={`cad-seg-${s.chave}`}
                        >
                          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#efe8fb] text-[#4a03a2] transition group-hover:bg-[#4a03a2] group-hover:text-white">
                            <Icone className="h-6 w-6" />
                          </span>
                          <span>
                            <span className="block text-[16px] font-semibold">{s.chave === "terapia" ? "Clínica terapêutica" : s.nome}</span>
                            <span className="mt-0.5 block text-sm leading-snug text-[#6b5f86]">{s.descricao}</span>
                            <span className="mt-2 block text-xs font-semibold text-[#4a03a2]">
                              a partir de {brl(Math.min(...(opcoes.data.planos[s.chave] ?? []).map((p) => p.preco_mensal)))}/mês
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </Etapa>
        )}

        {opcoes.data && passo === 1 && seg && (
          <Etapa titulo={`Planos para ${seg.nome.toLowerCase()}`} sub="Troque de plano quando quiser, dentro do sistema." voltar={() => setPasso(0)}>
            <div className="mb-5 inline-flex rounded-full bg-white p-1 shadow-sm" role="radiogroup" aria-label="Periodicidade">
              {[false, true].map((a) => (
                <button key={String(a)} type="button" role="radio" aria-checked={anual === a} onClick={() => setAnual(a)}
                  className={cn("rounded-full px-4 py-1.5 text-sm font-semibold", anual === a ? "bg-[#4a03a2] text-white" : "text-[#6b5f86]")}>
                  {a ? "Anual, 20% off" : "Mensal"}
                </button>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {planos.map((p, i) => {
                const preco = anual ? p.preco_anual / 12 : p.preco_mensal;
                const marcado = plano === p.chave;
                return (
                  <button key={p.chave} type="button" onClick={() => setPlano(p.chave)} data-testid={`cad-plano-${p.chave}`}
                    className={cn("relative flex flex-col rounded-2xl border-2 bg-white p-5 text-left transition", marcado ? "border-[#4a03a2]" : "border-transparent hover:border-[#4a03a2]/40")}>
                    {i === 1 && <span className="absolute -top-2.5 left-5 rounded-full bg-[#ff7a00] px-2.5 py-0.5 text-[11px] font-bold text-white">Mais escolhido</span>}
                    <span className="text-lg font-bold">{p.nome}</span>
                    <span className="mt-1 min-h-[2.5rem] text-sm text-[#6b5f86]">{p.resumo}</span>
                    <span className="mt-3 text-[28px] font-bold leading-none tracking-tight">{brl(preco)}<span className="text-sm font-medium text-[#6b5f86]">/mês</span></span>
                    {anual && <span className="mt-1 text-xs text-[#6b5f86]">{brl(p.preco_anual)} por ano</span>}
                    <ul className="mt-4 space-y-1.5 text-sm">
                      <li>{limite(p.usuarios, "usuário", "usuários")}</li>
                      {segmento === "veiculos" || segmento === "imobiliaria" ? <li>{limite(p.imoveis, segmento === "veiculos" ? "veículo" : "imóvel", segmento === "veiculos" ? "veículos no estoque" : "imóveis")}</li> : null}
                      <li>{limite(p.unidades, seg.termos.unidade.toLowerCase(), seg.termos.unidades.toLowerCase())}</li>
                      {p.recursos.slice(0, 4).map((r) => (
                        <li key={r} className="flex gap-1.5"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[#4a03a2]" />{r}</li>
                      ))}
                    </ul>
                  </button>
                );
              })}
            </div>
            <Rodape>
              <button type="button" disabled={!plano} onClick={() => setPasso(2)} className="botao-cad" data-testid="cad-continuar-plano">Continuar</button>
            </Rodape>
          </Etapa>
        )}

        {passo === 2 && seg && (
          <Etapa titulo="Sua empresa e seu acesso" sub="Você será o gestor da conta. Depois convida a equipe." voltar={() => setPasso(1)}>
            <div className="grid gap-4 rounded-2xl bg-white p-5 sm:grid-cols-2 sm:p-6">
              <Campo rotulo={`Nome da ${seg.chave === "veiculos" ? "loja" : seg.termos.unidade.toLowerCase() === "clínica" ? "clínica" : "empresa"}`} cheio>
                <input className="campo-cad" value={f.empresa_nome} onChange={(e) => setF({ ...f, empresa_nome: e.target.value })} autoComplete="organization" data-testid="cad-empresa" />
              </Campo>
              <Campo rotulo="CPF ou CNPJ do titular">
                <input className="campo-cad" inputMode="numeric" value={f.documento} onChange={(e) => setF({ ...f, documento: mascaraDoc(e.target.value) })} data-testid="cad-doc" />
              </Campo>
              <Campo rotulo="Celular com DDD">
                <input className="campo-cad" inputMode="tel" value={f.telefone} onChange={(e) => setF({ ...f, telefone: mascaraTelefone(e.target.value) })} autoComplete="tel" data-testid="cad-tel" />
              </Campo>
              <Campo rotulo="Seu nome completo">
                <input className="campo-cad" value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} autoComplete="name" data-testid="cad-nome" />
              </Campo>
              <Campo rotulo="E-mail de acesso">
                <input className="campo-cad" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" data-testid="cad-email" />
              </Campo>
              <Campo rotulo="Crie uma senha" ajuda="Pelo menos 10 caracteres." cheio>
                <input className="campo-cad" type="password" value={f.senha} onChange={(e) => setF({ ...f, senha: e.target.value })} autoComplete="new-password" data-testid="cad-senha" />
              </Campo>
            </div>
            <Rodape erro={tentou ? erroDados : null}>
              <button type="button" onClick={() => { setTentou(true); if (!erroDados) { setTentou(false); setPasso(3); } }} className="botao-cad" data-testid="cad-continuar-dados">Continuar para o pagamento</button>
            </Rodape>
          </Etapa>
        )}

        {passo === 3 && seg && escolhido && (
          <Etapa titulo="Pagamento" sub="A primeira cobrança acontece agora. As próximas, na mesma data." voltar={() => setPasso(2)}>
            <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
              <div className="grid gap-4 rounded-2xl bg-white p-5 sm:grid-cols-2 sm:p-6">
                <Campo rotulo="Número do cartão" cheio>
                  <div className="relative">
                    <CreditCard className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8b80a3]" />
                    <input className="campo-cad pl-9" inputMode="numeric" autoComplete="cc-number" value={c.numero} onChange={(e) => setC({ ...c, numero: mascaraCartao(e.target.value) })} data-testid="cad-cartao" />
                    {bandeira(c.numero) && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[#6b5f86]">{bandeira(c.numero)}</span>}
                  </div>
                </Campo>
                <Campo rotulo="Nome impresso no cartão" cheio>
                  <input className="campo-cad uppercase" autoComplete="cc-name" value={c.nome} onChange={(e) => setC({ ...c, nome: e.target.value })} data-testid="cad-cartao-nome" />
                </Campo>
                <Campo rotulo="Validade">
                  <input className="campo-cad" inputMode="numeric" placeholder="MM/AA" autoComplete="cc-exp" value={c.validade} onChange={(e) => setC({ ...c, validade: mascaraValidade(e.target.value) })} data-testid="cad-validade" />
                </Campo>
                <Campo rotulo="CVV">
                  <input className="campo-cad" inputMode="numeric" autoComplete="cc-csc" value={c.cvv} onChange={(e) => setC({ ...c, cvv: digitos(e.target.value).slice(0, 4) })} data-testid="cad-cvv" />
                </Campo>
                <Campo rotulo="CEP do titular">
                  <input className="campo-cad" inputMode="numeric" autoComplete="postal-code" value={f.cep} onChange={(e) => setF({ ...f, cep: digitos(e.target.value).slice(0, 8).replace(/(\d{5})(\d)/, "$1-$2") })} data-testid="cad-cep" />
                </Campo>
                <Campo rotulo="Número do endereço">
                  <input className="campo-cad" value={f.numero_endereco} onChange={(e) => setF({ ...f, numero_endereco: e.target.value.slice(0, 10) })} data-testid="cad-numero" />
                </Campo>
                <input tabIndex={-1} aria-hidden autoComplete="off" className="absolute -left-[9999px] h-0 w-0 opacity-0" value={isca} onChange={(e) => setIsca(e.target.value)} />
                <label className="flex items-start gap-2.5 text-sm sm:col-span-2">
                  <input type="checkbox" checked={aceite} onChange={(e) => setAceite(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#4a03a2]" data-testid="cad-aceite" />
                  <span>Li e aceito os termos de uso e a política de privacidade do SAX CRM, e autorizo a cobrança recorrente neste cartão.</span>
                </label>
              </div>
              <aside className="h-fit rounded-2xl bg-[#140634] p-5 text-white">
                <p className="text-sm text-white/70">Resumo</p>
                <p className="mt-1 text-lg font-bold">SAX CRM {seg.nome}</p>
                <p className="text-sm text-white/80">Plano {escolhido.nome}, {anual ? "anual" : "mensal"}</p>
                <div className="my-4 h-px bg-white/15" />
                <p className="text-[30px] font-bold leading-none">{brl(valor)}</p>
                <p className="mt-1 text-sm text-white/70">{anual ? "cobrado uma vez por ano" : "por mês"}</p>
                <p className="mt-4 text-xs leading-relaxed text-white/60">Cancele quando quiser pela tela Assinatura. O acesso continua até o fim do período pago.</p>
              </aside>
            </div>
            <Rodape erro={assinar.isError ? detalheErro(assinar.error) ?? "Não foi possível concluir. Confira os dados do cartão." : tentou ? erroCartao : null}>
              <button type="button" disabled={assinar.isPending} onClick={() => { setTentou(true); if (!erroCartao) assinar.mutate(); }} className="botao-cad" data-testid="cad-assinar">
                {assinar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Assinar e entrar
              </button>
            </Rodape>
          </Etapa>
        )}

        <p className="mt-10 text-center text-sm text-[#6b5f86]">
          Já tem conta? <Link to="/login" className="font-semibold text-[#4a03a2] underline-offset-2 hover:underline">Entrar</Link>
        </p>
      </main>
      <style>{`
        .campo-cad{height:44px;width:100%;border-radius:12px;border:1px solid #e2dcef;background:#fff;padding:0 12px;font-size:15px;outline:none;transition:border-color .15s, box-shadow .15s}
        .campo-cad:focus{border-color:#4a03a2;box-shadow:0 0 0 3px rgba(74,3,162,.15)}
        .botao-cad{display:inline-flex;align-items:center;gap:8px;height:48px;padding:0 24px;border-radius:999px;background:#4a03a2;color:#fff;font-weight:600;font-size:15px}
        .botao-cad:disabled{opacity:.45}
        .botao-cad:not(:disabled):hover{background:#3b0283}
      `}</style>
    </div>
  );
}

function Etapa({ titulo, sub, voltar, children }: { titulo: string; sub: string; voltar?: () => void; children: ReactNode }) {
  return (
    <section>
      {voltar && (
        <button type="button" onClick={voltar} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-[#6b5f86] hover:text-[#1d1530]">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </button>
      )}
      <h2 className="text-[26px] font-bold leading-tight tracking-tight sm:text-[32px]">{titulo}</h2>
      <p className="mb-6 mt-1.5 text-[15px] text-[#6b5f86]">{sub}</p>
      {children}
    </section>
  );
}

function Campo({ rotulo, ajuda, cheio, children }: { rotulo: string; ajuda?: string; cheio?: boolean; children: ReactNode }) {
  return (
    <label className={cn("grid gap-1.5 text-sm font-medium", cheio && "sm:col-span-2")}>
      {rotulo}
      {children}
      {ajuda && <span className="text-xs font-normal text-[#8b80a3]">{ajuda}</span>}
    </label>
  );
}

function Rodape({ erro, children }: { erro?: string | null; children: ReactNode }) {
  return (
    <div className="mt-6 flex flex-col-reverse items-start gap-3 sm:flex-row sm:items-center sm:justify-end">
      {erro && <p className="text-sm text-[#b42318] sm:mr-auto" role="status">{erro}</p>}
      {children}
    </div>
  );
}

