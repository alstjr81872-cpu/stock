# 공식 규격 조사 및 구현 결정

확인일: 2026-10-10 (Asia/Seoul). 실제 공개 문서 본문을 HTTP로 읽었습니다. 플랫폼 계정 로그인·심사 제출 테스트는 수행하지 않았습니다.

## Adobe Stock

- [생성형 AI 제출](https://helpx.adobe.com/stock/contributor/submit-your-content/submit-generative-ai-content/submit-generative-ai-content.html): AI 콘텐츠 허용, 도구의 상업적 라이선스 확인, `Created using generative AI tools` 표시, 필요한 경우 사람·재산권 정보, 마지막 `Submit` 단계. 원본 제작 프롬프트/모델을 AI 이미지 분석으로 추정하면 안 됩니다.
- [CSV 규격](https://helpx.adobe.com/stock/contributor/manage-your-portfolio/csv-requirements-content.html): UTF-8, 최대 5,000행/1MB, Filename 30자, Title 70자, Keywords 최대 50개, Category/Releases 선택 항목. 앱은 이미지 파일명을 30자 이내의 ASCII 고유 이름으로 생성합니다.
- [CSV 적용 절차](https://helpx.adobe.com/stock/contributor/manage-your-portfolio/upload-csv-file.html): 파일 업로드 후 New → Upload CSV → Refresh. CSV 적용만으로 최종 제출이 되지 않습니다.
- [사진 제출](https://helpx.adobe.com/stock/contributor/submit-your-content/submit-photos/submit-photos.html): 5~50 키워드, 중요도 순서, 메타데이터·릴리스 후 Submit. 사진 4MP 미만은 앱에서 경고합니다.
- [Stock API FAQ](https://developer.adobe.com/stock/docs/faq/stock-api-business-faq/): 검색·라이선스·다운로드 통합 설명입니다. 기여자 제출 API로 사용한다는 근거를 확인하지 못했습니다. 이번 구현은 어도비 자동 파일 전송을 제공하지 않습니다.

## Freepik

기존 `contributor.freepik.com`은 `contributor.magnific.com`으로, 도움말은 `www.magnific.com`으로 리다이렉트됐습니다. 앱은 사용자가 요청한 Freepik 이름을 유지했습니다.

- [현재 CSV 안내](https://www.magnific.com/ai/contributors/how-to-create-a-csv-file): **세미콜론으로 열 구분, 쉼표로 키워드 구분**. `File name`, `Title`, `Keywords`, 선택적인 `Prompt`, `Model`. 모델명은 포털 드롭다운과 정확히 일치해야 합니다. 작성된 CSV를 FTP로 업로드하는 절차가 명시됩니다.
- [AI 키워드 공식 글](https://contributor.magnific.com/blog/ai-keyword/), 2024-03-20: `_ai_generated` 필수, CSV에도 직접 삽입, 실제 제작 모델·프롬프트 사용. 모델이 제공 목록에 없으면 모델·프롬프트를 표시하지 않아도 된다는 설명. 글이 과거 자료임을 감안하고 현재 포털에서 재확인해야 합니다.
- [AI 콘텐츠 태그](https://contributor.magnific.com/blog/tag-your-ai-content/), 2023-04-19: CSV 또는 파일에 포함된 메타데이터에도 AI 태그를 넣을 수 있습니다.
- [Upload 화면과 FTP](https://contributor.magnific.com/blog/new-section-upload/), 2023-10-23: FTP 전송 후 Upload 화면에서 검토·수정한 뒤 Submit을 눌러 심사에 보냅니다. 따라서 FTP 자동 전송과 자동 심사 제출은 다릅니다.
- [기여자 화면](https://contributor.magnific.com/): 공개 페이지 설정값 `TITLE_MIN_LENGTH=5`, `TITLE_MAX_LENGTH_CONTRIBUTOR=100`, `TAGS_MIN_LENGTH=5`, `TAGS_MAX_LENGTH=50`, `PROMPT_MAX_LENGTH=500`을 확인했습니다. 이는 공개 화면 구현값이며 API 계약의 보장은 아닙니다.

공식 FTP 지원에 근거해 파일 전송 어댑터를 구현했습니다. 비밀번호 보호를 위해 **FTPS/TLS 인증서 검증을 강제**합니다. 문서의 FTP 지원만으로 모든 계정의 FTPS 사용 가능 여부까지 보장하지 않습니다. 사용자 계정·서버가 이를 지원하지 않으면 연결은 실패하며 평문 FTP로 자동 전환하지 않습니다. 파일 및 CSV 전송 후 심사 제출은 사용자 포털에서 합니다.

## 미리캔버스 디자인허브

- [AI로 만든 콘텐츠](https://miricanvas-designhub.zendesk.com/hc/ko/articles/20641182435481): AI 이미지 제출 허용, 생성형 AI 체크 필수. 실사에 가까운 이미지에 한해 Photo 가능. PNG 요소는 객체 분리와 배경 제거 필수. 배경은 주된 피사체가 없는 배경용 그래픽.
- [메타데이터 입력](https://miricanvas-designhub.zendesk.com/hc/ko/articles/21001180785945): 요소 이름, 키워드, AI 체크, 콘텐츠 타입, Premium/Standard. 일반 화면은 키워드 1~8개로 안내합니다. 대량 CSV 안내와 일반 화면 제한이 서로 달라 앱에서 설명합니다.
- [CSV 작성](https://miricanvas-designhub.zendesk.com/hc/ko/articles/20894820587417): fileName, uniqueId, elementName, keywords, tier, contentType. 이름은 최대 100자, 한글/영문, 확장자·특수문자 제외. CSV 키워드는 최대 25개, 각 50자 이하, 하이픈 이외 특수문자 금지. Premium/Standard 정확한 값 사용. 한글 포함 시 XLSX 권장. 문서의 `uniqueId` 표기는 본문에서 대문자 I/소문자 l가 혼용되어 있으므로 포털의 최신 샘플 헤더와도 확인해야 합니다.
- [uniqueId 없는 등록](https://miricanvas-designhub.zendesk.com/hc/ko/articles/20576650768281): 고유 파일명으로 매칭하는 등록 지원, uniqueId를 제외한 항목 작성. 앱은 고유 이름을 생성하고 확장자를 제외한 이름을 XLSX에 넣습니다.
- [파일 업로드](https://miricanvas-designhub.zendesk.com/hc/ko/articles/20757809511449): 웹에서 파일/폴더 업로드 → 메타데이터 → 승인 요청. 공개 업로드 API/FTP에 대한 안내는 확인하지 못했습니다.

SVG와 템플릿은 다른 규격입니다. 이 버전은 정지 래스터 이미지만 취급하며 템플릿용 규칙을 요소에 적용하지 않습니다. SVG/GIF 업로드와 자동 배경 제거는 구현 범위에 포함하지 않았습니다.

## 업스케일 모델과 실제 검증

- [FSRCNN 원저자 구현](https://github.com/Saafke/FSRCNN_Tensorflow): OpenCV GSoC의 공개 초해상도 모델. CPU에서 실제 2×/4× 추론을 실행했습니다. 모델 파일은 커밋 고정 및 SHA-256 검증. 코드 참조: `scripts/setup_models.py`.
- 모델 제작자 `images/original.png` 예제를 228×340으로 잘라 2×/4× 축소한 후 복원했습니다. 밝기 채널, 배율만큼 경계 제외, PSNR 비교는 `scripts/benchmark_upscale.py`로 재현할 수 있습니다. 모델이 bicubic보다 2×에서 1.511dB, 4×에서 1.148dB 높았습니다. 한 이미지의 인공 저해상도 테스트로 일반화하지 않습니다.
- [Real-ESRGAN Replicate 모델](https://replicate.com/nightmareai/real-esrgan): 선택형 외부 연동. 런타임에 모델 버전·입력 스키마를 조회하고 `image`, `scale`, `face_enhance=false`로 예측 요청을 보냅니다. 결과는 허용된 HTTPS 결과 호스트에서만 다운로드합니다. 키가 없어 실제 유료 추론은 미실행이며, API 요청·결과 처리 계약만 대역 응답으로 테스트했습니다.

## 참고 사이트 및 남은 검증

요청한 [기존 업스케일러](https://image-batch-upscaler-153113860176.us-west1.run.app/)는 현재 실행 환경에서 CONNECT 403으로 차단됐습니다. 디자인·기능을 직접 열람하거나 소스 코드를 재사용하지 않았습니다. 도메인은 환경 설정 초안에 추가했습니다.

OpenAI/Gemini/Replicate의 실제 키가 없고 FTP 자격 증명도 없어 외부 이미지 분석·유료 업스케일링·실계정 전송은 검증하지 못했습니다. 확인된 것은 **로컬 앱 전체 흐름, 로컬 FSRCNN 추론, 플랫폼 양식 출력 및 외부 연동의 요청/응답 처리**입니다. 실제 세 플랫폼 접수·심사 통과를 검증한 것으로 해석하면 안 됩니다.
