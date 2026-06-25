/* =========================================================================
 * main.js — 토마토 포커 컨트롤러 (N인 라운드 테이블, 혼자 하기 = vs AI)
 * 홀덤=HoldemN(2~9인 사이드팟), 세븐=Seven(2인). 빈 자리는 AI.
 * ======================================================================= */
(function () {
  const $ = s => document.querySelector(s);
  const Cards = window.Cards, Eval = window.Eval, AI = window.PokerAI;

  const START_STACK = 1000, SB = 10, BB = 20;
  const AI_NAMES = ['로보캣', '피카드', '올인봇', '블러퍼', '콜링맘', '너겟', '라이저', '쿨핸드'];
  const AI_AV = ['🤖', '😼', '🐯', '🦊', '🐼', '🐵', '🦁', '🐶'];

  const App = {
    mode: null, game: 'holdem', diff: 'normal', seats: 6, nick: '나',
    engine: null, aiDecide: null, state: null, nSeats: 6, mySeat: 0,
    stacks: [], button: 0, names: [], avatars: [], busy: false, revealOpp: false, _commShown: 0,
  };
  const fmt = n => (n || 0).toLocaleString('en-US');
  const rndSeed = () => (Math.random() * 4294967295) >>> 0;

  /* ---------------- 로비 ---------------- */
  function initLobby() {
    $('#nickname').value = localStorage.getItem('tpoker_nick') || '';
    segHandler('#gameSeg', 'game', v => { App.game = v; });
    segHandler('#seatSeg', 'seats', v => App.seats = Number(v));
    segHandler('#diffSeg', 'diff', v => App.diff = v);
    $('#btnSingle').addEventListener('click', startSingle);
    $('#btnHost').addEventListener('click', () => toast('온라인 대전은 다음 업데이트에서!', 'red'));
    $('#btnHelp').addEventListener('click', () => { const h = $('#help'); h.hidden = !h.hidden; if (!h.innerHTML) h.innerHTML = HELP; });
    $('#leaveBtn').addEventListener('click', () => { App.state = null; show('lobby'); });
    $('#btnFold').addEventListener('click', () => myAct({ type: 'fold' }));
    $('#btnCall').addEventListener('click', () => myAct(callAction()));
    $('#btnRaise').addEventListener('click', openRaise);
    $('#btnRaiseCancel').addEventListener('click', () => $('#raisePanel').hidden = true);
    $('#btnRaiseDo').addEventListener('click', doRaise);
    $('#raiseSlider').addEventListener('input', () => $('#raiseAmt').textContent = fmt(Number($('#raiseSlider').value)));
    $('#raisePanel').querySelectorAll('.rq').forEach(b => b.addEventListener('click', () => quickRaise(b.dataset.q)));
    $('#rankTab').addEventListener('click', toggleRankGuide);
    renderRankGuide();
    window.addEventListener('resize', () => { if (!$('#table').hidden && App.state) { positionSeats(App.nSeats); placeHeroInfo(); } });
  }
  function segHandler(sel, key, cb) {
    $(sel).addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $(sel).querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); cb(b.dataset[key]); });
  }
  function nickname() { const n = ($('#nickname').value || '').trim() || '플레이어'; localStorage.setItem('tpoker_nick', n); return n.slice(0, 8); }
  function show(id) { ['lobby', 'table'].forEach(s => $('#' + s).hidden = (s !== id)); }

  /* ---------------- 게임 시작 ---------------- */
  function startSingle() {
    App.mode = 'single'; App.nick = nickname(); App.mySeat = 0;
    if (App.game === 'seven') { App.engine = window.Seven; App.aiDecide = (s, i, d) => AI.decideSeven(s, i, d); App.nSeats = App.seats; }
    else { App.engine = window.HoldemN; App.aiDecide = (s, i, d) => AI.decide(s, i, d); App.nSeats = App.seats; }
    App.stacks = new Array(App.nSeats).fill(START_STACK);
    App.button = Math.floor(Math.random() * App.nSeats);
    App.names = [App.nick]; App.avatars = ['🙂'];
    for (let i = 1; i < App.nSeats; i++) { App.names.push(AI_NAMES[(i - 1) % AI_NAMES.length]); App.avatars.push(AI_AV[(i - 1) % AI_AV.length]); }
    $('#table').classList.toggle('seven', App.game === 'seven');
    $('#heroCards').classList.toggle('seven', App.game === 'seven');
    buildSeats(App.nSeats);
    show('table');
    newHand();
  }

  function newHand() {
    App.revealOpp = false; App.busy = false; App._commShown = 0;
    // 파산자 제외하고 진행. 한 명만 칩 남으면 게임 종료
    const alive = App.stacks.filter(s => s > 0).length;
    if (alive < 2) { App.stacks = App.stacks.map(() => START_STACK); } // 단순화: 전원 리셋
    if (App.game === 'seven') App.state = App.engine.newHand({ ante: 5, bet: BB, stacks: App.stacks.slice(), first: App.button, seed: rndSeed() });
    else App.state = App.engine.newHand({ sb: SB, bb: BB, stacks: App.stacks.slice(), button: App.button, seed: rndSeed() });
    $('#modal').hidden = true; $('#boardMsg').textContent = '';
    resetCardAreas();
    idleActions();
    render(true);
    setTimeout(drive, 1500); // 딜 연출 후 베팅
  }
  function resetCardAreas() {
    $('#community').innerHTML = ''; $('#community').dataset.n = '0';
    $('#heroCards').innerHTML = ''; $('#heroCards').dataset.n = '0';
    [...$('#seats').children].forEach(seat => { const sc = seat.querySelector('.seat-cards'); sc.innerHTML = ''; sc.dataset.n = '0'; });
  }

  /* ---------------- 자리 배치 ---------------- */
  function buildSeats(n) {
    const seats = $('#seats'); seats.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const seat = document.createElement('div'); seat.className = 'seat' + (i === App.mySeat ? ' me' : ''); seat.dataset.i = i;
      seat.innerHTML = `<div class="seat-cards"></div>
        <div class="seat-info"><div class="seat-av">🙂</div><div class="seat-meta"><div class="seat-name">P</div><div class="seat-stack">0</div><div class="seat-hand" hidden></div></div><span class="seat-dealer" hidden>D</span></div>
        <div class="seat-bet" hidden></div>`;
      seats.appendChild(seat);
    }
    positionSeats(n);
  }
  // 자리 각도(도). 히어로=하단 중앙(90°), 나머지는 상단 중앙(270°, 딜러자리)을 비우고 양옆으로.
  function seatDeg(i, n) {
    if (n <= 2) return i === 0 ? 90 : 264;
    if (i === 0) return 90;
    const side = (i % 2 === 1) ? 1 : -1;           // 홀수=좌, 짝수=우
    const rank = Math.ceil(i / 2);
    const maxRank = Math.ceil((n - 1) / 2);
    const spread = 124;                             // 하단에서 한쪽 최대 각(상단 ~112° 비움)
    return 90 + side * rank * (spread / maxRank);
  }
  function positionSeats(n) {
    const seats = $('#seats'); const cx = 50, cy = 48, rx = 45, ry = 41;
    for (let i = 0; i < n; i++) {
      const seat = seats.children[i]; if (!seat) continue;
      if (i === App.mySeat) {
        // 내 상태창은 큰 카드 바로 위(가운데), 카드와 안 겹치게 바텀 기준 앵커
        seat.style.left = '50%'; seat.style.top = 'auto';
        seat.style.bottom = 'calc(76px + (var(--card-h) * 1.2) + 10px)';
        const bet = seat.querySelector('.seat-bet');
        bet.style.left = '50%'; bet.style.top = '0'; bet.style.transform = 'translate(-50%,-160%)';
        continue;
      }
      const ang = seatDeg(i, n) * Math.PI / 180;
      const x = cx + rx * Math.cos(ang), y = cy + ry * Math.sin(ang);
      seat.style.bottom = 'auto';
      seat.style.left = x + '%'; seat.style.top = y + '%';
      // 베팅 칩: 자리→중앙 방향으로 살짝
      const dirx = (cx - x), diry = (cy - y); const len = Math.hypot(dirx, diry) || 1;
      const bet = seat.querySelector('.seat-bet');
      bet.style.left = '50%'; bet.style.top = '0';
      bet.style.transform = `translate(-50%,-50%) translate(${(dirx / len) * 46}px, ${(diry / len) * 46}px)`;
    }
    placeHeroInfo();
  }
  // 히어로 상태창을 실제 내 카드 바로 위(8px)에 정확히 배치 (카드 폭에 맞춰 가운데)
  function placeHeroInfo() {
    const seat = $('#seats').children[App.mySeat], cards = $('#heroCards');
    if (!seat || !cards) return;
    const cr = cards.getBoundingClientRect();
    if (!cr.height) return;
    const cb = (seat.offsetParent || $('#seats')).getBoundingClientRect();   // bottom 기준 컨테이닝 블록(#seats)
    seat.style.left = '50%'; seat.style.top = 'auto';
    seat.style.bottom = Math.round(cb.bottom - cr.top + 8) + 'px';   // 카드 윗변에서 8px 위
  }

  /* ---------------- 진행 ---------------- */
  function drive() {
    const s = App.state; if (!s) return;
    if (s.phase === 'done') { onHandDone(); return; }
    render();
    const pause = App._streetPause || 0; App._streetPause = 0;
    if (s.toAct !== App.mySeat) { // AI
      hideActions(); App.busy = true;
      setTimeout(() => {
        if (!App.state || App.state.phase !== 'betting' || App.state.toAct === App.mySeat) return;
        const i = App.state.toAct, before = streetOf(App.state);
        const a = App.aiDecide(App.state, i, App.diff);
        const c = App.state.players[i].committed;
        App.engine.act(App.state, a);
        if (App.state.players[i].committed > c) flyChipToPot(i);
        if (a.type === 'fold') foldAnim(i);
        announceAI(i, a);
        App.busy = false; afterStreetFx(before); drive();
      }, pause + 650 + Math.random() * 450);
    } else {
      App.busy = true; hideActions();
      setTimeout(() => { App.busy = false; if (App.state && App.state.phase === 'betting' && App.state.toAct === App.mySeat) showActions(); }, pause + 150);
    }
  }

  function streetOf(s) { return App.game === 'seven' ? ('s' + s.street) : (s.street + '/' + s.community.length); }
  function afterStreetFx(before) {
    const s = App.state; if (!s || s.phase === 'done') return;
    if (streetOf(s) !== before) {
      const names = App.game === 'seven' ? { 4: '4번째', 5: '5번째', 6: '6번째', 7: '히든' } : { flop: '플랍', turn: '턴', river: '리버' };
      if (names[s.street]) { $('#boardMsg').textContent = names[s.street]; }
      App._streetPause = 1100;
    }
  }

  /* ---------------- 내 액션 ---------------- */
  function callAction() { const la = App.engine.legalActions(App.state); return la.canCheck ? { type: 'check' } : { type: 'call' }; }
  function myAct(a) {
    if (App.busy || !App.state || App.state.phase !== 'betting' || App.state.toAct !== App.mySeat) return;
    $('#raisePanel').hidden = true;
    const before = streetOf(App.state), c0 = App.state.players[App.mySeat].committed;
    const r = App.engine.act(App.state, a);
    if (r && r.ok === false) { toast(r.error, 'red'); return; }
    if (App.state.players[App.mySeat].committed > c0) flyChipToPot(App.mySeat);
    if (a.type === 'fold') foldAnim(App.mySeat);
    afterStreetFx(before); drive();
  }
  function openRaise() {
    const la = App.engine.legalActions(App.state);
    if (!la.canRaise) { toast('레이즈할 수 없어요', 'red'); return; }
    const sl = $('#raiseSlider'); sl.min = la.minRaiseTo; sl.max = la.maxRaiseTo; sl.step = SB; sl.value = la.minRaiseTo;
    $('#raiseAmt').textContent = fmt(Number(sl.value)); $('#raisePanel').hidden = false;
  }
  function quickRaise(q) {
    const la = App.engine.legalActions(App.state), s = App.state;
    const pot = s.players.reduce((a, p) => a + p.committed, 0);
    let to = q === 'allin' ? la.maxRaiseTo : s.currentBet + Math.round(pot * Number(q));
    to = Math.round(to / SB) * SB; to = Math.max(la.minRaiseTo, Math.min(to, la.maxRaiseTo));
    $('#raiseSlider').value = to; $('#raiseAmt').textContent = fmt(to);
  }
  function doRaise() {
    const to = Number($('#raiseSlider').value), la = App.engine.legalActions(App.state);
    $('#raisePanel').hidden = true;
    myAct({ type: to >= la.maxRaiseTo ? 'allin' : 'raise', amount: to });
  }

  /* ---------------- 핸드 종료 ---------------- */
  function onHandDone() {
    const s = App.state, r = s.result;
    App.revealOpp = !!r.showdown;
    render();
    hideActions();
    $('#potAmt').textContent = fmt(r.pot);
    App.stacks = r.stacks.slice();
    const winners = r.winners || [];
    winners.forEach(w => { const seat = $('#seats').children[w]; if (seat) seat.classList.add('winner'); });
    winners.forEach((w, k) => setTimeout(() => potToWinner(w), (r.showdown ? 800 : 300) + k * 120));
    setTimeout(() => { [...$('#seats').children].forEach(se => se.classList.remove('winner')); showResult(r); }, r.showdown ? 1700 : 1000);
  }

  function showResult(r) {
    const s = App.state, me = App.mySeat;
    const iWon = (r.winners || []).includes(me);
    const myDelta = r.stacks[me] - App.preHandStacks[me];
    let handsHtml = '';
    if (r.showdown && r.hands) {
      const idxs = Object.keys(r.hands).map(Number);
      handsHtml = '<div class="show-hands">' + idxs.map(i => {
        const best = (r.hands[i].best || []).map(c => `<div class="pcard"><img src="${Cards.imgPath(c)}"></div>`).join('');
        const win = (r.winners || []).includes(i) ? ' win' : '';
        return `<div class="sh${win}"><div class="nm">${App.names[i]}</div><div class="cards">${best}</div><div class="cat">${Eval.catName(r.hands[i].cat)}</div></div>`;
      }).join('') + '</div>';
    }
    const busted = App.stacks[me] <= 0;
    const title = busted ? '💸 파산! 게임 오버' : iWon ? '🎉 승리!' : '😢 패배';
    const box = $('#modalBox');
    box.innerHTML = `<h2>${title}</h2>
      <p class="muted">${r.showdown ? '쇼다운' : '상대 폴드'}</p>
      ${handsHtml}
      <div class="big-amt">팟 ${fmt(r.pot)}</div>
      <p class="muted">내 칩 ${fmt(App.stacks[me])} (${myDelta >= 0 ? '+' : ''}${fmt(myDelta)})</p>
      <div class="modal-actions">
        <button class="btn-again" id="mAgain">${busted ? '다시 시작' : '다음 핸드'}</button>
        <button class="btn-home" id="mHome">메인</button>
      </div>`;
    $('#modal').hidden = false;
    $('#mAgain').onclick = () => { $('#modal').hidden = true; if (busted) App.stacks = App.stacks.map(() => START_STACK); App.button = (App.button + 1) % App.nSeats; newHand(); };
    $('#mHome').onclick = () => { App.state = null; show('lobby'); };
  }

  /* ---------------- 렌더 ---------------- */
  function render(dealAnim) {
    const s = App.state; if (!s) return;
    if (dealAnim) App.preHandStacks = s.players.map(p => p.stack + p.committed); // 핸드 시작 칩(증감 계산용)
    const pot = s.players.reduce((a, p) => a + p.committed, 0);
    $('#potAmt').textContent = fmt(pot);
    if (App.game !== 'seven') renderCommunity(s.community);
    for (let i = 0; i < s.players.length; i++) renderSeat(i, s, dealAnim);
    placeHeroInfo();
  }
  // 현재 알고 있는 카드로 만들어진 족보 이름. (히어로=항상, 상대=쇼다운 시. 세븐은 상대 오픈카드도 참고)
  function handLabel(cards) {
    if (!cards || cards.length < 2) return '';
    const cs = cards.map(c => ({ r: c.r, s: c.s }));
    if (cs.length >= 5) { try { return Eval.catName(Eval.evalBest(cs).cat); } catch (_) {} }
    const cnt = {}; cs.forEach(c => cnt[c.r] = (cnt[c.r] || 0) + 1);
    const g = Object.values(cnt).sort((a, b) => b - a);
    if (g[0] === 4) return Eval.catName(7);
    if (g[0] === 3) return Eval.catName(3);
    if (g[0] === 2 && g[1] === 2) return Eval.catName(2);
    if (g[0] === 2) return Eval.catName(1);
    return Eval.catName(0);
  }
  function knownCards(i, s) {
    const p = s.players[i]; if (p.folded) return [];
    const isMe = i === App.mySeat, reveal = isMe || App.revealOpp;
    if (App.game === 'seven') return reveal ? p.cards : p.cards.filter(c => c.up);
    const comm = s.community || [];
    return reveal ? [...(p.hole || []), ...comm] : [];
  }

  function renderSeat(i, s, dealAnim) {
    const seat = $('#seats').children[i]; if (!seat) return;
    const p = s.players[i], isMe = i === App.mySeat;
    seat.querySelector('.seat-name').textContent = App.names[i] || ('P' + i);
    seat.querySelector('.seat-av').textContent = App.avatars[i] || '🙂';
    seat.querySelector('.seat-stack').textContent = fmt(p.stack);
    // 현재 족보 라벨
    const handEl = seat.querySelector('.seat-hand');
    const known = knownCards(i, s);
    const lbl = known.length >= 2 ? handLabel(known) : '';
    const seenOnly = App.game === 'seven' && !isMe && !App.revealOpp && lbl;  // 상대 오픈카드 기준
    if (lbl) { handEl.hidden = false; handEl.textContent = lbl; handEl.classList.toggle('seen', !!seenOnly); handEl.classList.toggle('mine', isMe); }
    else handEl.hidden = true;
    seat.classList.toggle('folded', p.folded);
    seat.classList.toggle('active', s.phase === 'betting' && s.toAct === i);
    seat.querySelector('.seat-dealer').hidden = s.button !== i;
    const bet = seat.querySelector('.seat-bet');
    if (p.bet > 0) { bet.hidden = false; bet.textContent = fmt(p.bet); } else bet.hidden = true;
    const cardBox = isMe ? $('#heroCards') : seat.querySelector('.seat-cards');
    renderSeatCards(cardBox, i, s, isMe);
  }
  function renderSeatCards(box, i, s, isMe) {
    const p = s.players[i];
    const list = App.game === 'seven' ? p.cards.map(c => ({ r: c.r, s: c.s, up: c.up })) : (p.hole || []).map(c => ({ r: c.r, s: c.s, up: false }));
    let shown = Number(box.dataset.n || 0);
    if (list.length < shown) { box.innerHTML = ''; box.dataset.n = '0'; shown = 0; }
    for (let k = shown; k < list.length; k++) {
      const c = list[k], faceUp = isMe ? true : (c.up || (App.revealOpp && !p.folded));
      const el = flipCardEl({ r: c.r, s: c.s });
      if (!isMe && !c.up && App.game === 'seven') el.classList.add('hidden-card');
      box.appendChild(el); el.style.opacity = '0';
      flyFromDeck(el, { reveal: faceUp, delay: (isMe ? 150 : i * 55) + (k - shown) * 190 });
    }
    box.dataset.n = String(list.length);
    [...box.children].forEach((el, k) => {
      const c = list[k]; if (!c) return;
      const want = isMe ? true : (c.up || (App.revealOpp && !p.folded));
      if (want && el.style.opacity === '1' && !el.classList.contains('up')) { el.classList.remove('hidden-card'); setTimeout(() => el.classList.add('up'), k * 80); }
    });
  }
  function renderCommunity(comm) {
    const box = $('#community');
    if (comm.length < (App._commShown || 0)) { box.innerHTML = ''; App._commShown = 0; }
    if (box.children.length === 0) for (let i = 0; i < 5; i++) { const d = document.createElement('div'); d.className = 'slot'; box.appendChild(d); }
    const shown = App._commShown || 0;
    for (let i = shown; i < comm.length; i++) { const el = flipCardEl(comm[i]); box.replaceChild(el, box.children[i]); el.style.opacity = '0'; flyFromDeck(el, { reveal: true, delay: (i - shown) * 200 }); }
    App._commShown = comm.length;
  }

  /* ---------------- 카드/칩 연출 ---------------- */
  function flipCardEl(card) {
    const el = document.createElement('div'); el.className = 'pcard flipc';
    el.innerHTML = `<div class="fi"><div class="face front"><img src="${Cards.imgPath(card)}"></div><div class="face back"><img src="cards/back.png"></div></div>`;
    el.dataset.card = Cards.imgCode(card); return el;
  }
  function flyFromDeck(targetEl, opts) {
    opts = opts || {};
    const deck = $('#deck'); const tr = targetEl.getBoundingClientRect();
    if (!deck || !tr.width) { targetEl.style.opacity = '1'; if (opts.reveal) targetEl.classList.add('up'); return; }
    const dr = deck.getBoundingClientRect();
    const fly = document.createElement('div'); fly.className = 'flyp'; fly.innerHTML = '<img src="cards/back.png">';
    fly.style.left = dr.left + 'px'; fly.style.top = dr.top + 'px'; fly.style.width = dr.width + 'px'; fly.style.height = dr.height + 'px';
    document.body.appendChild(fly);
    const dx = tr.left - dr.left, dy = tr.top - dr.top, dur = opts.dur || 360, delay = opts.delay || 0;
    let done = false; const land = () => { if (done) return; done = true; targetEl.style.opacity = '1'; if (opts.reveal) targetEl.classList.add('up'); try { fly.remove(); } catch (_) {} };
    setTimeout(() => {
      let a; try { a = fly.animate([{ transform: 'translate(0,0) rotate(-7deg) scale(.95)' }, { transform: `translate(${dx}px,${dy}px) rotate(0) scale(1)` }], { duration: dur, easing: 'cubic-bezier(.25,.7,.3,1)', fill: 'forwards' }); } catch (_) {}
      if (a) a.onfinish = land; setTimeout(land, dur + 140);
    }, delay);
  }
  function flyOne(fromR, toR, jitter, dur) {
    const chip = document.createElement('div'); chip.className = 'chip-fly'; chip.textContent = '🪙';
    chip.style.left = (fromR.left + fromR.width / 2 - 15 + (jitter ? Math.random() * 22 - 11 : 0)) + 'px';
    chip.style.top = (fromR.top + fromR.height / 2 - 15) + 'px';
    document.body.appendChild(chip);
    const dx = (toR.left + toR.width / 2) - (fromR.left + fromR.width / 2), dy = (toR.top + toR.height / 2) - (fromR.top + fromR.height / 2);
    let done = false; const land = () => { if (done) return; done = true; try { chip.remove(); } catch (_) {} };
    try { const a = chip.animate([{ transform: 'translate(0,0) scale(.6)', opacity: 0 }, { transform: `translate(${dx * .5}px,${dy * .5}px) scale(1.15)`, opacity: 1, offset: .55 }, { transform: `translate(${dx}px,${dy}px) scale(.5)`, opacity: .15 }], { duration: dur || 440, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'forwards' }); a.onfinish = land; } catch (_) {}
    setTimeout(land, (dur || 440) + 160);
  }
  function flyChipToPot(i) { const from = $('#seats').children[i], to = $('#potAmt'); if (from && to) flyOne(from.getBoundingClientRect(), to.getBoundingClientRect()); }
  function potToWinner(i) {
    const from = $('#potAmt'), to = $('#seats').children[i]; if (!from || !to) return;
    const fr = from.getBoundingClientRect(), tr = to.getBoundingClientRect();
    for (let k = 0; k < 6; k++) setTimeout(() => flyOne(fr, tr, true, 480), k * 70);
  }
  function foldAnim(i) {
    const box = i === App.mySeat ? $('#heroCards') : ($('#seats').children[i] && $('#seats').children[i].querySelector('.seat-cards'));
    if (!box) return;
    [...box.children].forEach((el, k) => { try { el.animate([{ transform: 'translateY(0) rotate(0)', opacity: 1 }, { transform: 'translateY(24px) rotate(7deg)', opacity: .15 }], { duration: 360, delay: k * 50, easing: 'ease-in', fill: 'forwards' }); } catch (_) { el.classList.add('muck'); } });
  }

  /* ---------------- 액션 컨트롤 ---------------- */
  // 버튼은 항상 표시(레이아웃 고정). 내 차례면 활성·색상, 아니면 흐리게 비활성.
  function showActions() {
    const la = App.engine.legalActions(App.state); if (!la) { idleActions(); return; }
    $('#actions').classList.remove('idle');
    const fold = $('#btnFold'); fold.disabled = false;
    const call = $('#btnCall'); call.disabled = false; call.textContent = la.canCheck ? '체크' : ('콜 ' + fmt(la.callAmount));
    const raise = $('#btnRaise'); raise.disabled = !la.canRaise; raise.textContent = la.toCall === 0 ? '벳' : '레이즈';
  }
  function idleActions() {
    $('#actions').classList.add('idle');
    ['#btnFold', '#btnCall', '#btnRaise'].forEach(s => { $(s).disabled = true; });
    $('#raisePanel').hidden = true;
  }
  function hideActions() { idleActions(); }

  /* ---------------- 족보(핸드 랭킹) 가이드 ---------------- */
  const RANKS = [
    ['로열 스트레이트 플러시', '같은 무늬로 A·K·Q·J·10', ['AS', 'KS', 'QS', 'JS', 'TS']],
    ['스트레이트 플러시', '같은 무늬 숫자 연속 5장', ['9H', '8H', '7H', '6H', '5H']],
    ['포카드', '같은 숫자 4장', ['KS', 'KH', 'KD', 'KC', '7S']],
    ['풀하우스', '트리플 + 페어', ['QS', 'QH', 'QD', '8C', '8S']],
    ['플러시', '같은 무늬 5장 (숫자 무관)', ['AD', 'JD', '8D', '6D', '3D']],
    ['스트레이트', '숫자 연속 5장 (무늬 무관)', ['7S', '6H', '5D', '4C', '3S']],
    ['트리플', '같은 숫자 3장', ['9S', '9H', '9D', 'KC', '4S']],
    ['투페어', '페어 2개', ['JS', 'JH', '5D', '5C', '9S']],
    ['원페어', '같은 숫자 2장', ['TS', 'TH', 'AD', '7C', '2S']],
    ['하이카드', '아무 조합도 없음 · 가장 높은 카드', ['AS', 'QH', '9D', '5C', '2S']],
  ];
  function cardChip(tok) {
    const r = tok[0] === 'T' ? '10' : tok[0];
    const sym = { S: '♠', H: '♥', D: '♦', C: '♣' }[tok[1]];
    const red = tok[1] === 'H' || tok[1] === 'D';
    return `<span class="rg-card ${red ? 'red' : 'blk'}">${r}<i>${sym}</i></span>`;
  }
  function renderRankGuide() {
    const body = $('#rankBody'); if (!body || body.dataset.built) return;
    body.innerHTML = `<div class="rg-title">포커 족보 (높음 → 낮음)</div>` + RANKS.map((r, i) =>
      `<div class="rg-row"><div class="rg-head"><span class="rg-num">${i + 1}</span><span class="rg-nm">${r[0]}</span></div>
        <div class="rg-desc">${r[1]}</div><div class="rg-ex">${r[2].map(cardChip).join('')}</div></div>`).join('');
    body.dataset.built = '1';
  }
  function toggleRankGuide() {
    const g = $('#rankGuide'), open = !g.classList.contains('open');
    g.classList.toggle('open', open);
    $('#rankBody').hidden = !open;
    $('#rankTab').textContent = open ? '📖 족보 ▾' : '📖 족보 ▸';
  }

  /* ---------------- 잡동사니 ---------------- */
  function announceAI(i, a) {
    const m = { fold: '폴드', check: '체크', call: '콜', raise: '레이즈', allin: '올인 🔥' };
    toast(`${App.names[i]}: ${m[a.type] || a.type}`, a.type === 'allin' ? 'red' : '');
  }
  function toast(text, variant) { const t = document.createElement('div'); t.className = 'toast' + (variant ? ' ' + variant : ''); t.textContent = text; $('#toasts').appendChild(t); setTimeout(() => t.remove(), 1500); }

  const HELP = `<b>홀덤</b> 개인 2장 + 공용 5장으로 최고 5장 경쟁. 프리플랍·플랍·턴·리버 베팅.<br>
    <b>세븐포커</b> 3장(2히든1오픈) 받고 4·5·6오픈·7히든, 7장 중 베스트5.<br>
    <b>액션</b> 폴드 / 체크·콜 / 벳·레이즈 / 올인. <b>인원</b> 빈 자리는 AI.`;

  window.addEventListener('DOMContentLoaded', initLobby);
})();
