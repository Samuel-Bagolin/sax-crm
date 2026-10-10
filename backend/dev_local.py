"""Ambiente local de desenvolvimento: o app real com banco em memória e dados de demonstração.

Uso (na pasta backend):
    uvicorn dev_local:app --port 8001 --reload

Logins de demonstração:
    Administrador de Sistema  root@cedronexxo.com / root12345
    Gestor da imobiliária     admin@imobierp.com  / admin123
    Corretor                  rafael@imobierp.com / corretor123

O banco some quando o processo para. Para testar contra o Firestore local, defina
FIRESTORE_EMULATOR_HOST e FIREBASE_PROJECT_ID antes de subir.
"""
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))
os.chdir(AQUI)
if not os.environ.get("FIRESTORE_EMULATOR_HOST"):
    os.environ.setdefault("MONGO_URL", "mongomock://")
os.environ.setdefault("APP_ENV", "desenvolvimento")
import server  # noqa: E402
from lib.auth import hash_senha
from lib.db import controle, definir_empresa, nome_banco_empresa, client
from lib.tenant import provisionar_empresa, indexar_usuario
from models.empresas import Empresa
from models.usuarios import Usuario
from models.common import now_utc

original = server.app.router.lifespan_context


async def bootstrap():
    if await controle.empresas.count_documents({}):
        return
    await controle.usuarios.insert_one(Usuario(nome="Samuel Admin", email="root@cedronexxo.com", senha_hash=hash_senha("root12345"), papel="sysadmin").model_dump())
    db_name = nome_banco_empresa("cedrodemo")
    emp = Empresa(nome="Cedro Imóveis", slug="cedrodemo", db_name=db_name)
    gestor = Usuario(nome="Gestor da Imobiliária", email="admin@imobierp.com", senha_hash=hash_senha("admin123"), papel="admin").model_dump()
    key = await provisionar_empresa(nome=emp.nome, db_name=db_name, admin=gestor)
    emp.site_api_key = key
    await controle.empresas.insert_one(emp.model_dump())
    definir_empresa(db_name)
    import seed
    seed.USUARIOS = [u for u in seed.USUARIOS if u["papel"] != "admin"]
    await client[db_name].imoveis.delete_many({})
    await client[db_name].plano_contas.delete_many({})
    await seed.main()
    async for u in client[db_name].usuarios.find({}):
        await indexar_usuario(u["email"], emp.id, db_name)
    from lib.crm import garantir_crm
    await garantir_crm(client[db_name])
    try:
        await client[db_name].entradas.drop_index("portal_lead")
    except Exception:
        pass
    await enriquecer(client[db_name], emp, db_name)
    pref = {"apartamento": "AP", "casa": "CA", "terreno": "TE", "comercial": "CM"}
    cont = {}
    async for im in client[db_name].imoveis.find({}):
        p = pref.get(im["tipo"], "IM"); cont[p] = cont.get(p, 0) + 1
        await client[db_name].imoveis.update_one({"id": im["id"]}, {"$set": {"codigo": f"{p}-{cont[p]:04d}", "estado": im.get("estado") or ("RJ" if im.get("cidade") == "Rio de Janeiro" else "SP")}})
    # Site da imobiliária de demonstração: /s/demo
    ativos = [im["id"] async for im in client[db_name].imoveis.find({"status": {"$nin": ["vendido", "alugado"]}}, {"id": 1})]
    for k, iid in enumerate(ativos):
        await client[db_name].imoveis.update_one({"id": iid}, {"$set": {"site_status": "reservado" if k == len(ativos) - 1 else "ativo", "site_destaque": k < 2}})
    await client[db_name].site_imobiliaria.update_one({"id": "singleton"}, {"$set": {
        "id": "singleton", "ativo": True, "slug": "demo", "nome": emp.nome, "whatsapp": "41999990000",
        "telefone": "(41) 3333-0000", "email": "contato@exemplo.com", "creci": "J-00000", "horario": "Seg. a sex., 9h às 18h",
        "sobre": "Imobiliária de demonstração do SAX CRM.", "cor_primaria": "#12355b", "cor_destaque": "#d4a017"}}, upsert=True)
    await controle.sites_index.delete_many({"_id": "demo"})
    await controle.sites_index.insert_one({"_id": "demo", "db_name": db_name})
    definir_empresa(None)
    print("DEV BOOTSTRAP OK")


async def enriquecer(b, emp, db_name):
    import random, uuid
    from datetime import datetime, timedelta, timezone
    from models.pessoas import Pessoa
    random.seed(7)
    hoje = datetime.now(timezone(timedelta(hours=-3))).date()
    d = lambda n: (hoje + timedelta(days=n)).isoformat()
    # terceiro corretor
    p = Pessoa(nome="Rafael Tavares", papeis=["corretor"], email="rafael@imobierp.com", telefone="(41) 99777-1212")
    await b.pessoas.insert_one(p.model_dump())
    u = Usuario(nome="Rafael Tavares", email="rafael@imobierp.com", senha_hash=hash_senha("corretor123"), papel="corretor", pessoa_id=p.id).model_dump()
    await b.usuarios.insert_one(u)
    await indexar_usuario(u["email"], emp.id, db_name)
    cores = {"Carlos Menezes": "#1f6f5c", "Patrícia Lopes": "#8a5a9e", "Rafael Tavares": "#c25b3f"}
    async for us in b.usuarios.find({"papel": "corretor"}):
        await b.usuarios.update_one({"id": us["id"]}, {"$set": {"cor": cores.get(us["nome"]), "cargo": "Corretor de imóveis", "creci": f"F-{random.randint(10000,99999)}"}})
    corretores = [x["pessoa_id"] async for x in b.usuarios.find({"papel": "corretor"})]
    clientes = [x async for x in b.pessoas.find({"papeis": "cliente"})]
    imoveis = [x async for x in b.imoveis.find({})]
    funil = await b.funis.find_one({"padrao": True})
    # mais negócios para o quadro
    nomes = ["Família Ribeiro", "Dr. Henrique Alves", "Camila Nogueira", "Bruno e Letícia", "Investidor Grupo Sol", "Marina Kato", "Otávio Brandão", "Sílvia Moura"]
    for i, nome in enumerate(nomes):
        im = imoveis[i % len(imoveis)]
        et = funil["etapas"][i % len(funil["etapas"])]
        cl = Pessoa(nome=nome, papeis=["cliente"], telefone=f"(41) 9{random.randint(8000,9999)}-{random.randint(1000,9999)}", email=None)
        await b.pessoas.insert_one(cl.model_dump())
        await b.leads.insert_one({"id": str(uuid.uuid4()), "nome": f"{nome} — {im['titulo'][:28]}", "cliente_id": cl.id, "imovel_id": im["id"],
            "corretor_id": corretores[i % len(corretores)], "origem": random.choice(["Site", "WhatsApp", "Portal ZAP", "Indicação / Carteira"]),
            "estagio": "novo", "valor_estimado": float(im.get("valor_venda") or im.get("valor_aluguel") or 450000), "observacoes": None,
            "funil_id": funil["id"], "etapa_id": et["id"], "status": "aberto", "etapa_desde": datetime.now(timezone.utc) - timedelta(days=random.randint(0, 14)),
            "etiquetas": random.sample(["Quente", "Financiamento", "Investidor", "Primeiro imóvel"], k=random.randint(0, 1)),
            "created_at": datetime.now(timezone.utc) - timedelta(days=random.randint(5, 40)), "updated_at": datetime.now(timezone.utc), "closed_at": None})
    abertos = [x async for x in b.leads.find({"status": "aberto"})]
    tipos = ["ligacao", "whatsapp", "visita", "reuniao", "email", "tarefa"]
    horas = ["09:00", "10:30", "11:00", "14:00", "15:30", "17:00", None]
    for i, n in enumerate(abertos):
        if i % 4 == 3:
            continue  # alguns sem próximo passo (amarelo)
        off = [-2, -1, 0, 0, 1, 2, 3, 5][i % 8]
        t = tipos[i % len(tipos)]
        await b.atividades.insert_one({"id": str(uuid.uuid4()), "tipo": t, "assunto": {"ligacao": "Retornar ligação", "whatsapp": "Enviar opções no WhatsApp", "visita": "Visita ao imóvel", "reuniao": "Reunião de proposta", "email": "Enviar minuta", "tarefa": "Conferir documentação"}[t],
            "data": d(off), "hora": horas[i % len(horas)], "duracao_min": 60 if t in ("visita", "reuniao") else 30, "negocio_id": n["id"], "entrada_id": None,
            "pessoa_id": n.get("cliente_id"), "imovel_id": n.get("imovel_id"), "corretor_id": n.get("corretor_id"), "notas": None, "concluida": False,
            "concluida_em": None, "created_by": None, "created_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc)})
    for i in range(6):
        await b.visitas.insert_one({"id": str(uuid.uuid4()), "titulo": f"Visita {imoveis[i]['titulo'][:30]}", "data": d(i % 4), "hora": ["10:00", "13:30", "16:00", "11:30", "09:30", "18:00"][i],
            "duracao_min": 60, "lead_id": abertos[i]["id"], "imovel_id": imoveis[i]["id"], "cliente_id": abertos[i].get("cliente_id"), "corretor_id": corretores[i % len(corretores)],
            "local": imoveis[i]["endereco"], "observacoes": None, "status": "agendada", "lembrete_enviado_em": None, "lembrete_cliente_em": None,
            "created_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc)})
    # ganhos e perdas recentes para os indicadores
    motivos = ["Preço acima do orçamento", "Financiamento não aprovado", "Comprou com outra imobiliária", "Sem retorno do cliente", "Preço acima do orçamento"]
    abertos = [x async for x in b.leads.find({"status": "aberto"})]
    for i, n in enumerate(abertos[:9]):
        quando = datetime.now(timezone.utc) - timedelta(days=(i % 4) * 2)
        if i < 4:
            await b.leads.update_one({"id": n["id"]}, {"$set": {"status": "ganho", "estagio": "ganho", "closed_at": quando, "etapas_alcancadas": [e["id"] for e in funil["etapas"]]}})
        else:
            await b.leads.update_one({"id": n["id"]}, {"$set": {"status": "perdido", "estagio": "perdido", "closed_at": quando, "motivo_perda": motivos[i - 4]}})
    from models.crm import Entrada
    exemplos = [("Gustavo Pereira", "Site", "compra", "Tenho interesse no apartamento da Vila Mariana, aceita financiamento?"),
                ("Aline Duarte", "WhatsApp", "locacao", "Procuro 2 quartos perto do centro até R$ 3.500"),
                ("Roberto Lima", "Portal ZAP", "compra", "Quero agendar visita no sábado"),
                ("Fernanda Couto", "Instagram / Facebook Ads", "venda", "Quero avaliar meu apartamento para vender"),
                ("Leandro Sato", "Site", "compra", None)]
    for i, (nome, origem, interesse, msg) in enumerate(exemplos):
        e = Entrada(nome=nome, telefone=f"(41) 9{8000+i*37}-{1000+i*111}", email=f"{nome.split()[0].lower()}@email.com", origem=origem, interesse=interesse, mensagem=msg,
                    imovel_id=imoveis[i]["id"] if interesse == "compra" else None, corretor_id=corretores[i % 3] if i % 2 else None, valor_estimado=None)
        doc = e.model_dump(); doc["created_at"] = datetime.now(timezone.utc) - timedelta(hours=i * 7 + 1)
        await b.entradas.insert_one(doc)


@asynccontextmanager
async def lifespan(app):
    async with original(app):
        await bootstrap()
        async for e in controle.empresas.find({}):
            try:
                await client[e["db_name"]].contratos.drop_index("active_lead_unique")
            except Exception:
                pass
        yield

server.app.router.lifespan_context = lifespan
app = server.app
