import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { CheckCircle2, Download, Eraser, FileText, Loader2, PenLine, ShieldCheck, Type, XCircle } from "lucide-react";
import { ApiError, apiGet, apiPost, detalheErro } from "@/lib/api";
import type { DocumentoPublico } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import DocumentoTexto from "@/components/contratos/DocumentoTexto";
import { cn } from "@/lib/utils";

function mascaraCpf(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

function cpfValido(v: string) {
  const n = v.replace(/\D/g, "");
  if (n.length !== 11 || /^(\d)\1+$/.test(n)) return false;
  for (const t of [9, 10]) {
    let s = 0;
    for (let i = 0; i < t; i++) s += Number(n[i]) * (t + 1 - i);
    if (((s * 10) % 11) % 10 !== Number(n[t])) return false;
  }
  return true;
}

/** Quadro de assinatura com o dedo/mouse. Exporta PNG transparente. */
function PadAssinatura({ onChange }: { onChange: (png: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const desenhando = useRef(false);
  const ultimo = useRef<{ x: number; y: number } | null>(null);
  const [vazio, setVazio] = useState(true);

  useEffect(() => {
    const c = canvas.current!;
    const ajustar = () => {
      const r = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      c.width = r.width * dpr;
      c.height = r.height * dpr;
      const ctx = c.getContext("2d")!;
      ctx.scale(dpr, dpr);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#13233f";
      ctx.lineWidth = 2.4;
      setVazio(true);
      onChange(null);
    };
    ajustar();
    window.addEventListener("resize", ajustar);
    return () => window.removeEventListener("resize", ajustar);
  }, [onChange]);

  const ponto = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <canvas
          ref={canvas}
          className="h-44 w-full touch-none rounded-lg border-2 border-dashed bg-white"
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            desenhando.current = true;
            ultimo.current = ponto(e);
          }}
          onPointerMove={(e) => {
            if (!desenhando.current || !ultimo.current) return;
            const p = ponto(e);
            const ctx = canvas.current!.getContext("2d")!;
            ctx.beginPath();
            ctx.moveTo(ultimo.current.x, ultimo.current.y);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            ultimo.current = p;
            if (vazio) setVazio(false);
          }}
          onPointerUp={() => {
            desenhando.current = false;
            ultimo.current = null;
            if (!vazio) onChange(canvas.current!.toDataURL("image/png"));
          }}
          aria-label="Área para desenhar a assinatura"
          data-testid="pad-assinatura"
        />
        <div className="pointer-events-none absolute inset-x-6 bottom-9 border-b border-slate-300" />
        {vazio && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">Assine aqui com o dedo ou o mouse</span>}
      </div>
      <button
        type="button"
        onClick={() => {
          const c = canvas.current!;
          c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
          setVazio(true);
          onChange(null);
        }}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <Eraser className="h-3.5 w-3.5" /> Limpar
      </button>
    </div>
  );
}

function assinaturaDigitada(nome: string): string | null {
  if (nome.trim().length < 3) return null;
  const c = document.createElement("canvas");
  c.width = 900;
  c.height = 240;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#13233f";
  let tamanho = 84;
  ctx.font = `italic 500 ${tamanho}px "Lora Variable", Georgia, serif`;
  while (ctx.measureText(nome).width > 840 && tamanho > 30) {
    tamanho -= 4;
    ctx.font = `italic 500 ${tamanho}px "Lora Variable", Georgia, serif`;
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(nome.trim(), 450, 120);
  return c.toDataURL("image/png");
}

export default function Assinar() {
  const { token = "" } = useParams();
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [cpf, setCpf] = useState("");
  const [modo, setModo] = useState<"desenho" | "digitada">("desenho");
  const [png, setPng] = useState<string | null>(null);
  const [aceite, setAceite] = useState(false);
  const [recusando, setRecusando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const secao = useRef<HTMLDivElement>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["assinar", token],
    queryFn: () => apiGet<DocumentoPublico>(`/assinatura/${token}`),
    retry: false,
  });

  useEffect(() => {
    if (data) {
      setNome((n) => n || data.signatario.nome);
      if (data.signatario.cpf && !cpf) setCpf(mascaraCpf(data.signatario.cpf));
      document.title = `Assinar ${data.contrato_numero}, ${data.empresa_nome}`;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const imagem = modo === "digitada" ? assinaturaDigitada(nome) : png;
  const assinar = useMutation({
    mutationFn: () => apiPost<DocumentoPublico>(`/assinatura/${token}/assinar`, { nome: nome.trim(), cpf, assinatura_png: imagem, assinatura_tipo: modo, aceite }),
    onSuccess: (d) => {
      qc.setQueryData(["assinar", token], d);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
  });
  const recusar = useMutation({
    mutationFn: () => apiPost<DocumentoPublico>(`/assinatura/${token}/recusar`, { motivo: motivo.trim() }),
    onSuccess: (d) => {
      qc.setQueryData(["assinar", token], d);
      setRecusando(false);
    },
  });

  const cor = data?.cor_primaria ?? "#4a03a2";

  if (isLoading)
    return (
      <div className="flex min-h-svh items-center justify-center bg-[#eef1ef]">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );

  if (error || !data) {
    const status = error instanceof ApiError ? error.status : 0;
    return (
      <div className="flex min-h-svh items-center justify-center bg-[#eef1ef] p-6">
        <div className="max-w-sm rounded-xl bg-white p-8 text-center shadow-sm">
          <XCircle className="mx-auto mb-3 h-10 w-10 text-slate-400" />
          <h1 className="text-lg font-semibold text-slate-900">{status === 410 ? "Contrato cancelado" : "Link inválido"}</h1>
          <p className="mt-2 text-sm text-slate-600">
            {status === 410 ? "Este contrato foi cancelado pela imobiliária." : "Este link não existe, expirou ou foi substituído por um novo. Peça um novo link à imobiliária."}
          </p>
        </div>
      </div>
    );
  }

  const s = data.signatario;
  const assinado = s.status === "assinado";
  const recusado = s.status === "recusado";
  const pronto = nome.trim().length >= 3 && cpfValido(cpf) && !!imagem && aceite;

  return (
    <div className="min-h-svh bg-[#eef1ef] text-slate-900" style={{ ["--primary" as string]: cor }}>
      <header className="sticky top-0 z-20 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          {data.tem_logo ? (
            <img src={`/api/assinatura/${token}/logo`} alt="" className="h-9 w-9 rounded object-contain" />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-md text-sm font-bold text-white" style={{ backgroundColor: cor }}>
              {data.empresa_nome.slice(0, 1)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{data.empresa_nome}</p>
            <p className="truncate text-xs text-slate-500">
              {data.titulo}, nº {data.contrato_numero}
            </p>
          </div>
          {!assinado && !recusado && (
            <Button size="sm" style={{ backgroundColor: cor }} className="text-white" onClick={() => secao.current?.scrollIntoView({ behavior: "smooth" })}>
              <PenLine className="h-3.5 w-3.5" /> Assinar
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 px-3 py-5 sm:px-4">
        {assinado && (
          <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5" data-testid="assinatura-concluida">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-7 w-7 shrink-0 text-emerald-600" />
              <div>
                <h1 className="text-lg font-semibold">Assinatura registrada</h1>
                <p className="mt-1 text-sm text-slate-700">
                  {s.nome_assinado}, sua assinatura foi registrada em {s.assinado_em ? new Date(s.assinado_em).toLocaleString("pt-BR") : ""}.
                  {data.concluido ? " Todas as partes já assinaram." : " Avisaremos a imobiliária; o documento fica completo quando todos assinarem."}
                </p>
                <Button variant="outline" size="sm" className="mt-3 bg-white" onClick={() => window.open(`/api/assinatura/${token}/pdf`, "_blank")}>
                  <Download className="h-3.5 w-3.5" /> Baixar cópia em PDF
                </Button>
              </div>
            </div>
          </section>
        )}
        {recusado && (
          <section className="rounded-xl border border-rose-200 bg-rose-50 p-5">
            <h1 className="font-semibold">Você recusou a assinatura</h1>
            <p className="mt-1 text-sm text-slate-700">Motivo informado: {s.motivo_recusa}. A imobiliária foi notificada e pode enviar um novo link.</p>
          </section>
        )}
        {!assinado && !recusado && (
          <section className="rounded-xl bg-white p-4 shadow-sm sm:p-5">
            <p className="text-sm text-slate-600">Olá,</p>
            <h1 className="text-xl font-semibold">{s.nome}</h1>
            <p className="mt-1 text-sm text-slate-600">
              {data.empresa_nome} enviou este documento para você ler e assinar. Leva cerca de 2 minutos e funciona pelo celular.
            </p>
          </section>
        )}

        <section className="rounded-xl bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b px-4 py-2.5 text-sm text-slate-600">
            <FileText className="h-4 w-4" /> Documento
          </div>
          <div className="px-5 py-8 sm:px-12">
            <DocumentoTexto texto={data.texto} />
          </div>
          <p className="break-all border-t px-5 py-2 text-[10px] text-slate-500">Código de integridade (SHA-256): {data.hash}</p>
        </section>

        <section className="rounded-xl bg-white p-4 shadow-sm sm:p-5">
          <h2 className="mb-2 text-sm font-semibold">Assinaturas</h2>
          <ul className="space-y-1.5">
            {data.signatarios.map((p, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                {p.status === "assinado" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : p.status === "recusado" ? <XCircle className="h-4 w-4 text-rose-600" /> : <span className="h-4 w-4 rounded-full border-2 border-slate-300" />}
                <span className="flex-1">{p.nome}</span>
                <span className="text-xs text-slate-500">{p.papel}</span>
              </li>
            ))}
          </ul>
        </section>

        {!assinado && !recusado && (
          <section ref={secao} className="scroll-mt-20 rounded-xl bg-white p-4 shadow-sm sm:p-5" data-testid="secao-assinar">
            <h2 className="text-base font-semibold">Assinar</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="as-nome">Nome completo</Label>
                <Input id="as-nome" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="as-cpf">CPF</Label>
                <Input
                  id="as-cpf"
                  inputMode="numeric"
                  value={cpf}
                  onChange={(e) => setCpf(mascaraCpf(e.target.value))}
                  placeholder="000.000.000-00"
                  aria-invalid={cpf.length === 14 && !cpfValido(cpf)}
                  data-testid="assinar-cpf"
                />
                {cpf.length === 14 && !cpfValido(cpf) && <p className="text-xs text-rose-600">CPF inválido. Confira os números.</p>}
              </div>
            </div>

            <div className="mt-4 flex rounded-md border p-0.5">
              {(
                [
                  ["desenho", PenLine, "Desenhar"],
                  ["digitada", Type, "Digitar"],
                ] as const
              ).map(([m, Icone, r]) => (
                <button key={m} type="button" onClick={() => setModo(m)} className={cn("flex h-8 flex-1 items-center justify-center gap-1.5 rounded text-sm", modo === m ? "text-white" : "text-slate-600")} style={modo === m ? { backgroundColor: cor } : undefined}>
                  <Icone className="h-4 w-4" /> {r}
                </button>
              ))}
            </div>
            <div className="mt-3">
              {modo === "desenho" ? (
                <PadAssinatura onChange={setPng} />
              ) : (
                <div className="flex h-44 items-center justify-center rounded-lg border-2 border-dashed bg-white px-4">
                  <span className="truncate font-serif text-4xl italic text-[#13233f]">{nome || "Seu nome"}</span>
                </div>
              )}
            </div>

            <label className="mt-4 flex items-start gap-2.5 text-sm leading-snug">
              <Checkbox checked={aceite} onCheckedChange={(v) => setAceite(!!v)} className="mt-0.5" data-testid="assinar-aceite" />
              <span>
                Li o documento acima e concordo com seus termos. Reconheço esta assinatura eletrônica como válida e autorizo o registro de data, hora, IP e
                dispositivo como prova de autoria.
              </span>
            </label>

            {assinar.error && <p className="mt-3 rounded-md bg-rose-50 p-2 text-sm text-rose-700">{detalheErro(assinar.error) ?? "Não foi possível registrar. Tente novamente."}</p>}

            <Button className="mt-4 h-11 w-full text-base text-white" style={{ backgroundColor: cor }} disabled={!pronto || assinar.isPending} onClick={() => assinar.mutate()} data-testid="assinar-confirmar">
              {assinar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Assinar documento
            </Button>
            {!pronto && <p className="mt-2 text-center text-xs text-slate-500">Preencha nome, CPF, assinatura e confirme a leitura.</p>}

            <div className="mt-5 border-t pt-3">
              {recusando ? (
                <div className="space-y-2">
                  <Label htmlFor="as-motivo">Por que você não vai assinar?</Label>
                  <Textarea id="as-motivo" rows={2} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setRecusando(false)}>
                      Voltar
                    </Button>
                    <Button variant="destructive" size="sm" disabled={motivo.trim().length < 3 || recusar.isPending} onClick={() => recusar.mutate()}>
                      Recusar assinatura
                    </Button>
                  </div>
                </div>
              ) : (
                <button className="text-xs text-slate-500 underline-offset-2 hover:underline" onClick={() => setRecusando(true)}>
                  Encontrou um problema? Recusar e informar o motivo
                </button>
              )}
            </div>
          </section>
        )}
        <p className="pb-6 text-center text-[11px] text-slate-500">Assinatura eletrônica com trilha de auditoria. Link pessoal e intransferível.</p>
      </main>
    </div>
  );
}
