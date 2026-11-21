// Xuất Excel từ cửa sổ "Lịch sử khám bệnh" (trang tiếp nhận bệnh nhân VNPT HIS).
// Cột: Ngày khám, Mã y tế, Họ tên, BHYT, Triệu chứng LS, Chẩn đoán (mã, tên), Bệnh phụ, Giải quyết.
//  - "Xuất Excel (lần này)": chỉ lần khám đang xem.
//  - "Xuất Excel (tất cả)": tự bấm lần lượt từng lần khám trong "Danh sách ngày khám" rồi gom lại.
(function () {
  if (window.__bhytLskExportLoaded) return;
  window.__bhytLskExportLoaded = true;

  const VISIT_RE = /^\d{4}_\d{2}_\d{2}_\d+$/;
  const norm = s => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase().replace(/:$/, '').trim();

  function isVisible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }

  function ownText(el) {
    let t = '';
    el.childNodes.forEach(n => { if (n.nodeType === 3) t += n.nodeValue; });
    return t;
  }

  // Tìm phần tử nhãn (label/td/span...) có chữ đúng bằng text, trong scope.
  function findLabel(scope, text) {
    const want = norm(text);
    const all = scope.querySelectorAll('label, td, th, span, div, b, strong, p');
    for (const el of all) {
      if (norm(ownText(el)) === want && isVisible(el)) return el;
    }
    return null;
  }

  function fieldText(el) {
    if (el.tagName === 'SELECT') {
      const o = el.selectedOptions && el.selectedOptions[0];
      return o ? o.textContent.trim() : '';
    }
    return String(el.value || '').trim();
  }

  // Lấy `count` ô nhập liệu hiển thị đứng ngay sau nhãn (theo thứ tự trong trang).
  function fieldsAfter(scope, labelText, count) {
    const label = findLabel(scope, labelText);
    if (!label) return [];
    const out = [];
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT);
    walker.currentNode = label;
    let n;
    while ((n = walker.nextNode()) && out.length < count) {
      if (label.contains(n)) continue;
      const tag = n.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') continue;
      const type = (n.type || '').toLowerCase();
      if (['hidden', 'checkbox', 'radio', 'button', 'submit', 'image'].includes(type)) continue;
      if (!isVisible(n)) continue;
      out.push(n);
    }
    return out;
  }

  // Khối chứa cửa sổ Lịch sử khám: tổ tiên của nhãn "Triệu chứng LS" có cả "Danh sách ngày khám".
  function findScope() {
    const labels = Array.from(document.querySelectorAll('label, td, span, div, b'))
      .filter(el => norm(ownText(el)) === 'triệu chứng ls' && isVisible(el));
    for (const lb of labels) {
      for (let el = lb.parentElement; el; el = el.parentElement) {
        const txt = el.textContent || '';
        if (/Danh sách ngày khám/i.test(txt) && /Mã y tế/i.test(txt)) return el;
        if (el === document.body) break;
      }
    }
    return null;
  }

  function readCurrent(scope) {
    const one = (l) => { const f = fieldsAfter(scope, l, 1)[0]; return f ? fieldText(f) : ''; };
    const cd = fieldsAfter(scope, 'Chẩn đoán', 2).map(fieldText);
    const gq = fieldsAfter(scope, 'Giải quyết', 2).map(fieldText);
    return {
      maYTe: one('Mã y tế'),
      hoTen: one('Họ tên'),
      bhyt: one('BHYT'),
      trieuChung: one('Triệu chứng LS'),
      cdMa: cd[0] || '',
      cdTen: cd[1] || '',
      benhPhu: one('Bệnh phụ'),
      giaiQuyet: gq[1] || gq[0] || '',
      maToa: one('Mã toa thuốc')
    };
  }

  function visitItems(scope) {
    const items = [];
    scope.querySelectorAll('*').forEach(el => {
      if (VISIT_RE.test(ownText(el).trim()) && isVisible(el)) items.push(el);
    });
    return items;
  }

  function selectedVisitCode(scope) {
    const sel = scope.querySelector('.tree-node-selected, tr.ui-state-highlight, tr[aria-selected="true"], .selected');
    if (sel) {
      const m = (sel.textContent || '').match(/\d{4}_\d{2}_\d{2}_\d+/);
      if (m) return m[0];
    }
    const maToa = readCurrent(scope).maToa;
    const m = maToa.match(/\d{4}_\d{2}_\d{2}_\d+/);
    return m ? m[0] : '';
  }

  function visitDate(code) {
    const m = String(code || '').match(/^(\d{4})_(\d{2})_(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  }

  function clickEl(el) {
    const target = el.closest('.tree-node, td, li') || el;
    ['mousedown', 'mouseup', 'click'].forEach(type =>
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })));
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const sig = d => [d.maToa, d.trieuChung, d.cdMa, d.cdTen, d.benhPhu, d.giaiQuyet].join('|');

  // Bấm 1 lần khám rồi chờ dữ liệu bên phải tải xong.
  async function loadVisit(scope, item, code) {
    const before = sig(readCurrent(scope));
    clickEl(item);
    const start = Date.now();
    let last = '', stableSince = 0;
    while (Date.now() - start < 5000) {
      await sleep(150);
      const d = readCurrent(scope);
      if (d.maToa && d.maToa.includes(code)) { await sleep(250); return readCurrent(scope); }
      const s = sig(d);
      if (s !== before) {
        if (s !== last) { last = s; stableSince = Date.now(); }
        else if (Date.now() - stableSince > 400) return d;
      }
    }
    return readCurrent(scope); // hết thời gian chờ: dữ liệu có thể trùng lần trước
  }

  function exportXlsx(rows) {
    const X = window.XLSX || (typeof XLSX !== 'undefined' ? XLSX : null);
    if (!X || !X.utils) { alert('Không tải được thư viện Excel.'); return; }
    const aoa = [['STT', 'Ngày khám', 'Lần khám', 'Mã y tế', 'Họ tên', 'BHYT', 'Triệu chứng LS',
      'Mã chẩn đoán', 'Chẩn đoán', 'Bệnh phụ', 'Giải quyết']];
    rows.forEach((r, i) => aoa.push([i + 1, visitDate(r.code), r.code, r.maYTe, r.hoTen, r.bhyt,
      r.trieuChung, r.cdMa, r.cdTen, r.benhPhu, r.giaiQuyet]));
    const ws = X.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [6, 12, 18, 12, 24, 18, 40, 12, 36, 60, 22].map(wch => ({ wch }));
    // Giữ dạng chữ để Excel không đổi mã y tế/mã thẻ thành số
    const range = X.utils.decode_range(ws['!ref']);
    for (let R = 1; R <= range.e.r; R++) {
      for (let C = 1; C <= range.e.c; C++) {
        const c = ws[X.utils.encode_cell({ r: R, c: C })];
        if (c && c.v != null) { c.t = 's'; c.v = String(c.v); }
      }
    }
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, 'LichSuKham');
    const first = rows[0] || {};
    const safe = s => String(s || '').replace(/[\\/:*?"<>|\s]+/g, '_');
    const name = `LichSuKham_${safe(first.maYTe)}_${safe(first.hoTen)}.xlsx`;
    const out = X.write(wb, { bookType: 'xlsx', type: 'array' });
    const url = URL.createObjectURL(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
  }

  let busy = false;

  async function exportCurrent(scope) {
    const d = readCurrent(scope);
    if (!d.maYTe && !d.hoTen) { alert('Chưa có dữ liệu lần khám để xuất.'); return; }
    exportXlsx([{ ...d, code: selectedVisitCode(scope) }]);
  }

  async function exportAll(scope, btn) {
    const items = visitItems(scope);
    if (!items.length) { alert('Không tìm thấy danh sách ngày khám.'); return; }
    const original = selectedVisitCode(scope);
    const label = btn.textContent;
    const rows = [];
    try {
      for (let i = 0; i < items.length; i++) {
        const code = ownText(items[i]).trim();
        btn.textContent = `${i + 1}/${items.length}…`;
        const d = await loadVisit(scope, items[i], code);
        rows.push({ ...d, code });
      }
      exportXlsx(rows);
    } finally {
      btn.textContent = label;
      // Quay lại lần khám đang xem trước đó
      const back = original && visitItems(scope).find(el => ownText(el).trim() === original);
      if (back) clickEl(back);
    }
  }

  // 1 nút nhỏ "Excel ▾" + menu xổ xuống 2 lựa chọn.
  function makeExportControl() {
    const wrap = document.createElement('span');
    wrap.className = 'bhyt-lsk-wrap';
    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'bhyt-lsk-export';
    main.textContent = 'Excel ▾';
    main.title = 'Xuất lịch sử khám ra Excel';
    const menu = document.createElement('div');
    menu.className = 'bhyt-lsk-menu';
    wrap.append(main, menu);

    const closeMenu = () => { menu.style.display = 'none'; };
    main.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (busy) return;
      menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    });
    document.addEventListener('click', e => { if (!wrap.contains(e.target)) closeMenu(); }, true);

    [['Lần khám này', exportCurrent], ['Tất cả lần khám', exportAll]].forEach(([text, handler]) => {
      const item = document.createElement('div');
      item.className = 'bhyt-lsk-item';
      item.textContent = text;
      item.addEventListener('click', async e => {
        e.preventDefault(); e.stopPropagation();
        closeMenu();
        if (busy) return;
        const scope = findScope();
        if (!scope) { alert('Không tìm thấy cửa sổ Lịch sử khám bệnh.'); return; }
        busy = true;
        main.disabled = true;
        try { await handler(scope, main); }
        catch (err) { console.error('[BHYT LSK Export]', err); alert('Lỗi xuất Excel: ' + err.message); }
        finally {
          busy = false;
          main.disabled = false;
          main.textContent = 'Excel ▾';
        }
      });
      menu.appendChild(item);
    });
    return wrap;
  }

  function findButtonByText(scope, re) {
    return Array.from(scope.querySelectorAll('button, a, input[type="button"], .l-btn, span'))
      .find(el => re.test((el.value || el.textContent || '').trim()) && isVisible(el));
  }

  // Kiểm tra nhẹ: ở khung chính chỉ quét khi đang mở cửa sổ có tiêu đề "Lịch sử khám".
  function lskWindowOpen() {
    if (window !== window.top) return true; // iframe nhỏ, quét luôn
    const wins = document.querySelectorAll('.window:not(.window-shadow), .ui-dialog, .modal, .panel');
    for (const w of wins) {
      if (!isVisible(w)) continue;
      const h = w.querySelector('.panel-title, .ui-dialog-title, .modal-title, .window-title');
      if (h && /lịch sử khám/i.test(h.textContent || '')) return true;
    }
    return false;
  }

  function ensureButtons() {
    if (!lskWindowOpen()) return;
    const scope = findScope();
    if (!scope || scope.querySelector('.bhyt-lsk-wrap')) return;
    const wrap = makeExportControl();
    // Đặt ngay cạnh nút "Làm mới" (cùng hàng); không có thì cạnh "In toa thuốc".
    const anchor = findButtonByText(scope, /^Làm mới$/i) || findButtonByText(scope, /^In toa thu[oố]c$/i);
    if (anchor) (anchor.closest('a.l-btn, button, input') || anchor).after(wrap);
    else scope.prepend(wrap);
  }

  setInterval(ensureButtons, 1000);

  const style = document.createElement('style');
  style.textContent =
    '.bhyt-lsk-wrap { position: relative; display: inline-block; margin-left: 6px; vertical-align: middle; white-space: nowrap; }' +
    '.bhyt-lsk-export { padding: 3px 8px; font-size: 12px; font-weight: bold; line-height: 16px; cursor: pointer; color: #fff;' +
    ' background: #1d6f42; border: 1px solid #145a32; border-radius: 3px; }' +
    '.bhyt-lsk-export:hover:not(:disabled) { background: #145a32; }' +
    '.bhyt-lsk-export:disabled { opacity: .7; cursor: wait; }' +
    '.bhyt-lsk-menu { display: none; position: absolute; left: 0; top: 100%; margin-top: 2px; z-index: 100000;' +
    ' background: #fff; border: 1px solid #b0b0b0; border-radius: 3px; box-shadow: 0 2px 6px rgba(0,0,0,.2); min-width: 130px; }' +
    '.bhyt-lsk-item { padding: 5px 10px; font-size: 12px; color: #222; cursor: pointer; }' +
    '.bhyt-lsk-item:hover { background: #e8f5e9; color: #145a32; }';
  (document.head || document.documentElement).appendChild(style);
})();
