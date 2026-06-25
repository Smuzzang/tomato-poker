/* =========================================================================
 * ai.js — 홀덤 헤즈업 AI (휴리스틱)
 * 핸드 강도(프리플랍 점수 / 포스트플랍 메이드+드로) + 팟 오즈 + 약간의 블러핑.
 * 난이도: easy(소극) / normal / hard(공격적·블러프↑)
 * ======================================================================= */
(function (root) {
  const Eval = root.Eval;

  /* 프리플랍 두 장 강도 0..1 (대략 Chen 비슷한 휴리스틱) */
  function preflop(hole) {
    const [a, b] = hole;
    const hi = Math.max(a.r, b.r), lo = Math.min(a.r, b.r);
    const suited = a.s === b.s;
    const gap = hi - lo;
    let s;
    if (a.r === b.r) s = 0.50 + (a.r - 2) / 24;             // 페어: 22≈0.5 ~ AA≈1.0
    else {
      s = (hi - 2) / 28 + (lo - 2) / 40;                    // 하이카드 비중
      if (suited) s += 0.08;
      if (gap === 1) s += 0.06; else if (gap === 2) s += 0.03; // 커넥터
      if (hi === 14) s += 0.05;                              // 에이스
      if (gap >= 5) s -= 0.05;
    }
    return Math.max(0, Math.min(1, s));
  }

  /* 보드 기준 메이드 핸드 + 드로 보정 → 0..1 */
  function postflop(hole, board) {
    const e = Eval.evalBest([...hole, ...board]);
    let s;
    switch (e.cat) {
      case 8: case 7: s = 0.98; break;                       // 스플/포카드
      case 6: s = 0.93; break;                               // 풀하우스
      case 5: s = 0.86; break;                               // 플러시
      case 4: s = 0.82; break;                               // 스트레이트
      case 3: s = 0.74; break;                               // 트리플
      case 2: s = 0.60; break;                               // 투페어
      case 1: {                                              // 원페어: 보드 대비 위치
        const top = Math.max(...board.map(c => c.r));
        const pr = e.tb[0];
        s = pr >= top ? 0.52 : pr >= 10 ? 0.42 : 0.34;
        break;
      }
      default: s = 0.16;                                     // 하이카드
    }
    // 드로 보정(플러시/스트레이트 드로면 +)
    s += drawBonus(hole, board);
    return Math.max(0, Math.min(1, s));
  }

  function drawBonus(hole, board) {
    const cards = [...hole, ...board];
    // 플러시 드로(같은 무늬 4장)
    const bySuit = [0, 0, 0, 0]; cards.forEach(c => bySuit[c.s]++);
    let bonus = 0;
    if (board.length < 5 && Math.max(...bySuit) === 4) bonus += 0.12;
    // 오픈엔드 스트레이트 드로 근사: 유니크 랭크 4연속
    const rs = [...new Set(cards.map(c => c.r))].sort((a, b) => a - b);
    let run = 1, best = 1;
    for (let i = 1; i < rs.length; i++) { run = rs[i] - rs[i - 1] === 1 ? run + 1 : 1; best = Math.max(best, run); }
    if (board.length < 5 && best >= 4) bonus += 0.10;
    return bonus;
  }

  /* 강도 계산 */
  function strength(state, idx) {
    const me = state.players[idx];
    return state.community.length === 0 ? preflop(me.hole) : postflop(me.hole, state.community);
  }

  /* 의사결정 → {type, amount?} (legalActions 범위 내 합법 액션) */
  function decide(state, idx, diff) {
    diff = diff || 'normal';
    const eng = root.HoldemN || root.Holdem;
    const la = eng.legalActions(state);
    const s = strength(state, idx);
    const pot = state.players.reduce((a, p) => a + p.committed, 0);
    const toCall = la.toCall;
    const rnd = Math.random();
    const aggro = diff === 'hard' ? 1.25 : diff === 'easy' ? 0.7 : 1;
    const bluff = (diff === 'hard' ? 0.16 : diff === 'easy' ? 0.04 : 0.09);

    // 레이즈 목표 금액(현재벳 + 팟의 일부)
    const raiseTo = () => {
      const target = state.currentBet + Math.max(state.bb, Math.round((pot + toCall) * (0.5 + rnd * 0.4)));
      return Math.max(la.minRaiseTo, Math.min(target, la.maxRaiseTo));
    };

    if (toCall === 0) {
      // 체크 or 벳
      if (la.canRaise && (s > 0.7 || (s > 0.45 * aggro && rnd < 0.45 * aggro) || rnd < bluff)) {
        return { type: 'raise', amount: raiseTo() };
      }
      return { type: 'check' };
    }
    // 콜 결정 (팟 오즈)
    const potOdds = toCall / (pot + toCall);
    // 강한 패: 가끔 레이즈
    if (s > 0.8 && la.canRaise && rnd < 0.6 * aggro) return { type: 'raise', amount: raiseTo() };
    if (s > 0.78 && la.canRaise && rnd < 0.3) return { type: 'allin' };
    if (s >= potOdds + 0.06 && la.canCall) return { type: 'call' };
    if (la.canCall && rnd < bluff) return { type: 'call' };       // 가끔 블러프 콜
    // 콜할 칩 없거나 약하면 폴드(체크 가능하면 체크)
    if (la.canCheck) return { type: 'check' };
    return { type: 'fold' };
  }

  /* ---- 세븐포커 ---- */
  function catStrength(cat) {
    return [0.16, 0.5, 0.6, 0.74, 0.82, 0.86, 0.93, 0.98, 0.99][cat];
  }
  function sevenStrength(cards) {
    const cs = cards.map(c => ({ r: c.r, s: c.s }));
    if (cs.length >= 5) {
      const e = Eval.evalBest(cs);
      let s = catStrength(e.cat);
      if (e.cat <= 1) s += (e.tb[0] - 2) / 60;          // 페어 높을수록 약간 가산
      return Math.min(1, s);
    }
    const cnt = {}; cs.forEach(c => cnt[c.r] = (cnt[c.r] || 0) + 1);
    const g = Object.values(cnt).sort((a, b) => b - a);
    const hi = Math.max(...cs.map(c => c.r));
    if (g[0] >= 3) return 0.72;
    if (g[0] === 2) return 0.46 + (hi - 2) / 50;
    return 0.16 + (hi - 2) / 45;
  }

  function decideSeven(state, idx, diff) {
    diff = diff || 'normal';
    const la = root.Seven.legalActions(state);
    const me = state.players[idx];
    const s = sevenStrength(me.cards);
    const pot = state.players.reduce((a, p) => a + p.committed, 0);
    const toCall = la.toCall, rnd = Math.random();
    const aggro = diff === 'hard' ? 1.25 : diff === 'easy' ? 0.7 : 1;
    const bluff = diff === 'hard' ? 0.14 : diff === 'easy' ? 0.03 : 0.07;
    const raiseTo = () => {
      const t = state.currentBet + Math.max(state.bet, Math.round((pot + toCall) * (0.5 + rnd * 0.4)));
      return Math.max(la.minRaiseTo, Math.min(t, la.maxRaiseTo));
    };
    if (toCall === 0) {
      if (la.canRaise && (s > 0.7 || (s > 0.45 * aggro && rnd < 0.42 * aggro) || rnd < bluff)) return { type: 'raise', amount: raiseTo() };
      return { type: 'check' };
    }
    const potOdds = toCall / (pot + toCall);
    if (s > 0.8 && la.canRaise && rnd < 0.55 * aggro) return { type: 'raise', amount: raiseTo() };
    if (s >= potOdds + 0.05 && la.canCall) return { type: 'call' };
    if (la.canCall && rnd < bluff) return { type: 'call' };
    if (la.canCheck) return { type: 'check' };
    return { type: 'fold' };
  }

  root.PokerAI = { decide, strength, preflop, postflop, decideSeven, sevenStrength };
})(typeof window !== 'undefined' ? window : globalThis);
