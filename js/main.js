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
    setTimeout(drive, 1450); // 카드 딜(덱→손패) 연출이 끝난 뒤 베팅 시작
  }

  /* ---------------- 진행(턴 분배) ---------------- */
  function drive() {
    const s = App.state; if (!s) return;
    if (s.phase === 'done') { onHandDone(); return; }
    render();
    const pause = App._streetPause || 0; App._streetPause = 0;  // 공용패 깔린 직후 텀
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
      }, pause + 800 + Math.random() * 450);
    } else { // 나
      App.busy = true; hideActions();
      setTimeout(() => { App.busy = false; if (App.state && App.state.phase === 'betting' && App.state.toAct === 0) showActions(); }, pause + 120);
    }
  }

  function streetOf(s) { return s.street + '/' + s.community.length; }
  function afterStreetFx(before) {
    const s = App.state; if (!s) return;
    if (s.phase === 'done') return;
    if (streetOf(s) !== before) {
      const names = { flop: '플랍', turn: '턴', river: '리버' };
      if (names[s.street]) { $('#boardMsg').textContent = names[s.street]; SFXdeal(); }
      App._streetPause = 1150;  // 공용패가 덱에서 날아와 뒤집히는 동안 멈춤
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
    renderHole($('#oppHole'), s.players[1].hole, App.revealOpp, s.players[1].folded, 0);   // 딜: 상대 먼저
    renderHole($('#myHole'), s.players[0].hole, true, s.players[0].folded, 150);            // 한 박자 뒤 내 패
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
  /* 3D 플립 카드 엘리먼트 (앞면+뒷면) */
  function flipCardEl(card) {
    const el = document.createElement('div'); el.className = 'pcard flipc';
    const fi = document.createElement('div'); fi.className = 'fi';
    const front = document.createElement('div'); front.className = 'face front';
    const fimg = document.createElement('img'); fimg.src = Cards.imgPath(card); front.appendChild(fimg);
    const back = document.createElement('div'); back.className = 'face back';
    const bimg = document.createElement('img'); bimg.src = 'cards/back.png'; back.appendChild(bimg);
    fi.appendChild(front); fi.appendChild(back); el.appendChild(fi);
    el.dataset.card = Cards.imgCode(card);
    return el;
  }

  /* 카드를 덱에서 목표 자리로 날려보냄(딜) → 도착하면 실제 카드 노출(+뒤집기) */
  function flyFromDeck(targetEl, opts) {
    opts = opts || {};
    const deck = $('#deck');
    const tr = targetEl.getBoundingClientRect();
    if (!deck || !tr.width) { targetEl.style.opacity = '1'; if (opts.reveal) targetEl.classList.add('up'); return; }
    const dr = deck.getBoundingClientRect();
    const fly = document.createElement('div'); fly.className = 'flyp';
    fly.innerHTML = '<img src="cards/back.png">';
    fly.style.left = dr.left + 'px'; fly.style.top = dr.top + 'px';
    fly.style.width = dr.width + 'px'; fly.style.height = dr.height + 'px';
    document.body.appendChild(fly);
    const dx = tr.left - dr.left, dy = tr.top - dr.top, dur = opts.dur || 380, delay = opts.delay || 0;
    let done = false;
    const land = () => { // 도착: 실제 카드 노출(+뒤집기), 날아가던 카드 제거
      if (done) return; done = true;
      targetEl.style.opacity = '1';
      if (opts.reveal) targetEl.classList.add('up');
      try { fly.remove(); } catch (_) {}
    };
    setTimeout(() => {
      let a;
      try {
        a = fly.animate([
          { transform: 'translate(0,0) rotate(-7deg) scale(.95)' },
          { transform: `translate(${dx}px,${dy}px) rotate(0deg) scale(1)` },
        ], { duration: dur, easing: 'cubic-bezier(.25,.7,.3,1)', fill: 'forwards' });
      } catch (_) {}
      if (a) a.onfinish = land;
      setTimeout(land, dur + 140); // 안전망: onfinish 안 와도(탭 숨김 등) 반드시 노출
    }, delay);
  }

  /* 손패: 새 카드면 덱에서 날아와 놓임(dealBase=시작 딜레이), faceUp만 바뀌면 제자리 뒤집기 */
  function renderHole(box, hole, faceUp, folded, dealBase) {
    const codes = hole.map(c => Cards.imgCode(c)).join(',');
    if (box.dataset.codes !== codes) {
      box.dataset.codes = codes; box.innerHTML = '';
      hole.forEach((c, i) => {
        const el = flipCardEl(c); if (folded) el.classList.add('muck');
        box.appendChild(el);
        if (dealBase != null) { el.style.opacity = '0'; flyFromDeck(el, { reveal: faceUp, delay: dealBase + i * 300 }); }
        else if (faceUp) el.classList.add('up');
      });
      box.dataset.up = faceUp ? '1' : '0';
    } else {
      if ((box.dataset.up === '1') !== !!faceUp) {  // 공개 상태 변화(쇼다운) → 제자리 뒤집기
        box.dataset.up = faceUp ? '1' : '0';
        [...box.children].forEach((el, i) => setTimeout(() => el.classList.toggle('up', !!faceUp), i * 150));
      }
      [...box.children].forEach(el => el.classList.toggle('muck', !!folded));
    }
  }

  /* 공용패: 새로 깔리는 카드만 덱에서 날아와 순차로 뒤집힘 */
  function renderCommunity(comm) {
    const box = $('#community');
    if (comm.length < (App._commShown || 0)) { box.innerHTML = ''; App._commShown = 0; } // 새 핸드 리셋
    if (box.children.length === 0) { for (let i = 0; i < 5; i++) { const d = document.createElement('div'); d.className = 'slot'; box.appendChild(d); } }
    const shown = App._commShown || 0;
    for (let i = shown; i < comm.length; i++) {
      const el = flipCardEl(comm[i]);
      box.replaceChild(el, box.children[i]);
      el.style.opacity = '0';
      flyFromDeck(el, { reveal: true, delay: (i - shown) * 200 });
    }
    App._commShown = comm.length;
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
