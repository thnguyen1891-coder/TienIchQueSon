/*
 * Tạo mã VietQR thanh toán viện phí cho các trang:
 *   /web_his/vienphikhongbaohiem, /web_his/vienphicobaohiem, /web_his/thutienvienphinoitru
 * - Số tiền: ô tổng (footer) của cột "Thanh toán" trong lưới #list_chitietthanhtoan
 * - Nội dung: theo mẫu cấu hình, mặc định {MAYTE}-{HOTEN}-{NGAYRA}
 * - Mã QR được sinh hoàn toàn trên máy (không gửi thông tin bệnh nhân ra ngoài).
 */
(function () {
  'use strict';
  if (window.__vpQrLoaded) return;
  window.__vpQrLoaded = true;

  const STORE_KEY = 'vpQrConfig';
  const DEFAULT_CFG = {
    bin: '',
    bankName: '',
    account: '',
    accountName: '',
    template: '{MAYTE}-{HOTEN}-{NGAYRA}'
  };

  const BANKS = [
    ['970405', 'Agribank'], ['970436', 'Vietcombank'], ['970415', 'VietinBank'], ['970418', 'BIDV'],
    ['970422', 'MB Bank'], ['970407', 'Techcombank'], ['970416', 'ACB'], ['970432', 'VPBank'],
    ['970403', 'Sacombank'], ['970423', 'TPBank'], ['970441', 'VIB'], ['970443', 'SHB'],
    ['970437', 'HDBank'], ['970448', 'OCB'], ['970440', 'SeABank'], ['970449', 'LPBank'],
    ['970426', 'MSB'], ['970431', 'Eximbank'], ['970428', 'Nam A Bank'], ['970409', 'Bac A Bank'],
    ['970452', 'KienlongBank'], ['970412', 'PVcomBank'], ['970438', 'BaoViet Bank'], ['970427', 'VietABank'],
    ['970425', 'ABBANK'], ['970400', 'Saigonbank'], ['970433', 'Vietbank'], ['970419', 'NCB'],
    ['970430', 'PG Bank'], ['970406', 'DongA Bank'], ['970408', 'GPBank'], ['970414', 'OceanBank'],
    ['970444', 'CB Bank'], ['970454', 'BVBank'], ['970446', 'Co-opBank'], ['970424', 'Shinhan Bank'],
    ['970457', 'Woori Bank'], ['970458', 'UOB'], ['970410', 'Standard Chartered'], ['970439', 'Public Bank'],
    ['970421', 'VRB'], ['970434', 'Indovina Bank']
  ];

  // ---------------------------------------------------------------- storage
  function loadCfg() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([STORE_KEY], (r) => resolve(Object.assign({}, DEFAULT_CFG, (r && r[STORE_KEY]) || {})));
      } catch (e) { resolve(Object.assign({}, DEFAULT_CFG)); }
    });
  }
  function saveCfg(cfg) {
    return new Promise((resolve) => {
      try { chrome.storage.local.set({ [STORE_KEY]: cfg }, resolve); } catch (e) { resolve(); }
    });
  }

  // ---------------------------------------------------------------- dữ liệu trên trang
  function val(id) {
    const e = document.getElementById(id);
    return e ? String(e.value || e.textContent || '').trim() : '';
  }

  function readAmount() {
    const box = document.getElementById('gbox_list_chitietthanhtoan');
    if (!box) return 0;
    const ths = [...box.querySelectorAll('.ui-jqgrid-htable th')];
    let idx = ths.findIndex((th) => th.textContent.trim().toLowerCase() === 'thanh toán');
    if (idx < 0) idx = 4;
    const foot = box.querySelector('.ui-jqgrid-ftable tr.footrow');
    if (!foot || !foot.cells[idx]) return 0;
    return parseMoney(foot.cells[idx].textContent);
  }

  // "72,100.00" -> 72100 ; "1,754,949" -> 1754949 ; "1,754,949.5999999964" -> 1754950 ; "72.100,50" -> 72101
  function parseMoney(s) {
    s = String(s || '').replace(/[^\d.,-]/g, '');
    const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
      // có cả hai: dấu xuất hiện sau cùng là dấu thập phân
      const decCh = lastDot > lastComma ? '.' : ',', grpCh = decCh === '.' ? ',' : '.';
      s = s.split(grpCh).join('');
      if (decCh === ',') s = s.replace(',', '.');
    } else if (lastDot >= 0 || lastComma >= 0) {
      const ch = lastDot >= 0 ? '.' : ',';
      const grp = new RegExp('^-?\\d{1,3}(\\' + ch + '\\d{3})+$');
      if (grp.test(s)) s = s.split(ch).join('');   // chỉ là dấu phân cách hàng nghìn
      else s = s.replace(ch, '.');                    // là dấu thập phân
    }
    const n = parseFloat(s);
    return isNaN(n) ? 0 : Math.round(n);
  }

  function readDateOut() {
    // Nội trú: Ngày ra viện; nếu không có thì lấy ngày hôm nay
    let s = val('ngayravien');
    let m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return m[1].padStart(2, '0') + m[2].padStart(2, '0') + m[3];
    const d = new Date();
    return String(d.getDate()).padStart(2, '0') + String(d.getMonth() + 1).padStart(2, '0') + d.getFullYear();
  }

  function stripVN(s) {
    return String(s || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D')
      .replace(/[^A-Za-z0-9 \-.]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function buildContent(tpl) {
    const map = {
      MAYTE: val('mayte'),
      HOTEN: val('hoten'),
      NGAYRA: readDateOut()
    };
    const raw = String(tpl || DEFAULT_CFG.template).replace(/\{(\w+)\}/g, (_, k) => (k.toUpperCase() in map ? map[k.toUpperCase()] : ''));
    return stripVN(raw).toUpperCase().slice(0, 99);
  }

  // ---------------------------------------------------------------- VietQR (EMVCo)
  function tlv(id, v) { return id + String(v.length).padStart(2, '0') + v; }
  function crc16(s) {
    let crc = 0xFFFF;
    for (let i = 0; i < s.length; i++) {
      crc ^= s.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }
  function vietQrPayload(bin, account, amount, content) {
    const merchant = tlv('00', 'A000000727') + tlv('01', tlv('00', bin) + tlv('01', account)) + tlv('02', 'QRIBFTTA');
    let p = tlv('00', '01') + tlv('01', amount > 0 ? '12' : '11') + tlv('38', merchant) + tlv('53', '704');
    if (amount > 0) p += tlv('54', String(amount));
    p += tlv('58', 'VN');
    if (content) p += tlv('62', tlv('08', content));
    p += '6304';
    return p + crc16(p);
  }

  // ---------------------------------------------------------------- QR encoder (byte mode, ECC M)
  const ECC_M = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
  const BLK_M = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];

  function rawModules(ver) {
    let r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const na = Math.floor(ver / 7) + 2;
      r -= (25 * na - 10) * na - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  function dataCodewords(ver) { return Math.floor(rawModules(ver) / 8) - ECC_M[ver] * BLK_M[ver]; }
  function gfMul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; }
    return z & 0xFF;
  }
  function rsDivisor(deg) {
    const res = new Array(deg).fill(0); res[deg - 1] = 1;
    let root = 1;
    for (let i = 0; i < deg; i++) {
      for (let j = 0; j < deg; j++) { res[j] = gfMul(res[j], root); if (j + 1 < deg) res[j] ^= res[j + 1]; }
      root = gfMul(root, 0x02);
    }
    return res;
  }
  function rsRemainder(data, div) {
    const res = div.map(() => 0);
    for (const b of data) {
      const f = b ^ res.shift(); res.push(0);
      div.forEach((c, i) => { res[i] ^= gfMul(c, f); });
    }
    return res;
  }

  function encodeQR(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    let ver = 1;
    for (; ver <= 40; ver++) {
      const cc = ver <= 9 ? 8 : 16;
      if (4 + cc + bytes.length * 8 <= dataCodewords(ver) * 8) break;
    }
    if (ver > 40) throw new Error('Dữ liệu quá dài');
    const bits = [];
    const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
    put(4, 4); put(bytes.length, ver <= 9 ? 8 : 16); bytes.forEach((b) => put(b, 8));
    const cap = dataCodewords(ver) * 8;
    put(0, Math.min(4, cap - bits.length));
    put(0, (8 - bits.length % 8) % 8);
    for (let p = 0xEC; bits.length < cap; p ^= 0xEC ^ 0x11) put(p, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }

    // ECC + interleave
    const nb = BLK_M[ver], eccLen = ECC_M[ver], raw = Math.floor(rawModules(ver) / 8);
    const nShort = nb - raw % nb, shortLen = Math.floor(raw / nb);
    const div = rsDivisor(eccLen), blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const dat = data.slice(k, k + shortLen - eccLen + (i < nShort ? 0 : 1));
      k += dat.length;
      const ecc = rsRemainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const cw = [];
    for (let i = 0; i < blocks[0].length; i++) {
      for (let j = 0; j < blocks.length; j++) {
        if (i !== shortLen - eccLen || j >= nShort) cw.push(blocks[j][i]);
      }
    }

    // ma trận
    const size = ver * 4 + 17;
    const mod = [...Array(size)].map(() => new Array(size).fill(false));
    const fn = [...Array(size)].map(() => new Array(size).fill(false));
    const setF = (x, y, d) => { mod[y][x] = d; fn[y][x] = true; };

    for (let i = 0; i < size; i++) { setF(6, i, i % 2 === 0); setF(i, 6, i % 2 === 0); }
    const finder = (x, y) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)), xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setF(xx, yy, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    if (ver > 1) {
      const na = Math.floor(ver / 7) + 2;
      const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2;
      const pos = [6];
      for (let p = size - 7; pos.length < na; p -= step) pos.splice(1, 0, p);
      for (let i = 0; i < na; i++) for (let j = 0; j < na; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setF(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
    const drawFormat = (mask) => {
      const dataF = (0 << 3) | mask; // ECC M = 00
      let rem = dataF;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const b = ((dataF << 10) | rem) ^ 0x5412;
      const g = (i) => ((b >>> i) & 1) !== 0;
      for (let i = 0; i <= 5; i++) setF(8, i, g(i));
      setF(8, 7, g(6)); setF(8, 8, g(7)); setF(7, 8, g(8));
      for (let i = 9; i < 15; i++) setF(14 - i, 8, g(i));
      for (let i = 0; i < 8; i++) setF(size - 1 - i, 8, g(i));
      for (let i = 8; i < 15; i++) setF(8, size - 15 + i, g(i));
      setF(8, size - 8, true);
    };
    drawFormat(0);
    if (ver >= 7) {
      let rem = ver;
      for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      const b = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) {
        const bit = ((b >>> i) & 1) !== 0, a = size - 11 + i % 3, c = Math.floor(i / 3);
        setF(a, c, bit); setF(c, a, bit);
      }
    }
    // đặt dữ liệu
    let bi = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let v = 0; v < size; v++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - v : v;
        if (!fn[y][x] && bi < cw.length * 8) { mod[y][x] = ((cw[bi >>> 3] >>> (7 - (bi & 7))) & 1) !== 0; bi++; }
      }
    }

    const maskFn = [
      (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
      (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => x * y % 2 + x * y % 3 === 0,
      (x, y) => (x * y % 2 + x * y % 3) % 2 === 0, (x, y) => ((x + y) % 2 + x * y % 3) % 2 === 0
    ];
    const applyMask = (m) => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && maskFn[m](x, y)) mod[y][x] = !mod[y][x];
    };
    const penalty = () => {
      let p = 0, dark = 0;
      const line = (get) => {
        for (let a = 0; a < size; a++) {
          let run = 1;
          for (let b = 1; b <= size; b++) {
            if (b < size && get(a, b) === get(a, b - 1)) run++;
            else { if (run >= 5) p += run - 2; run = 1; }
          }
          for (let b = 0; b + 7 <= size; b++) {
            const s = [0, 1, 2, 3, 4, 5, 6].map((k) => get(a, b + k));
            if (s[0] && !s[1] && s[2] && s[3] && s[4] && !s[5] && s[6]) {
              const before = b >= 4 && [1, 2, 3, 4].every((k) => !get(a, b - k));
              const after = b + 11 <= size && [7, 8, 9, 10].every((k) => !get(a, b + k));
              if (before || after) p += 40;
            }
          }
        }
      };
      line((a, b) => mod[a][b]); line((a, b) => mod[b][a]);
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) {
        const c = mod[y][x];
        if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) p += 3;
      }
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (mod[y][x]) dark++;
      const total = size * size;
      p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
      return p;
    };
    let best = 0, bestP = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m); drawFormat(m);
      const pp = penalty();
      if (pp < bestP) { bestP = pp; best = m; }
      applyMask(m);
    }
    applyMask(best); drawFormat(best);
    return mod;
  }

  function qrCanvas(text, scale) {
    const m = encodeQR(text), n = m.length, border = 4, sz = (n + border * 2) * scale;
    const cv = document.createElement('canvas');
    cv.width = cv.height = sz;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, sz, sz);
    ctx.fillStyle = '#000';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) ctx.fillRect((x + border) * scale, (y + border) * scale, scale, scale);
    return cv;
  }

  // ---------------------------------------------------------------- giao diện
  const fmtMoney = (n) => Number(n || 0).toLocaleString('en-US');

  function injectStyle() {
    if (document.getElementById('vpqr-style')) return;
    const st = document.createElement('style');
    st.id = 'vpqr-style';
    st.textContent = `
#vpqr-ov{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2147483000;display:flex;align-items:center;justify-content:center;font:13px Arial,sans-serif}
#vpqr-box{background:#fff;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,.35);width:420px;max-width:95vw;max-height:95vh;overflow:auto}
#vpqr-box .hd{background:#1e5aa8;color:#fff;padding:8px 12px;font-weight:bold;display:flex;justify-content:space-between;align-items:center;border-radius:8px 8px 0 0}
#vpqr-box .hd button{background:none;border:0;color:#fff;font-size:18px;cursor:pointer;line-height:1}
#vpqr-box .bd{padding:12px}
#vpqr-box .qr{text-align:center}
#vpqr-box .qr canvas{width:300px;height:300px;image-rendering:pixelated}
#vpqr-box .amt{font-size:22px;font-weight:bold;color:#c00;text-align:center;margin:6px 0}
#vpqr-box .info{background:#f4f7fb;border:1px solid #d6e0ee;border-radius:6px;padding:6px 8px;margin-top:6px;line-height:1.6}
#vpqr-box .info b{color:#1e5aa8}
#vpqr-box label{display:block;margin:8px 0 2px;font-weight:bold;color:#333}
#vpqr-box input,#vpqr-box select{width:100%;box-sizing:border-box;padding:5px 6px;border:1px solid #aab;border-radius:4px;font-size:13px}
#vpqr-box .hint{color:#666;font-size:11px;margin-top:2px}
#vpqr-box .ft{display:flex;gap:6px;justify-content:flex-end;padding:0 12px 12px}
#vpqr-box .ft button{padding:6px 12px;border:1px solid #1e5aa8;background:#1e5aa8;color:#fff;border-radius:4px;cursor:pointer}
#vpqr-box .ft button.sec{background:#fff;color:#1e5aa8}
#vpqr-box .err{color:#c00;margin-top:6px}
#vpqr-taoma.vpqr-btn{margin-left:4px;background:#1a8f3c !important;background-image:none !important;color:#fff !important;border:1px solid #13702e !important;font-weight:bold !important;cursor:pointer}
#vpqr-taoma.vpqr-btn:hover{background:#13702e !important}`;
    document.head.appendChild(st);
  }

  function closeModal() { const o = document.getElementById('vpqr-ov'); if (o) o.remove(); }

  function openModal(showConfig) {
    closeModal();
    injectStyle();
    const ov = document.createElement('div');
    ov.id = 'vpqr-ov';
    ov.innerHTML = '<div id="vpqr-box"><div class="hd"><span>Mã QR thanh toán</span><button title="Đóng">×</button></div><div class="bd"></div><div class="ft"></div></div>';
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeModal(); });
    ov.querySelector('.hd button').onclick = closeModal;
    document.body.appendChild(ov);
    const onKey = (e) => { if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', onKey, true); } };
    document.addEventListener('keydown', onKey, true);
    loadCfg().then((cfg) => {
      if (showConfig || !cfg.bin || !cfg.account) renderConfig(cfg); else renderQR(cfg);
    });
  }

  function renderQR(cfg) {
    const bd = document.querySelector('#vpqr-box .bd'), ft = document.querySelector('#vpqr-box .ft');
    const amount = readAmount();
    const content = buildContent(cfg.template);
    bd.innerHTML = '';
    ft.innerHTML = '';
    if (!val('mayte')) {
      bd.innerHTML = '<div class="err">Chưa chọn bệnh nhân.</div>';
    } else if (amount <= 0) {
      bd.innerHTML = '<div class="err">Số tiền cột "Thanh toán" bằng 0 — không cần tạo mã QR.</div>';
    } else {
      const payload = vietQrPayload(cfg.bin, cfg.account, amount, content);
      const qr = document.createElement('div');
      qr.className = 'qr';
      qr.appendChild(qrCanvas(payload, 8));
      bd.appendChild(qr);
      const amt = document.createElement('div');
      amt.className = 'amt';
      amt.textContent = fmtMoney(amount) + ' đ';
      bd.appendChild(amt);
      const info = document.createElement('div');
      info.className = 'info';
      const row = (k, v) => { const d = document.createElement('div'); d.innerHTML = k + ': <b></b>'; d.querySelector('b').textContent = v; info.appendChild(d); };
      row('Ngân hàng', cfg.bankName || cfg.bin);
      row('Số tài khoản', cfg.account);
      if (cfg.accountName) row('Chủ tài khoản', cfg.accountName);
      row('Nội dung', content);
      bd.appendChild(info);
    }
    const bCfg = document.createElement('button');
    bCfg.className = 'sec'; bCfg.textContent = '⚙ Cấu hình';
    bCfg.onclick = () => renderConfig(cfg);
    const bRe = document.createElement('button');
    bRe.className = 'sec'; bRe.textContent = 'Tạo lại';
    bRe.onclick = () => renderQR(cfg);
    const bClose = document.createElement('button');
    bClose.textContent = 'Đóng';
    bClose.onclick = closeModal;
    ft.append(bCfg, bRe, bClose);
  }

  function renderConfig(cfg) {
    const bd = document.querySelector('#vpqr-box .bd'), ft = document.querySelector('#vpqr-box .ft');
    const known = BANKS.some((b) => b[0] === cfg.bin);
    bd.innerHTML = `
      <label>Ngân hàng nhận</label>
      <select id="vpqr-bank"><option value="">-- Chọn ngân hàng --</option>${BANKS.map((b) => `<option value="${b[0]}">${b[1]} (${b[0]})</option>`).join('')}<option value="other">Khác (nhập mã BIN)…</option></select>
      <div id="vpqr-binwrap" style="display:none"><label>Mã BIN ngân hàng (6 số)</label><input id="vpqr-bin" maxlength="6"></div>
      <label>Số tài khoản</label><input id="vpqr-acc">
      <label>Tên chủ tài khoản (chỉ để hiển thị)</label><input id="vpqr-name">
      <label>Mẫu nội dung chuyển khoản</label><input id="vpqr-tpl">
      <div class="hint">Dùng {MAYTE}, {HOTEN}, {NGAYRA} (ngày ra dạng ddmmyyyy; không có ngày ra thì lấy ngày hôm nay). Dấu tiếng Việt được bỏ tự động.</div>
      <div class="err" id="vpqr-err"></div>`;
    const sel = bd.querySelector('#vpqr-bank'), binWrap = bd.querySelector('#vpqr-binwrap'), binIn = bd.querySelector('#vpqr-bin');
    sel.value = cfg.bin ? (known ? cfg.bin : 'other') : '';
    binIn.value = known ? '' : cfg.bin;
    binWrap.style.display = sel.value === 'other' ? '' : 'none';
    sel.onchange = () => { binWrap.style.display = sel.value === 'other' ? '' : 'none'; };
    bd.querySelector('#vpqr-acc').value = cfg.account;
    bd.querySelector('#vpqr-name').value = cfg.accountName;
    bd.querySelector('#vpqr-tpl').value = cfg.template;

    ft.innerHTML = '';
    const bSave = document.createElement('button');
    bSave.textContent = 'Lưu & tạo mã';
    bSave.onclick = async () => {
      const bin = sel.value === 'other' ? binIn.value.trim() : sel.value;
      const account = bd.querySelector('#vpqr-acc').value.replace(/\s+/g, '');
      const err = bd.querySelector('#vpqr-err');
      if (!/^\d{6}$/.test(bin)) { err.textContent = 'Chọn ngân hàng hoặc nhập mã BIN 6 chữ số.'; return; }
      if (!/^[A-Za-z0-9]{3,19}$/.test(account)) { err.textContent = 'Số tài khoản không hợp lệ.'; return; }
      const bank = BANKS.find((b) => b[0] === bin);
      const next = {
        bin, account,
        bankName: bank ? bank[1] : 'BIN ' + bin,
        accountName: bd.querySelector('#vpqr-name').value.trim(),
        template: bd.querySelector('#vpqr-tpl').value.trim() || DEFAULT_CFG.template
      };
      await saveCfg(next);
      renderQR(next);
    };
    const bCancel = document.createElement('button');
    bCancel.className = 'sec'; bCancel.textContent = 'Hủy';
    bCancel.onclick = () => (cfg.bin && cfg.account ? renderQR(cfg) : closeModal());
    ft.append(bCancel, bSave);
  }

  // ---------------------------------------------------------------- gắn nút
  function ensureButton() {
    if (document.getElementById('vpqr-taoma')) return;
    if (!document.getElementById('list_chitietthanhtoan')) return;
    const anchor = document.getElementById('inbangke');
    const btn = document.createElement(anchor && anchor.tagName === 'INPUT' ? 'input' : 'button');
    btn.id = 'vpqr-taoma';
    btn.type = 'button';
    if (btn.tagName === 'INPUT') btn.value = '▦ Tạo mã QR'; else btn.textContent = '▦ Tạo mã QR';
    btn.title = 'Tạo mã VietQR theo số tiền cột "Thanh toán" (bấm chuột phải hoặc Shift+bấm để cấu hình ngân hàng)';
    btn.className = ((anchor && anchor.className) || '') + ' vpqr-btn';
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openModal(e.shiftKey); });
    btn.addEventListener('contextmenu', (e) => { e.preventDefault(); openModal(true); });
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    else {
      const box = document.getElementById('gbox_list_chitietthanhtoan');
      if (box && box.parentNode) box.parentNode.insertBefore(btn, box);
    }
    injectStyle();
  }

  ensureButton();
  const obs = new MutationObserver(() => ensureButton());
  obs.observe(document.documentElement, { childList: true, subtree: true });

  // để kiểm thử
  window.__vpQr = { vietQrPayload, encodeQR, crc16, parseMoney };
})();
