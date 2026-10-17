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
   Todos os segmentos têm Leads e Negócios (módulo `crm`, funis de exemplo em `SEGMENTOS[...]["funis"]`; barbearia e terapia ganharam em out/2026 pela migração `crm_em_todos_segmentos`).
   Menu de cada segmento (`AppShell.tsx`): Leads, Negócios, Pacientes/Clientes (atendimento),
   Agenda, Orçamentos, Contratos, depois Operação e Gestão. Item de interesse do negócio por segmento:
   `useItemSegmento()` (imóvel ou veículo; atendimento não tem). Leads: rodízio e fila livre
   (`repescar_leads` em `routers/crm.py`; quem pega primeiro fica, com `update_one` condicional).
   Sessão em grupo e controle de atendimento (`routers/sessoes.py`, tela /controle-atendimento nas clínicas): serviço com
   `capacidade` > 1 aceita vários pacientes (`agendamento.participantes`, `participantes_ids`); presença por paciente
   (só quem atende ou o gestor, só no dia ou depois); evolução ligada à sessão (`prontuario.agendamento_id`, uma por
   paciente e sessão, `no_prazo` = até 24 h depois do fim). `_atende` e a ficha olham `participantes_ids` também.
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
   `wa_estado.versao` a cada 8 s, só com a aba visível (cada leitura do Firestore conta na cota). Setores (`wa_setores`, nome livre e membros) e responsáveis por número
   (`responsaveis`, `setor_id` em `wa_conexoes`): número com setor ou responsáveis é restrito, só essas pessoas
   veem as conversas dele; número sem os dois é aberto (cada um vê as dele e as sem dono). Gestor vê tudo;
   conversa passada para alguém aparece para essa pessoa. Número de uma pessoa só: conversa nova já nasce dela
   (sem rodízio). Regra em `_acesso`/`_pode_ver`. Contato novo vira lead (origem WhatsApp) nos segmentos com
   Leads. Mídia (áudio, foto, vídeo, documento) não fica guardada: guardamos a mensagem crua (`midia.crua`, sem
   miniatura) e `/whatsapp/mensagens/{id}/midia` pede o arquivo à Evolution na hora (áudio em MP4 para tocar no
   Safari; sem ffmpeg no servidor, vai o original; limite ~4 MB do Vercel). Foto do contato em
   `/whatsapp/conversas/{id}/foto`, renovada uma vez por dia. Envio de áudio (gravado no navegador, vai como mensagem
   de voz) e arquivo (até 3 MB, o texto vira legenda) em `/whatsapp/conversas/{id}/midia`. Fluxos de resposta
   (`lib/wa_fluxos.py`, coleção `wa_fluxos`): passos mensagem, menu, transferir (pessoa, setor ou fila) e encerrar;
   gatilho conversa nova (um por número) ou palavra-chave. A conversa guarda `fluxo` enquanto espera o menu; quem da
   equipe responde para o robô. Transferir para setor grava `setor_id` na conversa e os membros passam a vê-la.
   Número pessoal: quem não é gestor conecta o próprio celular (`dono_pessoa_id`), só a pessoa e o gestor veem.
   Campanhas (`lib/wa_campanhas.py`, `routers/campanhas.py`, aba Campanhas, só gestor): público filtrado (clientes ou
   negócios; aniversário, sem movimento há N dias, funil, etapa, temperatura, etiqueta; por padrão só quem já conversou),
   fila `wa_campanha_envios` (`_id` campanha|ordem) com `cursor`, intervalo aleatório (mín. 20 s), teto por número e dia
   (`wa_envio_dia`), janela de horário. A fila anda em toques: tela aberta (15 s), cron diário e disparador externo
   `/api/publico/whatsapp/disparar/{token}` (endereço em Empresas > Pagamentos). Resposta SAIR grava `wa_optout` (chave
   DDD + 8 dígitos) e ninguém nessa lista recebe campanha. A tela do WhatsApp aberta (qualquer pessoa) chama
   `/whatsapp/campanhas/tique` a cada 20 s (no servidor, um toque a cada 15 s por empresa).
   Mensagens automáticas (`lib/wa_cadencia.py`, config em `wa_cadencia`): lembrete do dia seguinte (resposta 1 confirma,
   2 cancela e destrava; `conversa.confirmacao` vale 48 h), aniversário e retorno (prazo `servicos.retorno_dias`).
   `preparar_dia` roda uma vez por dia a partir das 8h (`WA_CADENCIA_HORA`; nos testes locais use 0 e `WA_CADENCIA_FIM=23:59`)
   e cria campanhas `sistema`; lembrete é `transacional` (fora do teto e do SAIR), não repete (`wa_cadencia_feitos`).
   Teste local: `tests/fake_evolution.py` na porta 8098.
11. **Segredos.** Nada de chave, senha ou `.env` no Git. No Vercel a única variável obrigatória é
   `FIREBASE_SERVICE_ACCOUNT`; o resto é gerado e guardado no banco (`lib/autoconfig.py`).
12. **Marca.** A tela de login é da plataforma: sempre a marca SAX, nunca a de um cliente (`/configuracoes/publica`
   sem sessão só usa a empresa com `?empresa=slug`). A logo da empresa vai na URL com `logo_v` (muda com o
   arquivo, fura o cache na hora). Upload de logo passa por `prepararImagem` (`lib/imagem.ts`): reduz e tira o
   fundo branco que encosta na borda. O cabeçalho mostra logo e nome da empresa; o menu da conta, CNPJ,
   segmento e plano. O nome da empresa é um só: `nome_software` do configurador e `controle.empresas.nome`
   andam juntos (trocar em um troca no outro). O login limpa título, cores e cache da última empresa.
13. **Administradores da plataforma** (`routers/administradores.py`, Empresas > Administradores). Equipe SAX
   (papel sysadmin em `controle.usuarios`), só no plano de controle. Conta nasce com senha aleatória e a pessoa
   define a dela pelo link de ativação (24 h, uso único). Desativar sobe `session_version` e derruba a sessão.
   O configurador do sistema (`config:read/write`) é só deles; gestor recebe 403.

## Texto da interface

- Português do Brasil, frases curtas, verbo no imperativo nos botões ("Salvar proprietário").
- Sem travessão (—) nos textos da tela e dos e-mails. Use vírgula, ponto ou dois-pontos.
- Mensagem de erro diz o que aconteceu e o que fazer, sem pedir desculpas.
- Identidade SAX: roxo `#4a03a2` e laranja `#ff7a00`, logo em `components/shared/MarcaSax.tsx`.
- Modo escuro preto com o laranja da logo SAX (#ff7a00) nos destaques, inclusive na barra lateral (preta). Cor primária e cores de menu da empresa só valem no claro.
- Segmento comércio (restaurante e doceria): cardápio no site (itens tipo produto), funis Revenda e Eventos e encomendas, lojas como unidades.
- Demonstrações (dados fictícios): `POST /plataforma/demos/pudim` (sem botão) e `POST /plataforma/demos/hamburgueria` ("[DEMO] Chapa Quente Hamburgueria", `lib/demo_hamburgueria.py`, botão em Empresas enquanto não existe; `GET /plataforma/demos`). Empresa com `demo_apresentacao` não pede o termo de adesão; "Apagar dados fictícios" vale para as duas.
- Afiliados e cashback (`lib/cashback.py`, tela /cashback, só no segmento comércio: rotas dão 404 nos outros): crédito por indicação e por compra, vale em todas as lojas, uso só em compras seguintes, FIFO por vencimento. Site: `?ref=CODIGO`, "Indique e ganhe" e balão de WhatsApp com um número por loja (conexões com `no_site`, senão o WhatsApp das Unidades).
- Importar planilha CRM Revendas (`lib/importar_revendas.py`, botão no card da empresa de comércio): nunca importa senha nem hash; cada usuário recebe link de ativação. Idempotente por `planilha_id`; lê o que existe uma vez e grava em lote (cabe nos 60 s do Vercel). Reimportar completa o que faltou; link novo só com `novos_links`.
- Rede de lojas (`lib/supervisoes.py`, `routers/supervisoes.py`): praça (cidade da loja) e supervisões com pixels. `usuarios.perfil` diretoria/gerentes = gestor; `supervisor` vê o dele, as supervisões dele, os líderes que acompanha e a praça sem supervisão (sem supervisão marcada, a praça toda) via `Principal.filtro_escopo`/`no_escopo`; `lider` só os cards dele. Negócio, lead e pedido guardam `praca`, `supervisao_id`, `unidade_id`. Lead do webhook com `pixel`/`localidade` é roteado por `rotear`.
- Etapa com cadeado (`lib/requisitos.py`, `etapa.requisito` contato/reuniao): o card só entra com atividade concluída e resultado não negativo; resultado positivo avança o card. Voltar sempre pode.
- Pedidos e comissões (`routers/pedidos.py`, tela /comissoes): pedido só em negócio ganho (registrar o pedido marca ganho), data não futura; % nos N primeiros pedidos do cliente; aprovada e paga ficam congeladas; ninguém aprova a própria (só diretoria); paga no dia X do mês seguinte.
- Prints (`routers/anexos.py`, coleção `anexos`, imagem até 900 KB reduzida no navegador): só quem anexou e perfis admin veem (nem o supervisor). `crm.print_obrigatorio` (ligado na 1ª importação da planilha): contato/reunião de negócio só conclui com print (`anexos` no POST/PATCH da atividade). Prints do Drive: a planilha cria `anexos_pendentes` (aba ANEXOS: ID e nome do arquivo) e o arquivo entra por `/plataforma/empresas/{id}/importar-print` (casa pelo nome ou ID).
- Edição em massa (`POST /leads/massa`, todos os segmentos): cada item é autorizado; o que fura área, cadeado ou regra volta em `falhas` sem travar os outros. Excluir pede "EXCLUIR"; no comércio só admin exclui.
- Fluxo do WhatsApp: editor em tela cheia com desenho (React Flow, `components/whatsapp/FluxoCanvas.tsx`), lista e teste na tela (`SimuladorFluxo.tsx`, mesmas regras de `lib/wa_fluxos.py`); `passo.pos` é só visual. Passo `link` (`lib/wa_links.py`): agenda online (da casa, de um profissional ou de quem o cliente citar), catálogo do site, um item ou URL livre; o endereço é montado na hora do envio e o texto aceita {link}, {nome}, {preco}. Gatilho `profissional`: a mensagem cita o nome de quem atende (primeiro nome repetido na equipe não vale sozinho). O que o cliente disse no fluxo segue junto pelo menu (`fluxo.texto`). WhatsApp está em todos os planos de todos os segmentos.
- Temperatura (`lib/temperatura.py`): lead e negócio quente, morno ou frio; em branco, sai da origem por `crm.regras_temperatura`; `crm.ordenar_por_temperatura` põe quente em cima, frio no fim (sem temperatura por último). Filtro e edição em massa nas telas.
- OLX na loja de veículos (`lib/olx.py`, `routers/olx.py`, botão "OLX Anúncios" no estoque): um aplicativo da SAX na OLX (client_id/secret em Empresas > Pagamentos ou `OLX_CLIENT_ID`/`OLX_CLIENT_SECRET`); cada loja conecta a conta profissional dela por OAuth (state de uso único, 15 min) e o token fica no banco da empresa, nunca na tela. Carro marcado (`veiculo.olx`: marca/modelo/versão do catálogo da OLX) vai pelo `/autoupload/import` (categoria 2020; o código VE-0001 é o id do anúncio; placa obrigatória em usado e nunca aparece). Envio no botão e no cron diário; vendido sai na hora. Leads da OLX entram em Leads (origem OLX, sem duplicar por `externalId`). Teste local: `tests/fake_olx.py` na porta 8099 com `OLX_AUTH_URL`/`OLX_API_URL`.
- Pesquisas e NPS (`lib/formularios.py`, `routers/formularios.py`, tela /pesquisas do gestor, permissão `pesquisa:gerir`, todos os segmentos): perguntas nps, nota, escolha, multipla, sim_nao, texto; link público `/f/{token}` (índice `form` em `links_publicos`) e link pessoal por convite (`form_convite`, uma resposta só). Nota baixa (NPS até `alerta_nota_ate`, estrelas 1 e 2) vira tarefa para `alerta_pessoa_id`. Um formulário pode ir sozinho pelo WhatsApp quando o atendimento é concluído (`apos_atendimento`, convite `ag-{id}`, não repete por `intervalo_dias`, respeita quem saiu). Campanha com `formulario_id` troca {link} pelo link pessoal. Com respostas, não muda o tipo de pergunta nem exclui.
- Importar e exportar dados (`lib/dados_planilha.py`, tela /dados do gestor e "Dados (planilha)" no card da empresa para o administrador): modelo .xlsx feito para o segmento e a empresa (clientes ou pacientes; leads e negócios onde há CRM, com funis, etapas e equipe), conferência antes de gravar, exportação no mesmo formato com "ID SAX" para reimportar sem duplicar.

## Como trabalhar em dupla

- Uma branch por tarefa (`feature/proprietarios`, `fix/dialogo-novo-lead`) e pull request para `main`.
  Não faça push direto na `main`: ela publica no Vercel.
- Puxe a `main` antes de começar (`git pull --rebase origin main`) para o Claude ler o código atual.
- Configuração compartilhada fica em `.claude/` e entra por pull request. Preferências pessoais vão em
  `.claude/settings.local.json` (ignorado pelo Git).
- Descreva no pull request o que mudou para o usuário e como testar. Se mexeu em regra deste arquivo,
  atualize o `CLAUDE.md` junto.
