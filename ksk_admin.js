// KSK ký lại — phần chạy trên admin.csdlksk.vn (Cổng dữ liệu sức khỏe).
// 1) Quét các phiếu "Đang thực hiện" trên trang đang xem vào hàng đợi.
// 2) Sau khi đối chiếu trên csdlyte, xóa các phiếu đã khớp (từng phiếu, có kiểm tra tên trong hộp xác nhận).
// Hàng đợi dùng chung với ksk_csdlyte.js qua chrome.storage.local (key "kskQueue").
(() => {
  'use strict';
  if (window.__tiqKskAdmin) return;
  window.__tiqKskAdmin = true;

  const QKEY = 'kskQueue';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toUpperCase();
  const todayStr = () => {
    const d = new Date();
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
  };
  const getQ = () => new Promise((r) => chrome.storage.local.get(QKEY, (o) => r(o[QKEY] || [])));
  const setQ = (q) => new Promise((r) => chrome.storage.local.set({ [QKEY]: q }, r));
  const keyOf = (it) => [it.name, it.year, it.ngayKham, it.cccd].join('|');

  const STATUS = {
    new: 'Chờ đối chiếu',
    matched: 'Đã khớp – chờ xóa',
    review: 'Cần xem tay',
    nomatch: 'Không thấy trên csdlyte',
    ambiguous: 'Nhiều kết quả',
    deleted: 'Đã xóa – chờ ký',
    delfail: 'Xóa lỗi',
    pushed: 'Đã đẩy lại',
    error: 'Lỗi ký/đẩy',
  };

  // ---------- Đọc bảng ----------
  function colIndex() {
    const ths = [...document.querySelectorAll('thead th')].map((t) => norm(t.innerText));
    const f = (re, d) => { const i = ths.findIndex((t) => re.test(t)); return i >= 0 ? i : d; };
    return {
      name: f(/HỌ VÀ TÊN/, 1),
      cccd: f(/ĐỊNH DANH/, 2),
      year: f(/NGÀY SINH/, 3),
      ngayKham: f(/NGÀY KHÁM/, 4),
      status: f(/TRẠNG THÁI KÝ/, 8),
    };
  }
  function readRows() {
    const c = colIndex();
    return [...document.querySelectorAll('tbody tr')].filter((r) => r.cells.length > 5).map((r) => {
      const cell = (i) => (r.cells[i] ? r.cells[i].innerText.trim() : '');
      return {
        el: r,
        name: norm(cell(c.name)),
        cccd: cell(c.cccd),
        year: cell(c.year).slice(-4),
        ngayKham: cell(c.ngayKham),
        status: cell(c.status),
      };
    });
  }

  // ---------- Quét ----------
  async function scan(limit = Infinity) {
    const today = todayStr();
    const rows = readRows().filter((r) => /Đang thực hiện/i.test(r.status));
    const q = await getQ();
    // Bỏ qua cả hồ sơ đã xóa trước đây (kskDone) — danh sách Cổng cập nhật chậm nên phiếu đã xóa có thể còn hiện
    const done = await new Promise((r) => chrome.storage.local.get('kskDone', (o) => r(o.kskDone || {})));
    const have = new Set(q.map(keyOf).concat(Object.keys(done)));
    let added = 0, skippedToday = 0;
    for (const r of rows) {
      if (added >= limit) break;
      if (r.ngayKham === today) { skippedToday++; continue; }
      const it = { name: r.name, year: r.year, ngayKham: r.ngayKham, cccd: r.cccd, status: 'new', note: '' };
      if (have.has(keyOf(it))) continue;
      q.push(it); have.add(keyOf(it)); added++;
    }
    await setQ(q);
    log(`Đã quét ${rows.length} phiếu "Đang thực hiện": thêm ${added}` + (skippedToday ? `, bỏ qua ${skippedToday} phiếu khám hôm nay` : '') + '.');
    return added;
  }

  // ---------- Xóa ----------
  function fire(el, types) {
    for (const t of types) {
      const Ev = t.startsWith('pointer') ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Ev(t, { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }));
    }
  }
  async function waitFor(fn, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(150); }
    return null;
  }
  function closeOverlays() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }

  async function deleteOne(it) {
    // Lọc danh sách theo tên để không phụ thuộc trang đang xem
    if (!(await filterByName(it.name))) return { ok: false, msg: 'không lọc được theo tên' };
    const row = readRows().find((r) => r.name === it.name && r.year === it.year && r.ngayKham === it.ngayKham && (!it.cccd || r.cccd === it.cccd) && /Đang thực hiện/i.test(r.status));
    if (!row) {
      const other = readRows().find((r) => r.name === it.name && r.year === it.year && r.ngayKham === it.ngayKham && (!it.cccd || r.cccd === it.cccd));
      if (other) return { ok: false, msg: `phiếu đang ở trạng thái "${other.status}" — không xóa` };
      if (pageCount() > 1) return { ok: false, msg: 'tìm theo tên ra nhiều trang — hãy lọc "Đang thực hiện" rồi thử lại' };
      // Bảng đã tải xong mà không còn phiếu này → đã bị xóa (Cổng thường xóa xong nhưng phản hồi treo)
      return { ok: true, msg: 'không còn trên Cổng (đã xóa)' };
    }

    closeOverlays(); await sleep(300);
    const btn = row.el.cells[row.el.cells.length - 1].querySelector('button');
    if (!btn) return { ok: false, msg: 'không thấy nút Hành động' };
    fire(btn, ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
    const item = await waitFor(() => [...document.querySelectorAll('[role=menuitem]')].find((e) => e.innerText.trim() === 'Xóa'), 3000);
    if (!item) { closeOverlays(); return { ok: false, msg: 'không mở được menu Xóa' }; }
    item.click();

    const dlg = await waitFor(() => [...document.querySelectorAll('[role=dialog],[role=alertdialog]')].find((d) => /Xóa phiếu khám/i.test(d.innerText)), 3000);
    if (!dlg) return { ok: false, msg: 'không hiện hộp xác nhận' };
    if (!norm(dlg.innerText).includes(it.name)) {
      const out = [...dlg.querySelectorAll('button')].find((b) => /Thoát/i.test(b.innerText));
      if (out) out.click();
      return { ok: false, msg: 'hộp xác nhận không đúng tên — đã hủy' };
    }

    // Theo dõi thông báo (toast) xuất hiện sau khi bấm Xóa
    let toast = '';
    const mo = new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) {
        const t = (n.innerText || n.textContent || '').trim();
        if (/thành công|Không tìm thấy|lỗi|thất bại/i.test(t)) toast = t;
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    [...dlg.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Xóa').click();

    await waitFor(() => toast || !document.body.contains(dlg), 12000);
    await waitFor(() => toast, 2000);
    mo.disconnect();

    if (!toast && document.body.contains(dlg)) {
      // Cổng thường đã xóa nhưng phản hồi treo rất lâu → tải lại trang rồi kiểm tra lại (lần sau sẽ báo "Không tìm thấy")
      return { ok: false, hung: true, msg: 'Cổng phản hồi chậm — tải lại trang để kiểm tra' };
    }
    if (/thành công/i.test(toast)) return { ok: true, msg: 'xóa thành công' };
    if (/Không tìm thấy/i.test(toast)) return { ok: true, msg: 'đã bị xóa trước đó' };
    if (toast) return { ok: false, msg: toast.slice(0, 120) };
    return { ok: true, msg: 'hộp đã đóng (không thấy thông báo)' };
  }

  // Gõ tên vào ô "Họ và tên" rồi bấm Tìm kiếm; chờ bảng chỉ còn đúng tên đó (hoặc "Không có dữ liệu").
  async function filterByName(name) {
    const inp = [...document.querySelectorAll('input')].find((i) => /Họ và tên/i.test(i.placeholder || ''));
    const search = [...document.querySelectorAll('button')].find((b) => /Tìm kiếm/.test(b.innerText));
    if (!inp || !search) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(inp, name);
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(300);
    search.click();
    // Ô tìm tên là tìm GẦN ĐÚNG (LÊ THỊ MINH ra cả LÊ THỊ MINH HƯƠNG) → chỉ cần mọi dòng CHỨA tên.
    // Trong lúc tải, bảng có thể tạm trống → đợi hết "Loading" và bảng ổn định 2 lần liên tiếp.
    await sleep(1200);
    const snap = () => {
      if (isLoading()) return null;
      const body = document.querySelector('tbody');
      if (!body) return null;
      if (/Không có dữ liệu/i.test(body.innerText)) return 'EMPTY';
      const rows = readRows();
      if (!rows.length || !rows.every((r) => r.name.includes(name))) return null;
      return rows.map((r) => r.name + r.cccd + r.ngayKham + r.status).join('#');
    };
    let last = null;
    const ok = await waitFor(() => {
      const s = snap();
      if (s && s === last) return true;
      last = s;
      return false;
    }, 20000);
    return !!ok;
  }
  function isLoading() {
    return [...document.querySelectorAll('body *')].some((e) => e.children.length === 0 && /^Loading/i.test((e.textContent || '').trim()) && e.offsetParent);
  }
  function pageCount() {
    const t = [...document.querySelectorAll('*')].find((e) => e.children.length === 0 && /Trang \d+ trên \d+/.test(e.textContent));
    const m = t && t.textContent.match(/Trang \d+ trên (\d+)/);
    return m ? +m[1] : 1;
  }

  const DKEY = 'kskDelRun';
  const MAX_DEL_TRIES = 4;
  let busy = false, stopFlag = false;
  async function deleteMatched() {
    if (busy) return;
    const q = await getQ();
    const todo = q.filter((x) => x.status === 'matched' || x.status === 'delfail');
    if (!todo.length) { log('Không có hồ sơ "Đã khớp" để xóa. Hãy bấm Đối chiếu bên csdlyte trước.'); return; }
    if (!confirm(`Xóa VĨNH VIỄN ${todo.length} phiếu khám trên Cổng dữ liệu sức khỏe?\n\n` + todo.slice(0, 15).map((x) => `• ${x.name} (${x.year}) – khám ${x.ngayKham}`).join('\n') + (todo.length > 15 ? '\n…' : '') + '\n\nKhông khôi phục được.')) return;
    // Lỗi cũ được thử lại từ đầu
    for (const x of q) if (x.status === 'delfail') { x.status = 'matched'; x.delTries = 0; }
    await setQ(q);
    await new Promise((r) => chrome.storage.local.set({ [DKEY]: { active: true } }, r));
    runDeletes();
  }

  // Chạy lần lượt; nếu Cổng treo thì tải lại trang và tiếp tục (trạng thái lưu trong storage).
  async function runDeletes() {
    if (busy) return;
    busy = true; stopFlag = false; render();
    try {
      for (;;) {
        const run = await new Promise((r) => chrome.storage.local.get(DKEY, (o) => r(o[DKEY] || {})));
        if (!run.active || stopFlag) break;
        const cur = await getQ();
        const it = cur.find((x) => x.status === 'matched');
        if (!it) break;
        const n = cur.filter((x) => x.status === 'matched').length;
        log(`Đang xóa ${it.name} (còn ${n})…`);
        let res;
        try { res = await deleteOne(it); } catch (e) { res = { ok: false, msg: String(e) }; }
        const q2 = await getQ();
        const t = q2.find((x) => keyOf(x) === keyOf(it));
        if (t) {
          t.delTries = (t.delTries || 0) + 1;
          if (res.ok) {
            t.status = 'deleted'; t.note = res.msg;
            const done = await new Promise((r) => chrome.storage.local.get('kskDone', (o) => r(o.kskDone || {})));
            done[keyOf(t)] = Date.now();
            // giữ 60 ngày gần nhất
            for (const k of Object.keys(done)) if (Date.now() - done[k] > 60 * 864e5) delete done[k];
            await new Promise((r) => chrome.storage.local.set({ kskDone: done }, r));
          }
          else if (res.hung) { t.delSent = Date.now(); t.note = res.msg; if (t.delTries >= MAX_DEL_TRIES) t.status = 'delfail'; }
          else if (t.delTries >= 2 || !/lọc|menu|hộp xác nhận/.test(res.msg)) { t.status = 'delfail'; t.note = res.msg; }
        }
        await setQ(q2);
        if (res.hung) { log('Cổng phản hồi chậm — tải lại trang và tiếp tục…'); await sleep(1500); location.reload(); return; }
        await sleep(1200);
      }
      await new Promise((r) => chrome.storage.local.set({ [DKEY]: { active: false } }, r));
      const q = await getQ();
      const done = q.filter((x) => x.status === 'deleted').length, fail = q.filter((x) => x.status === 'delfail').length;
      log(`Xong lượt xóa${stopFlag ? ' (đã dừng)' : ''}: đã xóa ${done}, lỗi ${fail}. Sang csdlyte bấm "Ký & đẩy lại".`);
      // Chế độ tự động: chuyển sang bước ký trên csdlyte
      const a = await getA();
      if (a.active && a.phase === 'delete' && !stopFlag) {
        setTimeout(() => goPhase(done ? 'sign' : 'scan', `Đã xóa ${done}, lỗi ${fail}`), 300);
      }
    } finally { busy = false; render(); }
  }

  // ================= TỰ ĐỘNG TOÀN BỘ =================
  // Một tab duy nhất tự chuyển qua lại giữa Cổng (csdlksk) và csdlyte theo các bước:
  // scan (Cổng) → match (csdlyte) → delete (Cổng) → sign (csdlyte) → verify (Nhật ký Cổng) → scan … đến khi hết.
  const AKEY = 'kskAuto';
  const URL_CHECKUP = 'https://admin.csdlksk.vn/admin/operation/health-checkup';
  const URL_LOG = 'https://admin.csdlksk.vn/admin/operation/health-data';
  const URL_YTE = 'https://csdlyte.danang.gov.vn/records?kho=ksk96';
  const PHASE_NAME = { scan: 'Quét Cổng', match: 'Đối chiếu csdlyte', delete: 'Xóa trên Cổng', sign: 'Ký & liên thông', verify: 'Kiểm tra Nhật ký', done: 'Hoàn tất' };
  const getA = () => new Promise((r) => chrome.storage.local.get(AKEY, (o) => r(o[AKEY] || { active: false })));
  const setA = (patch) => getA().then((a) => new Promise((r) => chrome.storage.local.set({ [AKEY]: Object.assign(a, patch) }, r)));

  async function goPhase(phase, msg) {
    await setA({ phase, msg: msg || '', phaseAt: Date.now() });
    render(); // autoTick sẽ chạy qua chrome.storage.onChanged khi đổi bước
  }

  function isLoadingAny() {
    return [...document.querySelectorAll('body *')].some((e) => e.children.length === 0 && /^Loading/i.test((e.textContent || '').trim()) && e.offsetParent);
  }
  async function waitSettled(ms = 25000) {
    let last = null;
    return waitFor(() => {
      if (isLoadingAny()) { last = null; return false; }
      const b = document.querySelector('tbody');
      if (!b) return false;
      const s = b.innerText;
      if (s === last) return true;
      last = s; return false;
    }, ms).then((v) => (sleep(300).then(() => v)));
  }
  // Chọn giá trị trong ô chọn (Radix Select): mở bằng chuột, chọn bằng phím Enter (bấm chuột không ăn)
  async function pickSelect(re, optText) {
    const c = [...document.querySelectorAll('[role=combobox]')].find((e) => re.test(e.innerText.trim()));
    if (!c) return false;
    if (c.innerText.trim() === optText) return true;
    for (let k = 0; k < 2; k++) {
      fire(c, ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
      const o = await waitFor(() => [...document.querySelectorAll('[role=option]')].find((x) => x.innerText.trim() === optText), 2000);
      if (!o) { closeOverlays(); await sleep(300); continue; }
      o.focus();
      o.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await sleep(400);
      if (c.innerText.trim() === optText) return true;
      o.click(); await sleep(400);
      if (c.innerText.trim() === optText) return true;
    }
    return c.innerText.trim() === optText;
  }
  function nextPageBtn() {
    return [...document.querySelectorAll('button')].find((b) => /Trang sau/i.test((b.getAttribute('aria-label') || '') + (b.title || '') + b.textContent));
  }

  async function autoScan(a) {
    log('Tự động: chọn "Đang thực hiện", 50 dòng/trang, tìm kiếm…');
    await waitSettled();
    const okSt = await pickSelect(/^(Trạng thái ký số|Chưa ký số|Đang thực hiện|Đã ký số)$/, 'Đang thực hiện');
    if (!okSt) { await setA({ active: false, msg: 'Không chọn được bộ lọc "Đang thực hiện" — đã dừng.' }); log('Không chọn được bộ lọc "Đang thực hiện" — đã dừng.'); return; }
    await pickSelect(/^\d+$/, '50');
    await sleep(800); await waitSettled(); // đổi số dòng làm trang tải lại — chờ xong mới bấm Tìm kiếm
    const inp = [...document.querySelectorAll('input')].find((i) => /Họ và tên/i.test(i.placeholder || ''));
    if (inp && inp.value) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, '');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // Bấm Tìm kiếm và kiểm tra bộ lọc đã ăn (mọi dòng đều "Đang thực hiện"); thử lại tối đa 3 lần
    let filtered = false;
    for (let k = 0; k < 3 && !filtered; k++) {
      const search = [...document.querySelectorAll('button')].find((b) => /Tìm kiếm/.test(b.innerText));
      if (search) search.click();
      await sleep(1500); await waitSettled();
      const rows = readRows();
      filtered = !rows.length || rows.every((r) => /Đang thực hiện/i.test(r.status));
    }
    if (!filtered) log('Cảnh báo: bộ lọc chưa ăn — vẫn quét nhưng chỉ lấy phiếu "Đang thực hiện".');

    const batch = a.batch || 20;
    let added = 0;
    for (let p = 0; p < 40 && added < batch; p++) {
      added += await scan(batch - added);
      if (added >= batch) break;
      const nb = nextPageBtn();
      if (!nb || nb.disabled) break;
      nb.click(); await sleep(1500); await waitSettled();
    }
    const q = await getQ();
    const pend = q.filter((x) => ['new', 'matched', 'deleted'].includes(x.status)).length;
    if (!pend) {
      await setA({ active: false, phase: 'done', msg: 'Hết hồ sơ "Đang thực hiện" cần xử lý.' });
      log('Tự động: hết hồ sơ cần xử lý — đã dừng.'); render(); return;
    }
    await goPhase('match', `Chu kỳ ${a.cycle || 1}: thêm ${added} hồ sơ mới`);
  }

  async function autoDelete() {
    const q = await getQ();
    if (!q.some((x) => x.status === 'matched')) return goPhase(q.some((x) => x.status === 'deleted') ? 'sign' : 'scan', 'Không có hồ sơ cần xóa');
    await new Promise((r) => chrome.storage.local.set({ [DKEY]: { active: true } }, r));
    await waitSettled();
    runDeletes(); // khi xong sẽ tự chuyển sang bước "sign"
  }

  function parseDT(s) {
    const m = (s || '').match(/(\d\d)\/(\d\d)\/(\d{4})\s+(\d\d):(\d\d)(?::(\d\d))?/);
    return m ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)).getTime() : 0;
  }
  async function autoVerify(a) {
    log('Tự động: kiểm tra Nhật ký liên thông…');
    await waitSettled();
    await pickSelect(/^\d+$/, '50');
    await sleep(1200); await waitSettled();
    const ths = [...document.querySelectorAll('thead th')].map((t) => norm(t.innerText));
    const ix = (re, d) => { const i = ths.findIndex((t) => re.test(t)); return i >= 0 ? i : d; };
    const c = { name: ix(/TÊN BỆNH NHÂN/, 1), st: ix(/TRẠNG THÁI/, 2), dt: ix(/NGÀY ĐẨY/, 3), why: ix(/LÝ DO/, 4) };
    const rows = [...document.querySelectorAll('tbody tr')].filter((r) => r.cells.length > 3).map((r) => ({
      name: norm(r.cells[c.name].innerText), st: r.cells[c.st].innerText.trim(), t: parseDT(r.cells[c.dt].innerText), why: r.cells[c.why].innerText.trim(),
    }));
    const q = await getQ();
    let ok = 0, miss = 0;
    for (const it of q.filter((x) => x.status === 'pushed' && !x.verified)) {
      const t0 = (it.pushedAt || 0) - 10 * 60 * 1000;
      const r = rows.find((x) => x.name === it.name && x.t >= t0);
      if (r) { it.portal = `${r.st} · ${r.why}`; it.verified = true; ok++; }
      else { it.vtries = (it.vtries || 0) + 1; if (it.vtries >= 2) { it.portal = 'chưa thấy trong Nhật ký'; it.verified = true; } miss++; }
    }
    await setQ(q);
    await setA({ cycle: (a.cycle || 1) + 1 });
    await goPhase('scan', `Nhật ký: xác nhận ${ok}, chưa thấy ${miss}`);
  }

  let ticking = false;
  async function autoTick() {
    if (ticking) return;
    const a = await getA();
    if (!a.active) return;
    ticking = true;
    try {
      if (a.phase === 'match' || a.phase === 'sign') { location.href = URL_YTE; return; }
      if (a.phase === 'verify') {
        if (!/health-data/.test(location.pathname)) { location.href = URL_LOG; return; }
        await autoVerify(a); return;
      }
      if (!/health-checkup/.test(location.pathname)) { location.href = URL_CHECKUP; return; }
      if (a.phase === 'scan') await autoScan(a);
      else if (a.phase === 'delete') await autoDelete();
    } catch (e) {
      log('Lỗi tự động: ' + (e && e.message ? e.message : e));
    } finally { ticking = false; }
  }

  async function startAuto() {
    const batch = Math.max(1, Math.min(200, parseInt(batchInp.value, 10) || 20));
    if (!confirm(
      'CHẠY TỰ ĐỘNG TOÀN BỘ:\n' +
      `• Lọc "Đang thực hiện", quét ${batch} hồ sơ mỗi lượt (bỏ qua phiếu khám hôm nay)\n` +
      '• Đối chiếu trên csdlyte (họ tên, năm sinh, CCCD, ngày khám)\n' +
      '• XÓA VĨNH VIỄN phiếu đã khớp trên Cổng\n' +
      '• TỰ tick cam kết và KÝ SỐ (có giá trị pháp lý), rồi liên thông lên Cổng\n' +
      '• Kiểm tra Nhật ký liên thông, rồi lặp lại đến khi hết.\n\n' +
      'Tab này sẽ tự chuyển qua lại giữa 2 trang — đừng đóng tab. Tiếp tục?')) return;
    await new Promise((r) => chrome.storage.local.set({ kskRun: { active: false } }, r));
    await setA({ active: true, phase: 'scan', batch, cycle: 1, startedAt: Date.now(), msg: '' });
    render();
    autoTick();
  }
  async function stopAuto() {
    stopFlag = true;
    await new Promise((r) => chrome.storage.local.set({ [DKEY]: { active: false }, kskRun: { active: false } }, r));
    await setA({ active: false, msg: 'Đã dừng theo yêu cầu.' });
    log('Đã dừng tự động.'); render();
  }

  // ---------- Bảng điều khiển ----------
  let panel, logEl, listEl, autoEl, batchInp;
  function log(msg) { if (logEl) logEl.textContent = msg; }
  function el(tag, css, text) { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; }
  function btn(label, bg, fn) {
    const b = el('button', `margin:2px;padding:4px 8px;border:0;border-radius:6px;color:#fff;background:${bg};cursor:pointer;font-size:12px`, label);
    b.onclick = fn; return b;
  }

  async function render() {
    if (!panel) return;
    const q = await getQ();
    const a = await getA();
    autoEl.textContent = a.active
      ? `● TỰ ĐỘNG — chu kỳ ${a.cycle || 1} · bước: ${PHASE_NAME[a.phase] || a.phase}${a.msg ? ' · ' + a.msg : ''}`
      : (a.msg ? `Tự động: ${a.msg}` : '');
    const cnt = {};
    q.forEach((x) => { cnt[x.status] = (cnt[x.status] || 0) + 1; });
    listEl.innerHTML = '';
    const sum = el('div', 'margin:4px 0;font-weight:600', `Hàng đợi: ${q.length} — ` + Object.keys(cnt).map((k) => `${STATUS[k] || k}: ${cnt[k]}`).join(' · '));
    listEl.appendChild(sum);
    const tbl = el('div', 'max-height:220px;overflow:auto;border-top:1px solid #ddd');
    q.forEach((x) => {
      const color = { deleted: '#0a7', pushed: '#06c', matched: '#a60', delfail: '#c00', error: '#c00', nomatch: '#888', ambiguous: '#c60', review: '#c60' }[x.status] || '#333';
      const line = el('div', 'padding:2px 0;border-bottom:1px dashed #eee');
      line.appendChild(el('span', '', `${x.name} (${x.year}) · ${x.ngayKham} — `));
      line.appendChild(el('span', `color:${color};font-weight:600`, STATUS[x.status] || x.status));
      if (x.note) line.appendChild(el('span', 'color:#777', ` · ${x.note}`));
      if (x.portal) line.appendChild(el('span', 'color:#0f766e', ` · Nhật ký: ${x.portal}`));
      tbl.appendChild(line);
    });
    listEl.appendChild(tbl);
  }

  const PANEL_PATH = /\/admin\/operation\/(health-checkup|health-data)/;
  function mount() {
    if (panel || !PANEL_PATH.test(location.pathname)) return;
    panel = el('div', 'position:fixed;left:12px;bottom:12px;z-index:2147483646;width:420px;background:#fff;border:1px solid #c7d2fe;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.18);font:12px/1.4 system-ui,sans-serif;color:#222');
    const head = el('div', 'padding:6px 10px;background:#4338ca;color:#fff;border-radius:10px 10px 0 0;cursor:pointer;font-weight:600', 'KSK ký lại — Bước 1 & 3 (Cổng csdlksk) ▾');
    const body = el('div', 'padding:8px 10px');
    head.onclick = () => { body.style.display = body.style.display === 'none' ? '' : 'none'; };
    body.appendChild(el('div', 'color:#555;margin-bottom:4px',
      '① Lọc "Trạng thái ký số: Đang thực hiện", bấm Quét (mỗi trang một lần). ② Sang csdlyte bấm Đối chiếu. ③ Quay lại đây bấm Xóa (hồ sơ phải hiện trên trang đang xem). ④ Sang csdlyte bấm Ký & đẩy lại.'));
    const autoBox = el('div', 'margin:4px 0 6px;padding:6px;border:1px solid #fde68a;background:#fffbeb;border-radius:8px');
    autoBox.appendChild(el('span', 'font-weight:600', 'Tự động toàn bộ — mỗi lượt '));
    batchInp = el('input', 'width:48px;margin:0 4px;padding:1px 4px;border:1px solid #ccc;border-radius:4px');
    batchInp.type = 'number'; batchInp.min = '1'; batchInp.max = '200'; batchInp.value = '20';
    getA().then((a) => { if (a.batch) batchInp.value = a.batch; });
    autoBox.appendChild(batchInp);
    autoBox.appendChild(el('span', '', ' hồ sơ '));
    autoBox.appendChild(btn('▶ Chạy', '#b45309', startAuto));
    autoBox.appendChild(btn('■ Dừng', '#6b7280', stopAuto));
    autoEl = el('div', 'margin-top:4px;color:#b45309;font-weight:600');
    autoBox.appendChild(autoEl);
    body.appendChild(autoBox);
    body.appendChild(el('div', 'color:#777;margin:2px 0', 'Làm tay từng bước:'));
    body.appendChild(btn('Quét trang này', '#4338ca', () => scan()));
    body.appendChild(btn('Xóa hồ sơ đã khớp', '#dc2626', deleteMatched));
    body.appendChild(btn('Dừng', '#6b7280', () => {
      stopFlag = true;
      chrome.storage.local.set({ [DKEY]: { active: false } });
      log('Sẽ dừng sau hồ sơ hiện tại…');
    }));
    body.appendChild(btn('Dọn hồ sơ đã xong', '#0f766e', async () => {
      const q = await getQ();
      const keep = q.filter((x) => x.status !== 'pushed');
      if (!confirm(`Bỏ ${q.length - keep.length} hồ sơ "Đã đẩy lại" khỏi hàng đợi? (chỉ dọn danh sách trong tiện ích)`)) return;
      await setQ(keep); render();
    }));
    body.appendChild(btn('Xóa hàng đợi', '#9ca3af', async () => {
      if (!confirm('Xóa toàn bộ hàng đợi (chỉ danh sách trong tiện ích, không xóa hồ sơ)?')) return;
      await setQ([]); render();
    }));
    logEl = el('div', 'margin:6px 0;color:#1d4ed8;min-height:16px');
    listEl = el('div');
    body.appendChild(logEl); body.appendChild(listEl);
    panel.appendChild(head); panel.appendChild(body);
    document.body.appendChild(panel);
    render();
    // Tiếp tục lượt xóa đang dở (sau khi trang được tải lại)
    chrome.storage.local.get(DKEY, async (o) => {
      if (o[DKEY] && o[DKEY].active && /health-checkup/.test(location.pathname)) {
        log('Tiếp tục lượt xóa đang dở…');
        await waitFor(() => document.querySelector('tbody tr') && !/Loading/i.test(document.querySelector('tbody').innerText), 20000);
        runDeletes();
      } else {
        await waitFor(() => document.querySelector('tbody tr'), 20000);
        autoTick();
      }
    });
  }

  chrome.storage.onChanged.addListener((c) => {
    if (c[QKEY] || c[AKEY]) render();
    if (c[AKEY] && c[AKEY].newValue && c[AKEY].newValue.active &&
        (!c[AKEY].oldValue || !c[AKEY].oldValue.active || c[AKEY].oldValue.phase !== c[AKEY].newValue.phase)) setTimeout(autoTick, 800);
  });
  // Trang là SPA: kiểm tra định kỳ để hiện/ẩn bảng điều khiển theo đường dẫn
  setInterval(() => {
    const onPage = PANEL_PATH.test(location.pathname);
    if (onPage && !panel) mount();
    if (!onPage && panel) { panel.remove(); panel = null; }
  }, 1000);
  mount();
})();
