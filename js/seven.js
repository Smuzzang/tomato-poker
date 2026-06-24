/* =========================================================================
 * seven.js — 세븐포커(7-카드 스터드) 헤즈업 엔진 / 호스트 권위 상태머신
 *
 * 한게임/피망식: 3장(2히든+1오픈) 받고 시작 → 4·5·6번째 오픈 → 7번째 히든.
 * 7장 중 최고 5장으로 승부. 매 카드마다 베팅 라운드(노리밋: 체크/콜/벳/레이즈/폴드/올인).
 * 액션 순서: 3rd street는 낮은 오픈카드가 먼저, 이후는 높은 오픈패가 먼저.
 * ======================================================================= */
(function (root) {
  const Cards = root.Cards, Eval = root.Eval;
  const oppOf = i => 1 - i;
  const err = m => ({ ok: false, error: m });

  /* 오픈 카드만으로 대략적 강함(액션 순서용). 그룹(페어/트립) 우선, 그다음 하이카드 */
  function upScore(cards) {
    const up = cards.filter(c => c.up).map(c => c.r);
    if (!up.length) return 0;
    const cnt = {}; up.forEach(r => cnt[r] = (cnt[r] || 0) + 1);
    const groups = Object.keys(cnt).map(Number).map(r => [cnt[r], r]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
    let s = 0; groups.forEach(g => { s = s * 100 + g[0] * 15 + g[1]; });
    return s;
  }

  function postAnte(p, amt) {
    const a = Math.min(amt, p.stack);
    p.stack -= a; p.committed += a;
    if (p.stack === 0) p.allIn = true;
    return a;
  }

  function newHand({ ante = 5, bet = 20, stacks = [1000, 1000], first = 0, seed } = {}) {
    const rng = seed != null ? Cards.makeRng(seed) : Math.random;
    const deck = Cards.shuffle(Cards.makeDeck(), rng);
    const players = [0, 1].map(i => ({
      stack: stacks[i], cards: [], bet: 0, committed: 0, folded: false, allIn: false, hasActed: false,
    }));
    let pos = 0;
    // 3장씩: 2히든 + 1오픈
    for (let i = 0; i < 2; i++) {
      players[i].cards.push({ ...deck[pos++], up: false });
      players[i].cards.push({ ...deck[pos++], up: false });
      players[i].cards.push({ ...deck[pos++], up: true });
    }
    players.forEach(p => postAnte(p, ante));

    const state = {
      ante, bet, players, deck, deckPos: pos, street: 3,
      currentBet: 0, minRaise: bet, toAct: 0, phase: 'betting', result: null, log: [],
      first,
    };
    // 3rd street: 낮은 오픈카드가 먼저
    const u0 = players[0].cards.find(c => c.up).r, u1 = players[1].cards.find(c => c.up).r;
    state.toAct = u0 !== u1 ? (u0 < u1 ? 0 : 1) : first;
    return state;
  }

  const live = s => [0, 1].filter(i => !s.players[i].folded);
  const canBet = s => live(s).filter(i => !s.players[i].allIn);

  function legalActions(state) {
    if (state.phase !== 'betting') return null;
    const i = state.toAct, p = state.players[i];
    const toCall = state.currentBet - p.bet;
    const canCheck = toCall === 0;
    const canCall = toCall > 0 && p.stack > 0;
    const minRaiseTo = state.currentBet + state.minRaise;
    const maxRaiseTo = p.bet + p.stack;
    return {
      toAct: i, toCall, canFold: true, canCheck, canCall, callAmount: Math.min(toCall, p.stack),
      canRaise: p.stack > toCall, minRaiseTo: Math.min(minRaiseTo, maxRaiseTo), maxRaiseTo,
    };
  }

  function act(state, action) {
    if (state.phase !== 'betting') return err('베팅 차례가 아닙니다');
    const i = state.toAct, p = state.players[i], la = legalActions(state), t = action && action.type;
    if (t === 'fold') { p.folded = true; state.log.push(i + ' fold'); return settle(state, [oppOf(i)]); }
    if (t === 'check') { if (!la.canCheck) return err('체크 불가'); p.hasActed = true; return advance(state); }
    if (t === 'call') {
      if (la.toCall <= 0) return err('콜 금액 없음');
      const a = Math.min(la.toCall, p.stack); p.stack -= a; p.bet += a; p.committed += a;
      if (p.stack === 0) p.allIn = true; p.hasActed = true; return advance(state);
    }
    if (t === 'raise' || t === 'allin') {
      let to = t === 'allin' ? la.maxRaiseTo : action.amount;
      if (typeof to !== 'number') return err('레이즈 금액 필요');
      to = Math.min(to, la.maxRaiseTo);
      const isAllIn = to === la.maxRaiseTo;
      if (to <= state.currentBet) return err('레이즈는 현재 벳보다 커야');
      const fullRaise = to >= la.minRaiseTo;
      if (!fullRaise && !isAllIn) return err(`최소 ${la.minRaiseTo}까지`);
      const add = to - p.bet; p.stack -= add; p.bet += add; p.committed += add;
      if (p.stack === 0) p.allIn = true;
      if (fullRaise) state.minRaise = to - state.currentBet;
      state.currentBet = to; state.players[oppOf(i)].hasActed = false; p.hasActed = true;
      return advance(state);
    }
    return err('알 수 없는 액션');
  }

  function advance(state) {
    if (roundClosed(state)) return roundEnd(state);
    state.toAct = oppOf(state.toAct);
    return { ok: true };
  }
  function roundClosed(state) {
    if (live(state).length < 2) return true;
    const act = canBet(state).map(i => state.players[i]);
    if (act.length === 0) return true;
    if (act.length === 1) { const p = act[0]; return p.hasActed && p.bet === state.currentBet; }
    return act.every(p => p.hasActed && p.bet === state.currentBet);
  }
  function roundEnd(state) {
    if (live(state).length < 2) return settle(state, live(state));
    if (canBet(state).length < 2) { runOut(state); return settle(state, live(state)); }
    return nextStreet(state);
  }

  function dealEach(state, up) {
    for (let i = 0; i < 2; i++) if (!state.players[i].folded) state.players[i].cards.push({ ...state.deck[state.deckPos++], up });
  }
  function runOut(state) { while (state.street < 7) { state.street++; dealEach(state, state.street !== 7); } }

  function nextStreet(state) {
    state.players.forEach(p => { p.bet = 0; p.hasActed = false; });
    state.currentBet = 0; state.minRaise = state.bet;
    if (state.street >= 7) return settle(state, live(state));
    state.street++;
    dealEach(state, state.street !== 7);              // 4·5·6 오픈, 7 히든
    // 이후 스트리트: 높은 오픈패가 먼저
    const s0 = upScore(state.players[0].cards), s1 = upScore(state.players[1].cards);
    state.toAct = s0 !== s1 ? (s0 > s1 ? 0 : 1) : state.first;
    if (canBet(state).length < 2) { runOut(state); return settle(state, live(state)); }
    return { ok: true };
  }

  function settle(state, winnersLive) {
    const P = state.players;
    if (P[0].committed !== P[1].committed) {
      const over = P[0].committed > P[1].committed ? 0 : 1, diff = Math.abs(P[0].committed - P[1].committed);
      P[over].stack += diff; P[over].committed -= diff;
    }
    const pot = P[0].committed + P[1].committed;
    const liveIdx = live(state);
    let winners, hands = null;
    if (liveIdx.length === 1) winners = [liveIdx[0]];
    else {
      const e0 = Eval.evalBest(P[0].cards.map(c => ({ r: c.r, s: c.s })));
      const e1 = Eval.evalBest(P[1].cards.map(c => ({ r: c.r, s: c.s })));
      hands = [e0, e1];
      const d = Eval.compare(e0, e1);
      winners = d > 0 ? [0] : d < 0 ? [1] : [0, 1];
    }
    if (winners.length === 1) P[winners[0]].stack += pot;
    else { const h = Math.floor(pot / 2); P[0].stack += h; P[1].stack += h; if (pot % 2) P[state.first].stack += 1; }
    P.forEach(p => { p.committed = 0; });
    state.phase = 'done';
    state.result = { winners, pot, hands, showdown: liveIdx.length > 1, stacks: [P[0].stack, P[1].stack] };
    return { ok: true, done: true };
  }

  root.Seven = { newHand, legalActions, act, oppOf, upScore };
})(typeof window !== 'undefined' ? window : globalThis);
