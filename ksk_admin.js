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
  async function scan() {
    const today = todayStr();
    const rows = readRows().filter((r) => /Đang thực hiện/i.test(r.status));
    const q = await getQ();
    const have = new Set(q.map(keyOf));
    let added = 0, skippedToday = 0;
    for (const r of rows) {
      if (r.ngayKham === today) { skippedToday++; continue; }
      const it = { name: r.name, year: r.year, ngayKham: r.ngayKham, cccd: r.cccd, status: 'new', note: '' };
      if (have.has(keyOf(it))) continue;
      q.push(it); have.add(keyOf(it)); added++;
    }
    await setQ(q);
    log(`Đã quét ${rows.length} phiếu "Đang thực hiện": thêm ${added}` + (skippedToday ? `, bỏ qua ${skippedToday} phiếu khám hôm nay` : '') + '.');
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
          if (res.ok) { t.status = 'deleted'; t.note = res.msg; }
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
    } finally { busy = false; render(); }
  }

  // ---------- Bảng điều khiển ----------
  let panel, logEl, listEl;
  function log(msg) { if (logEl) logEl.textContent = msg; }
  function el(tag, css, text) { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; }
  function btn(label, bg, fn) {
    const b = el('button', `margin:2px;padding:4px 8px;border:0;border-radius:6px;color:#fff;background:${bg};cursor:pointer;font-size:12px`, label);
    b.onclick = fn; return b;
  }

  async function render() {
    if (!panel) return;
    const q = await getQ();
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
      tbl.appendChild(line);
    });
    listEl.appendChild(tbl);
  }

  function mount() {
    if (panel || !/\/admin\/operation\/health-checkup/.test(location.pathname)) return;
    panel = el('div', 'position:fixed;left:12px;bottom:12px;z-index:2147483646;width:420px;background:#fff;border:1px solid #c7d2fe;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.18);font:12px/1.4 system-ui,sans-serif;color:#222');
    const head = el('div', 'padding:6px 10px;background:#4338ca;color:#fff;border-radius:10px 10px 0 0;cursor:pointer;font-weight:600', 'KSK ký lại — Bước 1 & 3 (Cổng csdlksk) ▾');
    const body = el('div', 'padding:8px 10px');
    head.onclick = () => { body.style.display = body.style.display === 'none' ? '' : 'none'; };
    body.appendChild(el('div', 'color:#555;margin-bottom:4px',
      '① Lọc "Trạng thái ký số: Đang thực hiện", bấm Quét (mỗi trang một lần). ② Sang csdlyte bấm Đối chiếu. ③ Quay lại đây bấm Xóa (hồ sơ phải hiện trên trang đang xem). ④ Sang csdlyte bấm Ký & đẩy lại.'));
    body.appendChild(btn('Quét trang này', '#4338ca', scan));
    body.appendChild(btn('Xóa hồ sơ đã khớp', '#dc2626', deleteMatched));
    body.appendChild(btn('Dừng', '#6b7280', () => {
      stopFlag = true;
      chrome.storage.local.set({ [DKEY]: { active: false } });
      log('Sẽ dừng sau hồ sơ hiện tại…');
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
      if (o[DKEY] && o[DKEY].active) {
        log('Tiếp tục lượt xóa đang dở…');
        await waitFor(() => document.querySelector('tbody tr') && !/Loading/i.test(document.querySelector('tbody').innerText), 20000);
        runDeletes();
      }
    });
  }

  chrome.storage.onChanged.addListener((c) => { if (c[QKEY]) render(); });
  // Trang là SPA: kiểm tra định kỳ để hiện/ẩn bảng điều khiển theo đường dẫn
  setInterval(() => {
    const onPage = /\/admin\/operation\/health-checkup/.test(location.pathname);
    if (onPage && !panel) mount();
    if (!onPage && panel) { panel.remove(); panel = null; }
  }, 1000);
  mount();
})();
