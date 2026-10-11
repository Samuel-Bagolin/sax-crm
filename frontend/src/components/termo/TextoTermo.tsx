import type { ReactNode } from "react";

/** Mostra o texto do termo ('#' título, '##' cláusula). A cláusula de não reembolso aparece em destaque. */
export function TextoTermo({ texto }: { texto: string }) {
  const blocos: ReactNode[] = [];
  let secao: { titulo: string; paragrafos: string[] } | null = null;
  const fechar = () => {
    if (!secao) return;
    const destaque = /não são devolvidos|sem fidelidade/i.test(secao.titulo);
    blocos.push(
      <section key={blocos.length} className={destaque ? "rounded-lg border-2 border-amber-400 bg-amber-50 p-3 dark:bg-amber-950/30" : ""}>
        <h3 className="mb-1.5 mt-3 text-sm font-semibold text-primary first:mt-0">{secao.titulo}</h3>
        {secao.paragrafos.map((p, i) => <p key={i} className="mb-2 text-sm leading-relaxed">{p}</p>)}
      </section>,
    );
    secao = null;
  };
  for (const linha of texto.split("\n")) {
    const l = linha.trim();
    if (!l) continue;
    if (l.startsWith("# ")) blocos.push(<h2 key={blocos.length} className="text-lg font-bold">{l.slice(2)}</h2>);
    else if (l.startsWith("## ")) { fechar(); secao = { titulo: l.slice(3), paragrafos: [] }; }
    else if (secao) (secao as { paragrafos: string[] }).paragrafos.push(l);
    else { blocos.push(<p key={blocos.length} className="mb-2 text-sm leading-relaxed text-muted-foreground">{l}</p>); }
  }
  fechar();
  return <div className="space-y-2" data-testid="termo-texto">{blocos}</div>;
}
