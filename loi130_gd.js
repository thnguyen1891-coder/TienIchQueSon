// Cổng gdbhyt "Kết quả gửi hồ sơ QĐ 3176" (DanhSachKetQuaGuiHoSoQD130) - MAIN world. CHỈ ĐỌC.
// Nút "Quét hồ sơ lỗi + Excel": tìm theo Từ ngày - Đến ngày đang chọn, lọc các mã giao dịch có "Tổng số hồ sơ gửi lỗi" > 0,
// đọc chi tiết lỗi từng mã (giống bấm vào số lỗi), ghép họ tên từ log HIS (nếu đã "Lưu log mã giao dịch"), xuất Excel.
(function () {
  if (window.top !== window || window.__bhytLoi130) return;
  window.__bhytLoi130 = true;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const txt = el => (el ? el.textContent : '').replace(/\s+/g, ' ').trim();
  let running = false, stop = false, last = [];

  let reqId = 0;
  const bridge = (op, key, value, ms = 8000) => new Promise(resolve => {
    const id = 'l1' + (++reqId) + '_' + Date.now();
    const on = e => {
      const d = e.data;
      if (e.source !== window || !d || d.__bhytRsRes !== true || d.id !== id) return;
      window.removeEventListener('message', on); clearTimeout(t); resolve(d.res || {});
    };
    const t = setTimeout(() => { window.removeEventListener('message', on); resolve({ error: 'Hết thời gian' }); }, ms);
    window.addEventListener('message', on);
    window.postMessage({ __bhytRsReq: true, id, op, key, value }, '*');
  });

  const gv = () => window.gvDSKetQuaGuiHoso;
  async function waitGrid() {
    await sleep(400);
    for (let i = 0; i < 240; i++) { const g = gv(); if (g && !g.InCallback()) { await sleep(250); if (!g.InCallback()) return true; } await sleep(250); }
    return false;
  }
  const dataRows = root => Array.from(root.querySelectorAll('tr[id*="DXDataRow"]'));

  // Chi tiết lỗi 1 mã giao dịch (giống bấm vào số "Tổng số hồ sơ gửi lỗi")
  async function detail(maGd) {
    const html = await window.jQuery.ajax({ url: '/DanhSachKetQuaGuiHoSoQD130/RenderPopupHosoLoi', data: { maGd }, type: 'post' });
    const d = document.createElement('div');
    d.innerHTML = html;
    const mieuTa = ((d.innerText || d.textContent).match(/MI[ÊE]U T[ẢA]:?\s*([^\n]+)/i) || [])[1] || '';
    const rows = dataRows(d).map(tr => {
      const c = tr.cells;
      return { maLK: txt(c[1]), tg: txt(c[2]), maLoi: txt(c[3]), moTa: txt(c[4]) };
    }).filter(r => r.maLK || r.moTa);
    const more = /Page \d+ of (\d+)/.exec(d.innerText || '');
    return { mieuTa: mieuTa.trim(), rows, more: more && +more[1] > 1 };
  }

  async function scan(ui) {
    running = true; stop = false; ui.busy(true); last = [];
    try {
      const g = gv();
      ui.status('Đang tìm kiếm...');
      g.ClearFilter && g.ClearFilter();
      window.btnTimKiem.DoClick();
      if (!await waitGrid()) throw new Error('Cổng tải danh sách quá lâu');
      g.ApplyFilter('[SL_LOI] > 0');
      if (!await waitGrid()) throw new Error('Cổng lọc quá lâu');
      const pages = g.GetPageCount();
      const list = [];
      for (let p = 0; p < pages && !stop; p++) {
        if (p > 0) { g.GotoPage(p); await waitGrid(); }
        ui.status(`Đọc danh sách mã lỗi: trang ${p + 1}/${pages}`);
        dataRows(document.getElementById('gvDSKetQuaGuiHoso')).forEach(tr => {
          const c = tr.cells;
          const ma = txt(c[1]);
          if (ma && Number(txt(c[5])) > 0) list.push({ maGd: ma, tg: txt(c[2]), loai: txt(c[3]), slLoi: Number(txt(c[5])) });
        });
      }
      if (pages > 1) { g.GotoPage(0); await waitGrid(); }
      ui.log(`Có ${list.length} mã giao dịch có hồ sơ lỗi. Đọc chi tiết...`);
      const logMap = (((await bridge('kget', 'bhytLog130')) || {}).value || {}).map || {};
      const byBN = {};
      Object.values(logMap).forEach(v => { if (v.maBN) byBN[v.maBN] = v; });
      for (let i = 0; i < list.length && !stop; i++) {
        const x = list[i];
        ui.status(`Chi tiết lỗi ${i + 1}/${list.length}: ${x.maGd}`);
        try {
          const d = await detail(x.maGd);
          const errs = d.rows.length ? d.rows : [{ maLK: '', tg: '', maLoi: '', moTa: d.mieuTa }];
          errs.forEach(r => {
            const p = (r.maLK || '').split('_');
            const bn = logMap[x.maGd] || byBN[p[1]] || {};
            last.push({ maGd: x.maGd, tgGui: x.tg, ten: bn.ten || '', maBN: bn.maBN || p[1] || '', soPhieu: bn.soPhieu || p[0] || '', loaiKcb: bn.loai || (p[2] || ''), maLK: r.maLK, maLoi: r.maLoi, moTa: r.moTa, them: d.more ? 'Có hơn 10 lỗi - xem thêm trên cổng' : '' });
          });
        } catch (e) { last.push({ maGd: x.maGd, tgGui: x.tg, moTa: 'Không đọc được chi tiết: ' + (e.statusText || e.message || e) }); }
        await sleep(150);
      }
      // Tra KHOA (và họ tên nếu thiếu) trên checkxml theo Mã liên kết
      const lks = [...new Set(last.map(r => r.maLK).filter(Boolean))];
      let cxErr = '';
      for (let i = 0; i < lks.length && !stop; i += 12) {
        ui.status(`Tra khoa trên checkxml: ${Math.min(i + 12, lks.length)}/${lks.length}`);
        const r = await bridge('cxKhoa', null, lks.slice(i, i + 12), 90000);
        if (!r || r.error || !r.map) { cxErr = (r && (r.error || r.message)) || 'không có phản hồi'; break; }
        last.forEach(x => {
          const k = r.map[x.maLK];
          if (!k) return;
          if (k.err && !cxErr) cxErr = k.err;
          x.maKhoa = k.maKhoa || ''; x.khoa = k.khoa || '';
          if (!x.ten && k.ten) x.ten = k.ten;
        });
      }
      const noKhoa = last.filter(r => r.maLK && !r.khoa).length;
      if (noKhoa) ui.log(`⚠ ${noKhoa} dòng chưa tra được khoa${cxErr ? ' (' + cxErr + ')' : ''} - kiểm tra đã đăng nhập checkxml.com.vn chưa.`);
      const nHs = new Set(last.map(r => r.maLK || r.maGd)).size;
      const noName = last.filter(r => !r.ten).length;
      ui.log(`—— ${list.length} mã giao dịch lỗi, ${nHs} hồ sơ, ${last.length} dòng lỗi.` +
        (noName ? `\n⚠ ${noName} dòng chưa có họ tên: vào HIS "Log đẩy dữ liệu ... công văn 130" chọn cùng khoảng ngày, bấm "📥 Lưu log mã giao dịch" rồi quét lại.` : ''));
      ui.render(last);
    } catch (e) { ui.log('❌ ' + (e.message || e)); }
    finally { running = false; ui.busy(false); ui.status(''); }
  }

  function exportCsv() {
    if (!last.length) { alert('Chưa có dữ liệu - bấm "Quét hồ sơ lỗi" trước.'); return; }
    const cell = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const tu = window.dt_TuNgay && window.dt_TuNgay.GetText ? window.dt_TuNgay.GetText() : '';
    const den = window.dt_DenNgay && window.dt_DenNgay.GetText ? window.dt_DenNgay.GetText() : '';
    const lines = [[`HỒ SƠ GỬI LỖI LÊN CỔNG BHXH (QĐ 3176) ${tu} - ${den}`], [],
      ['STT', 'Khoa', 'Mã khoa', 'Họ tên', 'Mã BN', 'Số phiếu', 'Loại KCB', 'Mã liên kết', 'Mã lỗi', 'Mô tả lỗi', 'Mã giao dịch', 'Thời gian gửi', 'Ghi chú'],
      // sắp xếp theo khoa cho dễ chia việc
      ...last.slice().sort((a, b) => String(a.khoa || '~').localeCompare(String(b.khoa || '~'), 'vi') || String(a.maLK).localeCompare(String(b.maLK)))
        .map((r, i) => [i + 1, r.khoa, r.maKhoa, r.ten, r.maBN, r.soPhieu, r.loaiKcb, r.maLK, r.maLoi, r.moTa, r.maGd, r.tgGui, r.them])];
    const csv = '﻿' + lines.map(r => r.map(cell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `HoSoLoi_Cong_${(tu || '').replace(/\//g, '-')}_${(den || '').replace(/\//g, '-')}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function buildUi() {
    if (document.getElementById('bhyt-loi130')) return;
    const box = document.createElement('div');
    box.id = 'bhyt-loi130';
    box.innerHTML = `
      <div class="l-h">🔎 Hồ sơ gửi lỗi lên cổng (chỉ đọc)</div>
      <div class="l-b">
        <div>Chọn <b>Từ ngày - Đến ngày</b> trên trang rồi bấm Quét. Tool lọc các mã có <b>Tổng số hồ sơ gửi lỗi &gt; 0</b>, đọc chi tiết từng lỗi và ghép họ tên từ log HIS.</div>
        <button type="button" class="l-go">🔎 Quét hồ sơ lỗi</button>
        <button type="button" class="l-xls" disabled>⬇ Xuất Excel</button>
        <button type="button" class="l-stop" disabled>Dừng</button>
        <div class="l-st"></div><div class="l-log"></div><div class="l-tbl"></div>
      </div>`;
    document.body.appendChild(box);
    const q = s => box.querySelector(s);
    const ui = {
      log: m => { const d = document.createElement('div'); d.textContent = m; q('.l-log').appendChild(d); },
      status: m => { q('.l-st').textContent = m; },
      busy: on => { q('.l-go').disabled = on; q('.l-stop').disabled = !on; if (on) q('.l-xls').disabled = true; },
      render: rows => {
        q('.l-xls').disabled = !rows.length;
        // Tóm tắt theo khoa + bảng chi tiết
        const byK = {};
        rows.forEach(r => { const k = r.khoa || '(chưa rõ khoa)'; (byK[k] = byK[k] || new Set()).add(r.maLK || r.maGd); });
        const sumK = Object.keys(byK).sort((a, b) => byK[b].size - byK[a].size).map(k => `<tr><td>${esc(k)}</td><td>${byK[k].size}</td></tr>`).join('');
        q('.l-tbl').innerHTML = rows.length ? `<table><tr><th>Khoa</th><th>Số HS lỗi</th></tr>${sumK}</table>
          <table><tr><th>#</th><th>Khoa</th><th>Họ tên</th><th>Số phiếu</th><th>Mã lỗi</th><th>Mô tả lỗi</th></tr>${rows.map((r, i) =>
          `<tr><td>${i + 1}</td><td>${esc(r.khoa || r.maKhoa)}</td><td>${esc(r.ten || r.maBN)}</td><td>${esc(r.soPhieu)}</td><td>${esc(r.maLoi)}</td><td>${esc(r.moTa)}</td></tr>`).join('')}</table>` : '';
      }
    };
    q('.l-h').addEventListener('click', () => box.classList.toggle('min'));
    q('.l-stop').addEventListener('click', () => { stop = true; });
    q('.l-xls').addEventListener('click', exportCsv);
    q('.l-go').addEventListener('click', () => { if (!running) { q('.l-log').innerHTML = ''; q('.l-tbl').innerHTML = ''; scan(ui); } });
  }

  const style = document.createElement('style');
  style.textContent = `
    #bhyt-loi130 { position: fixed; right: 12px; bottom: 12px; z-index: 2147483000; width: 560px; max-height: 75vh; display: flex; flex-direction: column;
      background: #fff; border: 1px solid #c62828; border-radius: 6px; font: 12px Arial; box-shadow: 0 4px 16px rgba(0,0,0,.3); }
    #bhyt-loi130 .l-h { background: #c62828; color: #fff; padding: 6px 10px; font-weight: bold; border-radius: 5px 5px 0 0; cursor: pointer; }
    #bhyt-loi130 .l-b { padding: 8px 10px; overflow: auto; }
    #bhyt-loi130 button { margin: 6px 6px 0 0; padding: 4px 10px; font: bold 12px Arial; border-radius: 4px; border: 1px solid #c62828; background: #ffebee; cursor: pointer; }
    #bhyt-loi130 .l-xls { background: #1d6f42; color: #fff; border-color: #145a32; }
    #bhyt-loi130 button:disabled { opacity: .5; }
    #bhyt-loi130 .l-st { margin-top: 6px; font-weight: bold; color: #c62828; }
    #bhyt-loi130 .l-log { font: 11px Consolas, monospace; white-space: pre-wrap; }
    #bhyt-loi130 table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    #bhyt-loi130 th, #bhyt-loi130 td { border: 1px solid #ddd; padding: 2px 4px; vertical-align: top; text-align: left; }
    #bhyt-loi130 th { background: #ffebee; }
    #bhyt-loi130.min .l-b { display: none; }`;
  document.head.appendChild(style);
  const t = setInterval(() => { if (window.gvDSKetQuaGuiHoso && window.btnTimKiem) { buildUi(); clearInterval(t); } }, 1000);
})();
