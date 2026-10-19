# Cloudflare Free + Supabase Free 배포

현재 권장 배포 경로입니다. Firebase/Cloud Run 결제 연결과 서버 대여는 필요하지 않습니다.
Google Cloud 프로젝트는 OAuth 클라이언트에만 사용합니다. OpenRouter 호출은 유료입니다.
사용자가 Supabase SQL 실행 성공을 확인했습니다. 서버 비밀 키 설정, 공개 배포 및 실제 서비스 연결 검증은 아직 남아 있습니다.

## 1. 데이터베이스 준비

Supabase 프로젝트 → SQL Editor → New query에서
`supabase/migrations/202610190001_novelforge.sql` 전체를 붙여넣고 Run 합니다.
새 테이블 2개, 서버 전용 함수 2개, 비공개 `novelforge` Storage 버킷을 생성합니다.
브라우저의 데이터베이스/Storage 직접 접근은 허용하지 않습니다.
이 SQL은 신규 데이터베이스용이며 기존 Firebase 데이터를 자동 이관하지 않습니다.

## 2. 서버용 비밀 설정

Cloudflare Workers의 `novelforge-ai` → Settings → Variables and Secrets:

| 이름 | 유형 | 입력할 값 |
| --- | --- | --- |
| `SUPABASE_URL` | 일반 변수 | `https://wqzavlosvhljstkxwhle.supabase.co` (wrangler 설정에 포함) |
| `ALLOWED_EMAILS` | 일반 변수 | 로그인할 본인의 Google 이메일. 여러 개면 쉼표 구분 |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | Supabase Settings → API Keys → Legacy API Keys → service_role |
| `OPENROUTER_API_KEY` | **Secret** | OpenRouter에서 발급한 API 키 |

`sb_secret_` 신형 Secret 키 대신 위 **Legacy service_role JWT**를 사용합니다.
현재 REST 어댑터는 apikey와 Bearer 모두에 이 키를 사용합니다.
서비스 키는 전체 데이터 접근 권한이 있으므로 채팅, GitHub, NEXT_PUBLIC 변수에 넣지 않습니다.
Google OAuth Client Secret은 Supabase Google Provider 설정에만 보관합니다.
ALLOWED_EMAILS 미설정 또는 다른 이메일은 접근을 차단합니다. Google 제공자와 이메일 확인 상태를 서버에서 확인합니다.

## 3. 빌드와 배포

Node.js 24 이상. 저장소 루트에서:

```bash
npm ci --cache /tmp/novelforge-npm-cache
npm run test:cloud
npm run build:cloud
npm run check:cloud
```

공개 프런트엔드 설정은 `.env.cloud.example`에 있습니다. 공개 publishable 키는 비밀이 아닙니다.
`build:cloud`는 이 값을 기본값으로 읽고 실제 환경 변수로 덮어쓸 수 있습니다.
Next 정적 사이트는 `out/`에, API는 `worker/`에 있습니다. Python 서버는 배포에 필요하지 않습니다.
`check:cloud`는 업로드 없는 dry run입니다.

Cloudflare 화면에서 **Create application → Import a repository** (메뉴가 Git repository로 보일 수도 있음):

- 이 변경 사항이 들어 있는 저장소/브랜치를 선택합니다. 선택한 브랜치에 `wrangler.jsonc`와 `build:cloud` 스크립트가 있는지 확인하세요.
- Build command: `npm run build:cloud`
- Deploy command: `npx wrangler deploy`
- Root directory: 저장소 루트
- Node version: 24 (`.node-version` 포함)
- 무료 Workers 플랜 유지. R2/유료 Workers/도메인 구매 불필요.

CLI 인증이 된 별도 환경에서는 `npm run deploy:cloud`도 가능합니다.
대시보드 파일 드래그 업로드만 하면 API가 배포되지 않습니다. **Workers 정적 Assets + Worker API**를 함께 배포합니다.
키가 없는 초기 배포는 로그인 후 API를 차단합니다. 2단계 값을 입력하고 재배포하세요.
GitHub 연결/배포는 사용자 계정 화면에서 수행하며 이 작업에서는 외부 계정을 조작하지 않았습니다.

## 4. 로그인 돌아올 주소

배포 후 `https://novelforge-ai.<계정 하위 도메인>.workers.dev` 실제 주소를 확인합니다.
Supabase → Authentication → URL Configuration:

- Site URL: 실제 배포 주소
- Redirect URLs: 실제 배포 주소 끝에 `/`를 붙인 값

Google Cloud의 승인된 리디렉션 URI는 **계속 Supabase callback**입니다:
`https://wqzavlosvhljstkxwhle.supabase.co/auth/v1/callback`
Google OAuth 앱이 Testing이면 본인 Google 이메일을 Audience → Test users에 추가합니다.

## 5. 공개 배포 확인

- Google 로그인 → 내 계정만 진입, 다른 계정 차단.
- 설정에서 역할 8개의 OpenRouter 모델 선택, 작은 월 예산과 요청 상한 설정. 응답 토큰은 자동 배분되며 수동 설정이 필요하지 않습니다.
- 작은 TXT 업로드 → 새로고침/다른 브라우저에서 같은 기획서 조회.
- 11개 모듈/문체/교차검토 승인 → 플롯 → 원고 저장 → 버전 복원 → ZIP 내보내기.
- Supabase 사용량과 Cloudflare CPU/요청 실패, OpenRouter 실제 비용 확인.

`/api/health`의 configured는 변수 존재만 뜻하며 실제 DB/로그인 준비 완료를 뜻하지 않습니다.
실제 서비스 인증과 데이터 쓰기는 이 단계에서 별도 검증해야 합니다.

## 무료 플랜의 범위

유료 플랜으로 자동 전환하는 앱 코드는 없습니다. 실제 플랜과 과금 설정은 서비스 대시보드에서 관리합니다.
앱은 DB JSON 데이터 약 100MB, Storage 예약 총 600MB에서 신규 쓰기를 중단합니다.
원고/자료 삭제 시 예약 용량을 자동 환급하지 않으며, 실패한 업로드도 예약을 유지합니다.
보수적 한도는 이 앱의 데이터만 관리하며 Supabase 전체 프로젝트 용량을 실시간 측정하지는 않습니다.
서비스 자체 무료 한도/정책은 변경될 수 있으므로 제공자 사용량 화면이 기준입니다.

Workers Free는 CPU/요청 수 제한이 있습니다. 큰 PDF·압축 파일·대용량 ZIP 내보내기는 제한에 걸릴 수 있습니다.
가벼운 TXT를 권장합니다. 제한이 걸리면 요청은 실패하며 유료 플랜을 자동 활성화하지 않습니다.
실제 Free 환경의 최대 파일/작품 크기는 배포 후 측정해야 합니다. 로컬 테스트만으로 CPU 한도 충족을 보장하지 않습니다.
OpenRouter 대기 시간은 외부 I/O이며 자동 재호출하지 않습니다. 응답 미확정 시 예약 비용을 유지합니다.
Supabase Free의 비활성 프로젝트 일시 중지와 자동 백업 제공 범위를 확인하고 수동 ZIP을 주기적으로 보관하세요.

## 개발 환경

```bash
bash scripts/setup-cloud.sh
bash scripts/dev-cloud.sh
```

필요한 서버 환경 변수는 안전한 환경 설정이나 Git에서 제외된 `.dev.vars`로 제공합니다.
`dev:cloud`는 생성된 정적 화면을 사용하므로 UI 변경 후 `build:cloud`를 다시 실행합니다.
기존 `scripts/dev.sh`는 보존된 Firebase Emulator 개발 경로입니다. 실제 Supabase 데이터와 공유되지 않습니다.

검증: PGlite PostgreSQL에서 실제 migration 함수/권한/CAS 실행 + TypeScript API 흐름 테스트.
테스트용 REST/Storage/인증/OpenRouter 어댑터를 사용하며 실제 Supabase/Google/OpenRouter 통합 성공과 구분합니다.
