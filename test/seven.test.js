/* node test/seven.test.js — 세븐포커 엔진 검증 */
const fs = require('fs'), path = require('path');
const base = path.join(__dirname, '..', 'js');
['cards.js', 'evaluator.js', 'seven.js'].forEach(f => eval(fs.readFileSync(path.join(base, f), 'utf8')));
const { newHand, legalActions, act } = globalThis.Seven;

let fails = [];
const bad = m => { if (fails.length < 12) fails.push(m); };

function randAction(state) {
  const la = legalActions(state); const o = [];
  if (Math.random() < 0.10) o.push({ type: 'fold' });
  if (la.canCheck) o.push({ type: 'check' });
  if (la.canCall) { o.push({ type: 'call' }); o.push({ type: 'call' }); }
  if (la.canRaise) { const lo = la.minRaiseTo, hi = la.maxRaiseTo; o.push({ type: 'raise', amount: lo + Math.floor(Math.random() * (hi - lo + 1)) }); if (Math.random() < 0.2) o.push({ type: 'allin' }); }
  if (!o.length) o.push({ type: 'check' });
  return o[Math.floor(Math.random() * o.length)];
}

const HANDS = 40000;
let played = 0, showdowns = 0, folds = 0, splits = 0, reached7 = 0;
let stacks = [1000, 1000], first = 0;

for (let h = 0; h < HANDS; h++) {
  if (stacks[0] <= 0 || stacks[1] <= 0) stacks = [1000, 1000];
  const start = stacks[0] + stacks[1];
  let st;
  try { st = newHand({ ante: 5, bet: 20, stacks: stacks.slice(), first, seed: (Math.random() * 4294967295) >>> 0 }); }
  catch (e) { bad('newHand: ' + e); break; }
  played++;
  let n = 0;
  while (st.phase === 'betting' && n < 400) {
    n++;
    const mid = st.players[0].stack + st.players[1].stack + st.players[0].committed + st.players[1].committed;
    if (mid !== start) { bad(`mid cons ${mid}!=${start} h${h}`); break; }
    if (st.players[0].stack < 0 || st.players[1].stack < 0) { bad('neg stack h' + h); break; }
    const r = act(st, randAction(st));
    if (r && r.ok === false) { bad('reject ' + r.error + ' h' + h); break; }
  }
  if (n >= 400) { bad('nonterm h' + h); break; }
  if (st.phase !== 'done' || !st.result) { bad('not done h' + h); break; }
  const end = st.players[0].stack + st.players[1].stack;
  if (end !== start) { bad(`end cons ${end}!=${start} h${h}`); break; }
  // 카드 유일성(모든 딜된 카드)
  const all = [...st.players[0].cards, ...st.players[1].cards].map(c => c.r + '-' + c.s);
  if (new Set(all).size !== all.length) bad('dup cards h' + h);
  // 쇼다운까지 갔으면 라이브 플레이어는 7장
  if (st.result.showdown) { showdowns++; st.players.forEach((p, i) => { if (!p.folded && p.cards.length !== 7) bad(`p${i} not 7 cards (${p.cards.length}) h${h}`); }); }
  else folds++;
  if (st.players.some(p => !p.folded && p.cards.length === 7)) reached7++;
  if (st.result.winners.length === 2) splits++;
  if (st.result.stacks[0] !== st.players[0].stack) bad('result.stacks mismatch h' + h);

  stacks = st.result.stacks.slice(); first = 1 - first;
  if (fails.length > 6) break;
}

console.log('=== 세븐포커 엔진 검증 ===');
console.log(`핸드 ${played.toLocaleString()} | 쇼다운 ${showdowns} | 폴드승 ${folds} | 스플릿 ${splits} | 7장도달 ${reached7}`);
console.log('실패:', fails.length ? fails : '없음');
console.log('결과:', fails.length === 0 ? '✅ 전부 통과' : '❌ 실패');
process.exit(fails.length === 0 ? 0 : 1);
