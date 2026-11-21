// ĐỒNG BỘ LẠI HỒ SƠ - BƯỚC 1 (checkxml.com.vn/sync-insurance): lấy danh sách hồ sơ "Chờ đẩy cổng"
// (đã sửa lỗi xong, cần xóa hồ sơ cũ trên cổng giám định rồi ký lại XML 4750 trên HIS).
// Danh sách lưu vào chrome.storage.local (bhytResyncQueue) để Bước 2 (gdbhyt) và Bước 3 (HIS) dùng chung.
(function () {
  if (window.top !== window || window.__bhytResyncCx) return;
  window.__bhytResyncCx = true;
  const KEY = 'bhytResyncQueue';
  const norm = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Đọc 1 dòng hồ sơ trên bảng "Danh sách Hồ sơ hợp lệ"
  function readRow(tr) {
    const c = tr.cells;
    if (!c || c.length < 6) return null;
    const lines = el => (el ? el.innerText : '').split('\n').map(norm).filter(Boolean);
    const id = lines(c[1]);           // [Mã LK, HỌ TÊN]
    const hs = norm(c[2] && c[2].innerText);
    const kh = lines(c[3]);           // [mã..., Khoa ...]
    const maLK = id[0] || '';
    if (!/^\d+\/\d{4}_\d+_/.test(maLK)) return null;
    const p = maLK.split('_');
    const ngayRa = (hs.match(/Ngày ra:\s*(\d{2}\/\d{2}\/\d{4}(?:\s+\d{2}:\d{2})?)/i) || [])[1] || '';
    return {
      id: maLK,
      maLK,
      soPhieu: p[0],                 // VD 53008/2026
      maBN: p[1],                    // Mã y tế / Mã bệnh nhân
      name: id[1] || '',
      maHSBA: (hs.match(/Mã HSBA:\s*([\d/]+)/i) || [])[1] || '',
      ngayRa,
      khoa: kh.find(x => /^Khoa|^Phòng/i.test(x)) || kh[kh.length - 1] || '',
      loai: norm(c[4] && c[4].innerText),   // Nội trú / Ngoại trú / Điều trị nội trú ban ngày
      checked: !!(c[0] && c[0].querySelector('input[type="checkbox"]:checked')),
      gd: 'pending', gdNote: '', his: 'pending', hisNote: ''
    };
  }

  function readList() {
    return Array.from(document.querySelectorAll('tbody tr')).map(readRow).filter(Boolean);
  }

  function buildUi() {
    if (document.getElementById('bhyt-rs-cx')) return;
    const box = document.createElement('div');
    box.id = 'bhyt-rs-cx';
    box.innerHTML = `
      <div class="rs-h">🔁 Đồng bộ lại hồ sơ (B1 lấy DS · B5 xác nhận đẩy)</div>
      <div class="rs-b">
        <div>Lấy các hồ sơ đang hiện trong bảng (nếu có tích chọn thì chỉ lấy hồ sơ được tích) để:
          <b>B2</b> xóa hồ sơ cũ trên cổng gdbhyt → <b>B3</b> hủy ký + ký lại "01. XML … BHXH 4750" trên HIS.</div>
        <button type="button" class="rs-get">📥 Lấy danh sách</button>
        <button type="button" class="rs-view">📋 Xem DS đang chờ</button>
        <button type="button" class="rs-push" title="B5: tích các HS đã lên cổng (B4) rồi bấm 'Xác nhận Đẩy cổng' của checkxml">✅ Xác nhận đẩy HS đã lên cổng (B5)</button>
        <div class="rs-out"></div>
      </div>`;
    document.body.appendChild(box);
    const out = box.querySelector('.rs-out');
    const show = q => {
      if (!q || !q.length) { out.textContent = 'Chưa có danh sách.'; return; }
      const st = s => ({ pending: '⏳', deleted: '🗑', absent: '📤', paid: '💰', done: '✅', error: '❌', notfound: '❔', ambiguous: '⚠', skip: '⏭' }[s] || s);
      const up = x => x.pushed ? '📮' : ({ up: '☁', upbad: '⚠', notup: '⏳' }[x.up] || '·');
      out.innerHTML = `<div><b>${q.length}</b> hồ sơ (cột: gdbhyt | HIS | lên cổng/đã xác nhận đẩy)</div>` + q.map(x =>
        `<div>${st(x.gd)} ${st(x.his)} ${up(x)} <b>${esc(x.name)}</b> · ${esc(x.maHSBA)} · ${esc(x.loai)} · ra ${esc(x.ngayRa)}${x.gdNote || x.hisNote ? ` <i>${esc([x.gdNote, x.hisNote].filter(Boolean).join(' | '))}</i>` : ''}</div>`).join('');
    };
    box.querySelector('.rs-get').addEventListener('click', () => {
      const all = readList();
      const sel = all.filter(x => x.checked);
      const list = sel.length ? sel : all;
      if (!list.length) { alert('Không đọc được hồ sơ nào trong bảng.'); return; }
      if (!confirm(`Lấy ${list.length} hồ sơ${sel.length ? ' (đã tích)' : ' (tất cả đang hiện)'} để đồng bộ lại?\n\nHồ sơ đã có trong danh sách cũ được GIỮ trạng thái (đã xóa trên cổng / đã ký lại...).`)) return;
      list.forEach(x => { delete x.checked; });
      chrome.storage.local.get(KEY, d => {
        const old = new Map((d[KEY] || []).map(x => [x.id, x]));
        const merged = list.map(x => {
          const o = old.get(x.id);
          return o ? { ...x, gd: o.gd, gdNote: o.gdNote, his: o.his, hisNote: o.hisNote } : x;
        });
        const kept = merged.filter(x => old.has(x.id)).length;
        chrome.storage.local.set({ [KEY]: merged, bhytResyncAt: Date.now() }, () => {
          show(merged);
          out.insertAdjacentHTML('afterbegin', `<div style="color:#6a1b9a">${merged.length - kept} HS mới, ${kept} HS giữ trạng thái cũ.</div>`);
        });
      });
    });
    box.querySelector('.rs-view').addEventListener('click', () => chrome.storage.local.get(KEY, d => show(d[KEY])));

    // Đối chiếu sau khi trang tải lại: HS "đang xác nhận đẩy" mà không còn ở dòng chờ (hoặc đã data-synced=true) -> 📮 đã đẩy
    chrome.storage.local.get(KEY, d => {
      const q = d[KEY] || [];
      const tries = q.filter(x => x.pushTry && !x.pushed && Date.now() - x.pushTry < 3600000);
      if (!tries.length) return;
      const cbs = new Map(Array.from(document.querySelectorAll('input.record-checkbox')).map(c => [c.value, c]));
      if (!cbs.size) return; // bảng chưa có dữ liệu -> không kết luận
      let n = 0;
      tries.forEach(x => {
        const c = cbs.get(x.maLK);
        if (!c || c.getAttribute('data-synced') === 'true') { x.pushed = true; n++; }
      });
      if (n) chrome.storage.local.set({ [KEY]: q }, () => { show(q); out.insertAdjacentHTML('afterbegin', `<div style="color:#1d6f42;font-weight:bold">📮 ${n} HS đã xác nhận đẩy cổng.</div>`); });
    });

    // ---- B5: Xác nhận đẩy trên checkxml cho HS đã lên cổng (☁, B4) và HS đã đề nghị thanh toán (💰, đã có trên cổng) ----
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const shownEl = el => !!el && !!(el.offsetWidth || el.offsetHeight);
    box.querySelector('.rs-push').addEventListener('click', () => chrome.storage.local.get(KEY, async d => {
      const q = d[KEY] || [];
      const ok = q.filter(x => !x.pushed && (x.up === 'up' || x.gd === 'paid'));
      if (!ok.length) { out.textContent = 'Chưa có HS nào đã lên cổng để xác nhận (chạy B4 "Kiểm tra HS đã lên cổng" trên gdbhyt trước).'; return; }
      const cbs = Array.from(document.querySelectorAll('input.record-checkbox'));
      const byLk = new Map(cbs.map(c => [c.value, c]));
      const found = ok.filter(x => byLk.has(x.maLK));
      const missing = ok.filter(x => !byLk.has(x.maLK));
      if (!found.length) { out.textContent = `${ok.length} HS đã lên cổng nhưng không có trong bảng đang hiện (kiểm tra bộ lọc ngày / tab "Chờ đẩy cổng").`; return; }
      if (!confirm(`Xác nhận ĐẨY CỔNG trên checkxml cho ${found.length} hồ sơ:\n\n${found.slice(0, 20).map(x => `- ${x.name} (${x.gd === 'paid' ? 'đã ĐNTT' : 'đã lên cổng'})`).join('\n')}${found.length > 20 ? '\n...' : ''}` +
        (missing.length ? `\n\n(${missing.length} HS không có trong bảng đang hiện -> bỏ qua)` : '') + '\n\nTiếp tục?')) return;
      // Chỉ tích đúng các HS này
      cbs.forEach(c => { const want = found.some(x => x.maLK === c.value); if (c.checked !== want) c.click(); });
      await sleep(400);
      const bulk = document.getElementById('btnBulkSync');
      if (!bulk) { out.textContent = 'Không thấy nút "Xác nhận Đẩy cổng".'; return; }
      bulk.click();
      // Hộp hỏi "Đẩy cổng hàng loạt" (SweetAlert) -> Đồng ý
      let yes = null;
      for (let i = 0; i < 40 && !yes; i++) { await sleep(150); yes = Array.from(document.querySelectorAll('.swal2-confirm')).find(shownEl); }
      if (!yes) { out.textContent = 'Không thấy hộp "Đẩy cổng hàng loạt" để bấm Đồng ý.'; return; }
      // Ghi "đang xác nhận đẩy" trước (trang có thể tự tải lại sau khi đẩy -> lúc mở lại sẽ đối chiếu)
      found.forEach(x => { x.pushTry = Date.now(); });
      await new Promise(r => chrome.storage.local.set({ [KEY]: q }, r));
      yes.click();
      // Chờ kết quả (hộp thông báo kết quả / trang tải lại)
      let msg = '';
      for (let i = 0; i < 100; i++) {
        await sleep(200);
        const t = Array.from(document.querySelectorAll('.swal2-popup')).find(shownEl);
        if (t && !Array.from(t.querySelectorAll('.swal2-confirm')).some(b => /Đồng ý \(/.test(b.textContent))) {
          msg = (t.innerText || '').replace(/\s+/g, ' ').trim();
          if (msg) { const b = t.querySelector('.swal2-confirm'); if (b && shownEl(b)) b.click(); break; }
        }
      }
      const fail = /lỗi|thất bại|error/i.test(msg);
      if (!fail) found.forEach(x => { x.pushed = true; });
      chrome.storage.local.set({ [KEY]: q }, () => {
        show(q);
        out.insertAdjacentHTML('afterbegin', `<div style="color:${fail ? '#c62828' : '#1d6f42'};font-weight:bold">B5: ${fail ? '❌' : '📮'} ${esc(msg || 'Đã gửi yêu cầu xác nhận đẩy')} (${found.length} HS)</div>`);
      });
    }));
  }

  const style = document.createElement('style');
  style.textContent = `
    #bhyt-rs-cx { position: fixed; right: 12px; bottom: 12px; z-index: 2147483000; width: 420px; max-height: 70vh; display: flex; flex-direction: column;
      background: #fff; border: 1px solid #6a1b9a; border-radius: 6px; font: 12px Arial; box-shadow: 0 4px 16px rgba(0,0,0,.3); }
    #bhyt-rs-cx .rs-h { background: #6a1b9a; color: #fff; padding: 6px 10px; font-weight: bold; border-radius: 5px 5px 0 0; cursor: pointer; }
    #bhyt-rs-cx .rs-b { padding: 8px 10px; overflow: auto; }
    #bhyt-rs-cx button { margin: 6px 6px 0 0; padding: 4px 10px; font: bold 12px Arial; border-radius: 4px; border: 1px solid #6a1b9a; background: #f3e5f5; cursor: pointer; }
    #bhyt-rs-cx .rs-out { margin-top: 6px; max-height: 40vh; overflow: auto; }
    #bhyt-rs-cx .rs-out i { color: #888; }
    #bhyt-rs-cx.min .rs-b { display: none; }`;
  document.head.appendChild(style);
  const t = setInterval(() => {
    if (document.querySelector('tbody tr')) { buildUi(); clearInterval(t);
      document.querySelector('#bhyt-rs-cx .rs-h').addEventListener('click', () => document.getElementById('bhyt-rs-cx').classList.toggle('min')); }
  }, 1000);
})();
