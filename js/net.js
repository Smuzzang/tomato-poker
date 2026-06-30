/* =========================================================================
 * net.js — PeerJS 기반 서버리스 P2P (N인). 호스트가 권위를 갖고 각 게스트에게 중계.
 * 호스트: 6자리 코드로 방을 열고 여러 게스트 연결을 관리(broadcast / sendTo).
 * 게스트: 코드로 호스트에 접속, 메시지 송수신.
 * ======================================================================= */
(function (root) {
  const PREFIX = 'tomato-poker-';

  function randomCode() {
    let s = '';
    for (let i = 0; i < 6; i++) s += Math.floor(Math.random() * 10);
    if (s[0] === '0') s = '1' + s.slice(1);
    return s;
  }
  function makePeer(id) { return id ? new Peer(id) : new Peer(); }

  /* 호스트: 방 열기.
   * handlers: { onReady(code), onJoin(conn), onData(msg, conn), onLeave(conn), onError(e) } */
  function host(handlers) {
    const code = randomCode();
    const peer = makePeer(PREFIX + code);
    const conns = [];

    peer.on('open', () => handlers.onReady && handlers.onReady(code));
    peer.on('connection', c => {
      c.on('open', () => { conns.push(c); handlers.onJoin && handlers.onJoin(c); });
      c.on('data', d => handlers.onData && handlers.onData(d, c));
      c.on('close', () => { const i = conns.indexOf(c); if (i >= 0) conns.splice(i, 1); handlers.onLeave && handlers.onLeave(c); });
      c.on('error', () => { const i = conns.indexOf(c); if (i >= 0) conns.splice(i, 1); handlers.onLeave && handlers.onLeave(c); });
    });
    peer.on('error', e => {
      if (e.type === 'unavailable-id') { peer.destroy(); return host(handlers); } // 코드 충돌 → 재발급
      handlers.onError && handlers.onError(e);
    });

    const api = {
      code, peer, conns,
      sendTo: (c, obj) => { try { c && c.open && c.send(obj); } catch (_) {} },
      broadcast: obj => { for (const c of conns) { try { c.open && c.send(obj); } catch (_) {} } },
      count: () => conns.length,
      close: () => { try { peer.destroy(); } catch (_) {} },
    };
    return api;
  }

  /* 게스트: 코드로 접속.
   * handlers: { onConnected(), onData(msg), onClose(), onError(e) } */
  function join(code, handlers) {
    const peer = makePeer();
    let conn = null;
    peer.on('open', () => {
      conn = peer.connect(PREFIX + code, { reliable: true });
      conn.on('open', () => handlers.onConnected && handlers.onConnected());
      conn.on('data', d => handlers.onData && handlers.onData(d));
      conn.on('close', () => handlers.onClose && handlers.onClose());
      conn.on('error', e => handlers.onError && handlers.onError(e));
    });
    peer.on('error', e => handlers.onError && handlers.onError(e));
    return {
      send: obj => { try { conn && conn.open && conn.send(obj); } catch (_) {} },
      close: () => { try { peer.destroy(); } catch (_) {} },
      isConnected: () => !!(conn && conn.open),
    };
  }

  root.Net = { host, join, randomCode };
})(typeof window !== 'undefined' ? window : globalThis);
