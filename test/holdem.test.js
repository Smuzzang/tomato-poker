/* node test/holdem.test.js — 홀덤 엔진 검증 (칩 보존·종료성·정산) */
const fs = require('fs'), path = require('path');
const base = path.join(__dirname, '..', 'js');
['cards.js', 'evaluator.js', 'holdem.js'].forEach(f => eval(fs.readFileSync(path.join(base, f), 'utf8')));
const { newHand, legalActions, act } = globalThis.Holdem;

let fails = [];
const bad = (m) => fails.push(m);

function randAction(state) {
  const la = legalActions(state);
  const opts = [];
  // 폴드 확률 낮춰 더 많은 스트리트/쇼다운 유도
  if (Math.random() < 0.12) opts.push({ type: 'fold' });
  if (la.canCheck) opts.push({ type: 'check' });
  if (la.canCall) { opts.push({ type: 'call' }); opts.push({ type: 'call' }); }
  if (la.canRaise) {
    const lo = la.minRaiseTo, hi = la.maxRaiseTo;
    const amt = lo + Math.floor(Math.random() * (hi - lo + 1));
    opts.push({ type: 'raise', amount: amt });
    if (Math.random() < 0.25) opts.push({ type: 'allin' });
  }
  if (!opts.length) opts.push({ type: 'check' }); // fallback (있을 수 없음)
  return opts[Math.floor(Math.random() * opts.length)];
}

const HANDS = 50000;
let played = 0, showdowns = 0, folds = 0, splits = 0, allinHands = 0, maxActions = 0;
let stacks = [200, 200], button = 0;
let TOTAL = stacks[0] + stacks[1];

for (let h = 0; h < HANDS; h++) {
  // 한쪽이 파산하면 리셋
  if (stacks[0] <= 0 || stacks[1] <= 0) { stacks = [200, 200]; TOTAL = 400; }
  const startTotal = stacks[0] + stacks[1];
  let st;
  try { st = newHand({ sb: 1, bb: 2, stacks: stacks.slice(), button, seed: (Math.random() * 4294967295) >>> 0 }); }
  catch (e) { bad('newHand throw: ' + e); break; }
  played++;

  let actions = 0;
  while (st.phase === 'betting' && actions < 400) {
    actions++;
    // 칩 보존(진행 중): stack + committed == startTotal
    const mid = st.players[0].stack + st.players[1].stack + st.players[0].committed + st.players[1].committed;
    if (mid !== startTotal) { bad(`mid conservation ${mid}!=${startTotal} hand${h}`); break; }
    if (st.players[0].stack < 0 || st.players[1].stack < 0) { bad('neg stack hand' + h); break; }
    const la = legalActions(st);
    if (!la || la.toAct == null) { bad('no legalActions hand' + h); break; }
    const r = act(st, randAction(st));
    if (r && r.ok === false) {
      // 합법 액션만 줬는데 거부되면 버그
      bad('action rejected: ' + r.error + ' hand' + h);
      break;
    }
  }
  if (actions >= 400) bad('non-terminating hand' + h);
  maxActions = Math.max(maxActions, actions);

  if (st.phase !== 'done' || !st.result) { bad('not done hand' + h); break; }
  // 정산 후 칩 보존
  const endTotal = st.players[0].stack + st.players[1].stack;
  if (endTotal !== startTotal) { bad(`end conservation ${endTotal}!=${startTotal} hand${h}`); break; }
  if (st.players[0].stack < 0 || st.players[1].stack < 0) { bad('neg end stack hand' + h); break; }
  // result.stacks 일치
  if (st.result.stacks[0] !== st.players[0].stack || st.result.stacks[1] !== st.players[1].stack) bad('result.stacks mismatch hand' + h);
  // 승자 유효
  if (!st.result.winners.length || st.result.winners.some(w => w !== 0 && w !== 1)) bad('bad winners hand' + h);

  if (st.result.showdown) showdowns++; else folds++;
  if (st.result.winners.length === 2) splits++;
  if (st.players.some(p => false)) {}
  if (st.community.length === 5 && st.result.showdown) {} // ok
  if (st.result.pot >= startTotal) allinHands++; // 대략 올인 추정

  // 다음 핸드: 스택 이월, 버튼 교대
  stacks = st.result.stacks.slice();
  button = 1 - button;
  if (fails.length > 5) break;
}

// 디렉티드: 프리플랍 폴드 → 상대가 블라인드 획득
(function () {
  const st = newHand({ sb: 1, bb: 2, stacks: [100, 100], button: 0, seed: 7 });
  // 버튼(SB=0)이 프리플랍 먼저 → 폴드
  const r = act(st, { type: 'fold' });
  if (!st.result || st.result.winners[0] !== 1) bad('directed: BB가 못 이김');
  if (st.players[1].stack !== 101 || st.players[0].stack !== 99) bad(`directed fold stacks ${st.players[0].stack}/${st.players[1].stack} (기대 99/101)`);
})();

// 디렉티드: 끝까지 체크/콜 → 쇼다운, 5장 보드
(function () {
  let st = newHand({ sb: 1, bb: 2, stacks: [100, 100], button: 0, seed: 99 });
  let guard = 0;
  while (st.phase === 'betting' && guard++ < 50) {
    const la = legalActions(st);
    act(st, la.canCheck ? { type: 'check' } : { type: 'call' });
  }
  if (!st.result || !st.result.showdown) bad('directed: 체크다운 쇼다운 안 됨');
  if (st.community.length !== 5) bad('directed: 보드 5장 아님 = ' + st.community.length);
})();

console.log('=== 홀덤 엔진 검증 ===');
console.log(`핸드 ${played.toLocaleString()} | 쇼다운 ${showdowns} | 폴드승 ${folds} | 스플릿 ${splits} | 최대액션수/핸드 ${maxActions}`);
console.log('실패:', fails.length ? fails.slice(0, 10) : '없음');
console.log('결과:', fails.length === 0 ? '✅ 전부 통과' : '❌ 실패');
process.exit(fails.length === 0 ? 0 : 1);
