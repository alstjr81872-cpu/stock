import io
import json
import zipfile
import pytest
from fastapi import HTTPException
from backend import repository as r, ai
from backend.parsers import extract, overlap
from backend.mock_ai import MODULES, response
from backend.schemas import Analysis, BibleSection, StyleAnalysis, Plot, Review, Rewrite

BRIEF = "장르: 현대 판타지\n주인공은 성인 기록관. 사라진 약속을 찾는다.\n성장에는 대가가 있고 과거 사건을 소급 변경하지 않는다.\n목표: 120화. 잔잔한 여운을 남긴다."
NOTES = "가까운 3인칭 시점. 대사는 경쾌하되 감정의 여운을 지키고, 전투는 짧은 호흡으로. 기계적인 전환과 번역투는 피한다."


def ok(res):
    assert res.status_code == 200, res.text
    return res.json()


def fresh(client):
    return ok(
        client.post(
            "/api/projects",
            data={"title": "약속을 기록하는 밤", "genre": "현대 판타지"},
            files={"file": ("brief.txt", BRIEF.encode(), "text/plain")},
        )
    )


def reset_rate(client):
    data = client.fake_db.store.get("users/alice")
    if data:
        data["rate"] = {"minute": "old", "requests": 0}


def ai_req(item):
    return {"revision": item["revision"], "consent": True, "maxCostUsd": 0.15}


def style(client):
    s = ok(
        client.post(
            "/api/styles",
            json={"name": "담백한 시선", "sourceType": "interview", "notes": NOTES},
        )
    )
    s = ok(client.post(f"/api/styles/{s['id']}/analyze", json=ai_req(s)))
    return ok(
        client.post(
            f"/api/styles/{s['id']}/approve",
            json={"revision": s["revision"], "confirmed": True, "variant": "B"},
        )
    )


def prepared(client):
    s = style(client)
    p = fresh(client)
    base = "/api/projects/" + p["id"]
    p = ok(client.post(base + "/analyze", json=ai_req(p)))
    p = ok(
        client.put(
            base + "/answers",
            json={
                "revision": p["revision"],
                "answers": {
                    q["id"]: "사용자가 직접 확정한 목표와 경계"
                    for q in p["analysis"]["questions"]
                },
            },
        )
    )
    for k in MODULES:
        reset_rate(client)
        p = ok(client.post(base + "/sections/" + k + "/generate", json=ai_req(p)))
    p = ok(
        client.post(
            base + "/style", json={"revision": p["revision"], "styleId": s["id"]}
        )
    )
    reset_rate(client)
    p = ok(client.post(base + "/bible/review", json=ai_req(p)))
    p = ok(
        client.post(
            base + "/approve", json={"revision": p["revision"], "confirmed": True}
        )
    )
    reset_rate(client)
    p = ok(client.post(base + "/plot/generate", json=ai_req(p)))
    p = ok(
        client.post(
            base + "/plot/approve", json={"revision": p["revision"], "confirmed": True}
        )
    )
    return p


def written(client, p):
    ch = None
    for scene in p["plot"]["scenes"]:
        reset_rate(client)
        ch = ok(
            client.post(
                f"/api/projects/{p['id']}/scenes/{scene['id']}/write", json=ai_req(p)
            )
        )
    return ch


def test_full_approval_writing_revision_restore_export(client):
    p = prepared(client)
    ch = written(client, p)
    base = "/api/projects/" + p["id"]
    assert ch["writtenScenes"] == ["s1", "s2"]
    version = ok(
        client.post(base + "/chapter/snapshot", json={"revision": ch["revision"]})
    )
    original = ch["content"]
    changed = original + "\n\n수동으로 기록한 새로운 문장."
    ch = ok(
        client.put(
            base + "/chapter",
            json={"revision": ch["revision"], "content": changed, "title": "고친 제목"},
        )
    )
    assert ch["content"] == changed
    ch = ok(
        client.post(
            base + "/chapter/restore",
            json={"revision": ch["revision"], "versionId": version["id"]},
        )
    )
    assert ch["content"] == original
    reset_rate(client)
    ch = ok(client.post(base + "/chapter/review", json=ai_req(ch)))
    assert ch["review"]["findings"][0]["quote"] in ch["content"]
    ch = ok(
        client.post(
            base + "/chapter/approve",
            json={"revision": ch["revision"], "confirmed": True, "reviewed": True},
        )
    )
    assert ch["status"] == "APPROVED" and ch["approvedTextHash"] == ch["contentHash"]
    again = client.post(
        base + "/chapter/approve",
        json={"revision": ch["revision"], "confirmed": True, "reviewed": True},
    )
    assert again.status_code == 409
    exported = client.get(base + "/export")
    assert exported.status_code == 200
    with zipfile.ZipFile(io.BytesIO(exported.content)) as z:
        assert z.read("chapters/chapter-1.txt").decode() == original
    ch = ok(
        client.put(
            base + "/chapter",
            json={
                "revision": ch["revision"],
                "content": original + " 새 초안",
                "title": ch["title"],
            },
        )
    )
    assert ch["status"] == "REVIEW" and ch["approvalStatus"] == "DRAFT"
    current = ok(client.get(base))
    assert current["plot"]["status"] == "INVALIDATED"


def test_authentication_and_cross_user_paths(client):
    p = fresh(client)
    assert client.get("/api/projects", headers={"Authorization": ""}).status_code == 401
    assert (
        client.get(
            "/api/projects", headers={"Authorization": "Bearer forged"}
        ).status_code
        == 401
    )
    headers = {"Authorization": "Bearer bob"}
    assert client.get("/api/projects/" + p["id"], headers=headers).status_code == 404
    assert client.get("/api/projects", headers=headers).json() == []
    assert (
        client.post(
            "/api/projects/" + p["id"] + "/approve",
            headers=headers,
            json={"revision": 1, "confirmed": True},
        ).status_code
        == 404
    )
    assert all(k.startswith("users/") for k in client.fake_db.store)


def test_server_gates_without_approval(client):
    p = fresh(client)
    base = "/api/projects/" + p["id"]
    assert (
        client.post(
            base + "/approve", json={"revision": 1, "confirmed": False}
        ).status_code
        == 409
    )
    assert (
        client.post(
            base + "/approve", json={"revision": 1, "confirmed": True}
        ).status_code
        == 409
    )
    assert client.post(base + "/plot/generate", json=ai_req(p)).status_code == 409
    assert client.post(base + "/scenes/s1/write", json=ai_req(p)).status_code == 409
    assert (
        client.post(base + "/sections/world/generate", json=ai_req(p)).status_code
        == 409
    )


def test_original_upload_exact_bytes_and_cp949(client):
    raw = BRIEF.encode("cp949")
    p = ok(
        client.post(
            "/api/projects",
            data={"title": "인코딩 검사"},
            files={"file": ("brief.txt", raw, "text/plain")},
        )
    )
    assert p["brief"]["text"] == BRIEF and p["brief"]["encoding"] == "cp949"
    assert client.fake_storage.store[p["brief"]["file"]["path"]] == raw
    assert len(p["requirements"]) == 4


def test_requirements_cannot_be_deleted_through_section_edit(client):
    p = prepared(client)
    base = "/api/projects/" + p["id"]
    for key in MODULES:
        data = {
            k: v
            for k, v in p["bible"][key].items()
            if k not in ["run", "needsReview", "editedBy"]
        }
        data["requirementIds"] = []
        p = ok(
            client.put(
                base + "/sections/" + key,
                json={"revision": p["revision"], "section": data},
            )
        )
    for key in MODULES:
        p = ok(
            client.post(
                base + "/sections/" + key + "/reviewed",
                json={"revision": p["revision"], "confirmed": True},
            )
        )
    reset_rate(client)
    p = ok(client.post(base + "/bible/review", json=ai_req(p)))
    res = client.post(
        base + "/approve", json={"revision": p["revision"], "confirmed": True}
    )
    assert res.status_code == 409 and "반영되지 않은 원문" in res.text


def test_conflict_never_silently_overwrites(client):
    p = prepared(client)
    ch = written(client, p)
    base = "/api/projects/" + p["id"]
    first = ok(
        client.put(
            base + "/chapter",
            json={"revision": ch["revision"], "content": "A창의 원고", "title": "A"},
        )
    )
    res = client.put(
        base + "/chapter",
        json={"revision": ch["revision"], "content": "B창의 원고", "title": "B"},
    )
    assert res.status_code == 409
    assert ok(client.get(base + "/chapter"))["content"] == "A창의 원고"
    assert res.json()["detail"]["currentRevision"] == first["revision"]


def test_large_korean_content_storage_branch_integrity(client):
    p = prepared(client)
    ch = written(client, p)
    base = "/api/projects/" + p["id"]
    text = "한글원고와😀\n" * 35000
    saved = ok(
        client.put(
            base + "/chapter",
            json={"revision": ch["revision"], "content": text, "title": "대형 원고"},
        )
    )
    assert saved["content"] == text and saved["contentRef"]
    assert saved["contentByteLength"] == len(text.encode())
    raw = client.fake_db.store[f"users/alice/projects/{p['id']}/chapters/chapter-1"]
    assert raw["content"] == ""
    assert ok(client.get(base + "/chapter"))["content"] == text


def test_partial_rewrite_preserves_unselected_text_and_archives(client):
    p = prepared(client)
    ch = written(client, p)
    base = "/api/projects/" + p["id"]
    old = ch["content"]
    start, end = 12, 39
    reset_rate(client)
    proposal = ok(
        client.post(
            base + "/chapter/rewrite",
            json={
                **ai_req(ch),
                "start": start,
                "end": end,
                "instruction": "호흡을 자연스럽게 고쳐주세요.",
            },
        )
    )
    assert ok(client.get(base + "/chapter"))["content"] == old
    changed = ok(
        client.post(
            base + "/chapter/rewrite/apply",
            json={"revision": ch["revision"], "proposalId": proposal["id"]},
        )
    )
    assert changed["content"][:start] == old[:start]
    assert changed["content"][start + len(proposal["replacement"]) :] == old[end:]
    assert changed["status"] == "REQUIRES_HUMAN"
    assert len(ok(client.get(base + "/chapter/versions"))) == 1


def test_style_pinned_version_does_not_follow_library_edit(client):
    p = prepared(client)
    binding = p["styleBinding"]
    s = ok(client.get("/api/styles/" + binding["styleId"]))
    data = {k: v for k, v in s["analysis"].items()}
    data["variants"][0]["rules"]["perspective"] = "1인칭 고정"
    s = ok(
        client.put(
            "/api/styles/" + s["id"] + "/analysis",
            json={"revision": s["revision"], "analysis": data},
        )
    )
    s = ok(
        client.post(
            "/api/styles/" + s["id"] + "/approve",
            json={"revision": s["revision"], "variant": "A", "confirmed": True},
        )
    )
    assert s["profileVersion"] == 2
    assert ok(client.get("/api/projects/" + p["id"]))["styleBinding"] == binding


def test_trash_restore_preserves_data(client):
    p = fresh(client)
    base = "/api/projects/" + p["id"]
    p = ok(client.post(base + "/trash", json={"revision": p["revision"]}))
    assert p["deletedAt"]
    assert client.post(base + "/analyze", json=ai_req(p)).status_code == 404
    p = ok(client.post(base + "/restore", json={"revision": p["revision"]}))
    assert p["brief"]["text"] == BRIEF and not p["deletedAt"]


def test_api_consent_and_budget_before_submission(client):
    p = fresh(client)
    base = "/api/projects/" + p["id"]
    assert (
        client.post(
            base + "/analyze", json={"revision": 1, "consent": False}
        ).status_code
        == 400
    )
    config = ok(client.get("/api/me"))["settings"]
    config["monthlyBudgetUsd"] = 0
    ok(client.put("/api/settings", json=config))
    # Free development fixture fits zero; reserve itself rejects real nonzero spend.
    with pytest.raises(HTTPException) as err:
        ai.reserve("alice", "job-test", 0.01, "analysis", "demo")
    assert err.value.status_code == 402
    assert not client.fake_db.store.get("users/alice/usage/job-test")


def test_ambiguous_charge_keeps_reservation(client):
    ai.reserve("alice", "test-request", 0.2, "write", "provider/model")
    ai.complete("alice", "test-request", "UNCERTAIN", None, {"error": "timeout"})
    assert client.fake_db.store["users/alice"]["spend"]["reservedUsd"] == 0.2
    assert (
        client.fake_db.store["users/alice/usage/test-request"]["status"] == "UNCERTAIN"
    )
    # Double finalization must not refund twice.
    ai.complete("alice", "test-request", "COMPLETED", 0, {})
    assert client.fake_db.store["users/alice"]["spend"]["reservedUsd"] == 0.2


def test_rate_limit_enforced(client):
    for i in range(12):
        ai.reserve("alice", f"j{i}", 0, "analysis", "demo")
    with pytest.raises(HTTPException) as err:
        ai.reserve("alice", "j13", 0, "analysis", "demo")
    assert err.value.status_code == 429


@pytest.mark.parametrize(
    "filename,raw",
    [
        ("bad.exe", b"data"),
        ("bad.txt", b"abc\x00def"),
        ("bad.pdf", b"not-a-pdf"),
        ("bad.docx", b"not-a-zip"),
    ],
)
def test_unsafe_upload_rejected(filename, raw):
    with pytest.raises(HTTPException):
        extract(filename, raw)


def test_zip_bomb_and_drm_rejected():
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("word/document.xml", b"x" * (33 * 1024 * 1024))
    with pytest.raises(HTTPException):
        extract("bomb.docx", data.getvalue())
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as z:
        z.writestr("META-INF/encryption.xml", "encrypted")
    with pytest.raises(HTTPException):
        extract("book.epub", data.getvalue())


def test_reference_overlap_blocks_copy():
    source = "아주 독특한 긴 문장은 참고 작품의 등장인물이 선택한 세계의 비밀을 상세하게 묘사합니다."
    assert overlap(source, source)
    assert not overlap(
        source, "전혀 다른 사건 속에서 새로운 등장인물이 우산을 나눠 썼다."
    )


@pytest.mark.parametrize(
    "task,schema,data",
    [
        ("analysis", Analysis, {}),
        (
            "section",
            BibleSection,
            {"section": "world", "requirements": [{"id": "R001"}]},
        ),
        ("style", StyleAnalysis, {}),
        ("plot", Plot, {}),
        ("review", Review, {"content": "검토할 긴 원고의 첫 번째 장면입니다."}),
        ("rewrite", Rewrite, {"passage": "이 부분을 고친다."}),
    ],
)
def test_development_response_contract(task, schema, data):
    schema.model_validate(response(task, data))


def test_latest_bible_audit_required_after_content_change(client):
    p = prepared(client)
    base = "/api/projects/" + p["id"]
    key = "world"
    data = {
        k: v
        for k, v in p["bible"][key].items()
        if k not in ["run", "needsReview", "editedBy"]
    }
    data["content"] += " 새로운 제약은 인물의 선택에 구체적인 대가를 부여한다."
    p = ok(
        client.put(
            base + "/sections/" + key, json={"revision": p["revision"], "section": data}
        )
    )
    res = client.post(
        base + "/approve", json={"revision": p["revision"], "confirmed": True}
    )
    assert res.status_code == 409 and "교차 검토" in res.text


def test_deferred_required_answer_is_not_a_decision(client):
    p = fresh(client)
    base = "/api/projects/" + p["id"]
    p = ok(client.post(base + "/analyze", json=ai_req(p)))
    p = ok(
        client.put(
            base + "/answers",
            json={
                "revision": p["revision"],
                "answers": {q["id"]: "보류" for q in p["analysis"]["questions"]},
            },
        )
    )
    assert (
        client.post(base + "/sections/concept/generate", json=ai_req(p)).status_code
        == 409
    )


def test_invalid_live_model_response_never_leaks_key_or_retries(client, monkeypatch):
    from dataclasses import replace
    import httpx

    monkeypatch.setattr(ai, "settings", replace(ai.settings, ai_mode="live"))
    monkeypatch.setenv("OPENROUTER_API_KEY", "unit-secret-never-print")
    monkeypatch.setattr(
        ai,
        "catalog",
        lambda *a, **kw: {
            "data": [
                {
                    "id": "test/provider-model",
                    "context_length": 262144,
                    "pricing": {"prompt": "0.0000001", "completion": "0.0000001"},
                    "supported_parameters": ["response_format"],
                }
            ]
        },
    )
    config = {
        "models": {role: "test/provider-model" for role in ai.ROLES},
        "monthlyBudgetUsd": 5,
        "maxOutputTokens": 3000,
    }
    ok(client.put("/api/settings", json=config))
    calls = []

    def invalid(url, **kwargs):
        calls.append(url)
        assert url == "https://openrouter.ai/api/v1/chat/completions"
        return httpx.Response(
            200,
            json={
                "id": "generation-test",
                "usage": {},
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {"content": '{"wrong":"unit-secret-never-print"}'},
                    }
                ],
            },
        )

    monkeypatch.setattr(ai.httpx, "post", invalid)
    p = fresh(client)
    res = client.post("/api/projects/" + p["id"] + "/analyze", json=ai_req(p))
    assert res.status_code == 502 and "unit-secret" not in res.text
    assert len(calls) == 1
    usage = ok(client.get("/api/usage"))
    assert usage[0]["status"] == "UNCERTAIN"
    assert usage[0]["reservedUsd"] > 0 and usage[0]["actualUsd"] is None
    assert ok(client.get("/api/projects/" + p["id"]))["status"] == "IDEA"


def test_stale_large_save_does_not_create_storage_orphans(client):
    p = prepared(client)
    ch = written(client, p)
    base = "/api/projects/" + p["id"]
    ok(
        client.put(
            base + "/chapter",
            json={
                "revision": ch["revision"],
                "content": "먼저 저장한 새 버전",
                "title": ch["title"],
            },
        )
    )
    before = set(client.fake_storage.store)
    res = client.put(
        base + "/chapter",
        json={
            "revision": ch["revision"],
            "content": "대형한글원고" * 50000,
            "title": ch["title"],
        },
    )
    assert res.status_code == 409
    assert set(client.fake_storage.store) == before
