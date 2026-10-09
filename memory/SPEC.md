# ImobiERP Lite — Especificação viva do app

Sistema de gestão imobiliária (CRM + Financeiro + Operações) para imobiliárias iniciantes e
corretores autônomos. Interface 100% em **português (pt-BR)**, moeda BRL, datas dd/MM/yyyy.

## Stack (decisão do agente, ratificada pelo usuário)
O usuário pediu Node/Express/Prisma/PostgreSQL no enunciado, mas ao ser perguntado respondeu:
*"me oriente com o que tiver a melhor tecnologia gratuita e tenha manutenção mais simples, pode
seguir sempre com sua sugestão sem perguntar novamente sobre tecnologias"*. Mantivemos a stack do
template do pod: **FastAPI (monolito modular) + MongoDB (motor)** no backend e **Vite + React 19 +
TypeScript strict + Tailwind v4 + shadcn/ui (base-ui) + TanStack Query + Recharts** no frontend.
Não há login/auth no MVP (decisão de escopo — app de uso único/corretório).

## Domínios (Monolito Modular — um router por domínio, tudo sob `/api`)
- `routers/pessoas.py` — `/api/pessoas`: cadastro único universal (Pessoa com `papeis` contextuais:
  cliente | corretor | proprietario). CRUD com exclusão protegida (409 se referenciada).
- `routers/imoveis.py` — `/api/imoveis`: CRUD + `GET /api/imoveis/{id}` (ficha completa: imóvel +
  proprietário + leads + transações). Status: captado | publicado | vendido | alugado.
- `routers/leads.py` — `/api/leads` (CRM): CRUD parcial (PATCH muda estágio), `GET /api/leads/metricas`
  (tempo médio de fechamento, taxa de conversão, leads por estágio, origem). Estágios: novo,
  atendimento, visita, proposta, ganho, perdido.
  **Regra de negócio central**: lead movido para `ganho` → backend gera automaticamente uma
  TransacaoFinanceira "a receber" (comissão de 5% do valor estimado, plano de contas 1.1.1 venda /
  1.1.2 locação) e atualiza o status do imóvel (finalidade venda → vendido; locação/ambos → alugado).
- `routers/financeiro.py` — `/api/plano-contas` (hierárquico via `conta_pai_id`, código tipo 1.1.1),
  `/api/transacoes` (contas a pagar/receber; `vencido` calculado no servidor), `/api/resumo`
  (fluxo de caixa de 6 meses + DRE Receita vs Despesa por Imóvel).

## Modelo de dados (Mongo, ids uuid4 string)
`pessoas`, `imoveis`, `leads`, `plano_contas`, `transacoes` — espelhos TS em
`frontend/src/lib/types.ts` (manter em sincronia). Datas de vencimento/pagamento são strings
ISO YYYY-MM-DD; timestamps são datetime aware UTC.

## Frontend
- Shell: `components/layout/AppShell.tsx` (sidebar escura + header com ações rápidas `?novo=1`).
- Páginas: `/` Dashboard (KPIs, fluxo de caixa, origem dos leads, funil, imóveis), `/imoveis`
  (tabela/cartões, busca, filtros, ficha completa em Sheet), `/crm` (Kanban 6 colunas com
  drag-and-drop HTML5 + métricas), `/financeiro` (tabs Lançamentos / Plano de Contas / Relatórios
  com DRE + export CSV).
- Tema: Manrope (títulos), IBM Plex Sans (corpo), IBM Plex Mono (valores); claro/escuro com toggle.

## Seed (idempotente) — `cd /app/backend && python seed.py`
12 pessoas, 17 contas (3 níveis), 8 imóveis (SP/RJ/SC/PR/RS, statuses variados), 12 leads
(2 ganhos com tempo de fechamento 22/24 dias), 25 lançamentos espalhados nos últimos 6 meses
(comissões recebidas, taxa de administração mensal, aluguel de escritório, marketing, IPTU,
condomínio, manutenção — um anúncio vencido de propósito).

## Credenciais
Nenhuma — o app não tem autenticação (ver `memory/test_credentials.md`).

## Autenticação e perfis (Etapa 1 — implementada)
Cookie **httpOnly + JWT** (`imobierp_session`), rotas em `/api/auth/*`. Modelo de autorização:
**RBAC + ownership**, UMA imobiliária (sem multi-tenancy, sem `tenant_id`).

- `backend/lib/auth.py` é a única fonte de decisão: `authorize(principal, action, resource)`,
  `require("acao")` como dependência de rota e `filtro_do_principal()` que compila a
  visibilidade em **predicado de query** (nunca busca-e-filtra depois).
- O principal é derivado do token + **releitura do usuário no banco a cada request** — desativar
  um corretor corta o acesso imediatamente.
- Papel vive em `usuarios` (nunca nos documentos de domínio). `usuarios.pessoa_id` liga a conta
  à Pessoa que carrega a carteira; `leads.corretor_id` e `transacoes.corretor_id` são o dono.
- **Admin**: tudo (todos os leads, financeiro da casa, plano de contas, usuários).
- **Corretor**: imóveis todos (criar/editar), apenas os **próprios** leads e comissões; fluxo de
  caixa, DRE, plano de contas (escrita) e usuários são negados.
- Códigos: **401** sem sessão · **403** pode ver mas não pode agir (papel) · **404** recurso de
  outro corretor (403 revelaria que existe).
- `corretor_id` é carimbado pelo servidor na criação do lead — o corpo da requisição é ignorado.
- Frontend: `lib/useAuth.ts`, `components/layout/RotaProtegida.tsx`, `pages/Login.tsx`,
  `pages/Usuarios.tsx`; logout sempre por `endSession()` (limpa o cache do react-query).

## Credenciais
Ver `memory/test_credentials.md` (admin@imobierp.com / admin123 e dois corretores).

## Agenda de Visitas (Etapa 2 — implementada)
- `backend/models/agenda.py` (Visita, VisitaCreate/Update, AvisoVisitas, LembreteResultado) e
  `backend/routers/agenda.py`: `GET /api/visitas?inicio&fim`, `GET /api/visitas/aviso`,
  `POST/PATCH/DELETE /api/visitas`, `POST /api/visitas/lembretes` (só admin) e
  `POST /api/cron/lembretes-visitas` (cron da plataforma, `Authorization: Bearer WEBHOOK_CRON_SECRET`).
- RBAC: ações `visita:read` / `visita:write`; `corretor_id` (pessoa_id) é o dono, carimbado pelo
  servidor para corretor; `filtro_do_principal(..., "visitas")` isola a query. Admin vê tudo.
- Aviso do dia anterior: banner `components/agenda/AvisoVisitasBanner.tsx` no AppShell (hoje + amanhã,
  revalida a cada 5 min) **e e-mail** ao corretor via integração gerenciada Resend (`backend/lib/email.py`,
  com o gate `_assert_safe_email`). Destinatário vem de `usuarios.email` pelo `pessoa_id` (nunca do cliente).
- Cron: `.emergent/crons.yml` → todo dia 18:00 America/Sao_Paulo; o endpoint só ACK + BackgroundTask.
  Idempotência pela marca `visitas.lembrete_enviado_em` (remarcar a data limpa a marca).
- Frontend: `/agenda` (`pages/Agenda.tsx`) calendário semanal de 7 colunas com navegação de semana +
  `components/agenda/VisitaModal.tsx` (criar/editar/excluir). Datas de hoje/amanhã vêm do servidor (APP_TZ).
- Limitação: os e-mails dos corretores seedados são fictícios (@imobierp.com) e o provedor bloqueia
  destinatário indeliverável — cadastre e-mails reais em Consultores para os lembretes chegarem.

## Contratos (Etapa 3 — implementada)
- `backend/models/contratos.py` + `backend/routers/contratos.py`: `GET /api/contratos`,
  `GET /api/contratos/{id}` (detalhe com partes e parcelas), `POST /api/contratos`,
  `PATCH` e `DELETE` (admin).
- RBAC: `contrato:read`/`contrato:create` para corretor (só o próprio lead ganho e os próprios
  contratos); `contrato:update`/`contrato:delete` só admin. Lead fora de `ganho` → 409; lead já
  contratado → 409; locação sem `fim` → 422.
- Geração financeira automática (`_gerar_parcelas`): venda → N parcelas de comissão (`comissao_pct`,
  plano 1.1.1); locação → taxa de administração mensal (`taxa_admin_pct`, plano 1.2.1) por mês de
  vigência + comissão de intermediação (plano 1.1.2) na 1ª parcela. `parcelas` pode ser informado
  pelo usuário; nulo = automático (venda 1, locação = meses da vigência). `dia_vencimento` define o dia.
- `transacoes.contrato_id` liga a parcela ao contrato. Encerrar/cancelar apaga as parcelas pendentes
  futuras; excluir apaga todas as pendentes.
- Numeração `CT-AAAA-0001` derivada do MAIOR número do ano (contar documentos duplicava após exclusão).
- Frontend: `/contratos` (`pages/Contratos.tsx`, tabela + Sheet de detalhe com parcelas) e
  `components/contratos/ContratoModal.tsx` (herda imóvel/cliente/valor do lead ganho escolhido).

## Lembrete de véspera para o cliente (Etapa 3)
`_lembretes_clientes()` em `routers/agenda.py` envia ao e-mail do cliente (cadastro de Pessoas) a
confirmação com horário, imóvel e local, no mesmo lote do cron das 18h; marca `visitas.lembrete_cliente_em`
(idempotente). A `VisitaModal` tem seletor de cliente mostrando quem tem e-mail.
WhatsApp/SMS **não** foi implementado — exigiria credenciais Twilio do usuário.

## Contrato na ficha do imóvel (Etapa 3)
`GET /api/imoveis/{id}` agora devolve `contrato_vigente` (resumo do contrato ativo: número, tipo,
vigência, cliente, corretor, total gerado, já recebido, parcelas pagas/total) e o rendimento do
imóvel: `rendimento_recebido`, `rendimento_a_receber`, `despesas_pagas` — tudo dentro da
visibilidade do principal (corretor só soma os lançamentos/contratos dele). Modelo
`ContratoVigente` em `models/imoveis.py`; UI no `PropertyDetailSheet.tsx` (card "Contrato vigente"
+ card de rendimento).

## Código exclusivo do imóvel
`imoveis.codigo` (ex.: `AP-0005`, `CA-0002`, `TE-0001`, `CM-0001`) é gerado pelo servidor em
`routers/imoveis.py::_proximo_codigo()` a partir do MAIOR código já emitido daquele prefixo de tipo;
índice **único** em `imoveis.codigo` (`lib/db.py`) é a garantia final. Nunca editável (fora de
`ImovelUpdate`) e estável mesmo se o tipo mudar. Os 8 imóveis seedados foram retroalimentados.
Aparece na tabela, nos cartões e na ficha, e a busca da página de imóveis aceita o código.

## Perfis (3 níveis) e Configurador do Sistema (Etapa 4)
- Papéis: **sysadmin** (Administrador de Sistema) > **admin** (gestor) > **corretor**.
  `Principal.is_admin` é True para admin e sysadmin (os filtros de ownership dão visão global aos
  dois); `is_sysadmin` libera `config:read`/`config:write`.
- `pode_conceder()`: sysadmin concede qualquer papel; admin só admin/corretor (403 ao tentar
  sysadmin). `_exige_sysadmin_para_alvo()` em `routers/usuarios.py` barra admin de alterar/excluir
  conta sysadmin (403) e o delete protege o último sysadmin ativo (409).
- `backend/models/config.py` + `routers/config.py` (documento único `configuracoes/singleton`):
  - `GET /api/configuracoes/publica` — **sem sessão** (a tela de login usa), sem segredos.
  - `GET|PUT /api/configuracoes` e `POST /api/configuracoes/api-key` — só sysadmin.
  - `POST /api/site/leads` — webhook do site autenticado por `X-API-Key` (compare_digest);
    cria Pessoa + Lead "novo", vinculando o imóvel pelo `codigo` quando informado.
  - Campos: nome_software, slogan, modulos_ativos (dashboard e usuarios são fixos), titulos_modulos,
    cor_painel/cor_fonte/cor_primaria, imagem_fundo_login, email_remetente_nome/email_resposta,
    whatsapp_numero/phone_id/token (**guardados, nada é enviado ainda**), site_url/site_api_key/
    site_webhook_ativo.
- `lib/email.py::_remetente()` lê nome do remetente e reply-to do configurador (env é só fallback).
- Frontend: `lib/useConfig.ts` (consulta pública), `pages/Configuracoes.tsx` (tabs Identidade /
  Módulos / Comunicação / Site), rota `/configuracoes` sob `RotaProtegida somenteSysadmin`,
  AppShell com nav dinâmica (módulos desligados desaparecem, títulos vêm da config) e tema
  aplicado via CSS vars (`--card`, `--foreground`, `--primary`), Login usando nome/slogan/imagem.

## Logotipo, histórico da configuração e recibos em PDF (Etapa 5)
- **Logotipo**: `configuracoes.logo_base64`/`logo_mime` (máx. 512 KB; PNG/JPG/WEBP/SVG).
  `PUT|DELETE /api/configuracoes/logo` (sysadmin, base64 enviado pelo FileReader) e
  `GET /api/configuracoes/logo` **público** (os e-mails precisam de URL https absoluta — gate G3).
  `ConfiguracaoPublica.tem_logo` → `useConfig().logoUrl`; aparece no menu (`brand-logo`), no login e
  no topo dos e-mails (`_logo_html()` em `routers/agenda.py`).
- **Histórico**: coleção `config_logs` (campo, de, para, usuario, em). O `PUT /api/configuracoes`
  compara o estado anterior e grava uma linha por campo alterado (`ROTULOS_CAMPO` + `_texto()`);
  `GET /api/configuracoes/historico` (sysadmin) alimenta a aba "Histórico".
- **Recibos em PDF**: `lib/pdf.py::gerar_recibo()` (reportlab, pinado em requirements.txt) e
  `GET /api/transacoes/{id}/recibo` → `application/pdf` inline. Exige `status == "pago"` (409 se
  pendente) e passa por `authorize(...)`, então parcela de outro corretor responde 404. O PDF usa
  nome, cor primária e logotipo do configurador. Botão "Recibo" na lista de lançamentos
  (`LancamentosTab`) e em cada parcela paga no detalhe do contrato.

## Multiempresa (um banco por empresa) e ambientes (Etapa 6)
- **Isolamento físico**: `lib/db.py` virou proxy por request. `controle` = banco `DB_NAME`
  (registro `empresas`, contas sysadmin, `usuarios_index`); cada empresa tem banco
  `<DB_NAME>_t_<slug>`. `principal_atual()` lê `emp` do token e chama `definir_empresa(db_name)`
  (ContextVar) — os routers continuam usando `db.colecao` e **não existe query capaz de cruzar
  empresas**, porque o banco é escolhido fora do alcance do request.
- **Login multiempresa** (`routers/auth.py`): procura primeiro sysadmin no controle; senão resolve
  pelo `usuarios_index` (e-mail → empresa), valida a senha no banco da empresa e grava `emp` no
  token. Empresa desativada → 403.
- **Plano de controle** (`routers/empresas.py`, ação `empresa:manage`, só sysadmin):
  `GET /api/empresas` (com contadores), `POST` (provisiona banco + plano de contas + configuração +
  primeiro gestor via `lib/tenant.py`), `PATCH` (ativar/desativar), `DELETE?confirmar=<slug>`
  (dropa o banco), `POST /{id}/acessar` (token com a empresa = modo suporte) e `POST /sair`.
  `GET /api/empresas/ambiente` é público e alimenta a faixa de aviso.
- **Webhook do site**: a chave de API identifica a empresa no registro de controle
  (`empresas.site_api_key`, espelhada ao regerar) e fixa o banco antes de criar o lead.
- **Cron de lembretes**: percorre todas as empresas ativas, uma por vez, no banco de cada uma.
- **Config pública/logo**: com sessão usa a empresa do token; sem sessão, `?empresa=<slug>` ou a
  única empresa ativa.
- **Ambientes**: `APP_ENV` (desenvolvimento | homologacao | producao) em backend/.env; faixa
  laranja fixa fora de produção (`components/layout/FaixaAmbiente.tsx`) + faixa de suporte quando o
  sysadmin está dentro de uma empresa. Dados de demonstração são bloqueados em produção.
  Na plataforma: Preview = desenvolvimento (grátis), app publicado = produção (banco Atlas
  separado, 50 créditos/mês); Fork publicado serve como homologação; rollback de deploy disponível.
- **Migração**: `backend/migrar_para_empresa.py` moveu os dados existentes para a empresa
  CedroNexxo (`app_t_cedronexxo`); o controle guarda só empresas, sysadmins e o índice.
- Frontend: `pages/Empresas.tsx` (cartões com contadores, criar/ativar/excluir/entrar),
  `useAuth().noControle` esconde os módulos de negócio do sysadmin global.

## Convite do gestor, painel de uso e backup por empresa (Etapa 7)
- **Convite**: `EmpresaCreate.admin_senha` virou opcional — vazio gera senha provisória
  (`senha_provisoria()`, que regenera enquanto casar com `TERMOS_BLOQUEADOS` do gate de e-mail;
  "cvv" dentro de uma senha aleatória derrubava o envio) e dispara `enviar_convite_gestor()`
  (usuário + senha + link). `POST /api/empresas/{id}/reenviar-convite` redefine a senha do primeiro
  gestor ativo e reenvia. Criar a empresa nunca falha por causa do e-mail (`convite_enviado: bool`).
- **Painel de uso**: `GET /api/empresas/uso` e `/{id}/uso` (`UsoEmpresa`): usuários ativos/corretores,
  imóveis publicados, leads totais e dos últimos 30 dias, contratos ativos, visitas, lançamentos,
  receita contratada (parcelas de contrato), armazenamento em MB (`dbStats`) e último acesso
  (gravado em `empresas.ultimo_acesso` no login). Exibido no cartão da empresa (botão "Uso").
- **Backup/restauração**: `GET /api/empresas/{id}/backup` devolve JSON (anexo) com as 10 coleções do
  banco da empresa; `POST /api/empresas/{id}/restaurar` substitui as coleções, recusa backup de outra
  empresa (422), normaliza as datas ISO de volta para datetime (`_normalizar` + `utc_aware` agora
  aceita string) e reconstrói o `usuarios_index` para o login continuar funcionando.

## Roadmap acordado com o usuário
Etapa 1 ✅ login/perfis + isolamento. Etapa 2 ✅ agenda de visitas (calendário semanal + aviso no
dia anterior no sistema e por e-mail). Próximas: contratos formais, recibos em PDF no servidor.

## Armadilhas conhecidas deste código (não reintroduzir)
- **`DropdownMenuLabel` do base-ui exige estar dentro de `DropdownMenuGroup`** — usado solto
  lança em runtime "MenuGroupContext is missing" e derruba o menu inteiro (travou o logout).
  No `AppShell` o cabeçalho do menu de conta é uma `<div>` simples + separador manual.
  `DropdownMenuSeparator` solto é seguro.
- **Nunca use componente React recursivo** (um componente que se renderiza a si mesmo, ex.: uma
  árvore `LinhaNo` que chama `LinhaNo`): o plugin babel `visual-edits` do preview entra em loop e
  estoura a pilha ("Maximum call stack size exceeded"), derrubando a página inteira. A árvore do
  plano de contas é renderizada **achatada e iterativamente** (`achatar()` em `PlanoContasTab.tsx`).
- O ícone `Table` do lucide colide com o componente `Table` do shadcn — importe como `TableIcon`.
- `tempo_medio_fechamento_dias` considera apenas leads com estágio `ganho` (não os perdidos).

## Estado verificado (tier 1, 100% aprovado)
- Smoke da API: 28/28 checks (inclui 404/422 negativos e o ciclo lead→ganho→comissão→status do imóvel).
- `yarn typecheck`: limpo. Passada no navegador pela URL pública: aprovada, sem erros de console.

## CRM estilo Pipedrive (Etapa 8 — implementada)
Detalhes, rotas e passos de aplicação em `CRM_PIPEDRIVE.md`. Resumo técnico:
- Coleções novas por empresa: `funis` (etapas embutidas), `entradas` (caixa de entrada), `atividades`,
  `historico` (timeline/notas do negócio), `modelos_contrato`, `fotos_usuario`. No controle: `assinaturas_index`.
- `leads` = negócio; campos novos `funil_id`, `etapa_id`, `status` (aberto|ganho|perdido), `etapa_desde`,
  `motivo_perda`, `previsao_fechamento`, `etiquetas`, `entrada_id`. `estagio` legado sincronizado por
  `lib/crm.py::estagio_legado`. Migração idempotente no startup (`garantir_crm_todas`).
- Routers novos: `routers/crm.py` (funis, config, entradas, atividades, equipe, busca) e
  `routers/assinaturas.py` (documento, signatários, página pública, PDF, modelos).
- Fotos: `usuarios.tem_foto`/`foto_v` + bytes em `fotos_usuario` (fora do documento lido a cada request).
- Frontend: páginas `Negocios`, `NegocioDetalhe`, `Leads`, `Agenda` (equipe), `Usuarios` (cartões + foto),
  `Perfil`, `CrmConfig`, `Assinar` (pública). Tokens de cor em `index.css` (`--atrasada`, `--hoje`,
  `--sem-atividade`, `--latao`); fonte Instrument Sans + Lora no documento.
- `lib/db.py` aceita `MONGO_URL=mongomock://` apenas para testes locais sem servidor.
