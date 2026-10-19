"""Single ownership root; all CAS callbacks are pure Firestore operations."""

import hashlib
import json
import re
import uuid
import os
import socket
from datetime import datetime, timezone
from typing import Callable

import firebase_admin
from firebase_admin import firestore, storage, credentials
from google.auth.credentials import AnonymousCredentials
from google.cloud import firestore as gcf
from fastapi import HTTPException
from .config import settings

SAFE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
INLINE_LIMIT = 650_000


def now():
    return datetime.now(timezone.utc).isoformat()


def ident(value):
    if not SAFE.fullmatch(value):
        raise HTTPException(400, "잘못된 ID입니다.")
    return value


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class EmulatorCredential(credentials.Base):
    def get_credential(self):
        return AnonymousCredentials()


def initialize():
    if not firebase_admin._apps:
        options = {"projectId": settings.project, "storageBucket": settings.bucket}
        if settings.mode == "emulator":
            firebase_admin.initialize_app(EmulatorCredential(), options=options)
        else:
            firebase_admin.initialize_app(options=options)


def emulator_port(port):
    if settings.mode == "emulator":
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.3):
                pass
        except OSError:
            raise HTTPException(
                503,
                "Firebase Emulator가 준비되지 않았습니다. 환경 설정에서 storage.googleapis.com 허용을 저장하고 scripts/dev.sh를 다시 실행하세요.",
            )


def db():
    emulator_port(8080)
    initialize()
    return firestore.client()


def bucket():
    emulator_port(9199)
    initialize()
    return storage.bucket()


def root(uid):
    return db().collection("users").document(ident(uid))


def collection(uid, kind):
    if kind not in ("projects", "style_profiles", "jobs", "usage"):
        raise ValueError(kind)
    return root(uid).collection(kind)


def ref(uid, kind, key):
    return collection(uid, kind).document(ident(key))


def check_size(data):
    if len(json.dumps(data, ensure_ascii=False).encode()) > 850_000:
        raise HTTPException(413, "문서가 너무 큽니다. 자료를 나누어 저장해주세요.")


def create(uid, kind, data, key=None):
    key = key or uuid.uuid4().hex
    data = {
        **data,
        "id": key,
        "ownerUid": uid,
        "revision": 1,
        "createdAt": now(),
        "updatedAt": now(),
    }
    check_size(data)
    ref(uid, kind, key).create(data)
    return data


def get(uid, kind, key, include_deleted=False):
    snap = ref(uid, kind, key).get()
    if not snap.exists:
        raise HTTPException(404, "항목을 찾을 수 없습니다.")
    item = snap.to_dict()
    if item.get("ownerUid") != uid or (item.get("deletedAt") and not include_deleted):
        raise HTTPException(404, "항목을 찾을 수 없습니다.")
    return item


def listing(uid, kind):
    return sorted(
        [s.to_dict() for s in collection(uid, kind).limit(200).stream()],
        key=lambda x: x["updatedAt"],
        reverse=True,
    )


def mutate(uid, kind, key, expected, change: Callable, audit=None):
    doc = ref(uid, kind, key)

    @gcf.transactional
    def run(tx):
        snap = doc.get(transaction=tx)
        if not snap.exists or snap.to_dict().get("ownerUid") != uid:
            raise HTTPException(404, "항목을 찾을 수 없습니다.")
        data = snap.to_dict()
        if data["revision"] != expected:
            raise HTTPException(
                409,
                {
                    "message": "다른 창에서 변경되었습니다. 비교 후 다시 저장하세요.",
                    "currentRevision": data["revision"],
                },
            )
        change(data)
        data.update(revision=expected + 1, updatedAt=now())
        check_size(data)
        tx.set(doc, data)
        if audit:
            sub, record_id, fields = audit
            key = record_id(data) if callable(record_id) else record_id
            tx.create(
                doc.collection(sub).document(ident(key)),
                {"ownerUid": uid, **fields(data)},
            )
        return data

    return run(db().transaction())


def subref(uid, project, kind, key):
    get(uid, "projects", project, True)
    return ref(uid, "projects", project).collection(kind).document(ident(key))


def put_object(path, data: bytes, content_type="text/plain; charset=utf-8"):
    # Unique immutable object; storage write happens BEFORE any Firestore CAS.
    blob = bucket().blob(path)
    blob.upload_from_string(data, content_type=content_type, if_generation_match=0)
    return {
        "path": path,
        "sha256": hashlib.sha256(data).hexdigest(),
        "byteLength": len(data),
        "createdAt": now(),
    }


def read_object(uid, info):
    path = info["path"]
    if not path.startswith(f"users/{ident(uid)}/"):
        raise HTTPException(403, "자료 접근 권한이 없습니다.")
    data = bucket().blob(path).download_as_bytes()
    if hashlib.sha256(data).hexdigest() != info["sha256"]:
        raise HTTPException(500, "저장 자료 무결성 확인에 실패했습니다.")
    return data


def archive(uid, project, chapter, text):
    vid = uuid.uuid4().hex
    info = put_object(
        f"users/{uid}/projects/{project}/chapters/{chapter}/versions/{vid}.txt",
        text.encode(),
    )
    # Register staged object before publishing a version pointer. A failed CAS leaves a
    # recoverable STAGED record, visible in diagnostics; never silently delete it.
    record = {
        **info,
        "id": vid,
        "status": "STAGED",
        "ownerUid": uid,
        "chapterId": chapter,
    }
    subref(uid, project, "chapter_versions", vid).create(record)
    return record


def content_fields(uid, project, chapter, text):
    data = {
        "contentByteLength": len(text.encode()),
        "contentHash": digest(text),
        "charCountWithSpaces": len(text),
        "charCountWithoutSpaces": len("".join(text.split())),
    }
    if len(text.encode()) > INLINE_LIMIT:
        key = uuid.uuid4().hex
        info = put_object(
            f"users/{uid}/projects/{project}/chapters/{chapter}/large/{key}.txt",
            text.encode(),
        )
        marker = {
            **info,
            "id": key,
            "ownerUid": uid,
            "status": "STAGED",
            "chapterId": chapter,
        }
        subref(uid, project, "storage_staging", key).create(marker)
        data.update(content="", contentRef=info, storageStageId=key)
    else:
        data.update(content=text, contentRef=None, storageStageId=None)
    return data


def hydrate(uid, chapter):
    result = dict(chapter)
    if result.get("contentRef"):
        result["content"] = read_object(uid, result["contentRef"]).decode()
    return result
