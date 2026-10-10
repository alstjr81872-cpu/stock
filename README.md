# Stock Studio

이미지를 모아 **GPT/Gemini로 분석하고, Adobe Stock·Freepik·미리캔버스별 메타데이터를 만들고, AI 초해상도로 복원하는 웹 앱**입니다. 로컬 개인용 모드와 방문자별 작업 공간을 분리하는 Render 공개 모드를 지원합니다. 기존 참고 사이트는 조사 환경의 접속 제한으로 직접 열람하지 못해 독립적으로 구현했습니다.

## Render 웹사이트로 배포

`render.yaml`과 `Dockerfile`이 포함되어 있습니다. Render에서 **New → Blueprint → alstjr81872-cpu/stock → main**으로 연결하면 무료 플랜 배포를 시작할 수 있습니다. 사이트 방문자는 로그인 없이 사용할 수 있으며, 자신의 AI 키를 입력합니다. 발급된 웹사이트 주소는 배포 후 Render 대시보드에서 확인합니다.

공개 모드는 방문자별 이미지·설정을 분리하고 키를 암호화합니다. 무료 서버의 작업 파일은 재시작·재배포 시 삭제될 수 있습니다. [Render 배포 안내](docs/render.md)에 계정 연결, 제한, 데이터 보관 방식이 정리되어 있습니다.

## 실행

Node.js 24+, Python 3.11/3.12, Linux/macOS 기준입니다. 프로젝트 디렉터리에서:

```bash
npm ci
python -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
python scripts/setup_models.py
npm run dev
```

브라우저에서 로컬 포트 `3000`으로 접속합니다. `PORT`로 포트를 변경할 수 있습니다. 기본 로컬 모드는 `127.0.0.1`, `PUBLIC_MODE=1`인 Render 배포는 `0.0.0.0`에 바인딩합니다. 다른 운영체제는 `server/local-upscale.mjs`의 Python 경로와 설치 명령 조정이 필요합니다.

```bash
npm run build
npm start
```

## 기능

- 정지 JPEG·PNG·WebP 다중 업로드: 파일당 25MB, 한 번에 30개. 디코딩·회전 보정, 투명 픽셀 확인, 썸네일 생성. 업로드된 바이트 원본은 별도로 보관합니다.
- 설정에서 **GPT 또는 Gemini 선택**, 각각 API 키와 이미지 입력을 지원하는 모델명 입력. 실제 이미지 미리보기를 선택한 제공자에게 전송합니다. AI 호출은 서버에서만 수행합니다.
- 세 플랫폼의 제목·키워드·카테고리·타입·라이선스 편집, 길이·키워드 수·투명 배경 조건 검증, 복사.
- Adobe: `Filename,Title,Keywords,Category,Releases` CSV.
- Freepik: 세미콜론 CSV `File name;Title;Keywords;Prompt;Model`, `_ai_generated` 표시, JPEG 내 IPTC 캡션·키워드. 제작 모델과 원본 프롬프트는 추정하지 않으며 사용자가 입력합니다.
- 미리캔버스: 한글 XLSX, `fileName,uniqueId,elementName,keywords,tier,contentType`. 확장자를 제외한 고유 파일명으로 매칭하고 `uniqueId`는 비웁니다. 한글 입력 시 XLSX를 사용하라는 공식 안내를 따릅니다.
- 메타데이터 단독 다운로드 또는 양식과 정확히 일치하는 파일명을 가진 이미지 ZIP. Freepik 패키지는 JPEG로 변환하므로 투명 배경은 흰색이 됩니다.
- **무료 로컬 FSRCNN 2×/4×**: 실제 OpenCV 신경망 추론, 겹치는 타일 경계 처리, 원본 보관, 알파 채널 고품질 보간·재결합. 모델 버전과 SHA-256을 고정해 설치합니다.
- **선택형 Real-ESRGAN**: Replicate API로 실제 모델 실행, 작업 상태 조회, 결과 다운로드, 크기 확인, 원본 알파 재결합. 별도 유료 토큰이 필요합니다.
- 전후 슬라이더와 100% 픽셀 비교, 원본/처리 이미지 다운로드.
- **Freepik FTPS 전송 어댑터**: 계정에서 제공한 호스트·사용자·비밀번호로 JPEG+CSV 전송. TLS 인증서를 검증하고, 같은 이미지와 메타데이터의 중복 파일 전송은 건너뜁니다. 계정의 FTPS 지원 및 실제 파일 수용 여부는 별도 검증이 필요합니다.

## 자동 업로드의 범위

| 플랫폼      | 구현한 범위                          | 남은 단계                                              |
| ----------- | ------------------------------------ | ------------------------------------------------------ |
| Adobe Stock | 파일 패키지·CSV 생성                 | 포털 업로드, AI/권리 표시, 심사 제출                   |
| Freepik     | 파일 패키지·CSV·IPTC, FTPS 파일 전송 | 본인 계정의 TLS/네트워크 연결 검증, 포털 검토와 Submit |
| 미리캔버스  | 파일 패키지·한국어 XLSX              | 포털 업로드, AI 표시, 승인 요청                        |

공개 판매자용 자동 제출 API는 조사한 문서에서 확인되지 않았습니다. 비공개 API나 브라우저 봇을 임의로 구현하지 않았습니다. 전송 완료를 심사 제출·승인 완료로 표시하지 않습니다. 무료플랜/API 접근권과 플랫폼의 기여자 가입·심사 조건은 별개입니다.

## 키와 데이터

설정 화면에서 API 키를 넣으면 됩니다. 로컬 모드는 환경 변수 `OPENAI_API_KEY`, `GEMINI_API_KEY`, `REPLICATE_API_TOKEN`, `FREEPIK_FTP_PASSWORD`도 지원합니다. 공개 모드는 운영자의 환경 변수 키를 방문자에게 제공하지 않습니다. **키를 채팅이나 소스 코드에 넣지 마세요.** 저장된 키 값은 설정 조회 API로 반환하지 않습니다.

로컬 모드는 `.data/`에 개인 이미지·설정·모델을 저장하며 Git에서 제외됩니다. 로컬 설정 JSON은 권한 `0600`이며 암호화하지 않습니다. 공개 모드는 서명된 브라우저 세션마다 작업 공간을 만들고 설정을 AES-256-GCM으로 암호화합니다. 이미지 전체를 디스크 암호화하는 것은 아니며 서버 운영자는 저장 공간을 관리할 수 있습니다. 공개 버전은 임시 작업용으로, 계정 기반 영구 보관·대규모 동시 처리에는 별도의 계정 시스템·스토리지·작업 큐가 필요합니다.

`STOCK_DATA_DIR`로 이미지·설정 폴더를 변경할 수 있습니다. 모델은 프로젝트 `.data/models`에서 읽습니다. API 요청은 Node의 환경 프록시 설정을 따릅니다. FTP는 별도 TCP/TLS 연결이므로 HTTPS 전용 클라우드 프록시 환경에서는 연결이 제한될 수 있습니다.

관련 목적지: `api.openai.com`, `generativelanguage.googleapis.com`, `api.replicate.com`, `replicate.delivery` 및 하위 도메인, 계정에 지정된 FTP 호스트. 로컬 FSRCNN 설치 후에는 업스케일링을 위해 외부 접속이 필요하지 않습니다.

## 검증

```bash
npm test
npm run build
npm run test:e2e
```

브라우저 테스트는 `/usr/bin/chromium`을 사용합니다. 다른 경로라면 `CHROMIUM_PATH`를 지정하세요. 코어·공개 모드 테스트는 실제 로컬 FSRCNN 추론, 이미지 업로드/다운로드, CSV·XLSX, 알파 채널, 방문자 격리, 설정 암호화, 쿠키 변조, 운영자 API 키 분리를 검사합니다. 브라우저 테스트는 로컬 작업 흐름과 공개 모드의 두 브라우저 간 격리를 검사합니다. 외부 GPT/Gemini·Replicate·FTP는 **응답 대역을 이용한 연결 계약 테스트**이며 실제 계정 검증을 뜻하지 않습니다. 본 환경에는 해당 키와 FTP 계정이 없어 외부 유료 호출과 실제 전송은 수행하지 않았습니다.

업스케일 품질의 재현 가능한 샘플 측정:

```bash
.venv/bin/python scripts/benchmark_upscale.py
```

모델 제작자의 예제 사진을 bicubic으로 축소하고 원래 크기로 복원해 밝기 채널 PSNR을 비교합니다. 2×: bicubic **31.683 dB**, FSRCNN **33.194 dB**. 4×: bicubic **24.497 dB**, FSRCNN **25.645 dB**. 단일 사진의 인공 축소 테스트이며 실제 사용자 이미지·텍스트·3D 아이콘 모두에 대한 품질 보장은 아닙니다. [조사 기록](docs/research.md)에서 근거와 제한을 확인하세요.

## 모델 출처

FSRCNN: [Saafke/FSRCNN_Tensorflow](https://github.com/Saafke/FSRCNN_Tensorflow), 고정 커밋 `6a4812c4ef1c4f5947d79beafa32a05a6eb4a94d`, Apache-2.0. 설치 스크립트가 모델과 라이선스를 `.data/models`에 보관합니다. 로컬 모델은 Real-ESRGAN과 다른, CPU용 경량 신경망입니다. 자동으로 서로 대체하지 않습니다.
