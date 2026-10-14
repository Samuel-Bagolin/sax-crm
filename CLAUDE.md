# SAX CRM

CRM vertical vendido como SaaS (SAX CRM): cada cliente é uma empresa com banco de dados próprio e um
segmento (imobiliária, loja de veículos, barbearia, clínica terapêutica, odontologia, estética).
Produção no Vercel, banco no Firebase Firestore, cobrança recorrente no Asaas.

Este arquivo é lido pelo Claude Code de qualquer pessoa do time ao abrir o projeto. Mantenha curto,
verdadeiro e atualizado: quando uma regra mudar, mude aqui no mesmo pull request.

## Mapa do projeto

- `backend/` FastAPI (Python 3.12). `server.py` monta tudo; um router por domínio em `routers/`;
  modelos Pydantic em `models/`; regras compartilhadas em `lib/`.
- `frontend/` React 19 + Vite + TypeScript + Tailwind v4 + TanStack Query. Páginas em `src/pages/`,
  componentes por domínio em `src/components/<dominio>/`, tipos em `src/lib/types.ts`.
- `api/index.py` entrada da função Python no Vercel. `vercel.json` define build, rotas e o cron diário.
- `tests/` testes unitários (rodam sem nada no ar) e de ponta a ponta (precisam da API local).
- Documentos: `DEPLOY_VERCEL.md` (publicar), `CRM_PIPEDRIVE.md` (funcionalidades do CRM).

## Rodar localmente

```bash
pip install -r backend/requirements-dev.txt
cd backend && uvicorn dev_local:app --port 8001 --reload     # banco em memória + dados de demonstração
cd frontend && yarn install && yarn dev                      # http://localhost:3000 (proxy /api -> 8001)
```

Logins de demonstração: `root@cedronexxo.com / root12345` (sistema), `admin@imobierp.com / admin123`
(gestor), `rafael@imobierp.com / corretor123` (corretor).

## Testes

```bash
cd backend
python -m pytest ../tests -q                                  # unitários; os de ponta a ponta são pulados
CRM_ADMIN=admin@imobierp.com CRM_ADMIN_SENHA=admin123 \
CRM_CORRETOR=rafael@imobierp.com CRM_CORRETOR_SENHA=corretor123 \
CRM_SYSADMIN=root@cedronexxo.com CRM_SYSADMIN_SENHA=root12345 \
python -m pytest ../tests -q                                  # tudo, com o dev_local no ar na 8001
cd ../frontend && node_modules/.bin/tsc -b && yarn build
```

Antes de abrir pull request: testes passando, `tsc` sem erro e `yarn build` ok.

## Regras que não podem quebrar

1. **Multiempresa.** A empresa vem do token de sessão (`lib/auth.py`), nunca de um campo enviado pela
   tela. Use `db` (banco da empresa do request) nas rotas; `controle` só para dados globais
   (empresas, administradores de sistema, catálogo de planos). Nenhuma consulta cruza empresas.
   Exceção única: o Administrador de Sistema entra numa empresa por aba (`src/lib/suporte.ts`), que
   manda o cabeçalho `X-Sax-Empresa` (ou `_emp` só em GET, para links e imagens). O cookie dele nunca
   guarda empresa, e `_principal_do_request` só aceita isso de sysadmin global. Links de arquivo da
   API na tela passam por `urlApi()`. Em suporte (`principal.suporte`) não se lê prontuário nem anamnese.
2. **Permissão por papel.** Toda rota declara a ação com `Depends(require("recurso:acao"))`. Os papéis e
   ações ficam em `PERMISSOES` (`lib/auth.py`). Corretor só vê o que é dele: use
   `filtro_do_principal`. Para recurso de outro corretor, responda 404 (não 403).
3. **Plano da empresa.** Funcionalidade paga passa por `exigir_recurso("chave")` no backend e
   `usePlano().tem("chave")` na tela. Limites de usuários e imóveis: `exigir_limite`. O catálogo de
   planos e adicionais é editável em Empresas e vive no banco de controle (`lib/planos.py`).
   Site próprio (`routers/site_imobiliaria.py`, recurso `site`, todos os segmentos e planos): só gestor
   ou usuário com `gerencia_site` (`principal.pode_site`) edita. Imobiliária e loja mostram o estoque;
   todos têm o catálogo `site_itens` (serviço, tratamento, produto; foto em `site_item_midia`). Textos de
   partida por segmento em `TEXTOS_SEGMENTO`. Contato do site só vira lead onde há caixa de leads
   (`COM_FORMULARIO`); nos outros o site manda para o WhatsApp e a agenda online.
   Domínio próprio (`lib/dominios.py`): `controle.dominios_index` liga host (www e raiz) ao banco da
   empresa; com token do Vercel (Empresas > Pagamentos ou `VERCEL_API_TOKEN`) o domínio entra sozinho
   no projeto. No navegador, `DominioProprio` (App.tsx) pergunta `/publico/site/dominio/{host}` e, se for
   site de cliente, mostra o site na raiz; links do site usam `raiz()` em `SitePublico.tsx`.
4. **Banco.** O código usa a API do Motor/MongoDB. Em produção ela roda sobre o Firestore por um
   adaptador (`lib/firestore_mongo.py`): documento até 1 MiB (campos grandes são divididos sozinhos),
   cada documento lido é cobrado, então evite varrer coleções inteiras em rotas chamadas a toda hora.
   Agregações (`aggregate`) não existem no adaptador: calcule em Python. O Firestore recusa lista dentro
   de lista (ex.: jornada `[["09:00","18:00"]]`); o adaptador guarda a lista interna como mapa e devolve
   como lista. O simulador dos testes (`tests/fake_firestore.py`) recusa igual ao Firestore real.
5. **Dinheiro e datas.** Valores em reais com 2 casas: use `percentage` e `split_money` de `lib/integrity.py` (nunca float solto em
   parcelas). Datas de vencimento são texto `AAAA-MM-DD`.
6. **Segmento.** O segmento vem da empresa (`lib/segmentos.py`, `principal.segmento`). Ele define
   módulos, termos da tela, funis, plano de contas e planos. Na tela use `useSegmento()`. Plano de um
   segmento não vale para outro. Rotas de agenda: `routers/atendimentos.py` e `agendar_publico.py`
   (travas em `agenda_travas`, nunca grave agendamento sem `travar`). Prontuário só para quem atende
   o paciente (`_atende` em `routers/pacientes.py`) e todo acesso fica registrado.
   Menu de cada segmento (`AppShell.tsx`): Leads, Negócios (vendas) ou Pacientes/Clientes (atendimento),
   Agenda, Orçamentos, Contratos, depois Operação e Gestão. Item de interesse do negócio por segmento:
   `useItemSegmento()` (imóvel ou veículo; atendimento não tem). Leads: rodízio e fila livre
   (`repescar_leads` em `routers/crm.py`; quem pega primeiro fica, com `update_one` condicional).
   Barbearia: clube de assinantes em `routers/clube.py` (mensalidade com id fixo por mês, não duplica).
   Texto de tela compartilhada nunca fixa "imóvel", "corretor" ou "imobiliária": use `useSegmento()`
   (`termos`, `empresa`, `registro`, `dominio`) e, no servidor, o segmento da empresa. Recursos do plano
   por segmento: `recursos_do_segmento` (`lib/planos.py`). A varredura em `tests/test_textos_segmento.py` cobre.
7. **Dinheiro lançado uma vez só.** Concluir atendimento, aprovar tratamento e vender veículo mudam o
   status com `update_one` condicional e só lançam no Financeiro se `modified_count == 1`.
   Contrato da loja de veículos (`veiculo_id` no lugar de `imovel_id`) registra a venda por
   `registrar_venda` em `routers/veiculos.py`; cancelado antes de receber, o carro volta ao estoque.
   Carro consignado (`consignado`, `consignante_id`, `repasse_valor`): `sincronizar_consignacao` mantém
   um contrato tipo `consignacao`; na venda o repasse vira conta a pagar (conta 2.4.4, id fixo, não
   duplica) e o dono entra como vendedor no contrato. Contrato criado a partir de um negócio puxa o
   produto (imóvel ou veículo) do negócio. Gestor e equipe têm `pessoa_id` (`garantir_pessoa_da_equipe`
   em `lib/tenant.py`) para poder ser responsável por negócio e contrato.
8. **Cartão e Asaas.** Número e CVV só passam pela memória a caminho do Asaas (`lib/asaas.py`): nunca
   gravar, logar ou devolver em erro. Guardamos final, bandeira e token. A chave do Asaas fica na tela
   Empresas > Pagamentos ou em `ASAAS_API_KEY`. O webhook (`/api/webhooks/asaas`) confere o token,
   é idempotente pelo id do evento e grava só campos `assinatura.*`. O cartão de demonstração
   (gerado em Empresas > Pagamentos) cria conta paga sem cobrança, só para o dono da plataforma testar.
   Links de pagamento dos planos (`lib/links_pagamento.py`, Empresas > Pagamentos): cartão no preço da
   tabela e Pix com 10% de desconto, recorrentes; gerados em lotes e idempotentes (preço mudou, troca o link).
9. **Termo de adesão.** Texto e versão em `lib/termo_aceite.py`, rotas em `routers/termo.py`. O gestor
   aceita no primeiro acesso (`TermoGate` no `AppShell`); suporte nunca aceita. O registro em
   `termos_aceite` (id `empresa:versao`) guarda texto integral, SHA-256, IP, navegador, nome, CPF e cargo,
   e não é alterado. Mudou uma vírgula do texto, suba `VERSAO`: todos aceitam de novo. Os dados da
   contratada ficam em Empresas > Pagamentos; sem eles o termo não é exigido. Comprovante em PDF na
   tela Assinatura (cliente) e no card da empresa (administrador).
10. **WhatsApp no CRM** (`lib/whatsapp.py`, `routers/whatsapp.py`, recurso `whatsapp`). Conexão não oficial
   por QR via Evolution API num servidor à parte (o Vercel não segura a sessão). Servidor e chave em
   Empresas > Pagamentos ou `EVOLUTION_URL`/`EVOLUTION_API_KEY`. `controle.whatsapp_instancias` liga a
   instância ao banco e guarda o token do webhook (`/api/webhooks/whatsapp/{token}`). Mensagem e conversa
   têm `_id` fixo (instância|id, instância|jid): webhook repetido não duplica. A tela consulta só
   `wa_estado.versao` a cada 4 s. Gestor vê tudo; corretor vê as dele e as sem responsável. Contato novo
   vira lead (origem WhatsApp) nos segmentos com Leads. Teste local: `tests/fake_evolution.py` na porta 8098.
11. **Segredos.** Nada de chave, senha ou `.env` no Git. No Vercel a única variável obrigatória é
   `FIREBASE_SERVICE_ACCOUNT`; o resto é gerado e guardado no banco (`lib/autoconfig.py`).

## Texto da interface

- Português do Brasil, frases curtas, verbo no imperativo nos botões ("Salvar proprietário").
- Sem travessão (—) nos textos da tela e dos e-mails. Use vírgula, ponto ou dois-pontos.
- Mensagem de erro diz o que aconteceu e o que fazer, sem pedir desculpas.
- Identidade SAX: roxo `#4a03a2` e laranja `#ff7a00`, logo em `components/shared/MarcaSax.tsx`.

## Como trabalhar em dupla

- Uma branch por tarefa (`feature/proprietarios`, `fix/dialogo-novo-lead`) e pull request para `main`.
  Não faça push direto na `main`: ela publica no Vercel.
- Puxe a `main` antes de começar (`git pull --rebase origin main`) para o Claude ler o código atual.
- Configuração compartilhada fica em `.claude/` e entra por pull request. Preferências pessoais vão em
  `.claude/settings.local.json` (ignorado pelo Git).
- Descreva no pull request o que mudou para o usuário e como testar. Se mexeu em regra deste arquivo,
  atualize o `CLAUDE.md` junto.
