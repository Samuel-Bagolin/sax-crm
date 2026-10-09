# CedroNexxo — correções e próximos passos

Referência: 7 de outubro de 2026, horário de São Paulo. Projeto `/app`, no VS Code da Emergent informado pelo usuário.

## Estado atual

**Aplicado ao projeto em /app.** Foram atualizados 51 arquivos, com conferência SHA-256 antes e depois da cópia e recuperação em /app/cedronexxo_source_recovery.zip. A versão final passou em 40 testes do backend, 13 casos numéricos/CSV, TypeScript e build. Após reinício, a API respondeu 200 em /api/status; /api/auth/me respondeu 401 sem sessão, como esperado; o frontend respondeu 200. Backend e frontend estão RUNNING. Não foi realizado deploy de produção nem homologação autenticada ponta a ponta.

## Entrega

Esta intervenção corrige o aplicativo imobiliário existente. O código é FastAPI/MongoDB no backend e React/TypeScript/Vite no frontend. O site institucional e a implantação pública em produção não foram alterados por esta operação.

A atualização preserva arquivos de ambiente e mudanças pré-existentes. Cada arquivo alterado é comparado por SHA-256 com a cópia inicial antes da aplicação. Há cópia de recuperação dos fontes; não se deve confundi-la com backup dos bancos de clientes.

## Cobertura dos 25 achados

“Corrigido” abaixo descreve a implementação e as verificações realizadas; não significa certificação de ausência de outros defeitos nem teste integral de todas as integrações externas.

| ID | Resultado no código | Limites e pendências |
|---|---|---|
| C01 | Conversor único preserva decimal JSON e aceita formato brasileiro nos quatro formulários. | Casos numéricos testados. |
| C02 | Mover lead para ganho não cria comissão. O contrato gera títulos com chaves determinísticas. | Títulos históricos não foram apagados/recalculados. |
| C03 | Edição de leads e transações usa PATCH, conforme a API. | TypeScript e rotas verificados. |
| C04 | Reserva global de e-mail condicionada à empresa; conflito retorna 409 e não sobrescreve outro tenant. | Um usuário multivínculo ainda exige modelo próprio. |
| C05 | Credenciais demonstrativas removidas da tela de login. | Contas demonstrativas já existentes não foram desativadas nem tiveram senhas alteradas. |
| C06 | Contrato preservado no cancelamento; títulos pagos mantidos; pendentes cancelados conforme encerramento/cancelamento. Valores e vigência ficam protegidos contra edição inconsistente. | Aditivos e estorno formal são evolução funcional, ainda não implementados. |
| C07 | Pré-validação das contas; requisições idempotentes; títulos retomáveis; estado financeiro de erro e botão de retomada; exclusão mútua por contrato. | Não é transação única de criação. Falhas podem deixar estado pendente, recuperável. Contratos legados não são reprocessados automaticamente. |
| C08 | Rateio preserva centavos; vencimento não antecede início; vigência de 30 meses não vira 31 por igualdade do dia. | Calendário comercial/pró-rata exige regra específica. |
| C09 | Enums, datas/horas, valores finitos, percentuais, contagens, campos obrigatórios e referências validados. | Não é validação fiscal completa de CPF/CNPJ ou documentos. |
| C10 | Pagamento/status coerentes; taxas de administração excluídas do resumo de comissão; títulos liquidados protegidos. | Comissão da imobiliária não equivale a repasse ao corretor. |
| C11 | Módulos verificados na API, nas rotas React e nos direitos explícitos da empresa. | **Parcial:** planos comerciais ainda não impõem quotas numéricas. Limites/preços por plano não estavam definidos no material disponível. |
| C12 | Removidos tetos silenciosos; listas principais e histórico possuem paginação; UI percorre páginas; relatórios/backup não descartam registros pelo antigo teto. | **Parcial em escala:** agregações Mongo, exportação em lotes e UI incremental ainda são necessárias para bases grandes. |
| C13 | Restauração transacional; valida conteúdo e empresa; normaliza datas; reverte em falha. | **Bloqueado neste ambiente:** MongoDB atual não oferece transações. A rota recusa a operação antes de substituir dados. |
| C14 | Backup autenticado e cifrado; restauração recompõe índice de login e chave do site; invalida sessões/tokens anteriores. | **Bloqueado neste ambiente:** falta `BACKUP_ENCRYPTION_KEY`; backups JSON antigos requerem migração assistida. |
| C15 | Cookies seguros em produção/APP_URL HTTPS; versão de sessão; convites/recuperação por link único; senha anterior mantida até ativação. | Entrega real de e-mails não foi testada. Credenciais existentes não foram alteradas. |
| C16 | Limites persistentes por janela em login/ativação/recuperação/webhook; CORS sem wildcard com credenciais. | Aplicar limites de IP real também no ingress confiável; o limite interno usa o peer da conexão. |
| C17 | Novos logs mascaram token; resposta do histórico mascara registros antigos; SVG não é servido; upload valida PNG/JPEG/WEBP. | Tokens que já foram armazenados no histórico exigem rotação e tratamento operacional do histórico. Logo SVG legado deve ser reenviado. |
| C18 | Webhook idempotente, reaproveita pessoa por e-mail, usa IDs determinísticos; triagem visível para leads sem responsável. | Distribuição automática/rodízio/SLA não implementados. |
| C19 | Referências de visita respeitam o dono do lead; contatos e referências de pessoas restringidos à carteira/criação do corretor; diretório de corretores preserva nomes sem contatos privados. | Homologar a política comercial de compartilhamento de carteira. |
| C20 | Contadores atômicos substituem máximo+1; inicialização considera histórico. | Lacunas na numeração são permitidas; numeração fiscal não é objetivo. |
| C21 | Exclusões verificam vínculos adicionais; títulos pagos não podem ser apagados; cancelamento preserva lançamentos. | Operações complexas entre coleções ainda merecem testes concorrentes de integração. |
| C22 | Suíte persistida com 40 testes isolados do backend e 13 casos numéricos/CSV. | Não substitui testes E2E autenticados, carga, restauração real ou testes de envio. |
| C23 | Fila de e-mails persistente, claim exclusivo, chave de envio, estado ambíguo sem reenvio automático; URLs/branding corrigidos. | **Parcial operacional:** monitoramento, UI de fila e procedimento de reenvio após conferência do provedor ainda necessários. |
| C24 | CSV com aspas/escape e proteção contra fórmulas em campos textuais. | 4 cenários de CSV na suíte do frontend. |
| C25 | README refeito com arquitetura, configuração, testes, limites e operação reais. | O documento de análise anterior permanece como fotografia da versão original. |

## Validação

- 40 testes isolados do backend passaram, incluindo importação/OpenAPI, validação, arredondamento, retomada após falha, autorização, módulos, criptografia e proteção de títulos.
- 13 casos numéricos/CSV passaram no Node instalado.
- `yarn typecheck` passou.
- Build do frontend validado na cópia de testes com o `index.html` original. O primeiro ensaio falhou porque a cópia de análise não continha esse arquivo; o arquivo em uso não foi alterado.
- Preflight somente leitura: dois tenants ativos; nenhum registro incompatível com os modelos verificados, nenhuma duplicidade de lead em contratos ativos e nenhuma divergência status/pagamento detectada. Há dois contratos legados, preservados.
- Nenhum e-mail foi disparado pelos testes; nenhum registro de cliente foi criado, baixado financeiramente, excluído ou restaurado para validação.

O ambiente informa `APP_ENV=desenvolvimento`, `APP_URL` HTTPS e chave de e-mail presentes, MongoDB sem transações e chave de backup ausente. Não foram impressos ou exportados os valores secretos.

## Antes de produção

1. Configurar MongoDB com suporte transacional e chave de backup em cofre; testar backup e restauração em homologação, incluindo recuperação da chave.
2. Conciliar os dois contratos legados e possíveis comissões antigas antes de recalcular qualquer obrigação.
3. Conferir contas demonstrativas e rotacionar credenciais/tokens anteriormente expostos, pelo operador autorizado.
4. Homologar os três perfis, criação/baixa/cancelamento, recebimento idempotente do site e ativação por e-mail.
5. Aprovar módulos e quotas por plano; acrescentar observabilidade da fila e métricas de operação.
6. Publicar a versão validada pelo fluxo de deploy da Emergent. Atualizar os fontes do preview não comprova atualização de `www.cedronexxo.com`.

## Plano para evoluir o ERP

A base atual atende gestão imobiliária. Para o escopo CedroNexxo Gestão, CRM, Connect, Commerce, Web e Custom, a sequência recomendada continua sendo:

| Etapa | Funcionalidades | Critério para avançar |
|---|---|---|
| 1. Estabilização | Homologação das correções, restauração testada, conciliação histórica, monitoramento e testes de integração. | Operação recuperável e números conferidos. |
| 2. Plataforma comum | Clientes/empresas/filiais, usuários multivínculo, permissões por ação, auditoria consultável, documentos/anexos e planos com quotas. | Isolamento e regras de acesso testados por perfil/empresa. |
| 3. Gestão e financeiro | Propostas, pedidos/serviços, contratos/aditivos, contas/centros de custo, baixas parciais, estornos, conciliação e repasses. | Ciclo completo de proposta até recebimento e apuração. |
| 4. CRM | Pipelines configuráveis, tarefas/follow-up, distribuição/SLA, motivos de perda, histórico de interações e campanhas/consentimentos. | Captação rastreável até conversão, com responsável e próximo passo. |
| 5. Connect e Web | API versionada, webhooks com logs/replay, WhatsApp/e-mail, formulários e catálogo/portais integrados. | Integrações observáveis e reprocessáveis sem duplicação. |
| 6. Commerce | Catálogo, preço, orçamento/pedido, estoque/reservas quando aplicável, pagamentos e integrações fiscais. | Regra comercial/fiscal aprovada e transação conciliável. |
| 7. Custom e SaaS | Campos/fluxos configuráveis, verticais por segmento, assinatura/cobrança, onboarding e suporte auditado. | Segundo segmento funciona sem duplicar o núcleo. |

Não há estimativa fechada de prazo/custo sem detalhar o segmento inicial, regras financeiras/fiscais, integrações e critérios de aceite. A recomendação é consolidar primeiro CRM + Gestão Imobiliária e extrair o núcleo comum a partir dessa operação.
