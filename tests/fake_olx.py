"""Simulador da OLX para os testes (porta 8099): OAuth, catálogo de carros, importação de anúncios e configuração de leads.

Segue a documentação pública (developers.olx.com.br). Rode com:
  uvicorn fake_olx:app --port 8099 --app-dir tests
e suba a API com OLX_AUTH_URL=http://localhost:8099 OLX_API_URL=http://localhost:8099.
"""

from urllib.parse import urlencode

from fastapi import FastAPI, Form, Request
from fastapi.responses import JSONResponse, RedirectResponse

app = FastAPI()
ESTADO = {"importados": [], "leads": [], "codigos": {}}
TOKEN = "token-olx-teste"
MARCAS = {"FIAT": 30, "VOLKSWAGEN": 60}
MODELOS = {"30": {"ARGO": 301, "MOBI": 302}, "60": {"GOL": 601}}
VERSOES = {"30/301": {"1.0 DRIVE FLEX 4P MANUAL": 3011, "1.3 TREKKING FLEX 4P AUT": 3012}, "30/302": {"LIKE 1.0 FLEX 4P": 3021},
           "60/601": {"1.0 MI FLEX 4P": 6011}}


@app.get("/oauth")
def autorizar(client_id: str, redirect_uri: str, response_type: str, scope: str, state: str = ""):
    if response_type != "code" or "autoupload" not in scope:
        return RedirectResponse(f"{redirect_uri}?{urlencode({'error': 'invalid_scope', 'state': state})}")
    code = f"code-{len(ESTADO['codigos']) + 1}"
    ESTADO["codigos"][code] = client_id
    return RedirectResponse(f"{redirect_uri}?{urlencode({'code': code, 'state': state})}")


@app.post("/oauth/token")
def token(code: str = Form(...), client_id: str = Form(...), client_secret: str = Form(...), redirect_uri: str = Form(...),
          grant_type: str = Form(...)):
    if ESTADO["codigos"].pop(code, None) != client_id or client_secret != "segredo-teste" or grant_type != "authorization_code":
        return JSONResponse({"error": "invalid_grant"}, 400)
    return {"access_token": TOKEN, "token_type": "Bearer"}


async def _token(request: Request) -> dict | None:
    corpo = await request.json()
    return corpo if corpo.get("access_token") == TOKEN else None


@app.post("/oauth_api/basic_user_info")
async def conta(request: Request):
    if not await _token(request):
        return JSONResponse({}, 401)
    return {"user_name": "Loja Teste OLX", "user_email": "loja@olx-teste.exemplo.com"}


@app.post("/autoupload/car_info")
@app.post("/autoupload/car_info/{marca}")
@app.post("/autoupload/car_info/{marca}/{modelo}")
async def carros(request: Request, marca: str | None = None, modelo: str | None = None):
    if not await _token(request):
        return JSONResponse({}, 401)
    if modelo:
        return {"status": "ok", "data": VERSOES.get(f"{marca}/{modelo}", {})}
    if marca:
        return {"status": "ok", "data": MODELOS.get(marca, {})}
    return {"status": "ok", "data": MARCAS}


@app.put("/autoupload/import")
async def importar(request: Request):
    corpo = await request.json()
    if corpo.get("access_token") != TOKEN:
        return JSONResponse({"token": None, "statusCode": -6, "statusMessage": "Without permission", "errors": []})
    lista = corpo.get("ad_list") or []
    if not lista:
        return {"token": None, "statusCode": -3, "statusMessage": "There is no ad to import", "errors": []}
    erros = []
    for ad in lista:
        if ad.get("operation") == "delete":
            continue
        msgs = []
        if not ad.get("images"):
            msgs.append({"category": "NO_IMAGE"})
        if len(str(ad.get("zipcode") or "")) != 8:
            msgs.append({"category": "NO_REGION"})
        p = ad.get("params") or {}
        if str(p.get("vehicle_version")) not in {str(v) for d in VERSOES.values() for v in d.values()}:
            msgs.append({"category": "ERROR_VEHICLE_VERSION_INVALID"})
        if msgs:
            erros.append({"id": ad.get("id"), "status": "error", "messages": msgs})
    if erros:
        return {"token": None, "statusCode": -4, "statusMessage": "An ad had problems on import", "errors": erros}
    ESTADO["importados"].extend(lista)
    return {"token": f"imp-{len(ESTADO['importados'])}", "statusCode": 0, "statusMessage": "The ads were imported and will be processed", "errors": []}


@app.post("/autoservice/v1/lead")
async def lead_config(request: Request):
    if request.headers.get("authorization") != f"Bearer {TOKEN}":
        return JSONResponse({"error": "ACCESS_DENIED"}, 401)
    corpo = await request.json()
    ESTADO["leads"].append(corpo)
    return {"id": len(ESTADO["leads"]), "url": corpo.get("url"), "token": corpo.get("token")}


@app.get("/_teste/estado")
def estado():
    return ESTADO
