import { useEffect, useRef, useState } from "react";
import { RotateCcw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useOpcoesLink, type Fluxo, type OpcoesLink, type Passo } from "@/components/whatsapp/fluxo";

/* Teste do fluxo na própria tela, sem mandar nada no WhatsApp: segue as mesmas regras do robô
   (lib/wa_fluxos.py): menu espera o número ou o texto da opção, três respostas fora do menu passam para a equipe. */

type Balao = { de: "robo" | "cliente" | "sistema"; texto: string };

const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

function escolher(p: Passo, resposta: string) {
  const r = norm(resposta);
  const dig = r.replace(/\D/g, "");
  if (dig && dig.length <= 2 && +dig >= 1 && +dig <= p.opcoes.length && r.length <= 12) return p.opcoes[+dig - 1];
  return p.opcoes.find((o) => norm(o.rotulo) === r) ?? p.opcoes.find((o) => norm(o.rotulo).length >= 3 && r.includes(norm(o.rotulo))) ?? null;
}

function citado(texto: string, op: OpcoesLink | undefined) {
  const t = ` ${norm(texto.replace(/[^\p{L}\p{N}\s]/gu, " "))} `;
  const profs = op?.profissionais ?? [];
  const cheio = profs.find((p) => norm(p.nome).length >= 3 && t.includes(` ${norm(p.nome)} `));
  if (cheio) return cheio;
  const primeiro = (n: string) => norm(n).split(" ")[0];
  return profs.find((p) => primeiro(p.nome).length >= 3 && t.includes(` ${primeiro(p.nome)} `) && profs.filter((x) => primeiro(x.nome) === primeiro(p.nome)).length === 1) ?? null;
}

function textoLink(p: Passo, op: OpcoesLink | undefined, cliente: string): string {
  let url: string | null = null;
  let nome = "";
  if (p.link_tipo === "url") url = p.url || null;
  else if (p.link_tipo === "catalogo") url = op?.catalogo ?? null;
  else if (p.link_tipo === "item") {
    const it = op?.itens.find((x) => x.id === p.destino_id);
    nome = it?.nome ?? "";
    url = op?.catalogo ?? null;
  } else if (p.link_tipo === "agenda_profissional") {
    const x = op?.profissionais.find((y) => y.id === p.destino_id);
    nome = x?.nome ?? "";
    url = x?.url ?? op?.agenda ?? null;
  } else if (p.link_tipo === "agenda_citado") {
    const x = citado(cliente, op);
    nome = x?.nome ?? "";
    url = x?.url ?? op?.agenda ?? null;
  } else url = op?.agenda ?? null;
  let t = (p.texto || "");
  // ninguém citado: "Agenda do {nome}:" vira "Agenda:" (igual ao robô)
  if (!nome) t = t.replace(/\s+(?:d[oa]s?|com\s+[oa]|para\s+[oa]|[oa])\s+\{nome\}/gi, "");
  t = t.replace(/\{nome\}/g, nome).replace(/\{preco\}/g, "").trim();
  if (!url) return t.replace(/\{link\}/g, "").trim() + "\n(link indisponível: confira a agenda online ou o site)";
  t = t.includes("{link}") ? t.replace(/\{link\}/g, url) : `${t}\n${url}`.trim();
  return t;
}

export function SimuladorFluxo({ f, nomeDe }: { f: Fluxo; nomeDe: (tipo: "pessoa" | "setor", id: string | null) => string }) {
  const { data: op } = useOpcoesLink();
  const [baloes, setBaloes] = useState<Balao[]>([]);
  const [esperando, setEsperando] = useState<{ passo: string; erros: number } | null>(null);
  const [fim, setFim] = useState(false);
  const [texto, setTexto] = useState("Oi, boa tarde");
  const [ditos, setDitos] = useState("");  // o que o cliente já disse no fluxo (acha o profissional citado)
  const fundo = useRef<HTMLDivElement>(null);
  useEffect(() => fundo.current?.scrollIntoView({ block: "end" }), [baloes]);

  const passo = (id: string | null) => f.passos.find((p) => p.id === id) ?? null;
  const rodar = (inicio: string | null, cliente: string, saida: Balao[]) => {
    let id = inicio;
    for (let n = 0; n < 15; n++) {
      const p = passo(id);
      if (!p) break;
      if (p.tipo === "menu") {
        saida.push({ de: "robo", texto: [p.texto.trim(), "", ...p.opcoes.map((o, k) => `${k + 1}. ${o.rotulo}`)].join("\n").trim() });
        setEsperando({ passo: p.id, erros: 0 });
        return saida;
      }
      if (p.tipo === "link") saida.push({ de: "robo", texto: textoLink(p, op, cliente) });
      else if (p.texto.trim()) saida.push({ de: "robo", texto: p.texto.trim() });
      if (p.tipo === "transferir") {
        saida.push({ de: "sistema", texto: p.destino_tipo === "pessoa" ? `Conversa passa para ${nomeDe("pessoa", p.destino_id)}` : p.destino_tipo === "setor" ? `Conversa vai para o setor ${nomeDe("setor", p.destino_id)}` : "Conversa vai para a fila da equipe" });
        break;
      }
      if (p.tipo === "encerrar") break;
      id = p.proximo;
    }
    saida.push({ de: "sistema", texto: "Fim do fluxo. Daqui em diante, a equipe responde." });
    setEsperando(null);
    setFim(true);
    return saida;
  };

  const enviar = (msg: string) => {
    const t = msg.trim();
    if (!t) return;
    const nova: Balao[] = [...baloes, { de: "cliente", texto: t }];
    const tudo = `${ditos} ${t}`.trim();
    setDitos(tudo);
    setTexto("");
    if (!baloes.length) {
      setBaloes(rodar(f.passos[0]?.id ?? null, t, nova));
      return;
    }
    if (fim || !esperando) {
      setBaloes([...nova, { de: "sistema", texto: "O robô não responde mais nesta conversa. Recomece o teste." }]);
      return;
    }
    const p = passo(esperando.passo)!;
    const o = escolher(p, t);
    if (o) {
      setBaloes(rodar(o.proximo, tudo, nova));
      return;
    }
    const erros = esperando.erros + 1;
    if (erros >= 3) {
      setBaloes([...nova, { de: "robo", texto: "Vou chamar alguém da equipe para te atender." }, { de: "sistema", texto: "Conversa vai para a fila da equipe" }]);
      setEsperando(null);
      setFim(true);
      return;
    }
    setEsperando({ ...esperando, erros });
    setBaloes([...nova, { de: "robo", texto: ["Não entendi. Responda com o número da opção.", "", ...p.opcoes.map((x, k) => `${k + 1}. ${x.rotulo}`)].join("\n") }]);
  };
  const recomecar = () => { setDitos(""); setBaloes([]); setEsperando(null); setFim(false); setTexto("Oi, boa tarde"); };
  const menu = esperando ? passo(esperando.passo) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border" data-testid="simulador">
      <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2 text-xs">
        <span className="font-semibold">Teste do fluxo (nada é enviado)</span>
        <Button size="sm" variant="ghost" onClick={recomecar}><RotateCcw className="h-3.5 w-3.5" /> Recomeçar</Button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-[#efeae2] p-3 dark:bg-zinc-900">
        {!baloes.length && <p className="rounded-md bg-white/80 p-2 text-center text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">Mande a primeira mensagem como se fosse o cliente.</p>}
        {baloes.map((b, i) => (
          <div key={i} className={cn("max-w-[88%] whitespace-pre-wrap break-words rounded-lg px-2.5 py-1.5 text-[13px] shadow-sm",
            b.de === "cliente" ? "ml-auto rounded-tr-sm bg-[#d9fdd3] text-zinc-900 dark:bg-emerald-900 dark:text-emerald-50"
              : b.de === "robo" ? "rounded-tl-sm bg-white text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                : "mx-auto bg-transparent text-center text-[11px] italic text-zinc-600 shadow-none dark:text-zinc-400")}
            data-testid={`sim-${b.de}`}>
            {b.texto}
          </div>
        ))}
        <div ref={fundo} />
      </div>
      {menu && (
        <div className="flex flex-wrap gap-1 border-t p-2">
          {menu.opcoes.map((o, k) => (
            <button key={k} type="button" onClick={() => enviar(String(k + 1))} className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted" data-testid="sim-opcao">
              {k + 1}. {o.rotulo || "opção"}
            </button>
          ))}
        </div>
      )}
      <form className="flex gap-2 border-t p-2" onSubmit={(e) => { e.preventDefault(); enviar(texto); }}>
        <Input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Mensagem do cliente" aria-label="Mensagem do cliente" data-testid="sim-texto" />
        <Button type="submit" size="icon" aria-label="Enviar" data-testid="sim-enviar"><Send className="h-4 w-4" /></Button>
      </form>
    </div>
  );
}
