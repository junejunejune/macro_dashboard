# 재테크 매크로 대시보드

개인용 거시경제 지표 대시보드. GitHub Pages로 서빙되는 정적 페이지 한 장과, GitHub Actions가 매일 갱신하는 CSV로 이루어져 있다. 빌드 단계 없음. 사용자는 주로 폰에서 Claude(claude.ai/code)로 이 저장소를 고친다. 답변과 페이지 문구는 한국어로.

## 구조

- `index.html` — 페이지 전부(CSS, 데이터 로더, 계산, 차트). d3 7.9.0을 cdnjs에서 불러온다.
- `data/*.csv` — 지표 데이터. 직접 고치지 말 것. 스크립트가 덮어쓴다.
- `data/meta.json` — 마지막 확인 시각과 데이터 묶음별 성공/실패. 페이지 상단 "데이터 갱신"에 표시.
- `scripts/fetch-data.mjs` — 데이터 수집. Node 20, 의존성 없음(curl 사용). `node scripts/fetch-data.mjs [묶음이름...]`
- `.github/workflows/update-data.yml` — 매일 22:00 UTC(한국 07:00) 실행, 바뀐 `data/`를 커밋.

## index.html 안의 흐름

1. `<head>`의 로더가 `window.dash`를 만든다: `FILES` 배열의 CSV를 읽고 `dash.data(id)`, `dash.calc(id, {inputs, fn})`, `dash.draw(name, fn)`를 제공. CSV 값은 문자열이므로 계산할 때 `+`로 숫자로 바꾼다. 빈 칸은 `""`.
2. `dash.calc`로 파생 값을 만든다: `krw_idx`, `m2_yoy`, `spread`, `us_curve`, `comp_share`, `iss_share`, `inflation`, `jobs`, `claims`, `m7`(M7 동일가중 지수, 2019년 첫 거래일 = 100), `latest`(요약 카드용, `metric`별 한 행). 전년비는 `yoyOf`/`prevYearVal`을 쓴다. 1년 전 달이 미발표면(2025년 10월 CPI 등) 앞뒤 달 평균으로 메운다.
3. 화면의 `data-draw="이름"` 요소마다 `dash.draw`가 그린다. 숨은 탭(`hidden`)은 그리지 않고, 탭을 열 때 `dash.setLink`가 다시 그린다.
4. 차트 도우미: `mx.line`(선), `mx.stack`(누적 영역/막대, `bars: true`), `mx.bars`(음수 가능한 막대 + 선 하나), `mx.ts(drawName, dataId, fn)`. 기간 버튼은 `mx.range`(년)와 `mx.cut(rows, key, years?)`. `years`를 주면 그 차트의 기본 기간이 고정된다(은행 금리 1년, 물가·고용 2년).
   - 확대·축소·이동: `mx.ts`로 그린 시계열 차트는 모두 지원. 차트별 보이는 기간은 `mx.view[drawName] = [시작ms, 끝ms]`, 없으면 기본 기간. 휠·트랙패드(위아래 확대, 좌우 이동), 마우스 끌기, 두 손가락 핀치, 차트 아래 −/+/되돌리기 버튼(`mx.zoomBar`). 기간 버튼을 누르면 `mx.view`를 비운다. 차트 함수는 `el.__plot = {l, r, W}`(그림 영역 좌표)를 남겨야 한다. 수익률 곡선(`ch-curve`)은 시계열이 아니라 제외.
5. 카드마다 차트 아래에 두 가지가 붙는다.
   - `<p class="mx-trend" data-draw="t-이름">`: 최근 1달 동향 문장. "최근 1달 동향 문장" 스크립트의 `say('t-이름', [데이터], fn)`이 데이터로 만든다. 월별 지표는 최신 달 vs 전달, 일별·주별은 최신 vs 한 달 전.
   - `<details class="mx-how">`: "이 차트 읽는 법" 고정 설명(HTML에 직접 씀).
6. 색은 `:root` 토큰(`--s1`..`--s7`, `--color-*`, `--cds-*`)만 쓴다. 다크 모드는 같은 토큰을 다시 정의한다.

## 지표 추가하는 법

1. `scripts/fetch-data.mjs`의 `jobs`에 묶음을 추가하거나 기존 묶음에 열을 추가한다.
   - FRED: `fred('시리즈ID')` (키 불필요)
   - 한국은행 ECOS: `ecos('통계표코드', '항목코드')` (월별 기본, `ECOS_API_KEY` 사용)
   - 미 재무부: `fd(경로, 쿼리)`
2. 로컬이나 Actions에서 스크립트를 돌려 CSV를 만든다.
3. 새 CSV면 `index.html` 로더의 `FILES`에 이름을 추가한다.
4. 차트 카드는 기존 `.mx-card`를 복사하고 `mx.ts(...)` 한 줄로 그린다. 기간 버튼이 다시 그리는 목록(탭과 기간 스크립트의 배열)에도 이름을 넣는다. 카드에 `mx-trend` 문장(`say(...)`)과 `mx-how` 읽는 법도 같이 넣는다.
5. 요약 카드는 `latest` 계산에 `add(...)`를 추가하고 `.mx-tile`과 `tiles` 맵에 넣는다.

## 알려진 제약

- 코픽스(COFIX)는 은행연합회만 공개하고 API가 없어 넣지 않았다. 주담대 금리(ECOS 121Y006 BECBLA0302)로 대신.
- 은행채는 ECOS의 산금채 1년(721Y001 6050000)으로 대신.
- 금 가격, 다우(^DJI)·나스닥(^IXIC)·M7 종목 주가는 Yahoo Finance. GitHub 러너에서 Yahoo가 막히면 `krw_value`, `markets`만 실패하고 이전 값을 유지한다. 이 경우 다른 출처로 교체를 검토(FRED에 DJIA, NASDAQCOM이 있음).
- 증시 탭의 비교 차트(`ch-idx`, `ch-m7`)는 선택한 기간의 첫날을 100으로 다시 맞춘다(`mx.rebase`).
- 국채 발행액은 2·5·7년물이 월말/다음 달 초에 발행돼 월별 값이 들쭉날쭉하다.

## 확인 방법

로컬: `npx serve .` 또는 `python3 -m http.server` 후 브라우저에서 열기(`file://`로는 CSV를 못 읽는다). 폰 폭(약 375px)에서 가로 스크롤이 생기지 않는지 본다.
