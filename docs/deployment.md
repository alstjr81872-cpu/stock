> **이전 Firebase 배포 안내입니다.** 현재 권장하는 무료 배포는 [Cloudflare + Supabase 안내](cloud-deployment.md)를 따르세요. 아래 절차의 결제 연결은 진행하지 마세요.

# 배포 준비 (미실행)

실제 프로젝트/권한/결제 연결이 필요한 절차입니다. 환경 준비나 코드 저장은 게시를 의미하지 않습니다.

1. Firebase에 Google provider, Firestore Standard, Storage와 Blaze 결제 연결을 사용자가 준비합니다. 웹 구성은 공개값만 App Hosting BUILD/RUNTIME 환경 변수에 지정합니다. `apphosting.yaml`의 BACKEND_URL을 실제 Cloud Run 서비스 URL로 바꿉니다.
2. Cloud Run용 전용 서비스 계정을 만듭니다. 최소 권한은 Firestore 데이터 접근(roles/datastore.user), 해당 Storage 버킷의 객체 접근(버킷 범위 roles/storage.objectUser), OpenRouter secret 한 개에 대한 roles/secretmanager.secretAccessor입니다. Auth `check_revoked=True`의 계정 상태 조회를 위해 Firebase Auth 사용자 조회 권한(`firebaseauth.users.get`, 예: 범위 제한 커스텀 역할)도 필요합니다. 모든 프로젝트 Owner/Editor 권한을 부여하지 않습니다.
3. OpenRouter 키를 Secret Manager에 직접 입력하고 Cloud Run의 `OPENROUTER_API_KEY`에 바인딩합니다. 키 값이 포함된 gcloud 명령을 기록하지 않습니다.
4. 저장소 Dockerfile로 백엔드 이미지를 빌드해 Artifact Registry에 올린 뒤 Cloud Run에 배포합니다. `GCLOUD_PROJECT`, `FIREBASE_STORAGE_BUCKET`, `APP_ORIGIN`, `NF_MODE=production`, `NF_AI_MODE=live`를 지정합니다. 공개 HTTP API에는 Firebase ID 토큰이 필수입니다. 서버간 전용 Worker API는 아직 없으며 이를 공개 API로 대체하지 않습니다. 초기 요청 timeout은 현재 동기 AI 단계에 맞게 최대 300초, max instances와 concurrency는 보수적으로 설정합니다. 모델 요청 timeout은 180초입니다.
5. Firebase Rules와 인덱스 예외를 테스트/배포합니다. 프론트 직접 쓰기는 전부 금지되어 승인/캐논/비용/작업/현재 원고 모두 FastAPI CAS를 통해서만 수정합니다. 클라이언트가 uid를 지정하는 API는 없습니다. uid는 매 요청 검증 토큰에서 산출합니다.
6. Next.js App Hosting을 연결합니다. API rewrite는 빌드 시의 BACKEND_URL을 사용하므로 변경 시 다시 빌드합니다. 프로덕션에서는 `NEXT_PUBLIC_USE_EMULATORS=0`; 로컬 환경 변수를 복사하지 않습니다. 실제 Google Popup/Redirect와 토큰 갱신을 운영 도메인에서 검사합니다.
7. 계정 A/B 접근, Firestore/Storage 직접 SDK 공격, 두 기기 동시 저장/복구, 과금 제한, 인증 만료를 다시 검증합니다. 이 저장소의 테스트 결과를 운영 검증으로 대신하지 않습니다.
8. 예약 Firestore Export, Storage 수명주기/백업, 별도 프로젝트 복원 시험, 로그 보존과 계정 삭제 절차를 구성한 뒤 공개 운영을 결정합니다. 현재 관리 자동 백업, 영구 삭제, Cloud Tasks/Jobs 워커, 대규모 RAG는 미구현입니다.

App Hosting, Cloud Run, Storage, Cloud Tasks/Jobs, 관리 백업은 각각 비용이 발생할 수 있습니다. Google Cloud Billing API를 연결하지 않은 상태에서 UI의 OpenRouter 비용을 전체 운영비로 해석하지 마세요.

Cloud Tasks/Jobs는 3차 단계에서 비공개 서비스 계정 OIDC/IAM 검증, 단계별 멱등키, lease, 체크포인트, at-least-once 중복 배달 테스트와 함께 추가해야 합니다. 현재 동기 생성 API를 장편 자동 작업 엔진이라고 부르지 않습니다.
