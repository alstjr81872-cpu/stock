"""Browser-test adapter only. Real Firebase Auth Emulator, in-memory DB/Storage.
Run only with NF_TEST_SERVER=1 on loopback. Never a deployment entrypoint.
"""

import os

if os.environ.get("NF_TEST_SERVER") != "1":
    raise RuntimeError("This module is only for automated UI tests")
from .conftest import DB, Bucket
from backend import repository as r
from backend import main
from types import SimpleNamespace

_db = DB()
_bucket = Bucket()
r.db = lambda: _db
r.bucket = lambda: _bucket
r.gcf.transactional = lambda fn: fn
main.settings = SimpleNamespace(
    mode="test-adapter", ai_mode="mock", origin="http://localhost:3001"
)
app = main.app
