import os
import re

from fastapi import HTTPException

_SAFE_ID = re.compile(r'^[a-zA-Z0-9_\-]{1,64}$')


def validate_id(value: str, field: str) -> None:
    if not _SAFE_ID.match(value):
        raise HTTPException(status_code=422, detail=f"Invalid {field}")


def validate_path_within(resolved_path: str, root: str) -> None:
    root_real = os.path.realpath(root)
    path_real = os.path.realpath(resolved_path)
    if not (path_real == root_real or path_real.startswith(root_real + os.sep)):
        raise HTTPException(status_code=422, detail="Path traversal detected")
