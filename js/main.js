/* =========================================================================
 * main.js — 토마토 포커 컨트롤러 (혼자 하기 = 텍사스 홀덤 vs AI)
 * 엔진(Holdem) 권위 → 렌더 → 내/AI 액션 → 다음 핸드.
 * ======================================================================= */
(function () {
  const $ = s => document.querySelector(s);
  const Holdem = window.Holdem, Cards = window.Cards, Eval = window.Eval, AI = window.PokerAI;

  const App = {
    mode: null, game: 'holdem', diff: 'normal', nick: '나',
    state: null, sb: 10, bb: 20, stacks: [1000, 1000], button: 0,
    busy: false, revealOpp: false, handNo: 0,
  };
  const START_STACK = 1000, SB = 10, BB = 20;

  /* ---------------- 로비 ---------------- */
  function initLobby() {
    $('#nickname').value = localStorage.getItem('tpoker_nick') || '';
    $('#gameSeg').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.game === 'seven') { toast('세븐포커는 준비 중이에요', 'red'); return; }
      $('#gameSeg').querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); App.game = b.dataset.game;
    });
    $('#diffSeg').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      $('#diffSeg').querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on'); App.diff = b.dataset.diff;
    });
    $('#btnSingle').addEventListener('click', startSingle);
    $('#btnHost').addEventListener('click', () => toast('온라인 대전은 다음 업데이트에서!', 'red'));
    $('#btnHelp').addEventListener('click', () => { const h = $('#help'); h.hidden = !h.hidden; if (!h.innerHTML) h.innerHTML = HELP; });
    $('#leaveBtn').addEventListener('click', () => { App.state = null; show('lobby'); });

    $('#btnFold').addEventListener('click', () => myAct({ type: 'fold' }));
    $('#btnCall').addEventListener('click', () => myAct(callAction()));
    $('#btnRaise').addEventListener('click', openRaise);
    $('#btnRaiseCancel').addEventListener('click', () => $('#raisePanel').hidden = true);
    $('#btnRaiseDo').addEventListener('click', doRaise);
    $('#raiseSlider').addEventListener('input', () => $('#raiseAmt').textContent = $('#raiseSlider').value);
    $('#raisePanel').querySelectorAll('.rq').forEach(b => b.addEventListener('click', () => quickRaise(b.dataset.q)));
  }

  function nickname() { const n = ($('#nickname').value || '').trim() || '플레이어'; localStorage.setItem('tpoker_nick', n); return n.slice(0, 8); }
  function show(id) { ['lobby', 'table'].forEach(s => $('#' + s).hidden = (s !== id)); }

  /* ---------------- 게임 시작 ---------------- */
  function startSingle() {
    App.mode = 'single'; App.nick = nickname();
    App.stacks = [START_STACK, START_STACK]; App.button = Math.random() < 0.5 ? 0 : 1; App.handNo = 0;
    $('#myName').textContent = App.nick;
    show('table');
    newHand();
  }

  function newHand() {
    App.handNo++;
    App.revealOpp = false; App.busy = false;
    App.state = Holdem.newHand({ sb: SB, bb: BB, stacks: App.stacks.slice(), button: App.button, seed: (Math.random() * 4294967295) >>> 0 });
    $('#modal').hidden = true;
    $('#boardMsg').textContent = '';
    render();
    SFXdeal();
    setTimeout(drive, 500);
  }

  /* ---------------- 진행(턴 분배) ---------------- */
  function drive() {
    const s = App.state; if (!s) return;
    if (s.phase === 'done') { onHandDone(); return; }
    render();
    if (s.toAct === 1) { // AI
      hideActions();
      App.busy = true;
      setTimeout(() => {
        if (!App.state || App.state.phase !== 'betting' || App.state.toAct !== 1) return;
        const before = streetOf(App.state);
        const a = AI.decide(App.state, 1, App.diff);
        Holdem.act(App.state, a);
        announceAI(a);
        App.busy = false;
        afterStreetFx(before);
        drive();
      }, 850 + Math.random() * 500);
    } else { // 나
      App.busy = false;
      showActions();
    }
  }

  function streetOf(s) { return s.street + '/' + s.community.length; }
  function afterStreetFx(before) {
    const s = App.state; if (!s) return;
    if (s.phase === 'done') return;
    if (streetOf(s) !== before) {
      const names = { flop: '플랍', turn: '턴', river: '리버' };
      if (names[s.street]) { $('#boardMsg').textContent = names[s.street]; SFXdeal(); }
    }
  }

  /* ---------------- 내 액션 ---------------- */
  function callAction() {
    const la = Holdem.legalActions(App.state);
    return la.canCheck ? { type: 'check' } : { type: 'call' };
  }
  function myAct(a) {
    if (App.busy || !App.state || App.state.phase !== 'betting' || App.state.toAct !== 0) return;
    $('#raisePanel').hidden = true;
    const before = streetOf(App.state);
    const r = Holdem.act(App.state, a);
    if (r && r.ok === false) { toast(r.error, 'red'); return; }
    afterStreetFx(before);
    drive();
  }
  function openRaise() {
    const la = Holdem.legalActions(App.state);
    if (!la.canRaise) { toast('레이즈할 수 없어요', 'red'); return; }
    const sl = $('#raiseSlider');
    sl.min = la.minRaiseTo; sl.max = la.maxRaiseTo; sl.step = SB; sl.value = Math.min(la.maxRaiseTo, la.minRaiseTo);
    $('#raiseAmt').textContent = sl.value;
    $('#raisePanel').hidden = false;
  }
  function quickRaise(q) {
    const la = Holdem.legalActions(App.state); const s = App.state;
    const pot = s.players[0].committed + s.players[1].committed;
    let to;
    if (q === 'allin') to = la.maxRaiseTo;
    else to = s.currentBet + Math.round(pot * Number(q));
    to = Math.max(la.minRaiseTo, Math.min(to, la.maxRaiseTo));
    to = Math.round(to / SB) * SB; to = Math.max(la.minRaiseTo, Math.min(to, la.maxRaiseTo));
    $('#raiseSlider').value = to; $('#raiseAmt').textContent = to;
  }
  function doRaise() {
    const to = Number($('#raiseSlider').value);
    const la = Holdem.legalActions(App.state);
    $('#raisePanel').hidden = true;
    myAct({ type: to >= la.maxRaiseTo ? 'allin' : 'raise', amount: to });
  }

  /* ---------------- 핸드 종료 ---------------- */
  function onHandDone() {
    const s = App.state, r = s.result;
    App.revealOpp = !!r.showdown;
    if (r.showdown) $('#boardMsg').textContent = '';
    render();
    hideActions();
    App.stacks = r.stacks.slice();
    // 승자 강조
    const winSeat = r.winners.length === 2 ? null : (r.winners[0] === 0 ? '#seatMe' : '#seatOpp');
    if (winSeat) $(winSeat).classList.add('win-glow');
    setTimeout(() => { $('#seatMe').classList.remove('win-glow'); $('#seatOpp').classList.remove('win-glow'); showResult(r); }, r.showdown ? 1400 : 700);
  }

  function showResult(r) {
    const s = App.state;
    const iWon = r.winners.includes(0);
    const split = r.winners.length === 2;
    const busted = s.players[0].stack <= 0 || s.players[1].stack <= 0;
    let handsHtml = '';
    if (r.showdown && r.hands) {
      const mk = (idx) => {
        const p = s.players[idx];
        const cards = p.hole.map(c => `<div class="pcard"><img src="${Cards.imgPath(c)}"></div>`).join('');
        return `<div class="sh"><div class="cards">${cards}</div><div class="cat">${Eval.catName(r.hands[idx].cat)}</div></div>`;
      };
      handsHtml = `<div class="show-hands">${mk(0)}${mk(1)}</div>`;
    }
    const title = split ? '무승부 (스플릿)' : iWon ? '🎉 승리!' : '😢 패배';
    const box = $('#modalBox');
    box.innerHTML = `
      <h2>${title}</h2>
      <p class="muted">${r.showdown ? '쇼다운' : '상대 폴드'}</p>
      ${handsHtml}
      <div class="big-amt">팟 ${r.pot}</div>
      <p class="muted">내 칩 ${s.players[0].stack} · 상대 ${s.players[1].stack}</p>
      <div class="modal-actions">
        ${busted ? `<button class="btn-again" id="mAgain">다시 시작</button>` : `<button class="btn-again" id="mAgain">다음 핸드</button>`}
        <button class="btn-home" id="mHome">메인</button>
      </div>`;
    $('#modal').hidden = false;
    $('#mAgain').onclick = () => {
      $('#modal').hidden = true;
      if (busted) { App.stacks = [START_STACK, START_STACK]; }
      App.button = 1 - App.button; // 버튼 교대
      newHand();
    };
    $('#mHome').onclick = () => { App.state = null; show('lobby'); };
    if (busted) {
      const overTitle = s.players[0].stack <= 0 ? '💸 파산! 게임 오버' : '🏆 상대 파산! 완승';
      box.querySelector('h2').textContent = overTitle;
    }
  }

  /* ---------------- 렌더 ---------------- */
  function render() {
    const s = App.state; if (!s) return;
    $('#myStack').textContent = s.players[0].stack;
    $('#oppStack').textContent = s.players[1].stack;
    $('#myDealer').hidden = s.button !== 0;
    $('#oppDealer').hidden = s.button !== 1;
    renderHole($('#myHole'), s.players[0].hole, true, s.players[0].folded);
    renderHole($('#oppHole'), s.players[1].hole, App.revealOpp, s.players[1].folded);
    renderCommunity(s.community);
    const pot = s.players[0].committed + s.players[1].committed;
    $('#pot').textContent = '팟 ' + pot;
    showBet($('#myBet'), s.players[0].bet);
    showBet($('#oppBet'), s.players[1].bet);
    const myTurn = s.phase === 'betting' && s.toAct === 0;
    const oppTurn = s.phase === 'betting' && s.toAct === 1;
    $('#seatMe').classList.toggle('active', myTurn);
    $('#seatOpp').classList.toggle('active', oppTurn);
  }
  function renderHole(box, hole, faceUp, folded) {
    box.innerHTML = '';
    hole.forEach(c => { const el = Cards.makeCardEl(c, faceUp); if (folded) el.classList.add('muck'); box.appendChild(el); });
  }
  function renderCommunity(comm) {
    const box = $('#community'); box.innerHTML = '';
    for (let i = 0; i < 5; i++) {
      if (comm[i]) box.appendChild(Cards.makeCardEl(comm[i], true));
      else { const d = document.createElement('div'); d.className = 'slot'; box.appendChild(d); }
    }
  }
  function showBet(el, amt) { if (amt > 0) { el.hidden = false; el.textContent = amt; } else el.hidden = true; }

  /* ---------------- 액션 컨트롤 ---------------- */
  function showActions() {
    const la = Holdem.legalActions(App.state); if (!la) { hideActions(); return; }
    $('#actions').hidden = false;
    $('#btnFold').disabled = false;
    $('#btnFold').style.display = la.canCheck ? 'none' : ''; // 체크 가능하면 폴드 숨김(공짜인데 폴드 방지)
    const call = $('#btnCall');
    call.disabled = false;
    call.textContent = la.canCheck ? '체크' : ('콜 ' + la.callAmount);
    const raise = $('#btnRaise');
    raise.disabled = !la.canRaise;
    raise.textContent = la.toCall === 0 ? '벳' : '레이즈';
  }
  function hideActions() { $('#actions').hidden = true; $('#raisePanel').hidden = true; }

  /* ---------------- 잡동사니 ---------------- */
  function announceAI(a) {
    const m = { fold: '폴드', check: '체크', call: '콜', raise: '레이즈', allin: '올인 🔥' };
    toast('AI: ' + (m[a.type] || a.type), a.type === 'fold' ? '' : a.type === 'allin' ? 'red' : '');
  }
  function toast(text, variant) {
    const t = document.createElement('div'); t.className = 'toast' + (variant ? ' ' + variant : ''); t.textContent = text;
    $('#toasts').appendChild(t); setTimeout(() => t.remove(), 1600);
  }
  function SFXdeal() { /* 사운드 자리(추후) */ }

  const HELP = `<b>텍사스 홀덤 (헤즈업)</b><br>
    개인 2장 + 공용 5장으로 최고 5장 족보 경쟁.<br>
    <b>진행</b> 프리플랍→플랍(3)→턴(1)→리버(1), 각 라운드 베팅.<br>
    <b>액션</b> 폴드 / 체크·콜 / 벳·레이즈 / 올인.<br>
    <b>블라인드</b> 버튼=스몰블라인드, 프리플랍은 버튼이 먼저.<br>
    <b>승리</b> 더 높은 족보 또는 상대 폴드. 칩 0이면 게임 오버.`;

  window.addEventListener('DOMContentLoaded', initLobby);
})();
