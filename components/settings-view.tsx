"use client";
import { useEffect, useState } from "react";
import {
  Coins,
  Download,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { api, send, roles, date } from "@/lib/api";
import { Badge, Empty, useActions } from "./workspace";
import { Button } from "./ui/button";
export default function SettingsView({ me }: { me: any }) {
  const { run, busy, notify, refresh } = useActions();
  const [catalog, setCatalog] = useState<any>(null),
    [config, setConfig] = useState<any>(
      me?.settings || {
        models: {},
        monthlyBudgetUsd: 5,
        outputTokenMode: "auto",
      },
    ),
    [usage, setUsage] = useState<any[]>([]),
    [filter, setFilter] = useState("");
  async function load() {
    const [c, u] = await Promise.all([api("/models"), api("/usage")]);
    setCatalog(c);
    setUsage(u);
  }
  useEffect(() => {
    run(load);
  }, []);
  if (!me) return null;
  const total = usage.reduce(
    (n, u) => n + (u.actualUsd ?? u.reservedUsd ?? 0),
    0,
  );
  const candidates =
    catalog?.data.filter(
      (m: any) =>
        m.id.includes(filter) ||
        m.name?.toLowerCase().includes(filter.toLowerCase()),
    ) || [];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">MODELS & USAGE</div>
          <h1>도구는 유연하게, 비용은 명확하게.</h1>
          <p>역할마다 모델을 선택하고, 실행 한도는 서버에서 지킵니다.</p>
        </div>
        <Button variant="secondary" onClick={() => run(load)}>
          모델 목록 새로고침
        </Button>
      </div>
      <div className="stats-row settings-stats">
        <div className="stat-card">
          <span>월 예산 예약 · 확인 금액</span>
          <strong>${(me.spend?.reservedUsd || 0).toFixed(4)}</strong>
          <small>미확정 요청은 예약을 유지합니다.</small>
        </div>
        <div className="stat-card">
          <span>표시된 요청 합계</span>
          <strong>${total.toFixed(4)}</strong>
          <small>최대 최근 200건</small>
        </div>
        <div className="stat-card">
          <span>AI 연결 모드</span>
          <strong className="text-stat">
            {me.aiMode === "mock" ? "개발용 응답" : "OpenRouter"}
          </strong>
          <small>
            {me.aiMode === "mock"
              ? "모델 품질·실제 과금 검증 아님"
              : "선택 모델의 정책과 지원 범위를 확인하세요."}
          </small>
        </div>
      </div>
      <div className="workspace-columns">
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await send(
                "/settings",
                {
                  models: config.models,
                  monthlyBudgetUsd: config.monthlyBudgetUsd,
                },
                "PUT",
              );
              await refresh();
              notify("역할별 모델과 비용 한도를 저장했습니다.");
            });
          }}
        >
          <div className="panel-heading">
            <h2>
              <Settings2 size={18} />
              역할별 모델
            </h2>
            <Badge tone="purple">OPENROUTER ONLY</Badge>
          </div>
          <p className="muted">
            첫 집필 후보: thedrummer/cydonia-24b-v4.1. 현재 목록에 실제 존재할
            때만 선택할 수 있습니다. 정책 지원을 자동 보장하지 않습니다.
          </p>
          <label>
            모델 검색
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="모델 ID 또는 이름 검색"
            />
          </label>
          {catalog && (
            <p className="field-hint">
              조회 {date(catalog.fetchedAt)} · {catalog.data.length}개 모델 ·{" "}
              {catalog.mode}
            </p>
          )}
          <div className="role-grid">
            {Object.entries(roles).map(([key, label]) => (
              <label key={key}>
                {label}
                <select
                  value={config.models[key] || ""}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      models: { ...config.models, [key]: e.target.value },
                    })
                  }
                >
                  <option value="">모델 선택</option>
                  {catalog?.data
                    .filter(
                      (m: any) =>
                        m.id === config.models[key] ||
                        candidates.some((c: any) => c.id === m.id),
                    )
                    .map((m: any) => (
                      <option key={m.id} value={m.id}>
                        {m.name || m.id} · {m.context_length?.toLocaleString()}{" "}
                        tokens
                      </option>
                    ))}
                </select>
                {config.models[key] && (
                  <small className="field-hint">{config.models[key]}</small>
                )}
              </label>
            ))}
          </div>
          <div className="role-grid">
            <label>
              개인 월 실행 예산 (USD)
              <input
                type="number"
                min="0"
                max="500"
                step="0.1"
                value={config.monthlyBudgetUsd}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    monthlyBudgetUsd: Number(e.target.value),
                  })
                }
              />
            </label>
            <div>
              <p>응답 길이 자동 조절</p>
              <p className="muted">
                작업과 모델에 맞춰 필요한 응답 공간을 자동으로 확보합니다. 기존
                토큰 설정은 적용하지 않습니다.
              </p>
            </div>
          </div>
          <p className="muted">
            최대 분당 12회 · 하루 200회. 응답 전 보수적 최대 모델 비용을
            예약합니다. 타임아웃은 과금 여부가 불명확하므로 자동 재요청하지
            않습니다.
          </p>
          <Button type="submit" disabled={busy || !catalog}>
            <Save size={16} />
            모델 · 한도 저장
          </Button>
        </form>
        <aside>
          <div className="panel">
            <h3>
              <ShieldCheck size={17} />
              연결과 저장
            </h3>
            <dl className="definition-list">
              <dt>계정 UID</dt>
              <dd className="mono">{me.uid}</dd>
              <dt>데이터 저장</dt>
              <dd>
                {me.mode === "emulator"
                  ? "로컬 Firebase Emulator"
                  : me.mode === "supabase"
                    ? "Supabase 데이터베이스 + Storage"
                    : "Cloud Firestore + Cloud Storage"}
              </dd>
              <dt>브라우저 원고 캐시</dt>
              <dd>영구 로컬 캐시 없음</dd>
              <dt>개인 드라이브 연동</dt>
              <dd>사용하지 않음</dd>
            </dl>
            <p className="muted">
              로그인과 저장은 서버에서 계정별로 구분합니다. OpenRouter 키는
              서버의 비밀 환경 변수에만 보관합니다.
            </p>
          </div>
          <div className="panel">
            <h3>서비스 비용</h3>
            <Badge tone="amber">무료 플랜 기준 · 사용량 확인 필요</Badge>
            <p className="muted">
              이 화면의 $ 금액은 OpenRouter 요청 비용입니다. 배포는 Cloudflare와
              Supabase 무료 플랜을 기준으로 합니다. 실제 플랜 상태와 사용량은 각
              서비스 대시보드에서 확인하세요.
            </p>
            <p className="muted">
              유료 플랜으로 업그레이드하지 마세요. 무료 한도에 도달하면 서비스
              이용이 제한될 수 있습니다.
            </p>
          </div>
          <div className="panel">
            <h3>백업 상태</h3>
            <Badge tone="amber">관리 자동 백업 미구성</Badge>
            <p className="muted">{me.backup.message}</p>
            <p className="muted">
              별도 프로젝트 복구 시험 및 예약 Export는 운영 전 필수입니다.
            </p>
          </div>
        </aside>
      </div>
      <div className="section-heading">
        <h2>모델 사용 기록</h2>
        <small>실제 사용료와 미확정 예약 분리</small>
      </div>
      {!usage.length ? (
        <Empty
          title="아직 사용 기록이 없습니다"
          description="AI 요청의 모델, 토큰, 상태, 비용을 이곳에서 확인합니다."
        />
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>작업 · 시각</th>
                <th>모델</th>
                <th>상태</th>
                <th>토큰 IN / OUT</th>
                <th>비용 USD</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.task}
                    <small>{date(u.createdAt)}</small>
                  </td>
                  <td>{u.model}</td>
                  <td>
                    <Badge tone={u.status === "COMPLETED" ? "green" : "amber"}>
                      {u.status}
                    </Badge>
                  </td>
                  <td>
                    {u.tokens?.prompt_tokens ?? "—"} /{" "}
                    {u.tokens?.completion_tokens ?? "—"}
                  </td>
                  <td>
                    {u.actualUsd != null
                      ? "$" + Number(u.actualUsd).toFixed(6)
                      : "미확정 · 예약 $" + Number(u.reservedUsd).toFixed(6)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
