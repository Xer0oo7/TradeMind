from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List
import uuid

class MarketListingItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    source: str
    url: str
    image_url: Optional[str] = None
    price: float
    currency: str
    similarity: float
    savings_abs: float
    savings_pct: float
    fetched_at: datetime
    is_live: bool
    listing_kind: str = "product"

class MarketComparisonResponse(BaseModel):
    product_id: str
    our_price: float
    currency: str
    generated_at: datetime
    items: List[MarketListingItem]

class RawListing(BaseModel):
    title: str
    source: str
    url: str
    image_url: Optional[str] = None
    price: float
    currency: str
    fetched_at: datetime
    is_live: bool
    listing_kind: str = "product"
