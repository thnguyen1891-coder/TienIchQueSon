// Sơ đồ giường khoa + gợi ý giường cho BN đang chọn (trang Khám bệnh nội trú).
// Chạy ở MAIN world để dùng jQuery / jqGrid / phiên đăng nhập của HIS.
// Dữ liệu:
//   - danhsachgiuongbenh_vpc            : giường khoa được cấp (DM quản lý giường VPC)
//   - noitru_danhsachbenhnhantheokhoa   : BN "ĐT có giường" (tt=1) kèm số giường
//   - noitru_ds_giuongbenh_theoloai_vpc : giường còn trống theo loại, tại giờ cấp (HIS tự tính)
// Luật đối chiếu CHECKXML: nằm ghép (cùng giường, chồng giờ > 4h phải giảm 1/2, 1/3),
// mỗi ngày tối đa 1 ngày giường, giờ cấp giường > giờ nhập viện, nằm ≤ 4h không tính giường.
(function () {
  if (window.top !== window || !/khambenhnoitru/i.test(location.pathname) || window.__bhytGiuongLoaded) return;
  window.__bhytGiuongLoaded = true;

  const LOAI = { H: 'Kế hoạch (H)', T: 'Kê thêm (T)', C: 'Tự chọn (C)', K: 'Khác (K)' };
  const LOAI_ORDER = ['H', 'T', 'C', 'K'];
  const jq = () => window.jQuery;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const nowSql = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const stripTags = s => String(s || '').replace(/<[^>]*>/g, '').trim();
  const isNam = v => v === 1 || v === true || /^(1|true|yes|nam)$/i.test(String(v).trim());

  // ---------- Cấu hình trang (khoa, đơn vị, phòng) ----------
  function pageCfg() {
    const src = Array.from(document.scripts).filter(s => !s.src).map(s => s.textContent).join('\n');
    const m = src.match(/noitru_danhsachbenhnhantheokhoa\?phongban=(\d+)[^"']*?dvtt=(\d+)/) ||
              src.match(/noitru_danhsachbenhnhantheokhoa\?phongban=(\d+)/);
    let dvtt = m && m[2];
    if (!dvtt) { const d = src.match(/dvtt\s*:\s*["'](\d+)["']/); dvtt = d && d[1]; }
    const sel = document.getElementById('tenphongbenh');
    return {
      phongban: m ? m[1] : '',
      dvtt: dvtt || '',
      maphong: sel ? sel.value : '',
      tenphong: sel && sel.selectedOptions[0] ? sel.selectedOptions[0].text.trim() : ''
    };
  }

  const ajax = (url, data, type) => jq().ajax({ url, data, type: type || 'GET', dataType: 'json', cache: false });
  const asRows = j => (Array.isArray(j) ? j : (j && j.rows) || []).map(r => (r && r.cell && !Array.isArray(r.cell) ? r.cell : r));

  // ---------- Tải dữ liệu ----------
  async function loadData() {
    const cfg = pageCfg();
    if (!cfg.phongban) throw new Error('Không đọc được mã khoa của trang Khám bệnh nội trú.');
    const [bedsRaw, ptsRaw] = await Promise.all([
      ajax('danhsachgiuongbenh_vpc', { maphongban: cfg.phongban }),
      ajax('noitru_danhsachbenhnhantheokhoa', { phongban: cfg.phongban, tt: 1, dvtt: cfg.dvtt, maphong: cfg.maphong, _search: false, rows: 2000, page: 1, sidx: '', sord: 'asc' })
    ]);
    let beds = asRows(bedsRaw);
    if (cfg.maphong) {
      const inRoom = beds.filter(b => String(b.MAPHONGBENH) === String(cfg.maphong));
      if (inRoom.length) beds = inRoom;
    }
    const loaiCo = LOAI_ORDER.filter(l => beds.some(b => b.LOAI_GIUONG === l && Number(b.TRANGTHAI) === 1));
    const ngaycap = nowSql();
    const free = {};
    await Promise.all(loaiCo.map(async l => {
      try {
        const r = await ajax('noitru_ds_giuongbenh_theoloai_vpc', {
          dvtt: cfg.dvtt, maphongban: cfg.phongban, maphongbenh: cfg.maphong, loaigiuong_vpc: l, namcung_vpc: '1', ngaycap_vpc: ngaycap
        }, 'POST');
        free[l] = new Set(asRows(r).map(x => Number(x.SO_GIUONG)));
      } catch (_) { free[l] = null; } // không lấy được → tự suy từ danh sách BN
    }));
    const pts = asRows(ptsRaw).map(p => ({
      ten: stripTags(p.TEN_BENH_NHAN || p.TEN_BENH_NHAN_HT),
      so: Number(p.SO_GIUONG_TAI_KHOA_SO) || 0,
      nam: isNam(p.GIOI_TINH),
      tuoi: p.TUOI,
      ngayvao: p.NGAYVAOKHOA || '',
      sobenhan: p.SOBENHAN || '',
      tengiuong: p.TENGIUONGBENH || ''
    }));
    return { cfg, beds, free, pts, ngaycap };
  }

  // ---------- Dựng trạng thái từng giường ----------
  function buildMap(d) {
    const ptBySo = {};
    d.pts.forEach(p => { if (p.so) (ptBySo[p.so] = ptBySo[p.so] || []).push(p); });
    const groups = {};
    const used = new Set();
    LOAI_ORDER.forEach(l => {
      const list = d.beds.filter(b => b.LOAI_GIUONG === l).sort((a, b) => a.SO_GIUONG - b.SO_GIUONG);
      if (!list.length) return;
      groups[l] = list.map(b => {
        const so = Number(b.SO_GIUONG);
        const active = Number(b.TRANGTHAI) === 1;
        const fs = d.free[l];
        let state;
        if (!active) state = 'off';
        else if (fs) state = fs.has(so) ? 'free' : 'busy';
        else state = (l === 'H' && ptBySo[so]) ? 'busy' : 'free';
        // Số giường trên danh sách BN không kèm loại: gán cho giường H trước, rồi loại khác đang bận
        let pts = [];
        if (state === 'busy' && ptBySo[so] && !used.has(so)) { pts = ptBySo[so]; used.add(so); }
        return { loai: l, so, ten: b.TEN_GIUONG, active, state, pts };
      });
    });
    // BN có số giường nhưng không khớp giường nào
    const lac = d.pts.filter(p => p.so && !used.has(p.so));
    const khongGiuong = d.pts.filter(p => !p.so);
    const all = Object.values(groups).flat();
    const act = all.filter(b => b.active);
    const sum = {
      capH: (groups.H || []).filter(b => b.active).length,
      active: act.length,
      busy: act.filter(b => b.state === 'busy').length,
      free: act.filter(b => b.state === 'free').length,
      ghep: all.filter(b => b.pts.length > 1).length,
      bn: d.pts.length
    };
    return { groups, sum, lac, khongGiuong };
  }

  // ---------- BN đang chọn trên lưới ----------
  function selectedPatient() {
    const $ = jq();
    const g = $ && $('#list_benhnhan');
    if (!g || !g.length) return null;
    const id = g.jqGrid('getGridParam', 'selrow');
    if (!id) return null;
    let r = null;
    try { r = g.jqGrid('getLocalRow', id); } catch (_) {}
    if (!r || !r.TEN_BENH_NHAN) r = g.jqGrid('getRowData', id);
    if (!r) return null;
    return {
      rowId: id,
      ten: stripTags(r.TEN_BENH_NHAN || r.TEN_BENH_NHAN_HT),
      nam: isNam(r.GIOI_TINH),
      tuoi: stripTags(r.TUOI),
      so: Number(r.SO_GIUONG_TAI_KHOA_SO) || 0,
      coGiuong: !!(r.STT_LOGGIUONGBENH && String(r.STT_LOGGIUONGBENH) !== '0') && !!Number(r.SO_GIUONG_TAI_KHOA_SO),
      ngayvao: stripTags(r.NGAYVAOKHOA),
      gioNhapVien: stripTags(r.NGAYGIO_NHAPVIEN)
    };
  }

  // ---------- Gợi ý ----------
  function suggest(map, bn) {
    const occ = {};
    Object.values(map.groups).flat().forEach(b => { if (b.state === 'busy') occ[b.loai + b.so] = b; });
    const score = b => {
      let s = 0; const why = [];
      if (b.loai === 'H') { s += 100; why.push('giường kế hoạch (H)'); }
      else { why.push(`${LOAI[b.loai]} — chỉ dùng khi hết giường H`); }
      if (bn) {
        let cung = 0, khac = 0;
        [b.so - 1, b.so + 1].forEach(n => {
          const o = occ[b.loai + n];
          (o ? o.pts : []).forEach(p => { if (p.nam === bn.nam) cung++; else khac++; });
        });
        s += cung * 3 - khac * 2;
        if (cung) why.push(`cạnh ${cung} BN cùng giới`);
        if (khac) why.push(`cạnh ${khac} BN khác giới`);
        if (!cung && !khac) why.push('hai bên trống');
      }
      s -= b.so / 1000; // ưu tiên số nhỏ khi bằng điểm
      return { b, s, why };
    };
    const frees = Object.values(map.groups).flat().filter(b => b.active && b.state === 'free');
    const ranked = frees.map(score).sort((x, y) => y.s - x.s);
    // Hết giường trống: gợi ý nằm ghép giường đang 1 người, cùng giới (phải chọn 50%)
    let ghep = [];
    if (!ranked.length) {
      ghep = Object.values(occ).filter(b => b.pts.length === 1)
        .map(b => ({ b, s: (bn && b.pts[0].nam === bn.nam ? 10 : 0) - b.so / 1000, why: ['nằm ghép 2 người → chọn "Nằm chung 1 (50%)"'] }))
        .sort((x, y) => y.s - x.s);
    }
    return { ranked, ghep };
  }

  function ruleNotes(bn, sug) {
    const n = [];
    if (bn && bn.coGiuong) {
      n.push(`BN đang nằm giường số <b>${bn.so}</b>. Đổi giường: kết thúc giường cũ (ngày/giờ rời giường) đúng lúc nhận giường mới — chồng giờ trên 4 giờ với BN khác sẽ bị CHECKXML coi là <b>nằm ghép</b>; trong 1 ngày chỉ được tính tối đa <b>1 ngày giường</b> (không kê 2 dòng giường cùng ngày).`);
    }
    if (!sug.ranked.length) {
      n.push('Khoa <b>hết giường trống</b>: nếu phải nằm ghép, tick "Nằm cùng giường" và chọn đúng số người (2 người = 50%, từ 3 người = 30%) — nằm ghép mà kê 100% sẽ bị xuất toán (TT 39/2024).');
    } else if (sug.ranked[0].b.loai !== 'H') {
      n.push('Đã hết giường kế hoạch (H): giường kê thêm chỉ dùng khi quá tải, kiểm tra lại cấu hình giường khoa.');
    }
    n.push('Giờ cấp giường phải <b>sau giờ nhập viện</b>; điều trị ≤ 4 giờ không được tính tiền giường.');
    return n;
  }

  // ---------- Mở form cấp giường gốc của HIS và chọn sẵn ----------
  async function waitFor(fn, ms) {
    // HIS ghi đè Date.now() (trả về đối tượng Date) → dùng performance.now()
    const end = performance.now() + (ms || 8000);
    while (performance.now() < end) { const v = fn(); if (v) return v; await sleep(150); }
    return null;
  }

  async function openHisForm(bn, bed, opts) {
    const $ = jq();
    const banngay = !!(opts && opts.banngay);
    const ghep = !!(opts && opts.ghep);
    const tr = document.querySelector(`#list_benhnhan tr.jqgrow[id="${CSS.escape(bn.rowId)}"]`);
    if (!tr) throw new Error('Không thấy dòng BN trên lưới, chọn lại BN.');
    // Đợi sự kiện click của nút trong panel lan xong, nếu không menu HIS vừa mở sẽ bị đóng ngay
    await sleep(120);
    try { $(tr).contextMenu('hide'); } catch (_) {} // menu còn kẹt trạng thái mở thì lệnh mở sẽ không hiện
    await sleep(80);
    const r = tr.getBoundingClientRect();
    $(tr).contextMenu({ x: r.left + 40, y: r.top + 5 });
    const label = banngay ? /^Cập nhật giường ban ngày bệnh nhân/ : /^Cập nhật giường bệnh nhân$/;
    const item = await waitFor(() => Array.from(document.querySelectorAll('.context-menu-item'))
      .find(e => e.offsetParent && label.test(e.textContent.trim())), 3000);
    if (!item) throw new Error('Không mở được menu chuột phải của HIS.');
    $(item).trigger('mouseup');

    const P = banngay ? 'cgbn_' : 'cg_';
    const loaiSel = await waitFor(() => { const e = document.getElementById(`${P}loaigiuongke_giuongbenh_cv3176`); return e && e.offsetParent ? e : null; }, 8000);
    if (!loaiSel) throw new Error('Form cấp giường chưa mở (BN thuộc khoa khác hoặc chưa có bệnh án chính thức?).');
    await sleep(600); // để HIS nạp xong phòng/giường mặc định
    if (ghep) {
      const chk = document.getElementById(`${P}namcunggiuong_cv3176`) || document.getElementById('cg_namcunggiuong_cv3176');
      if (chk && !chk.checked) { chk.click(); await sleep(800); }
      const nc = document.getElementById(`${P}songuoinamcung_cv3176`);
      if (nc && Array.from(nc.options).some(o => o.value === '2')) { nc.value = '2'; nc.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    loaiSel.value = bed.loai;
    loaiSel.dispatchEvent(new Event('change', { bubbles: true }));
    const soSel = document.getElementById(`${P}sostt_giuongbenh_vpc_cv3176`);
    const ok = await waitFor(() => soSel && Array.from(soSel.options).some(o => Number(o.value) === bed.so), 6000);
    if (!ok) {
      flash(soSel);
      throw new Error(`HIS không cho chọn giường ${bed.loai}${pad3(bed.so)} tại giờ cấp này (có thể vừa có BN khác nhận). Chọn giường khác trong form.`);
    }
    // HIS còn nạp phòng/giường mặc định bất đồng bộ sau khi mở form và có thể đổi lại lựa chọn → chọn lại tới khi đứng yên
    for (let i = 0; i < 6; i++) {
      if (loaiSel.value !== bed.loai) { loaiSel.value = bed.loai; loaiSel.dispatchEvent(new Event('change', { bubbles: true })); }
      await waitFor(() => Array.from(soSel.options).some(o => Number(o.value) === bed.so), 3000);
      const opt = Array.from(soSel.options).find(o => Number(o.value) === bed.so);
      if (opt && soSel.value !== opt.value) { soSel.value = opt.value; soSel.dispatchEvent(new Event('change', { bubbles: true })); }
      await sleep(700);
      if (loaiSel.value === bed.loai && Number(soSel.value) === bed.so) { if (i >= 1) break; }
    }
    if (Number(soSel.value) !== bed.so) throw new Error(`Không giữ được lựa chọn giường ${bed.loai}${pad3(bed.so)} trên form HIS, chọn tay trong form.`);
    // Lịch chọn ngày của HIS tự bật khi form mở, che mất ô loại/số giường
    try { if ($.datepicker) $.datepicker._hideDatepicker(); } catch (_) {}
    try { if (document.activeElement && /^INPUT$/.test(document.activeElement.tagName)) document.activeElement.blur(); } catch (_) {}
    flash(soSel); flash(loaiSel);
    const btn = document.getElementById(`${P}bt_capnhat_cv3176`) || document.getElementById('cp_bt_capgiuong_cv3176');
    if (btn) flash(btn);
  }

  const pad3 = n => String(n).padStart(3, '0');
  function flash(el) {
    if (!el) return;
    el.style.outline = '3px solid #f59e0b';
    el.style.outlineOffset = '1px';
    setTimeout(() => { el.style.outline = ''; el.style.outlineOffset = ''; }, 6000);
  }

  // ---------- Giao diện ----------
  let state = null;   // { d, map }
  let target = null;  // giường đang chọn trong panel

  function css() {
    if (document.getElementById('bhyt-gm-css')) return;
    const s = document.createElement('style');
    s.id = 'bhyt-gm-css';
    s.textContent = `
    #bhyt-gm-launch { position: fixed; left: 150px; bottom: 12px; z-index: 2147483000; padding: 6px 12px; font: bold 12px Arial;
      color: #fff; background: #0f766e; border: 0; border-radius: 4px; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,.3); }
    #bhyt-gm-launch:hover { background: #115e59; }
    #bhyt-gm-panel { display: none; position: fixed; inset: 40px 40px 56px auto; width: min(980px, calc(100vw - 80px)); z-index: 2147483001;
      background: #fff; color: #1f2937; border: 1px solid #94a3b8; border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,.35);
      font: 13px Arial, sans-serif; flex-direction: column; overflow: hidden; }
    #bhyt-gm-panel.open { display: flex; }
    #bhyt-gm-panel .gm-head { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: #0f766e; color: #fff; }
    #bhyt-gm-panel .gm-head b { flex: 1; font-size: 14px; }
    #bhyt-gm-panel .gm-head button { background: rgba(255,255,255,.15); color: #fff; border: 1px solid rgba(255,255,255,.4); border-radius: 4px; padding: 3px 10px; cursor: pointer; }
    #bhyt-gm-panel .gm-body { flex: 1; overflow: auto; padding: 10px 12px; }
    #bhyt-gm-panel .gm-stats { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
    #bhyt-gm-panel .gm-stat { border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 10px; min-width: 110px; }
    #bhyt-gm-panel .gm-stat i { display: block; font-style: normal; color: #64748b; font-size: 11px; }
    #bhyt-gm-panel .gm-stat b { font-size: 18px; }
    #bhyt-gm-panel .gm-bar { height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden; margin-top: 4px; }
    #bhyt-gm-panel .gm-bar span { display: block; height: 100%; background: #0f766e; }
    #bhyt-gm-panel .gm-sug { border: 1px solid #99f6e4; background: #f0fdfa; border-radius: 6px; padding: 8px 10px; margin-bottom: 10px; }
    #bhyt-gm-panel .gm-sug h4 { margin: 0 0 6px; font-size: 13px; }
    #bhyt-gm-panel .gm-sug .gm-opt { display: inline-flex; align-items: center; gap: 6px; margin: 2px 8px 2px 0; padding: 4px 8px; border: 1px solid #5eead4;
      border-radius: 4px; background: #fff; cursor: pointer; }
    #bhyt-gm-panel .gm-sug .gm-opt.sel { background: #ccfbf1; border-color: #0f766e; font-weight: bold; }
    #bhyt-gm-panel .gm-sug .gm-opt small { color: #475569; font-weight: normal; }
    #bhyt-gm-panel .gm-acts { margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap; }
    #bhyt-gm-panel .gm-acts button { padding: 5px 12px; border-radius: 4px; border: 1px solid #0f766e; background: #0f766e; color: #fff; cursor: pointer; font-weight: bold; }
    #bhyt-gm-panel .gm-acts button.alt { background: #fff; color: #0f766e; }
    #bhyt-gm-panel .gm-acts button:disabled { opacity: .5; cursor: default; }
    #bhyt-gm-panel .gm-note { margin: 6px 0 0; padding-left: 18px; color: #7c2d12; font-size: 12px; }
    #bhyt-gm-panel .gm-note li { margin: 2px 0; }
    #bhyt-gm-panel .gm-msg { margin-top: 6px; font-size: 12px; }
    #bhyt-gm-panel .gm-msg.err { color: #b91c1c; } #bhyt-gm-panel .gm-msg.ok { color: #047857; }
    #bhyt-gm-panel h3 { margin: 12px 0 6px; font-size: 13px; color: #334155; }
    #bhyt-gm-panel .gm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 6px; }
    #bhyt-gm-panel .gm-bed { border: 1px solid #cbd5e1; border-radius: 6px; padding: 5px 6px; min-height: 46px; position: relative; font-size: 11px; line-height: 1.3; }
    #bhyt-gm-panel .gm-bed .n { font-weight: bold; font-size: 13px; }
    #bhyt-gm-panel .gm-bed.free { background: #ecfdf5; border-color: #6ee7b7; cursor: pointer; }
    #bhyt-gm-panel .gm-bed.free:hover, #bhyt-gm-panel .gm-bed.sel { outline: 2px solid #0f766e; }
    #bhyt-gm-panel .gm-bed.busy { background: #fff7ed; border-color: #fdba74; }
    #bhyt-gm-panel .gm-bed.ghep { background: #fef2f2; border-color: #f87171; }
    #bhyt-gm-panel .gm-bed.off { background: #f1f5f9; color: #94a3b8; border-style: dashed; }
    #bhyt-gm-panel .gm-bed.me { box-shadow: inset 0 0 0 2px #2563eb; }
    #bhyt-gm-panel .gm-bed .p { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #bhyt-gm-panel .gm-bed .tag { position: absolute; top: 4px; right: 5px; font-size: 10px; color: #475569; }
    #bhyt-gm-panel .gm-legend { display: flex; gap: 12px; flex-wrap: wrap; font-size: 11px; color: #475569; margin-top: 4px; }
    #bhyt-gm-panel .gm-legend span::before { content: ''; display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; border: 1px solid; }
    #bhyt-gm-panel .gm-legend .l-free::before { background: #ecfdf5; border-color: #6ee7b7; }
    #bhyt-gm-panel .gm-legend .l-busy::before { background: #fff7ed; border-color: #fdba74; }
    #bhyt-gm-panel .gm-legend .l-ghep::before { background: #fef2f2; border-color: #f87171; }
    #bhyt-gm-panel .gm-legend .l-off::before { background: #f1f5f9; border-color: #cbd5e1; border-style: dashed; }
    #bhyt-gm-panel .gm-legend .l-me::before { background: #fff; border-color: #2563eb; }
    #bhyt-gm-panel .gm-warn { color: #b45309; font-size: 12px; margin-top: 8px; }
    #bhyt-gm-panel .gm-load { padding: 30px; text-align: center; color: #64748b; }
    `;
    document.head.appendChild(s);
  }

  function buildUi() {
    if (document.getElementById('bhyt-gm-launch') || !document.getElementById('list_benhnhan')) return;
    css();
    const btn = document.createElement('button');
    btn.id = 'bhyt-gm-launch';
    btn.type = 'button';
    btn.textContent = '🛏 Sơ đồ giường';
    btn.title = 'Xem giường khoa được cấp / còn trống và gợi ý giường cho BN đang chọn';
    document.body.appendChild(btn);

    const panel = document.createElement('div');
    panel.id = 'bhyt-gm-panel';
    panel.innerHTML = `<div class="gm-head"><b>Sơ đồ giường khoa</b><button type="button" class="gm-reload">↻ Tải lại</button><button type="button" class="gm-x">✕</button></div>
      <div class="gm-body"><div class="gm-load">Đang tải…</div></div>`;
    document.body.appendChild(panel);

    btn.addEventListener('click', () => {
      if (panel.classList.contains('open')) { panel.classList.remove('open'); return; }
      panel.classList.add('open');
      refresh();
    });
    panel.querySelector('.gm-x').addEventListener('click', () => panel.classList.remove('open'));
    panel.querySelector('.gm-reload').addEventListener('click', refresh);
    panel.addEventListener('click', onPanelClick);

    // Đổi BN trên lưới → cập nhật gợi ý nếu panel đang mở
    const $ = jq();
    if ($) $(document).on('click.bhytgm', '#list_benhnhan tr.jqgrow', () => {
      if (panel.classList.contains('open') && state) { target = null; render(); }
    });
  }

  async function refresh() {
    const body = document.querySelector('#bhyt-gm-panel .gm-body');
    body.innerHTML = '<div class="gm-load">Đang tải danh mục giường và danh sách BN…</div>';
    try {
      const d = await loadData();
      state = { d, map: buildMap(d) };
      target = null;
      render();
    } catch (e) {
      body.innerHTML = `<div class="gm-load gm-msg err">Lỗi tải dữ liệu: ${esc(e && (e.message || e.statusText) || e)}</div>`;
    }
  }

  function bedLabel(b) { return `${b.loai}${pad3(b.so)}`; }

  function render(msg) {
    if (!state) return;
    const { d, map } = state;
    const bn = selectedPatient();
    const sug = suggest(map, bn);
    const list = sug.ranked.length ? sug.ranked : sug.ghep;
    const isGhep = !sug.ranked.length;
    if (!target && list.length) target = list[0].b;
    const s = map.sum;
    const pct = s.active ? Math.round(s.busy * 100 / s.active) : 0;

    const sugHtml = bn ? `
      <div class="gm-sug">
        <h4>Gợi ý giường cho: ${esc(bn.ten)} (${bn.nam ? 'Nam' : 'Nữ'}${bn.tuoi ? ', ' + esc(bn.tuoi) + ' tuổi' : ''})${bn.coGiuong ? ` — đang nằm giường số ${bn.so}` : ''}</h4>
        <div>${list.slice(0, 5).map(x => `<span class="gm-opt${target && target.loai === x.b.loai && target.so === x.b.so ? ' sel' : ''}" data-l="${x.b.loai}" data-s="${x.b.so}">
            ${bedLabel(x.b)} <small>${esc(x.why.join(', '))}</small></span>`).join('') || '<i>Không còn giường nào để gợi ý.</i>'}</div>
        <div class="gm-acts">
          <button type="button" class="gm-apply" data-bn="0" ${target ? '' : 'disabled'}>Mở form "Cập nhật giường bệnh nhân" & chọn sẵn ${target ? bedLabel(target) : ''}</button>
          <button type="button" class="gm-apply alt" data-bn="1" ${target ? '' : 'disabled'}>…giường ban ngày</button>
        </div>
        <ul class="gm-note">${ruleNotes(bn, sug).map(t => `<li>${t}</li>`).join('')}</ul>
        <div class="gm-msg${msg ? ' ' + msg.cls : ''}">${msg ? esc(msg.text) : 'Extension chỉ chọn sẵn loại + số giường; kiểm tra giờ cấp rồi tự bấm <b>Cấp giường / Cập nhật</b> trên form HIS.'}</div>
      </div>` : `<div class="gm-sug"><h4>Chọn 1 bệnh nhân trên lưới "Danh sách bệnh nhân" để được gợi ý giường.</h4>
        <ul class="gm-note">${ruleNotes(null, sug).map(t => `<li>${t}</li>`).join('')}</ul></div>`;

    const groupsHtml = LOAI_ORDER.filter(l => map.groups[l]).map(l => {
      const g = map.groups[l];
      const act = g.filter(b => b.active);
      return `<h3>${LOAI[l]} — ${act.length} giường hoạt động, trống ${act.filter(b => b.state === 'free').length}${g.length > act.length ? `, ${g.length - act.length} giường tắt` : ''}</h3>
        <div class="gm-grid">${g.map(b => {
          const cls = ['gm-bed', b.state === 'busy' && b.pts.length > 1 ? 'ghep' : b.state];
          if (bn && bn.coGiuong && b.loai === 'H' && b.so === bn.so) cls.push('me');
          if (target && target.loai === b.loai && target.so === b.so) cls.push('sel');
          const who = b.pts.map(p => `<div class="p" title="${esc(p.ten)} — ${p.nam ? 'Nam' : 'Nữ'} ${esc(p.tuoi)}t — vào khoa ${esc(p.ngayvao)}">${p.nam ? '♂' : '♀'} ${esc(p.ten)}</div>`).join('');
          const txt = b.state === 'off' ? '<div>Không hoạt động</div>'
            : b.state === 'free' ? '<div>Trống</div>'
            : (who || '<div title="HIS báo giường đang có người (VD: BN ban ngày / BN chưa lên DS)">Có người</div>');
          return `<div class="${cls.join(' ')}" data-l="${b.loai}" data-s="${b.so}" title="${esc(b.ten)}"><span class="n">${b.so}</span><span class="tag">${b.loai}</span>${txt}</div>`;
        }).join('')}</div>`;
    }).join('');

    const warn = [];
    if (s.ghep) warn.push(`${s.ghep} giường đang có từ 2 BN trở lên — kiểm tra đã chọn đúng "nằm chung" (50%/30%) chưa, tránh lỗi nằm ghép của CHECKXML.`);
    if (map.lac.length) warn.push(`${map.lac.length} BN có số giường không khớp danh mục giường: ${map.lac.slice(0, 5).map(p => esc(p.ten) + ' (số ' + p.so + ')').join(', ')}.`);
    Object.keys(d.free).forEach(l => { if (d.free[l] === null) warn.push(`Không lấy được danh sách giường trống loại ${l} từ HIS, đang suy từ danh sách BN.`); });

    document.querySelector('#bhyt-gm-panel .gm-head b').textContent =
      `Sơ đồ giường — ${d.cfg.tenphong || 'khoa'} (lúc ${d.ngaycap.slice(11, 16)})`;
    document.querySelector('#bhyt-gm-panel .gm-body').innerHTML = `
      <div class="gm-stats">
        <div class="gm-stat"><i>Giường kế hoạch được cấp</i><b>${s.capH}</b></div>
        <div class="gm-stat"><i>Giường đang hoạt động</i><b>${s.active}</b></div>
        <div class="gm-stat"><i>Đang có BN</i><b>${s.busy}</b></div>
        <div class="gm-stat"><i>Còn trống</i><b style="color:#047857">${s.free}</b></div>
        <div class="gm-stat"><i>Công suất</i><b>${pct}%</b><div class="gm-bar"><span style="width:${Math.min(pct, 100)}%"></span></div></div>
        <div class="gm-stat"><i>BN ĐT có giường</i><b>${s.bn}</b></div>
      </div>
      ${sugHtml}
      <div class="gm-legend"><span class="l-free">Trống (bấm để chọn)</span><span class="l-busy">Có BN</span><span class="l-ghep">Nằm ghép</span><span class="l-off">Không hoạt động</span><span class="l-me">Giường hiện tại của BN chọn</span></div>
      ${groupsHtml}
      ${warn.map(w => `<div class="gm-warn">⚠ ${w}</div>`).join('')}`;
  }

  async function onPanelClick(e) {
    if (!state) return;
    const pick = e.target.closest('.gm-opt, .gm-bed.free');
    if (pick) {
      const l = pick.dataset.l, so = Number(pick.dataset.s);
      target = Object.values(state.map.groups).flat().find(b => b.loai === l && b.so === so) || null;
      render();
      return;
    }
    const ap = e.target.closest('.gm-apply');
    if (ap && target) {
      const bn = selectedPatient();
      if (!bn) { render({ cls: 'err', text: 'Chưa chọn BN trên lưới.' }); return; }
      ap.disabled = true;
      try {
        await openHisForm(bn, target, { banngay: ap.dataset.bn === '1', ghep: target.state === 'busy' });
        document.getElementById('bhyt-gm-panel').classList.remove('open');
      } catch (err) {
        render({ cls: 'err', text: String(err && err.message || err) });
      }
    }
  }

  const t = setInterval(() => { if (jq() && document.getElementById('list_benhnhan')) { buildUi(); clearInterval(t); } }, 1500);
})();
