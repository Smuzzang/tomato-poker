/* =========================================================================
 * evaluator.js — 포커 족보 평가 (텍사스 홀덤 / 세븐포커 공용)
 * 표준 하이 핸드 랭킹. 5장 평가 + 5~7장 중 최고 5장 선택.
 *
 * 카테고리(높을수록 강함):
 *   8 스트레이트 플러시 (로열 포함)
 *   7 포카드          6 풀하우스        5 플러시
 *   4 스트레이트      3 트리플          2 투페어
 *   1 원페어          0 하이카드
 * ======================================================================= */
(function (root) {
  const CAT = ['하이카드', '원페어', '투페어', '트리플', '스트레이트', '플러시', '풀하우스', '포카드', '스트레이트 플러시'];

  /* 5장 평가 → { cat, tb:[..5], score } (score 클수록 강함, 동점이면 tb로 비교) */
  function eval5(cards) {
    if (cards.length !== 5) throw new Error('eval5 needs exactly 5 cards');
    const ranks = cards.map(c => c.r).sort((a, b) => b - a);     // 내림차순
    const suits = cards.map(c => c.s);
    const flush = suits.every(s => s === suits[0]);

    // 랭크 카운트
    const cnt = {};
    for (const r of ranks) cnt[r] = (cnt[r] || 0) + 1;
    // [count, rank] 묶음을 count 우선, rank 차순으로 정렬
    const groups = Object.keys(cnt).map(Number)
      .map(r => [cnt[r], r])
      .sort((a, b) => b[0] - a[0] || b[1] - a[1]);

    // 스트레이트 판정 (휠 A-2-3-4-5 포함)
    const uniq = [...new Set(ranks)];
    let straightHigh = 0;
    if (uniq.length === 5) {
      if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
      else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5; // 휠
    }

    let cat, tb;
    if (straightHigh && flush) { cat = 8; tb = [straightHigh]; }
    else if (groups[0][0] === 4) { cat = 7; tb = [groups[0][1], groups[1][1]]; }       // 포카드 + 키커
    else if (groups[0][0] === 3 && groups[1][0] === 2) { cat = 6; tb = [groups[0][1], groups[1][1]]; } // 풀하우스
    else if (flush) { cat = 5; tb = ranks.slice(); }                                    // 플러시(5랭크)
    else if (straightHigh) { cat = 4; tb = [straightHigh]; }
    else if (groups[0][0] === 3) { cat = 3; tb = [groups[0][1], ...groups.slice(1).map(g => g[1])]; } // 트리플 + 키커2
    else if (groups[0][0] === 2 && groups[1][0] === 2) {                                 // 투페어
      const hi = Math.max(groups[0][1], groups[1][1]), lo = Math.min(groups[0][1], groups[1][1]);
      cat = 2; tb = [hi, lo, groups[2][1]];
    }
    else if (groups[0][0] === 2) { cat = 1; tb = [groups[0][1], ...groups.slice(1).map(g => g[1])]; } // 원페어 + 키커3
    else { cat = 0; tb = ranks.slice(); }                                               // 하이카드

    while (tb.length < 5) tb.push(0);
    // 점수: cat을 최상위 자리, tb를 15진수로
    let score = cat;
    for (let i = 0; i < 5; i++) score = score * 15 + (tb[i] || 0);
    return { cat, tb, score };
  }

  /* 조합 C(n,5) 인덱스 생성 */
  function combos5(n) {
    const res = [];
    for (let a = 0; a < n - 4; a++)
      for (let b = a + 1; b < n - 3; b++)
        for (let c = b + 1; c < n - 2; c++)
          for (let d = c + 1; d < n - 1; d++)
            for (let e = d + 1; e < n; e++) res.push([a, b, c, d, e]);
    return res;
  }
  const COMBO = { 5: combos5(5), 6: combos5(6), 7: combos5(7) };

  /* 5~7장 중 최고 5장 → { cat, tb, score, best:[5장] } */
  function evalBest(cards) {
    const n = cards.length;
    if (n < 5 || n > 7) throw new Error('evalBest needs 5~7 cards, got ' + n);
    const combos = COMBO[n];
    let best = null, bestCombo = null;
    for (const idx of combos) {
      const five = idx.map(i => cards[i]);
      const e = eval5(five);
      if (!best || e.score > best.score) { best = e; bestCombo = five; }
    }
    return { cat: best.cat, tb: best.tb, score: best.score, best: bestCombo };
  }

  /* 두 핸드 비교: >0 면 a 승, <0 b 승, 0 동점(스플릿) */
  function compare(a, b) { return a.score - b.score; }

  root.Eval = { eval5, evalBest, compare, CAT, catName: c => CAT[c] };
})(typeof window !== 'undefined' ? window : globalThis);
