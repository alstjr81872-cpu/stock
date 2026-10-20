# NovelForge AI

파일에서 핵심 기획을 뽑고, 10화 시놉시스를 기록한 뒤 회차별로 집필하는 한국어 웹소설 작업 공간입니다. Stock Studio를 대체합니다. 초기 개발 기준은 [원본 v3.1 명세](docs/specification-v3.1.txt)이며, 현재 Cloudflare/Supabase 화면은 아래 흐름으로 간소화했습니다.

**파일 · 기획안 → 10화 시놉시스 → 집필**. TXT·MD·DOCX·PDF를 분석해 주인공·인물·장르·문체와 초반 독자가 기대할 재미를 정리합니다. 기획안을 확인하면 바로 첫 10화를 설계하며, 세계관은 회차 진행에 필요한 만큼 기록합니다. [빠른 연재 시작](docs/fast-story-workflow.md)을 참고하세요.

시놉시스에는 회차별 도입 사건과 보상, 복선의 투척·회수 회차/방법을 기록합니다. 10화 구간을 집필하면 다음 10화를 만들지 묻습니다. [연재 시놉시스 사용 방법](docs/serial-synopsis.md)을 참고하세요. 장면 설계의 누락·모호함은 [자동 전개](docs/story-development.md)로 구체화할 수 있습니다.

검증 범위와 이전 개발 이력은 [구현·검증 현황](docs/status.md)에 구분했습니다. 테스트 모델 응답으로 확인한 동작은 실제 문장 품질 검증과 다릅니다.

## 무료 배포 경로

**Cloudflare Workers Free + Supabase Free**용 서버와 정적 빌드를 추가했습니다. [단계별 배포 안내](docs/cloud-deployment.md)를 따르세요. `npm run build:cloud` → `npm run check:cloud`로 배포 파일을 검증합니다. 운영 계정의 SQL·Secret·Google 로그인은 배포 안내에 따라 설정합니다. 아래 Firebase 설명은 보존된 로컬 개발 경로입니다.

## 구성

- Next.js App Router / TypeScript / Tailwind / shadcn 방식 Button / TipTap 편집기
- Python FastAPI / Firebase Admin SDK
- Firebase Google 로그인, Firestore 현재 데이터, Cloud Storage 원본·대형 본문·불변 버전
- OpenRouter만 사용하는 서버 AI 어댑터와 역할별 모델 설정
- Firebase Emulator 개발 환경. PostgreSQL, Redis, Celery, Render, 개인 Drive 연동 불필요

## 로컬 실행

Node.js 24+, Python 3.11/3.12, Java 21+, Chromium이 필요합니다. 이 클라우드 체크아웃은 `/workspace/stock`입니다. 새 worktree를 만들 필요가 없습니다.

```bash
cd /workspace/stock
bash scripts/setup.sh
bash scripts/dev.sh
```

`setup.sh`는 npm 잠금 파일, Python 전체 잠금 파일, 빌드와 공식 Firebase Emulator 파일을 준비합니다. 기존 `.env.local`은 덮어쓰지 않습니다. `dev.sh`는 Auth(9099), Firestore(8080), Storage(9199), FastAPI(8000), Next.js(3000)를 실행하고 실제 Emulator 저장 검증을 먼저 수행합니다. 직접 실행하는 경우 다음처럼 서버에만 개발 환경 변수를 지정합니다.

```bash
export NF_MODE=emulator NF_AI_MODE=mock GCLOUD_PROJECT=demo-novelforge
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export STORAGE_EMULATOR_HOST=http://127.0.0.1:9199
```

로컬 모드는 `demo-` 프로젝트와 루프백 Emulator만 허용합니다. Google 로그인 버튼은 Auth Emulator의 모의 Google 계정 창을 사용합니다. 개발 계정 버튼도 실제 Auth Emulator가 발급한 ID 토큰으로 서버 인증합니다. 실제 Google 계정 인증 성공을 의미하지 않습니다. 클라우드 브라우저가 다른 기계에 있는 경우 루프백 Auth Emulator 연결은 사용할 수 없으므로, 자동 테스트 브라우저는 개발 머신 안에서 실행합니다.

로컬 데이터는 정상 종료 시 `/workspace/novelforge-runtime/emulator-data`에 Export하며 다음 시작에 Import합니다. **정상 종료 전 서버 강제 종료에 대한 영속성은 보장하지 않습니다.** 배포 환경은 실제 Firestore/Storage에 저장합니다. 프로세스는 새 클라우드 작업에서 다시 시작해야 합니다. 테스트 메모리 어댑터(`backend/tests/ui_server.py`)는 배포 진입점이 아니며 데이터가 영속하지 않습니다.

필요한 다운로드 도메인: `registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org`, `storage.googleapis.com`. 인터넷 제한 시 환경 설정에서 도메인을 허용한 뒤 다시 실행하세요. TLS 및 아티팩트 체크섬 검증을 끄지 않습니다.

## 사용 순서

Cloudflare/Supabase 운영 화면:

1. **새 작품**에서 TXT·MD·DOCX·PDF를 올립니다. 제목과 장르는 파일에서 분석할 수 있습니다.
2. **파일 분석 · 기획안 만들기**로 핵심 기획을 받고 제목·인물 이름·장르·문체·첫 사건을 검토합니다.
3. **이 기획으로 10화 설계**를 누릅니다. 기획 확인 후 시놉시스의 비용 확인으로 이어지며, 유료 생성은 동의 후 실행합니다.
4. 첫 10화의 사건·보상·복선 일정을 확인하고 **이 구간 기록**을 누릅니다. 목표 원고 분량을 설정하고 회차를 선택합니다.
5. 해당 시놉시스에서 장면을 설계·승인하고 집필합니다. 독립 검토와 편집을 거쳐 확정하며, 복선이 있는 회차는 실제 원고의 투척·회수를 확인합니다.
6. 10화 구간을 마치면 다음 10화 시놉시스를 기록합니다. 설정과 복선 일정은 다음 구간에도 이어집니다.

기획안을 다시 적용하면 새 연재 버전으로 시작하고, 기존 원고와 시놉시스는 보관합니다. 예전 모듈·기획 트리 작성은 운영 화면의 필수 과정에서 제거했습니다. Firebase/Python 로컬 경로는 이전 상세 기획 과정을 보존합니다.

업로드 자료의 명령은 비신뢰 데이터입니다. 참고 작품 고유 문장 복제는 금지하며 32자 연속 중복 검사만으로 모든 근접 복제를 검출한다고 주장하지 않습니다. 참고 분석은 자료당 앞부분 최대 6,000자를 사용하므로 대표성 검수가 필요합니다.

## 실제 Firebase와 Google 로그인 연결

실제 Firebase 프로젝트 ID, 웹 앱 공개 구성, 결제 계정은 사용자가 등록해야 합니다. 자동으로 프로젝트를 생성하거나 Blaze 결제를 연결하지 않습니다.

1. Firebase 프로젝트/웹 앱 생성. Authentication → Google provider 활성화. 배포 도메인을 Authorized domains에 등록합니다.
2. Firestore Standard 데이터베이스와 Storage bucket 생성. Storage, App Hosting, Cloud Run에는 Blaze/결제 계정이 필요할 수 있습니다.
3. `.env.example`의 `NEXT_PUBLIC_FIREBASE_*`를 실제 웹 공개 구성으로 지정하고 `NEXT_PUBLIC_USE_EMULATORS=0`으로 **다시 빌드**합니다. 웹 API 키는 Firebase 공개 구성이고 OpenRouter 비밀 키와 다릅니다.
4. FastAPI 서비스에 `NF_MODE=production`, `NF_AI_MODE=live`, `GCLOUD_PROJECT`, `FIREBASE_STORAGE_BUCKET`, `APP_ORIGIN` 설정. Emulator 환경 변수는 모두 제거합니다. Admin SDK는 Cloud Run 서비스 계정의 ADC를 사용합니다. 서비스 계정 JSON을 저장소나 프론트에 넣지 마세요.
5. [보안 규칙](firestore.rules), [Storage 규칙](storage.rules), [색인 제외](firestore.indexes.json)을 검토한 뒤 사용자가 `firebase deploy --only firestore,storage --project <ID>`로 배포합니다. Firebase 설정/권한은 테스트 후 배포하세요.
6. 배포 전 실제 Google Popup, 모바일 Redirect, 다른 기기 재로그인, Rules·Storage·FastAPI 계정 분리를 검증합니다. 모바일 Redirect에는 [공식 권장 설정](https://firebase.google.com/docs/auth/web/redirect-best-practices)이 필요합니다. 동일 도메인 auth helper 역방향 프록시를 지원하도록 `FIREBASE_AUTH_HELPER_ORIGIN=https://<project>.firebaseapp.com`을 설정하고 `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`을 앱 도메인으로 맞출 수 있습니다. Google OAuth redirect URI도 해당 도메인의 `/__/auth/handler`로 등록해야 합니다. 운영 도메인 없이 모바일 호환 완료를 주장하지 않습니다.

## OpenRouter 연결·비용

실제 호출을 원할 때만 **서버** Secret Manager의 `OPENROUTER_API_KEY`를 설정하고 `NF_AI_MODE=live`로 시작합니다. 클라이언트에 키 입력/저장 기능은 없습니다. 로컬 테스트의 `development/fixture`는 실제 모델 ID가 아닙니다.

설정 화면이 `/api/v1/models`의 ID, 문맥 한도, 가격, 지원 파라미터를 읽습니다. `thedrummer/cydonia-24b-v4.1`는 후보이며 실제 조회 결과에 있을 때만 선택할 수 있습니다. 역할별 모델을 명시적으로 저장해야 합니다. 세계관 역할은 세계관 모듈에 사용합니다. 지원 모델에만 JSON 출력 옵션을 붙이며 모든 응답은 Pydantic으로 검증합니다. 프롬프트/응답 저장을 허용하지 않는 제공자 라우팅만 요청합니다. 호환 제공자가 없으면 실패를 보고합니다.

각 요청 전 전송 범위와 최대 금액을 확인합니다. 보수적 입력 토큰 상한과 출력 한도로 비용을 예약하고, 월 예산·분당 12회·하루 200회 제한을 서버에서 검사합니다. 응답 비용을 알 수 없거나 타임아웃이면 예약을 유지하고 자동 재요청하지 않습니다. 완료된 응답은 작업 문서에서 조회할 수 있습니다. API 재요청에 의한 중복 과금을 완전히 방지하는 Cloud Tasks 멱등 실행은 3차 범위입니다. 현재 장면 API를 중복 호출하면 별도 요청 비용이 발생할 수 있으므로 UI는 실행 중 중복 클릭을 막습니다.

OpenRouter 목적지 `openrouter.ai`가 허용되어야 합니다. 현재 구현은 생성·분석·검토를 OpenRouter로 보냅니다. 임베딩 모델 카탈로그 API는 있지만 임베딩 생성/RAG는 아직 구현하지 않았습니다. 서버 키를 채팅, 저장된 스크립트, 클라이언트 번들에 넣지 마세요.

## 검증

```bash
.venv/bin/python -m pytest backend/tests -q  # 메모리 DB/Storage 대역: API 비즈니스/파서/비용
npm run typecheck
npm run build
# 아래는 실제 로컬 Auth/Firestore/Storage Emulator 기동 후:
.venv/bin/python -m pytest tests/integration -q
npm run test:rules                         # 실제 Firestore/Storage SDK 악의적 요청
npm run test:e2e:firebase                  # 실행 중인 실제 로컬 Firebase + Next/FastAPI
npm run test:e2e                           # 실제 Auth + 테스트 메모리 어댑터를 이용한 별도 UI 검사
```

기본 대역 브라우저 테스트는 별도 포트 8001/3001을 사용합니다. `test:e2e:firebase`는 `scripts/dev.sh`가 시작한 실제 로컬 Firebase와 포트 3000/8000을 사용합니다. Chromium 기본 경로 `/usr/bin/chromium`, 변경 시 `CHROMIUM_PATH`. 개발 `.next-dev`, 테스트 `.next-test`, 프로덕션 `.next`를 분리해 서로 빌드 파일을 덮어쓰지 않습니다. `scripts/test.sh`는 위 전체 검증을 순서대로 실행하며 실패를 숨기지 않습니다.

테스트 대역 통과는 실제 Firebase 통과를 뜻하지 않습니다. 실제 Emulator 트랜잭션·Rules·브라우저·정상 재시작 검사는 별도로 통과했으며, 운영 Google 클라우드 연동은 아직 검증하지 않았습니다. 5~10화 품질·Worker 재시작·실제 백업 복구 등은 별도 미완료 항목입니다.


Google provider Popup은 `node scripts/verify-google-login.cjs`로 추가 검증했습니다. Auth Emulator 로그인·서버 토큰 검증·로그아웃까지 통과했으며 TLS 검증은 유지합니다. 이 클라우드 Chromium은 NSS 인증서 저장소 접근이 제한된 실행에서 인증서 오류를 낼 수 있으므로, 해당 검사는 승인된 NSS 접근 권한이 있는 실행이 필요합니다. 실제 Google 계정 OAuth 성공과는 구분합니다.

## 배포·운영

초기 배포 경로는 Firebase App Hosting(Next.js) + Cloud Run(FastAPI)입니다. [배포 안내](docs/deployment.md)를 따르세요. 현재 코드를 상용 게시하거나 유료 작업을 실행하지 않았습니다.

자동 Google Cloud 청구 조회와 예약 관리 Export는 미구성 상태입니다. UI도 이 상태를 표시합니다. Google Cloud 예산 알림은 자동 하드 차단이 아닙니다. 원고 버전은 관리 재해 복구 백업을 대체하지 않습니다. 대형 본문/아카이브 객체를 저장한 뒤 Firestore 커밋이 실패하면 STAGED 메타를 남겨 진단할 수 있지만 자동 고아 객체 회수·운영자 복구 큐는 3차 범위입니다.

기존 프로그램의 복구본은 이 실행 환경의 `/workspace/backups/stock-before-novelforge.tar.gz`입니다. Git 이력도 유지했습니다. 백업은 저장소 외부 파일이므로 저장소를 다른 기계에 복제하면 따라가지 않습니다.
