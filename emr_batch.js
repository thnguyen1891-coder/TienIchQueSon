// ĐẨY EMR NHIỀU KHOA + CẤP SỐ LƯU TRỮ (trang "Đồng bộ hồ sơ bệnh án sang EMR" nội trú) - chạy trong MAIN world.
// HIS chỉ cho gửi / cấp số 1 khoa, tối đa 10 BN mỗi lần bấm. Công cụ này:
//  1) quét DS "sẵn sàng gửi EMR" của nhiều khoa (đúng API danh sách của HIS),
//  2) gửi từng đợt 10 BN bằng đúng lệnh của nút "Đồng bộ EMR" (emr/sync-hsba-to-emr),
//  3) (tuỳ chọn) chờ tới khi hồ sơ GỬI ĐỦ (Trạng thái gửi "Hoàn thành" và Thống kê đủ a/a) rồi mới
//     cấp số lưu trữ bằng đúng lệnh của nút "Cấp số lưu trữ" (emr/cap-so-luu-tru-emr), từng đợt 10 BN.
//  Ngoài ra: nút "Cấp số cho hồ sơ đã gửi đủ" - không đẩy, chỉ cấp số cho hồ sơ đã gửi đủ mà chưa có số.
(function () {
  if (window.top !== window || window.__bhytEmrBatch) return;
  window.__bhytEmrBatch = true;

  const MAX_PER_SEND = 10;   // giới hạn của HIS
  const POLL_MS = 20000;     // chu kỳ kiểm tra hồ sơ đã gửi đủ chưa
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const norm = s => String(s == null ? '' : s).normalize('NFC').trim();
  let running = false, stop = false;
  let scan = []; // [{ khoa, ten, dt, rows }]

  const $j = () => window.jQuery;

  function baseParams() {
    const $ = $j();
    let p = {};
    try { p = $('#form-template').getValue() || {}; } catch (_) {}
    return {
      ...p,
      tungay: $('#tungay').val(),
      denngay: $('#denngay').val(),
      theongay: $('#theongay').val(),
      phong: '-1',
      bant: $('#moduleBant').is(':checked') ? '1' : '0'
    };
  }

  // isSent=false: DS sẵn sàng gửi; isSent=true: DS đã gửi EMR
  // over: ghi đè tham số (VD khoảng ngày riêng của Thống kê)
  async function getList(khoa, doiTuong, isSent, over) {
    const p = { ...baseParams(), ...(over || {}), phongBan: khoa, doiTuong, isSent: isSent ? 'true' : 'false' };
    const r = await $j().ajax({ url: 'noi-tru-danh-sach-benh-nhan', type: 'GET', data: { params: JSON.stringify(p) }, dataType: 'json' });
    return Array.isArray(r) ? r : (r && r.rows) || [];
  }
  // c = { dt: '1'|'0' (Có/Không BHYT), bant: '0'|'1' (Nội trú / BANT) }.
  // HIS chỉ trả hồ sơ BANT (VD khoa YHCT) khi bant=1 -> phải quét riêng từng phân hệ.
  const getListC = (khoa, c, isSent, over) => getList(khoa, c.dt, isSent, { ...(over || {}), bant: c.bant });
  const comboLabel = c => `${c.dt === '1' ? 'Có BHYT' : 'Không BHYT'}${c.bant === '1' ? ', BANT' : ''}`;

  function post(url, data) {
    return new Promise(resolve => {
      $j().ajax({
        contentType: 'applictation/json', // giữ nguyên như HIS gửi
        type: 'POST',
        dataType: 'json',
        url,
        data: JSON.stringify(data),
        complete: res => {
          const j = res.responseJSON;
          const httpOk = res.status >= 200 && res.status < 300;
          // HIS trả kết quả trong errorMessage dù thành công, VD "Đã thực hiện cấp số lưu trữ 0/1 hồ sơ bệnh án sang EMR"
          const m = j && /(\d+)\s*\/\s*(\d+)/.exec(String(j.errorMessage || ''));
          if (httpOk && m) resolve({ ok: m[1] === m[2] && +m[2] > 0, counted: true, n: +m[1], of: +m[2], msg: j.errorMessage });
          else if (httpOk && !(j && j.errorMessage)) resolve({ ok: true });
          else resolve({ ok: false, msg: (j && j.errorMessage) || `Lỗi ${res.status || ''} ${res.statusText || ''}`.trim() });
        }
      });
    });
  }

  // Y hệt nút "Đồng bộ EMR" (gửi mới, không gửi lại)
  const sendBatch = (khoa, rows) => post('emr/sync-hsba-to-emr', {
    sendEmr: true, retrySend: false, khoaBanGiao: String(khoa).trim(),
    listPatient: rows.map(x => ({ soVaoVien: x.SOVAOVIEN, soVaoVienDT: x.SOVAOVIEN_DT, bant: x.BANT }))
  });

  // Y hệt nút "Cấp số lưu trữ" (HIS đọc cột ẩn SOVAOVIEN không có trong lưới -> không gửi soVaoVien)
  const capSoBatch = (khoa, rows) => post('emr/cap-so-luu-tru-emr', {
    khoaBanGiao: String(khoa).trim(),
    listPatient: rows.map(x => ({ patientId: x.PATIENT_ID, soVaoVienDT: x.SOVAOVIEN_DT, bant: x.BANT }))
  });

  // Khoá nhận diện 1 hồ sơ ở cả 2 danh sách
  const keyReady = x => `${x.SOVAOVIEN}_${x.SOVAOVIEN_DT}`;
  const keySent = x => `${x.SO_VAO_VIEN}_${x.SOVAOVIEN_DT}`;
  // Hồ sơ đã gửi đủ: Trạng thái gửi = 1 ("Hoàn thành") và Thống kê đủ (VD 187 / 187)
  function sentState(x) {
    if (String(x.TRANG_THAI_GUI) === '-1') return 'error';
    const m = String(x.THONG_KE || '').match(/(\d+)\s*\/\s*(\d+)/);
    const full = m && +m[2] > 0 && m[1] === m[2];
    if (String(x.TRANG_THAI_GUI) === '1' && /^Hoàn thành$/i.test(norm(x.TRANG_THAI)) && full) return 'full';
    return 'pending';
  }
  // Đã có số: HIS có số, HOẶC máy này đã cấp số thành công cho hồ sơ đó (HIS không lưu số EMR trả về)
  const hasSoLuuTru = x => (!!norm(x.EMR_SO_LUU_TRU) && norm(x.EMR_SO_LUU_TRU) !== 'null')
    || Object.prototype.hasOwnProperty.call(lsGet(LS_DONE, {}), String(x.PATIENT_ID));

  // ---------- Ghi lại phản hồi CẤP SỐ LƯU TRỮ & hiển thị số trên HIS ----------
  // HIS không lưu số lưu trữ EMR trả về (cột "Số lưu trữ" luôn trống) -> bắt phản hồi của lệnh
  // emr/cap-so-luu-tru-emr (cả nút của HIS lẫn công cụ), lưu lại trong trình duyệt và tự điền vào lưới.
  const LS_LOG = 'bhyt_emr_capso_log';
  const LS_MAP = 'bhyt_emr_soluutru';
  const LS_DONE = 'bhyt_emr_capso_done'; // patientId -> thời điểm đã cấp số thành công
  const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (_) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

  // Tìm số lưu trữ trong phản hồi (chưa rõ cấu trúc -> dò mọi object có mã BN/số vào viện + trường giống "số lưu trữ")
  const SO_KEY_RE = /luu_?tru|luutru|soLuuTru|storage|archive|so_?lt\b|soLT/i;
  const ID_KEY_RE = /^(patientId|patient_id|PATIENT_ID|soVaoVienDT|SOVAOVIEN_DT|sovaoviendt|maBenhAn|MA_BENH_AN|soBenhAn|SO_BENH_AN)$/i;
  function extractSo(json) {
    const found = [];
    const walk = (o, depth) => {
      if (!o || typeof o !== 'object' || depth > 8) return;
      if (Array.isArray(o)) { o.forEach(x => walk(x, depth + 1)); return; }
      const keys = Object.keys(o);
      const soK = keys.find(k => SO_KEY_RE.test(k) && o[k] != null && typeof o[k] !== 'object' && String(o[k]).trim());
      const ids = keys.filter(k => ID_KEY_RE.test(k) && o[k] != null && typeof o[k] !== 'object');
      if (soK && ids.length) found.push({ so: String(o[soK]).trim(), ids: ids.map(k => String(o[k]).trim()) });
      keys.forEach(k => walk(o[k], depth + 1));
    };
    walk(json, 0);
    return found;
  }

  function recordCapSo(settings, xhr) {
    let req = settings.data;
    try { req = JSON.parse(settings.data); } catch (_) {}
    const text = String(xhr.responseText || '');
    const entry = { at: new Date().toLocaleString('vi-VN'), status: xhr.status, req, res: text.slice(0, 20000) };
    const logArr = lsGet(LS_LOG, []);
    logArr.push(entry);
    lsSet(LS_LOG, logArr.slice(-50));
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    // Nhớ các hồ sơ đã cấp số thành công (HIS không lưu -> tránh cấp trùng lần sau)
    const cnt = json && /(\d+)\s*\/\s*(\d+)/.exec(String(json.errorMessage || ''));
    const allDone = cnt ? (cnt[1] === cnt[2] && +cnt[2] > 0) : !(json && json.errorMessage);
    if (xhr.status >= 200 && xhr.status < 300 && allDone && req && Array.isArray(req.listPatient)) {
      const done = lsGet(LS_DONE, {});
      req.listPatient.forEach(p => { if (p.patientId != null) done[String(p.patientId)] = entry.at; });
      lsSet(LS_DONE, done);
    }
    const found = json ? extractSo(json) : [];
    if (found.length) {
      const map = lsGet(LS_MAP, {});
      found.forEach(f => f.ids.forEach(id => { map[id] = f.so; }));
      lsSet(LS_MAP, map);
      setTimeout(fillSoLuuTru, 300);
    }
    console.log('[EMR] Phản hồi cấp số lưu trữ:', entry, 'Số tìm thấy:', found);
  }

  // ---- Tra số lưu trữ trực tiếp trên EMR (qua emr_bridge.js -> background, dùng phiên đăng nhập emr.vncare.vn) ----
  const emrCache = new Map(); // maBa -> { daLuuTru, soLuuTru, viTri, at }
  let emrReqId = 0;
  let emrLastError = '';
  function emrLookupRaw(maBas) {
    return new Promise(resolve => {
      const id = 'emr' + (++emrReqId) + '_' + Date.now();
      const onMsg = e => {
        const d = e.data;
        if (e.source !== window || !d || d.__bhytEmrRes !== true || d.id !== id) return;
        window.removeEventListener('message', onMsg); clearTimeout(timer);
        resolve(d.res || { success: false, message: 'Không có phản hồi' });
      };
      const timer = setTimeout(() => { window.removeEventListener('message', onMsg); resolve({ success: false, message: 'Hết thời gian tra EMR' }); }, 30000);
      window.addEventListener('message', onMsg);
      window.postMessage({ __bhytEmrReq: true, type: 'EMR_LOOKUP_SO_LUU_TRU', id, maBas }, '*');
    });
  }
  // Trả về Map maBa -> thông tin (null nếu tra lỗi). maxAgeMs: dùng lại kết quả còn mới
  async function emrLookup(maBas, maxAgeMs = 60000) {
    const need = [...new Set(maBas.filter(Boolean))].filter(m => { const c = emrCache.get(m); return !c || Date.now() - c.at > maxAgeMs; });
    if (need.length) {
      const r = await emrLookupRaw(need);
      if (!r || !r.success) { emrLastError = (r && r.message) || 'Không tra được EMR'; return null; }
      emrLastError = '';
      const now = Date.now();
      need.forEach(m => emrCache.set(m, Object.assign({ daLuuTru: false, soLuuTru: '', viTri: '', notFound: true }, r.map[m] || {}, { at: now })));
    }
    return new Map(maBas.map(m => [m, emrCache.get(m)]));
  }
  // Dòng báo ngay trên lưới "DS bệnh nhân đã gửi EMR" khi không tra được số lưu trữ
  function emrNotice(msg) {
    const tb = document.querySelector('#table-benh-nhan-sent-emr');
    const box = tb && (tb.closest('.ui-jqgrid') || tb);
    if (!box) return;
    let n = document.getElementById('bhyt-emr-notice');
    if (!msg) { if (n) n.remove(); return; }
    if (!n) {
      n = document.createElement('div');
      n.id = 'bhyt-emr-notice';
      n.style.cssText = 'margin:4px 0;padding:4px 8px;background:#fff3e0;border:1px solid #ffb74d;color:#e65100;font:bold 12px Arial;border-radius:3px';
      box.parentNode.insertBefore(n, box);
    }
    n.textContent = '⚠ ' + msg;
  }
  // Mã bệnh án trên EMR: "5626/2026_NOITRU" (nội trú) hoặc "156/2026_BANT" (bệnh án ngoại trú)
  const maBaOf = x => norm(x.EMR_MA_BA) || (norm(x.SOBENHAN) ? norm(x.SOBENHAN) + (String(x.BANT) === '1' ? '_BANT' : '_NOITRU') : '');

  // Điền số lưu trữ (tra từ EMR) vào cột "Số lưu trữ" của lưới "DS bệnh nhân đã gửi EMR"
  let fillTimer = null, filling = false, fillAgain = false;
  function fillSoLuuTru() {
    clearTimeout(fillTimer);
    fillTimer = setTimeout(fillNow, 400);
  }
  async function fillNow() {
    // Đang tra dở (lưới vừa nạp lại) -> tra lại ngay sau khi lượt trước xong, không bỏ lượt
    if (filling) { fillAgain = true; return; }
    const tb = document.querySelector('#table-benh-nhan-sent-emr');
    if (!tb) return;
    const rows = Array.from(tb.querySelectorAll('tr.jqgrow'));
    if (!rows.length) return;
    const get = (tr, c) => norm((tr.querySelector(`td[aria-describedby$="_${c}"]`) || {}).textContent);
    const items = rows.map(tr => ({ tr, maBa: get(tr, 'EMR_MA_BA') || (get(tr, 'SOBENHAN') ? get(tr, 'SOBENHAN') + (get(tr, 'BANT') === '1' ? '_BANT' : '_NOITRU') : '') }))
      .filter(x => x.maBa);
    if (!items.length) return;
    filling = true;
    try {
      const map = await emrLookup(items.map(x => x.maBa), 120000);
      emrNotice(map ? '' : 'Chưa hiện được Số lưu trữ: ' + emrLastError);
      if (!map) { console.warn('[EMR] ' + emrLastError); return; }
      items.forEach(({ tr, maBa }) => {
        const cell = tr.querySelector('td[aria-describedby$="_EMR_SO_LUU_TRU"]');
        const info = map.get(maBa);
        if (!cell || !info || !info.daLuuTru || !info.soLuuTru) return;
        if (norm(cell.textContent) === info.soLuuTru) return;
        cell.textContent = info.soLuuTru;
        cell.title = 'Số lưu trữ tra từ EMR' + (info.viTri ? ' - Vị trí: ' + info.viTri : '');
        cell.style.color = '#6a1b9a'; cell.style.fontWeight = 'bold';
      });
    } finally {
      filling = false;
      if (fillAgain) { fillAgain = false; fillSoLuuTru(); }
    }
  }

  function hookCapSo() {
    const $ = $j();
    if (!$ || window.__bhytEmrCapSoHook) return;
    window.__bhytEmrCapSoHook = true;
    $(document).ajaxComplete((e, xhr, s) => {
      if (/cap-so-luu-tru-emr/i.test(s && s.url || '')) { try { recordCapSo(s, xhr); } catch (err) { console.warn(err); } }
    });
    const tb = document.querySelector('#table-benh-nhan-sent-emr');
    if (tb) new MutationObserver(() => fillSoLuuTru()).observe(tb, { childList: true, subtree: true });
  }

  // ---------- Cửa sổ lớn xem Thống kê số lưu trữ ----------
  let lastStat = null;
  function openStatModal(st) {
    if (!st) return;
    document.getElementById('bhyt-emr-statmodal')?.remove();
    const m = document.createElement('div');
    m.id = 'bhyt-emr-statmodal';
    const rows = st.data.map((d, i) => {
      const detail = d.chua.length ? `<tr class="sm-det" data-i="${i}" hidden><td colspan="6"><table class="sm-sub">
          <tr><th>#</th><th>Số bệnh án</th><th>Họ tên</th><th>Mã y tế</th><th>Đối tượng</th><th>Tình trạng</th></tr>
          ${d.chua.map((x, j) => `<tr><td>${j + 1}</td><td>${esc(x.SOBENHAN)}</td><td>${esc(x.TEN_BENH_NHAN)}</td><td>${esc(x.MABENHNHAN)}</td>` +
            `<td>${esc(norm(x.CO_BHYT))}${String(x.BANT) === '1' ? ' · BANT' : ''}</td><td class="${sentState(x) === 'full' ? 'sm-ok' : 'sm-warn'}">${esc(st.tinhTrang(x))}</td></tr>`).join('')}
        </table></td></tr>` : '';
      return `<tr class="sm-k ${d.chua.length ? 'sm-click' : ''}" data-i="${i}">
          <td>${d.chua.length ? '<span class="sm-arrow">▸</span> ' : ''}${esc(d.ten)}</td>
          <td>${d.chuaGui || ''}</td><td>${d.daGui || ''}</td><td>${d.coSo || ''}</td>
          <td class="${d.chua.length ? 'sm-bad' : ''}">${d.chua.length || ''}</td><td>${d.sanSang || ''}</td></tr>${detail}`;
    }).join('');
    m.innerHTML = `
      <div class="sm-box">
        <div class="sm-head"><b>Thống kê số lưu trữ EMR: ${esc(st.tu)} - ${esc(st.den)}</b> <span>(${esc(st.theo)})</span>
          <span class="sm-sp"></span>
          <button type="button" class="sm-open">Mở hết</button>
          <button type="button" class="sm-xls">⬇ Xuất Excel</button>
          <button type="button" class="sm-close">✕ Đóng</button></div>
        <div class="sm-body"><table class="sm-t">
          <thead><tr><th>Khoa <small>(bấm dòng để xem hồ sơ chưa có số)</small></th><th>Chưa gửi EMR</th><th>Đã gửi</th><th>Đã có số</th><th>Chưa có số</th><th>Cấp số được ngay</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr><td>Tổng</td><td>${st.tot.chuaGui}</td><td>${st.tot.daGui}</td><td>${st.tot.coSo}</td><td>${st.tot.chuaSo}</td><td>${st.tot.sanSang}</td></tr></tfoot>
        </table>
        <div class="sm-note">"Cấp số được ngay" = đã gửi đủ (Hoàn thành, đủ file) mà chưa có số lưu trữ trên EMR -> dùng nút "🗄 Cấp số cho HS đã gửi đủ".</div></div>
      </div>`;
    document.body.appendChild(m);
    const close = () => { m.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    m.addEventListener('click', e => { if (e.target === m) close(); });
    m.querySelector('.sm-close').addEventListener('click', close);
    m.querySelector('.sm-t tbody').addEventListener('click', e => {
      const tr = e.target.closest('tr.sm-click');
      if (!tr) return;
      const det = m.querySelector(`tr.sm-det[data-i="${tr.dataset.i}"]`);
      det.hidden = !det.hidden; tr.classList.toggle('open', !det.hidden);
    });
    m.querySelector('.sm-open').addEventListener('click', e => {
      const dets = m.querySelectorAll('tr.sm-det');
      const show = Array.from(dets).some(d => d.hidden);
      dets.forEach(d => { d.hidden = !show; });
      m.querySelectorAll('tr.sm-click').forEach(t => t.classList.toggle('open', show));
      e.target.textContent = show ? 'Đóng hết' : 'Mở hết';
    });
    m.querySelector('.sm-xls').addEventListener('click', () => {
      const cell = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
      const lines = [[`Thống kê số lưu trữ EMR ${st.tu} - ${st.den} (${st.theo})`], [],
        ['Khoa', 'Chưa gửi EMR', 'Đã gửi', 'Đã có số', 'Chưa có số', 'Cấp số được ngay'],
        ...st.data.map(d => [d.ten, d.chuaGui, d.daGui, d.coSo, d.chua.length, d.sanSang]),
        ['Tổng', st.tot.chuaGui, st.tot.daGui, st.tot.coSo, st.tot.chuaSo, st.tot.sanSang], [],
        ['HỒ SƠ CHƯA CÓ SỐ LƯU TRỮ'],
        ['Khoa', 'Số bệnh án', 'Họ tên', 'Mã y tế', 'Đối tượng', 'Tình trạng'],
        ...st.data.flatMap(d => d.chua.map(x => [d.ten, x.SOBENHAN, x.TEN_BENH_NHAN, x.MABENHNHAN,
          norm(x.CO_BHYT) + (String(x.BANT) === '1' ? ' BANT' : ''), st.tinhTrang(x)]))];
      const csv = '﻿' + lines.map(r => r.map(cell).join(',')).join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      a.download = `ThongKe_SoLuuTru_EMR_${st.tu.replace(/\//g, '-')}_${st.den.replace(/\//g, '-')}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });
  }

  // ---------- Giao diện ----------
  function buildUi() {
    if (document.getElementById('bhyt-emr-launch') || !document.getElementById('phongBan')) return;
    const launch = document.createElement('button');
    launch.id = 'bhyt-emr-launch';
    launch.type = 'button';
    launch.textContent = '⇪ Đẩy EMR nhiều khoa';
    document.body.appendChild(launch);

    const khoaOpts = Array.from(document.querySelectorAll('#phongBan option'))
      .filter(o => o.value && o.value !== '-1' && !/HU[ỶY]/i.test(o.text));

    const panel = document.createElement('div');
    panel.id = 'bhyt-emr-panel';
    panel.innerHTML = `
      <div class="em-head"><b>Đẩy EMR nhiều khoa</b><span class="em-x" title="Đóng">✕</span></div>
      <div class="em-note">Dùng <b>Từ ngày / Đến ngày / Trạng thái / BANT</b> đang chọn trên trang. Gửi / cấp số từng đợt ${MAX_PER_SEND} BN (giới hạn của HIS).</div>
      <div class="em-opts">
        <div>Đối tượng: <label><input type="checkbox" class="em-dt" value="1" checked> Có BHYT</label>
          <label><input type="checkbox" class="em-dt" value="0" checked> Không BHYT</label></div>
        <div>Phân hệ KCB: <label><input type="checkbox" class="em-ph" value="0" checked> Nội trú</label>
          <label><input type="checkbox" class="em-ph" value="1" checked> BANT (bệnh án ngoại trú, VD khoa YHCT)</label></div>
        <div>Xác nhận khoa: <label><input type="radio" name="em-xn" value="da" checked> Chỉ "Đã xác nhận"</label>
          <label><input type="radio" name="em-xn" value="all"> Tất cả</label></div>
        <div class="em-cap"><label><input type="checkbox" class="em-capso"> <b>Đẩy xong thì cấp số lưu trữ</b></label>
          (chỉ khi gửi đủ; chờ tối đa <input type="number" class="em-wait" value="30" min="1" max="240"> phút)</div>
      </div>
      <div class="em-bar">
        <label><input type="checkbox" class="em-all" checked> Tất cả khoa</label>
        <button type="button" class="em-scan">🔍 Quét số lượng</button>
      </div>
      <div class="em-list">${khoaOpts.map(o => `<div class="em-k" data-k="${esc(o.value)}">
          <div class="em-kh"><span class="em-tg" title="Mở / đóng danh sách hồ sơ">▸</span>
            <label><input type="checkbox" class="em-kc" value="${esc(o.value)}" checked> <span class="em-n">–</span> ${esc(o.text)}</label></div>
          <div class="em-recs"></div></div>`).join('')}</div>
      <div class="em-actions">
        <button type="button" class="em-start" disabled>⇪ Bắt đầu đẩy</button>
        <button type="button" class="em-caponly" title="Không đẩy. Chỉ cấp số lưu trữ cho hồ sơ ĐÃ GỬI ĐỦ mà chưa có số (theo ngày và khoa đang chọn)">🗄 Cấp số cho HS đã gửi đủ</button>
        <button type="button" class="em-stop" disabled>Dừng</button>
        <span class="em-stat-d">📊 Thống kê từ <input type="date" class="em-st-tu"> đến <input type="date" class="em-st-den">
          <button type="button" class="em-stat" title="Mỗi khoa: chưa gửi EMR, đã gửi, đã có / chưa có số lưu trữ (tra trên EMR)">Thống kê số lưu trữ</button></span>
        <button type="button" class="em-reslog" title="Xem phản hồi của EMR các lần cấp số lưu trữ (để tìm số đã cấp)">📋 Phản hồi cấp số</button>
        <span class="em-total"></span>
      </div>
      <div class="em-status"></div>
      <div class="em-log"></div>`;
    document.body.appendChild(panel);
    const q = s => panel.querySelector(s);
    const log = m => { const d = document.createElement('div'); d.textContent = m; q('.em-log').appendChild(d); q('.em-log').scrollTop = 1e9; };
    const status = m => { q('.em-status').textContent = m; };
    const setRunning = on => {
      running = on;
      q('.em-scan').disabled = on; q('.em-caponly').disabled = on; q('.em-stat').disabled = on;
      q('.em-start').disabled = on || !scan.length; q('.em-stop').disabled = !on;
    };
    {
      // Thống kê mặc định: từ đầu năm đến hôm nay
      const d = new Date(), pad = n => String(n).padStart(2, '0');
      q('.em-st-tu').value = `${d.getFullYear()}-01-01`;
      q('.em-st-den').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
    const selKhoa = () => Array.from(panel.querySelectorAll('.em-kc:checked')).map(c => c.value);
    const kBox = k => panel.querySelector(`.em-k[data-k="${CSS.escape(k)}"]`);
    // Hồ sơ đang được tích (sau khi quét) -> các nhóm { khoa, ten, dt, rows } chỉ gồm hồ sơ được chọn
    const selectedGroups = () => scan.map((g, gi) => ({
      ...g,
      rows: g.rows.filter((x, i) => { const c = panel.querySelector(`.em-rc[data-g="${gi}"][data-i="${i}"]`); return c && c.checked; })
    })).filter(g => g.rows.length);
    // Cập nhật số "đã chọn / tổng" của từng khoa và tổng chung; khoa chọn 1 phần -> ô khoa ở trạng thái lửng
    const updateCounts = () => {
      if (!scan.length) return;
      let sum = 0;
      panel.querySelectorAll('.em-k').forEach(kb => {
        const rcs = kb.querySelectorAll('.em-rc');
        if (!rcs.length) return;
        const on = Array.from(rcs).filter(c => c.checked).length;
        sum += on;
        kb.querySelector('.em-n').textContent = `${on}/${rcs.length}`;
        const kc = kb.querySelector('.em-kc');
        kc.checked = on > 0; kc.indeterminate = on > 0 && on < rcs.length;
      });
      q('.em-total').textContent = `Đã chọn: ${sum} HS`;
      q('.em-start').disabled = running || !sum;
    };
    const selDt = () => Array.from(panel.querySelectorAll('.em-dt:checked')).map(c => c.value);
    const selPh = () => Array.from(panel.querySelectorAll('.em-ph:checked')).map(c => c.value);
    const selCombos = () => selPh().flatMap(bant => selDt().map(dt => ({ dt, bant })));
    const onlyXn = () => panel.querySelector('input[name="em-xn"]:checked').value === 'da';
    const tenKhoa = k => (khoaOpts.find(o => o.value === k) || {}).text || k;
    const pick = rows => onlyXn() ? rows.filter(r => /^Đã xác nhận/i.test(norm(r.XAC_NHAN_KHOA_PHONG))) : rows;
    const checkInputs = () => {
      if (!selKhoa().length) { alert('Chọn ít nhất 1 khoa.'); return false; }
      if (!selDt().length) { alert('Chọn ít nhất 1 đối tượng (Có / Không BHYT).'); return false; }
      if (!selPh().length) { alert('Chọn ít nhất 1 phân hệ (Nội trú / BANT).'); return false; }
      return true;
    };

    // Đổi điều kiện -> phải quét lại
    // Xoá kết quả quét: hiện lại mọi khoa (để chọn khoa cần quét), bỏ danh sách hồ sơ
    const invalidate = () => {
      scan = []; q('.em-start').disabled = true; q('.em-total').textContent = '';
      panel.querySelectorAll('.em-k').forEach(kb => {
        kb.style.display = ''; kb.classList.remove('open', 'has');
        kb.querySelector('.em-n').textContent = '–';
        kb.querySelector('.em-recs').innerHTML = '';
        kb.querySelector('.em-kc').indeterminate = false;
      });
    };
    panel.querySelectorAll('.em-dt, .em-ph, input[name="em-xn"]').forEach(c => c.addEventListener('change', invalidate));
    // Bấm ô khoa: trước khi quét = chọn khoa để quét; sau khi quét = chọn / bỏ mọi hồ sơ của khoa
    // Bấm ▸: mở danh sách hồ sơ để chọn từng hồ sơ
    q('.em-list').addEventListener('change', e => {
      const t = e.target;
      if (t.classList.contains('em-kc')) {
        t.closest('.em-k').querySelectorAll('.em-rc').forEach(c => { c.checked = t.checked; });
        updateCounts();
      } else if (t.classList.contains('em-rc')) updateCounts();
    });
    q('.em-list').addEventListener('click', e => {
      const tg = e.target.closest('.em-tg');
      if (tg) tg.closest('.em-k').classList.toggle('open');
    });
    ['tungay', 'denngay', 'theongay', 'moduleBant'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('change', invalidate); });

    launch.addEventListener('click', () => { panel.style.display = panel.style.display === 'flex' ? 'none' : 'flex'; });
    q('.em-x').addEventListener('click', () => { panel.style.display = 'none'; });
    q('.em-all').addEventListener('change', e => {
      panel.querySelectorAll('.em-k').forEach(kb => {
        if (kb.style.display === 'none') return; // khoa đã ẩn (không có hồ sơ)
        kb.querySelectorAll('.em-kc, .em-rc').forEach(c => { c.checked = e.target.checked; c.indeterminate = false; });
      });
      updateCounts();
    });
    q('.em-stop').addEventListener('click', () => { stop = true; status('Đang dừng sau bước hiện tại...'); });
    q('.em-reslog').addEventListener('click', () => {
      const arr = lsGet(LS_LOG, []);
      const nMap = Object.keys(lsGet(LS_MAP, {})).length;
      const box = q('.em-log');
      box.innerHTML = '';
      if (!arr.length) { log('Chưa có lần cấp số nào được ghi lại (chỉ ghi từ khi cài bản này). Hãy cấp số 1 hồ sơ rồi bấm lại nút này.'); return; }
      log(`${arr.length} lần cấp số gần nhất. Đã nhận ra số lưu trữ cho ${nMap} mã. Bôi đen phần dưới -> Ctrl+C để gửi cho người hỗ trợ:`);
      const ta = document.createElement('textarea');
      ta.readOnly = true;
      ta.style.cssText = 'width:100%;height:160px;font:11px Consolas,monospace';
      ta.value = arr.slice(-5).map(e => `[${e.at}] HTTP ${e.status}\nGửi: ${JSON.stringify(e.req)}\nNhận: ${e.res}`).join('\n\n');
      box.appendChild(ta);
      ta.focus(); ta.select();
    });

    // ---- Chờ gửi đủ rồi cấp số ----
    // pending: Map khoa -> { combos:Set("dt|bant"), keys:Set } các hồ sơ cần theo dõi
    async function waitAndCapSo(pending, maxMin) {
      const deadline = Date.now() + maxMin * 60000;
      const ready = new Map();   // khoa -> [row DS đã gửi] gửi đủ, chưa có số
      const done = new Set(), errs = [], already = [];
      const total = [...pending.values()].reduce((s, g) => s + g.keys.size, 0);
      log(`⏳ Chờ ${total} hồ sơ gửi đủ (Hoàn thành + Thống kê đủ), kiểm tra mỗi ${POLL_MS / 1000} giây, tối đa ${maxMin} phút...`);
      while (!stop) {
        let waiting = 0;
        for (const [khoa, g] of pending) {
          const left = [...g.keys].filter(k => !done.has(k));
          if (!left.length) continue;
          let rows = [];
          for (const cs of g.combos) {
            const [dt, bant] = cs.split('|');
            try { rows = rows.concat(await getListC(khoa, { dt, bant }, true)); }
            catch (e) { log(`  ⚠ ${tenKhoa(khoa)}: không tải được DS đã gửi (${e.statusText || e})`); }
          }
          const byKey = new Map(rows.map(x => [keySent(x), x]));
          for (const k of left) {
            const x = byKey.get(k);
            if (!x) { waiting++; continue; } // chưa sang DS đã gửi
            const st = sentState(x);
            if (st === 'pending') { waiting++; continue; }
            done.add(k);
            if (st === 'error') { errs.push(`${x.SOBENHAN} ${x.TEN_BENH_NHAN} (${tenKhoa(khoa)}): gửi KHÔNG hoàn thành`); continue; }
            if (hasSoLuuTru(x)) { already.push(x); continue; }
            if (!ready.has(khoa)) ready.set(khoa, []);
            ready.get(khoa).push(x);
          }
        }
        const nReady = [...ready.values()].reduce((s, a) => s + a.length, 0);
        status(`Chờ gửi đủ: ✅ ${nReady + already.length} đủ | ⏳ ${waiting} đang gửi | ❌ ${errs.length} lỗi`);
        if (!waiting) break;
        if (Date.now() > deadline) { log(`  ⌛ Hết ${maxMin} phút: còn ${waiting} hồ sơ chưa gửi đủ -> KHÔNG cấp số cho các hồ sơ này.`); break; }
        for (let t = 0; t < POLL_MS && !stop; t += 500) await sleep(500);
      }
      errs.forEach(e => log('  ❌ ' + e));
      if (already.length) log(`  ℹ ${already.length} hồ sơ đã có số lưu trữ từ trước -> bỏ qua.`);
      const f = await filterByEmr(ready);
      await capSo(f.ready);
    }

    // Bỏ khỏi danh sách cấp số các hồ sơ EMR đã lưu trữ (đã có số) -> tránh cấp trùng
    async function filterByEmr(ready) {
      const all = [...ready.values()].flat();
      if (!all.length) return { ready, skipped: 0, checked: true };
      status('Đang tra EMR các hồ sơ đã có số lưu trữ...');
      const map = await emrLookup(all.map(maBaOf), 0);
      if (!map) {
        log(`  ⚠ Không tra được EMR (${emrLastError}) -> chỉ dựa vào bộ nhớ máy này để tránh cấp trùng.`);
        return { ready, skipped: 0, checked: false };
      }
      let skipped = 0;
      const out = new Map();
      for (const [k, rows] of ready) {
        const keep = rows.filter(x => { const i = map.get(maBaOf(x)); if (i && i.daLuuTru) { skipped++; return false; } return true; });
        if (keep.length) out.set(k, keep);
      }
      if (skipped) log(`  ℹ EMR: ${skipped} hồ sơ đã có số lưu trữ -> bỏ qua.`);
      return { ready: out, skipped, checked: true };
    }

    // Cấp số theo khoa, từng đợt 10; xong đọc lại để xác nhận đã có số
    async function capSo(ready) {
      const total = [...ready.values()].reduce((s, a) => s + a.length, 0);
      if (!total) { log('🗄 Không có hồ sơ nào cần cấp số lưu trữ.'); return; }
      log(`🗄 Cấp số lưu trữ cho ${total} hồ sơ đã gửi đủ...`);
      let ok = 0, fail = 0, n = 0;
      for (const [khoa, rows] of ready) {
        if (stop) break;
        for (let i = 0; i < rows.length && !stop; i += MAX_PER_SEND) {
          const batch = rows.slice(i, i + MAX_PER_SEND);
          status(`Đang cấp số ${n + batch.length}/${total}: ${tenKhoa(khoa)}`);
          const r = await capSoBatch(khoa, batch);
          if (r.ok) { ok += batch.length; log(`  ✅ ${tenKhoa(khoa)}: ${r.msg || 'cấp số ' + batch.length + ' HS'}`); }
          else if (r.counted) {
            // HIS báo "cấp số lưu trữ a/b": không cấp lại (tránh cấp trùng), ghi rõ để kiểm tra trên EMR
            ok += r.n; fail += r.of - r.n;
            log(`  ⚠ ${tenKhoa(khoa)}: ${r.msg}`);
            if (r.n < r.of) log(`    Kiểm tra trên EMR các HS: ${batch.map(x => `${x.SOBENHAN} ${x.TEN_BENH_NHAN}`).join('; ')}`);
          }
          else {
            log(`  ⚠ Đợt lỗi: ${r.msg} -> cấp lại từng HS`);
            for (const x of batch) {
              if (stop) break;
              const r1 = await capSoBatch(khoa, [x]);
              if (r1.ok) ok++; else { fail++; log(`    ❌ ${x.SOBENHAN} ${x.TEN_BENH_NHAN}: ${r1.msg}`); }
              await sleep(300);
            }
          }
          n += batch.length;
          await sleep(800);
        }
      }
      log(`🗄 HIS báo cấp số: ✅ ${ok} | ❌ ${fail}`);
      // Kiểm tra lại TRÊN EMR: hồ sơ nào đã thật sự có số lưu trữ
      const all = [...ready.values()].flat();
      status('Đang kiểm tra số lưu trữ trên EMR...');
      await sleep(1500);
      const map = await emrLookup(all.map(maBaOf), 0);
      if (!map) {
        log(`  ⚠ Không tra được EMR để kiểm tra lại (${emrLastError}).`);
      } else {
        const got = all.filter(x => (map.get(maBaOf(x)) || {}).daLuuTru);
        const miss = all.filter(x => !(map.get(maBaOf(x)) || {}).daLuuTru);
        log(`🗄 Trên EMR: ${got.length}/${all.length} hồ sơ đã có số lưu trữ.`);
        got.slice(0, 30).forEach(x => log(`    ${x.SOBENHAN} ${x.TEN_BENH_NHAN}: ${map.get(maBaOf(x)).soLuuTru}`));
        if (got.length > 30) log(`    ... và ${got.length - 30} hồ sơ khác (xem cột "Số lưu trữ").`);
        miss.forEach(x => log(`    ❌ chưa có số: ${x.SOBENHAN} ${x.TEN_BENH_NHAN}`));
        // Ghi nhớ hồ sơ đã có số (dự phòng khi không tra được EMR lần sau)
        const done = lsGet(LS_DONE, {});
        got.forEach(x => { done[String(x.PATIENT_ID)] = new Date().toLocaleString('vi-VN'); });
        lsSet(LS_DONE, done);
      }
    }

    // ---- Quét ----
    q('.em-scan').addEventListener('click', async () => {
      if (running || !checkInputs()) return;
      const ks = selKhoa(), combos = selCombos();
      stop = false; setRunning(true); invalidate(); q('.em-log').innerHTML = '';
      const p = baseParams();
      log(`Quét ${ks.length} khoa, ${p.tungay} - ${p.denngay}, ${$j()('#theongay option:selected').text()}, phân hệ: ${selPh().map(b => b === '1' ? 'BANT' : 'Nội trú').join(' + ')}`);
      let total = 0, nKhoa = 0;
      try {
        for (let i = 0; i < ks.length && !stop; i++) {
          const k = ks[i];
          status(`Đang quét ${i + 1}/${ks.length}: ${tenKhoa(k)}`);
          const kb = kBox(k);
          const recs = kb.querySelector('.em-recs');
          let html = '', all = 0;
          for (const c of combos) {
            const dt = c.dt;
            try {
              const rows = await getListC(k, c, false);
              if (!rows.length) continue;
              const gi = scan.length;
              scan.push({ khoa: k, ten: tenKhoa(k), dt, bant: c.bant, rows });
              const def = new Set(pick(rows)); // mặc định tích: theo lựa chọn "Xác nhận khoa"
              rows.forEach((x, ri) => {
                const xn = norm(x.XAC_NHAN_KHOA_PHONG);
                html += `<label class="${/^Đã xác nhận/i.test(xn) ? '' : 'em-cxn'}"><input type="checkbox" class="em-rc" data-g="${gi}" data-i="${ri}" ${def.has(x) ? 'checked' : ''}>` +
                  ` <b>${esc(x.SOBENHAN)}</b> ${esc(x.TEN_BENH_NHAN)} <i>${dt === '1' ? 'BHYT' : 'KBHYT'}${c.bant === '1' ? ' · BANT' : ''}${xn ? ' · ' + esc(xn) : ''}</i></label>`;
              });
              all += rows.length;
            } catch (e) { log(`❌ ${tenKhoa(k)}: không tải được danh sách (${e.statusText || e.message || e})`); }
          }
          recs.innerHTML = html;
          kb.classList.toggle('has', all > 0);
          if (all) { nKhoa++; total += all; }
        }
      } finally {
        // Ẩn khoa không có hồ sơ (và khoa không quét)
        panel.querySelectorAll('.em-k').forEach(kb => { kb.style.display = kb.classList.contains('has') ? '' : 'none'; });
        status(stop ? 'Đã dừng quét' : 'Quét xong');
        if (stop) { invalidate(); } else {
          updateCounts();
          log(`Có ${total} hồ sơ ở ${nKhoa} khoa (khoa trống đã ẩn). Bấm ▸ cạnh tên khoa để chọn từng hồ sơ.`);
        }
        setRunning(false);
        updateCounts();
      }
    });

    // ---- Đẩy (và cấp số nếu chọn) ----
    q('.em-start').addEventListener('click', async () => {
      if (running || !scan.length) return;
      const groups = selectedGroups(); // chỉ các hồ sơ đang được tích
      const total = groups.reduce((s, g) => s + g.rows.length, 0);
      if (!total) { alert('Chưa chọn hồ sơ nào.'); return; }
      const nk = new Set(groups.map(g => g.khoa)).size;
      const wantCap = q('.em-capso').checked;
      const maxMin = Math.max(1, Math.min(240, parseInt(q('.em-wait').value, 10) || 30));
      if (!confirm(`Đẩy ${total} hồ sơ của ${nk} khoa sang EMR (mỗi đợt ≤ ${MAX_PER_SEND} BN)?` +
        (wantCap ? `\n\nSau đó CHỜ hồ sơ gửi đủ (tối đa ${maxMin} phút) rồi CẤP SỐ LƯU TRỮ cho các hồ sơ đã gửi đủ.` : ''))) return;
      stop = false; setRunning(true);
      let ok = 0, fail = 0, done = 0;
      const failed = [];
      const pending = new Map(); // khoa -> { dts, keys } hồ sơ đẩy thành công, để theo dõi cấp số
      const track = (g, x) => {
        if (!pending.has(g.khoa)) pending.set(g.khoa, { combos: new Set(), keys: new Set() });
        const t = pending.get(g.khoa); t.combos.add(`${g.dt}|${g.bant}`); t.keys.add(keyReady(x));
      };
      try {
        for (const g of groups) {
          if (stop) break;
          log(`▶ ${g.ten} (${comboLabel(g)}): ${g.rows.length} BN`);
          for (let i = 0; i < g.rows.length && !stop; i += MAX_PER_SEND) {
            const batch = g.rows.slice(i, i + MAX_PER_SEND);
            status(`Đang đẩy ${done + batch.length}/${total}: ${g.ten}`);
            const r = await sendBatch(g.khoa, batch);
            if (r.ok) { ok += batch.length; batch.forEach(x => track(g, x)); log(`  ✅ ${batch.length} BN${r.msg ? ' - ' + r.msg : ''}`); }
            else if (r.counted) {
              // HIS đã nhận đợt này nhưng báo chưa đủ (a/b) -> KHÔNG gửi lại (tránh gửi trùng); theo dõi ở DS đã gửi
              ok += r.n; fail += r.of - r.n;
              batch.forEach(x => track(g, x));
              log(`  ⚠ ${r.msg}`);
              failed.push(`${g.ten}: ${r.msg} (đợt ${batch.map(x => x.SOBENHAN).join(', ')})`);
            }
            else {
              // Đợt lỗi -> gửi lại từng BN để biết BN nào lỗi
              log(`  ⚠ Đợt lỗi: ${r.msg} -> gửi lại từng BN`);
              for (const x of batch) {
                if (stop) break;
                const r1 = await sendBatch(g.khoa, [x]);
                if (r1.ok) { ok++; track(g, x); }
                else { fail++; failed.push(`${x.SOBENHAN} ${x.TEN_BENH_NHAN} (${g.ten}): ${r1.msg}`); log(`    ❌ ${x.SOBENHAN} ${x.TEN_BENH_NHAN}: ${r1.msg}`); }
                await sleep(300);
              }
            }
            done += batch.length;
            await sleep(800);
          }
        }
        log(`—— Đẩy EMR: ✅ ${ok} | ❌ ${fail}${stop ? ' | ⛔ đã dừng giữa chừng' : ''}`);
        failed.forEach(f => log('  ❌ ' + f));
        if (wantCap && !stop && pending.size) await waitAndCapSo(pending, maxMin);
      } catch (e) {
        log('❌ ' + (e.message || e));
      } finally {
        status(stop ? 'Đã dừng' : 'Xong');
        invalidate(); // danh sách đã thay đổi -> quét lại nếu cần đẩy tiếp
        setRunning(false);
        try { window.getListBenhNhanXuatVien && window.getListBenhNhanXuatVien(); } catch (_) {}
      }
    });

    // ---- Thống kê theo khoa: chưa gửi / đã gửi / gửi đủ / đã có số / chưa có số lưu trữ ----
    q('.em-stat').addEventListener('click', async () => {
      if (running) return;
      const combos = selCombos();
      if (!combos.length) { alert('Chọn ít nhất 1 đối tượng (Có / Không BHYT) và 1 phân hệ (Nội trú / BANT).'); return; }
      const vn = iso => { const a = String(iso || '').split('-'); return a.length === 3 ? `${a[2]}/${a[1]}/${a[0]}` : ''; };
      const over = { tungay: vn(q('.em-st-tu').value), denngay: vn(q('.em-st-den').value) };
      if (!over.tungay || !over.denngay) { alert('Chọn khoảng ngày thống kê.'); return; }
      stop = false; setRunning(true); q('.em-log').innerHTML = '';
      log(`Thống kê ${khoaOpts.length} khoa, ${over.tungay} - ${over.denngay}, ${$j()('#theongay option:selected').text()}... (khoảng dài có thể mất 1-2 phút)`);
      const stats = []; // { k, ten, chuaGui, sent: [] }
      try {
        for (let i = 0; i < khoaOpts.length && !stop; i++) {
          const k = khoaOpts[i].value;
          status(`Đang đọc ${i + 1}/${khoaOpts.length}: ${tenKhoa(k)}`);
          let chuaGui = 0, sent = [];
          for (const c of combos) {
            try { chuaGui += (await getListC(k, c, false, over)).length; } catch (e) { log(`⚠ ${tenKhoa(k)}: lỗi đọc DS chưa gửi (${e.status || ''})`); }
            try { sent = sent.concat(await getListC(k, c, true, over)); } catch (e) { log(`⚠ ${tenKhoa(k)}: lỗi đọc DS đã gửi (${e.status || ''})`); }
          }
          if (chuaGui || sent.length) stats.push({ k, ten: tenKhoa(k), chuaGui, sent });
        }
        if (stop) return;
        status('Đang tra số lưu trữ trên EMR...');
        const allSent = stats.flatMap(s => s.sent);
        const map = allSent.length ? await emrLookup(allSent.map(maBaOf), 0) : new Map();
        if (!map) log(`⚠ Không tra được EMR (${emrLastError}) -> "đã có số" chỉ tính theo HIS / máy này.`);
        const coSo = x => map ? !!(map.get(maBaOf(x)) || {}).daLuuTru : hasSoLuuTru(x);

        const tinhTrang = x => sentState(x) === 'full' ? 'Gửi đủ - cấp số được ngay' : sentState(x) === 'error' ? 'Gửi lỗi' : 'Chưa gửi đủ ' + norm(x.THONG_KE);
        const tot = { chuaGui: 0, daGui: 0, coSo: 0, chuaSo: 0, sanSang: 0 };
        const data = stats.map(s => {
          const co = s.sent.filter(coSo);
          const chua = s.sent.filter(x => !coSo(x));
          const sanSang = chua.filter(x => sentState(x) === 'full'); // gửi đủ, cấp số được ngay
          tot.chuaGui += s.chuaGui; tot.daGui += s.sent.length;
          tot.coSo += co.length; tot.chuaSo += chua.length; tot.sanSang += sanSang.length;
          return { ten: s.ten, chuaGui: s.chuaGui, daGui: s.sent.length, coSo: co.length, chua, sanSang: sanSang.length };
        });
        q('.em-log').innerHTML = '';
        if (!stats.length) { log('Không khoa nào có hồ sơ trong khoảng ngày này.'); return; }
        lastStat = { tu: over.tungay, den: over.denngay, theo: $j()('#theongay option:selected').text(), data, tot, tinhTrang };
        log(`Thống kê ${over.tungay} - ${over.denngay}: ${data.length} khoa | chưa gửi ${tot.chuaGui} | đã gửi ${tot.daGui} | có số ${tot.coSo} | CHƯA CÓ SỐ ${tot.chuaSo} | cấp số được ngay ${tot.sanSang}`);
        const again = document.createElement('button');
        again.type = 'button'; again.textContent = '🔍 Mở lại bảng thống kê';
        again.addEventListener('click', () => openStatModal(lastStat));
        q('.em-log').appendChild(again);
        openStatModal(lastStat);
      } catch (e) {
        log('❌ ' + (e.message || e));
      } finally {
        status(stop ? 'Đã dừng' : 'Thống kê xong');
        setRunning(false);
        updateCounts();
      }
    });

    // ---- Chỉ cấp số cho hồ sơ đã gửi đủ (không đẩy) ----
    q('.em-caponly').addEventListener('click', async () => {
      if (running || !checkInputs()) return;
      const ks = selKhoa(), combos = selCombos();
      stop = false; setRunning(true); q('.em-log').innerHTML = '';
      const p = baseParams();
      log(`Tìm hồ sơ ĐÃ GỬI ĐỦ chưa có số lưu trữ: ${ks.length} khoa, ${p.tungay} - ${p.denngay}, phân hệ: ${selPh().map(b => b === '1' ? 'BANT' : 'Nội trú').join(' + ')}`);
      const ready = new Map();
      let nFull = 0, nPend = 0, nErr = 0, nHave = 0;
      try {
        for (let i = 0; i < ks.length && !stop; i++) {
          const k = ks[i];
          status(`Đang quét ${i + 1}/${ks.length}: ${tenKhoa(k)}`);
          for (const c of combos) {
            let rows = [];
            try { rows = await getListC(k, c, true); } catch (e) { log(`❌ ${tenKhoa(k)}: không tải được DS đã gửi`); continue; }
            for (const x of rows) {
              const st = sentState(x);
              if (st === 'error') { nErr++; continue; }
              if (st === 'pending') { nPend++; continue; }
              if (hasSoLuuTru(x)) { nHave++; continue; }
              nFull++;
              if (!ready.has(k)) ready.set(k, []);
              ready.get(k).push(x);
            }
          }
        }
        if (stop || !nFull) { log(`Gửi đủ chưa có số: ${nFull} | đã có số: ${nHave} | chưa gửi đủ: ${nPend} | gửi lỗi: ${nErr}`); return; }
        const f = await filterByEmr(ready);
        const nCap = [...f.ready.values()].reduce((s, a) => s + a.length, 0);
        log(`Cần cấp số: ${nCap} | đã có số (EMR/máy này): ${nHave + f.skipped} | chưa gửi đủ: ${nPend} | gửi lỗi: ${nErr}`);
        if (!nCap) return;
        if (!confirm(`Cấp số lưu trữ cho ${nCap} hồ sơ đã gửi đủ (${f.ready.size} khoa)?\n(Bỏ qua ${nHave + f.skipped} hồ sơ đã có số, ${nPend} chưa gửi đủ, ${nErr} gửi lỗi.)` +
          (f.checked ? '' : `\n\n⚠ KHÔNG tra được EMR (${emrLastError}). Hồ sơ đã cấp số trước đó có thể bị cấp lại. Nên mở trang emr.vncare.vn rồi thử lại.`))) return;
        await capSo(f.ready);
      } catch (e) {
        log('❌ ' + (e.message || e));
      } finally {
        status(stop ? 'Đã dừng' : 'Xong');
        setRunning(false);
        try { window.getListBenhNhanDaGuiEmr && window.getListBenhNhanDaGuiEmr(); } catch (_) {}
      }
    });
  }

  const style = document.createElement('style');
  style.textContent = `
    #bhyt-emr-launch { position: fixed; left: 12px; bottom: 12px; z-index: 2147483000; padding: 6px 12px; font: bold 12px Arial;
      color: #fff; background: #0d47a1; border: 1px solid #08306b; border-radius: 4px; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,.3); }
    #bhyt-emr-panel { display: none; flex-direction: column; position: fixed; left: 12px; bottom: 48px; z-index: 2147483000;
      width: 470px; max-height: 85vh; background: #fff; border: 1px solid #0d47a1; border-radius: 6px; font: 12px Arial; color: #222;
      box-shadow: 0 4px 16px rgba(0,0,0,.3); }
    #bhyt-emr-panel .em-head { display: flex; justify-content: space-between; padding: 6px 10px; background: #0d47a1; color: #fff; border-radius: 5px 5px 0 0; }
    #bhyt-emr-panel .em-x { cursor: pointer; }
    #bhyt-emr-panel .em-note { padding: 6px 10px; color: #555; background: #f3f6fb; }
    #bhyt-emr-panel .em-opts { padding: 4px 10px; display: flex; flex-direction: column; gap: 3px; border-bottom: 1px solid #ddd; }
    #bhyt-emr-panel .em-opts label { margin-left: 6px; }
    #bhyt-emr-panel .em-cap { color: #6a1b9a; }
    #bhyt-emr-panel .em-wait { width: 48px; }
    #bhyt-emr-panel .em-bar { display: flex; align-items: center; justify-content: space-between; padding: 4px 10px; }
    #bhyt-emr-panel .em-list { overflow: auto; max-height: 26vh; padding: 2px 10px; border-top: 1px solid #ddd; border-bottom: 1px solid #ddd; }
    #bhyt-emr-panel .em-list label { display: block; padding: 1px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #bhyt-emr-panel .em-kh { display: flex; align-items: center; gap: 4px; }
    #bhyt-emr-panel .em-kh label { flex: 1; }
    #bhyt-emr-panel .em-tg { visibility: hidden; cursor: pointer; width: 14px; color: #0d47a1; font-weight: bold; user-select: none; }
    #bhyt-emr-panel .em-k.has .em-tg { visibility: visible; }
    #bhyt-emr-panel .em-k.open .em-tg { transform: rotate(90deg); }
    #bhyt-emr-panel .em-recs { display: none; margin: 0 0 4px 34px; padding-left: 6px; border-left: 2px solid #c5cae9; }
    #bhyt-emr-panel .em-k.open .em-recs { display: block; }
    #bhyt-emr-panel .em-recs label { font-size: 11px; }
    #bhyt-emr-panel .em-recs i { color: #777; font-style: normal; }
    #bhyt-emr-panel .em-recs .em-cxn { color: #999; }
    #bhyt-emr-panel .em-n { display: inline-block; min-width: 52px; font-weight: bold; color: #1d6f42; }
    #bhyt-emr-panel .em-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 6px 10px; }
    #bhyt-emr-panel .em-total { margin-left: auto; font-weight: bold; color: #0d47a1; }
    #bhyt-emr-panel button { padding: 3px 8px; font: bold 12px Arial; cursor: pointer; border-radius: 3px; border: 1px solid #999; background: #f5f5f5; }
    #bhyt-emr-panel .em-start { background: #1d6f42; color: #fff; border-color: #145a32; }
    #bhyt-emr-panel .em-caponly { background: #6a1b9a; color: #fff; border-color: #4a148c; }
    #bhyt-emr-panel .em-stop { background: #c62828; color: #fff; border-color: #8e0000; }
    #bhyt-emr-panel .em-reslog { background: #fff8e1; }
    #bhyt-emr-panel .em-stat { background: #e3f2fd; }
    #bhyt-emr-panel .em-stat-d { flex-basis: 100%; display: flex; align-items: center; gap: 4px; flex-wrap: wrap; color: #0d47a1; font-weight: bold; }
    #bhyt-emr-panel .em-stat-d input { font: 12px Arial; }
    #bhyt-emr-panel .em-stat-t { width: 100%; border-collapse: collapse; font: 11px Arial; white-space: normal; }
    #bhyt-emr-panel .em-stat-t th, #bhyt-emr-panel .em-stat-t td { border: 1px solid #ccd; padding: 2px 4px; text-align: right; vertical-align: top; }
    #bhyt-emr-panel .em-stat-t th { background: #e8eaf6; text-align: center; }
    #bhyt-emr-panel .em-stat-t td:first-child { text-align: left; }
    #bhyt-emr-panel .em-stat-t summary { cursor: pointer; color: #0d47a1; }
    #bhyt-emr-panel .em-stat-t details div { color: #444; padding-left: 8px; }
    #bhyt-emr-panel .em-stat-t i { color: #888; font-style: normal; }
    #bhyt-emr-panel .em-stat-t .em-bad { color: #c62828; font-weight: bold; }
    #bhyt-emr-panel .em-stat-t .em-sum td { font-weight: bold; background: #f5f5f5; }
    #bhyt-emr-panel .em-stat-n { margin-top: 4px; color: #555; font-family: Arial; white-space: normal; }
    #bhyt-emr-statmodal { position: fixed; inset: 0; z-index: 2147483600; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; }
    #bhyt-emr-statmodal .sm-box { width: 92vw; max-width: 1400px; height: 88vh; background: #fff; border-radius: 8px; display: flex; flex-direction: column; box-shadow: 0 8px 30px rgba(0,0,0,.4); font: 15px Arial; color: #222; }
    #bhyt-emr-statmodal .sm-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: #0d47a1; color: #fff; border-radius: 8px 8px 0 0; font-size: 16px; }
    #bhyt-emr-statmodal .sm-head span { opacity: .85; font-size: 14px; }
    #bhyt-emr-statmodal .sm-sp { flex: 1; }
    #bhyt-emr-statmodal .sm-head button { font: bold 14px Arial; padding: 5px 12px; border-radius: 4px; border: 1px solid #fff; cursor: pointer; background: #fff; color: #0d47a1; }
    #bhyt-emr-statmodal .sm-head .sm-xls { background: #1d6f42; color: #fff; border-color: #1d6f42; }
    #bhyt-emr-statmodal .sm-head .sm-close { background: #c62828; color: #fff; border-color: #c62828; }
    #bhyt-emr-statmodal .sm-body { flex: 1; overflow: auto; padding: 10px 14px; }
    #bhyt-emr-statmodal .sm-t { width: 100%; border-collapse: collapse; }
    #bhyt-emr-statmodal .sm-t > thead th { position: sticky; top: 0; background: #e8eaf6; z-index: 1; }
    #bhyt-emr-statmodal .sm-t th, #bhyt-emr-statmodal .sm-t td { border: 1px solid #c5cae9; padding: 7px 10px; text-align: right; }
    #bhyt-emr-statmodal .sm-t th { text-align: center; }
    #bhyt-emr-statmodal .sm-t td:first-child { text-align: left; }
    #bhyt-emr-statmodal .sm-t tbody tr.sm-k:nth-of-type(odd) { background: #fafbff; }
    #bhyt-emr-statmodal .sm-click { cursor: pointer; }
    #bhyt-emr-statmodal .sm-click:hover { background: #e3f2fd !important; }
    #bhyt-emr-statmodal .sm-arrow { display: inline-block; color: #0d47a1; transition: transform .15s; }
    #bhyt-emr-statmodal tr.open .sm-arrow { transform: rotate(90deg); }
    #bhyt-emr-statmodal .sm-bad { color: #c62828; font-weight: bold; }
    #bhyt-emr-statmodal tfoot td { font-weight: bold; background: #eeeeee; position: sticky; bottom: 0; }
    #bhyt-emr-statmodal .sm-det > td { background: #f7f9fc; padding: 6px 10px 10px 32px; }
    #bhyt-emr-statmodal .sm-sub { width: 100%; border-collapse: collapse; font-size: 14px; }
    #bhyt-emr-statmodal .sm-sub th, #bhyt-emr-statmodal .sm-sub td { border: 1px solid #ddd; padding: 4px 8px; text-align: left; background: #fff; }
    #bhyt-emr-statmodal .sm-sub th { background: #eef; }
    #bhyt-emr-statmodal .sm-ok { color: #1d6f42; font-weight: bold; }
    #bhyt-emr-statmodal .sm-warn { color: #e65100; }
    #bhyt-emr-statmodal .sm-note { margin-top: 8px; color: #555; font-size: 13px; }
    #bhyt-emr-panel button:disabled { opacity: .5; cursor: default; }
    #bhyt-emr-panel .em-status { padding: 0 10px; font-weight: bold; color: #0d47a1; }
    #bhyt-emr-panel .em-log { overflow: auto; max-height: 22vh; padding: 4px 10px 8px; white-space: pre-wrap; font-family: Consolas, monospace; font-size: 11px; }
  `;
  (document.head || document.documentElement).appendChild(style);

  let tries = 0;
  const t = setInterval(() => {
    if (window.jQuery && document.getElementById('phongBan')) { hookCapSo(); buildUi(); fillSoLuuTru(); clearInterval(t); }
    else if (++tries > 60) clearInterval(t);
  }, 500);
})();
