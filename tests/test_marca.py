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
