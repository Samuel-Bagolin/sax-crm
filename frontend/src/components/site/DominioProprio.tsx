import { useEffect, useState, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import SitePublico from "@/pages/SitePublico";
import AgendarPublico from "@/pages/AgendarPublico";
import { dominioProprio } from "@/lib/dominio";

/** Hosts do próprio SAX: aqui o app abre normal, sem perguntar ao servidor. */
function hostDoSax(h: string) {
  return h === "localhost" || h === "127.0.0.1" || h.endsWith(".vercel.app") || h.endsWith(".localhost") || /^\d+\.\d+\.\d+\.\d+$/.test(h);
}

/**
 * Domínio próprio do cliente (www.suaimobiliaria.com.br) aponta para o mesmo app.
 * Se o host for de um site cadastrado, mostra o site; senão segue para o app normal.
 */
export function DominioProprio({ children }: { children: ReactNode }) {
  const host = window.location.hostname.toLowerCase();
  const [estado, setEstado] = useState<{ slug: string | null; pronto: boolean }>({ slug: null, pronto: hostDoSax(host) });

  useEffect(() => {
    if (hostDoSax(host)) return;
    let vivo = true;
    fetch(`/api/publico/site/dominio/${encodeURIComponent(host)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { slug: string; principal: string } | null) => {
        if (!vivo) return;
        // Quem abriu pelo domínio sem www vai para o www (o Vercel também redireciona; isto cobre o resto).
        if (d && d.principal && d.principal !== host && host === d.principal.replace(/^www\./, "")) {
          window.location.replace(`https://${d.principal}${window.location.pathname}${window.location.search}`);
          return;
        }
        setEstado({ slug: d?.slug ?? null, pronto: true });
      })
      .catch(() => vivo && setEstado({ slug: null, pronto: true }));
    return () => {
      vivo = false;
    };
  }, [host]);

  if (!estado.pronto) return <div className="min-h-dvh bg-white" />;
  if (!estado.slug) return <>{children}</>;
  const slug = estado.slug;
  dominioProprio.ativo = true;
  return (
    <Routes>
      <Route path="/" element={<SitePublico slugFixo={slug} />} />
      <Route path="/imovel/:codigo" element={<SitePublico slugFixo={slug} />} />
      <Route path="/s/:slug" element={<SitePublico />} />
      <Route path="/s/:slug/imovel/:codigo" element={<SitePublico />} />
      <Route path="/agendar/:slug" element={<AgendarPublico />} />
      <Route path="/agendar/:slug/reserva/:token" element={<AgendarPublico />} />
      <Route path="/agendar/:slug/:prof" element={<AgendarPublico />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
