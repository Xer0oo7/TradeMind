"""
Authentication routes — Register & Login using MySQL.

POST /api/v1/auth/register  → create user, return JWT
POST /api/v1/auth/login     → verify credentials, return JWT
GET  /api/v1/auth/me        → return current user from JWT
"""
import bcrypt
import jwt
import datetime
import os
import time
import hashlib
import aiomysql
from collections import defaultdict
from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr, field_validator
import re
import structlog

from ...infrastructure.database.session import get_conn
from ...core.config import get_settings
from ..middleware import limiter

_settings = get_settings()
logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/api/v1/auth", tags=["Authentication"])

# JWT config — read from pydantic Settings (which loads .env)
JWT_SECRET = _settings.jwt_secret
if not JWT_SECRET:
    raise RuntimeError(
        "FATAL: JWT_SECRET is not set in .env. "
        "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
    )
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 1  # Shortened from 24h to 1h for security

# ── Account lockout tracking (in-memory) ──────────────────────────
# WARNING: This is per-process. If running multiple uvicorn workers,
# each worker has its own dict. For production, use Redis or DB-backed lockout.
_failed_attempts: dict = defaultdict(list)  # key -> [timestamps]
MAX_FAILED_ATTEMPTS = 5
LOCKOUT_WINDOW_SECONDS = 900  # 15 minutes


def _check_lockout(key: str) -> None:
    """Raise 429 if too many failed attempts in the lockout window."""
    now = time.time()
    # Prune old entries
    _failed_attempts[key] = [
        t for t in _failed_attempts[key]
        if now - t < LOCKOUT_WINDOW_SECONDS
    ]
    if len(_failed_attempts[key]) >= MAX_FAILED_ATTEMPTS:
        raise HTTPException(
            status_code=429,
            detail="Too many failed attempts. Try again in 15 minutes.",
        )


def _record_failure(key: str) -> None:
    """Record a failed login attempt."""
    _failed_attempts[key].append(time.time())


def _clear_failures(key: str) -> None:
    """Clear failed attempts on successful login."""
    _failed_attempts.pop(key, None)

security = HTTPBearer(auto_error=False)


# ── Request / Response models ─────────────────────────────────────

class RegisterRequest(BaseModel):
    full_name: str
    email: EmailStr
    password: str

    @field_validator("full_name")
    @classmethod
    def name_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError("Full name is required")
        return v.strip()

    @field_validator("password")
    @classmethod
    def password_strong(cls, v):
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        if not re.search(r"[A-Z]", v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not re.search(r"\d", v):
            raise ValueError("Password must contain at least one digit")
        if not re.search(r"[!@#$%^&*(),.?\":{}|<>]", v):
            raise ValueError("Password must contain at least one special character")
        return v


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class AuthResponse(BaseModel):
    token: str
    user: dict


class UserResponse(BaseModel):
    id: int
    full_name: str
    email: str


# ── Helpers ────────────────────────────────────────────────────────

def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))


def _create_token(user_id: int, email: str, full_name: str) -> str:
    payload = {
        "sub": str(user_id),
        "email": email,
        "full_name": full_name,
        "exp": datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=JWT_EXPIRE_HOURS),
        "iat": datetime.datetime.now(datetime.timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Dependency: decode JWT **or** validate a tm_ API key and return user dict."""
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")

    token = credentials.credentials

    # ── API-key path (starts with tm_) ─────────────────────────────
    if token.startswith("tm_"):
        async with get_conn() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cur:
                await cur.execute(
                    """SELECT ak.user_id, u.email, u.full_name
                       FROM api_keys ak
                       JOIN users u ON u.id = ak.user_id
                       WHERE ak.api_key = %s AND ak.is_active = 1""",
                    (token,),
                )
                row = await cur.fetchone()
                if not row:
                    raise HTTPException(status_code=401, detail="Invalid or revoked API key")
                # touch last_used_at
                await cur.execute(
                    "UPDATE api_keys SET last_used_at = NOW() WHERE api_key = %s",
                    (token,),
                )
        return {
            "id": int(row["user_id"]),
            "email": row["email"],
            "full_name": row["full_name"],
        }

    # ── JWT path ───────────────────────────────────────────────────
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return {
            "id": int(payload["sub"]),
            "email": payload["email"],
            "full_name": payload["full_name"],
        }
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ── Routes ─────────────────────────────────────────────────────────

@router.post("/register", response_model=AuthResponse)
@limiter.limit("5/minute")
async def register(request: Request, body: RegisterRequest):
    """Create a new user account."""
    async with get_conn() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            # Check if email already exists
            await cur.execute("SELECT id FROM users WHERE email = %s", (body.email,))
            existing = await cur.fetchone()
            if existing:
                raise HTTPException(status_code=409, detail="Email already registered")

            # Insert new user
            hashed = _hash_password(body.password)
            await cur.execute(
                "INSERT INTO users (full_name, email, password_hash) VALUES (%s, %s, %s)",
                (body.full_name, body.email, hashed),
            )
            user_id = cur.lastrowid

            # Auto-seed starter products for new account
            starter_products = [
                ("Wireless Earbuds", 2499.00, 1100.00, 1400.00, 0.0, "MAX_PROFIT", 10, "Electronics"),
                ("Smart LED Bulb", 899.00, 350.00, 450.00, 0.0, "MAX_PROFIT", 8, "Electronics"),
                ("Organic Coffee Beans (1kg)", 1299.00, 650.00, 800.00, 0.0, "MAX_PROFIT", 10, "Consumables"),
                ("Fitness Band", 3999.00, 2200.00, 2600.00, 0.0, "MAX_PROFIT", 10, "Electronics"),
                ("Cloud Storage Subscription", 299.00, 80.00, 120.00, 0.0, "MAX_PROFIT", 8, "Services"),
                ("Office Chair (Ergonomic)", 7499.00, 4200.00, 4999.00, 5.0, "MIN_LOSS", 10, "Furniture"),
                ("Bluetooth Speaker", 1999.00, 950.00, 1200.00, 0.0, "MAX_PROFIT", 10, "Electronics"),
                ("Online Course Access", 999.00, 150.00, 300.00, 0.0, "MAX_PROFIT", 6, "Services"),
                ("Mechanical Keyboard", 4499.00, 2100.00, 2799.00, 0.0, "MAX_PROFIT", 10, "Electronics"),
                ("Premium Widget", 100.00, 40.00, 55.00, 0.0, "MAX_PROFIT", 10, "General"),
            ]
            for prod in starter_products:
                await cur.execute(
                    """INSERT INTO products (
                        user_id, name, base_price, cost_price, min_acceptable_price,
                        max_loss_percent, mode, max_rounds, category, status
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (user_id, *prod, "active"),
                )

            # Auto-seed demo negotiation sessions so Dashboard shows real data
            import random as _random
            from datetime import datetime as _dt, timedelta as _td
            _demo_sessions = [
                ("Wireless Earbuds","MAX_PROFIT",2499,1100,1400,10,3,"accepted",2199.00,1,2199,2249,[
                    (1,"Can you do 1800 for earbuds?","Best we can do today is 2350.",1800,2350,"counter"),
                    (2,"How about 2100?","Meet me at 2249 with free shipping?",2100,2249,"counter"),
                    (3,"Fine — 2199.","Accepted at 2199!",2199,2199,"accept"),
                ]),
                ("Mechanical Keyboard","MAX_PROFIT",4499,2100,2799,10,3,"accepted",3899.00,1,3899,3999,[
                    (1,"3200 for the keyboard?","Floor is 4199 for this model.",3200,4199,"counter"),
                    (2,"3700 is my max.","How about 3999?",3700,3999,"counter"),
                    (3,"3899 final.","Accepted at 3899!",3899,3899,"accept"),
                ]),
                ("Office Chair (Ergonomic)","MIN_LOSS",7499,4200,4999,10,2,"accepted",6499.00,1,6499,6799,[
                    (1,"6000 for chair?","We can do 6799 with warranty.",6000,6799,"counter"),
                    (2,"6499 today.","Done! 6499 accepted.",6499,6499,"accept"),
                ]),
                ("Organic Coffee Beans (1kg)","MAX_PROFIT",1299,650,800,10,2,"accepted",1099.00,1,1099,1149,[
                    (1,"1000 for the coffee?","Minimum is 1149 for single-origin.",1000,1149,"counter"),
                    (2,"1099 and I order now.","Deal!",1099,1099,"accept"),
                ]),
                ("Cloud Storage Subscription","MAX_PROFIT",299,80,120,8,1,"accepted",249.00,1,249,269,[
                    (1,"249/month with annual plan?","Yes — 249 for yearly commitment!",249,249,"accept"),
                ]),
                ("Online Course Access","MAX_PROFIT",999,150,300,6,2,"accepted",799.00,1,799,849,[
                    (1,"700 student discount?","849 is our student rate.",700,849,"counter"),
                    (2,"799 works for me.","799 confirmed — lifetime access!",799,799,"accept"),
                ]),
                ("Smart LED Bulb","MAX_PROFIT",899,350,450,8,3,"accepted",749.00,1,749,799,[
                    (1,"500 for the bulb?","Below margin — best is 799.",500,799,"counter"),
                    (2,"700?","Meet at 749.",700,749,"counter"),
                    (3,"749 done.","Accepted!",749,749,"accept"),
                ]),
                ("Fitness Band","MAX_PROFIT",3999,2200,2600,10,3,"rejected",None,0,2100,3199,[
                    (1,"2000 for the band?","Below cost — best is 3499.",2000,3499,"counter"),
                    (2,"2100 max.","Cannot go below 3199.",2100,3199,"counter"),
                    (3,"2100 only.","We must decline. Thank you!",2100,3199,"reject"),
                ]),
                ("Bluetooth Speaker","MAX_PROFIT",1999,950,1200,10,3,"walked_away",None,0,1100,1599,[
                    (1,"1000 for the speaker?","Below margin — best is 1699.",1000,1699,"counter"),
                    (2,"1100?","Can do 1599.",1100,1599,"counter"),
                    (3,"Never mind.","Feel free to return anytime!",1100,1599,"walked_away"),
                ]),
                ("Premium Widget","MAX_PROFIT",100,40,55,10,1,"active",None,0,75,90,[
                    (1,"75 for 10 units?","We can do 90 each for bulk.",75,90,"counter"),
                ]),
            ]
            for sess in _demo_sessions:
                pname,mode,bp,cp,mp,maxr,used,status,fp,closed_flag,bl,sl,msgs = sess
                _created = _dt.utcnow() - _td(days=_random.randint(1,12), hours=_random.randint(1,8))
                _closed_at = _created + _td(minutes=_random.randint(5,25)) if status != "active" else None
                await cur.execute(
                    """INSERT INTO chat_sessions
                    (user_id,product_name,mode,base_price,cost_price,min_price,max_rounds,rounds_used,
                     status,final_price,final_decision,deal_closed,buyer_last_offer,seller_last_offer,
                     created_at,closed_at)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (user_id,pname,mode,bp,cp,mp,maxr,used,status,fp,
                     status if status != "active" else None,
                     closed_flag,bl,sl,_created,_closed_at),
                )
                _sid = cur.lastrowid
                for rn,um,br,op,cpr,dec in msgs:
                    await cur.execute(
                        """INSERT INTO chat_messages
                        (session_id,user_id,round_number,user_message,bot_reply,
                         offered_price,counter_price,decision,created_at)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                        (_sid,user_id,rn,um,br,op,cpr,dec,_created+_td(minutes=rn*2)),
                    )
            # Update product aggregates
            await cur.execute(
                """UPDATE products p SET
                    total_sessions=(SELECT COUNT(*) FROM chat_sessions cs
                        WHERE cs.user_id=p.user_id AND cs.product_name=p.name),
                    accepted_deals=(SELECT COUNT(*) FROM chat_sessions cs
                        WHERE cs.user_id=p.user_id AND cs.product_name=p.name AND cs.deal_closed=1),
                    revenue=COALESCE((SELECT SUM(final_price) FROM chat_sessions cs
                        WHERE cs.user_id=p.user_id AND cs.product_name=p.name AND cs.deal_closed=1),0),
                    avg_margin=COALESCE((SELECT AVG(((final_price-p.cost_price)/final_price)*100)
                        FROM chat_sessions cs WHERE cs.user_id=p.user_id
                        AND cs.product_name=p.name AND cs.deal_closed=1),0)
                WHERE p.user_id=%s""",
                (user_id,),
            )


    token = _create_token(user_id, body.email, body.full_name)
    return AuthResponse(
        token=token,
        user={"id": user_id, "full_name": body.full_name, "email": body.email},
    )


@router.post("/login", response_model=AuthResponse)
@limiter.limit("5/minute")
async def login(request: Request, body: LoginRequest):
    """Authenticate and return a JWT."""
    # Check lockout before attempting login
    lockout_key = hashlib.sha256(body.email.lower().encode()).hexdigest()[:16]
    _check_lockout(lockout_key)

    async with get_conn() as conn:
        async with conn.cursor(aiomysql.DictCursor) as cur:
            await cur.execute(
                "SELECT id, full_name, email, password_hash FROM users WHERE email = %s",
                (body.email,),
            )
            user = await cur.fetchone()

    if not user or not _verify_password(body.password, user["password_hash"]):
        _record_failure(lockout_key)
        logger.warning("login_failed", email_hash=lockout_key)
        raise HTTPException(status_code=401, detail="Invalid email or password")

    _clear_failures(lockout_key)
    token = _create_token(user["id"], user["email"], user["full_name"])
    return AuthResponse(
        token=token,
        user={"id": user["id"], "full_name": user["full_name"], "email": user["email"]},
    )


@router.get("/me", response_model=UserResponse)
async def me(user=Depends(get_current_user)):
    """Return the currently authenticated user."""
    return UserResponse(**user)
