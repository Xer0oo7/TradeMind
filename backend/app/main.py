"""
Negotiation Engine - FastAPI Application

This is the main application factory that creates and configures
the FastAPI application with all routes, middleware, and error handlers.
"""
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from contextlib import asynccontextmanager
import time
import hashlib
import structlog

from .core.config import get_settings
from .core.logging import setup_logging
from .api import (
    router,
    limiter,
    rate_limit_exceeded_handler,
    ErrorHandlerMiddleware,
    SecurityHeadersMiddleware,
    validation_exception_handler,
    http_exception_handler,
    value_error_handler,
)
from .analytics import analytics_router
from .infrastructure.database.session import close_pool as close_mysql_pool
from .call_feature import voice_router
from .peitho.routes import peitho_router

# Import competitive intelligence router from buisness anlytics module
import sys, os
_ba_path = os.path.join(os.path.dirname(__file__), "buisness anlytics")
if _ba_path not in sys.path:
    sys.path.insert(0, _ba_path)
from competitive_intelligence import competitive_router
from competitive_intelligence.market_comparison import market_comparison_router


setup_logging()
settings = get_settings()
logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    logger.info(
        "starting_application",
        env=settings.env,
        debug=settings.debug,
    )
    yield
    await close_mysql_pool()
    logger.info("shutting_down_application")


def create_app() -> FastAPI:
    """
    Application factory.
    
    Creates and configures the FastAPI application.
    """
    app = FastAPI(
        title="Peitho Negotiation Engine API",
        description="""
        A profit-aware negotiation engine for commercial use.
        
        ## Features
        
        - **MAX_PROFIT Mode**: Maximize seller profit with conservative concessions
        - **MIN_LOSS Mode**: Minimize loss when profit isn't achievable
        - **Deterministic Pricing**: Rule-based, auditable pricing decisions
        - **Constraint Enforcement**: Never violates seller-defined limits
        
        ## Architecture
        
        The engine uses a multi-agent architecture:
        1. **Context Analysis Agent**: Computes strategic posture
        2. **Pricing Strategy Agent**: Makes all numeric decisions (no LLM)
        3. **Conversation Agent**: Generates natural language responses
        
        ## Usage Flow
        
        1. Create session with product/inventory/strategy data
        2. Present initial offer to buyer
        3. Submit buyer's counter-offers
        4. Engine responds with accept/counter/reject
        5. Session closes when deal is made or constraints are violated
        """,
        version="1.0.0",
        docs_url="/docs" if settings.debug else None,
        redoc_url="/redoc" if settings.debug else None,
        lifespan=lifespan,
    )
    
    # Add rate limiter to app state
    app.state.limiter = limiter

    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        start = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            duration_ms = round((time.perf_counter() - start) * 1000, 2)
            # SECURITY: Hash client IPs in production to avoid PII in logs
            raw_ip = request.client.host if request.client else "unknown"
            client_ip = (
                hashlib.sha256(raw_ip.encode()).hexdigest()[:12]
                if settings.env == "production" else raw_ip
            )
            logger.exception(
                "request_failed",
                method=request.method,
                path=request.url.path,
                duration_ms=duration_ms,
                client_ip=client_ip,
            )
            raise

        duration_ms = round((time.perf_counter() - start) * 1000, 2)
        raw_ip = request.client.host if request.client else "unknown"
        client_ip = (
            hashlib.sha256(raw_ip.encode()).hexdigest()[:12]
            if settings.env == "production" else raw_ip
        )
        logger.info(
            "request_completed",
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            duration_ms=duration_ms,
            client_ip=client_ip,
        )
        return response
    
    # ==========================================================================
    # Middleware (order matters - last added = first executed)
    # ==========================================================================
    
    # Error handler middleware
    app.add_middleware(ErrorHandlerMiddleware)
    
    # Security headers middleware
    app.add_middleware(SecurityHeadersMiddleware)
    
    # CORS middleware — SECURITY: use configured origins, never wildcard with credentials
    allowed_origins = [
        origin.strip()
        for origin in settings.allowed_origins.split(",")
        if origin.strip()
    ]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
    )
    
    # ==========================================================================
    # Exception Handlers
    # ==========================================================================
    
    app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(ValueError, value_error_handler)
    
    # ==========================================================================
    # Routes
    # ==========================================================================
    
    app.include_router(router)
    app.include_router(analytics_router)
    app.include_router(competitive_router)
    app.include_router(market_comparison_router)
    app.include_router(voice_router)
    app.include_router(peitho_router)
    
    # Root endpoint
    @app.get("/", tags=["Root"])
    async def root():
        """Root endpoint with API info."""
        return {
            "name": "Peitho Negotiation Engine API",
            "version": "1.0.0",
            "docs": "/docs" if settings.debug else None,
            "health": "/api/v1/negotiate/health",
            "analytics": "/api/v1/analytics/calculate",
            "peitho": "/api/v1/peitho/health",
        }
    
    return app


# Create default app instance
app = create_app()
