"""
meetings/routes.py — Live meeting / room management.

Tables:
  meetings: id, seller_id FK users, callback_id NULL FK callback_requests,
            product_id NULL, product_name, buyer_phone NULL, quantity INT NULL,
            available_inventory INT NULL, notes TEXT NULL,
            meeting_time DATETIME NULL (NULL = instant),
            room_token VARCHAR(64) UNIQUE NOT NULL,
            status ENUM('scheduled','live','ended','cancelled'),
            summary_json TEXT NULL, created_at, started_at NULL, ended_at NULL

Endpoints (all under /api/v1/meetings, all get_current_user):
  POST   ""               → create meeting
  GET    ""               → list meetings (?status=)
  GET    /{id}            → get meeting
  GET    /by-token/{tok}  → get meeting by room_token (for LiveChatPage)
  PATCH  /{id}            → reschedule / cancel
  POST   /{id}/start      → mark live
  POST   /{id}/end        → end + store summary

Also:
  PATCH  /api/v1/chat-sessions/callback-requests/{id} → update callback status
"""
from __future__ import annotations

import secrets
import json
from datetime import datetime, timezone, timedelta
from typing import Optional, List
import aiomysql
import structlog

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, field_validator

from ..api.v1.auth_routes import get_current_user
from ..api.v1.chat_session_routes import router as _cb_router   # reuse existing router
from ..infrastructure.database.session import get_conn

router = APIRouter(prefix="/api/v1/meetings", tags=["Meetings"])
_log = structlog.get_logger("meetings")

# ──────────────────────────────────────────────────────────────
# TABLE CREATION
# ──────────────────────────────────────────────────────────────

async def _ensure_meetings_table() -> None:
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute("""
                CREATE TABLE IF NOT EXISTS meetings (
                    id               INT AUTO_INCREMENT PRIMARY KEY,
                    seller_id        INT NOT NULL,
                    callback_id      INT NULL,
                    product_id       INT NULL,
                    product_name     VARCHAR(200) NOT NULL DEFAULT '',
                    buyer_phone      VARCHAR(30) NULL,
                    quantity         INT NULL,
                    available_inventory INT NULL,
                    notes            TEXT NULL,
                    meeting_time     DATETIME NULL,
                    room_token       VARCHAR(64) NOT NULL UNIQUE,
                    status           ENUM('scheduled','live','ended','cancelled')
                                     NOT NULL DEFAULT 'scheduled',
                    summary_json     TEXT NULL,
                    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    started_at       DATETIME NULL,
                    ended_at         DATETIME NULL,
                    FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (callback_id) REFERENCES callback_requests(id)
                        ON DELETE SET NULL
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """)
            await conn.commit()


async def _add_callback_status_column() -> None:
    """Add status column to callback_requests if not present (idempotent)."""
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            # Check if column exists
            await cur.execute("""
                SELECT COUNT(*) FROM information_schema.columns
                WHERE table_schema = DATABASE()
                  AND table_name = 'callback_requests'
                  AND column_name = 'status'
            """)
            row = await cur.fetchone()
            if row and row[0] == 0:
                await cur.execute("""
                    ALTER TABLE callback_requests
                    ADD COLUMN status ENUM('pending','scheduled','contacted','completed','missed')
                    NOT NULL DEFAULT 'pending'
                """)
                await conn.commit()


async def _ensure_schema() -> None:
    await _ensure_meetings_table()
    await _add_callback_status_column()


# ──────────────────────────────────────────────────────────────
# PYDANTIC MODELS
# ──────────────────────────────────────────────────────────────

class CreateMeetingRequest(BaseModel):
    callback_id: Optional[int] = None
    product_id: Optional[int] = None
    product_name: Optional[str] = None
    buyer_phone: Optional[str] = None
    quantity: Optional[int] = None
    available_inventory: Optional[int] = None
    notes: Optional[str] = None
    meeting_time: Optional[str] = None   # ISO 8601 with timezone
    instant: bool = False

    @field_validator("buyer_phone")
    @classmethod
    def clean_phone(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        return v.strip() or None

    @field_validator("product_name")
    @classmethod
    def clean_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        return v.strip()[:200] or None


class PatchMeetingRequest(BaseModel):
    meeting_time: Optional[str] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class EndMeetingRequest(BaseModel):
    summary: Optional[dict] = None


class PatchCallbackStatusRequest(BaseModel):
    status: str

    @field_validator("status")
    @classmethod
    def valid_status(cls, v: str) -> str:
        allowed = {"pending", "scheduled", "contacted", "completed", "missed"}
        if v not in allowed:
            raise ValueError(f"status must be one of {allowed}")
        return v


# ──────────────────────────────────────────────────────────────
# HELPERS
# ──────────────────────────────────────────────────────────────

def _row_to_meeting(row: dict) -> dict:
    d = dict(row)
    for k in ("created_at", "started_at", "ended_at", "meeting_time"):
        if d.get(k) and isinstance(d[k], datetime):
            d[k] = d[k].isoformat()
    return d


def _parse_iso(ts: str) -> datetime:
    """Parse ISO 8601 string to UTC-aware datetime."""
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"Invalid meeting_time: {e}")


async def _resolve_product(conn, user_id: int, payload: CreateMeetingRequest) -> tuple[Optional[int], Optional[str], bool]:
    """
    Returns (product_id, product_name, resolution_needed).
    resolution_needed=True when 0 or >1 products match the name.
    """
    if payload.product_id is not None:
        # Verify ownership
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT id, name, base_price FROM products WHERE id = %s AND user_id = %s",
                (payload.product_id, user_id),
            )
            p = await cur.fetchone()
        if not p:
            raise HTTPException(404, "Product not found or not owned by you")
        return p["id"], payload.product_name or p["name"], False

    # Try to resolve by name
    name = payload.product_name
    if name:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT id, name, base_price FROM products WHERE user_id = %s AND name = %s",
                (user_id, name),
            )
            rows = await cur.fetchall()
        if len(rows) == 1:
            return rows[0]["id"], rows[0]["name"], False
        # 0 or multiple matches
        return None, name, True

    # No product info at all
    return None, payload.product_name or "", False


async def _get_public_label(conn, product_id: Optional[int]) -> dict:
    """Returns {productLabel, askPrice} without cost/floor/mode."""
    if product_id is None:
        return {"productLabel": None, "askPrice": None}
    async with conn.cursor(aiomysql.DictCursor) as cur:
        await cur.execute(
            "SELECT name, base_price FROM products WHERE id = %s",
            (product_id,),
        )
        row = await cur.fetchone()
    if not row:
        return {"productLabel": None, "askPrice": None}
    return {
        "productLabel": row["name"],
        "askPrice": float(row["base_price"]),
    }


# ──────────────────────────────────────────────────────────────
# ROUTES
# ──────────────────────────────────────────────────────────────

@router.post("")
async def create_meeting(body: CreateMeetingRequest, user=Depends(get_current_user)):
    await _ensure_schema()

    token = secrets.token_urlsafe(16)
    now_utc = datetime.now(timezone.utc)

    async with get_conn() as conn:
        # Resolve product
        product_id, product_name, resolution_needed = await _resolve_product(
            conn, user["id"], body
        )

        # Validate callback ownership
        if body.callback_id is not None:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT id FROM callback_requests WHERE id = %s AND user_id = %s",
                    (body.callback_id, user["id"]),
                )
                if not await cur.fetchone():
                    raise HTTPException(404, "Callback request not found")

        # Determine status and times
        if body.instant:
            status = "live"
            started_at = now_utc
            meeting_time_dt = None
        else:
            status = "scheduled"
            started_at = None
            if body.meeting_time:
                meeting_time_dt = _parse_iso(body.meeting_time)
                if meeting_time_dt <= now_utc:
                    raise HTTPException(422, "meeting_time must be in the future")
            else:
                meeting_time_dt = None

        meeting_time_val = meeting_time_dt.strftime("%Y-%m-%d %H:%M:%S") if meeting_time_dt else None
        started_at_val = started_at.strftime("%Y-%m-%d %H:%M:%S") if started_at else None

        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                """INSERT INTO meetings
                   (seller_id, callback_id, product_id, product_name, buyer_phone,
                    quantity, available_inventory, notes, meeting_time, room_token,
                    status, started_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (
                    user["id"], body.callback_id, product_id,
                    product_name or "", body.buyer_phone,
                    body.quantity, body.available_inventory,
                    body.notes, meeting_time_val, token,
                    status, started_at_val,
                ),
            )
            meeting_id = cur.lastrowid
            await conn.commit()

            # Update callback status
            if body.callback_id is not None:
                new_cb_status = "contacted" if body.instant else "scheduled"
                await cur.execute(
                    "UPDATE callback_requests SET status = %s WHERE id = %s",
                    (new_cb_status, body.callback_id),
                )
                await conn.commit()

            # Fetch created row
            await cur.execute(
                "SELECT * FROM meetings WHERE id = %s", (meeting_id,)
            )
            row = await cur.fetchone()

        public_label = await _get_public_label(conn, product_id)

    result = _row_to_meeting(row)
    result["public_label"] = public_label
    if resolution_needed:
        result["resolution_needed"] = True

    return result


@router.get("")
async def list_meetings(status: Optional[str] = None, user=Depends(get_current_user)):
    await _ensure_schema()
    async with get_conn() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            if status:
                await cur.execute(
                    "SELECT * FROM meetings WHERE seller_id = %s AND status = %s ORDER BY created_at DESC",
                    (user["id"], status),
                )
            else:
                await cur.execute(
                    "SELECT * FROM meetings WHERE seller_id = %s ORDER BY created_at DESC",
                    (user["id"],),
                )
            rows = await cur.fetchall()
    return [_row_to_meeting(r) for r in rows]


@router.get("/by-token/{token}")
async def get_meeting_by_token(token: str, user=Depends(get_current_user)):
    """Used by LiveChatPage to verify meeting ownership by room token."""
    await _ensure_schema()
    async with get_conn() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT * FROM meetings WHERE room_token = %s AND seller_id = %s",
                (token, user["id"]),
            )
            row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Meeting not found or not owned by you")
    return _row_to_meeting(row)


@router.get("/{meeting_id}")
async def get_meeting(meeting_id: int, user=Depends(get_current_user)):
    await _ensure_schema()
    async with get_conn() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT * FROM meetings WHERE id = %s AND seller_id = %s",
                (meeting_id, user["id"]),
            )
            row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Meeting not found")
    return _row_to_meeting(row)


@router.patch("/{meeting_id}")
async def patch_meeting(
    meeting_id: int, body: PatchMeetingRequest, user=Depends(get_current_user)
):
    await _ensure_schema()
    async with get_conn() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT * FROM meetings WHERE id = %s AND seller_id = %s",
                (meeting_id, user["id"]),
            )
            row = await cur.fetchone()
            if not row:
                raise HTTPException(404, "Meeting not found")

            updates: dict = {}
            now_utc = datetime.now(timezone.utc)

            if body.status is not None:
                allowed = {"scheduled", "live", "ended", "cancelled"}
                if body.status not in allowed:
                    raise HTTPException(422, f"status must be one of {allowed}")
                updates["status"] = body.status

            if body.meeting_time is not None:
                mt = _parse_iso(body.meeting_time)
                if mt <= now_utc:
                    raise HTTPException(422, "meeting_time must be in the future")
                updates["meeting_time"] = mt.strftime("%Y-%m-%d %H:%M:%S")

            if body.notes is not None:
                updates["notes"] = body.notes

            if not updates:
                return _row_to_meeting(row)

            set_clause = ", ".join(f"{k} = %s" for k in updates)
            vals = list(updates.values()) + [meeting_id]
            await cur.execute(
                f"UPDATE meetings SET {set_clause} WHERE id = %s", vals
            )
            await conn.commit()

            # Keep callback in sync
            if "status" in updates and row.get("callback_id"):
                cb_map = {
                    "scheduled": "scheduled",
                    "live": "contacted",
                    "ended": "completed",
                    "cancelled": "missed",
                }
                new_cb = cb_map.get(updates["status"])
                if new_cb:
                    await cur.execute(
                        "UPDATE callback_requests SET status = %s WHERE id = %s",
                        (new_cb, row["callback_id"]),
                    )
                    await conn.commit()

            await cur.execute("SELECT * FROM meetings WHERE id = %s", (meeting_id,))
            updated = await cur.fetchone()

    return _row_to_meeting(updated)


@router.post("/{meeting_id}/start")
async def start_meeting(meeting_id: int, user=Depends(get_current_user)):
    await _ensure_schema()
    now_utc = datetime.now(timezone.utc)
    async with get_conn() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT * FROM meetings WHERE id = %s AND seller_id = %s",
                (meeting_id, user["id"]),
            )
            row = await cur.fetchone()
            if not row:
                raise HTTPException(404, "Meeting not found")
            await cur.execute(
                "UPDATE meetings SET status = 'live', started_at = %s WHERE id = %s",
                (now_utc.strftime("%Y-%m-%d %H:%M:%S"), meeting_id),
            )
            await conn.commit()
            if row.get("callback_id"):
                await cur.execute(
                    "UPDATE callback_requests SET status = 'contacted' WHERE id = %s",
                    (row["callback_id"],),
                )
                await conn.commit()
            await cur.execute("SELECT * FROM meetings WHERE id = %s", (meeting_id,))
            updated = await cur.fetchone()
    return _row_to_meeting(updated)


@router.post("/{meeting_id}/end")
async def end_meeting(
    meeting_id: int, body: EndMeetingRequest, user=Depends(get_current_user)
):
    await _ensure_schema()
    now_utc = datetime.now(timezone.utc)
    summary_str = json.dumps(body.summary) if body.summary else None

    async with get_conn() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT * FROM meetings WHERE id = %s AND seller_id = %s",
                (meeting_id, user["id"]),
            )
            row = await cur.fetchone()
            if not row:
                raise HTTPException(404, "Meeting not found")

            await cur.execute(
                """UPDATE meetings
                   SET status = 'ended', ended_at = %s, summary_json = %s
                   WHERE id = %s""",
                (now_utc.strftime("%Y-%m-%d %H:%M:%S"), summary_str, meeting_id),
            )
            await conn.commit()

            # If deal agreed → callback → completed
            if body.summary and body.summary.get("finalOutcome", {}).get("dealAgreed") and row.get("callback_id"):
                await cur.execute(
                    "UPDATE callback_requests SET status = 'completed' WHERE id = %s",
                    (row["callback_id"],),
                )
                await conn.commit()
            elif row.get("callback_id"):
                await cur.execute(
                    "UPDATE callback_requests SET status = 'completed' WHERE id = %s",
                    (row["callback_id"],),
                )
                await conn.commit()

            await cur.execute("SELECT * FROM meetings WHERE id = %s", (meeting_id,))
            updated = await cur.fetchone()

    return _row_to_meeting(updated)


# ──────────────────────────────────────────────────────────────
# PATCH callback-requests status (on chat_session_routes router)
# We inject this endpoint onto the EXISTING /api/v1/chat-sessions router
# ──────────────────────────────────────────────────────────────

@_cb_router.patch("/callback-requests/{cb_id}")
async def patch_callback_status(
    cb_id: int, body: PatchCallbackStatusRequest, user=Depends(get_current_user)
):
    """Update callback request status. Owner-checked."""
    async with get_conn() as conn:
        async with conn.cursor() as cur:
            await cur.execute(
                "SELECT id FROM callback_requests WHERE id = %s AND user_id = %s",
                (cb_id, user["id"]),
            )
            if not await cur.fetchone():
                raise HTTPException(404, "Callback request not found")
            await cur.execute(
                "UPDATE callback_requests SET status = %s WHERE id = %s",
                (body.status, cb_id),
            )
            await conn.commit()
    return {"id": cb_id, "status": body.status}
