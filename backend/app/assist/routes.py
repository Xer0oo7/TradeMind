"""
routes.py — POST /api/v1/negotiate/assist

Protected endpoint: requires get_current_user (JWT or API key).
No LLM calls. No network I/O. Target response time < 300 ms.

SECURITY:
- Loads product by id AND user_id (ownership check).
- Never returns cost_price, min_acceptable_price, mode, or margin
  to any external logs or LLM prompt.
- All money values are float rounded to 2 decimals.
"""
from __future__ import annotations

import aiomysql
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, field_validator
from typing import Optional

from ..api.v1.auth_routes import get_current_user
from ..infrastructure.database.session import get_conn
from .service import AssistPayload, build_assist

router = APIRouter(prefix="/api/v1/negotiate", tags=["Assist"])


class AssistRequest(BaseModel):
    product_id: int
    message: str
    quantity: Optional[int] = None
    seller_last_offer: Optional[float] = None
    buyer_last_offer: Optional[float] = None
    round: int = 1
    override_unit_price: Optional[float] = None
    available_inventory: Optional[int] = None

    @field_validator("message")
    @classmethod
    def message_length(cls, v: str) -> str:
        if len(v) > 2000:
            raise ValueError("message must be <= 2000 characters")
        return v

    @field_validator("round")
    @classmethod
    def round_positive(cls, v: int) -> int:
        if v < 1:
            raise ValueError("round must be >= 1")
        return v

    @field_validator("quantity")
    @classmethod
    def qty_positive(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v < 1:
            raise ValueError("quantity must be >= 1")
        return v


@router.post("/assist")
async def assist_endpoint(
    body: AssistRequest,
    user=Depends(get_current_user),
):
    """
    Seller assist — analyse a buyer message and return economics + suggestion.
    Does NOT invoke any LLM. All logic is deterministic and runs in-process.
    """
    async with get_conn() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            # Load product by id AND user_id (ownership check → 404 if not owned)
            await cur.execute(
                """SELECT p.id, p.name, p.base_price, p.cost_price,
                          p.min_acceptable_price, p.mode, p.max_rounds,
                          p.total_sessions, p.accepted_deals,
                          p.avg_margin, p.revenue
                   FROM products p
                   WHERE p.id = %s AND p.user_id = %s""",
                (body.product_id, user["id"]),
            )
            product_row = await cur.fetchone()

    if not product_row:
        raise HTTPException(status_code=404, detail="Product not found")

    payload = AssistPayload(
        product_id=body.product_id,
        message=body.message,
        quantity=body.quantity,
        seller_last_offer=body.seller_last_offer,
        buyer_last_offer=body.buyer_last_offer,
        round_number=body.round,
        override_unit_price=body.override_unit_price,
        available_inventory=body.available_inventory,
    )

    result = build_assist(product_row, payload)
    return result
