"""Marca: a tela de login é da plataforma (nunca mostra a logo de um cliente) e a logo da empresa troca na hora
(URL com versão, sem esperar o cache do navegador). Precisa da API local."""

import base64
import io
import os

import httpx
import pytest

API = os.environ.get("CRM_API", "http://localhost:8001/api")


def _no_ar() -> bool:
    try:
        return httpx.get(f"{API}/configuracoes/publica", timeout=3).status_code == 200
    except httpx.HTTPError:
        return False


pytestmark = pytest.mark.skipif(not (_no_ar() and os.environ.get("CRM_SYSADMIN")), reason="API local fora do ar")


def _png(cor) -> str:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGBA", (40, 20), cor).save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


def test_login_sem_marca_de_cliente_e_logo_versionada():
    root = httpx.Client(base_url=API, timeout=30)
    assert root.post("/auth/login", json={"email": os.environ["CRM_SYSADMIN"], "senha": os.environ["CRM_SYSADMIN_SENHA"]}).status_code == 200
    gestor = httpx.Client(base_url=API, timeout=30)
    me = gestor.post("/auth/login", json={"email": os.environ["CRM_ADMIN"], "senha": os.environ["CRM_ADMIN_SENHA"]}).json()
    emp = {"X-Sax-Empresa": me["empresa_id"]}

    assert root.put("/configuracoes/logo", json={"base64": _png((200, 0, 0, 255)), "mime": "image/png"}, headers=emp).status_code == 200
    v1 = gestor.get("/configuracoes/publica").json()["logo_v"]
    assert root.put("/configuracoes/logo", json={"base64": _png((0, 0, 200, 0)), "mime": "image/png"}, headers=emp).status_code == 200
    v2 = gestor.get("/configuracoes/publica").json()["logo_v"]
    assert v1 and v2 and v1 != v2

    # Sem sessão e sem ?empresa=: nunca a identidade de um cliente, mesmo com uma empresa só na instalação.
    anonimo = httpx.get(f"{API}/configuracoes/publica").json()
    assert anonimo["nome_software"] != me["empresa_nome"] and anonimo.get("logo_v") != v2
    assert httpx.get(f"{API}/configuracoes/logo").status_code in (404, 200)
    assert httpx.get(f"{API}/configuracoes/logo").content != gestor.get("/configuracoes/logo").content

    # O CNPJ e o nome da empresa chegam na sessão para a tela mostrar.
    assert "empresa_cnpj" in gestor.get("/auth/me").json()


def test_nome_da_empresa_um_so_e_configurador_so_da_plataforma():
    root = httpx.Client(base_url=API, timeout=30)
    root.post("/auth/login", json={"email": os.environ["CRM_SYSADMIN"], "senha": os.environ["CRM_SYSADMIN_SENHA"]})
    gestor = httpx.Client(base_url=API, timeout=30)
    me = gestor.post("/auth/login", json={"email": os.environ["CRM_ADMIN"], "senha": os.environ["CRM_ADMIN_SENHA"]}).json()
    emp = {"X-Sax-Empresa": me["empresa_id"]}
    original = me["empresa_nome"]

    # Configurador: só a equipe da plataforma (gestor recebe 403 na leitura e na gravação).
    assert gestor.get("/configuracoes").status_code == 403
    assert gestor.put("/configuracoes", json={"nome_software": "Hackeado"}).status_code == 403

    # Trocar o nome no configurador da empresa reflete no painel Empresas e na sessão.
    assert root.put("/configuracoes", json={"nome_software": "Nome Novo Ltda"}, headers=emp).status_code == 200
    assert next(e for e in root.get("/empresas").json() if e["id"] == me["empresa_id"])["nome"] == "Nome Novo Ltda"
    assert gestor.get("/auth/me").json()["empresa_nome"] == "Nome Novo Ltda"
    # E o contrário: renomear no painel Empresas muda o nome do configurador.
    assert root.patch(f"/empresas/{me['empresa_id']}", json={"nome": original}).status_code == 200
    assert gestor.get("/configuracoes/publica").json()["nome_software"] == original


def test_administradores_da_plataforma():
    import uuid

    root = httpx.Client(base_url=API, timeout=30)
    root.post("/auth/login", json={"email": os.environ["CRM_SYSADMIN"], "senha": os.environ["CRM_SYSADMIN_SENHA"]})
    gestor = httpx.Client(base_url=API, timeout=30)
    me = gestor.post("/auth/login", json={"email": os.environ["CRM_ADMIN"], "senha": os.environ["CRM_ADMIN_SENHA"]}).json()

    assert gestor.get("/plataforma/administradores").status_code == 403
    assert gestor.post("/plataforma/administradores", json={"nome": "Intruso", "email": "x@exemplo.com"}).status_code == 403
    # Dentro de uma empresa (aba de suporte) não cria administrador global.
    assert root.post("/plataforma/administradores", json={"nome": "Aba Suporte", "email": "y@exemplo.com"},
                     headers={"X-Sax-Empresa": me["empresa_id"]}).status_code == 403
    # E-mail que já é de uma empresa não vira administrador.
    assert root.post("/plataforma/administradores", json={"nome": "Gestor", "email": os.environ["CRM_ADMIN"]}).status_code == 409

    email = f"thiago.{uuid.uuid4().hex[:6]}@exemplo.com"
    r = root.post("/plataforma/administradores", json={"nome": "Thiago Teste", "email": email})
    assert r.status_code == 201, r.text
    novo = r.json()
    assert novo["pendente"] and "/ativar-acesso#token=" in novo["link"] and "senha" not in r.text
    token = novo["link"].split("token=")[1]

    # Ele define a própria senha pelo link e entra como administrador da plataforma.
    assert httpx.post(f"{API}/auth/ativar", json={"token": token, "senha": "SenhaDoThiago#2026"}).status_code == 204
    t = httpx.Client(base_url=API, timeout=30)
    login = t.post("/auth/login", json={"email": email, "senha": "SenhaDoThiago#2026"})
    assert login.status_code == 200 and login.json()["papel"] == "sysadmin"
    assert t.get("/empresas").status_code == 200 and t.get("/configuracoes").status_code == 200
    assert not next(a for a in root.get("/plataforma/administradores").json() if a["id"] == novo["id"])["pendente"]

    # Desativar derruba a sessão na hora; não dá para desativar a si mesmo.
    eu = root.get("/auth/me").json()["usuario_id"]
    assert root.put(f"/plataforma/administradores/{eu}/ativo", json={"ativo": False}).status_code == 409
    assert root.put(f"/plataforma/administradores/{novo['id']}/ativo", json={"ativo": False}).status_code == 200
    assert t.get("/empresas").status_code == 401
