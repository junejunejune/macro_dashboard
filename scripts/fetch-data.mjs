// 재테크 매크로 대시보드 데이터 수집 스크립트
// 실행: node scripts/fetch-data.mjs   → data/*.csv, data/meta.json 갱신
// 출처: FRED(세인트루이스 연준), 한국은행 ECOS, 미 재무부 Fiscal Data, Yahoo Finance(금 선물)
//
// 환경변수
//   ECOS_API_KEY  한국은행 ECOS 인증키. 없으면 'sample' 키(호출당 10행)를 써서 느립니다.
//
// 한 데이터 묶음이 실패해도 나머지는 계속 갱신하고, 실패한 파일은 이전 값을 그대로 둡니다.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

const START = '2015-01-01';
const OUT = new URL('../data/', import.meta.url);
mkdirSync(OUT, { recursive: true });
const ECOS_KEY = process.env.ECOS_API_KEY || 'sample';
const ECOS_PAGE = ECOS_KEY === 'sample' ? 10 : 1000;

// curl 사용: Node fetch가 일부 서버(FRED)에서 멈추는 경우가 있어 curl로 받습니다.
const get = async (url, type = 'text', tries = 3) => {
  for (let i = 0; i < tries; i++) {
    try {
      const ua = url.includes('yahoo') ? ['-A', 'Mozilla/5.0'] : [];
      const { stdout } = await run('curl', ['-sfL', '-m', '60', ...ua, url], { maxBuffer: 1 << 28 });
      return type === 'json' ? JSON.parse(stdout) : stdout;
    } catch (e) {
      if (i === tries - 1) throw new Error(`요청 실패: ${url.replace(ECOS_KEY, '***')}`);
      await new Promise((s) => setTimeout(s, 2000 * (i + 1)));
    }
  }
};
const csv = (rows, cols) => [cols.join(','), ...rows.map((r) => cols.map((c) => r[c] ?? '').join(','))].join('\n') + '\n';
const save = (name, rows, cols) => {
  if (rows.length < 10) throw new Error(`${name}: 행이 ${rows.length}개뿐이라 저장하지 않음`);
  writeFileSync(new URL(name, OUT), csv(rows, cols));
  console.log(`✓ ${name}: ${rows.length}행, 마지막 ${JSON.stringify(rows.at(-1))}`);
};
const ym = (d) => d.slice(0, 7);
const round = (v, n = 3) => (v == null || Number.isNaN(v) ? null : +v.toFixed(n));
const months = (...maps) => [...new Set(maps.flatMap((m) => [...m.keys()]))].sort();
const monthEnd = (m) => { const o = new Map(); for (const [d, v] of m) o.set(ym(d), v); return o; };
const monthAvg = (m) => { const s = new Map(); for (const [d, v] of m) { const k = ym(d); const a = s.get(k) || [0, 0]; s.set(k, [a[0] + v, a[1] + 1]); } return new Map([...s].map(([k, [t, n]]) => [k, t / n])); };

// ---------- FRED ----------
async function fred(id, from = START) {
  const t = await get(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${from}`);
  const m = new Map();
  for (const line of t.trim().split('\n').slice(1)) {
    const [d, v] = line.split(',');
    if (v && v !== '.') m.set(d, +v);
  }
  if (!m.size) throw new Error(`FRED ${id}: 값 없음`);
  return m;
}

// ---------- ECOS ----------
async function ecos(stat, item, cycle = 'M', from = '201501', to = '203012') {
  const out = new Map();
  const url = (s) => `https://ecos.bok.or.kr/api/StatisticSearch/${ECOS_KEY}/json/kr/${s}/${s + ECOS_PAGE - 1}/${stat}/${cycle}/${from}/${to}/${item}`;
  const add = (j) => {
    if (j.RESULT && j.RESULT.CODE !== 'INFO-000') throw new Error(`ECOS ${stat}/${item}: ${j.RESULT.MESSAGE}`);
    (j.StatisticSearch?.row || []).forEach((r) => out.set(r.TIME, +r.DATA_VALUE));
  };
  const first = await get(url(1), 'json');
  add(first);
  const total = first.StatisticSearch?.list_total_count ?? 0;
  for (let s = 1 + ECOS_PAGE; s <= total; s += ECOS_PAGE) add(await get(url(s), 'json'));
  if (!out.size) throw new Error(`ECOS ${stat}/${item}: 값 없음`);
  return new Map([...out].map(([t, v]) => [`${t.slice(0, 4)}-${t.slice(4, 6)}`, v]));
}

// ---------- 미 재무부 Fiscal Data ----------
const FD = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service';
async function fd(path, params) {
  let page = 1, rows = [];
  for (;;) {
    const j = await get(`${FD}${path}?${params}&page%5Bsize%5D=10000&page%5Bnumber%5D=${page}`, 'json');
    rows = rows.concat(j.data);
    if (page >= (j.meta?.['total-pages'] ?? 1)) break;
    page++;
  }
  return rows;
}

// ---------- Yahoo (지수·종목·금 선물) ----------
// 일별 종가. 날짜는 거래소 현지 날짜(뉴욕)로 맞춤
async function yahooDaily(sym, from = START) {
  const j = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${Date.parse(from) / 1000}&period2=${Math.floor(Date.now() / 1000)}&interval=1d`, 'json');
  const r = j.chart.result[0];
  const off = (r.meta.gmtoffset || 0) * 1000;
  const m = new Map();
  r.timestamp.forEach((t, i) => { const c = r.indicators.quote[0].close[i]; if (c != null) m.set(new Date(t * 1000 + off).toISOString().slice(0, 10), c); });
  if (!m.size) throw new Error(`Yahoo ${sym}: 값 없음`);
  return m;
}
const yahooMonthlyAvg = async (sym) => monthAvg(await yahooDaily(sym));

// ---------- 데이터 묶음 ----------
const jobs = {
  // 원/달러(월평균) + 금(달러/온스, 월평균)
  async krw_value() {
    const [usdkrwD, gold] = await Promise.all([fred('DEXKOUS'), yahooMonthlyAvg('GC=F')]);
    const usdkrw = monthAvg(usdkrwD);
    save('krw_value.csv', months(usdkrw, gold).filter((k) => usdkrw.has(k) && gold.has(k)).map((k) => ({
      month: k, usdkrw: round(usdkrw.get(k), 2), gold_usd_oz: round(gold.get(k), 1),
    })), ['month', 'usdkrw', 'gold_usd_oz']);
  },

  // 한국 M2(평잔, 계절조정, 십억원) + 미국 M2(계절조정, 십억달러)
  async money_supply() {
    const [krM2, usM2] = await Promise.all([ecos('161Y005', 'BBHS00'), fred('M2SL').then(monthEnd)]);
    save('money_supply.csv', months(krM2, usM2).map((k) => ({ month: k, kr_m2_bil_krw: round(krM2.get(k), 1), us_m2_bil_usd: round(usM2.get(k), 1) })),
      ['month', 'kr_m2_bil_krw', 'us_m2_bil_usd']);
  },

  // 한국 금리(월평균, 연%)
  async kr_rates() {
    const items = {
      base: ['722Y001', '0101000'], // 한국은행 기준금리
      ktb3y: ['721Y001', '5020000'], // 국고채 3년
      ktb10y: ['721Y001', '5050000'], // 국고채 10년
      ktb30y: ['721Y001', '5070000'], // 국고채 30년
      kdb1y: ['721Y001', '6050000'], // 산금채 1년 (은행채 대용)
      corp_aa: ['721Y001', '7020000'], // 회사채 3년 AA-
      cd91: ['721Y001', '2010000'], // CD 91일
      mortgage: ['121Y006', 'BECBLA0302'], // 예금은행 주택담보대출 금리(신규취급액)
    };
    const kr = {};
    for (const [k, [s, i]] of Object.entries(items)) kr[k] = await ecos(s, i);
    save('kr_rates.csv', months(...Object.values(kr)).map((m) => ({ month: m, ...Object.fromEntries(Object.entries(kr).map(([k, v]) => [k, v.get(m)])) })),
      ['month', ...Object.keys(items)]);
  },

  // 미국 금리(일별, 2019~, 연%)
  async us_rates() {
    const ids = { fed_upper: 'DFEDTARU', fed_lower: 'DFEDTARL', effr: 'DFF', t3m: 'DGS3MO', t1y: 'DGS1', t2y: 'DGS2', t5y: 'DGS5', t10y: 'DGS10', t20y: 'DGS20', t30y: 'DGS30' };
    const us = {};
    for (const [k, id] of Object.entries(ids)) us[k] = await fred(id, '2019-01-01');
    const days = [...us.t10y.keys()].sort(); // 국채 거래일 기준
    save('us_rates.csv', days.map((d) => ({ date: d, ...Object.fromEntries(Object.keys(ids).map((k) => [k, us[k].get(d) ?? null])) })), ['date', ...Object.keys(ids)]);
  },

  // 미국 물가·고용(월별). 전년비 계산을 위해 2014년부터 받음
  async us_macro() {
    const ids = {
      cpi: 'CPIAUCSL', // 소비자물가지수(CPI), 계절조정
      core_cpi: 'CPILFESL', // 근원 CPI(식품·에너지 제외)
      pce: 'PCEPI', // PCE 물가지수
      core_pce: 'PCEPILFE', // 근원 PCE (연준 2% 목표의 기준)
      payems: 'PAYEMS', // 비농업 고용자 수(천 명)
      unrate: 'UNRATE', // 실업률(%)
      ahe: 'CES0500000003', // 민간 평균 시간당 임금(달러)
    };
    const m = {};
    for (const [k, id] of Object.entries(ids)) m[k] = monthEnd(await fred(id, '2014-01-01'));
    save('us_macro.csv', months(...Object.values(m)).map((mo) => ({ month: mo, ...Object.fromEntries(Object.keys(ids).map((k) => [k, m[k].get(mo) ?? null])) })),
      ['month', ...Object.keys(ids)]);
  },

  // 미국 신규 실업수당 청구(주간, 2019~, 명)
  async us_claims() {
    const c = await fred('ICSA', '2019-01-01');
    save('us_claims.csv', [...c].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, claims: v })), ['date', 'claims']);
  },

  // 미국 증시·금(일별 종가, 2019~). 지수는 포인트, 종목은 달러(액면분할 반영), 금은 달러/온스
  async markets() {
    const syms = { dji: '^DJI', ixic: '^IXIC', gold: 'GC=F', aapl: 'AAPL', msft: 'MSFT', googl: 'GOOGL', amzn: 'AMZN', meta: 'META', nvda: 'NVDA', tsla: 'TSLA' };
    const data = {};
    for (const [k, sym] of Object.entries(syms)) data[k] = await yahooDaily(sym, '2019-01-01');
    const days = [...data.ixic.keys()].sort(); // 나스닥 거래일 기준
    save('markets.csv', days.map((d) => ({ date: d, ...Object.fromEntries(Object.keys(syms).map((k) => [k, round(data[k].get(d), 2)])) })), ['date', ...Object.keys(syms)]);
  },

  // 미국 연방 총부채(일별 → 월말, 조 달러)
  async us_debt() {
    const penny = await fd('/v2/accounting/od/debt_to_penny', `fields=record_date,tot_pub_debt_out_amt,debt_held_public_amt,intragov_hold_amt&filter=record_date:gte:${START}&sort=record_date`);
    const byMonth = new Map(); for (const r of penny) byMonth.set(ym(r.record_date), r);
    save('us_debt.csv', [...byMonth.values()].map((r) => ({
      date: r.record_date, total_tril: round(r.tot_pub_debt_out_amt / 1e12, 4), public_tril: round(r.debt_held_public_amt / 1e12, 4), intragov_tril: round(r.intragov_hold_amt / 1e12, 4),
    })), ['date', 'total_tril', 'public_tril', 'intragov_tril']);
  },

  // 시장성 국채 잔액 구성(월말, 십억 달러) — MSPD Table 1
  async treasury_composition() {
    const mspd = await fd('/v1/debt/mspd/mspd_table_1', `fields=record_date,security_type_desc,security_class_desc,total_mil_amt&filter=record_date:gte:${START},security_type_desc:eq:Marketable&sort=record_date`);
    const key = { Bills: 'bills', Notes: 'notes', Bonds: 'bonds', 'Treasury Inflation-Protected Securities': 'tips', 'Floating Rate Notes': 'frn' };
    const comp = new Map();
    for (const r of mspd) { const k = key[r.security_class_desc]; if (!k) continue; const o = comp.get(r.record_date) || { date: r.record_date }; o[k] = round(r.total_mil_amt / 1000, 1); comp.set(r.record_date, o); }
    save('treasury_composition.csv', [...comp.values()], ['date', 'bills', 'notes', 'bonds', 'tips', 'frn']);
  },

  // 국채 입찰 발행액(발행월·종류별 합계, 십억 달러). 낙찰액, 없으면 공고액
  async treasury_issuance() {
    const auc = await fd('/v1/accounting/od/auctions_query', `fields=issue_date,security_type,total_accepted,offering_amt,inflation_index_security,floating_rate&filter=issue_date:gte:2018-01-01&sort=issue_date`);
    const iss = new Map();
    const today = new Date().toISOString().slice(0, 10);
    for (const r of auc) {
      if (r.issue_date > today) continue;
      const amt = +(r.total_accepted !== 'null' ? r.total_accepted : r.offering_amt); if (!amt) continue;
      const k = r.security_type === 'Bill' ? 'bills' : r.inflation_index_security === 'Yes' ? 'tips' : r.floating_rate === 'Yes' ? 'frn' : r.security_type === 'Bond' ? 'bonds' : 'notes';
      const m = ym(r.issue_date); const o = iss.get(m) || { month: m, bills: 0, notes: 0, bonds: 0, tips: 0, frn: 0 }; o[k] += amt / 1e9; iss.set(m, o);
    }
    save('treasury_issuance.csv', [...iss.values()].sort((a, b) => a.month.localeCompare(b.month)).map((o) => ({ month: o.month, bills: round(o.bills, 1), notes: round(o.notes, 1), bonds: round(o.bonds, 1), tips: round(o.tips, 1), frn: round(o.frn, 1) })),
      ['month', 'bills', 'notes', 'bonds', 'tips', 'frn']);
  },
};

// 명령줄에 이름을 주면 그 묶음만: node scripts/fetch-data.mjs kr_rates us_rates
const only = process.argv.slice(2);
const metaUrl = new URL('meta.json', OUT);
const meta = existsSync(metaUrl) ? JSON.parse(readFileSync(metaUrl, 'utf8')) : { datasets: {} };
const now = new Date().toISOString();
let failed = 0;
for (const [name, job] of Object.entries(jobs)) {
  if (only.length && !only.includes(name)) continue;
  try {
    await job();
    meta.datasets[name] = { ...(meta.datasets[name] || {}), updated: now, error: null };
  } catch (e) {
    failed++;
    meta.datasets[name] = { ...(meta.datasets[name] || {}), error: e.message, failedAt: now };
    console.log(`::warning title=${name} 갱신 실패::${e.message}`);
  }
}
meta.checked = now;
writeFileSync(metaUrl, JSON.stringify(meta, null, 2) + '\n');
console.log(failed ? `${failed}개 묶음 실패 (이전 데이터 유지)` : '모두 갱신됨');
if (failed === Object.keys(jobs).length) process.exit(1);
