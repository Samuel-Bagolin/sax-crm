from datetime import date, time
from typing import Annotated
from pydantic import AfterValidator, Field


def iso_date(value: str) -> str:
    if date.fromisoformat(value).isoformat() != value: raise ValueError("Use YYYY-MM-DD")
    return value


def iso_time(value: str) -> str:
    if time.fromisoformat(value).strftime("%H:%M") != value: raise ValueError("Use HH:MM")
    return value

ISODate = Annotated[str, AfterValidator(iso_date)]
ISOTime = Annotated[str, AfterValidator(iso_time)]
PositiveMoney = Annotated[float, Field(gt=0, allow_inf_nan=False)]
Nonnegative = Annotated[float, Field(ge=0, allow_inf_nan=False)]
Percent = Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)]
