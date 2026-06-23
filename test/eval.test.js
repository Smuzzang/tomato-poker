/* node test/eval.test.js — 족보 평가기 검증 (단위 + 랜덤 분포) */
const fs = require('fs');
const path = require('path');
const base = path.join(__dirname, '..', 'js');
eval(fs.readFileSync(path.join(base, 'cards.js'), 'utf8'));
eval(fs.readFileSync(path.join(base, 'evaluator.js'), 'utf8'));
const { makeDeck, shuffle, makeRng } = globalThis.Cards;
const { eval5, evalBest, catName } = globalThis.Eval;

const SUITMAP = { s: 0, h: 1, d: 2, c: 3 };
const RANKMAP = { A: 14, K: 13, Q: 12, J: 11, T: 10 };
function C(str) { // "As" "Td" "2c"
  const rc = str.slice(0, -1), sc = str.slice(-1);
  const r = RANKMAP[rc] || Number(rc);
  return { r, s: SUITMAP[sc] };
}
function H(...ss) { return ss.map(C); }

let pass = 0, fail = 0;
const fails = [];
function eq(name, got, want) { if (got === want) pass++; else { fail++; fails.push(`${name}: got ${got}, want ${want}`); } }
function ok(name, cond) { if (cond) pass++; else { fail++; fails.push(name); } }

// ── A. 카테고리 단위 테스트 ──
eq('로열', eval5(H('As', 'Ks', 'Qs', 'Js', 'Ts')).cat, 8);
eq('스플(킹high)', eval5(H('Ks', 'Qs', 'Js', 'Ts', '9s')).cat, 8);
eq('휠 스플', eval5(H('5s', '4s', '3s', '2s', 'As')).cat, 8);
eq('포카드', eval5(H('9s', '9h', '9d', '9c', '2s')).cat, 7);
eq('풀하우스', eval5(H('9s', '9h', '9d', '2c', '2s')).cat, 6);
eq('플러시', eval5(H('As', 'Js', '9s', '6s', '2s')).cat, 5);
eq('스트레이트', eval5(H('9s', '8h', '7d', '6c', '5s')).cat, 4);
eq('휠 스트레이트', eval5(H('As', '2h', '3d', '4c', '5s')).cat, 4);
eq('트리플', eval5(H('9s', '9h', '9d', 'Kc', '2s')).cat, 3);
eq('투페어', eval5(H('9s', '9h', '5d', '5c', '2s')).cat, 2);
eq('원페어', eval5(H('9s', '9h', 'Kd', '7c', '2s')).cat, 1);
eq('하이카드', eval5(H('As', 'Jh', '9d', '6c', '2s')).cat, 0);

// 휠은 6-high 스트레이트보다 약하고, A-high 스트레이트가 K-high보다 강함
ok('휠 < 6high', eval5(H('5s', '4h', '3d', '2c', 'As')).score < eval5(H('6s', '5h', '4d', '3c', '2s')).score);
ok('Ahigh straight > Khigh', eval5(H('As', 'Kh', 'Qd', 'Jc', 'Ts')).score > eval5(H('Ks', 'Qh', 'Jd', 'Tc', '9s')).score);

// ── B. 점수 순서: 약 → 강 (각 카테고리 대표) ──
const ladder = [
  H('As', 'Jh', '9d', '6c', '2s'),   // 하이카드
  H('2s', '2h', 'Kd', '7c', '4s'),   // 원페어
  H('5s', '5h', '3d', '3c', 'Ks'),   // 투페어
  H('8s', '8h', '8d', 'Kc', '2s'),   // 트리플
  H('9s', '8h', '7d', '6c', '5s'),   // 스트레이트
  H('As', 'Js', '9s', '6s', '2s'),   // 플러시
  H('9s', '9h', '9d', '2c', '2s'),   // 풀하우스
  H('9s', '9h', '9d', '9c', '2s'),   // 포카드
  H('Ks', 'Qs', 'Js', 'Ts', '9s'),  // 스플
];
for (let i = 1; i < ladder.length; i++)
  ok('ladder ' + i, eval5(ladder[i]).score > eval5(ladder[i - 1]).score);

// ── C. 키커/타이브레이크 ──
ok('높은 페어 우세', eval5(H('Ks', 'Kh', '3d', '4c', '2s')).score > eval5(H('Qs', 'Qh', 'Ad', 'Kc', 'Js')).score);
ok('같은 페어 키커', eval5(H('Ks', 'Kh', 'Ad', '4c', '2s')).score > eval5(H('Ks', 'Kh', 'Qd', 'Jc', '2s')).score);
ok('풀하우스 트립 우선', eval5(H('Ks', 'Kh', 'Kd', '2c', '2s')).score > eval5(H('Qs', 'Qh', 'Qd', 'Ac', 'As')).score);

// ── D. evalBest (7장 중 최고 5장) ──
ok('7장 플러시 인식', evalBest(H('As', 'Ks', 'Qs', '2s', '7s', '9h', '3d')).cat === 5);
ok('7장 풀하우스', evalBest(H('9s', '9h', '9d', '2c', '2s', 'Kh', '5d')).cat === 6);
ok('7장 휠 스플', evalBest(H('As', '2s', '3s', '4s', '5s', 'Kh', 'Kd')).cat === 8);
// 동점(스플릿): 같은 보드, 서로 다른 죽은 패
ok('동점 스플릿', evalBest(H('As', 'Ks', 'Qd', 'Jc', 'Th', '2s', '3d')).score === evalBest(H('As', 'Ks', 'Qd', 'Jc', 'Th', '4s', '5d')).score);

// ── E. 랜덤 7장 분포 (실제 포커 확률과 비교) ──
const N = 300000;
const rng = makeRng(12345);
const tally = new Array(9).fill(0);
const deck = makeDeck();
for (let g = 0; g < N; g++) {
  const sh = shuffle(deck, rng);
  tally[evalBest(sh.slice(0, 7)).cat]++;
}
// 알려진 7장 핸드 확률(%)
const EXP = { 0: 17.41, 1: 43.82, 2: 23.50, 3: 4.83, 4: 4.62, 5: 3.03, 6: 2.60, 7: 0.168, 8: 0.0311 };
let distOk = true;
const distReport = [];
for (let c = 0; c <= 8; c++) {
  const pct = (tally[c] / N) * 100;
  const exp = EXP[c];
  const tol = Math.max(exp * 0.15, 0.02); // 15% 상대 오차 또는 0.02%p 허용
  const within = Math.abs(pct - exp) <= tol;
  if (!within) distOk = false;
  distReport.push(`${catName(c)}: ${pct.toFixed(3)}% (기대 ${exp}%) ${within ? 'OK' : '★어긋남'}`);
}
ok('랜덤 분포 일치', distOk);

console.log('=== 단위 테스트 ===');
console.log(`pass ${pass} / fail ${fail}`);
if (fails.length) console.log('실패:', fails);
console.log('\n=== 랜덤 7장 ' + N.toLocaleString() + '판 카테고리 분포 ===');
distReport.forEach(l => console.log('  ' + l));
console.log('\n결과:', fail === 0 ? '✅ 전부 통과' : '❌ 실패 있음');
process.exit(fail === 0 ? 0 : 1);
