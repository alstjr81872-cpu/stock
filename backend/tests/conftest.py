"""Business logic tests use an in-memory Firestore/Storage adapter.
Actual Firebase security-rule/integration tests are separate and must use emulators.
"""

import copy
import os

os.environ.update(
    NF_MODE="emulator",
    NF_AI_MODE="mock",
    GCLOUD_PROJECT="demo-novelforge",
    FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099",
    FIRESTORE_EMULATOR_HOST="127.0.0.1:8080",
    STORAGE_EMULATOR_HOST="http://127.0.0.1:9199",
)
import pytest
from fastapi.testclient import TestClient
from backend import repository as r
from backend.main import app
from firebase_admin import auth


class Snap:
    def __init__(self, ref):
        self.reference = ref
        self.exists = ref.path in ref.store
        self.data = copy.deepcopy(ref.store.get(ref.path))

    def to_dict(self):
        return copy.deepcopy(self.data)


class Doc:
    def __init__(self, store, path):
        self.store = store
        self.path = path
        self.id = path.split("/")[-1]

    def collection(self, name):
        return Coll(self.store, self.path + "/" + name)

    def get(self, transaction=None):
        return Snap(self)

    def create(self, data):
        if self.path in self.store:
            raise ValueError("already exists")
        self.store[self.path] = copy.deepcopy(data)

    def set(self, data, merge=False):
        self.store[self.path] = (
            {**self.store.get(self.path, {}), **copy.deepcopy(data)}
            if merge
            else copy.deepcopy(data)
        )

    def update(self, data):
        self.store[self.path].update(copy.deepcopy(data))

    def delete(self):
        self.store.pop(self.path, None)


class Coll:
    def __init__(self, store, path):
        self.store = store
        self.path = path
        self.bound = 200

    def document(self, key):
        return Doc(self.store, self.path + "/" + key)

    def limit(self, n):
        self.bound = n
        return self

    def stream(self):
        return [
            Snap(Doc(self.store, k))
            for k in sorted(self.store)
            if k.startswith(self.path + "/")
            and k.count("/") == self.path.count("/") + 1
        ][: self.bound]


class Tx:
    def set(self, doc, data, merge=False):
        doc.set(data, merge)

    def update(self, doc, data):
        doc.update(data)

    def create(self, doc, data):
        doc.create(data)


class DB:
    def __init__(self):
        self.store = {}

    def collection(self, n):
        return Coll(self.store, n)

    def transaction(self):
        return Tx()


class Blob:
    def __init__(self, store, path):
        self.store = store
        self.path = path

    def upload_from_string(self, data, content_type=None, if_generation_match=None):
        assert if_generation_match == 0
        if self.path in self.store:
            raise ValueError("immutable")
        self.store[self.path] = data

    def download_as_bytes(self):
        return self.store[self.path]

    def delete(self):
        self.store.pop(self.path, None)


class Bucket:
    def __init__(self):
        self.store = {}

    def blob(self, path):
        return Blob(self.store, path)


@pytest.fixture
def client(monkeypatch):
    db = DB()
    storage = Bucket()
    monkeypatch.setattr(r, "db", lambda: db)
    monkeypatch.setattr(r, "bucket", lambda: storage)
    monkeypatch.setattr(r, "initialize", lambda: None)
    monkeypatch.setattr(r.gcf, "transactional", lambda fn: fn)

    def verify(token, check_revoked=True):
        if token not in ["alice", "bob"]:
            raise ValueError("invalid")
        return {"uid": token}

    monkeypatch.setattr(auth, "verify_id_token", verify)
    with TestClient(app, headers={"Authorization": "Bearer alice"}) as c:
        c.fake_db = db
        c.fake_storage = storage
        yield c
