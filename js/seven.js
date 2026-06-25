/* =========================================================================
 * seven.js — 세븐포커(7-카드 스터드) N인(2~7) 엔진 / 호스트 권위 상태머신
 *
 * 한게임/피망식: 3장(2히든+1오픈) 받고 시작 → 4·5·6번째 오픈 → 7번째 히든.
 * 7장 중 최고 5장으로 승부. 매 카드마다 베팅 라운드(노리밋: 체크/콜/벳/레이즈/폴드/올인).
 * 액션 순서: 3rd street는 가장 낮은 오픈카드가 먼저, 이후는 가장 높은(좋은) 오픈패가 먼저.
 * 사이드팟(서로 다른 올인 금액 정확 분배) + 멀티 쇼다운.
 * 칩 보존: 항상 sum(stack) + sum(committed) = 시작 총칩.
 * ======================================================================= */
(function (root) {
  const Cards = root.Cards, Eval = root.Eval;
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
    p.stack -= a; p.committed += a;            // 앤티는 죽은 돈(콜 대상 아님): bet엔 안 들어감
    if (p.stack === 0) p.allIn = true;
    return a;
  }

  const nonFolded = s => s.players.map((p, i) => i).filter(i => !s.players[i].folded);
  const canBetIdx = s => s.players.map((p, i) => i).filter(i => !s.players[i].folded && !s.players[i].allIn);
  function needsAction(s, i) { const p = s.players[i]; return !p.folded && !p.allIn && (!p.hasActed || p.bet < s.currentBet); }
  function findActor(s, start) { const N = s.N; for (let k = 0; k < N; k++) { const idx = (start + k) % N; if (needsAction(s, idx)) return idx; } return -1; }

  /* 3rd street: 가장 낮은 오픈카드를 가진 플레이어가 먼저(브링인). first부터 순회해 타이브레이크 고정 */
  function bringInAnchor(state) {
    let lo = Infinity, anchor = nonFolded(state)[0];
    for (let k = 0; k < state.N; k++) {
      const i = (state.first + k) % state.N; if (state.players[i].folded) continue;
      const u = state.players[i].cards.find(c => c.up); if (u && u.r < lo) { lo = u.r; anchor = i; }
    }
    return anchor;
  }
  /* 4th 이후: 오픈패가 가장 좋은 플레이어가 먼저 */
  function highAnchor(state) {
    let hi = -Infinity, anchor = nonFolded(state)[0];
    for (let k = 0; k < state.N; k++) {
      const i = (state.first + k) % state.N; if (state.players[i].folded) continue;
      const sc = upScore(state.players[i].cards); if (sc > hi) { hi = sc; anchor = i; }
    }
    return anchor;
  }

  function newHand({ ante = 5, bet = 20, stacks = [1000, 1000], first = 0, seed } = {}) {
    const N = stacks.length;
    const rng = seed != null ? Cards.makeRng(seed) : Math.random;
    const deck = Cards.shuffle(Cards.makeDeck(), rng);
    const players = stacks.map(st => ({ stack: st, cards: [], bet: 0, committed: 0, folded: false, allIn: false, hasActed: false }));
    let pos = 0;
    // 3장씩: 2히든 + 1오픈
    for (let i = 0; i < N; i++) {
      players[i].cards.push({ ...deck[pos++], up: false });
      players[i].cards.push({ ...deck[pos++], up: false });
      players[i].cards.push({ ...deck[pos++], up: true });
    }
    players.forEach(p => postAnte(p, ante));

    const state = {
      ante, bet, N, players, deck, deckPos: pos, street: 3,
      currentBet: 0, minRaise: bet, toAct: 0, phase: 'betting', result: null, first, log: [],
    };
    const a = findActor(state, bringInAnchor(state));
    if (a === -1) { runOut(state); return settle(state); }   // 전원 앤티 올인 등
    state.toAct = a;
    return state;
  }

  function legalActions(state) {
    if (state.phase !== 'betting') return null;
    const i = state.toAct, p = state.players[i];
    const toCall = state.currentBet - p.bet;
    return {
      toAct: i, toCall, canFold: true,
      canCheck: toCall === 0, canCall: toCall > 0 && p.stack > 0, callAmount: Math.min(toCall, p.stack),
      canRaise: p.stack > toCall, minRaiseTo: Math.min(state.currentBet + state.minRaise, p.bet + p.stack), maxRaiseTo: p.bet + p.stack,
    };
  }

  function act(state, action) {
    if (state.phase !== 'betting') return err('베팅 차례가 아닙니다');
    const i = state.toAct, p = state.players[i], la = legalActions(state), t = action && action.type;
    if (t === 'fold') {
      p.folded = true; state.log.push(i + ' fold');
      if (nonFolded(state).length === 1) return settle(state);
      return advance(state);
    }
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
      const full = to >= la.minRaiseTo;
      if (!full && !isAllIn) return err(`최소 ${la.minRaiseTo}까지`);
      const add = to - p.bet; p.stack -= add; p.bet += add; p.committed += add;
      if (p.stack === 0) p.allIn = true;
      if (full) { state.minRaise = to - state.currentBet; state.players.forEach((q, j) => { if (j !== i && !q.folded && !q.allIn) q.hasActed = false; }); }
      state.currentBet = to; p.hasActed = true; state.log.push(`${i} ${t} ${to}`);
      return advance(state);
    }
    return err('알 수 없는 액션');
  }

  function advance(state) {
    const a = findActor(state, (state.toAct + 1) % state.N);
    if (a === -1) return endRound(state);
    state.toAct = a; return { ok: true };
  }

  function endRound(state) {
    if (nonFolded(state).length <= 1) return settle(state);
    if (canBetIdx(state).length <= 1) { runOut(state); return settle(state); }
    return nextStreet(state);
  }

  function dealEach(state, up) {
    for (let i = 0; i < state.N; i++) {
      const p = state.players[i];
      if (!p.folded && p.cards.length < 7) p.cards.push({ ...state.deck[state.deckPos++], up });
    }
  }
  function runOut(state) { while (state.street < 7) { state.street++; dealEach(state, state.street !== 7); } }

  function nextStreet(state) {
    state.players.forEach(p => { p.bet = 0; p.hasActed = false; });
    state.currentBet = 0; state.minRaise = state.bet;
    if (state.street >= 7) return settle(state);
    state.street++;
    dealEach(state, state.street !== 7);              // 4·5·6 오픈, 7 히든
    const a = findActor(state, highAnchor(state));
    if (a === -1 || canBetIdx(state).length <= 1) { runOut(state); return settle(state); }
    state.toAct = a;
    return { ok: true };
  }

  /* 사이드팟 구성: [{amount, eligible:[비폴드 기여자]}]
   * 팟 경계는 '살아있는(비폴드)' 플레이어의 최소 기여로 정함. 폴드한 칩(앤티 포함)도 팟에 합산(몰수). */
  function buildPots(players) {
    const N = players.length;
    const rem = players.map(p => p.committed);
    const pots = [];
    while (true) {
      let cap = Infinity;
      for (let i = 0; i < N; i++) if (!players[i].folded && rem[i] > 0) cap = Math.min(cap, rem[i]);
      if (cap === Infinity) {
        let extra = 0; for (let i = 0; i < N; i++) { extra += rem[i]; rem[i] = 0; }
        if (extra > 0) { if (pots.length) pots[pots.length - 1].amount += extra; else pots.push({ amount: extra, eligible: [] }); }
        break;
      }
      let amount = 0; const eligible = [];
      for (let i = 0; i < N; i++) {
        if (rem[i] > 0) {
          const take = Math.min(cap, rem[i]); rem[i] -= take; amount += take;
          if (!players[i].folded) eligible.push(i);
        }
      }
      pots.push({ amount, eligible });
      if (rem.every(r => r === 0)) break;
    }
    return pots;
  }

  function settle(state) {
    const P = state.players, N = state.N;
    const liveIdx = nonFolded(state);
    let result = { pots: [], winnings: new Array(N).fill(0), showdown: false, hands: null };

    if (liveIdx.length === 1) {
      const total = P.reduce((s, p) => s + p.committed, 0);
      result.winnings[liveIdx[0]] = total;
      result.pots = [{ amount: total, eligible: liveIdx, winners: liveIdx }];
    } else {
      const evals = {};
      liveIdx.forEach(i => evals[i] = Eval.evalBest(P[i].cards.map(c => ({ r: c.r, s: c.s }))));
      result.hands = {}; liveIdx.forEach(i => result.hands[i] = evals[i]);
      result.showdown = true;
      const pots = buildPots(P);
      for (const pot of pots) {
        const elig = pot.eligible;
        let winners;
        if (elig.length === 0) winners = [];
        else if (elig.length === 1) winners = elig.slice();
        else {
          let best = -Infinity; winners = [];
          elig.forEach(i => { const sc = evals[i].score; if (sc > best) { best = sc; winners = [i]; } else if (sc === best) winners.push(i); });
        }
        if (winners.length) {
          const share = Math.floor(pot.amount / winners.length);
          winners.forEach(i => result.winnings[i] += share);
          let rem = pot.amount - share * winners.length;
          if (rem) {  // 홀수 칩: first부터 시계방향 첫 승자
            const order = winners.slice().sort((a, b) => ((a - state.first + N) % N) - ((b - state.first + N) % N));
            result.winnings[order[0]] += rem;
          }
        }
        result.pots.push({ amount: pot.amount, eligible: elig, winners });
      }
    }
    P.forEach((p, i) => { p.stack += result.winnings[i]; p.committed = 0; });
    result.winners = result.winnings.map((w, i) => w > 0 ? i : -1).filter(i => i >= 0);
    result.pot = result.pots.reduce((s, p) => s + p.amount, 0);
    result.stacks = P.map(p => p.stack);
    state.phase = 'done'; state.result = result;
    return { ok: true, done: true };
  }

  root.Seven = { newHand, legalActions, act, buildPots, upScore };
})(typeof window !== 'undefined' ? window : globalThis);
