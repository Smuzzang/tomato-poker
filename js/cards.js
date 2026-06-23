/* =========================================================================
 * cards.js — 표준 52장 덱 (텍사스 홀덤 / 세븐포커 공용)
 * 카드: { r: 2..14 (11=J,12=Q,13=K,14=A), s: 0..3 (0♠ 1♥ 2♦ 3♣) }
 * ======================================================================= */
(function (root) {
  const SUITS = ['s', 'h', 'd', 'c'];           // spade, heart, diamond, club
  const SUIT_SYM = ['♠', '♥', '♦', '♣'];
  const RANK_STR = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

  function rankStr(r) { return RANK_STR[r] || String(r); }
  function suitSym(s) { return SUIT_SYM[s]; }
  function isRed(s) { return s === 1 || s === 2; }
  function cardId(c) { return rankStr(c.r) + SUITS[c.s]; }   // 예: "As", "Th"... 여기선 "10" 대신 숫자
  function cardLabel(c) { return rankStr(c.r) + SUIT_SYM[c.s]; }

  function makeDeck() {
    const d = [];
    for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) d.push({ r, s });
    return d;
  }

  /* 시드 기반 셔플 (재현 가능) — mulberry32 */
  function makeRng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(deck, rng) {
    const r = rng || Math.random;
    const d = deck.slice();
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }

  /* ---- 카드 이미지 (deckofcardsapi 클래식 PNG: 값+무늬, 10=0) ---- */
  const IMG_VAL = { 10: '0', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const IMG_SUIT = ['S', 'H', 'D', 'C'];
  function imgCode(c) { return (IMG_VAL[c.r] || String(c.r)) + IMG_SUIT[c.s]; }
  function imgPath(c) { return 'cards/' + imgCode(c) + '.png'; }

  /* DOM 카드 엘리먼트 (브라우저 전용) */
  function makeCardEl(c, faceUp) {
    const el = document.createElement('div');
    el.className = 'pcard' + (faceUp && c ? '' : ' back');
    const img = document.createElement('img');
    img.src = (faceUp && c) ? imgPath(c) : 'cards/back.png';
    img.alt = (faceUp && c) ? cardLabel(c) : '뒷면';
    img.draggable = false;
    el.appendChild(img);
    if (c) el.dataset.card = imgCode(c);
    return el;
  }

  root.Cards = { SUITS, makeDeck, makeRng, shuffle, rankStr, suitSym, isRed, cardId, cardLabel, imgCode, imgPath, makeCardEl };
})(typeof window !== 'undefined' ? window : globalThis);
