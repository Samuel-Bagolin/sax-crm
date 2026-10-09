# CedroNexxo / SAX CRM — CRM estilo Pipedrive (Etapas 8 a 8.3)

Referência: 8 de outubro de 2026. Evolução do código existente (FastAPI + MongoDB + React). Login, multiempresa, financeiro e contratos foram preservados.

## O que mudou para o usuário

| Módulo | Antes | Agora |
|---|---|---|
| Leads | Lead entrava direto no funil | **Caixa de entrada** (`/leads`): contato não qualificado, WhatsApp/ligar/e-mail em 1 clique, atribuição, descarte com motivo, **Converter em negócio** |
| Negócios | Kanban fixo de 6 colunas | **Funis configuráveis** (`/crm`): etapas com probabilidade e alerta de "parado", valor por etapa, valor ponderado, arrastar para mover, zonas **Ganho/Perdido** ao arrastar, visão Quadro/Lista, filtro por corretor |
| Detalhe do negócio | Modal simples | Página própria (`/negocios/:id`): barra de etapas clicável, Ganho/Perdido/Reabrir, anotações fixáveis, próximos passos, visitas, histórico completo, **Gerar contrato** |
| Atividades | Não existiam | Ligação, WhatsApp, e-mail, reunião, visita, tarefa, prazo, almoço. Indicador no card (vermelho atrasada, verde hoje, amarelo sem próximo passo) |
| Agenda | Semana com visitas | Visões **Equipe** (colunas por corretor), Dia, Semana, Mês e Lista. O gestor vê a equipe e **clica no corretor para abrir a agenda dele** (`/agenda?corretor=<id>`) |
| Contratos | Sem assinatura | **Assinatura eletrônica por link**: documento gerado de modelo, signatários, envio por WhatsApp/link/e-mail, página pública `/assinar/<token>`, desenho ou nome digitado, CPF validado, trilha de auditoria e PDF final |
| Consultores | Tabela | Cartões com **foto** (enviar arquivo ou **tirar com a câmera**, com recorte), cor na agenda, CRECI, cargo, indicadores e atalho para a agenda |
| Configurar CRM | Não existia | Funis e etapas, origens, motivos de perda, etiquetas, distribuição (triagem ou **rodízio**), **modelos de contrato** com campos automáticos |
| Visão geral | KPIs | Bloco **Seu dia** (atrasadas/hoje com conclusão em 1 clique, leads sem contato, negócios sem próximo passo e parados) + ranking do mês |
| Global | — | Busca **Ctrl+K**, botão **Novo** (lead, negócio, atividade, imóvel, lançamento), menu recolhível, Meu perfil (`/perfil`) |

## Etapa 8.1: identidade SAX e indicadores do funil

- **Identidade SAX:** logotipo oficial vetorizado (SVG em `frontend/src/components/shared/MarcaSax.tsx`, nítido em qualquer tamanho), roxo da marca #4A03A2 no menu, no login e nos botões, laranja #FF7A00 no logotipo e nos destaques, fonte Plus Jakarta Sans, ícone da aba `public/sax-icon.svg` e título "SAX CRM". Empresas com logotipo próprio continuam exibindo o logotipo delas.
- **Mais Pipedrive:** menu em trilho de ícones com rótulo, "+ Negócio" e troca de visão à esquerda e filtros à direita, negócio parado com fundo avermelhado, quatro áreas ao arrastar (Excluir, Perdido, Ganho, Outro funil). Excluir pede confirmação e sugere "marcar como perdido".
- **Indicadores do funil (mesma regra do CRM Revendas):**
  - Faixa no quadro: em andamento, ponderado, ganhos do mês, conversão do mês, perdidos do mês e três alertas clicáveis que filtram o quadro (atividade atrasada, sem próximo passo, parados).
  - Página **Relatórios** (`/relatorios`): período por mês (12 meses), 30/90 dias ou tudo; KPIs em 4 colunas; funil em trapézios por **alcance** (voltar o card não muda o número); "Por que perdemos"; últimos 6 meses; tabelas por responsável e por origem. A regra de contagem aparece escrita na tela.
  - Visão geral: o antigo gráfico por estágio virou o "Funil do mês" em trapézios.
- Nova rota: `GET /api/relatorios/funil?funil_id&inicio&fim&corretor_id`. Novo campo `leads.etapas_alcancadas` (negócios antigos usam a etapa atual como alcance).
- Cor padrão de empresas novas passou a ser o roxo SAX; empresas com a cor antiga padrão também passam a ver o roxo (cores personalizadas são respeitadas).

## Etapa 8.2: Google Agenda, Google Drive e chat da equipe

**Google Agenda**
- Cada pessoa conecta a própria conta em **Meu perfil → Conectar conta Google** (OAuth com `state` assinado; o token de atualização fica criptografado com Fernet).
- Atividades e visitas criadas, remarcadas, concluídas ou excluídas no CRM vão para o Google Agenda do responsável, com lembrete, em segundo plano (não travam a tela). "Reenviar meus compromissos" refaz o envio sem duplicar.
- Na agenda do CRM, os compromissos pessoais do Google aparecem em cinza com o "G". Quando o gestor abre a agenda de um corretor, vê só blocos "Ocupado (Google)", sem título (consulta `freeBusy`).
- Cada pessoa pode desligar o envio ou a exibição em Meu perfil.

**Google Drive**
- Bloco **Documentos** no negócio e no contrato: arrastar arquivos, "Anexar" ou "Do Google Drive" (seletor oficial do Google).
- Com Google conectado, o arquivo vai para `SAX CRM/<nome do negócio>` no Drive de quem enviou (até 25 MB). Sem Google, fica guardado no CRM (até 8 MB) e pode ser copiado para o Drive depois.
- **Enviar ao cliente:** compartilha só leitura com o e-mail do cliente (o Google manda o e-mail com o link), ou envia o link por WhatsApp. O contrato assinado também pode ser salvo no Drive pelo painel de assinatura.
- Escopo `drive.file`: o CRM só enxerga arquivos que ele criou ou que a pessoa escolheu no seletor. Não lê o Drive inteiro.

**Chat da equipe** (`/chat`, item "Chat" no menu com contador de não lidas)
- Canal **Geral** com toda a equipe, conversas diretas (1 a 1) e grupos (ex.: plantão, lançamento).
- Citar um negócio na mensagem (vira um atalho clicável para o negócio), @menção destacada, anexar imagem ou PDF (até 5 MB), apagar a própria mensagem (o gestor pode apagar qualquer uma).
- Atualização por consulta periódica: mensagens a cada 3 s com a conversa aberta, lista a cada 8 s, contador do menu a cada 15 s.
- O diretório do chat (`GET /api/chat/pessoas`) mostra só nome e foto: o corretor continua sem ver telefone, e-mail ou indicadores dos colegas.

**Configuração do Google (feita uma vez pelo administrador)**
1. No Google Cloud Console, crie um projeto e ative **Google Calendar API**, **Google Drive API** e **Google Picker API**.
2. Tela de consentimento OAuth: tipo "Externo" (ou "Interno" se todos usam Google Workspace da mesma empresa), escopos `openid`, `email`, `calendar.events`, `calendar.readonly`, `drive.file`.
3. Credenciais → ID do cliente OAuth (Aplicativo da Web). URI de redirecionamento autorizado: `<APP_URL>/api/google/callback`. Origem JavaScript autorizada: `<APP_URL>`.
4. Credenciais → Chave de API (restrinja ao domínio do CRM e à Picker API).
5. No `backend/.env`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_API_KEY`, `GOOGLE_APP_ID` (número do projeto) e, recomendado, `GOOGLE_TOKEN_KEY` (chave Fernet própria; sem ela é derivada do `JWT_SECRET`, e trocar o `JWT_SECRET` obriga todos a reconectar). `APP_URL` precisa estar correto e em HTTPS. Opcional: `APP_TZ` (padrão `America/Sao_Paulo`).
6. Sem essas variáveis o sistema funciona normalmente: o cartão do Google mostra "Aguardando o administrador configurar" e os documentos ficam no CRM.

**Novas rotas:** `GET /api/google/status|conectar|callback|eventos|picker-token`, `POST /api/google/desconectar|sincronizar`, `PATCH /api/google/preferencias`; `GET /api/documentos`, `POST /api/documentos/upload|drive`, `GET /api/documentos/{id}/abrir`, `POST /api/documentos/{id}/enviar-drive|compartilhar`, `DELETE /api/documentos/{id}`, `POST /api/contratos/{id}/drive`; `GET /api/chat/conversas|nao-lidas|pessoas`, `POST /api/chat/diretas|canais`, `GET/POST /api/chat/conversas/{id}/mensagens`, `POST /api/chat/conversas/{id}/anexo`, `GET /api/chat/mensagens/{id}/anexo`, `DELETE /api/chat/mensagens/{id}`.

**Novas coleções por empresa:** `google_contas` (fora do backup de propósito: tokens não devem viajar em backup), `documentos`, `chat_conversas`, `chat_mensagens`, `chat_leituras`. Nenhuma dependência nova (httpx, cryptography e python-multipart já estavam no projeto).

## Etapa 8.3: diferenciais da pesquisa de mercado

Escolhidos a partir da pesquisa "CRMs para imobiliárias no Brasil" (out/2026). Os critérios foram o que a pesquisa marca como "Alta" ou como diferencial e que ainda não existia no sistema.

**1. Match cliente ↔ imóvel e vitrine para o cliente** (plano Profissional+)
- No negócio, o corretor registra o **perfil de busca**: compra ou locação, tipos, cidades, bairros, faixa de valor, quartos, vagas e área. Com um clique, o perfil pode ser montado a partir do imóvel de interesse.
- O bloco **Imóveis para este cliente** lista a carteira com nota de 0 a 100 e os motivos de cada nota ("Bairro Interlagos", "8% acima do orçamento"). A regra é explicável: tipo 25, localização 25, valor 25, quartos 15, vagas 5, área 5, com tolerância de 15% acima do teto.
- **Vitrine:** o corretor marca imóveis e envia um link (WhatsApp ou cópia). O cliente vê fotos e dados sem o endereço exato e responde "Gostei", "Não é pra mim" ou "Quero visitar". Cada resposta entra no histórico do negócio. "Quero visitar" já cria a atividade de agendar a visita.
- A ficha do imóvel mostra os **clientes com perfil compatível**. Quando entra um imóvel novo, ou um imóvel muda de valor ou status, os negócios com nota ≥ 75 recebem o aviso no histórico (uma vez por par negócio/imóvel).

**2. Automações e SLA de primeiro atendimento** (Profissional+)
- Regras do tipo "quando X, criar a atividade Y para o responsável em N dias". Gatilhos: lead novo, entrou na etapa, negócio parado (verificado a cada 10 min), ganho e perdido. As regras são idempotentes: a mesma regra não dispara duas vezes para o mesmo evento.
- Cada empresa recebe cinco regras padrão: primeiro contato com o lead, retomar negócio parado, confirmar visita, follow-up da proposta (2 dias) e pós-venda com pedido de indicação (30 dias).
- **SLA de primeiro atendimento** (padrão de 30 min): a caixa de Leads mostra "Responder em 12 min" ou "SLA estourado há 40 min". Contam como primeiro contato: marcar o lead como "em contato", concluir a atividade dele ou convertê-lo. Em Relatórios, o bloco **Velocidade de atendimento** mostra o tempo mediano, o % dentro do SLA e os leads aguardando, por responsável e por origem.

**3. Propostas e contrapropostas** (Profissional+)
- No negócio: valor, formas de pagamento (à vista, financiamento, FGTS, permuta, parcelado, consórcio), sinal, valor financiado, validade e condições. O desconto sobre o valor anunciado é calculado.
- A negociação aparece como cadeia (cliente → proprietário → cliente…), com aceitar, recusar, contraproposta, PDF e expiração automática pela validade.
- Registrar a proposta avança o negócio para a etapa "Proposta" (e dispara o follow-up). Aceitar atualiza o valor do negócio e oferece "Ganhar e gerar contrato".

**4. Portais: ZAP Imóveis, VivaReal e OLX** (Business+)
- No imóvel: "Publicar nos portais" e nível de destaque (padrão, destaque, super destaque).
- Em Configurar CRM → Portais: o **feed XML no padrão VRSync** e a **URL de recebimento de leads**, para cadastrar uma vez no painel do anunciante; a contagem do que está no feed; e o que falta em cada anúncio (vermelho = o portal recusa; amarelo = perde posição).
- Os leads dos portais caem na caixa de Leads já ligados ao imóvel (pelo código, ex.: CA-0002), com temperatura e canal. Reenvios não duplicam (`originLeadId`), e a distribuição e as automações valem normalmente.
- **Fotos do imóvel:** nova galeria na ficha. Dá para arrastar várias fotos, que o navegador reduz para 1600 px, reordenar, escolher a capa e excluir. As fotos são servidas por URL pública, que os portais e a vitrine usam.

**5. Relatório do proprietário** (Profissional+)
- Um link por imóvel, enviado pelo WhatsApp do proprietário. Ele mostra dias no mercado, visitas realizadas e agendadas (com o "retorno para o proprietário" que o corretor escreve na visita), clientes com perfil compatível, envios, interesse demonstrado, propostas recebidas e publicação em portais. Não mostra nome nem contato de clientes.

**6. Planos e limites (Fase 4 da pesquisa)**
- Catálogo em `backend/lib/planos.py`: Essencial R$ 99 (1 usuário, 300 imóveis), Profissional R$ 249 (5 usuários, 1.000 imóveis), Business R$ 499 (10 usuários, 3.000 imóveis, contratos, financeiro, portais e Google) e Enterprise R$ 999+ (sem limites). Os preços são a hipótese da pesquisa e podem ser editados no arquivo.
- Os limites valem de verdade: ao criar ou reativar um usuário e ao cadastrar um imóvel em carteira, o sistema bloqueia (HTTP 402) com uma mensagem clara. Os recursos fora do plano somem da tela e são bloqueados na API.
- O Administrador de Sistema escolhe o plano na criação da empresa e troca o plano no card dela, o que ajusta os módulos. O painel Empresas mostra a receita mensal, o ticket médio, as empresas no limite (oportunidade de upgrade) e as empresas sem plano.
- **Empresas que já existiam ficam como "Legado (sem limites)"** até alguém aplicar um plano. Nenhuma imobiliária em operação perde acesso na atualização.
- O gestor vê o próprio plano e o uso em Configurar CRM → Plano e no topo de Equipe.

**Novas rotas:** `GET/PUT /api/leads/{id}/perfil`, `GET /api/leads/{id}/compativeis`, `GET /api/imoveis/{id}/interessados`, `GET/POST /api/leads/{id}/vitrines`, `POST /api/vitrines/{id}/novo-link`, `DELETE /api/vitrines/{id}`; `GET/POST /api/leads/{id}/propostas`, `POST /api/propostas/{id}/responder|contraproposta|cancelar`, `GET /api/propostas/{id}/pdf`, `GET /api/imoveis/{id}/propostas`; `GET/POST/PUT/DELETE /api/imoveis/{id}/fotos…`; `GET /api/portais/config`, `POST /api/portais/novo-token`; `GET/POST/DELETE /api/imoveis/{id}/relatorio-proprietario`; `GET /api/relatorios/atendimento`; `GET /api/planos`, `GET /api/plano`. Rotas públicas (com limite de requisições, exceto fotos e feed): `/api/publico/vitrine/{token}`, `/api/publico/proprietario/{token}`, `/api/publico/portais/{token}/vrsync.xml|leads` e `/api/publico/foto/{id}`. Páginas públicas no front: `/vitrine/:token` e `/proprietario/:token`.

**Novas coleções:** `fotos_imovel`, `vitrines`, `propostas`, `match_avisos`, `automacoes_execucoes` (por empresa); `links_publicos` e `fotos_index` (banco de controle). Fotos, vitrines e propostas entram no backup, e a restauração reindexa as fotos. Nenhuma dependência nova.

## Como aplicar na Emergent

1. Copie os arquivos deste pacote por cima do projeto em `/app` (a lista está em `ARQUIVOS_ALTERADOS.txt`). Não sobrescreva `backend/.env` nem `frontend/.env`.
2. Os arquivos `frontend/src/pages/CrmFunil.tsx` e `frontend/src/components/crm/LeadModal.tsx` foram **removidos** (substituídos por `Negocios.tsx` e `NegocioModal.tsx`). Apague-os no `/app`.
3. Nenhuma dependência nova no backend nem no frontend. Reinicie backend e frontend.
4. Na subida, `garantir_crm_todas()` cria para cada empresa: funis padrão (Vendas e Locação), listas do CRM e migra os leads antigos (estágio antigo → etapa + status). É idempotente.
5. Para o e-mail com link de assinatura, `APP_URL` precisa ser HTTPS (mesma regra dos convites). WhatsApp e "copiar link" funcionam sem isso.
6. Homologue com os testes: `python -m pytest tests/test_integrity_regressions.py -q` (40 testes, sem banco) e, com a API no ar em homologação, `tests/test_crm_pipedrive.py` (variáveis no topo do arquivo; cria dados de teste).

## Compatibilidade preservada

- A coleção `leads` continua sendo o negócio. O campo `estagio` é mantido em sincronia, então contratos, dashboard e relatórios antigos continuam funcionando.
- O webhook `POST /api/site/leads` mantém o mesmo contrato, mas agora o contato cai na **caixa de entrada** (`entradas`) em vez de virar negócio direto.
- Ganhar um negócio continua **sem** lançar financeiro: quem gera os títulos é o contrato.
- O backup por empresa inclui as novas coleções; backups antigos (sem elas) continuam restauráveis.

## Novas rotas da API

- Funis: `GET/POST /api/funis`, `PUT/DELETE /api/funis/{id}`; `GET/PUT /api/crm/config`
- Leads (caixa de entrada): `GET/POST /api/entradas`, `PATCH/DELETE /api/entradas/{id}`, `POST /api/entradas/{id}/converter`
- Negócios: `GET /api/leads/kanban`, `GET /api/leads/{id}`, `POST /api/leads/{id}/mover|ganhar|perder|reabrir`, `GET /api/leads/{id}/historico`, notas em `/api/leads/{id}/notas`
- Atividades: `GET/POST /api/atividades`, `PATCH/DELETE /api/atividades/{id}` (filtros `inicio`, `fim`, `corretor_id`, `negocio_id`, `pendentes`)
- Equipe e busca: `GET /api/equipe`, `GET /api/busca?q=`
- Visitas: `GET /api/visitas` aceita `corretor_id` (gestor) e `lead_id`
- Fotos e perfil: `PUT/DELETE/GET /api/usuarios/{id}/foto`, `GET/PATCH /api/perfil`
- Assinatura: `GET /api/contratos/{id}/assinatura`, `POST .../documento/gerar`, `PUT .../documento`, `POST .../signatarios`, `POST .../signatarios/partes`, `DELETE .../signatarios/{sid}`, `POST .../signatarios/{sid}/novo-link|enviado|email`, `GET .../documento.pdf`
- Público (sem login, com limite de requisições): `GET /api/assinatura/{token}`, `POST .../assinar`, `POST .../recusar`, `GET .../pdf`, `GET .../logo`
- Modelos: `GET/POST /api/modelos-contrato`, `PUT/DELETE /api/modelos-contrato/{id}`, `GET /api/modelos-contrato/variaveis`

## Segurança e regras

- Corretor só vê os próprios negócios, leads, atividades e contratos (mesmo padrão 404 do sistema). Funis, listas e modelos só o gestor altera.
- O token do link é aleatório (24 bytes), indexado por SHA-256 no banco de controle, e nunca volta na página pública. "Gerar novo link" invalida o anterior.
- Depois da primeira assinatura o texto fica travado. Cada assinatura grava data/hora, IP, navegador, CPF informado e o hash SHA-256 do texto assinado.
- Fotos: só JPG/PNG/WEBP verificados pelo conteúdo, até 700 KB (o navegador já recorta e comprime para 512 px), guardadas em coleção separada para não pesar no login.

## Limites conhecidos (decisões a tomar)

- **Validade jurídica:** é assinatura eletrônica simples com trilha de auditoria. Serve para propostas, compromissos, locação e autorizações. Para exigências de assinatura qualificada (ICP-Brasil) ou registro em cartório, integrar um provedor (ZapSign, Clicksign, D4Sign). Os modelos de contrato são ponto de partida e devem ser revisados pelo jurídico.
- IP de auditoria: usa o último item de `X-Forwarded-For` (o que o ingress acrescenta). Se houver mais de um proxy na frente, ajuste em `routers/assinaturas.py::_ip`.
- Lembretes automáticos por e-mail continuam valendo para **visitas**; atividades ainda não disparam e-mail/WhatsApp.
- Envio de WhatsApp abre o app/wa.me com a mensagem pronta; envio automático exige a API oficial do WhatsApp (credenciais já previstas no configurador).
- Rodízio de leads usa "corretor ativo com menos leads atribuídos"; sem regras por região/turno.
- Kanban carrega todos os negócios abertos do funil: acima de alguns milhares por funil, paginar por etapa.
- **Google em produção:** os escopos de Agenda são "sensíveis". Com a tela de consentimento em modo Teste, só os e-mails cadastrados como testadores conseguem conectar (e o token expira em 7 dias). Para liberar para todos é preciso publicar o app e passar pela verificação do Google (política de privacidade e domínio verificado; leva de dias a semanas). Com Google Workspace e app "Interno", não há verificação.
- O sincronismo é do CRM para o Google. Compromissos criados direto no Google aparecem na agenda do CRM, mas não viram atividades.
- **Portais (validar antes de vender):** o feed segue a documentação pública do VRSync e o webhook de leads segue o formato documentado pelo Grupo OLX, mas não foram homologados com o portal (é preciso conta de anunciante). Faça um teste com 2 ou 3 imóveis no Canal Pro antes de liberar. `APP_URL` em HTTPS é obrigatório para as fotos aparecerem. A segurança do webhook é o token na URL; se vazar, use "Trocar endereços".
- **Fotos no MongoDB:** até 40 por imóvel, cerca de 300 KB cada depois da redução. Com centenas de imóveis, o banco cresce rápido (1.000 imóveis × 15 fotos ≈ 4,5 GB). O próximo passo natural é mover fotos e anexos para armazenamento de objetos (S3/GCS) com CDN.
- **SLA:** conta minutos corridos, sem horário comercial. Um lead que chega às 23h aparece como estourado de manhã. Se isso incomodar a operação, o próximo ajuste é o SLA por horário de atendimento.
- **Planos:** os preços são a hipótese da pesquisa, não preços validados com clientes. Não há cobrança automática (gateway): o plano controla limites e recursos, e o faturamento continua manual.
- **Chat:** atualização por consulta periódica (até 3 s de atraso), adequada para equipes de dezenas de pessoas. Para centenas de usuários simultâneos ou "digitando…", migrar para WebSocket. Anexos do chat e documentos sem Google ficam no MongoDB: acompanhe o tamanho do banco ou mova para armazenamento de objetos (S3/GCS) se o volume crescer.

## Verificação feita

- Backend: 64 testes passando: 40 de regressão existentes, 2 antigos de acesso/backup, 6 unitários de match/planos e 16 ponta a ponta do CRM (funis/RBAC, lead → negócio → atividade → histórico, isolamento do corretor, validação de foto, ciclo completo de assinatura com CPF inválido, dupla assinatura e trava do texto, funil por alcance, chat, documentos, Google, match/vitrine, propostas, portais, relatório do proprietário, automação/SLA e fotos). A automação de negócio parado foi testada à parte: cria uma vez e não repete.
- Frontend: `tsc` sem erros, `vite build` ok, 13 casos numéricos ok.
- Navegador (Chromium): telas de gestor e corretor em 1440 px e 390 px, tema claro e escuro, foto enviada e recortada, assinatura desenhada no celular e PDF final com página de assinaturas.
- Google: fluxo completo testado contra um simulador local da API do Google (OAuth, criação/atualização/remoção de eventos sem duplicar, freeBusy para o gestor, pasta por negócio no Drive, compartilhamento). **Não testado contra o Google real**, porque este ambiente não acessa a internet: valide em homologação com uma conta de teste antes de liberar.
- Chat: testes de canal geral, não lidas, conversa direta, bloqueio de anexo que não é imagem/PDF; telas em 1440 px e 390 px.
- Não testado: envio real de e-mail (depende de `APP_URL` e chave do provedor), MongoDB real (os testes locais usaram banco em memória).
