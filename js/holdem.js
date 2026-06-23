/* =========================================================================
 * holdem.js — 텍사스 홀덤 헤즈업(2인) 엔진 / 호스트 권위 상태머신
 *
 * 헤즈업 규칙: 버튼 = 스몰블라인드. 프리플랍은 버튼(SB)이 먼저, 그 외엔 BB가 먼저.
 * 액션: fold / check / call / raise(to) / allin.  올인·언콜드 벳 환급·스플릿 처리.
 * 칩 보존: 항상 stack 합 + committed 합 = 시작 총칩.
 * ======================================================================= */
(function (root) {
  const Cards = root.Cards, Eval = root.Eval;

  const oppOf = i => 1 - i;
  function err(msg) { return { ok: false, error: msg }; }

  function postBlind(p, amt) {
    const a = Math.min(amt, p.stack);
    p.stack -= a; p.bet += a; p.committed += a;
    if (p.stack === 0) p.allIn = true;
    return a;
  }

  /* 새 핸드 시작 */
  function newHand({ sb = 1, bb = 2, stacks = [100, 100], button = 0, seed } = {}) {
    const rng = seed != null ? Cards.makeRng(seed) : Math.random;
    const deck = Cards.shuffle(Cards.makeDeck(), rng);
    const players = [0, 1].map(i => ({
      stack: stacks[i], hole: [], bet: 0, committed: 0,
      folded: false, allIn: false, hasActed: false,
    }));
    let pos = 0;
    for (let k = 0; k < 2; k++) for (let i = 0; i < 2; i++) players[i].hole.push(deck[pos++]);

    const sbIdx = button, bbIdx = oppOf(button);
    postBlind(players[sbIdx], sb);
    postBlind(players[bbIdx], bb);

    const state = {
      sb, bb, players, button, deck, deckPos: pos, community: [],
      street: 'preflop',
      currentBet: Math.max(players[0].bet, players[1].bet),
      minRaise: bb,                 // 다음 레이즈 최소 증가폭
      toAct: sbIdx,
      phase: 'betting',
      result: null,
      log: [],
    };
    // 블라인드만으로 액션이 끝나는(둘 다 올인 등) 경우 정리
    settleIfRoundClosed(state, /*justStarted*/true);
    return state;
  }

  const live = s => [0, 1].filter(i => !s.players[i].folded);
  const canStillBet = s => live(s).filter(i => !s.players[i].allIn);

  /* 현재 차례 플레이어의 합법 액션 */
  function legalActions(state) {
    if (state.phase !== 'betting') return null;
    const i = state.toAct, p = state.players[i];
    const toCall = state.currentBet - p.bet;
    const canCheck = toCall === 0;
    const canCall = toCall > 0 && p.stack > 0;
    const callAmount = Math.min(toCall, p.stack);
    const canRaise = p.stack > toCall;                 // 콜 이상으로 더 낼 칩이 있어야
    const minRaiseTo = state.currentBet + state.minRaise;
    const maxRaiseTo = p.bet + p.stack;                // 올인 한도(이번 스트리트 누적 기준)
    return {
      toAct: i, toCall, canFold: true, canCheck, canCall, callAmount,
      canRaise, minRaiseTo: Math.min(minRaiseTo, maxRaiseTo), maxRaiseTo,
    };
  }

  /* 액션 적용. action = {type, amount?}  amount = 이번 스트리트 '누적 베팅 목표(raise to)' */
  function act(state, action) {
    if (state.phase !== 'betting') return err('베팅 차례가 아닙니다');
    const i = state.toAct, p = state.players[i];
    const la = legalActions(state);
    const t = action && action.type;

    if (t === 'fold') {
      p.folded = true; state.log.push(`${i} fold`);
      return settleFold(state, oppOf(i));
    }
    if (t === 'check') {
      if (!la.canCheck) return err('체크 불가(콜해야 함)');
      p.hasActed = true; state.log.push(`${i} check`);
      return advance(state);
    }
    if (t === 'call') {
      if (la.toCall <= 0) return err('콜할 금액 없음');
      const a = Math.min(la.toCall, p.stack);
      p.stack -= a; p.bet += a; p.committed += a;
      if (p.stack === 0) p.allIn = true;
      p.hasActed = true; state.log.push(`${i} call ${a}`);
      return advance(state);
    }
    if (t === 'raise' || t === 'allin') {
      let target = t === 'allin' ? la.maxRaiseTo : action.amount;
      if (typeof target !== 'number') return err('레이즈 금액 필요');
      target = Math.min(target, la.maxRaiseTo);          // 올인 한도
      const isAllIn = target === la.maxRaiseTo;
      if (target <= state.currentBet) return err('레이즈는 현재 벳보다 커야');
      // 풀 레이즈가 아니면(올인 숏레이즈) 허용은 하되 minRaise 갱신 안 함
      const fullRaise = target >= la.minRaiseTo;
      if (!fullRaise && !isAllIn) return err(`최소 ${la.minRaiseTo}까지 레이즈해야`);
      const add = target - p.bet;
      p.stack -= add; p.bet += add; p.committed += add;
      if (p.stack === 0) p.allIn = true;
      const raiseSize = target - state.currentBet;
      if (fullRaise) state.minRaise = raiseSize;          // 풀 레이즈만 minRaise 갱신
      state.currentBet = target;
      // 상대는 다시 응답해야 함
      state.players[oppOf(i)].hasActed = false;
      p.hasActed = true;
      state.log.push(`${i} ${t} to ${target}`);
      return advance(state);
    }
    return err('알 수 없는 액션');
  }

  /* 한 명만 남으면(폴드) 즉시 정산 */
  function settleFold(state, winner) {
    return settle(state, [winner]);
  }

  /* 액션 후 차례/스트리트 진행 */
  function advance(state) {
    if (roundClosed(state)) return settleIfRoundClosed(state);
    // 다음 행동 가능한 플레이어에게
    let n = oppOf(state.toAct);
    // 상대가 올인/폴드면 라운드가 닫혔어야 함 → 안전장치
    state.toAct = n;
    return { ok: true };
  }

  function roundClosed(state) {
    if (live(state).length < 2) return true;
    const actms = canStillBet(state).map(i => state.players[i]);
    if (actms.length === 0) return true;                 // 둘 다 올인
    if (actms.length === 1) {
      // 한 명만 칩 보유: 그가 콜/체크로 현재벳 맞췄고 행동했으면 닫힘
      const p = actms[0];
      return p.hasActed && p.bet === state.currentBet;
    }
    return actms.every(p => p.hasActed && p.bet === state.currentBet);
  }

  /* 라운드 종료 처리: 폴드면 정산, 아니면 다음 스트리트(또는 보드 끝까지 깔고 쇼다운) */
  function settleIfRoundClosed(state, justStarted) {
    if (live(state).length < 2) return settle(state, live(state));
    // 더 베팅할 수 있는 사람이 2명 미만이면 남은 보드 전부 깔고 쇼다운
    if (canStillBet(state).length < 2 && !justStarted) {
      runOutBoard(state);
      return settle(state, live(state));
    }
    if (justStarted) {
      // 시작 직후: 둘 다 올인이면 보드 깔고 쇼다운, 아니면 그대로 베팅 진행
      if (canStillBet(state).length < 2) { runOutBoard(state); return settle(state, live(state)); }
      return { ok: true };
    }
    return nextStreet(state);
  }

  function dealCommunity(state, n) {
    for (let k = 0; k < n; k++) state.community.push(state.deck[state.deckPos++]);
  }
  function runOutBoard(state) {
    if (state.community.length === 0) dealCommunity(state, 3);
    while (state.community.length < 5) dealCommunity(state, 1);
  }

  function nextStreet(state) {
    // 스트리트 누적은 committed에 이미 반영됨. 베팅 상태 리셋
    state.players.forEach(p => { p.bet = 0; p.hasActed = false; });
    state.currentBet = 0; state.minRaise = state.bb;
    if (state.street === 'preflop') { dealCommunity(state, 3); state.street = 'flop'; }
    else if (state.street === 'flop') { dealCommunity(state, 1); state.street = 'turn'; }
    else if (state.street === 'turn') { dealCommunity(state, 1); state.street = 'river'; }
    else if (state.street === 'river') { return settle(state, live(state)); }
    // 포스트플랍: 비버튼(BB)이 먼저
    state.toAct = oppOf(state.button);
    // 시작하자마자 액션 불가(둘 다 올인 등)면 다음으로
    if (canStillBet(state).length < 2) { runOutBoard(state); return settle(state, live(state)); }
    return { ok: true };
  }

  /* 정산: 언콜드 환급 → 팟 분배(승/스플릿) */
  function settle(state, winnersLive) {
    const P = state.players;
    // 언콜드 벳 환급
    if (P[0].committed !== P[1].committed) {
      const over = P[0].committed > P[1].committed ? 0 : 1;
      const diff = Math.abs(P[0].committed - P[1].committed);
      P[over].stack += diff; P[over].committed -= diff;
    }
    const pot = P[0].committed + P[1].committed;
    const liveIdx = live(state);
    let winners, hands = null;
    if (liveIdx.length === 1) winners = [liveIdx[0]];
    else {
      const e0 = Eval.evalBest([...P[0].hole, ...state.community]);
      const e1 = Eval.evalBest([...P[1].hole, ...state.community]);
      hands = [e0, e1];
      const d = Eval.compare(e0, e1);
      winners = d > 0 ? [0] : d < 0 ? [1] : [0, 1];
    }
    if (winners.length === 1) P[winners[0]].stack += pot;
    else {
      const half = Math.floor(pot / 2);
      P[0].stack += half; P[1].stack += half;
      if (pot % 2) P[oppOf(state.button)].stack += 1;   // 홀수 칩은 OOP(비버튼)에게(관례)
    }
    P.forEach(p => { p.committed = 0; });
    state.phase = 'done';
    state.result = {
      winners, pot, community: state.community.slice(),
      hands, showdown: liveIdx.length > 1,
      stacks: [P[0].stack, P[1].stack],
    };
    return { ok: true, done: true };
  }

  root.Holdem = { newHand, legalActions, act, oppOf };
})(typeof window !== 'undefined' ? window : globalThis);
