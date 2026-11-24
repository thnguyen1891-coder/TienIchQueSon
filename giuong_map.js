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
      bh: String(r.CO_BAO_HIEM) === '1' || !!stripTags(r.SOBAOHIEMYTE),
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
      if (last && last.loai === x.loai && last.so === x.so && last.songuoi === x.songuoi && x.from - (last.to || x.from) <= 10 * MIN) {
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

  // Giường HIS cho chọn tại thời điểm T, theo số người nằm cùng (1 = nằm riêng, 2 = 50%, 3 = 30%).
  // Lưu ý: HIS chỉ cho ghép vào giường mà BN đang nằm đã được ghi "nằm chung"; giường có BN nằm riêng 100% không hiện ra.
  async function loadFree(base, T) {
    const free = { 1: {}, 2: {}, 3: {} };
    const jobs = [];
    [1, 2, 3].forEach(n => base.loaiCo.forEach(l => jobs.push((async () => {
      try {
        const r = await ajax('noitru_ds_giuongbenh_theoloai_vpc', {
          dvtt: base.cfg.dvtt, maphongban: base.cfg.phongban, maphongbenh: base.cfg.maphong, loaigiuong_vpc: l, namcung_vpc: String(n), ngaycap_vpc: toSql(T)
        }, 'POST');
        free[n][l] = new Set(asRows(r).map(x => Number(x.SO_GIUONG)));
      } catch (_) { free[n][l] = null; }
    })())));
    await Promise.all(jobs);
    return free;
  }

  // ---------- Khoảng nằm của mọi BN trên từng giường ----------
  function intervalsByBed(base) {
    const by = {};
    base.pts.forEach(p => {
      p.hist.forEach((r, i) => {
        const isCur = p.cur && i === p.hist.length - 1 && p.cur.open;
        (by[r.loai + r.so] = by[r.loai + r.so] || []).push({ p, from: r.from, to: isCur ? Infinity : (r.to || r.from), cur: isCur, songuoi: r.songuoi || 1 });
      });
      if (p.cur && !p.hist.length) (by[p.cur.loai + p.cur.so] = by[p.cur.loai + p.cur.so] || []).push({ p, from: p.cur.from || 0, to: Infinity, cur: true, songuoi: 1 });
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
        const hisFree = free[1][l] ? free[1][l].has(so) : !occ.length;
        // Người sẽ nằm chung (chồng giờ > 4h) nếu cấp giường này tại [T, R]
        const co = cf.filter(c => c.ghep);
        const level = co.length + 1; // số người trên giường sau khi thêm BN
        let state;
        if (!active) state = 'off';
        else if (!co.length && hisFree) state = 'free';
        else if (co.length && level <= 3) state = 'share'; // nằm ghép được (tối đa 3 người/giường)
        else state = 'busy';
        const muc = level >= 3 ? 3 : 2; // giá trị "Số lượng nằm cùng" của HIS: 2 = 50%, 3 = 30%
        const share = state === 'share' ? {
          level, muc, pct: muc === 3 ? 30 : 50,
          // BN đang nằm chưa ghi đúng mức nằm chung → phải cập nhật trước (CHECKXML bắt cả BN cũ)
          needUpdate: co.filter(c => (c.iv.songuoi || 1) !== muc).map(c => c.iv),
          hisOk: !!(free[muc][l] && free[muc][l].has(so)),
          sameGender: who ? co.every(c => c.iv.p.nam === who.nam) : true
        } : null;
        return { loai: l, so, key, ten: b.TEN_GIUONG, active, state, occ, cf, co, share, hisFree, warn: state === 'free' && cf.length > 0 };
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
    // Nằm ghép chỉ khi hết giường trống: ưu tiên ghép 2 (50%) hơn ghép 3 (30%), cùng giới,
    // ít BN cũ phải cập nhật, giường kế hoạch, người đang nằm sắp ra (đã nằm lâu)
    const ghep = Object.values(map.groups).flat().filter(b => b.state === 'share').map(b => {
      const sh = b.share; const why = [`nằm ghép ${sh.level} người → ${sh.pct}%`];
      let s = (sh.level === 2 ? 50 : 0) + (b.loai === 'H' ? 10 : 0);
      if (who) { if (sh.sameGender) { s += 20; why.push('cùng giới'); } else { s -= 40; why.push('KHÁC GIỚI'); } }
      if (sh.needUpdate.length) { s -= 3 * sh.needUpdate.length; why.push(`cập nhật ${sh.needUpdate.length} BN đang nằm`); } else why.push('BN đang nằm đã ghi nằm chung');
      const longest = Math.max(...b.co.map(c => (now() - c.iv.from) / (1440 * MIN)));
      if (isFinite(longest)) s += Math.min(longest, 10) / 2;
      s -= b.so / 1000;
      return { b, s, why };
    }).sort((x, y) => y.s - x.s);
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
      const lb = `${target.loai}${pad3(target.so)}`;
      if (target.share) {
        const sh = target.share;
        warn.push(`Nằm ghép <b>${sh.level} người</b> trên giường ${lb} từ ${fmt(T)}: mọi BN trên giường chỉ được thanh toán <b>${sh.pct}%</b> giá giường (TT 39/2024) — extension tự tick "Nằm cùng giường" và chọn mức ${sh.pct}%.`);
        if (!sh.sameGender && who) warn.push('BN nằm chung <b>khác giới</b> — cân nhắc giường khác.');
      }
      target.cf.forEach(c => {
        const t = c.iv.to === Infinity ? 'đang nằm' : `nằm tới ${fmt(c.iv.to)}`;
        if (c.ghep && target.share) {
          const ok = (c.iv.songuoi || 1) === target.share.muc;
          (ok ? warn : err).push(`BN <b>${esc(c.iv.p.ten)}</b> ${t} trên giường ${lb} (từ ${fmt(c.iv.from)}, đang ghi ${c.iv.songuoi > 1 ? 'nằm chung ' + (c.iv.songuoi === 3 ? '30%' : '50%') : 'nằm riêng 100%'})${ok ? ' — đã đúng mức.' : ` → phải cập nhật sang nằm chung <b>${target.share.pct}%</b> từ ${fmt(T)}, nếu không CHECKXML báo lỗi nằm ghép chưa giảm tiền cho BN này.`}`);
        } else if (!c.ghep) {
          warn.push(`Giường ${lb}: BN <b>${esc(c.iv.p.ten)}</b> ${t} (từ ${fmt(c.iv.from)}) — chồng <b>${dur(c.ov)}</b> (bàn giao ≤ 4 giờ): nên lùi giờ nhận giường cho khớp giờ BN kia rời giường để khỏi bị cảnh báo.`);
        }
      });
      if (target.state === 'free' && !target.hisFree) warn.push(`HIS báo giường ${lb} không trống tại ${fmt(T)} (có thể BN ban ngày / BN đã chuyển).`);
    }
    if (!sug.ranked.length) warn.push(`Khoa <b>hết giường trống</b> lúc ${fmt(T)} → gợi ý nằm ghép (ưu tiên 2 người/giường, cùng giới; tối đa 3 người/giường).`);
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
    const muc = (opts && opts.muc) || (bed.share ? bed.share.muc : 1); // 1 nằm riêng, 2 = 50%, 3 = 30%
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
    if (opts && opts.coOccupant) return markCoOccupant(F, bed, T, muc);
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
    // "Nằm cùng giường" + "Số lượng nằm cùng": tick lại thì HIS xoá loại/số giường → làm trước khi chọn giường
    const chk = document.getElementById(F('namcunggiuong'));
    const nc = document.getElementById(F('songuoinamcung'));
    const ncOk = () => (!chk || chk.checked === (muc > 1)) && (!nc || nc.value === String(muc));
    const setNamCung = async () => {
      if (chk && chk.checked !== (muc > 1)) { chk.click(); await sleep(500); }
      if (nc && nc.value !== String(muc) && Array.from(nc.options).some(o => o.value === String(muc))) {
        nc.value = String(muc); nc.dispatchEvent(new Event('change', { bubbles: true }));
        loaiSel.value = ''; // để vòng dưới gọi lại danh sách giường theo mức nằm cùng mới
      }
    };
    setTimes();
    await sleep(500);
    await setNamCung();
    // HIS còn nạp lại ngày giờ / danh sách giường bất đồng bộ → chọn lại tới khi đứng yên
    let ok = false;
    for (let i = 0; i < 6; i++) {
      if (!ncOk()) await setNamCung();
      if (!timesOk()) { setTimes(); await sleep(400); }
      if (loaiSel.value !== bed.loai) { loaiSel.value = bed.loai; loaiSel.dispatchEvent(new Event('change', { bubbles: true })); }
      await waitFor(() => soSel && Array.from(soSel.options).some(o => Number(o.value) === bed.so), 3000);
      const opt = soSel && Array.from(soSel.options).find(o => Number(o.value) === bed.so);
      if (opt && soSel.value !== opt.value) { soSel.value = opt.value; soSel.dispatchEvent(new Event('change', { bubbles: true })); }
      await sleep(700);
      ok = timesOk() && ncOk() && loaiSel.value === bed.loai && Number(soSel.value) === bed.so;
      if (ok && i >= 1) break;
      if (!opt && i >= 1) break; // HIS không liệt kê giường này → khỏi thử tiếp
    }
    [chk, nc].forEach(flash);
    try { if ($.datepicker) $.datepicker._hideDatepicker(); } catch (_) {}
    try { if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur(); } catch (_) {}
    ['ngaycapgiuong', 'giocapgiuong', 'ngaynhangiuong', 'gionhangiuong'].concat(R !== Infinity ? ['ngayroigiuong', 'gioroigiuong'] : [])
      .forEach(n => flash(document.getElementById(F(n))));
    flash(soSel); flash(loaiSel);
    if (!soSel || Number(soSel.value) !== bed.so) {
      // Không để form HIS mở với giường sai (dễ bấm lưu nhầm)
      if (opts && opts.coOccupant) { if (soSel) soSel.selectedIndex = -1; }
      else { const dong = document.getElementById(F('bt_dong')); if (dong) dong.click(); }
      if (muc > 1 && !(opts && opts.coOccupant)) throw new Error(`HIS chưa cho chọn giường ${bed.loai}${pad3(bed.so)} ở mức nằm chung ${muc === 3 ? '30%' : '50%'}: HIS chỉ cho ghép vào giường mà BN đang nằm đã được ghi "nằm chung". Làm Bước 1 (cập nhật BN đang nằm) trước, rồi Tải lại và bấm lại. (Đã đóng form HIS để tránh lưu nhầm giường.)`);
      if (opts && opts.coOccupant) throw new Error(`Đã tick "Nằm cùng giường" mức ${muc === 3 ? '30%' : '50%'} cho BN đang nằm, nhưng HIS không liệt kê lại giường ${bed.loai}${pad3(bed.so)} — chọn tay giường đó trong form (giường hiện tại của BN).`);
      throw new Error(`HIS không cho chọn giường ${bed.loai}${pad3(bed.so)} lúc ${fmt(T)} (có thể vừa có BN khác nhận). Chọn giường khác trong form.`);
    }
    if (!timesOk()) throw new Error('Không giữ được giờ cấp giường trên form HIS, kiểm tra và nhập tay.');
  }

  // BN đang nằm → sửa dòng giường đang chứa thời điểm T sang "nằm chung" (đúng cách HIS: chọn dòng ở lưới dưới form,
  // HIS nạp dòng lên form, tick Nằm cùng giường + chọn mức, bấm Cập nhật). Không tạo dòng mới, không đổi giường/giờ.
  async function markCoOccupant(F, bed, T, muc) {
    const $ = jq();
    const g = $('#list_capgiuong_cv3176');
    const rowsOf = () => (g.jqGrid('getDataIDs') || []).map(id => ({ id, r: g.jqGrid('getRowData', id) }));
    const rows = await waitFor(() => { const x = rowsOf(); return x.length ? x : null; }, 6000);
    if (!rows) throw new Error('Không nạp được danh sách dòng giường của BN đang nằm.');
    const span = x => {
      const from = parseVN(x.r.NGAY_TH_YLENH) || parseVN(x.r.NGAYVAO);
      const to = parseVN(x.r.NGAYRA) || Infinity;
      return { from, to };
    };
    const onBed = rows.filter(x => Number(stripTags(x.r.SO_GIUONG_TAI_KHOA_SO)) === bed.so || !x.r.SO_GIUONG_TAI_KHOA_SO);
    const pick = onBed.find(x => { const s = span(x); return s.from && s.from <= T && T < s.to; })
      || onBed.slice().sort((a, b) => (span(b).from || 0) - (span(a).from || 0))[0];
    if (!pick) throw new Error(`Không thấy dòng giường ${bed.loai}${pad3(bed.so)} của BN đang nằm.`);
    g.jqGrid('setSelection', pick.id, true); // onSelectRow của HIS nạp dòng lên form
    await sleep(600);
    const chk = document.getElementById(F('namcunggiuong'));
    const nc = document.getElementById(F('songuoinamcung'));
    if (chk) chk.checked = true; // không bắn change: handler của HIS sẽ xoá loại/số giường vừa nạp
    if (nc) {
      nc.innerHTML = '';
      const o = document.createElement('option');
      o.value = String(muc);
      o.textContent = muc === 3 ? 'Nằm chung 2 (30%) người khác trở lên (giường nằm 3 người trờ lên)' : 'Nằm chung 1 (50%) người khác (giường nằm 2 người)';
      nc.appendChild(o);
      nc.value = String(muc);
    }
    try { if ($.datepicker) $.datepicker._hideDatepicker(); } catch (_) {}
    const soSel = document.getElementById(F('sostt_giuongbenh_vpc'));
    [chk, nc, soSel, document.getElementById(F('bt_capnhat'))].forEach(flash);
    const tr = document.querySelector(`#list_capgiuong_cv3176 tr.jqgrow[id="${CSS.escape(pick.id)}"]`);
    if (tr) { tr.style.outline = '2px solid #f59e0b'; setTimeout(() => { tr.style.outline = ''; }, 8000); }
    if (soSel && Number(soSel.value) !== bed.so) throw new Error('Đã chọn dòng giường nhưng số giường trên form không khớp — kiểm tra lại trước khi bấm Cập nhật.');
    const s = span(pick);
    return { info: `Đã nạp dòng giường ${fmt(s.from)} → ${s.to === Infinity ? '…' : fmt(s.to)} và chọn nằm chung ${muc === 3 ? '30%' : '50%'}. Bấm Cập nhật trên form HIS.` };
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
    #bhyt-gm-panel { display: none; position: fixed; inset: 14px; z-index: 2147483001; background: #f8fafc; color: #1f2937;
      border: 1px solid #94a3b8; border-radius: 10px; box-shadow: 0 12px 40px rgba(0,0,0,.4); font: 14px Arial, sans-serif;
      flex-direction: column; overflow: hidden; }
    #bhyt-gm-panel.open { display: flex; }
    #bhyt-gm-panel .gm-head { display: flex; align-items: center; gap: 10px; padding: 8px 14px; background: #0f766e; color: #fff; flex-wrap: wrap; }
    #bhyt-gm-panel .gm-head .gm-title { font-size: 16px; font-weight: bold; margin-right: 8px; }
    #bhyt-gm-panel .gm-head .gm-pill { background: rgba(255,255,255,.16); border-radius: 14px; padding: 3px 10px; font-size: 13px; white-space: nowrap; }
    #bhyt-gm-panel .gm-head .gm-pill b { font-size: 15px; }
    #bhyt-gm-panel .gm-head .gm-sp { flex: 1; }
    #bhyt-gm-panel .gm-head button { background: rgba(255,255,255,.15); color: #fff; border: 1px solid rgba(255,255,255,.45); border-radius: 5px; padding: 5px 12px; cursor: pointer; font-size: 13px; }
    #bhyt-gm-panel .gm-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    #bhyt-gm-panel .gm-main { flex: 1; display: grid; grid-template-columns: 380px 1fr; min-height: 0; }
    #bhyt-gm-panel .gm-side { overflow: auto; padding: 12px; background: #fff; border-right: 1px solid #e2e8f0; }
    #bhyt-gm-panel .gm-map { overflow: auto; padding: 10px 14px; }
    #bhyt-gm-panel .gm-step { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; margin-bottom: 10px; background: #fff; }
    #bhyt-gm-panel .gm-step > h4 { margin: 0 0 8px; font-size: 14px; color: #0f766e; display: flex; align-items: center; gap: 8px; }
    #bhyt-gm-panel .gm-step > h4 i { font-style: normal; display: inline-flex; width: 22px; height: 22px; border-radius: 50%; background: #0f766e; color: #fff;
      align-items: center; justify-content: center; font-size: 13px; }
    #bhyt-gm-panel .gm-pt { display: flex; gap: 10px; align-items: center; }
    #bhyt-gm-panel .gm-pt .ic { font-size: 30px; line-height: 1; }
    #bhyt-gm-panel .gm-pt .nm { font-weight: bold; font-size: 15px; }
    #bhyt-gm-panel .gm-sub { color: #64748b; font-size: 12px; margin-top: 2px; }
    #bhyt-gm-panel .gm-wlist { margin-top: 8px; border-top: 1px dashed #e2e8f0; padding-top: 6px; }
    #bhyt-gm-panel .gm-wlist .lb { font-size: 12px; color: #475569; margin-bottom: 4px; }
    #bhyt-gm-panel .gm-chip { display: flex; gap: 6px; align-items: center; padding: 5px 8px; border: 1px solid #e2e8f0; border-radius: 6px; cursor: pointer; margin-bottom: 4px; font-size: 13px; }
    #bhyt-gm-panel .gm-chip:hover { background: #f1f5f9; }
    #bhyt-gm-panel .gm-chip.sel { background: #dbeafe; border-color: #2563eb; }
    #bhyt-gm-panel .gm-chip small { color: #64748b; margin-left: auto; white-space: nowrap; }
    #bhyt-gm-panel .gm-time label { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 4px 0; font-size: 13px; }
    #bhyt-gm-panel .gm-time input { font: 13px Arial; padding: 4px 6px; border: 1px solid #94a3b8; border-radius: 4px; }
    #bhyt-gm-panel .gm-bedpick { display: flex; align-items: center; gap: 10px; }
    #bhyt-gm-panel .gm-bedpick .big { font-size: 26px; font-weight: bold; color: #0f766e; }
    #bhyt-gm-panel .gm-bedpick .big.sh { color: #b45309; }
    #bhyt-gm-panel .gm-alt { margin-top: 6px; font-size: 12px; color: #64748b; }
    #bhyt-gm-panel .gm-opt { display: inline-block; margin: 2px 4px 2px 0; padding: 2px 8px; border: 1px solid #99f6e4; border-radius: 10px; background: #f0fdfa; cursor: pointer; color: #0f766e; font-weight: bold; }
    #bhyt-gm-panel .gm-opt.sh { border-color: #fdba74; background: #fffbeb; color: #b45309; }
    #bhyt-gm-panel .gm-go { display: block; width: 100%; margin-top: 8px; padding: 10px; font: bold 15px Arial; color: #fff; background: #0f766e; border: 0; border-radius: 6px; cursor: pointer; }
    #bhyt-gm-panel .gm-go:hover { background: #115e59; }
    #bhyt-gm-panel .gm-go.alt { background: #fff; color: #0f766e; border: 1px solid #0f766e; padding: 6px; font-size: 13px; }
    #bhyt-gm-panel .gm-go.co { background: #b45309; }
    #bhyt-gm-panel .gm-go:disabled { opacity: .45; cursor: default; }
    #bhyt-gm-panel .gm-substep { font-size: 12px; font-weight: bold; color: #b45309; margin-top: 8px; }
    #bhyt-gm-panel .gm-note { margin: 8px 0 0; padding-left: 18px; font-size: 12px; }
    #bhyt-gm-panel .gm-note li { margin: 3px 0; }
    #bhyt-gm-panel .gm-note li.e { color: #b91c1c; } #bhyt-gm-panel .gm-note li.w { color: #92400e; } #bhyt-gm-panel .gm-note li.i { color: #475569; }
    #bhyt-gm-panel .gm-msg { margin-top: 8px; font-size: 12px; color: #475569; }
    #bhyt-gm-panel .gm-msg.err { color: #b91c1c; font-weight: bold; } #bhyt-gm-panel .gm-msg.ok { color: #047857; }
    #bhyt-gm-panel .gm-legend { display: flex; gap: 16px; flex-wrap: wrap; font-size: 12px; color: #475569; margin-bottom: 6px; align-items: center; }
    #bhyt-gm-panel .gm-legend .sw { display: inline-block; width: 14px; height: 14px; border-radius: 3px; border: 2px solid; vertical-align: -3px; margin-right: 4px; }
    #bhyt-gm-panel h3 { margin: 10px 0 6px; font-size: 14px; color: #334155; }
    #bhyt-gm-panel .gm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(124px, 1fr)); gap: 10px; }
    #bhyt-gm-panel .gm-bed { position: relative; border: 2px solid transparent; border-radius: 10px; padding: 4px 4px 6px; text-align: center; background: #fff;
      box-shadow: 0 1px 3px rgba(0,0,0,.08); }
    #bhyt-gm-panel .gm-bed svg { display: block; width: 100%; height: auto; }
    #bhyt-gm-panel .gm-bed .nm { font-size: 12px; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #bhyt-gm-panel .gm-bed .t { font-size: 11px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #bhyt-gm-panel .gm-bed.free { cursor: pointer; background: #f0fdf4; border-color: #86efac; }
    #bhyt-gm-panel .gm-bed.free.warn { background: #fefce8; border-color: #facc15; }
    #bhyt-gm-panel .gm-bed.free:hover { box-shadow: 0 0 0 3px #99f6e4; }
    #bhyt-gm-panel .gm-bed.share.pick { cursor: pointer; border: 2px dashed #f59e0b; }
    #bhyt-gm-panel .gm-bed.share.pick:hover { box-shadow: 0 0 0 3px #fde68a; }
    #bhyt-gm-panel .gm-bed.ghep { background: #fff1f2; }
    #bhyt-gm-panel .gm-bed.off { opacity: .45; border: 2px dashed #cbd5e1; }
    #bhyt-gm-panel .gm-bed.me { border-color: #2563eb; }
    #bhyt-gm-panel .gm-bed.sel { border-color: #0f766e; box-shadow: 0 0 0 3px #0f766e; }
    #bhyt-gm-panel .gm-bed .badge { position: absolute; top: -9px; left: 50%; transform: translateX(-50%); font-size: 11px; font-weight: bold; padding: 1px 8px;
      border-radius: 9px; color: #fff; white-space: nowrap; }
    #bhyt-gm-panel .gm-bed .badge.best { background: #0f766e; }
    #bhyt-gm-panel .gm-bed .badge.cur { background: #2563eb; }
    #bhyt-gm-panel .gm-bed .badge.sh { background: #f59e0b; }
    #bhyt-gm-panel .gm-warn { color: #b45309; font-size: 12px; margin-top: 8px; }
    #bhyt-gm-panel .gm-load { padding: 40px; text-align: center; color: #64748b; font-size: 15px; }
    @media (max-width: 900px) { #bhyt-gm-panel .gm-main { grid-template-columns: 1fr; } #bhyt-gm-panel .gm-side { border-right: 0; border-bottom: 1px solid #e2e8f0; } }
    `;
    document.head.appendChild(s);
  }

  // ---------- Hình giường (SVG) ----------
  const C_NAM = '#1e88e5', C_NU = '#e91e63';
  function person(cx, color, sc) {
    const s = sc;
    return `<g transform="translate(${cx},0) scale(${s}) translate(${-cx},0)">
      <rect x="${cx - 13}" y="30" width="26" height="15" rx="3" fill="#fff" stroke="#9ca3af" stroke-width="1.2"/>
      <circle cx="${cx}" cy="40" r="6.5" fill="${color}"/>
      <path d="M${cx - 11} 60 Q${cx - 11} 48 ${cx} 48 Q${cx + 11} 48 ${cx + 11} 60 Z" fill="${color}"/>
      <rect x="${cx - 5}" y="72" width="3.6" height="9" fill="${color}"/><rect x="${cx + 1.4}" y="72" width="3.6" height="9" fill="${color}"/>
    </g>`;
  }
  function bedSvg(b) {
    const occ = b.occ;
    const mat = b.state === 'off' ? '#eceff1' : occ.length > 1 ? '#ffe4e6' : b.state === 'free' ? '#dcfce7' : '#ffffff';
    const n = Math.min(occ.length, 3);
    const xs = n === 1 ? [50] : n === 2 ? [34, 66] : [26, 50, 74];
    const sc = n >= 3 ? 0.78 : n === 2 ? 0.9 : 1;
    const ppl = occ.slice(0, 3).map((iv, i) => person(xs[i], iv.p.nam ? C_NAM : C_NU, sc)).join('');
    const nbh = occ.filter(iv => iv.p.bh).length, nvp = occ.length - nbh;
    const lbl = !occ.length ? '' : occ.length === 1 ? `1(${nbh ? 'BH' : 'VP'})`
      : `${occ.length}(${[nbh ? nbh + 'BH' : '', nvp ? nvp + 'VP' : ''].filter(Boolean).join(',')})`;
    const lblColor = occ.length ? (occ.every(iv => iv.p.nam) ? C_NAM : occ.every(iv => !iv.p.nam) ? C_NU : '#6d28d9') : '#16a34a';
    const mid = occ.length ? `${ppl}<text x="50" y="70" text-anchor="middle" font-size="12" font-weight="bold" fill="${lblColor}" stroke="#fff" stroke-width="3" paint-order="stroke">${lbl}</text>`
      : b.state === 'off' ? '<text x="50" y="60" text-anchor="middle" font-size="11" fill="#64748b">Tắt</text>'
      : b.state === 'free' ? '<text x="50" y="60" text-anchor="middle" font-size="13" font-weight="bold" fill="#16a34a">Trống</text>'
      : '<text x="50" y="60" text-anchor="middle" font-size="11" fill="#b45309">Có người</text>';
    return `<svg viewBox="0 0 100 112" aria-hidden="true">
      <rect x="6" y="16" width="5" height="92" rx="2" fill="#fff" stroke="#4b5563" stroke-width="1.6"/>
      <rect x="89" y="16" width="5" height="92" rx="2" fill="#fff" stroke="#4b5563" stroke-width="1.6"/>
      <path d="M11 30 Q50 8 89 30 V36 H11 Z" fill="#fff" stroke="#4b5563" stroke-width="1.6"/>
      <rect x="11" y="34" width="78" height="52" fill="${mat}" stroke="#9ca3af" stroke-width="1"/>
      ${mid}
      <path d="M11 88 Q50 80 89 88 V104 H11 Z" fill="#fff" stroke="#4b5563" stroke-width="1.6"/>
      <text x="50" y="100" text-anchor="middle" font-size="13" font-weight="bold" fill="#111827">${b.loai}${pad3(b.so)}</text>
    </svg>`;
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
    panel.innerHTML = `<div class="gm-head"><span class="gm-title">🛏 Sơ đồ giường khoa</span><span class="gm-pills"></span><span class="gm-sp"></span>
        <button type="button" class="gm-reload">↻ Tải lại</button><button type="button" class="gm-x">✕ Đóng</button></div>
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
    // Còn giường trống thì luôn cấp 1 người/giường; chỉ khi hết giường trống mới cho nằm chung (2–3 người)
    const allowShare = !sug.ranked.length;
    const list = allowShare ? sug.ghep : sug.ranked;
    let tb = target && findBed(map, target);
    if (!tb || !(tb.state === 'free' || (tb.state === 'share' && allowShare))) { tb = list.length ? list[0].b : null; target = tb && tb.key; }
    const best = list.length ? list[0].b.key : null;
    const s = map.sum;
    const pct = s.active ? Math.round(s.dangNam * 100 / s.active) : 0;
    const notes = ruleNotes(who, T, R, tb, sug);
    const blocked = notes.err.some(e => /nhập viện|rời giường phải/.test(e));
    const why = tb ? (list.find(x => x.b.key === tb.key) || { why: [] }).why : [];

    // --- Bước 1: bệnh nhân ---
    const cho = base.pts.filter(p => p.tt !== '1');
    const chip = p => `<div class="gm-chip${who && who.key === p.key ? ' sel' : ''}" data-k="${esc(p.key)}">
        <span style="color:${p.nam ? C_NAM : C_NU};font-size:16px">${p.nam ? '♂' : '♀'}</span> <b>${esc(p.ten)}</b>
        <small>${TT_NAME[p.tt]} · ${fmt(p.vaokhoa)}</small></div>`;
    const ptHtml = who ? `<div class="gm-pt"><span class="ic" style="color:${who.nam ? C_NAM : C_NU}">${who.nam ? '♂' : '♀'}</span>
        <div><div class="nm">${esc(who.ten)}</div>
        <div class="gm-sub">${who.nam ? 'Nam' : 'Nữ'}${who.tuoi ? ' · ' + esc(who.tuoi) + ' tuổi' : ''} · ${who.bh ? 'BHYT' : 'Viện phí'} · ${TT_NAME[who.tt] || ''}</div>
        <div class="gm-sub">Nhập viện ${fmt(who.nhapvien)} · vào khoa ${fmt(who.vaokhoa)}</div>
        ${who.hist.length ? `<div class="gm-sub">Giường: ${who.hist.slice(-3).map(h => `${h.loai}${pad3(h.so)} ${fmt(h.from)} → ${who.cur && h === who.hist[who.hist.length - 1] ? 'đang nằm' : fmt(h.to)}`).join(' · ')}</div>` : ''}
        </div></div>` : '<div class="gm-sub">Chọn BN trong danh sách chờ bên dưới, hoặc bấm BN trên lưới "Danh sách bệnh nhân" của HIS.</div>';
    const step1 = `<div class="gm-step"><h4><i>1</i>Bệnh nhân</h4>${ptHtml}
      <div class="gm-wlist"><div class="lb">BN chờ cấp giường (Mới vào khoa / ĐT không giường): <b>${cho.length}</b></div>
      ${cho.length ? cho.map(chip).join('') : '<div class="gm-sub">Không có — có thể chọn BN trên lưới HIS để đổi giường.</div>'}</div></div>`;

    // --- Bước 2: thời gian ---
    const step2 = who ? `<div class="gm-step gm-time"><h4><i>2</i>Thời gian nằm giường</h4>
        <label>Nhận giường lúc <input type="datetime-local" class="gm-t" value="${toInput(T)}"></label>
        <label>Rời giường lúc <input type="datetime-local" class="gm-r" value="${R === Infinity ? '' : toInput(R)}"></label>
        <div class="gm-sub">${R === Infinity ? 'Để trống "Rời giường" = BN còn đang nằm.' : R > T ? `Thời gian nằm: <b>${dur(Math.round((R - T) / MIN))}</b>` : ''}</div></div>` : '';

    // --- Bước 3: giường + nút ---
    let step3 = '';
    if (who) {
      const sh = tb && tb.share;
      const alts = list.filter(x => !tb || x.b.key !== tb.key).slice(0, 5)
        .map(x => `<span class="gm-opt${x.b.share ? ' sh' : ''}" data-k="${x.b.key}" title="${esc(x.why.join(', '))}">${bedLabel(x.b)}${x.b.share ? ' ' + x.b.share.pct + '%' : ''}</span>`).join('');
      const go = (cls, bn, text) => `<button type="button" class="gm-go gm-apply ${cls}" data-bn="${bn}" ${blocked || !tb ? 'disabled' : ''}>${text}</button>`;
      let acts = '';
      if (tb) {
        const mainTxt = `${sh ? 'Cấp giường nằm chung' : 'Cấp giường'} ${bedLabel(tb)}${sh ? ` (${sh.pct}%)` : ''}`;
        if (sh && sh.needUpdate.length) {
          acts = `<div class="gm-substep">a) Chuyển BN đang nằm sang nằm chung ${sh.pct}%:</div>
            ${sh.needUpdate.map(iv => iv.p.tt === '1'
              ? `<button type="button" class="gm-go co gm-co" data-co="${esc(iv.p.key)}">Cập nhật ${esc(iv.p.ten)} → ${sh.pct}%</button>`
              : `<div class="gm-sub" style="color:#b91c1c">${esc(iv.p.ten)} không còn ở tab ĐT có giường — sửa tay dòng giường của BN này.</div>`).join('')}
            <div class="gm-sub">Extension mở form HIS của BN đó, chọn sẵn dòng giường, tick "Nằm cùng giường" ${sh.pct}% → bấm <b>Cập nhật</b>, rồi bấm ↻ Tải lại.</div>
            <div class="gm-substep">b) Cấp giường cho BN mới:</div>${go('', 0, mainTxt)}`;
        } else acts = go('', 0, mainTxt);
        acts += go('alt', 1, 'Cấp giường BAN NGÀY ' + bedLabel(tb));
      }
      step3 = `<div class="gm-step"><h4><i>3</i>Giường${allowShare ? ' — <span style="color:#b45309">hết giường trống, nằm chung</span>' : ''}</h4>
        ${tb ? `<div class="gm-bedpick"><span class="big${sh ? ' sh' : ''}">${bedLabel(tb)}</span>
          <div class="gm-sub">${tb.key === best ? '★ Đề xuất tốt nhất' : 'Bạn đã chọn'}${why.length ? ' · ' + esc(why.join(', ')) : ''}</div></div>`
          : '<div class="gm-sub" style="color:#b91c1c">Không còn giường nào (mỗi giường tối đa 3 người).</div>'}
        ${alts ? `<div class="gm-alt">Giường khác: ${alts}<br>hoặc bấm giường ${allowShare ? 'viền cam' : 'xanh'} trên sơ đồ.</div>` : ''}
        ${acts}
        <ul class="gm-note">${notes.err.map(t => `<li class="e">${t}</li>`).join('')}${notes.warn.map(t => `<li class="w">${t}</li>`).join('')}</ul>
        <div class="gm-msg${msg ? ' ' + msg.cls : ''}">${msg ? esc(msg.text) : 'Bấm nút: extension mở form cấp giường HIS và điền sẵn giờ cấp / nhận / rời, loại + số giường, nằm cùng. Bạn chỉ kiểm tra rồi bấm <b>Cấp giường</b> (hoặc <b>Cập nhật</b>) trên form HIS.'}</div>
      </div>`;
    }

    // --- Sơ đồ ---
    const groupsHtml = LOAI_ORDER.filter(l => map.groups[l]).map(l => {
      const g = map.groups[l];
      const act = g.filter(b => b.active);
      return `<h3>${LOAI[l]} — ${act.length} giường · có BN ${act.filter(b => b.occ.length).length} · trống ${act.filter(b => b.state === 'free').length}${g.length > act.length ? ` · ${g.length - act.length} giường tắt` : ''}</h3>
        <div class="gm-grid">${g.map(b => {
          const cls = ['gm-bed', b.state];
          if (b.state === 'share' && allowShare) cls.push('pick');
          if (b.occ.length > 1) cls.push('ghep');
          if (b.warn) cls.push('warn');
          const isMe = who && who.cur && who.cur.open && b.loai === who.cur.loai && b.so === who.cur.so;
          if (isMe) cls.push('me');
          if (tb && tb.key === b.key) cls.push('sel');
          const badge = tb && tb.key === b.key ? `<span class="badge best">${b.key === best ? '★ Đề xuất' : '✔ Đã chọn'}</span>`
            : isMe ? '<span class="badge cur">Giường hiện tại</span>'
            : b.state === 'share' && allowShare ? `<span class="badge sh">ghép ${b.share.pct}%</span>` : '';
          const names = b.occ.map(iv => esc(iv.p.ten.split(' ').slice(-2).join(' '))).join(', ');
          const since = b.occ.length ? `từ ${fmt(Math.min(...b.occ.map(iv => iv.from)))}` : '';
          const past = !b.occ.length && (map.ivs[b.key] || []).filter(iv => !iv.cur && iv.to >= T - 24 * 60 * MIN).sort((a, c) => c.to - a.to)[0];
          const sub = b.occ.length ? `<div class="nm">${names}</div><div class="t">${since}</div>`
            : past ? `<div class="t" title="${esc(past.p.ten)}">vừa rời ${fmt(past.to)}</div>` : '<div class="t">&nbsp;</div>';
          const tip = [b.ten || ''].concat((map.ivs[b.key] || []).slice(-4).map(iv =>
            `${iv.p.ten} (${iv.p.nam ? 'Nam' : 'Nữ'}, ${iv.p.bh ? 'BH' : 'VP'}${iv.songuoi > 1 ? ', nằm chung ' + (iv.songuoi === 3 ? '30%' : '50%') : ''}): ${fmt(iv.from)} → ${iv.to === Infinity ? 'đang nằm' : fmt(iv.to)}`)).join('\n');
          return `<div class="${cls.join(' ')}" data-k="${b.key}" title="${esc(tip)}">${badge}${bedSvg(b)}${sub}</div>`;
        }).join('')}</div>`;
    }).join('');

    const warn = [];
    if (s.ghep) warn.push(`${s.ghep} giường đang có từ 2 BN trở lên — kiểm tra đã chọn đúng "nằm chung" (50%/30%) chưa, tránh lỗi nằm ghép của CHECKXML.`);
    Object.keys(free[1]).forEach(l => { if (free[1][l] === null) warn.push(`Không lấy được danh sách giường trống loại ${l} từ HIS, đang suy từ lịch sử nằm giường.`); });

    const panel = document.getElementById('bhyt-gm-panel');
    panel.querySelector('.gm-title').textContent = `🛏 Sơ đồ giường — ${base.cfg.tenphong || 'khoa'}`;
    panel.querySelector('.gm-pills').innerHTML = `
      <span class="gm-pill">Được cấp <b>${s.capH}</b></span>
      <span class="gm-pill">Có BN <b>${s.dangNam}</b></span>
      <span class="gm-pill">Trống lúc ${fmt(T)} <b>${s.free}</b></span>
      <span class="gm-pill">Công suất <b>${pct}%</b></span>
      <span class="gm-pill">Chờ giường <b>${s.cho}</b></span>`;
    const body = panel.querySelector('.gm-body');
    const keepSide = body.querySelector('.gm-side') ? body.querySelector('.gm-side').scrollTop : 0;
    const keepMap = body.querySelector('.gm-map') ? body.querySelector('.gm-map').scrollTop : 0;
    body.innerHTML = `<div class="gm-main">
      <div class="gm-side">${step1}${step2}${step3}</div>
      <div class="gm-map">
        <div class="gm-legend">
          <span><span class="sw" style="background:#dcfce7;border-color:#86efac"></span>Trống — bấm để chọn</span>
          <span><span class="sw" style="background:#fff;border-color:#e5e7eb"></span>Có BN (<span style="color:${C_NAM}">■ nam</span> <span style="color:${C_NU}">■ nữ</span>, BH/VP)</span>
          <span><span class="sw" style="background:#ffe4e6;border-color:#fda4af"></span>Đang nằm chung</span>
          <span><span class="sw" style="background:#fefce8;border-color:#facc15"></span>Trống, trùng giờ bàn giao ≤ 4h</span>
          <span><span class="sw" style="background:#fff;border-color:#2563eb"></span>Giường hiện tại của BN</span>
          ${allowShare ? '<span><span class="sw" style="background:#fff;border-color:#f59e0b;border-style:dashed"></span>Ghép được (hết giường trống)</span>' : ''}
        </div>
        ${groupsHtml}
        ${warn.map(w => `<div class="gm-warn">⚠ ${w}</div>`).join('')}
      </div></div>`;
    body.querySelector('.gm-side').scrollTop = keepSide;
    body.querySelector('.gm-map').scrollTop = keepMap;
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
    const pick = e.target.closest('.gm-opt, .gm-bed.free, .gm-bed.share.pick');
    if (pick) { target = pick.dataset.k; render(); return; }
    const co = e.target.closest('.gm-co');
    if (co && target && who) {
      const bed = findBed(buildMap(base, free, who, T, R), target);
      const p = base.pts.find(x => x.key === co.dataset.co);
      if (!bed || !bed.share || !p) return;
      co.disabled = true;
      try {
        await openHisForm(p, bed, T, Infinity, { muc: bed.share.muc, coOccupant: true });
        document.getElementById('bhyt-gm-panel').classList.remove('open');
      } catch (err) {
        render({ cls: 'err', text: String(err && err.message || err) });
      }
      return;
    }
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
