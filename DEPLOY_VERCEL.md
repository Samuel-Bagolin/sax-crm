# Publicar o SAX CRM no Vercel

Um único projeto no Vercel serve o site (React) e a API (FastAPI) no mesmo endereço. O site fica em `/`, a API em `/api/*`, e o login funciona porque o cookie é do próprio domínio. O banco fica no MongoDB Atlas e os e-mails saem pelo Resend.

Tempo estimado: 30 a 40 minutos na primeira vez.

## 1. Banco de dados: MongoDB Atlas (gratuito para começar)

**Jeito mais fácil (recomendado):** depois de criar o projeto no Vercel, abra **Storage → Create Database → MongoDB Atlas** (Marketplace), escolha o plano gratuito e conecte ao projeto `sax-crm`. O Vercel cria o banco, libera o acesso e grava a variável `MONGODB_URI` sozinho; o sistema já lê essa variável. Depois é só fazer **Redeploy**. Pule o restante desta seção.

**Jeito manual:**

1. Crie uma conta em https://www.mongodb.com/cloud/atlas e um cluster **M0 (Free)**. Escolha a região **São Paulo (sa-east-1)** se estiver disponível; senão, uma região dos EUA.
2. **Database Access** → Add New Database User → usuário e senha fortes (anote).
3. **Network Access** → Add IP Address → **Allow access from anywhere (0.0.0.0/0)**. O Vercel não tem IP fixo; a proteção fica por conta da senha do banco.
4. **Connect → Drivers** → copie a connection string, algo como
   `mongodb+srv://USUARIO:SENHA@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
   Esse é o `MONGO_URL`.

> O M0 tem 512 MB. Fotos de imóveis ficam no banco: com muitas imobiliárias, suba para um plano pago do Atlas ou mova fotos para armazenamento de objetos.

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

| Variável | Valor | Obrigatória |
|---|---|---|
| `MONGO_URL` | connection string do Atlas (dispensável se usou a integração do Vercel, que cria `MONGODB_URI`) | sim* |
| `DB_NAME` | `sax_crm` (padrão; prefixo dos bancos, não mude depois) | não |
| `JWT_SECRET` | texto aleatório com 64+ caracteres (assina as sessões) | sim |
| `APP_ENV` | `producao` | sim |
| `APP_URL` | `https://SEU-PROJETO.vercel.app` (troque pelo domínio próprio quando tiver) | sim |
| `CRON_SECRET` | texto aleatório (o Vercel usa para chamar a rotina diária) | sim |
| `ADMIN_INICIAL_EMAIL` | seu e-mail (vira o Administrador de Sistema no primeiro acesso) | só no 1º deploy |
| `ADMIN_INICIAL_SENHA` | senha com 10+ caracteres | só no 1º deploy |
| `ADMIN_INICIAL_NOME` | seu nome | opcional |
| `RESEND_API_KEY` | chave do Resend | sim, para e-mails |
| `EMAIL_FROM` | ex.: `crm@sax.com.br` | sim, para e-mails |
| `EMAIL_FROM_NAME` | `SAX CRM` | opcional |
| `EMAIL_REPLY_TO` | e-mail de resposta | opcional |
| `BACKUP_ENCRYPTION_KEY` | chave Fernet (44 caracteres). Guarde fora do Vercel também: sem ela, backups não abrem | para backups |
| `APP_TZ` | `America/Sao_Paulo` | opcional (padrão) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_API_KEY`, `GOOGLE_APP_ID`, `GOOGLE_TOKEN_KEY` | ver `CRM_PIPEDRIVE.md` (Etapa 8.2). Redirect URI: `https://SEU-DOMINIO/api/google/callback` | se usar Google |

Depois de entrar pela primeira vez com o administrador inicial, **apague `ADMIN_INICIAL_SENHA`** das variáveis e faça um redeploy.

## 5. Primeiro acesso

1. Abra `https://SEU-PROJETO.vercel.app` e entre com `ADMIN_INICIAL_EMAIL` / `ADMIN_INICIAL_SENHA`.
2. Em **Empresas → Nova empresa**, crie a imobiliária, escolha o plano e informe o gestor. Ele recebe o convite por e-mail (Resend).
3. Teste: crie um lead, um negócio, uma proposta e uma vitrine; abra o link da vitrine no celular.

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
| Backup por empresa | Funciona no Atlas (é replica set). Empresas grandes podem passar de 4,5 MB na resposta; nesse caso use os backups automáticos do Atlas. |
| Plano Hobby | É para uso pessoal/não comercial. Para vender o SAX CRM a imobiliárias, use o **Vercel Pro**. |

## Rodar localmente

```bash
pip install -r backend/requirements-dev.txt
cd backend && MONGO_URL=mongodb://localhost:27017 DB_NAME=sax_crm JWT_SECRET=dev-secret-com-32-caracteres-ou-mais uvicorn server:app --port 8001
cd frontend && yarn install && yarn dev   # http://localhost:3000, /api vai para a 8001
```
