// CHẠY NỀN KHÔNG BỊ HÃM: giữ các chức năng chạy bình thường khi người dùng chuyển sang tab khác.
// Khi tab bị ẩn, Chrome hãm setTimeout/setInterval của trang (tối thiểu 1 giây, sau ~5 phút chỉ ~1 lần/phút)
// -> các vòng chờ của tiện ích (và của HIS) hết giờ sai, báo lỗi dù HIS đã xong.
// Cách làm: khi tab ẨN, mọi hẹn giờ được đếm trong Web Worker (không bị hãm) rồi báo lại trang;
// khi tab HIỆN, dùng lại hẹn giờ gốc của trình duyệt (y hệt bình thường).
// Nạp ở cả 2 "world" (trang HIS = MAIN, tiện ích = ISOLATED), mọi iframe, trước mọi script khác.
// Không tạo được Worker (VD trang chặn) -> giữ nguyên hẹn giờ gốc, không ảnh hưởng gì.
(function () {
  'use strict';
  const W = window;
  const FLAG = '__bhytBgTimerInstalled';
  if (W[FLAG]) return;
  W[FLAG] = true;

  const nativeSet = W.setTimeout.bind(W);
  const nativeClear = W.clearTimeout.bind(W);
  // HIS ghi đè Date.now() -> dùng performance.now()
  const now = () => W.performance.now();

  let worker = null;
  try {
    const src = 'var t={};onmessage=function(e){var d=e.data;' +
      'if(d.c){clearTimeout(t[d.id]);delete t[d.id];return;}' +
      't[d.id]=setTimeout(function(){delete t[d.id];postMessage([d.id,d.g]);},d.ms);};';
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    worker = new Worker(url);
  } catch (_) { worker = null; }
  if (!worker) return;

  // id riêng, số lớn để không trùng id của hẹn giờ gốc
  let seq = 1000000000;
  const timers = new Map(); // id -> { fn, args, ms, repeat, due, mode: 'native'|'worker', nid }
  const useWorker = () => !!worker && document.visibilityState === 'hidden';

  function disarm(t, id) {
    if (t.mode === 'native') nativeClear(t.nid);
    else if (t.mode === 'worker' && worker) { try { worker.postMessage({ c: 1, id }); } catch (_) {} }
    t.mode = null;
  }

  function arm(t, id) {
    const wait = Math.max(0, t.due - now());
    t.gen++; // báo về từ lần hẹn cũ (đã hủy) sẽ bị bỏ qua
    if (useWorker()) {
      t.mode = 'worker';
      try { worker.postMessage({ id, ms: wait, g: t.gen }); return; } catch (_) { /* rơi xuống native */ }
    }
    t.mode = 'native';
    t.nid = nativeSet(() => fire(id), wait);
  }

  function fire(id) {
    const t = timers.get(id);
    if (!t) return;
    if (t.repeat) { t.due = now() + t.ms; arm(t, id); }
    else timers.delete(id);
    try { t.fn.apply(W, t.args); }
    catch (e) { nativeSet(() => { throw e; }, 0); } // giữ báo lỗi trên Console như bình thường
  }

  worker.onmessage = e => {
    const [id, g] = e.data;
    const t = timers.get(id);
    if (t && t.mode === 'worker' && t.gen === g) fire(id);
  };
  // Worker hỏng giữa chừng -> chuyển hết về hẹn giờ gốc
  worker.onerror = () => {
    worker = null;
    timers.forEach((t, id) => { if (t.mode === 'worker') { t.mode = null; arm(t, id); } });
  };

  function schedule(fn, ms, args, repeat) {
    ms = Math.max(0, Number(ms) || 0);
    if (repeat && ms < 1) ms = 1; // tránh setInterval 0ms chạy dồn
    const id = ++seq;
    const t = { fn, args, ms, repeat, due: now() + ms, mode: null, nid: 0, gen: 0 };
    timers.set(id, t);
    arm(t, id);
    return id;
  }

  function cancel(id) {
    const t = timers.get(id);
    if (t) { disarm(t, id); timers.delete(id); return; }
    nativeClear(id); // id của hẹn giờ gốc (tạo trước khi cài, hoặc dạng chuỗi lệnh)
  }

  const origSetTimeout = W.setTimeout, origSetInterval = W.setInterval;
  W.setTimeout = function setTimeout(fn, ms, ...args) {
    if (typeof fn !== 'function') return origSetTimeout.call(W, fn, ms, ...args); // dạng chuỗi lệnh -> để nguyên
    return schedule(fn, ms, args, false);
  };
  W.setInterval = function setInterval(fn, ms, ...args) {
    if (typeof fn !== 'function') return origSetInterval.call(W, fn, ms, ...args);
    return schedule(fn, ms, args, true);
  };
  W.clearTimeout = function clearTimeout(id) { if (id != null) cancel(id); };
  W.clearInterval = function clearInterval(id) { if (id != null) cancel(id); };

  // Đổi trạng thái ẩn/hiện -> đặt lại các hẹn giờ đang chờ theo đúng cơ chế (giữ nguyên thời điểm hẹn)
  document.addEventListener('visibilitychange', () => {
    timers.forEach((t, id) => {
      const want = useWorker() ? 'worker' : 'native';
      if (t.mode !== want) { disarm(t, id); arm(t, id); }
    });
  }, true);
})();
