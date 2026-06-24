/* node test/holdemN.test.js — N인 홀덤 엔진 검증(칩보존·사이드팟·종료성) */
const fs = require('fs'), path = require('path');
const base = path.join(__dirname, '..', 'js');
['cards.js', 'evaluator.js', 'holdemN.js'].forEach(f => eval(fs.readFileSync(path.join(base, f), 'utf8')));
const { newHand, legalActions, act, buildPots } = globalThis.HoldemN;

let fails = [];
const bad = m => { if (fails.length < 15) fails.push(m); };

function randAction(state) {
  const la = legalActions(state); const o = [];
  if (Math.random() < 0.12) o.push({ type: 'fold' });
  if (la.canCheck) o.push({ type: 'check' });
  if (la.canCall) { o.push({ type: 'call' }); o.push({ type: 'call' }); }
  if (la.canRaise) { const lo = la.minRaiseTo, hi = la.maxRaiseTo; o.push({ type: 'raise', amount: lo + Math.floor(Math.random() * (hi - lo + 1)) }); if (Math.random() < 0.3) o.push({ type: 'allin' }); }
  if (!o.length) o.push({ type: la.canCheck ? 'check' : 'call' });
  return o[Math.floor(Math.random() * o.length)];
}

let totalHands = 0, sidePotHands = 0, showdowns = 0, folds = 0, splits = 0;
for (let trial = 0; trial < 6000; trial++) {
  const N = 2 + Math.floor(Math.random() * 5); // 2~6인
  // 다양한 스택(짧은 스택 섞어 올인/사이드팟 유발)
  let stacks = Array.from({ length: N }, () => 100 + Math.floor(Math.random() * 900));
  let button = Math.floor(Math.random() * N);
  for (let h = 0; h < 8; h++) {
    const active = stacks.map((s, i) => s > 0 ? i : -1).filter(i => i >= 0);
    if (active.length < 2) break;
    // 0칩 플레이어 제외하고 진행(간단화: 0칩이면 다음 핸드 리셋 대신 게임 종료)
    if (stacks.some(s => s <= 0)) break;
    const start = stacks.reduce((a, b) => a + b, 0);
    let st;
    try { st = newHand({ sb: 10, bb: 20, stacks: stacks.slice(), button, seed: (Math.random() * 4294967295) >>> 0 }); }
    catch (e) { bad('newHand ' + e); break; }
    totalHands++;
    let steps = 0;
    while (st.phase === 'betting' && steps < 600) {
      steps++;
      const mid = st.players.reduce((a, p) => a + p.stack + p.committed, 0);
      if (mid !== start) { bad(`mid cons ${mid}!=${start} N${N}`); break; }
      if (st.players.some(p => p.stack < 0)) { bad('neg stack N' + N); break; }
      const r = act(st, randAction(st));
      if (r && r.ok === false) { bad('reject ' + r.error + ' N' + N); break; }
    }
    if (steps >= 600) { bad('nonterm N' + N); break; }
    if (st.phase !== 'done' || !st.result) { bad('not done N' + N); break; }
    const end = st.players.reduce((a, p) => a + p.stack, 0);
    if (end !== start) { bad(`end cons ${end}!=${start} N${N}`); break; }
    if (st.players.some(p => p.stack < 0)) bad('neg end stack N' + N);
    // 팟 합 = winnings 합
    const potSum = st.result.pots.reduce((a, p) => a + p.amount, 0);
    const winSum = st.result.winnings.reduce((a, w) => a + w, 0);
    if (potSum !== winSum) bad(`pot${potSum}!=win${winSum} N${N}`);
    if (st.result.pots.length >= 2) sidePotHands++;
    if (st.result.showdown) showdowns++; else folds++;
    if (st.result.winners.length >= 2) splits++;
    stacks = st.result.stacks.slice(); button = (button + 1) % N;
    if (fails.length > 8) break;
  }
  if (fails.length > 8) break;
}

// 디렉티드 사이드팟: 스택 [50, 200, 200], 전원 올인 → 메인팟+사이드팟 정확 분배
(function () {
  // buildPots 단위 검증
  const P = [
    { committed: 50, folded: false }, { committed: 200, folded: false }, { committed: 200, folded: false },
  ];
  const pots = buildPots(P);
  // 레벨 50: 50*3=150 (전원), 레벨 200: 150*2=300 (1,2)
  const total = pots.reduce((a, p) => a + p.amount, 0);
  if (total !== 450) bad('directed pot total ' + total + ' !=450');
  if (pots.length !== 2) bad('directed pots len ' + pots.length);
  if (pots[0].amount !== 150 || pots[1].amount !== 300) bad(`directed amounts ${pots[0].amount}/${pots[1].amount}`);
  if (pots[1].eligible.join() !== '1,2') bad('directed sidepot eligible ' + pots[1].eligible.join());
})();

console.log('=== N인 홀덤 엔진 검증 ===');
console.log(`핸드 ${totalHands.toLocaleString()} | 쇼다운 ${showdowns} | 폴드승 ${folds} | 스플릿 ${splits} | 사이드팟발생 ${sidePotHands}`);
console.log('실패:', fails.length ? fails : '없음');
console.log('결과:', fails.length === 0 ? '✅ 전부 통과' : '❌ 실패');
process.exit(fails.length === 0 ? 0 : 1);
