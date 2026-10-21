"""
OpenRouter LLM Client

Provides access to multiple LLMs (GPT-4, Claude, Gemini, etc.)
through a single OpenRouter API endpoint.

This client is used ONLY for natural language generation.
It NEVER makes pricing or numeric decisions.
"""
import httpx
import structlog
import asyncio
import concurrent.futures
from typing import Optional, List, Dict, Any
from dataclasses import dataclass

from ...core.config import get_settings

logger = structlog.get_logger(__name__)

# Shared thread pool for sync→async bridging (reused across all LLM calls)
_sync_pool = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="llm_sync")



@dataclass
class LLMResponse:
    """Structured response from LLM."""
    content: str
    model: str
    tokens_used: int
    success: bool
    error: Optional[str] = None


class OpenRouterClient:
    """
    OpenRouter API client for LLM access.
    
    OpenRouter provides a unified API for 100+ models:
    - google/gemini-2.0-flash-001
    - openai/gpt-4o-mini
    - anthropic/claude-3.5-sonnet
    - meta-llama/llama-3.1-8b-instruct
    
    We use it ONLY for generating natural conversation text.
    All pricing decisions are made by the deterministic pricing agent.
    """
    
    
    BASE_URL = "https://openrouter.ai/api/v1/chat/completions"
    
    def __init__(self):
        settings = get_settings()
        self.api_key = settings.openrouter_api_key
        self.model = settings.openrouter_model
        self.max_tokens = settings.llm_max_tokens
        self.temperature = settings.llm_temperature
        self.timeout = settings.llm_timeout_seconds
        self.enabled = bool(self.api_key)
        
        if not self.enabled:
            logger.warning("openrouter_disabled", reason="No API key configured")
    
    async def generate(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: Optional[float] = None,
    ) -> LLMResponse:
        """
        Generate a response from the LLM.
        
        Returns LLMResponse with success=False if anything goes wrong.
        The caller should ALWAYS have a fallback.
        """
        if not self.enabled:
            return LLMResponse(
                content="",
                model="none",
                tokens_used=0,
                success=False,
                error="OpenRouter not configured",
            )
        
        try:
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://negotiation-engine.api",
                "X-Title": "Negotiation Engine",
            }
            
            payload = {
                "model": self.model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "max_tokens": self.max_tokens,
                "temperature": temperature or self.temperature,
            }
            
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    self.BASE_URL,
                    headers=headers,
                    json=payload,
                )
                response.raise_for_status()
                data = response.json()
            
            content = data["choices"][0]["message"]["content"].strip()
            tokens = data.get("usage", {}).get("total_tokens", 0)
            model_used = data.get("model", self.model)
            
            logger.info(
                "llm_response_generated",
                model=model_used,
                tokens=tokens,
                content_length=len(content),
            )
            
            
            return LLMResponse(
                content=content,
                model=model_used,
                tokens_used=tokens,
                success=True,
            )
        
        except httpx.TimeoutException:
            logger.warning("llm_timeout", model=self.model, timeout=self.timeout)
            return LLMResponse(
                content="",
                model=self.model,
                tokens_used=0,
                success=False,
                error="LLM request timed out",
            )
        
        except httpx.HTTPStatusError as e:
            logger.error(
                "llm_http_error",
                status=e.response.status_code,
                detail=e.response.text[:200],
            )
            return LLMResponse(
                content="",
                model=self.model,
                tokens_used=0,
                success=False,
                error=f"HTTP {e.response.status_code}",
            )
        
        except Exception as e:
            logger.error("llm_unexpected_error", error=str(e))
            return LLMResponse(
                content="",
                model=self.model,
                tokens_used=0,
                success=False,
                error=str(e),
            )
    
    def generate_sync(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: Optional[float] = None,
    ) -> LLMResponse:
        """
        Synchronous wrapper for generate().
        Used when called from non-async context.
        """
        try:
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = None

            if loop is not None and loop.is_running():
                # We're inside an async context — use the shared thread pool
                result = _sync_pool.submit(
                    asyncio.run,
                    self.generate(system_prompt, user_prompt, temperature)
                ).result(timeout=self.timeout + 5)
                return result
            else:
                return asyncio.run(
                    self.generate(system_prompt, user_prompt, temperature)
                )
        except Exception as e:
            logger.error("llm_sync_error", error=str(e))
            return LLMResponse(
                content="",
                model=self.model,
                tokens_used=0,
                success=False,
                error=str(e),
            )


# Singleton
_client: Optional[OpenRouterClient] = None


def get_llm_client() -> OpenRouterClient:
    """Get or create global LLM client."""
    global _client
    if _client is None:
        _client = OpenRouterClient()
    return _client


def shutdown_llm_pool():
    """Shutdown the shared thread pool on app exit."""
    _sync_pool.shutdown(wait=False)
