# SAX CRM (CedroNexxo) — CRM e ERP imobiliário

**Publicação no Vercel: siga [`DEPLOY_VERCEL.md`](DEPLOY_VERCEL.md).**

Aplicação React/TypeScript (Vite) com API FastAPI/Python e MongoDB/Motor. Cada empresa possui banco próprio; o banco de controle mantém empresas, administradores de sistema e o índice global de e-mails.

## Módulos implementados

- Imóveis e cadastro de pessoas.
- CRM estilo Pipedrive: caixa de entrada de leads, funis configuráveis, negócios com histórico, atividades e agenda da equipe (ver `CRM_PIPEDRIVE.md`).
- Assinatura eletrônica de contratos por link, com trilha de auditoria e PDF.
- Agenda de visitas e lembretes.
- Contratos de venda/locação e geração de parcelas de comissão/taxa de administração.
- Contas a receber/pagar, plano de contas, fluxo financeiro, relatórios e recibos PDF.
- Usuários, perfis, empresas, identidade visual e integração do site.

O financeiro registra comissões da imobiliária. Não equivale a uma apuração completa de repasses e pagamentos de comissão aos corretores. Tributos, assinatura qualificada (ICP-Brasil), emissão fiscal, conciliação bancária e contabilidade completa exigem módulos adicionais.

## Execução

Local: `pip install -r backend/requirements-dev.txt` e `cd frontend && npm ci`. API: `cd backend && uvicorn server:app --host 0.0.0.0 --port 8001`. Frontend: `cd frontend && npm run dev`. A UI usa `/api`, encaminhado ao backend pelo Vite/ingress.

Configurações de ambiente (não versionar valores secretos):

- `MONGO_URL`, `DB_NAME`, `JWT_SECRET`: conexão e sessões.
- `APP_ENV=producao`: ativa cookies HTTPS; configurar corretamente em produção.
- `APP_URL`: origem HTTPS real do ERP, usada nos convites e lembretes. Sem fallback para previews antigos.
- `CORS_ORIGINS`: origens explícitas separadas por vírgula; não aceita wildcard com credenciais.
- `APP_TZ`: padrão `America/Sao_Paulo`.
- `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, `EMAIL_REPLY_TO`: envio de e-mail pelo Resend (a antiga `EMERGENT_EMAIL_KEY` continua aceita).
- `BACKUP_ENCRYPTION_KEY`: chave Fernet válida, provisionada e guardada em cofre pelo operador. A perda da chave impede decifrar os backups.

## Garantias e operação

- As permissões são verificadas no servidor, incluindo os módulos ativos e os direitos explícitos da empresa. Os nomes comerciais dos planos ainda não definem quotas numéricas: essa política deve ser aprovada antes de implementada.
- Valores são arredondados em centavos; o rateio preserva o total. Um lead ganho não cria títulos. Contratos novos geram obrigações com identificadores determinísticos e chave de requisição.
- Falhas na geração deixam o contrato com status financeiro `erro`; a tela permite retomar. Parcelas já gravadas são reaproveitadas. Contratos legados exigem conciliação antes de qualquer reprocessamento.
- Valores e vigência de contratos são imutáveis após criação. Cancelamento preserva títulos e cancela os pendentes. Encerramento cancela somente pendentes futuros. Pagamentos existentes são preservados; estorno/aditivo formal não estão implementados.
- O e-mail entra em fila persistente `mail_jobs`; o worker faz claim exclusivo. Estado `uncertain` exige conferência no provedor antes de reenvio. Não há promessa de entrega exatamente uma vez; falhas ambíguas não são repetidas automaticamente.
- Convites/recuperação usam link de uso único por 24 horas, sem senha em e-mail. A alteração invalida sessões anteriores. `APP_URL` e o serviço de e-mail devem estar configurados para o fluxo funcionar.
- Backup/restauração requerem MongoDB replica set ou sharded cluster com suporte a transações. O backup é cifrado; a restauração é transacional e falha sem substituir parcialmente dados. Backups JSON antigos não são aceitos diretamente. A fila de e-mails não é restaurada, para evitar reenvios.
- Listas principais usam `offset`, `limit` e `X-Next-Offset`; a UI percorre todas as páginas. Relatórios não truncam silenciosamente; em bases grandes é necessário evoluir para agregações e carregamento progressivo.
- Webhook `POST /api/site/leads`: `X-API-Key` identifica a empresa; use `Idempotency-Key` estável em tentativas repetidas. Sem ela, o mesmo payload é deduplicado por dia UTC. Novos leads sem corretor aparecem na triagem do gestor.
- Logos novos: PNG/JPEG/WEBP de até 512 KB. SVG legado deve ser reenviado em um formato permitido.

## Verificação sem dados reais

Na raiz: `python -m pytest tests/test_integrity_regressions.py -q`. A suíte substitui conexão por um endpoint local inválido e usa mocks; não inicia o worker nem escreve nos bancos das empresas.

No frontend: `yarn typecheck`, `node tests/numbers.test.cjs` e `yarn build`.

`backend/audit_readonly.py` faz inventário de compatibilidade somente leitura e imprime contagens, sem credenciais nem registros pessoais. Seu caminho de `.env` é destinado ao ambiente `/app` da Emergent. Execute somente no ambiente que pretende verificar.

A publicação de produção e a conciliação de dados históricos são etapas separadas da atualização dos fontes. Consulte `CORRECOES.md` para cobertura, dependências e limites.
