import { useEffect, useState } from "react";
import { primeiroNome } from "@/lib/format";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { TermoGate } from "@/components/termo/TermoGate";
import { usePlano, type Recurso } from "@/lib/diferenciais";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck,
  MessageSquareText,
  Building,
  Building2,
  CalendarDays,
  ChartNoAxesColumn,
  CircleDollarSign,
  FileSignature,
  Handshake,
  ReceiptText,
  Inbox,
  KeyRound,
  Globe,
  Car,
  Contact,
  Crown,
  CreditCard,
  FileSpreadsheet,
  Store,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Menu,
  Moon,
  Search,
  Settings,
  SlidersHorizontal,
  Sun,
  UserRound,
  Users,
  type LucideIcon, Gift, Percent } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { endSession } from "@/lib/session";
import { apiGet } from "@/lib/api";
import AvisoVisitasBanner from "@/components/agenda/AvisoVisitasBanner";
import FaixaAmbiente from "@/components/layout/FaixaAmbiente";
import BuscaGlobal from "@/components/layout/BuscaGlobal";
import Avatar from "@/components/shared/Avatar";
import MarcaSax from "@/components/shared/MarcaSax";
import { useAuth } from "@/lib/useAuth";
import { useConfig } from "@/lib/useConfig";
import { iniciais, isoLocal } from "@/lib/crm";
import type { Atividade, SegmentoChave, TermosSegmento } from "@/lib/types";
import { SERVICOS, useSegmento } from "@/lib/segmento";
import { cn } from "@/lib/utils";
import { ehPadrao, variaveisMenu } from "@/lib/coresMenu";

type Nivel = "todos" | "admin" | "sysadmin";
interface ItemNav {
  to: string;
  modulo: string;
  icon: LucideIcon;
  rotulo?: string;
  curto?: string;
  nivel: Nivel;
  contador?: "leads" | "atividades" | "chat";
  /** Só aparece nestes segmentos. Vazio = todos. */
  segmentos?: SegmentoChave[];
  /** Só aparece se o plano tiver este recurso. */
  recurso?: Recurso;
}

const VENDAS: SegmentoChave[] = ["imobiliaria", "veiculos"];
/** Segmentos com Leads, Negócios e Agenda de atividades (vendas e comércio). */
const COMERCIAL: SegmentoChave[] = [...VENDAS, "comercio"];

/** Troca {clientes}, {profissionais} etc. pelo vocabulário do segmento. */
function comTermos(texto: string, t: TermosSegmento): string {
  return texto.replace(/\{(\w+)\}/g, (_, k: keyof TermosSegmento) => t[k] ?? k);
}

const COM_ORCAMENTO: SegmentoChave[] = ["odontologia", "estetica"];

/** Ordem do menu: Leads, Negócios ou Pacientes, Agenda, Orçamentos, Contratos; depois operação e gestão. */
const GRUPOS: { titulo: string | null; itens: ItemNav[] }[] = [
  {
    titulo: null,
    itens: [{ to: "/", modulo: "dashboard", icon: LayoutDashboard, curto: "Início", nivel: "todos" }],
  },
  {
    titulo: "Comercial",
    itens: [
      { to: "/leads", modulo: "crm", icon: Inbox, rotulo: "Leads", nivel: "todos", contador: "leads", segmentos: COMERCIAL },
      { to: "/whatsapp", modulo: "crm", icon: MessageSquareText, rotulo: "WhatsApp", curto: "WhatsApp", nivel: "todos", segmentos: COMERCIAL },
      { to: "/crm", modulo: "crm", icon: Handshake, rotulo: "Negócios", nivel: "todos", segmentos: COMERCIAL },
      { to: "/pacientes", modulo: "pacientes", icon: Contact, rotulo: "{clientes}", nivel: "todos", segmentos: ["comercio"] },
      { to: "/agenda", modulo: "agenda", icon: CalendarDays, nivel: "todos", contador: "atividades", segmentos: COMERCIAL },
      { to: "/imoveis", modulo: "imoveis", icon: Building2, nivel: "todos", segmentos: ["imobiliaria"] },
      { to: "/veiculos", modulo: "veiculos", icon: Car, rotulo: "Estoque", nivel: "todos", segmentos: ["veiculos"] },
      { to: "/proprietarios", modulo: "imoveis", icon: KeyRound, rotulo: "Proprietários", curto: "Donos", nivel: "todos", segmentos: ["imobiliaria"] },
      { to: "/contratos", modulo: "contratos", icon: FileSignature, nivel: "todos", segmentos: ["imobiliaria", "veiculos"] },
      { to: "/meu-site", modulo: "imoveis", icon: Globe, rotulo: "Meu site", curto: "Site", nivel: "todos", segmentos: ["imobiliaria"] },
      { to: "/meu-site", modulo: "veiculos", icon: Globe, rotulo: "Meu site", curto: "Site", nivel: "todos", segmentos: ["veiculos"] },
      { to: "/meu-site", modulo: "crm", icon: Globe, rotulo: "Meu site", curto: "Site", nivel: "todos", segmentos: ["comercio"] },
    ],
  },
  {
    titulo: "Atendimento",
    itens: [
      { to: "/leads", modulo: "crm", icon: Inbox, rotulo: "Leads", nivel: "todos", contador: "leads", segmentos: SERVICOS },
      { to: "/whatsapp", modulo: "pacientes", icon: MessageSquareText, rotulo: "WhatsApp", curto: "WhatsApp", nivel: "todos", segmentos: SERVICOS },
      { to: "/crm", modulo: "crm", icon: Handshake, rotulo: "Negócios", nivel: "todos", segmentos: SERVICOS },
      { to: "/pacientes", modulo: "pacientes", icon: Contact, rotulo: "{clientes}", nivel: "todos", segmentos: SERVICOS },
      { to: "/atendimentos", modulo: "atendimentos", icon: CalendarDays, rotulo: "Agenda", nivel: "todos", segmentos: SERVICOS },
      { to: "/clube", modulo: "atendimentos", icon: Crown, rotulo: "Assinantes", curto: "Clube", nivel: "todos", segmentos: ["barbearia"] },
      { to: "/orcamentos", modulo: "pacientes", icon: ReceiptText, rotulo: "Orçamentos", curto: "Orçam.", nivel: "todos", segmentos: COM_ORCAMENTO },
      { to: "/meu-site", modulo: "atendimentos", icon: Globe, rotulo: "Meu site", curto: "Site", nivel: "todos", segmentos: SERVICOS },
    ],
  },
  {
    titulo: "Operação",
    itens: [
      { to: "/financeiro", modulo: "financeiro", icon: CircleDollarSign, nivel: "todos" },
      { to: "/comissoes", modulo: "crm", icon: Percent, rotulo: "Comissões", nivel: "todos", segmentos: ["comercio"] },
      { to: "/cashback", modulo: "pacientes", icon: Gift, rotulo: "Afiliados e cashback", curto: "Afiliados", nivel: "todos", segmentos: ["comercio"] },
      { to: "/relatorios", modulo: "crm", icon: ChartNoAxesColumn, rotulo: "Relatórios", nivel: "todos" },
      { to: "/pesquisas", modulo: "usuarios", icon: ClipboardCheck, rotulo: "Pesquisas e NPS", curto: "NPS", nivel: "admin" },
      { to: "/chat", modulo: "chat", icon: MessageCircle, rotulo: "Chat da equipe", curto: "Chat", nivel: "todos", contador: "chat" },
    ],
  },
  {
    titulo: "Gestão",
    itens: [
      { to: "/usuarios", modulo: "usuarios", icon: Users, rotulo: "{profissionais}", curto: "Equipe", nivel: "admin" },
      { to: "/unidades", modulo: "usuarios", icon: Store, rotulo: "{unidades}", nivel: "admin" },
      { to: "/crm/configurar", modulo: "crm", icon: SlidersHorizontal, rotulo: "Configurar CRM", curto: "Ajustes", nivel: "admin" },
      { to: "/dados", modulo: "usuarios", icon: FileSpreadsheet, rotulo: "Importar dados", curto: "Dados", nivel: "admin" },
      { to: "/assinatura", modulo: "usuarios", icon: CreditCard, rotulo: "Assinatura", curto: "Plano", nivel: "admin" },
      { to: "/configuracoes", modulo: "configuracoes", icon: Settings, rotulo: "Configurador do sistema", curto: "Sistema", nivel: "sysadmin" },
      { to: "/empresas", modulo: "empresas", icon: Building, rotulo: "Empresas", nivel: "sysadmin" },
    ],
  },
];

const TITULOS: Record<string, string> = {
  "/leads": "Leads",
  "/crm": "Negócios",
  "/crm/configurar": "Configurar CRM",
  "/configuracoes": "Configurador do sistema",
  "/empresas": "Empresas",
  "/perfil": "Meu perfil",
  "/relatorios": "Relatórios",
  "/chat": "Chat da equipe",
  "/proprietarios": "Proprietários",
  "/meu-site": "Meu site",
  "/whatsapp": "WhatsApp",
  "/atendimentos": "Agenda",
  "/agenda-online": "Serviços",
  "/orcamentos": "Orçamentos",
  "/clube": "Clube de assinantes",
  "/veiculos": "Estoque de veículos",
  "/assinatura": "Assinatura",
  "/dados": "Importar e exportar dados",
  "/pesquisas": "Pesquisas e NPS",
};
const MODULO_POR_ROTA: Record<string, string> = {
  "/": "dashboard",
  "/imoveis": "imoveis",
  "/financeiro": "financeiro",
  "/agenda": "agenda",
  "/contratos": "contratos",
  "/usuarios": "usuarios",
};
// Telas que usam a largura toda (quadro do funil, agenda da equipe, detalhe do negócio).
const LARGURA_TOTAL = ["/whatsapp", "/crm", "/agenda", "/negocios/", "/relatorios", "/chat"];

function Marca({ nome, logoUrl, compacto }: { nome: string; logoUrl: string | null; compacto: boolean }) {
  return (
    <Link to="/" className={cn("flex h-14 shrink-0 items-center", compacto ? "justify-center" : "gap-2.5 px-4")} aria-label="Início" title={nome}>
      {logoUrl ? (
        <img src={logoUrl} alt="" className={cn("h-10 shrink-0 rounded-md bg-white object-contain p-1", compacto ? "w-[60px]" : "w-16")} data-testid="brand-logo" />
      ) : (
        <MarcaSax className="w-[52px]" />
      )}
      {!compacto && (
        <span className="min-w-0 truncate text-[13px] font-medium text-sidebar-foreground/70" data-testid="brand-nome">
          {nome}
        </span>
      )}
    </Link>
  );
}

function Navegacao({
  compacto,
  aoNavegar,
  contadores,
}: {
  compacto: boolean;
  aoNavegar?: () => void;
  contadores: Record<string, number>;
}) {
  const { isAdmin, isSysadmin, noControle, principal } = useAuth();
  const { moduloAtivo, titulo } = useConfig();
  const seg = useSegmento();
  const { tem } = usePlano();
  const visivel = (item: ItemNav) => {
    if (noControle) return item.modulo === "empresas";
    if (item.recurso && !tem(item.recurso)) return false;
    if (item.segmentos && !item.segmentos.includes(seg.chave)) return false;
    if (item.to === "/unidades" && seg.imobiliaria) return false;
    // Dentro de uma empresa (suporte) a gestão das empresas fica só na aba do plano de controle.
    if (item.modulo === "empresas") return isSysadmin && !principal?.suporte;
    if (item.nivel === "sysadmin") return isSysadmin;
    if (item.nivel === "admin" && !isAdmin) return false;
    if (item.modulo === "configuracoes" || item.modulo === "empresas" || item.modulo === "chat") return true;
    return moduloAtivo(item.modulo);
  };
  return (
    <nav className={cn("flex flex-1 flex-col overflow-y-auto pb-3 scroll-fino", compacto ? "gap-1 px-1.5" : "gap-4 px-2")} data-testid="sidebar-nav">
      {GRUPOS.map((grupo, gi) => {
        const itens = grupo.itens.filter(visivel);
        if (!itens.length) return null;
        return (
          <div key={grupo.titulo ?? "inicio"} className={cn("flex flex-col", compacto ? "gap-1" : "gap-0.5", compacto && gi > 0 && "border-t border-sidebar-border pt-1")}>
            {grupo.titulo && !compacto && <p className="px-3 pb-1 text-[11px] font-medium text-sidebar-foreground/45">{grupo.titulo}</p>}
            {itens.map((item) => {
              const rotulo = comTermos(item.rotulo ?? titulo(item.modulo), seg.termos);
              const curto = item.curto ?? rotulo;
              const total = item.contador ? contadores[item.contador] ?? 0 : 0;
              return (
                <NavLink
                  key={item.to + item.modulo}
                  to={item.to}
                  end={item.to === "/" || item.to === "/crm"}
                  onClick={aoNavegar}
                  title={rotulo}
                  data-testid={`nav-link-${item.to.replace(/\//g, "") || "dashboard"}`}
                  className={({ isActive }) =>
                    cn(
                      "group relative flex items-center rounded-md transition-colors",
                      compacto ? "h-[54px] flex-col justify-center gap-1 px-0.5 text-[10.5px] leading-none" : "h-9 gap-3 px-3 text-sm",
                      isActive
                        ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-full before:bg-sidebar-primary"
                        : "text-sidebar-foreground/65 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                    )
                  }
                >
                  <item.icon className={cn("shrink-0", compacto ? "h-5 w-5" : "h-[18px] w-[18px]")} />
                  <span className={cn(compacto ? "max-w-full truncate text-center" : "flex-1 truncate")}>{compacto ? curto : rotulo}</span>
                  {total > 0 && (
                    <span
                      className={cn(
                        "num rounded-full bg-sidebar-primary font-bold text-sidebar-primary-foreground",
                        compacto ? "absolute right-1.5 top-1 px-1 text-[9px] leading-[15px]" : "px-1.5 text-[11px] leading-[18px]",
                      )}
                    >
                      {total > 99 ? "99+" : total}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

function AlternadorTema() {
  const { resolvedTheme, setTheme } = useTheme();
  const escuro = resolvedTheme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      data-testid="theme-toggle"
      aria-label={escuro ? "Usar tema claro" : "Usar tema escuro"}
      onClick={() => setTheme(escuro ? "light" : "dark")}
    >
      {escuro ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}

export default function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuAberto, setMenuAberto] = useState(false);
  const [buscaAberta, setBuscaAberta] = useState(false);
  const { principal, isAdmin, isSysadmin, noControle } = useAuth();
  const { config, titulo: rotulo, logoUrl, moduloAtivo } = useConfig();
  const crmAtivo = !noControle && moduloAtivo("crm");
  const seg = useSegmento();
  const { data: plano } = usePlano();

  // Contadores do menu: só números, para gastar poucas leituras do banco (o Firestore cobra por documento lido).
  const { data: novos } = useQuery({
    queryKey: ["entradas", "contagem"],
    queryFn: () => apiGet<{ novos: number }>("/entradas/contagem"),
    enabled: crmAtivo,
    refetchInterval: 180_000,
  });
  const hoje = isoLocal(new Date());
  const { data: pendentes = [] } = useQuery({
    queryKey: ["atividades", "pendentes-ate", hoje, principal?.pessoa_id],
    queryFn: () =>
      apiGet<Atividade[]>(`/atividades?pendentes=true&fim=${hoje}${principal?.pessoa_id ? `&corretor_id=${principal.pessoa_id}` : ""}`),
    enabled: crmAtivo,
    refetchInterval: 300_000,
  });
  const { data: chat } = useQuery({
    queryKey: ["chat", "nao-lidas"],
    queryFn: () => apiGet<{ total: number }>("/chat/nao-lidas"),
    enabled: !noControle && !!principal,
    refetchInterval: 60_000,
  });
  const contadores = {
    chat: location.pathname === "/chat" ? 0 : chat?.total ?? 0,
    leads: novos?.novos ?? 0,
    atividades: pendentes.filter((a) => !principal?.pessoa_id || a.corretor_id === principal.pessoa_id).length,
  };

  // Atalho Ctrl/⌘+K abre a busca global.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setBuscaAberta(true);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // Identidade visual do configurador: só sobrescreve quando o gestor personalizou. No modo escuro
  // vale o tema neutro (as cores da empresa foram escolhidas para fundo claro).
  const { resolvedTheme } = useTheme();
  const escuro = resolvedTheme === "dark";
  useEffect(() => {
    const raiz = document.documentElement;
    const personalizado = config.cor_primaria && !["#0b6b5a", "#0284c7", "#5b2bd0", "#4a03a2"].includes(config.cor_primaria.toLowerCase());
    if (personalizado && !escuro) raiz.style.setProperty("--primary", config.cor_primaria);
    else raiz.style.removeProperty("--primary");
    document.title = config.nome_software;
  }, [config.cor_primaria, config.nome_software, escuro]);

  // Cores do menu lateral (Sistema → Identidade visual). Padrão: as do tema (roxo SAX + laranja).
  // No modo escuro o menu fica preto com o laranja SAX, como o resto da tela.
  useEffect(() => {
    const raiz = document.documentElement;
    const vars = escuro || ehPadrao(config.cor_menu, config.cor_menu_destaque) ? null : variaveisMenu(config.cor_menu, config.cor_menu_destaque);
    const nomes = Object.keys(variaveisMenu("#000000", "#000000")!);
    nomes.forEach((n) => raiz.style.removeProperty(n));
    if (vars) Object.entries(vars).forEach(([n, v]) => raiz.style.setProperty(n, v));
    return () => nomes.forEach((n) => raiz.style.removeProperty(n));
  }, [config.cor_menu, config.cor_menu_destaque, escuro]);

  const caminho = location.pathname;
  const segTitulo = useSegmento();
  const titulo = caminho.startsWith("/negocios/")
    ? "Negócio"
    : caminho.startsWith("/proprietarios/")
      ? "Proprietário"
      : caminho === "/pacientes" || caminho.startsWith("/pacientes/")
        ? (caminho === "/pacientes" ? segTitulo.termos.clientes : segTitulo.termos.cliente)
        : caminho === "/unidades"
          ? segTitulo.termos.unidades
          : TITULOS[caminho] ?? (MODULO_POR_ROTA[caminho] ? rotulo(MODULO_POR_ROTA[caminho]) : config.nome_software);
  const larguraTotal = LARGURA_TOTAL.some((p) => (p.endsWith("/") ? caminho.startsWith(p) : caminho === p));

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <FaixaAmbiente />
      <div className="flex min-h-0 flex-1">
        <aside className="sticky top-0 hidden h-svh w-[76px] shrink-0 flex-col bg-sidebar lg:flex">
          <Marca nome={principal?.empresa_nome ?? config.nome_software} logoUrl={logoUrl} compacto />
          <Navegacao compacto contadores={contadores} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-card/90 px-3 backdrop-blur sm:gap-3 sm:px-5">
            <Sheet open={menuAberto} onOpenChange={setMenuAberto}>
              <SheetTrigger render={<Button variant="ghost" size="icon" className="lg:hidden" data-testid="menu-mobile-button" aria-label="Abrir menu" />}>
                <Menu className="h-5 w-5" />
              </SheetTrigger>
              <SheetContent side="left" className="flex w-64 flex-col bg-sidebar p-0">
                <SheetTitle className="sr-only">Menu</SheetTitle>
                <Marca nome={principal?.empresa_nome ?? config.nome_software} logoUrl={logoUrl} compacto={false} />
                <Navegacao compacto={false} contadores={contadores} aoNavegar={() => setMenuAberto(false)} />
              </SheetContent>
            </Sheet>

            <h1 className="truncate font-heading text-base font-semibold tracking-tight sm:text-lg" data-testid="page-title">
              {titulo}
            </h1>

            {!noControle && (
              <button
                type="button"
                onClick={() => setBuscaAberta(true)}
                className="ml-2 hidden h-9 w-full max-w-sm items-center gap-2 rounded-md border bg-background px-3 text-sm text-muted-foreground hover:border-ring/50 md:flex"
                data-testid="busca-global"
              >
                <Search className="h-4 w-4" />
                <span className="flex-1 text-left">Buscar no CRM</span>
                <kbd className="rounded border bg-muted px-1.5 text-[10px] font-medium">Ctrl K</kbd>
              </button>
            )}

            <div className="ml-auto flex items-center gap-1.5">
              {!noControle && (
                <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setBuscaAberta(true)} aria-label="Buscar">
                  <Search className="h-4 w-4" />
                </Button>
              )}
              {principal?.empresa_nome && (
                <div className="mr-1 hidden max-w-[260px] items-center gap-2 border-r pr-3 md:flex" title={principal.empresa_nome} data-testid="empresa-atual">
                  {logoUrl && <img src={logoUrl} alt="" className="h-7 max-w-[72px] shrink-0 object-contain" />}
                  <span className="truncate text-sm font-medium">{principal.empresa_nome}</span>
                </div>
              )}
              <AlternadorTema />
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="ghost" className="h-9 gap-2 px-1.5" data-testid="user-menu-button" aria-label="Sua conta" />}
                >
                  <Avatar
                    nome={principal?.nome}
                    usuarioId={principal?.usuario_id}
                    temFoto={principal?.tem_foto}
                    versao={principal?.foto_v}
                    tamanho="sm"
                  />
                  <span className="hidden max-w-[120px] truncate text-sm font-medium xl:inline" data-testid="user-menu-nome">
                    {primeiroNome(principal?.nome)}
                  </span>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <div className="flex items-center gap-3 px-2 py-2">
                    <Avatar nome={principal?.nome} usuarioId={principal?.usuario_id} temFoto={principal?.tem_foto} versao={principal?.foto_v} tamanho="md" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{principal?.nome}</p>
                      <p className="truncate text-xs text-muted-foreground">{principal?.email}</p>
                      <p className="text-xs text-primary" data-testid="user-menu-papel">
                        {isSysadmin ? "Administrador de sistema" : isAdmin ? "Gestor" : seg.termos.profissional}
                      </p>
                    </div>
                  </div>
                  {principal?.empresa_nome && (
                    <>
                      <DropdownMenuSeparator />
                      <div className="grid gap-1.5 px-2 py-2" data-testid="user-menu-empresa">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sua empresa</p>
                        <div className="flex items-center gap-2.5">
                          {logoUrl ? (
                            <img src={logoUrl} alt="" className="h-10 w-14 shrink-0 object-contain" />
                          ) : (
                            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-sm font-bold text-primary">{iniciais(principal.empresa_nome)}</span>
                          )}
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{principal.empresa_nome}</p>
                            {principal.empresa_cnpj && <p className="text-xs text-muted-foreground">CNPJ {principal.empresa_cnpj}</p>}
                            <p className="truncate text-xs text-muted-foreground">{seg.nome}{plano?.nome ? ` · Plano ${plano.nome}` : ""}</p>
                          </div>
                        </div>
                      </div>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  {!noControle && (
                    <DropdownMenuItem onClick={() => navigate("/perfil")}>
                      <UserRound className="h-4 w-4" /> Meu perfil e foto
                    </DropdownMenuItem>
                  )}
                  {isAdmin && !noControle && (
                    <DropdownMenuItem onClick={() => navigate("/usuarios")}>
                      <Users className="h-4 w-4" /> {seg.termos.profissionais}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => void endSession()} data-testid="logout-button">
                    <LogOut className="h-4 w-4" /> Sair
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          <main className="min-w-0 flex-1">
            <div className={cn("mx-auto w-full", larguraTotal ? "p-3 sm:p-5" : "max-w-7xl p-4 sm:p-6 lg:p-8")}>
              {!noControle && !larguraTotal && <AvisoVisitasBanner />}
              <TermoGate><Outlet /></TermoGate>
            </div>
          </main>
        </div>
      </div>
      <BuscaGlobal open={buscaAberta} onOpenChange={setBuscaAberta} />
    </div>
  );
}
