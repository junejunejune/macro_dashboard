# 재테크 매크로 대시보드

원화 가치(달러·금 대비), 통화량(M2), 한국 금리(기준금리·국고채·은행채·주담대), 미국 금리(연준 기준금리·단기·장기 국채), 미국 물가(CPI·PCE)와 고용(비농업 고용·실업률·임금·실업수당 청구), 미국 증시(다우·나스닥·M7·SCHD)와 국제 금 가격, 유가·달러 인덱스·실질금리·기대인플레이션·신용 스프레드·VIX, 미국 정부 지출(국방·의료·이자·연금), 한국·미국 출산율과 인구 구성, 미국 연방부채와 국채 발행·만기 구성을 한 페이지에서 봅니다. 차트마다 최근 1달 동향 문장(데이터로 자동 작성)과 읽는 법이 붙어 있습니다.

- 데이터: FRED, 한국은행 ECOS, 미 재무부 Fiscal Data, Yahoo Finance(지수·주가·금 선물), 세계금협회(중앙은행 금 매입), 중국 외환관리국·IMF(DBnomics, 중국 금 보유량)
- 갱신: GitHub Actions가 매일 한국 시간 오전 7시에 새 데이터를 받아 커밋합니다.
- 보기: GitHub Pages (폰에서도 열림)

## 처음 설정

1. **ECOS 인증키 받기 (권장, 무료)**: https://ecos.bok.or.kr/api/#/AuthKeyApply 에서 신청합니다. 없어도 동작하지만 샘플 키는 느리고 언제든 막힐 수 있습니다.
2. **키 등록**: 저장소 → Settings → Secrets and variables → Actions → New repository secret. 이름 `ECOS_API_KEY`, 값에 인증키.
3. **Pages 켜기**: Settings → Pages → Build and deployment → Source: *Deploy from a branch*, Branch: `main` / `(root)` → Save. 1~2분 뒤 `https://<아이디>.github.io/<저장소이름>/` 에서 열립니다.
4. **첫 갱신 실행**: Actions 탭 → "데이터 갱신" → Run workflow. 초록 체크가 뜨면 성공입니다.

## 유지보수

폰의 Claude 앱(Code) 또는 claude.ai/code에서 이 저장소를 열고 말로 시키면 됩니다. 예:

- "원/엔 환율 차트 추가해줘"
- "요약 탭에 미국 CPI 카드 넣어줘"
- "데이터 갱신이 실패했는데 원인 봐줘"

구조와 지표 추가 방법은 [CLAUDE.md](CLAUDE.md)에 있습니다.

## 데이터를 직접 갱신하려면

```bash
ECOS_API_KEY=발급받은키 node scripts/fetch-data.mjs
```

Node 20 이상과 curl이 필요합니다.
# macro_dashboard
