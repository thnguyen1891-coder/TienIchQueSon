// ĐỒNG BỘ LẠI HỒ SƠ - BƯỚC 2 (gdbhyt.baohiemxahoi.gov.vn/DanhSachHSKCB): XÓA hồ sơ cũ trên cổng giám định.
// Chạy trong MAIN world (điều khiển lưới DevExpress gvDanhSachHoSo của cổng).
// Chỉ xóa hồ sơ khớp ĐÚNG Họ tên + Ngày ra + Loại KCB với danh sách lấy từ checkxml;
// không thấy hoặc thấy từ 2 hồ sơ khớp -> KHÔNG xóa, ghi lại để xử lý tay.
(function () {
  if (window.top !== window || window.__bhytRsGd) return;
  window.__bhytRsGd = true;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const norm = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim().toUpperCase();
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let running = false, stop = false;

  // ---- Danh sách chung (qua resync_bridge.js) ----
  let reqId = 0;
  function bridge(op, queue) {
    return new Promise((resolve, reject) => {
      const id = 'rs' + (++reqId) + '_' + Date.now();
      const on = e => {
        const d = e.data;
        if (e.source !== window || !d || d.__bhytRsRes !== true || d.id !== id) return;
        window.removeEventListener('message', on); clearTimeout(t);
        d.res && d.res.error ? reject(new Error(d.res.error)) : resolve(d.res);
      };
      const t = setTimeout(() => { window.removeEventListener('message', on); reject(new Error('Không đọc được danh sách (tải lại trang F5)')); }, 8000);
      window.addEventListener('message', on);
      window.postMessage({ __bhytRsReq: true, id, op, queue }, '*');
    });
  }
  const getQueue = async () => (await bridge('get')).queue || [];
  // Tóm tắt danh sách theo trạng thái trên cổng
  const ICON = { pending: '⏳ chờ', deleted: '🗑 đã xóa', absent: '📤 không có trên cổng', paid: '💰 đã ĐNTT', notfound: '❔ không thấy', ambiguous: '⚠ nhiều HS khớp', error: '❌ lỗi' };
  const summary = q => {
    const c = {};
    q.forEach(x => { c[x.gd] = (c[x.gd] || 0) + 1; });
    return `Danh sách có ${q.length} HS: ` + Object.keys(c).map(k => `${ICON[k] || k} ${c[k]}`).join(' | ');
  };
  const NOTHING = q => q.length
    ? `${summary(q)}\n-> Không còn HS nào cần xóa (đã xử lý hết). Muốn tìm lại trên cổng các HS chưa xóa, bấm "🔄 Tìm lại HS chưa xóa".`
    : 'Danh sách trống: sang checkxml bấm "📥 Lấy danh sách" trước (cần F5 trang này nếu vừa tải lại tiện ích).';
  const saveQueue = q => bridge('set', q);

  // ---- Điều khiển cổng ----
  const gv = () => window.gvDanhSachHoSo;
  async function waitGrid(timeout = 60000) {
    await sleep(300);
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const g = gv();
      if (g && !(g.InCallback && g.InCallback())) { await sleep(300); if (!(g.InCallback && g.InCallback())) return true; }
      await sleep(250);
    }
    return false;
  }
  function selectComboText(name, re) {
    const c = window[name];
    if (!c) return false;
    for (let i = 0; i < c.GetItemCount(); i++) {
      if (re.test(String(c.GetItem(i).text).trim())) { c.SetSelectedIndex(i); return true; }
    }
    return false;
  }
  function findSearchButton() {
    for (const k of Object.keys(window)) {
      let o; try { o = window[k]; } catch (_) { continue; }
      try { if (o && typeof o.DoClick === 'function' && typeof o.GetText === 'function' && /^Tìm kiếm$/i.test(String(o.GetText()).trim())) return o; } catch (_) {}
    }
    return null;
  }
  // Tìm theo kỳ quyết toán = tháng của ngày ra; mọi trạng thái, mọi loại KCB
  let curKy = '';
  // tt: "Chưa đề nghị thanh toán" (tìm để XÓA) hoặc "Đã đề nghị thanh toán" (chỉ để kiểm tra, KHÔNG xóa)
  async function searchMonth(mm, yyyy, tt = 'Chưa đề nghị thanh toán', hs = 'Hồ sơ đúng') {
    const ky = mm + '/' + yyyy + '|' + tt + '|' + hs;
    if (curKy === ky) return;
    selectComboText('cb_LoaiKCB', /^Tất cả$/i);
    // Trạng thái HS (mặc định "Hồ sơ đúng"); Trạng thái TT theo tham số
    if (!selectComboText('cb_TrangThaiHS', new RegExp('^' + hs + '$', 'i'))) throw new Error(`Không chọn được Trạng thái HS "${hs}"`);
    if (!selectComboText('cb_TrangThaiTT', new RegExp('^' + tt + '$', 'i'))) throw new Error(`Không chọn được Trạng thái TT "${tt}"`);
    selectComboText('cbx_thoigian', /^Tháng$/i);
    selectComboText('cbx_thang', new RegExp('^' + Number(mm) + '$'));
    selectComboText('cbx_nam', new RegExp('^' + yyyy + '$'));
    const b = findSearchButton();
    if (!b) throw new Error('Không thấy nút "Tìm kiếm" của cổng');
    b.DoClick();
    if (!await waitGrid()) throw new Error('Cổng tải danh sách quá lâu');
    curKy = ky;
  }
  async function filterName(name) {
    gv().AutoFilterByColumn('HO_TEN', name || '');
    if (!await waitGrid()) throw new Error('Cổng lọc theo họ tên quá lâu');
  }
  function headerIndex(text) {
    const root = document.getElementById('gvDanhSachHoSo');
    const ths = Array.from(root.querySelectorAll('tr[id*="DXHeadersRow"] td[id*="col"]'));
    return ths.findIndex(t => t.textContent.trim() === text);
  }
  function readRows() {
    const root = document.getElementById('gvDanhSachHoSo');
    const ix = { ten: headerIndex('Họ và tên'), ra: headerIndex('Ngày ra'), loai: headerIndex('Loại khám chữa bệnh'), mabn: headerIndex('Mã bệnh nhân'), xoa: headerIndex('Xóa'), gui: headerIndex('Ngày gửi hồ sơ'), tt: headerIndex('TT') };
    return Array.from(root.querySelectorAll('tr[class*="dxgvDataRow"]')).map(tr => {
      const c = tr.cells, tx = i => (i >= 0 && c[i] ? c[i].textContent.trim() : '');
      return { tr, ten: tx(ix.ten), ra: tx(ix.ra), loai: tx(ix.loai), mabn: tx(ix.mabn), gui: tx(ix.gui), del: ix.xoa >= 0 && c[ix.xoa] ? c[ix.xoa].querySelector('img[onclick*="XoaHS"]') : null };
    });
  }
  // Loại KCB checkxml -> chữ trên cổng
  function loaiMatch(cx, gd) {
    const a = norm(cx), b = norm(gd);
    if (/BAN NGÀY/.test(a)) return /BAN NGÀY|ĐIỀU TRỊ BN/.test(b);
    if (/NỘI TRÚ/.test(a)) return /NỘI TRÚ|ĐIỀU TRỊ NT/.test(b) && !/BAN NGÀY|ĐIỀU TRỊ BN/.test(b);
    if (/NGOẠI TRÚ|KHÁM/.test(a)) return /KHÁM BỆNH/.test(b); // "Ngoại trú" (checkxml) = "Khám bệnh" (cổng)
    return a === b;
  }
  function raMatch(cx, gd) {
    const a = String(cx || '').trim(), b = String(gd || '').trim();
    if (!a || !b) return false;
    return a.length >= 16 && b.length >= 16 ? a.slice(0, 16) === b.slice(0, 16) : a.slice(0, 10) === b.slice(0, 10);
  }
  function popupVisible(name) { const p = window[name]; try { return !!(p && p.IsVisible && p.IsVisible()); } catch (_) { return false; } }
  const shown = el => !!el && !!(el.offsetWidth || el.offsetHeight) && getComputedStyle(el).visibility !== 'hidden';
  // Khung (cửa sổ) đang hiện của popup DevExpress: GetMainElement() của cổng trả về null -> tìm theo cửa sổ / theo chữ
  function popupWindow(name, textRe) {
    const p = window[name];
    const cands = [];
    try { if (p && p.GetWindowElement) cands.push(p.GetWindowElement(-1)); } catch (_) {}
    try { if (p && p.GetMainElement) cands.push(p.GetMainElement()); } catch (_) {}
    cands.push(document.getElementById(name + '_PW-1'), document.getElementById(name + '_PW'));
    const hit = cands.find(el => shown(el));
    if (hit) return hit;
    // Dự phòng: khối đang hiện chứa đúng câu hỏi
    const msg = Array.from(document.querySelectorAll('body *')).find(el => el.children.length === 0 && textRe.test(el.textContent || '') && shown(el) && !el.closest('#bhyt-rs-gd'));
    for (let el = msg && msg.parentElement, i = 0; el && i < 10; el = el.parentElement, i++) {
      if (/^Có$/m.test(el.innerText || '') || el.querySelector('img[src*="close"], .dxpc-closeBtn')) {
        if (Array.from(el.querySelectorAll('*')).some(x => /^Có$/.test((x.value || x.textContent || '').trim()))) return el;
      }
    }
    return null;
  }
  async function deleteRow(row) {
    row.del.click();
    const t0 = Date.now();
    let pop = null;
    while (Date.now() - t0 < 6000) {
      pop = popupWindow('PopupThongBaoXoa', /muốn xóa hay không/i);
      if (pop) break;
      await sleep(150);
    }
    if (!pop) throw new Error('Cổng không hiện hộp hỏi xóa');
    // Ưu tiên nút DevExpress (client object) có chữ "Có" nằm trong hộp hỏi xóa
    let btnObj = null;
    for (const k of Object.keys(window)) {
      let o; try { o = window[k]; } catch (_) { continue; }
      try {
        if (o && typeof o.DoClick === 'function' && typeof o.GetText === 'function' && /^Có$/.test(String(o.GetText()).trim())
          && o.GetMainElement && pop.contains(o.GetMainElement())) { btnObj = o; break; }
      } catch (_) {}
    }
    if (btnObj) btnObj.DoClick();
    else {
      const yes = Array.from(pop.querySelectorAll('input, button, div, span, a')).find(e => /^Có$/.test((e.value || e.textContent || '').trim()) && (e.offsetWidth || e.offsetHeight));
      if (!yes) throw new Error('Không thấy nút "Có" trong hộp hỏi xóa');
      (yes.closest('.dxbButton_EIS, button') || yes).click();
    }
    // Kết quả: popup_message "Xóa hồ sơ thành công/thất bại"
    const t1 = Date.now();
    let msg = '';
    while (Date.now() - t1 < 20000) {
      if (popupVisible('popup_message')) {
        const w = popupWindow('popup_message', /xóa hồ sơ|thành công|thất bại/i);
        msg = (w ? w.innerText : '').replace(/\s+/g, ' ').trim() || 'Đã xóa (cổng không ghi nội dung)';
        break;
      }
      if (!popupVisible('PopupThongBaoXoa') && Date.now() - t1 > 6000) break; // không có thông báo -> kiểm tra lại bằng lưới
      await sleep(200);
    }
    try { window.popup_message && window.popup_message.Hide(); } catch (_) {}
    await waitGrid();
    return msg;
  }

  // Đóng hộp hỏi xóa bằng nút "Không" (tránh để hộp mở, người dùng lỡ bấm "Có")
  function cancelDeletePopup() {
    if (!popupVisible('PopupThongBaoXoa')) return;
    const pop = popupWindow('PopupThongBaoXoa', /muốn xóa hay không/i);
    const no = pop && Array.from(pop.querySelectorAll('*')).find(e => /^Không$/.test((e.value || e.textContent || '').trim()) && shown(e));
    if (no) (no.closest('.dxbButton_EIS, button') || no).click();
    else { try { window.PopupThongBaoXoa.Hide(); } catch (_) {} }
  }

  async function run(dry, ui, limit = 0) {
    running = true; stop = false; ui.busy(true);
    let deletedNow = 0;
    let q;
    try { q = await getQueue(); } catch (e) { ui.log('❌ ' + e.message); running = false; ui.busy(false); return; }
    const todo = q.filter(x => x.gd === 'pending' || x.gd === 'error' || x.gd === 'notfound');
    if (!todo.length) { ui.log(NOTHING(q)); running = false; ui.busy(false); return; }
    ui.log(`${dry ? 'CHẠY THỬ (chỉ tìm, KHÔNG xóa)' : 'XÓA'} ${todo.length} hồ sơ...`);
    try {
      // Gom theo tháng ngày ra để mỗi tháng chỉ tìm 1 lần
      todo.sort((a, b) => a.ngayRa.slice(3, 10).localeCompare(b.ngayRa.slice(3, 10)));
      for (const x of todo) {
        if (stop) { ui.log('⛔ Đã dừng.'); break; }
        if (limit && deletedNow >= limit) { ui.log(`(Xóa thử: dừng sau ${limit} hồ sơ - kiểm tra trên cổng rồi bấm "Xóa trên cổng" để xóa tiếp)`); break; }
        const [dd, mm, yyyy] = (x.ngayRa.match(/(\d{2})\/(\d{2})\/(\d{4})/) || []).slice(1);
        if (!mm) { x.gd = 'error'; x.gdNote = 'Thiếu ngày ra'; continue; }
        ui.status(`${x.name} (${x.ngayRa})`);
        try {
          await searchMonth(mm, yyyy);
          await filterName(x.name);
          const rows = readRows();
          const hit = rows.filter(r => norm(r.ten) === norm(x.name) && raMatch(x.ngayRa, r.ra) && loaiMatch(x.loai, r.loai));
          if (hit.length !== 1) {
            x.gd = hit.length ? 'ambiguous' : 'notfound';
            x.gdNote = hit.length ? `Cổng có ${hit.length} hồ sơ khớp -> không xóa` : `Không thấy HS "Hồ sơ đúng - Chưa đề nghị TT" trên cổng (kỳ ${mm}/${yyyy}, ${rows.length} HS cùng tên)`;
            ui.log(`${hit.length ? '⚠' : '❔'} ${x.name}: ${x.gdNote}`);
          } else if (!hit[0].del) {
            x.gd = 'error'; x.gdNote = 'Hồ sơ không có nút Xóa (có thể đã đề nghị thanh toán)';
            ui.log(`❌ ${x.name}: ${x.gdNote}`);
          } else if (dry) {
            hit[0].tr.style.outline = '3px solid red';
            ui.log(`🔎 ${x.name}: tìm thấy đúng 1 hồ sơ (${hit[0].loai}, ra ${hit[0].ra}) - CHẠY THỬ, chưa xóa`);
            break; // chạy thử: dừng ở hồ sơ đầu tiên tìm thấy để bạn xem
          } else {
            const msg = await deleteRow(hit[0]);
            // Kiểm tra lại trên lưới: hồ sơ khớp còn không
            await filterName(''); await filterName(x.name);
            const still = readRows().filter(r => norm(r.ten) === norm(x.name) && raMatch(x.ngayRa, r.ra) && loaiMatch(x.loai, r.loai));
            if (!still.length) { x.gd = 'deleted'; x.gdNote = ''; deletedNow++; ui.log(`🗑 ${x.name}: đã xóa${msg ? ' - ' + msg : ''}`); }
            else { x.gd = 'error'; x.gdNote = 'Chưa xóa được' + (msg ? ': ' + msg : ''); ui.log(`❌ ${x.name}: ${x.gdNote}`); }
          }
        } catch (e) { cancelDeletePopup(); x.gd = 'error'; x.gdNote = e.message; ui.log(`❌ ${x.name}: ${e.message}`); }
        if (!dry) await saveQueue(q);
      }

      // LƯỢT 2 (chỉ kiểm tra, KHÔNG xóa): hồ sơ không thấy ở "Chưa đề nghị TT" -> tìm ở "Đã đề nghị thanh toán"
      //  - có  -> 💰 đã đề nghị thanh toán: KHÔNG ký đẩy lại XML
      //  - không -> 📤 không có trên cổng: vẫn ký đẩy lại XML như bình thường
      const nf = dry ? [] : q.filter(x => x.gd === 'notfound');
      if (nf.length && !stop) ui.log(`Kiểm tra ${nf.length} HS không thấy ở mục "Đã đề nghị thanh toán"...`);
      for (const x of nf) {
        if (stop) break;
        const [, mm, yyyy] = (x.ngayRa.match(/(\d{2})\/(\d{2})\/(\d{4})/) || []);
        if (!mm) continue;
        ui.status(`Kiểm tra đã ĐNTT: ${x.name}`);
        try {
          await searchMonth(mm, yyyy, 'Đã đề nghị thanh toán');
          await filterName(x.name);
          const hit = readRows().filter(r => norm(r.ten) === norm(x.name) && raMatch(x.ngayRa, r.ra) && loaiMatch(x.loai, r.loai));
          if (hit.length) {
            x.gd = 'paid'; x.gdNote = 'Đã đề nghị thanh toán trên cổng -> không đẩy lại XML'; x.his = 'skip'; x.hisNote = '';
            ui.log(`💰 ${x.name}: ${x.gdNote}`);
          } else {
            x.gd = 'absent'; x.gdNote = 'Không có trên cổng -> ký đẩy lại XML';
            ui.log(`📤 ${x.name}: ${x.gdNote}`);
          }
        } catch (e) { ui.log(`❌ ${x.name}: kiểm tra đã ĐNTT lỗi - ${e.message}`); }
        await saveQueue(q);
      }

      try { await filterName(''); } catch (_) {}
      const n = s => q.filter(x => x.gd === s).length;
      const toHis = n('deleted') + n('absent');
      ui.log(`—— Cổng: 🗑 đã xóa ${n('deleted')} | 📤 không có trên cổng ${n('absent')} | 💰 đã ĐNTT (không đẩy lại) ${n('paid')} | ❔ không thấy ${n('notfound')} | ⚠ nhiều HS khớp ${n('ambiguous')} | ❌ lỗi ${n('error')}` +
        (toHis ? `\n→ ${toHis} HS cần ký lại XML 4750 trên HIS (B3): nội trú ở trang kiemtrabangkenoitru, ngoại trú ở trang kiemtrabangke.` : ''));
    } finally { running = false; ui.busy(false); ui.status(''); }
  }

  // ---- B4: kiểm tra hồ sơ đã ký lại (HIS) đã lên cổng chưa - CHỈ ĐỌC ----
  //  ✅ up    : có hồ sơ "Hồ sơ đúng - Chưa đề nghị TT" khớp (Họ tên + Ngày ra + Loại KCB)
  //  ⚠ upbad : có trên cổng nhưng ở trạng thái khác (lỗi / cảnh báo...) -> xem trên cổng
  //  ⏳ notup : chưa thấy -> chờ thêm rồi kiểm tra lại
  async function checkUp(ui) {
    running = true; stop = false; ui.busy(true);
    try {
      const q = await getQueue();
      const list = q.filter(x => x.his === 'done' && (x.gd === 'deleted' || x.gd === 'absent') && x.up !== 'up');
      if (!list.length) { ui.log(q.length ? `${summary(q)}\n-> Không có HS nào đã ký lại trên HIS mà chưa xác nhận lên cổng.` : NOTHING(q)); return; }
      ui.log(`Kiểm tra ${list.length} HS đã ký lại trên HIS...`);
      list.sort((a, b) => a.ngayRa.slice(3, 10).localeCompare(b.ngayRa.slice(3, 10)));
      for (const pass of ['ok', 'any']) {
        for (const x of list) {
          if (stop) break;
          if (pass === 'any' && x.up !== 'notup') continue;
          const [, mm, yyyy] = (x.ngayRa.match(/(\d{2})\/(\d{2})\/(\d{4})/) || []);
          if (!mm) continue;
          ui.status(`${pass === 'ok' ? 'Kiểm tra' : 'Tìm ở mọi trạng thái'}: ${x.name}`);
          try {
            if (pass === 'ok') await searchMonth(mm, yyyy, 'Chưa đề nghị thanh toán', 'Hồ sơ đúng');
            else await searchMonth(mm, yyyy, 'Tất cả', 'Tất cả');
            await filterName(x.name);
            const hit = readRows().filter(r => norm(r.ten) === norm(x.name) && raMatch(x.ngayRa, r.ra) && loaiMatch(x.loai, r.loai));
            if (pass === 'ok') {
              if (hit.length) { x.up = 'up'; x.upNote = `Đã lên cổng${hit[0].gui ? ' (gửi ' + hit[0].gui + ')' : ''}`; ui.log(`✅ ${x.name}: ${x.upNote}`); }
              else x.up = 'notup';
            } else if (hit.length) {
              x.up = 'upbad'; x.upNote = 'Có trên cổng nhưng KHÔNG ở "Hồ sơ đúng - Chưa đề nghị TT" -> xem trên cổng';
              ui.log(`⚠ ${x.name}: ${x.upNote}`);
            } else { x.upNote = 'Chưa thấy trên cổng -> chờ thêm rồi kiểm tra lại'; ui.log(`⏳ ${x.name}: ${x.upNote}`); }
          } catch (e) { ui.log(`❌ ${x.name}: ${e.message}`); }
          await saveQueue(q);
        }
      }
      try { await filterName(''); } catch (_) {}
      const n = s => list.filter(x => x.up === s).length;
      ui.log(`—— Lên cổng: ✅ ${n('up')} | ⚠ trạng thái khác ${n('upbad')} | ⏳ chưa thấy ${n('notup')}` +
        (n('up') ? '\n→ Sang checkxml bấm "✅ Xác nhận đẩy HS đã lên cổng" (B5).' : ''));
    } catch (e) { ui.log('❌ ' + e.message); }
    finally { running = false; ui.busy(false); ui.status(''); }
  }

  function buildUi() {
    if (document.getElementById('bhyt-rs-gd')) return;
    const box = document.createElement('div');
    box.id = 'bhyt-rs-gd';
    box.innerHTML = `
      <div class="rs-h">🔁 Đồng bộ lại hồ sơ (B2 xóa HS cũ · B4 kiểm tra đã lên cổng)</div>
      <div class="rs-b">
        <div>Xóa trên cổng các hồ sơ lấy từ checkxml, chỉ khi khớp đúng <b>Họ tên + Ngày ra + Loại KCB</b>. Tool tự đặt kỳ quyết toán = tháng ngày ra, Trạng thái HS <b>Hồ sơ đúng</b>, Trạng thái TT <b>Chưa đề nghị thanh toán</b>. Không thấy thì tìm ở <b>Đã đề nghị thanh toán</b>: có -> không đẩy lại XML; không có -> vẫn ký đẩy lại.</div>
        <button type="button" class="rs-dry">🔎 Chạy thử (chỉ tìm)</button>
        <button type="button" class="rs-one">🗑 Xóa thử 1 HS</button>
        <button type="button" class="rs-go">🗑 Xóa trên cổng</button>
        <button type="button" class="rs-stop" disabled>Dừng</button>
        <button type="button" class="rs-up" title="B4: hồ sơ đã ký lại trên HIS đã lên cổng chưa (chỉ đọc)">✅ Kiểm tra HS đã lên cổng (B4)</button>
        <button type="button" class="rs-list">📋 Xem DS</button>
        <button type="button" class="rs-reset" title="Đưa các HS 'không có trên cổng / đã ĐNTT / không thấy / lỗi' về trạng thái chờ để tìm lại trên cổng (HS đã xóa giữ nguyên)">🔄 Tìm lại HS chưa xóa</button>
        <div class="rs-st"></div><div class="rs-log"></div>
      </div>`;
    document.body.appendChild(box);
    const log = m => { const d = document.createElement('div'); d.textContent = m; box.querySelector('.rs-log').appendChild(d); box.querySelector('.rs-log').scrollTop = 1e9; };
    const ui = {
      log, status: m => { box.querySelector('.rs-st').textContent = m; },
      busy: on => { ['.rs-dry', '.rs-go', '.rs-one', '.rs-up', '.rs-reset'].forEach(s => { box.querySelector(s).disabled = on; }); box.querySelector('.rs-stop').disabled = !on; }
    };
    box.querySelector('.rs-up').addEventListener('click', () => { if (!running) { box.querySelector('.rs-log').innerHTML = ''; checkUp(ui); } });
    box.querySelector('.rs-list').addEventListener('click', async () => {
      let q; try { q = await getQueue(); } catch (e) { alert(e.message); return; }
      const lg = box.querySelector('.rs-log'); lg.innerHTML = '';
      ui.log(q.length ? summary(q) : NOTHING(q));
      const HIS = { done: '✅ đã ký lại', error: '❌ ký lại lỗi', skip: '⏭ không ký lại', pending: '⏳ chưa ký lại' };
      const UP = { up: '☁ đã lên cổng', upbad: '⚠ lên cổng (trạng thái khác)', notup: '⏳ chưa lên cổng' };
      q.forEach(x => ui.log(`${(ICON[x.gd] || x.gd).split(' ')[0]} ${x.name} · ${x.loai} · ra ${x.ngayRa}` +
        ` · HIS: ${HIS[x.his] || x.his}${x.up ? ' · ' + (UP[x.up] || x.up) : ''}${x.pushed ? ' · 📮 đã xác nhận đẩy' : ''}` +
        `${x.gdNote ? ' · ' + x.gdNote : ''}${x.hisNote ? ' · ' + x.hisNote : ''}`));
    });
    box.querySelector('.rs-reset').addEventListener('click', async () => {
      if (running) return;
      let q; try { q = await getQueue(); } catch (e) { alert(e.message); return; }
      const re = q.filter(x => ['absent', 'paid', 'notfound', 'ambiguous', 'error'].includes(x.gd) && x.his !== 'done');
      if (!re.length) { alert('Không có HS nào để tìm lại (HS đã xóa / đã ký lại xong giữ nguyên).'); return; }
      if (!confirm(`Đưa ${re.length} HS về trạng thái chờ để tìm lại trên cổng?\n(Chỉ tìm lại; vẫn chỉ xóa khi khớp đúng 1 hồ sơ.)`)) return;
      re.forEach(x => { x.gd = 'pending'; x.gdNote = ''; if (x.his === 'skip') x.his = 'pending'; });
      await saveQueue(q);
      box.querySelector('.rs-log').innerHTML = '';
      ui.log(`${re.length} HS đã về trạng thái chờ. ${summary(q)}`);
    });
    box.querySelector('.rs-one').addEventListener('click', async () => {
      if (running) return;
      let q; try { q = await getQueue(); } catch (e) { alert(e.message); return; }
      const x = q.find(y => y.gd === 'pending' || y.gd === 'error' || y.gd === 'notfound');
      if (!x) { box.querySelector('.rs-log').innerHTML = ''; ui.log(NOTHING(q)); return; }
      if (!confirm(`XÓA THỬ 1 hồ sơ trên cổng giám định (bắt đầu từ):\n- ${x.name} (${x.loai}, ra ${x.ngayRa})\n\nHồ sơ không khớp đúng 1 sẽ bỏ qua và thử hồ sơ kế tiếp; dừng sau khi xóa được 1 hồ sơ.\nXóa trên cổng KHÔNG hoàn tác được. Tiếp tục?`)) return;
      box.querySelector('.rs-log').innerHTML = '';
      run(false, ui, 1);
    });
    box.querySelector('.rs-h').addEventListener('click', () => box.classList.toggle('min'));
    box.querySelector('.rs-stop').addEventListener('click', () => { stop = true; });
    box.querySelector('.rs-dry').addEventListener('click', () => { if (!running) { box.querySelector('.rs-log').innerHTML = ''; run(true, ui); } });
    box.querySelector('.rs-go').addEventListener('click', async () => {
      if (running) return;
      let q; try { q = await getQueue(); } catch (e) { alert(e.message); return; }
      const todo = q.filter(x => x.gd === 'pending' || x.gd === 'error' || x.gd === 'notfound');
      if (!todo.length) { box.querySelector('.rs-log').innerHTML = ''; ui.log(NOTHING(q)); return; }
      if (!confirm(`XÓA trên cổng giám định BHYT tối đa ${todo.length} hồ sơ:\n\n${todo.slice(0, 15).map(x => `- ${x.name} (${x.loai}, ra ${x.ngayRa})`).join('\n')}${todo.length > 15 ? '\n...' : ''}\n\nXóa trên cổng KHÔNG hoàn tác được. Chỉ xóa hồ sơ khớp đúng 1 hồ sơ. Tiếp tục?`)) return;
      box.querySelector('.rs-log').innerHTML = '';
      run(false, ui);
    });
  }

  const style = document.createElement('style');
  style.textContent = `
    #bhyt-rs-gd { position: fixed; right: 12px; bottom: 12px; z-index: 2147483000; width: 440px; max-height: 70vh; display: flex; flex-direction: column;
      background: #fff; border: 1px solid #6a1b9a; border-radius: 6px; font: 12px Arial; box-shadow: 0 4px 16px rgba(0,0,0,.3); }
    #bhyt-rs-gd .rs-h { background: #6a1b9a; color: #fff; padding: 6px 10px; font-weight: bold; border-radius: 5px 5px 0 0; cursor: pointer; }
    #bhyt-rs-gd .rs-b { padding: 8px 10px; overflow: auto; }
    #bhyt-rs-gd button { margin: 6px 6px 0 0; padding: 4px 10px; font: bold 12px Arial; border-radius: 4px; border: 1px solid #6a1b9a; background: #f3e5f5; cursor: pointer; }
    #bhyt-rs-gd .rs-go { background: #c62828; color: #fff; border-color: #8e0000; }
    #bhyt-rs-gd .rs-one { background: #ffebee; border-color: #c62828; color: #c62828; }
    #bhyt-rs-gd button:disabled { opacity: .5; }
    #bhyt-rs-gd .rs-st { margin-top: 6px; font-weight: bold; color: #6a1b9a; }
    #bhyt-rs-gd .rs-log { margin-top: 4px; max-height: 35vh; overflow: auto; font: 11px Consolas, monospace; white-space: pre-wrap; }
    #bhyt-rs-gd.min .rs-b { display: none; }`;
  document.head.appendChild(style);
  const t = setInterval(() => { if (window.gvDanhSachHoSo) { buildUi(); clearInterval(t); } }, 1000);
  void esc;
})();
