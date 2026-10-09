/** Renderiza o texto do contrato: "# " título, "## " seção, linha em branco separa parágrafos. */
export default function DocumentoTexto({ texto }: { texto: string }) {
  const blocos: { tipo: "h1" | "h2" | "p"; texto: string }[] = [];
  let paragrafo: string[] = [];
  const fechar = () => {
    if (paragrafo.length) blocos.push({ tipo: "p", texto: paragrafo.join(" ") });
    paragrafo = [];
  };
  for (const bruta of texto.split("\n")) {
    const l = bruta.trim();
    if (!l) fechar();
    else if (l.startsWith("# ")) {
      fechar();
      blocos.push({ tipo: "h1", texto: l.slice(2) });
    } else if (l.startsWith("## ")) {
      fechar();
      blocos.push({ tipo: "h2", texto: l.slice(3) });
    } else paragrafo.push(l);
  }
  fechar();
  return (
    <div className="mx-auto max-w-[68ch] font-serif text-[15px] leading-[1.75] text-foreground">
      {blocos.map((b, i) =>
        b.tipo === "h1" ? (
          <h1 key={i} className="mb-5 text-center font-sans text-lg font-bold tracking-tight">
            {b.texto}
          </h1>
        ) : b.tipo === "h2" ? (
          <h2 key={i} className="mb-2 mt-6 font-sans text-sm font-semibold text-primary">
            {b.texto}
          </h2>
        ) : (
          <p key={i} className="mb-3 hyphens-auto sm:text-justify" lang="pt-BR">
            {b.texto}
          </p>
        ),
      )}
    </div>
  );
}
