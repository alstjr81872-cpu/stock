import {
  type Doc,
  type Env,
  HttpError,
  requireThat,
  now,
  id,
  bytes,
  hash,
  revision,
  length,
} from "./shared";
export type Operation = {
  path: string;
  expected: number;
  data?: Doc;
  guard?: boolean;
};
export class Store {
  constructor(
    public env: Env,
    public uid: string,
    private transport: typeof fetch = fetch,
  ) {}
  async request(path: string, init: RequestInit = {}) {
    const res = await this.transport(this.env.SUPABASE_URL + path, {
      ...init,
      headers: {
        apikey: this.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: "Bearer " + this.env.SUPABASE_SERVICE_ROLE_KEY,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      if (text.includes("REVISION_CONFLICT") || res.status === 409)
        throw new HttpError(
          409,
          "다른 창에서 변경되었습니다. 다시 불러와 비교하세요.",
        );
      if (text.includes("FREE_STORAGE_LIMIT"))
        throw new HttpError(
          507,
          "무료 저장 한도에 도달했습니다. 내보내기 후 정리해주세요.",
        );
      throw new HttpError(
        503,
        "Supabase 저장소 요청에 실패했습니다. 설정과 무료 사용량을 확인하세요.",
      );
    }
    return res;
  }
  async rpc(name: string, body: Doc) {
    await this.request("/rest/v1/rpc/" + name, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
  async find(path: string): Promise<Doc | null> {
    const q = new URLSearchParams({
      owner_id: "eq." + this.uid,
      path: "eq." + path,
      select: "data",
      limit: "1",
    });
    const rows = (await (
      await this.request("/rest/v1/nf_documents?" + q)
    ).json()) as { data: Doc }[];
    return rows[0]?.data ?? null;
  }
  async get(path: string, deleted = false): Promise<Doc> {
    const d = await this.find(path);
    requireThat(
      d && d.ownerUid === this.uid && (deleted || !d.deletedAt),
      "항목을 찾을 수 없습니다.",
      404,
    );
    return d;
  }
  async list(prefix: string): Promise<Doc[]> {
    const q = new URLSearchParams({
      owner_id: "eq." + this.uid,
      path: "like." + prefix + "/*",
      select: "data,path",
      order: "updated_at.desc",
      limit: "201",
    });
    q.append("path", "not.like." + prefix + "/*/*");
    const rows = (await (
      await this.request("/rest/v1/nf_documents?" + q)
    ).json()) as { data: Doc; path: string }[];
    return rows
      .filter((r) => r.path.slice(prefix.length + 1).indexOf("/") === -1)
      .slice(0, 200)
      .map((r) => r.data);
  }
  prepare(path: string, data: Doc, expected = 0): Operation {
    const prepared = {
      ...data,
      ownerUid: this.uid,
      revision: expected + 1,
      updatedAt: now(),
    };
    requireThat(
      bytes(JSON.stringify(prepared)).length < 850000,
      "문서가 너무 큽니다.",
      413,
    );
    return { path, expected, data: prepared };
  }
  async commit(ops: Operation[]) {
    await this.rpc("nf_commit", { p_owner: this.uid, p_operations: ops });
  }
  async create(path: string, data: Doc) {
    const op = this.prepare(path, {
      id: path.split("/").at(-1),
      createdAt: now(),
      ...data,
    });
    await this.commit([op]);
    return op.data!;
  }
  async change(
    path: string,
    expected: number,
    fn: (d: Doc) => unknown | Promise<unknown>,
    extras: (d: Doc) => Operation[] = () => [],
  ) {
    const d = await this.get(path, true);
    revision(d, expected);
    await fn(d);
    const op = this.prepare(path, d, expected);
    await this.commit([op, ...extras(op.data!)]);
    return op.data!;
  }
  async put(path: string, raw: Uint8Array, type = "text/plain; charset=utf-8") {
    requireThat(
      path.startsWith("users/" + this.uid + "/"),
      "자료 접근 권한이 없습니다.",
      403,
    );
    // A failed upload retains its quota reservation; retry always uses a new object ID.
    await this.rpc("nf_reserve_storage", {
      p_owner: this.uid,
      p_path: path,
      p_bytes: raw.length,
    });
    await this.request("/storage/v1/object/novelforge/" + path, {
      method: "POST",
      headers: { "Content-Type": type, "x-upsert": "false" },
      body: raw as BodyInit,
    });
    return {
      path,
      sha256: await hash(raw),
      byteLength: raw.length,
      createdAt: now(),
    };
  }
  async read(info: Doc) {
    requireThat(
      info.path.startsWith("users/" + this.uid + "/"),
      "자료 접근 권한이 없습니다.",
      403,
    );
    const data = new Uint8Array(
      await (
        await this.request("/storage/v1/object/novelforge/" + info.path)
      ).arrayBuffer(),
    );
    requireThat(
      (await hash(data)) === info.sha256,
      "저장 자료 무결성 확인에 실패했습니다.",
      500,
    );
    return data;
  }
  async remove(info: Doc) {
    requireThat(
      info.path.startsWith("users/" + this.uid + "/"),
      "자료 접근 권한이 없습니다.",
      403,
    );
    await this.request("/storage/v1/object/novelforge", {
      method: "DELETE",
      body: JSON.stringify({ prefixes: [info.path] }),
    });
    // Retain conservative reservation. Admin reconciliation is explicit and never automatic.
  }
  async content(pid: string, text: string) {
    requireThat(
      length(text) <= 1000000,
      "원고는 100만 자 이하여야 합니다.",
      413,
    );
    const data: Doc = {
      contentHash: await hash(text),
      contentByteLength: bytes(text).length,
      charCountWithSpaces: length(text),
      charCountWithoutSpaces: length(text.replace(/\s/g, "")),
    };
    if (data.contentByteLength > 650000)
      Object.assign(data, {
        content: "",
        contentRef: await this.put(
          `users/${this.uid}/projects/${pid}/large/${id()}.txt`,
          bytes(text),
        ),
      });
    else Object.assign(data, { content: text, contentRef: null });
    return data;
  }
  async hydrate(d: Doc): Promise<Doc> {
    return {
      ...d,
      content: d.contentRef
        ? new TextDecoder().decode(await this.read(d.contentRef))
        : d.content,
    };
  }
  async archive(pid: string, ch: Doc) {
    const key = id();
    const info = await this.put(
      `users/${this.uid}/projects/${pid}/versions/${key}.txt`,
      bytes(ch.content),
    );
    return this.prepare(`projects/${pid}/chapter_versions/${key}`, {
      id: key,
      ...info,
      status: "COMMITTED",
      title: ch.title,
      revisionOfContent: ch.revision,
      charCount: ch.charCountWithSpaces,
    });
  }
}
