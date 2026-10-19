"""Actual emulator persistence/ownership test. Run explicitly after all emulators are up.
No monkeypatches or dependency overrides. Uses only demo-novelforge.
"""

import os
import uuid

os.environ.update(
    NF_MODE="emulator",
    NF_AI_MODE="mock",
    GCLOUD_PROJECT="demo-novelforge",
    FIREBASE_AUTH_EMULATOR_HOST="127.0.0.1:9099",
    FIRESTORE_EMULATOR_HOST="127.0.0.1:8080",
    STORAGE_EMULATOR_HOST="http://127.0.0.1:9199",
)
import httpx
from fastapi.testclient import TestClient
from backend.main import app
from backend import repository as r


def account():
    res = httpx.post(
        "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp",
        params={"key": "demo-key"},
        json={
            "email": uuid.uuid4().hex + "@test.example",
            "password": "emulator-only-test-password",
            "returnSecureToken": True,
        },
    )
    res.raise_for_status()
    data = res.json()
    return data["localId"], {"Authorization": "Bearer " + data["idToken"]}


def test_real_uid_storage_hash_and_reload():
    uid, a = account()
    other, b = account()
    with TestClient(app) as client:
        raw = "실제 Emulator에서 원본 파일과 계정별 저장을 확인한다.".encode()
        res = client.post(
            "/api/projects",
            headers=a,
            data={"title": "Emulator 연결 검증"},
            files={"file": ("idea.txt", raw, "text/plain")},
        )
        assert res.status_code == 200, res.text
        p = res.json()
        pid = p["id"]
        assert r.read_object(uid, p["brief"]["file"]) == raw
        assert r.ref(uid, "projects", pid).get().exists
        reloaded = client.get("/api/projects/" + pid, headers=a)
        assert reloaded.status_code == 200 and reloaded.json()["revision"] == 1
        assert client.get("/api/projects/" + pid, headers=b).status_code == 404
        assert (
            client.get(
                "/api/projects/" + pid, headers={"Authorization": "Bearer forged"}
            ).status_code
            == 401
        )


def test_real_transactions_large_korean_storage_versions_and_restore():
    from concurrent.futures import ThreadPoolExecutor

    owner, headers = account()
    with TestClient(app) as client:
        created = client.post(
            "/api/projects",
            headers=headers,
            data={"title": "실제 리비전 및 복구 검사"},
            files={
                "file": (
                    "idea.txt",
                    "명시 승인 후 집필하는 성인 주인공의 이야기".encode(),
                    "text/plain",
                )
            },
        )
        assert created.status_code == 200, created.text
        pid = created.json()["id"]
        base = "/api/projects/" + pid
        content = "약속을 지키기 위해 선택한 주인공은 그 대가를 감수했다.\n" * 180
        # Seed a draft to isolate persistence semantics from the AI/approval workflow,
        # already covered through actual API routes in the business tests.
        r.ref(owner, "projects", pid).collection("chapters").document(
            "chapter-1"
        ).create(
            {
                "id": "chapter-1",
                "ownerUid": owner,
                "title": "리비전 검사",
                "status": "REVIEW",
                "revision": 1,
                "createdAt": r.now(),
                "updatedAt": r.now(),
                "writtenScenes": [],
                **r.content_fields(owner, pid, "chapter-1", content),
            }
        )

        def competing(suffix):
            return client.put(
                base + "/chapter",
                headers=headers,
                json={"revision": 1, "title": "동시 편집", "content": content + suffix},
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(competing, ["A창의 편집", "B창의 편집"]))
        assert sorted(res.status_code for res in outcomes) == [200, 409]
        ch = client.get(base + "/chapter", headers=headers).json()
        assert ch["revision"] == 2
        snapshot = client.post(
            base + "/chapter/snapshot", headers=headers, json={"revision": 2}
        )
        assert snapshot.status_code == 200, snapshot.text
        vid = snapshot.json()["id"]
        big = "한글원고와😀\n" * 35000
        large = client.put(
            base + "/chapter",
            headers=headers,
            json={"revision": 2, "content": big, "title": "대형 본문"},
        )
        assert large.status_code == 200, large.text
        assert large.json()["contentRef"] and large.json()["content"] == big
        direct = (
            r.ref(owner, "projects", pid)
            .collection("chapters")
            .document("chapter-1")
            .get()
            .to_dict()
        )
        assert direct["content"] == "" and direct["contentByteLength"] == len(
            big.encode()
        )
        restored = client.post(
            base + "/chapter/restore",
            headers=headers,
            json={"revision": 3, "versionId": vid},
        )
        assert restored.status_code == 200, restored.text
        assert restored.json()["content"] == ch["content"]
        assert restored.json()["revision"] == 4
        # A separate HTTP client reads the same server revision, never a local cache.
    with TestClient(app) as second_device:
        after = second_device.get(base + "/chapter", headers=headers)
        assert after.status_code == 200 and after.json()["content"] == ch["content"]
