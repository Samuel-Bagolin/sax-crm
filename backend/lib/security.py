import hashlib
from datetime import timedelta
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
from lib.db import controle
from models.common import now_utc

class SecurityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        path = request.url.path
        publico_assinatura = path.startswith("/api/assinatura/") or (
            path.startswith("/api/publico/") and not path.startswith("/api/publico/foto/") and not path.endswith("/vrsync.xml"))
        if (request.method == "POST" and path in {"/api/auth/login", "/api/auth/recuperar", "/api/auth/ativar", "/api/site/leads"}) or publico_assinatura:
            # Trust only the socket peer, not attacker-provided forwarding headers.
            # Deployments may apply a finer client-IP limit at their trusted ingress.
            peer = request.client.host if request.client else "unknown"
            maximum = 300 if path == "/api/site/leads" else 120 if publico_assinatura else 60
            bucket = int(now_utc().timestamp()) // 60
            chave_path = ("/api/publico" if path.startswith("/api/publico/") else "/api/assinatura") if publico_assinatura else path
            key = hashlib.sha256(f"{chave_path}:{peer}:{bucket}".encode()).hexdigest()
            from pymongo import ReturnDocument
            hit = await controle.rate_limits.find_one_and_update({"_id": key},
                {"$inc": {"count": 1}, "$setOnInsert": {"expires": now_utc()+timedelta(minutes=5)}},
                upsert=True, return_document=ReturnDocument.AFTER)
            if hit["count"] > maximum:
                return JSONResponse({"detail": "Muitas tentativas; aguarde um minuto"}, status_code=429, headers={"Retry-After":"60"})
        response = await call_next(request)
        if path.startswith("/api/auth/") or request.cookies.get("imobierp_session"):
            response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        return response
