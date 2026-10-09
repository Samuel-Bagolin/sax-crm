# Publicar o SAX CRM no Vercel

Um único projeto no Vercel serve o site (React) e a API (FastAPI) no mesmo endereço. O site fica em `/`, a API em `/api/*`, e o login funciona porque o cookie é do próprio domínio. O banco fica no Firebase Firestore e os e-mails saem pelo Resend.

Tempo estimado: 30 a 40 minutos na primeira vez.

## 1. Banco de dados: Firebase Firestore

O sistema usa o Firestore do projeto Firebase `sax-crm`. O login do CRM é o do próprio sistema (não usa o Firebase Authentication); o administrador é criado pelas variáveis `ADMIN_INICIAL_*`.

1. Firebase Console → projeto **sax-crm** → **Build → Firestore Database → Create database**.
   - Edição **Standard**, ID do banco `(default)`.
   - Local: **southamerica-east1 (São Paulo)**. Não dá para mudar depois.
   - Modo: **Production** (as regras bloqueiam o acesso direto pelo navegador; o servidor usa a conta de serviço e não depende das regras).
2. **Configurações do projeto (engrenagem) → Contas de serviço → Gerar nova chave privada**. Baixa um arquivo `.json`.
   - **Esse arquivo dá acesso total ao banco.** Não mande por e-mail/WhatsApp/chat, não suba no GitHub. Ele vai só para a variável `FIREBASE_SERVICE_ACCOUNT` no Vercel. Se vazar, apague a chave nessa mesma tela e gere outra.
3. **Plano Blaze + alerta de orçamento (recomendado antes de usar com clientes).** No plano gratuito (Spark) o limite é 50 mil leituras e 20 mil gravações por dia; passando disso o banco recusa requisições até o dia seguinte e o CRM para. No Blaze a cota grátis continua igual e só o excedente é cobrado. Em Google Cloud → Billing → **Budgets & alerts**, crie um alerta (ex.: R$ 50/mês).
4. Opcional: Firestore → **TTL** → política na coleção `rate_limits`, campo `expires` (a rotina diária já limpa esses registros; o TTL só adianta).

> Limite de 1 MiB por documento: fotos e PDFs grandes são divididos automaticamente em pedaços (coleção `_blobs`).
> O sistema também continua aceitando MongoDB (`MONGO_URL`/`MONGODB_URI`) se um dia quiser voltar; com `FIREBASE_SERVICE_ACCOUNT` preenchida, o Firestore tem prioridade.

## 2. E-mail: Resend

1. Crie a conta em https://resend.com e, em **Domains**, adicione o seu domínio (ex.: `sax.com.br`). Cadastre os registros DNS que ele mostrar.
2. **API Keys** → Create API Key (permissão "Sending access"). Esse é o `RESEND_API_KEY`.
3. `EMAIL_FROM` = um endereço desse domínio, ex.: `crm@sax.com.br`.

> Sem domínio verificado, o Resend só envia de `onboarding@resend.dev` e só para o seu próprio e-mail. Serve para testar, não para clientes.

## 3. Importar no Vercel

1. Vercel → **Add New → Project** → importe `Samuel-Bagolin/sax-crm`.
2. **Diretório raiz:** `./` (a raiz do repositório).
3. **Predefinição (Framework Preset):** **Other**. O arquivo `vercel.json` já define instalação, build, a função Python e as rotas.
   - Não use "Importar projeto único" no Back-end ou no Frontend separadamente; isso cria dois domínios e quebra o login.
   - Não use "serviços / multisserviço".
4. Abra **Environment Variables** e cadastre as variáveis da seção 4.
5. **Deploy.**

## 4. Variáveis de ambiente

**Só uma é obrigatória:** `FIREBASE_SERVICE_ACCOUNT` = o conteúdo inteiro do `.json` da conta de serviço (abra no bloco de notas, copie tudo, de `{` até `}`).

O resto o sistema resolve sozinho:

| O quê | Como fica automático | Para trocar (opcional) |
|---|---|---|
| Endereço e ambiente | lidos do próprio Vercel (`VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_ENV`) | `APP_URL`, `APP_ENV` |
| Segredos (sessão, rotina, Google, backup) | gerados no 1º acesso e guardados no banco (coleção `_sistema`, que só o servidor lê) | `JWT_SECRET`, `CRON_SECRET`, `GOOGLE_TOKEN_KEY`, `BACKUP_ENCRYPTION_KEY` |
| Primeiro administrador | o usuário `adm@sax.com.br` do Firebase Authentication, conferido no 1º login. Senha com menos de 12 caracteres obriga a troca na hora | `ADMIN_INICIAL_EMAIL` (outro e-mail do Firebase Auth) |
| Regras do Firestore e do Realtime Database | trancadas pelo servidor no 1º acesso (ninguém lê/grava direto pelo navegador) | — |
| Rotina diária (Vercel Cron) | aceita a chamada do Vercel Cron, no máximo a cada 20 min | `CRON_SECRET` |
| E-mails (convites, recuperação de senha) | desligados até configurar | `RESEND_API_KEY`, `EMAIL_FROM` |
| Google Agenda/Drive | desligado até configurar | ver `CRM_PIPEDRIVE.md` (Etapa 8.2) |

## 5. Primeiro acesso

1. Abra `https://SEU-PROJETO.vercel.app/api/status`: deve mostrar `"status":"ok"`, `"banco":"firestore"` e `"regras_firebase":"trancadas"`.
   `local_do_banco` deve combinar com a região do Vercel (`gru1` ↔ `southamerica-east1`; se o Firestore estiver nos EUA, troque `regions` em `vercel.json` para `iad1`).
2. Abra `https://SEU-PROJETO.vercel.app` e entre com o usuário do Firebase Authentication (`adm@sax.com.br` e a senha dele). Se a senha for fraca, o sistema pede uma nova (12+ caracteres) antes de liberar.
3. Em **Empresas → Nova empresa**, crie a imobiliária, escolha o plano e informe o gestor. Ele recebe o convite por e-mail (Resend).
4. Teste: crie um lead, um negócio, uma proposta e uma vitrine; abra o link da vitrine no celular.

## 6. Domínio próprio

Vercel → Project → **Settings → Domains** → adicione `crm.sax.com.br` e siga o DNS. Depois atualize `APP_URL` (e a redirect URI do Google, se usar) e faça redeploy.

## O que muda em relação a um servidor contínuo

| Assunto | No Vercel |
|---|---|
| E-mails (convites, assinatura, lembretes) | Enviados na hora, dentro da própria requisição. Se o Resend falhar, a rotina diária tenta de novo. |
| Rotina (negócio parado, lembretes de visita, fila de e-mail) | `GET /api/cron/rotina` pelo **Vercel Cron**. No plano **Hobby roda 1 vez por dia** (08:00 de Brasília). No **Pro** dá para mudar para a cada 10 min em `vercel.json` (`"schedule": "*/10 * * * *"`). |
| Google Agenda / avisos de imóvel compatível | Executados na própria requisição (o salvar fica ~0,5 s mais lento quando o Google está conectado). |
| Tamanho de arquivo | Limite do Vercel: 4,5 MB por envio. Documentos e anexos do chat aceitam até 4 MB; fotos vão uma por vez (o navegador já reduz). Arquivos maiores: pelo Google Drive ("Do Google Drive"). |
| Primeiro acesso após inatividade | A função "acorda" (1–3 s a mais na primeira chamada). |
| Backup por empresa | Funciona. Empresas grandes podem passar de 4,5 MB na resposta; para essas, ative o backup agendado do Firestore (Firestore → Disaster recovery). A restauração não é atômica no Firestore: restaure fora do horário de uso. |
| Banco indisponível | Abra `https://SEU-PROJETO.vercel.app/api/status`. Deve mostrar `"banco":"firestore"`; se der erro, a mensagem diz o motivo (chave inválida, Firestore não criado etc.). |
| Plano Hobby | É para uso pessoal/não comercial. Para vender o SAX CRM a imobiliárias, use o **Vercel Pro**. |

## Rodar localmente

```bash
pip install -r backend/requirements-dev.txt
cd backend && MONGO_URL=mongomock:// DB_NAME=sax_crm JWT_SECRET=dev-secret-com-32-caracteres-ou-mais uvicorn server:app --port 8001
cd frontend && yarn install && yarn dev   # http://localhost:3000, /api vai para a 8001
```
