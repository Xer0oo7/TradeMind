"""API router aggregation."""
from fastapi import APIRouter

from .v1.routes import router as negotiate_router
from .v1.auth_routes import router as auth_router
from .v1.product_routes import router as product_router
from .v1.chat_session_routes import router as chat_session_router
from .v1.apikey_routes import router as apikey_router
from .v1.email_routes import router as email_router
from .v1.translate_routes import router as translate_router
from ..assist.routes import router as assist_router
from ..meetings.routes import router as meetings_router


router = APIRouter()

router.include_router(negotiate_router)
router.include_router(auth_router)
router.include_router(product_router)
router.include_router(chat_session_router)
router.include_router(apikey_router)
router.include_router(email_router)
router.include_router(translate_router)
router.include_router(assist_router)
router.include_router(meetings_router)

__all__ = ["router"]
