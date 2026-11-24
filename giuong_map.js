// Sơ đồ giường khoa + gợi ý giường cho BN (trang Khám bệnh nội trú).
// Chạy ở MAIN world để dùng jQuery / jqGrid / phiên đăng nhập của HIS.
// Dữ liệu:
//   - danhsachgiuongbenh_vpc            : giường khoa được cấp (DM quản lý giường VPC)
//   - noitru_danhsachbenhnhantheokhoa   : BN theo trạng thái: 1 = ĐT có giường, 0 = Mới vào khoa, 2 = ĐT không giường
//   - noitru_ds_capgiuong_svv_cv3176    : lịch sử nằm giường từng BN (giờ nhận → giờ ra, số giường, loại)
//   - noitru_ds_giuongbenh_theoloai_vpc : giường còn trống theo loại tại giờ cấp (HIS tự tính)
// Luật đối chiếu CHECKXML: nằm ghép (cùng giường, chồng giờ > 4h phải giảm 1/2, 1/3; ≤ 4h là bàn giao),
// mỗi ngày tối đa 1 ngày giường, giờ cấp giường > giờ nhập viện, nằm ≤ 4h không tính giường.
(function () {
  if (window.top !== window || !/khambenhnoitru/i.test(location.pathname) || window.__bhytGiuongLoaded) return;
  window.__bhytGiuongLoaded = true;

  const LOAI = { H: 'Kế hoạch (H)', T: 'Kê thêm (T)', C: 'Tự chọn (C)', K: 'Khác (K)' };
  const LOAI_ORDER = ['H', 'T', 'C', 'K'];
  const TT_NAME = { 0: 'Mới vào khoa', 1: 'ĐT có giường', 2: 'ĐT không giường' };
  const GHEP_MIN = 240; // chồng giờ trên 4 giờ = nằm ghép (CHECKXML CROSS_BED_SHARED)
  const MIN = 60000;
  const jq = () => window.jQuery;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const now = () => new Date().getTime(); // HIS ghi đè Date.now() (trả về đối tượng Date) → không dùng
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const pad3 = n => String(n).padStart(3, '0');
  const stripTags = s => String(s || '').replace(/<[^>]*>/g, '').trim();
  const isNam = v => v === 1 || v === true || /^(1|true|yes|nam)$/i.test(String(v).trim());

  // ---------- Thời gian ----------
  function parseVN(s) { // "dd/mm/yyyy HH:mm[:ss]" → ms
    const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return null;
    return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
  }
  const D = ms => new Date(ms);
  const toSql = ms => { const d = D(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const toDateVN = ms => { const d = D(ms); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`; };
  const toTimeVN = ms => { const d = D(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const toInput = ms => { const d = D(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fromInput = s => { const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : null; };
  const fmt = ms => { if (ms == null || !isFinite(ms)) return '…'; const d = D(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
  const dur = m => m >= 1440 ? `${Math.floor(m / 1440)} ngày ${Math.round((m % 1440) / 60)} giờ` : m >= 60 ? `${Math.floor(m / 60)} giờ ${m % 60} phút` : `${m} phút`;
  const floorMin = ms => Math.floor(ms / MIN) * MIN;

  // ---------- Cấu hình trang (khoa, đơn vị, phòng) ----------
  function pageCfg() {
    const src = Array.from(document.scripts).filter(s => !s.src).map(s => s.textContent).join('\n');
    const m = src.match(/noitru_danhsachbenhnhantheokhoa\?phongban=(\d+)/);
    const d = src.match(/noitru_danhsachbenhnhantheokhoa\?phongban=\d+[^;]*?dvtt=(\d+)/) || src.match(/dvtt\s*:\s*["'](\d+)["']/);
    const sel = document.getElementById('tenphongbenh');
    return {
      phongban: m ? m[1] : '',
      dvtt: d ? d[1] : '',
      maphong: sel ? sel.value : '',
      tenphong: sel && sel.selectedOptions[0] ? sel.selectedOptions[0].text.trim() : ''
    };
  }
  const curTT = () => { const r = document.querySelector('input[name=trangthaikham]:checked'); return r ? String(r.value) : ''; };

  const ajax = (url, data, type) => jq().ajax({ url, data, type: type || 'GET', dataType: 'json', cache: false });
  const asRows = j => (Array.isArray(j) ? j : (j && j.rows) || []).map(r => (r && r.cell && !Array.isArray(r.cell) ? r.cell : r));

  async function pool(items, n, fn) {
    const out = new Array(items.length); let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch (_) { out[k] = null; } }
    }));
    return out;
  }

  // ---------- Bệnh nhân ----------
  const ptKey = r => `${r.STT_BENHAN || ''}|${r.STT_DOTDIEUTRI || ''}`;
  function normPt(r, tt) {
    return {
      key: ptKey(r),
      tt: String(tt),
      ten: stripTags(r.TEN_BENH_NHAN || r.TEN_BENH_NHAN_HT),
      nam: isNam(r.GIOI_TINH),
      tuoi: stripTags(r.TUOI),
      sobenhan: stripTags(r.SOBENHAN),
      so: Number(r.SO_GIUONG_TAI_KHOA_SO) || 0,
      vaokhoa: typeof r.NGAYVAO === 'number' ? r.NGAYVAO : parseVN(r.NGAYVAO) || parseVN(r.NGAYVAOKHOA),
      nhapvien: parseVN(r.NGAYGIO_NHAPVIEN) || (typeof r.NGAYNHAPVIEN === 'number' ? r.NGAYNHAPVIEN : null),
      q: { sovaovien: r.SOVAOVIEN, sovaovien_dt: r.SOVAOVIEN_DT, stt_benhan: r.STT_BENHAN, stt_dotdieutri: r.STT_DOTDIEUTRI },
      hist: [],
      cur: null // đợt nằm giường hiện tại { loai, so, from, to }
    };
  }

  // Lịch sử giường → các khoảng nằm, gộp các ngày liền nhau cùng 1 giường
  function buildHist(p, rows) {
    const recs = rows.map(x => ({
      loai: String(x.LOAI_GIUONG_TAI_KHOA || 'H').trim().toUpperCase().charAt(0) || 'H',
      so: Number(x.SO_GIUONG_TAI_KHOA_SO) || 0,
      from: parseVN(x.NGAY_TH_YLENH) || parseVN(x.NGAYVAO),
      to: parseVN(x.NGAYRA),
      songuoi: Number(x.SO_NGUOI_NAM) || 1
    })).filter(x => x.so && x.from).sort((a, b) => a.from - b.from);
    const runs = [];
    recs.forEach(x => {
      const last = runs[runs.length - 1];
      if (last && last.loai === x.loai && last.so === x.so && x.from - (last.to || x.from) <= 10 * MIN) {
        last.to = Math.max(last.to || 0, x.to || 0) || null; last.ngay++;
      } else runs.push({ loai: x.loai, so: x.so, from: x.from, to: x.to, songuoi: x.songuoi, ngay: 1 });
    });
    p.hist = runs;
    // BN đang có giường: đợt cuối là giường đang nằm, chưa rời (NGAYRA chỉ là giờ chốt ngày giường)
    if (p.tt === '1' && runs.length) p.cur = { ...runs[runs.length - 1], open: true };
    else if (p.tt === '1' && p.so) p.cur = { loai: 'H', so: p.so, from: p.vaokhoa, to: null, open: true, ngay: 0 };
  }

  // ---------- Tải dữ liệu ----------
  async function loadBase() {
    const cfg = pageCfg();
    if (!cfg.phongban) throw new Error('Không đọc được mã khoa của trang Khám bệnh nội trú.');
    const listQ = tt => ajax('noitru_danhsachbenhnhantheokhoa', { phongban: cfg.phongban, tt, dvtt: cfg.dvtt, maphong: cfg.maphong, _search: false, rows: 2000, page: 1, sidx: '', sord: 'asc' })
      .then(j => asRows(j).map(r => normPt(r, tt)), () => []);
    const [bedsRaw, co, moi, khong] = await Promise.all([
      ajax('danhsachgiuongbenh_vpc', { maphongban: cfg.phongban }), listQ(1), listQ(0), listQ(2)
    ]);
    let beds = asRows(bedsRaw);
    if (cfg.maphong) {
      const inRoom = beds.filter(b => String(b.MAPHONGBENH) === String(cfg.maphong));
      if (inRoom.length) beds = inRoom;
    }
    const pts = [...co, ...moi, ...khong];
    await pool(pts, 6, async p => {
      if (!p.q.sovaovien) return;
      const h = await ajax('noitru_ds_capgiuong_svv_cv3176', { ...p.q, dvtt: cfg.dvtt, _search: false, rows: 500, page: 1, sidx: '', sord: 'asc' });
      buildHist(p, asRows(h));
    });
    pts.forEach(p => { if (p.tt === '1' && !p.cur && p.so) p.cur = { loai: 'H', so: p.so, from: p.vaokhoa, to: null, open: true, ngay: 0 }; });
    return { cfg, beds, pts, loaiCo: LOAI_ORDER.filter(l => beds.some(b => b.LOAI_GIUONG === l && Number(b.TRANGTHAI) === 1)) };
  }

  // Giường trống theo HIS tại thời điểm T
  async function loadFree(base, T) {
    const free = {};
    await Promise.all(base.loaiCo.map(async l => {
      try {
        const r = await ajax('noitru_ds_giuongbenh_theoloai_vpc', {
          dvtt: base.cfg.dvtt, maphongban: base.cfg.phongban, maphongbenh: base.cfg.maphong, loaigiuong_vpc: l, namcung_vpc: '1', ngaycap_vpc: toSql(T)
        }, 'POST');
        free[l] = new Set(asRows(r).map(x => Number(x.SO_GIUONG)));
      } catch (_) { free[l] = null; }
    }));
    return free;
  }

  // ---------- Khoảng nằm của mọi BN trên từng giường ----------
  function intervalsByBed(base) {
    const by = {};
    base.pts.forEach(p => {
      p.hist.forEach((r, i) => {
        const isCur = p.cur && i === p.hist.length - 1 && p.cur.open;
        (by[r.loai + r.so] = by[r.loai + r.so] || []).push({ p, from: r.from, to: isCur ? Infinity : (r.to || r.from), cur: isCur });
      });
      if (p.cur && !p.hist.length) (by[p.cur.loai + p.cur.so] = by[p.cur.loai + p.cur.so] || []).push({ p, from: p.cur.from || 0, to: Infinity, cur: true });
    });
    return by;
  }

  // Xung đột khi BN `who` nhận giường `key` trong [T, R]
  function conflicts(ivs, key, who, T, R) {
    const out = [];
    (ivs[key] || []).forEach(iv => {
      if (who && iv.p.key === who.key) return;
      const ov = (Math.min(R, iv.to) - Math.max(T, iv.from)) / MIN;
      if (ov > 0) out.push({ iv, ov: Math.round(ov), ghep: ov > GHEP_MIN });
    });
    return out;
  }

  // ---------- Trạng thái giường tại [T, R] ----------
  function buildMap(base, free, who, T, R) {
    const ivs = intervalsByBed(base);
    const groups = {};
    LOAI_ORDER.forEach(l => {
      const list = base.beds.filter(b => b.LOAI_GIUONG === l).sort((a, b) => a.SO_GIUONG - b.SO_GIUONG);
      if (!list.length) return;
      groups[l] = list.map(b => {
        const so = Number(b.SO_GIUONG), key = l + so;
        const active = Number(b.TRANGTHAI) === 1;
        const occ = (ivs[key] || []).filter(iv => iv.cur); // đang nằm hiện tại
        const cf = conflicts(ivs, key, who, T, R);
        const hisFree = free[l] ? free[l].has(so) : !occ.length;
        let state;
        if (!active) state = 'off';
        else if (cf.some(c => c.ghep)) state = 'busy';
        else if (!hisFree) state = 'busy';
        else state = 'free';
        return { loai: l, so, key, ten: b.TEN_GIUONG, active, state, occ, cf, hisFree, warn: state === 'free' && cf.length > 0 };
      });
    });
    const all = Object.values(groups).flat();
    const act = all.filter(b => b.active);
    const sum = {
      capH: (groups.H || []).filter(b => b.active).length,
      active: act.length,
      dangNam: act.filter(b => b.occ.length).length,
      free: act.filter(b => b.state === 'free').length,
      ghep: all.filter(b => b.occ.length > 1).length,
      bn: base.pts.filter(p => p.tt === '1').length,
      cho: base.pts.filter(p => p.tt !== '1').length
    };
    return { groups, sum, ivs };
  }

  // ---------- Gợi ý ----------
  function suggest(map, who) {
    const occAt = {};
    Object.values(map.groups).flat().forEach(b => { occAt[b.key] = b.occ; });
    const score = b => {
      let s = 0; const why = [];
      if (b.loai === 'H') { s += 100; why.push('giường kế hoạch'); } else why.push(`${LOAI[b.loai]} — chỉ khi hết giường H`);
      if (b.warn) { s -= 8; why.push(`trùng ${Math.max(...b.cf.map(c => c.ov))} phút lúc bàn giao`); }
      if (who) {
        let cung = 0, khac = 0;
        [b.so - 1, b.so + 1].forEach(n => (occAt[b.loai + n] || []).forEach(iv => { if (iv.p.nam === who.nam) cung++; else khac++; }));
        s += cung * 3 - khac * 2;
        if (cung) why.push(`cạnh ${cung} BN cùng giới`);
        if (khac) why.push(`cạnh ${khac} BN khác giới`);
        if (!cung && !khac) why.push('hai bên trống');
      }
      s -= b.so / 1000;
      return { b, s, why };
    };
    const ranked = Object.values(map.groups).flat().filter(b => b.active && b.state === 'free').map(score).sort((x, y) => y.s - x.s);
    let ghep = [];
    if (!ranked.length) {
      ghep = Object.values(map.groups).flat().filter(b => b.active && b.occ.length === 1)
        .map(b => ({ b, s: (who && b.occ[0].p.nam === who.nam ? 10 : 0) - b.so / 1000, why: ['nằm ghép 2 người → chọn "Nằm chung 1 (50%)"'] }))
        .sort((x, y) => y.s - x.s);
    }
    return { ranked, ghep };
  }

  function ruleNotes(who, T, R, target, sug) {
    const err = [], warn = [];
    if (who) {
      if (who.nhapvien && T <= who.nhapvien) err.push(`Giờ nhận giường phải <b>sau giờ nhập viện</b> (${fmt(who.nhapvien)}).`);
      if (who.vaokhoa && T < who.vaokhoa) warn.push(`Giờ nhận giường trước giờ vào khoa (${fmt(who.vaokhoa)}).`);
      if (T > now() + 30 * MIN) warn.push('Giờ nhận giường đang ở tương lai.');
      if (R !== Infinity) {
        if (R <= T) err.push('Giờ rời giường phải sau giờ nhận giường.');
        else if (R - T <= 4 * 60 * MIN) warn.push(`Nằm ${dur(Math.round((R - T) / MIN))} (≤ 4 giờ): <b>không được tính tiền giường</b> (TT22 Đ6 K1 đ).`);
      }
      if (who.cur && who.cur.open) {
        warn.push(`BN đang nằm giường <b>${who.cur.loai}${pad3(who.cur.so)}</b> từ ${fmt(who.cur.from)}. Đổi giường: giường cũ phải <b>rời đúng lúc ${fmt(T)}</b>; trong 1 ngày chỉ tính tối đa <b>1 ngày giường</b> (không kê 2 dòng giường cùng ngày).`);
      }
    }
    if (target) {
      target.cf.forEach(c => {
        const t = c.iv.to === Infinity ? 'đang nằm' : `nằm tới ${fmt(c.iv.to)}`;
        (c.ghep ? err : warn).push(`Giường ${target.loai}${pad3(target.so)}: BN <b>${esc(c.iv.p.ten)}</b> ${t} (từ ${fmt(c.iv.from)}) — chồng <b>${dur(c.ov)}</b> ${c.ghep
          ? '→ CHECKXML tính là <b>nằm ghép</b>, phải chọn nằm chung (50%/30%).'
          : '(bàn giao ≤ 4 giờ): nên lùi giờ nhận giường cho khớp giờ BN kia rời giường để khỏi bị cảnh báo.'}`);
      });
      if (!target.hisFree && !target.cf.length) warn.push(`HIS báo giường ${target.loai}${pad3(target.so)} không trống tại ${fmt(T)} (có thể BN ban ngày / BN đã chuyển).`);
    }
    if (!sug.ranked.length) err.push('Khoa <b>hết giường trống</b> tại thời điểm này: nếu phải nằm ghép, tick "Nằm cùng giường" và chọn đúng số người (2 người = 50%, từ 3 người = 30%) — kê 100% sẽ bị xuất toán.');
    else if (sug.ranked[0].b.loai !== 'H') warn.push('Đã hết giường kế hoạch (H): giường kê thêm chỉ dùng khi quá tải.');
    return { err, warn };
  }

  // ---------- Mở form cấp giường gốc của HIS và điền sẵn ----------
  async function waitFor(fn, ms) {
    const end = performance.now() + (ms || 8000);
    while (performance.now() < end) { const v = fn(); if (v) return v; await sleep(150); }
    return null;
  }

  let selectingRow = false;
  // Đưa BN lên lưới (đổi tab trạng thái nếu cần) và chọn dòng của BN
  async function focusGridRow(who) {
    const $ = jq();
    const g = $('#list_benhnhan');
    const findRow = () => {
      for (const id of g.jqGrid('getDataIDs') || []) {
        let r = null;
        try { r = g.jqGrid('getLocalRow', id); } catch (_) {}
        if (!r || !r.STT_BENHAN) r = g.jqGrid('getRowData', id);
        if (r && ptKey(r) === who.key) return id;
      }
      return null;
    };
    let id = findRow();
    if (!id && who.tt !== curTT()) {
      const radio = document.querySelector(`input[name=trangthaikham][value="${who.tt}"]`);
      if (radio) { radio.click(); id = await waitFor(findRow, 10000); }
    }
    if (!id) throw new Error(`Không tìm thấy BN ${who.ten} trên lưới (tab "${TT_NAME[who.tt] || who.tt}"). Bấm "Làm mới" rồi thử lại.`);
    const tr = document.querySelector(`#list_benhnhan tr.jqgrow[id="${CSS.escape(id)}"]`);
    if (g.jqGrid('getGridParam', 'selrow') !== id) {
      selectingRow = true;
      try { $(tr).trigger('click'); } finally { setTimeout(() => { selectingRow = false; }, 300); }
      await sleep(1500); // HIS nạp thông tin BN khi chọn dòng
    }
    return tr;
  }

  function setField(id, v) {
    const e = document.getElementById(id);
    if (!e) return false;
    jq()(e).val(v);
    e.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  async function openHisForm(who, bed, T, R, opts) {
    const $ = jq();
    const banngay = !!(opts && opts.banngay);
    const ghep = bed.state === 'busy';
    await sleep(120); // để click trên panel lan xong, nếu không menu HIS vừa mở sẽ bị đóng ngay
    const tr = await focusGridRow(who);
    try { $(tr).contextMenu('hide'); } catch (_) {}
    await sleep(80);
    const r = tr.getBoundingClientRect();
    $(tr).contextMenu({ x: r.left + 40, y: r.top + 5 });
    // tab ĐT có giường: "Cập nhật giường…"; Mới vào khoa / ĐT không giường: "Cấp giường cho…"
    const label = banngay ? /^(Cập nhật giường ban ngày bệnh nhân|Cấp giường ban ngày cho bệnh nhân)/i
                          : /^(Cập nhật giường bệnh nhân|Cấp giường cho bệnh nhân)$/i;
    const item = await waitFor(() => Array.from(document.querySelectorAll('.context-menu-item'))
      .find(e => e.offsetParent && label.test(e.textContent.trim())), 3000);
    if (!item) { try { $(tr).contextMenu('hide'); } catch (_) {} throw new Error('Không thấy mục cấp giường trong menu chuột phải của HIS.'); }
    $(item).trigger('mouseup');

    const P = banngay ? 'cgbn_' : 'cg_';
    const F = n => `${P}${n}_cv3176`;
    const loaiSel = await waitFor(() => { const e = document.getElementById(F('loaigiuongke_giuongbenh')); return e && e.offsetParent ? e : null; }, 8000);
    if (!loaiSel) throw new Error('Form cấp giường chưa mở (BN thuộc khoa khác hoặc chưa có bệnh án chính thức?).');
    await sleep(700); // HIS nạp phòng/giường/ngày mặc định
    const soSel = document.getElementById(F('sostt_giuongbenh_vpc'));
    const N = T + MIN; // HIS: nhận giường sau giờ cấp 1 phút
    const setTimes = () => {
      setField(F('ngaycapgiuong'), toDateVN(T)); setField(F('giocapgiuong'), toTimeVN(T));
      setField(F('ngaynhangiuong'), toDateVN(N)); setField(F('gionhangiuong'), toTimeVN(N));
      if (R !== Infinity) { setField(F('ngayroigiuong'), toDateVN(R)); setField(F('gioroigiuong'), toTimeVN(R)); }
    };
    const timesOk = () => {
      const v = id => (document.getElementById(F(id)) || {}).value || '';
      return v('ngaycapgiuong') === toDateVN(T) && v('giocapgiuong').slice(0, 5) === toTimeVN(T).slice(0, 5);
    };
    setTimes();
    await sleep(500);
    if (ghep) {
      const chk = document.getElementById(F('namcunggiuong'));
      if (chk && !chk.checked) { chk.click(); await sleep(800); }
      const nc = document.getElementById(F('songuoinamcung'));
      if (nc && Array.from(nc.options).some(o => o.value === '2')) { nc.value = '2'; nc.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    // HIS còn nạp lại ngày giờ / danh sách giường bất đồng bộ → chọn lại tới khi đứng yên
    let ok = false;
    for (let i = 0; i < 6; i++) {
      if (!timesOk()) { setTimes(); await sleep(400); }
      if (loaiSel.value !== bed.loai) { loaiSel.value = bed.loai; loaiSel.dispatchEvent(new Event('change', { bubbles: true })); }
      await waitFor(() => soSel && Array.from(soSel.options).some(o => Number(o.value) === bed.so), 3000);
      const opt = soSel && Array.from(soSel.options).find(o => Number(o.value) === bed.so);
      if (opt && soSel.value !== opt.value) { soSel.value = opt.value; soSel.dispatchEvent(new Event('change', { bubbles: true })); }
      await sleep(700);
      ok = timesOk() && loaiSel.value === bed.loai && Number(soSel.value) === bed.so;
      if (ok && i >= 1) break;
    }
    try { if ($.datepicker) $.datepicker._hideDatepicker(); } catch (_) {}
    try { if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur(); } catch (_) {}
    ['ngaycapgiuong', 'giocapgiuong', 'ngaynhangiuong', 'gionhangiuong'].concat(R !== Infinity ? ['ngayroigiuong', 'gioroigiuong'] : [])
      .forEach(n => flash(document.getElementById(F(n))));
    flash(soSel); flash(loaiSel);
    if (!soSel || Number(soSel.value) !== bed.so) {
      throw new Error(`HIS không cho chọn giường ${bed.loai}${pad3(bed.so)} lúc ${fmt(T)} (có thể vừa có BN khác nhận). Chọn giường khác trong form.`);
    }
    if (!timesOk()) throw new Error('Không giữ được giờ cấp giường trên form HIS, kiểm tra và nhập tay.');
  }

  function flash(el) {
    if (!el) return;
    el.style.outline = '3px solid #f59e0b';
    el.style.outlineOffset = '1px';
    setTimeout(() => { el.style.outline = ''; el.style.outlineOffset = ''; }, 8000);
  }

  // ---------- Giao diện ----------
  let base = null;      // dữ liệu nền (giường, BN, lịch sử)
  let free = null;      // giường trống HIS tại T
  let who = null;       // BN đang xét
  let T = null, R = Infinity; // giờ nhận / rời giường
  let target = null;    // key giường đang chọn
  let freeSeq = 0;

  function css() {
    if (document.getElementById('bhyt-gm-css')) return;
    const s = document.createElement('style');
    s.id = 'bhyt-gm-css';
    s.textContent = `
    #bhyt-gm-launch { position: fixed; left: 150px; bottom: 12px; z-index: 2147483000; padding: 6px 12px; font: bold 12px Arial;
      color: #fff; background: #0f766e; border: 0; border-radius: 4px; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,.3); }
    #bhyt-gm-launch:hover { background: #115e59; }
    #bhyt-gm-panel { display: none; position: fixed; inset: 40px 40px 56px auto; width: min(1040px, calc(100vw - 80px)); z-index: 2147483001;
      background: #fff; color: #1f2937; border: 1px solid #94a3b8; border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,.35);
      font: 13px Arial, sans-serif; flex-direction: column; overflow: hidden; }
    #bhyt-gm-panel.open { display: flex; }
    #bhyt-gm-panel .gm-head { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: #0f766e; color: #fff; }
    #bhyt-gm-panel .gm-head b { flex: 1; font-size: 14px; }
    #bhyt-gm-panel .gm-head button { background: rgba(255,255,255,.15); color: #fff; border: 1px solid rgba(255,255,255,.4); border-radius: 4px; padding: 3px 10px; cursor: pointer; }
    #bhyt-gm-panel .gm-body { flex: 1; overflow: auto; padding: 10px 12px; }
    #bhyt-gm-panel .gm-stats { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
    #bhyt-gm-panel .gm-stat { border: 1px solid #e2e8f0; border-radius: 6px; padding: 6px 10px; min-width: 100px; }
    #bhyt-gm-panel .gm-stat i { display: block; font-style: normal; color: #64748b; font-size: 11px; }
    #bhyt-gm-panel .gm-stat b { font-size: 18px; }
    #bhyt-gm-panel .gm-bar { height: 8px; background: #e2e8f0; border-radius: 4px; overflow: hidden; margin-top: 4px; }
    #bhyt-gm-panel .gm-bar span { display: block; height: 100%; background: #0f766e; }
    #bhyt-gm-panel .gm-wait { margin-bottom: 8px; font-size: 12px; }
    #bhyt-gm-panel .gm-chip { display: inline-block; margin: 2px 6px 2px 0; padding: 3px 8px; border: 1px solid #cbd5e1; border-radius: 12px; cursor: pointer; background: #f8fafc; }
    #bhyt-gm-panel .gm-chip.sel { background: #dbeafe; border-color: #2563eb; font-weight: bold; }
    #bhyt-gm-panel .gm-chip small { color: #64748b; }
    #bhyt-gm-panel .gm-sug { border: 1px solid #99f6e4; background: #f0fdfa; border-radius: 6px; padding: 8px 10px; margin-bottom: 10px; }
    #bhyt-gm-panel .gm-sug h4 { margin: 0 0 6px; font-size: 13px; }
    #bhyt-gm-panel .gm-time { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: center; margin: 4px 0 8px; font-size: 12px; }
    #bhyt-gm-panel .gm-time input { font: 12px Arial; padding: 2px 4px; border: 1px solid #94a3b8; border-radius: 3px; }
    #bhyt-gm-panel .gm-time .gm-info { color: #475569; }
    #bhyt-gm-panel .gm-opt { display: inline-flex; align-items: center; gap: 6px; margin: 2px 8px 2px 0; padding: 4px 8px; border: 1px solid #5eead4;
      border-radius: 4px; background: #fff; cursor: pointer; }
    #bhyt-gm-panel .gm-opt.sel { background: #ccfbf1; border-color: #0f766e; font-weight: bold; }
    #bhyt-gm-panel .gm-opt small { color: #475569; font-weight: normal; }
    #bhyt-gm-panel .gm-acts { margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap; }
    #bhyt-gm-panel .gm-acts button { padding: 5px 12px; border-radius: 4px; border: 1px solid #0f766e; background: #0f766e; color: #fff; cursor: pointer; font-weight: bold; }
    #bhyt-gm-panel .gm-acts button.alt { background: #fff; color: #0f766e; }
    #bhyt-gm-panel .gm-acts button:disabled { opacity: .5; cursor: default; }
    #bhyt-gm-panel .gm-note { margin: 6px 0 0; padding-left: 18px; font-size: 12px; }
    #bhyt-gm-panel .gm-note li { margin: 2px 0; }
    #bhyt-gm-panel .gm-note li.e { color: #b91c1c; } #bhyt-gm-panel .gm-note li.w { color: #92400e; }
    #bhyt-gm-panel .gm-msg { margin-top: 6px; font-size: 12px; color: #475569; }
    #bhyt-gm-panel .gm-msg.err { color: #b91c1c; } #bhyt-gm-panel .gm-msg.ok { color: #047857; }
    #bhyt-gm-panel h3 { margin: 12px 0 6px; font-size: 13px; color: #334155; }
    #bhyt-gm-panel .gm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 6px; }
    #bhyt-gm-panel .gm-bed { border: 1px solid #cbd5e1; border-radius: 6px; padding: 5px 6px; min-height: 52px; position: relative; font-size: 11px; line-height: 1.3; }
    #bhyt-gm-panel .gm-bed .n { font-weight: bold; font-size: 13px; }
    #bhyt-gm-panel .gm-bed .t { color: #64748b; font-size: 10px; }
    #bhyt-gm-panel .gm-bed.free { background: #ecfdf5; border-color: #6ee7b7; cursor: pointer; }
    #bhyt-gm-panel .gm-bed.free.warn { background: #fefce8; border-color: #facc15; }
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
    #bhyt-gm-panel .gm-legend .l-warn::before { background: #fefce8; border-color: #facc15; }
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
    btn.title = 'Xem giường khoa được cấp / còn trống và gợi ý giường cho BN';
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
    panel.addEventListener('change', onPanelChange);

    // Đổi BN trên lưới → xét BN đó nếu panel đang mở
    const $ = jq();
    if ($) $(document).on('click.bhytgm', '#list_benhnhan tr.jqgrow', () => {
      if (selectingRow || !panel.classList.contains('open') || !base) return;
      const g = gridPatient();
      if (g && (!who || g.key !== who.key)) setWho(g);
    });
  }

  // BN đang chọn trên lưới HIS → đối tượng BN trong dữ liệu đã tải
  function gridPatient() {
    const $ = jq();
    const g = $ && $('#list_benhnhan');
    if (!g || !g.length || !base) return null;
    const id = g.jqGrid('getGridParam', 'selrow');
    if (!id) return null;
    let r = null;
    try { r = g.jqGrid('getLocalRow', id); } catch (_) {}
    if (!r || !r.STT_BENHAN) r = g.jqGrid('getRowData', id);
    if (!r) return null;
    return base.pts.find(p => p.key === ptKey(r)) || normPt(r, curTT());
  }

  function defaultT(p) {
    if (p && !(p.cur && p.cur.open) && p.vaokhoa) {
      let t = floorMin(p.vaokhoa) + MIN; // nhận giường ngay sau giờ vào khoa
      if (p.nhapvien && t <= p.nhapvien) t = floorMin(p.nhapvien) + MIN;
      return t;
    }
    return floorMin(now());
  }

  async function setWho(p) {
    who = p;
    T = defaultT(p);
    R = Infinity;
    target = null;
    await reloadFree();
  }

  async function reloadFree() {
    const seq = ++freeSeq;
    const f = await loadFree(base, T);
    if (seq !== freeSeq) return;
    free = f;
    render();
  }

  async function refresh() {
    const body = document.querySelector('#bhyt-gm-panel .gm-body');
    body.innerHTML = '<div class="gm-load">Đang tải danh mục giường, danh sách BN và lịch sử nằm giường…</div>';
    try {
      base = await loadBase();
      const g = gridPatient();
      const cho = base.pts.filter(p => p.tt !== '1');
      await setWho(g || cho[0] || null);
    } catch (e) {
      body.innerHTML = `<div class="gm-load gm-msg err">Lỗi tải dữ liệu: ${esc(e && (e.message || e.statusText) || e)}</div>`;
    }
  }

  const bedLabel = b => `${b.loai}${pad3(b.so)}`;
  const findBed = (map, key) => Object.values(map.groups).flat().find(b => b.key === key) || null;

  function render(msg) {
    if (!base || !free) return;
    const map = buildMap(base, free, who, T, R);
    const sug = suggest(map, who);
    const list = sug.ranked.length ? sug.ranked : sug.ghep;
    let tb = target && findBed(map, target);
    if (!tb || (tb.state !== 'free' && !(!sug.ranked.length && tb.occ.length === 1))) { tb = list.length ? list[0].b : null; target = tb && tb.key; }
    const s = map.sum;
    const pct = s.active ? Math.round(s.dangNam * 100 / s.active) : 0;
    const notes = ruleNotes(who, T, R, tb, sug);

    const cho = base.pts.filter(p => p.tt !== '1');
    const chip = p => `<span class="gm-chip${who && who.key === p.key ? ' sel' : ''}" data-k="${esc(p.key)}">${p.nam ? '♂' : '♀'} ${esc(p.ten)} <small>${esc(p.sobenhan)} · ${TT_NAME[p.tt]} · vào khoa ${fmt(p.vaokhoa)}</small></span>`;
    const waitHtml = `<div class="gm-wait"><b>BN chờ cấp giường (${cho.length}):</b> ${cho.length ? cho.map(chip).join('') : '<i>không có BN ở tab Mới vào khoa / ĐT không giường</i>'}</div>`;

    const timeHtml = who ? `<div class="gm-time">
        <label>Nhận giường lúc <input type="datetime-local" class="gm-t" value="${toInput(T)}"></label>
        <label>Rời giường lúc <input type="datetime-local" class="gm-r" value="${R === Infinity ? '' : toInput(R)}"> <small>(trống = đang nằm)</small></label>
        <span class="gm-info">Nhập viện ${fmt(who.nhapvien)} · vào khoa ${fmt(who.vaokhoa)}${R !== Infinity && R > T ? ` · nằm ${dur(Math.round((R - T) / MIN))}` : ''}</span>
      </div>` : '';

    const histHtml = who && who.hist.length ? `<div class="gm-info" style="font-size:12px;color:#475569;margin-bottom:4px">Lịch sử giường: ${who.hist.map(h => `${h.loai}${pad3(h.so)} ${fmt(h.from)} → ${who.cur && h === who.hist[who.hist.length - 1] ? 'đang nằm' : fmt(h.to)}`).join(' · ')}</div>` : '';

    const sugHtml = who ? `
      <div class="gm-sug">
        <h4>Gợi ý giường cho: ${esc(who.ten)} (${who.nam ? 'Nam' : 'Nữ'}${who.tuoi ? ', ' + esc(who.tuoi) + ' tuổi' : ''}) — ${TT_NAME[who.tt] || ''}</h4>
        ${timeHtml}${histHtml}
        <div>${list.slice(0, 5).map(x => `<span class="gm-opt${tb && tb.key === x.b.key ? ' sel' : ''}" data-k="${x.b.key}">
            ${bedLabel(x.b)} <small>${esc(x.why.join(', '))}</small></span>`).join('') || '<i>Không còn giường nào để gợi ý.</i>'}</div>
        <div class="gm-acts">
          <button type="button" class="gm-apply" data-bn="0" ${tb && !notes.err.some(e => /nhập viện|rời giường phải/.test(e)) ? '' : 'disabled'}>Mở form cấp giường HIS & điền sẵn ${tb ? bedLabel(tb) : ''} lúc ${fmt(T)}</button>
          <button type="button" class="gm-apply alt" data-bn="1" ${tb ? '' : 'disabled'}>…giường ban ngày</button>
        </div>
        <ul class="gm-note">${notes.err.map(t => `<li class="e">${t}</li>`).join('')}${notes.warn.map(t => `<li class="w">${t}</li>`).join('')}
          <li>Giờ cấp giường phải sau giờ nhập viện; giường trống/bận được tính tại giờ nhận giường đã chọn.</li></ul>
        <div class="gm-msg${msg ? ' ' + msg.cls : ''}">${msg ? esc(msg.text) : 'Extension điền sẵn giờ cấp / nhận / rời giường và loại + số giường; kiểm tra lại rồi tự bấm <b>Cấp giường / Cập nhật</b> trên form HIS.'}</div>
      </div>` : `<div class="gm-sug"><h4>Chọn 1 BN ở danh sách chờ phía trên hoặc trên lưới "Danh sách bệnh nhân" để được gợi ý giường.</h4></div>`;

    const groupsHtml = LOAI_ORDER.filter(l => map.groups[l]).map(l => {
      const g = map.groups[l];
      const act = g.filter(b => b.active);
      return `<h3>${LOAI[l]} — ${act.length} giường hoạt động, đang có BN ${act.filter(b => b.occ.length).length}, trống lúc ${fmt(T)}: ${act.filter(b => b.state === 'free').length}${g.length > act.length ? ` · ${g.length - act.length} giường tắt` : ''}</h3>
        <div class="gm-grid">${g.map(b => {
          const cls = ['gm-bed', b.occ.length > 1 ? 'ghep' : b.state];
          if (b.warn) cls.push('warn');
          if (who && who.cur && who.cur.open && b.loai === who.cur.loai && b.so === who.cur.so) cls.push('me');
          if (tb && tb.key === b.key) cls.push('sel');
          const who2 = b.occ.map(iv => `<div class="p" title="${esc(iv.p.ten)} — ${iv.p.nam ? 'Nam' : 'Nữ'} ${esc(iv.p.tuoi)}t — nằm giường từ ${fmt(iv.from)}">${iv.p.nam ? '♂' : '♀'} ${esc(iv.p.ten)}</div><div class="t">từ ${fmt(iv.from)}</div>`).join('');
          const past = (map.ivs[b.key] || []).filter(iv => !iv.cur && iv.to >= T - 24 * 60 * MIN).sort((a, c) => c.to - a.to)[0];
          const txt = b.state === 'off' ? '<div>Không hoạt động</div>'
            : who2 || (b.state === 'free'
              ? `<div>Trống</div>${past ? `<div class="t" title="${esc(past.p.ten)}">rời ${fmt(past.to)}</div>` : ''}`
              : '<div title="HIS báo giường có người tại giờ này (VD: BN ban ngày / BN đã chuyển)">Có người</div>');
          const tip = (map.ivs[b.key] || []).slice(-4).map(iv => `${iv.p.ten}: ${fmt(iv.from)} → ${iv.to === Infinity ? 'đang nằm' : fmt(iv.to)}`).join('\n');
          return `<div class="${cls.join(' ')}" data-k="${b.key}" title="${esc(b.ten || '')}${tip ? '\n' + esc(tip) : ''}"><span class="n">${b.so}</span><span class="tag">${b.loai}</span>${txt}</div>`;
        }).join('')}</div>`;
    }).join('');

    const warn = [];
    if (s.ghep) warn.push(`${s.ghep} giường đang có từ 2 BN trở lên — kiểm tra đã chọn đúng "nằm chung" (50%/30%) chưa, tránh lỗi nằm ghép của CHECKXML.`);
    Object.keys(free).forEach(l => { if (free[l] === null) warn.push(`Không lấy được danh sách giường trống loại ${l} từ HIS, đang suy từ lịch sử nằm giường.`); });

    document.querySelector('#bhyt-gm-panel .gm-head b').textContent = `Sơ đồ giường — ${base.cfg.tenphong || 'khoa'}`;
    const body = document.querySelector('#bhyt-gm-panel .gm-body');
    const keep = body.scrollTop;
    body.innerHTML = `
      <div class="gm-stats">
        <div class="gm-stat"><i>Giường kế hoạch được cấp</i><b>${s.capH}</b></div>
        <div class="gm-stat"><i>Giường đang hoạt động</i><b>${s.active}</b></div>
        <div class="gm-stat"><i>Đang có BN</i><b>${s.dangNam}</b></div>
        <div class="gm-stat"><i>Trống lúc ${fmt(T)}</i><b style="color:#047857">${s.free}</b></div>
        <div class="gm-stat"><i>Công suất</i><b>${pct}%</b><div class="gm-bar"><span style="width:${Math.min(pct, 100)}%"></span></div></div>
        <div class="gm-stat"><i>BN có giường / chờ giường</i><b>${s.bn} / ${s.cho}</b></div>
      </div>
      ${waitHtml}
      ${sugHtml}
      <div class="gm-legend"><span class="l-free">Trống (bấm để chọn)</span><span class="l-warn">Trống nhưng trùng giờ bàn giao ≤ 4h</span><span class="l-busy">Có BN</span><span class="l-ghep">Nằm ghép</span><span class="l-off">Không hoạt động</span><span class="l-me">Giường hiện tại của BN đang xét</span></div>
      ${groupsHtml}
      ${warn.map(w => `<div class="gm-warn">⚠ ${w}</div>`).join('')}`;
    body.scrollTop = keep;
  }

  function onPanelChange(e) {
    if (e.target.matches('.gm-t')) {
      const v = fromInput(e.target.value);
      if (v) { T = v; reloadFree(); }
    } else if (e.target.matches('.gm-r')) {
      const v = fromInput(e.target.value);
      R = v || Infinity;
      render();
    }
  }

  async function onPanelClick(e) {
    if (!base) return;
    const chip = e.target.closest('.gm-chip');
    if (chip) { const p = base.pts.find(x => x.key === chip.dataset.k); if (p) setWho(p); return; }
    const pick = e.target.closest('.gm-opt, .gm-bed.free');
    if (pick) { target = pick.dataset.k; render(); return; }
    const ap = e.target.closest('.gm-apply');
    if (ap && target && who) {
      const map = buildMap(base, free, who, T, R);
      const bed = findBed(map, target);
      if (!bed) return;
      ap.disabled = true;
      try {
        await openHisForm(who, bed, T, R, { banngay: ap.dataset.bn === '1' });
        document.getElementById('bhyt-gm-panel').classList.remove('open');
      } catch (err) {
        render({ cls: 'err', text: String(err && err.message || err) });
      }
    }
  }

  const t = setInterval(() => { if (jq() && document.getElementById('list_benhnhan')) { buildUi(); clearInterval(t); } }, 1500);
})();
