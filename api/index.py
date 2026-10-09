"""Função Python do Vercel: expõe o backend FastAPI em /api/*.

O vercel.json reescreve /api/(.*) para esta função; o FastAPI recebe o caminho original
(/api/...) e roteia normalmente.
"""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))

from server import app  # noqa: E402,F401
