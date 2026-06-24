/* =========================================================================
 * holdemN.js — 텍사스 홀덤 N인(2~9) 엔진 / 호스트 권위 상태머신
 *
 * N인 베팅 순서, 딜러버튼·블라인드 회전, 사이드팟(서로 다른 올인 금액 정확 분배),
 * 멀티 쇼다운. 헤즈업(N=2)은 버튼=SB 특수 규칙.
 * 칩 보존: 항상 sum(stack) + sum(committed) = 시작 총칩.
 * ======================================================================= */
(function (root) {
  const Cards = root.Cards, Eval = root.Eval;
  const err = m => ({ ok: false, error: m });

  function postBlind(p, amt) {
    const a = Math.min(amt, p.stack);
    p.stack -= a; p.bet += a; p.committed += a;
    if (p.stack === 0) p.allIn = true;
    return a;
  }
  const nonFolded = s => s.players.map((p, i) => i).filter(i => !s.players[i].folded);
  const canBetIdx = s => s.players.map((p, i) => i).filter(i => !s.players[i].folded && !s.players[i].allIn);
  function needsAction(s, i) { const p = s.players[i]; return !p.folded && !p.allIn && (!p.hasActed || p.bet < s.currentBet); }
  function findActor(s, start) { const N = s.N; for (let k = 0; k < N; k++) { const idx = (start + k) % N; if (needsAction(s, idx)) return idx; } return -1; }
  const firstActiveFrom = (s, start) => { const N = s.N; for (let k = 0; k < N; k++) { const idx = (start + k) % N; if (!s.players[idx].folded && !s.players[idx].allIn) return idx; } return -1; };

  function newHand({ sb = 10, bb = 20, stacks = [1000, 1000], button = 0, seed } = {}) {
    const N = stacks.length;
    const rng = seed != null ? Cards.makeRng(seed) : Math.random;
    const deck = Cards.shuffle(Cards.makeDeck(), rng);
    const players = stacks.map(st => ({ stack: st, hole: [], bet: 0, committed: 0, folded: false, allIn: false, hasActed: false }));
    let pos = 0;
    for (let k = 0; k < 2; k++) for (let i = 0; i < N; i++) players[(button + 1 + i) % N].hole.push(deck[pos++]);

    const sbPos = N === 2 ? button : (button + 1) % N;
    const bbPos = N === 2 ? (button + 1) % N : (button + 2) % N;
    postBlind(players[sbPos], sb);
    postBlind(players[bbPos], bb);

    const state = {
      sb, bb, button, N, players, deck, deckPos: pos, community: [],
      street: 'preflop', currentBet: Math.max(...players.map(p => p.bet)), minRaise: bb,
      toAct: 0, phase: 'betting', result: null, sbPos, bbPos, log: [],
    };
    // 프리플랍 첫 액션: 헤즈업=버튼(SB), 그 외=BB 다음(UTG)
    const firstPre = N === 2 ? button : (bbPos + 1) % N;
    const a = findActor(state, firstPre);
    if (a === -1) { runOut(state); return settle(state); } // 전원 블라인드 올인 등
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

  function dealCommunity(s, n) { for (let k = 0; k < n; k++) s.community.push(s.deck[s.deckPos++]); }
  function runOut(s) { if (s.community.length === 0) dealCommunity(s, 3); while (s.community.length < 5) dealCommunity(s, 1); }

  function nextStreet(state) {
    state.players.forEach(p => { p.bet = 0; p.hasActed = false; });
    state.currentBet = 0; state.minRaise = state.bb;
    if (state.street === 'preflop') { dealCommunity(state, 3); state.street = 'flop'; }
    else if (state.street === 'flop') { dealCommunity(state, 1); state.street = 'turn'; }
    else if (state.street === 'turn') { dealCommunity(state, 1); state.street = 'river'; }
    else return settle(state);
    const a = firstActiveFrom(state, (state.button + 1) % state.N);
    if (a === -1 || canBetIdx(state).length <= 1) { runOut(state); return settle(state); }
    state.toAct = a;
    return { ok: true };
  }

  /* 사이드팟 구성: [{amount, eligible:[비폴드 기여자]}]
   * 팟 경계는 '살아있는(비폴드)' 플레이어의 최소 기여로 정함. 폴드한 칩도 팟에 합산(몰수). */
  function buildPots(players) {
    const N = players.length;
    const rem = players.map(p => p.committed);
    const pots = [];
    while (true) {
      let cap = Infinity;
      for (let i = 0; i < N; i++) if (!players[i].folded && rem[i] > 0) cap = Math.min(cap, rem[i]);
      if (cap === Infinity) { // 라이브 기여 소진, 남은 건 폴드 칩 → 마지막 팟에 합산(몰수)
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
    let result = { community: state.community.slice(), pots: [], winnings: new Array(N).fill(0), showdown: false, hands: null };

    if (liveIdx.length === 1) {
      // 전원 폴드 → 한 명이 전부(언콜드 환급 포함 자동)
      const total = P.reduce((s, p) => s + p.committed, 0);
      result.winnings[liveIdx[0]] = total;
      result.pots = [{ amount: total, eligible: liveIdx, winners: liveIdx }];
    } else {
      const evals = {};
      liveIdx.forEach(i => evals[i] = Eval.evalBest([...P[i].hole, ...state.community]));
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
          // 홀수 칩: 버튼 다음(SB쪽)부터 시계방향 첫 승자
          if (rem) {
            const order = winners.slice().sort((a, b) => ((a - state.button - 1 + N) % N) - ((b - state.button - 1 + N) % N));
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

  root.HoldemN = { newHand, legalActions, act, buildPots };
})(typeof window !== 'undefined' ? window : globalThis);
