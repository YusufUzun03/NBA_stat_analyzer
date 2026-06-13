"""Pydantic schemas for request/response bodies."""
from __future__ import annotations

from pydantic import BaseModel, Field


class TradeRequest(BaseModel):
    give: list[str] = Field(default_factory=list, description="Player ids (bbref slugs) given away")
    receive: list[str] = Field(default_factory=list, description="Player ids (bbref slugs) received")
    pool: int = 156
    punt: list[str] = Field(default_factory=list, description="Category keys to punt")
