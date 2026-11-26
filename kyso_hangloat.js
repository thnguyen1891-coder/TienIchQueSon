// KÝ SỐ HÀNG LOẠT XML (CT03, CT04, CT07) trên trang Kiểm tra bảng kê / Kiểm tra bảng kê nội trú.
// Tự bấm giao diện giống thao tác tay, cho từng bệnh nhân được chọn:
//   chọn BN -> mở "Chữ ký số Smart CA" -> tab "Khác" -> ký các phiếu "Chưa ký" đúng mã -> chờ "Đã ký" -> đóng -> BN tiếp theo.
// Có chế độ "Chạy thử": chỉ tô đỏ nút sẽ bấm, KHÔNG ký.
(function () {
  if (window.top !== window) return;
  if (window.__bhytKySoHangLoatLoaded) return;
  window.__bhytKySoHangLoatLoaded = true;

  const IS_PDT = /khambenhnoitru/i.test(location.pathname); // trang Khám bệnh nội trú -> ký Phiếu điều trị
  const IS_NOITRU = /kiemtrabangkenoitru|kiemtrabangkebannt/i.test(location.pathname);
  const PAGE = IS_PDT ? 'pdt' : IS_NOITRU ? 'noitru' : 'ngoaitru';
  // kh = mã ký hiệu phiếu (cột ẩn KY_HIEU_PHIEU của HIS) - chính xác nhất; re = dự phòng theo tên phiếu
  const CODES = {
    CT03: { kh: /_CT03$/i, re: /CT0?3\b|GIẤY RA VIỆN/i, label: 'CT03 - Giấy ra viện', only: 'noitru' },
    CT04: { kh: /_CT04$/i, re: /CT0?4\b|TÓM TẮT HSBA/i, label: 'CT04 - Tóm tắt HSBA', only: 'noitru' },
    CT07: { kh: /_CT07$/i, re: /CT0?7\b|NGHỈ VIỆC HƯỞNG BHXH/i, label: 'CT07 - CN nghỉ việc hưởng BHXH' },
    // "01. XML KHÁM BỆNH BHXH 4750/QĐ-BYT" - phiếu XML (bấm là ký) nằm ở tab "Bảng kê"
    XML4750: { kh: /^NGOAI_TRU_BANG_KE_BHXH_4750$/i, re: /XML KHÁM BỆNH BHXH 4750/i, label: '01. XML Khám bệnh BHXH 4750/QĐ-BYT', tab: 'Bảng kê', only: 'ngoaitru' },
    // "01. XML NỘI TRÚ BHXH 4750/QĐ-BYT" - phiếu XML (bấm là ký) ở tab "Khác" của trang bảng kê nội trú / BANT
    XML4750_NT: { kh: /^(NOI_TRU|BANT)_BANG_KE_BHXH_4750$/i, re: /XML (NỘI TRÚ|BANT) BHXH 4750/i,
      label: /kiemtrabangkebannt/i.test(location.pathname) ? '01. XML BANT BHXH 4750/QĐ-BYT' : '01. XML Nội trú BHXH 4750/QĐ-BYT',
      only: 'noitru', altTabs: ['Bảng kê', 'Hồ sơ bệnh án'] }, // không thấy ở tab "Khác" thì tìm tiếp các tab này
    // Bảng kê ký trên PDF (tab = tab chứa phiếu trong cửa sổ ký số)
    BANGKE: { kh: /BANG_KE_CHI_PHI/i, re: /^BẢNG KÊ NỘI TRÚ|^BẢNG KÊ/i, label: 'Bảng kê nội trú (ký trên PDF)', pdf: true, tab: 'Khác', only: 'noitru' },
    BK_NGT: { kh: /^BANGKECHIPHI_KCB_6556$/i, re: /^BẢNG KÊ BHYT NGOẠI TRÚ/i, label: 'Bảng kê BHYT ngoại trú (ký trên PDF)', pdf: true, tab: 'Bảng kê', only: 'ngoaitru' },
    BK_NGT_K: { kh: /^BANGKECHIPHI_KCB_6556_KHONG_BHYT$/i, re: /^BẢNG KÊ KBHYT NGOẠI TRÚ/i, label: 'Bảng kê không BHYT ngoại trú (ký trên PDF)', pdf: true, tab: 'Bảng kê', only: 'ngoaitru' },
    // Phiếu điều trị: mỗi tờ điều trị chưa ký là 1 dòng "Phiếu theo dõi điều trị đơn nội trú (Phiếu: n - ...)"
    // Cận lâm sàng: MỌI phiếu "Chưa ký" trong tab (KQ xét nghiệm, phiếu chỉ định XN / CĐHA / TTPT...).
    // Vị trí ký do HIS cấu hình sẵn -> chỉ mở trình ký, bảo đảm có khung chữ ký, Hoàn tất.
    CLS: { kh: /./, re: /./, label: 'Cận lâm sàng (mọi phiếu chưa ký trong tab)', pdf: true, tab: 'Cận lâm sàng', only: 'pdt', multi: true },
    // Vỏ bệnh án (Trang 1/2/3): mỗi trang ký các vai trò khác nhau (chọn ở dòng "Vai trò bệnh án")
    HSBA: { kh: /_TRANG_[123]$/i, re: /Bệnh án .*\(Trang [123]\)/i, label: 'Hồ sơ bệnh án (Trang 1 / 2 / 3)', pdf: true, tab: 'Hồ sơ bệnh án', only: 'pdt', multi: true },
    PDT: { kh: /^PHIEUDIEUTRI_DACHON$/i, re: /^Phiếu theo dõi điều trị đơn/i, label: 'Phiếu điều trị (ký trên PDF, trên dòng BS...)', pdf: true, tab: 'Phiếu điều trị', only: 'pdt' }
  };
  const codeOnThisPage = c => {
    const o = CODES[c].only;
    // Trang Khám bệnh nội trú: Phiếu điều trị + Bảng kê nội trú (vị trí NGƯỜI LẬP BẢNG KÊ)
    return PAGE === 'pdt' ? (o === 'pdt' || c === 'BANGKE') : (!o || o === PAGE);
  };
  // Vai trò ký Phiếu điều trị: lấy vai trò bác sĩ trong ô chọn của HIS (không có thì lấy vai trò đầu tiên)
  const PDT_ROLE = { label: 'Bác sĩ', optRe: /./, prefer: /bác sĩ|bác sỹ|\bBS\b/i, anyRole: true };
  // Dòng tên bác sĩ dưới y lệnh: "BSCKI.Nguyễn Văn A", "BS. ...", "BSCKII ...", "ThS.BS ..."
  const BS_LINE = '^\\s*((Th?S|PGS|GS)\\.?\\s*)?BS(\\s*CK\\s*I{1,2})?(\\s*[.:]|\\s|$)';
  // Vai trò ký trên Bảng kê: chữ trong ô chọn vai trò của HIS + tiêu đề cột ký trên bảng kê
  const BK_ROLES = {
    NV: { label: 'Nhân viên lập phiếu', optRe: /NHÂN VIÊN LẬP PHIẾU/i, anchor: 'NGƯỜI LẬP BẢNG KÊ' },
    KT: { label: 'Kế toán', optRe: /KẾ TOÁN/i, anchor: 'KẾ TOÁN VIỆN PHÍ' }
  };
  const DEFAULT_CODES = IS_PDT ? ['PDT'] : IS_NOITRU ? ['CT03', 'CT04'] : ['CT07'];
  const todayVN = () => { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; };

  const SIGN_WAIT_MS = 8000; // thời gian chờ tối đa mỗi phiếu chuyển "Đã ký" sau khi bấm Ký
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const normName = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').trim().toUpperCase();
  let stopRequested = false;
  let running = false;

  // ---------- Tiện ích DOM (kể cả iframe cùng nguồn) ----------
  function allDocs() {
    const out = [];
    const walk = (doc, depth) => {
      if (!doc || depth > 4) return;
      out.push(doc);
      doc.querySelectorAll('iframe, frame').forEach(f => {
        try { if (f.contentDocument) walk(f.contentDocument, depth + 1); } catch (_) {}
      });
    };
    walk(document, 0);
    return out;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const win = el.ownerDocument.defaultView;
    if (!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)) return false;
    const cs = win.getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }

  function ownText(el) {
    let t = '';
    el.childNodes.forEach(n => { if (n.nodeType === 3) t += n.nodeValue; });
    return t.replace(/\s+/g, ' ').trim();
  }

  function click(el) {
    if (!el) return;
    try { el.scrollIntoView({ block: 'nearest' }); } catch (_) {}
    el.click();
  }

  async function waitFor(fn, timeout, interval = 200) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (stopRequested) throw new Error('Đã dừng');
      const v = fn();
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }

  // ---------- Danh sách bệnh nhân (lưới bên trái) ----------
  function findPatientGrid() {
    const grids = Array.from(document.querySelectorAll('.ui-jqgrid'));
    const title = g => g.querySelector('.ui-jqgrid-title')?.textContent || '';
    // Trang Khám bệnh nội trú: lưới bệnh nhân là #list_benhnhan (trang còn lưới ẩn khác cũng tên "Danh sách bệnh nhân")
    if (IS_PDT) return document.getElementById('gbox_list_benhnhan');
    return grids.find(g => /Danh sách bệnh nhân/i.test(title(g)))
      || grids.find(g => /Danh sách phiếu thanh toán/i.test(title(g))) // trang Kiểm tra bảng kê (ngoại trú)
      || document.getElementById('gbox_list_benhnhan') // trang Khám bệnh nội trú (tab "Danh sách bệnh nhân")
      || null;
  }

  function colIndex(grid, re) {
    const ths = Array.from(grid.querySelectorAll('.ui-jqgrid-htable tr.ui-jqgrid-labels th'));
    return ths.findIndex(th => re.test((th.textContent || '').trim()));
  }

  function listPatients() {
    const grid = findPatientGrid();
    if (!grid) return [];
    const iName = colIndex(grid, /^Họ tên/i);
    let iPhieu = colIndex(grid, /^S\.?\s*Phi|^Số phiếu/i);
    if (iPhieu < 0) iPhieu = colIndex(grid, /^Mã bệnh án/i);
    // Mọi cột "Họ tên" (kể cả cột ẩn) -> lấy tên dài nhất làm HỌ TÊN ĐẦY ĐỦ (ô hiển thị có thể bị cắt)
    const ths = Array.from(grid.querySelectorAll('.ui-jqgrid-htable tr.ui-jqgrid-labels th'));
    const iNames = ths.map((th, i) => /^(Họ\s*tên|TEN_BENH_NHAN|Tên bệnh nhân)/i.test((th.textContent || '').trim()) ? i : -1).filter(i => i >= 0);
    return Array.from(grid.querySelectorAll('table.ui-jqgrid-btable tr.jqgrow'))
      .filter(r => r.style.display !== 'none')
      .map(r => {
        const tds = r.querySelectorAll(':scope > td');
        const name = (tds[iName]?.textContent || '').trim();
        const phieu = (tds[iPhieu]?.textContent || '').trim();
        const fullName = iNames.map(i => (tds[i]?.textContent || '').replace(/\s+/g, ' ').trim())
          .reduce((a, b) => (b.length > a.length ? b : a), name);
        return { rowId: r.id, name, fullName, phieu, iName: iName >= 0 ? iName : 0 };
      })
      .filter(p => p.name);
  }

  // Giá trị ô nhập ngay sau nhãn (phần thông tin bên phải)
  function valueAfterLabel(labelRe) {
    const labels = Array.from(document.querySelectorAll('td, label, span, div'))
      .filter(el => labelRe.test(ownText(el)) && isVisible(el) && !el.closest('.ui-jqgrid'));
    for (const lb of labels) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      walker.currentNode = lb;
      let n, steps = 0;
      while ((n = walker.nextNode()) && steps++ < 40) {
        if (n.tagName === 'INPUT' && n.type !== 'hidden' && n.type !== 'checkbox' && isVisible(n)) return (n.value || '').trim();
      }
    }
    return '';
  }

  async function selectPatient(p) {
    const grid = findPatientGrid();
    const row = grid && grid.querySelector(`tr.jqgrow[id="${CSS.escape(p.rowId)}"]`);
    if (!row) throw new Error('Không tìm thấy dòng bệnh nhân trong danh sách');
    if (!isVisible(row)) {
      // Trang Khám bệnh nội trú: đang ở tab "Phiếu điều trị" -> về tab "Danh sách bệnh nhân" rồi mới chọn
      const tab = Array.from(document.querySelectorAll('a, li, span'))
        .find(el => ownText(el) === 'Danh sách bệnh nhân' && isVisible(el));
      if (tab) { click(tab.closest('a, li') || tab); await waitFor(() => isVisible(row), 3000, 100); }
    }
    const td = row.querySelectorAll(':scope > td')[p.iName];
    click(td || row);
    const ok = await waitFor(() => normName(valueAfterLabel(/^Họ tên$/i)) === normName(p.name), 15000, 100);
    if (!ok) throw new Error('Chọn bệnh nhân nhưng phần thông tin bên phải không đổi');
    return { soBa: valueAfterLabel(/^Số BA$/i) };
  }

  // ---------- Cửa sổ Ký số VNPTCA ----------
  // Cửa sổ ký số SmartCA của HIS: #smartca-ad-modal-container; khi đóng HIS chỉ thêm class "out" (vẫn còn trong trang)
  function findKySoScope() {
    const cont = document.getElementById('smartca-ad-modal-container');
    if (cont) {
      const modal = document.getElementById('smartca-ad-modal');
      // Khi chưa mở/đã đóng, HIS thu nhỏ cửa sổ về 0 (transform: scale(0)) -> phải đo kích thước thật trên màn hình
      const r = modal ? modal.getBoundingClientRect() : null;
      const open = !cont.classList.contains('out') && isVisible(cont) && r && r.width > 100 && r.height > 100;
      return open ? { doc: document, scope: modal } : null;
    }
    for (const doc of allDocs()) {
      const title = Array.from(doc.querySelectorAll('div, span, td, h1, h2, h3, h4, label'))
        .find(el => /Danh sách các phiếu ký số/i.test(ownText(el)) && isVisible(el));
      if (!title) continue;
      let scope = title;
      for (let el = title.parentElement; el; el = el.parentElement) {
        scope = el;
        if (/VNPTCA|SMARTCA/i.test(el.textContent || '') && /Mã bệnh án|Họ tên/i.test(el.textContent || '')) break;
        if (el === doc.body) break;
      }
      return { doc, scope };
    }
    return null;
  }

  function findSmartCaLauncher() {
    const exact = document.getElementById('smartca-ad-float-button-scanner');
    if (exact && isVisible(exact)) return exact;
    const cands = Array.from(document.querySelectorAll('[title], img[alt], a, button, div, span'))
      .filter(el => /Chữ ký số|Smart\s*CA/i.test((el.getAttribute('title') || '') + ' ' + (el.getAttribute('alt') || '')) && isVisible(el));
    return cands[0] || null;
  }

  async function openKySo(p, info) {
    const launcher = findSmartCaLauncher();
    if (!launcher) throw new Error('Không tìm thấy nút "Chữ ký số Smart CA"');
    click(launcher.closest('a, button') || launcher);
    const ks = await waitFor(() => {
      const s = findKySoScope();
      if (!s) return null;
      const txt = normName(s.scope.textContent);
      if (!txt.includes(normName(p.name))) return null;
      if (info.soBa && !txt.includes(normName(info.soBa))) return null;
      return s;
    }, 20000, 150);
    if (!ks) throw new Error('Không mở được cửa sổ Ký số, hoặc cửa sổ không đúng bệnh nhân');
    return ks;
  }

  // Mở tab trong cửa sổ ký số ("Khác", "Bảng kê"...)
  async function openTab(ks, name = 'Khác') {
    const cands = Array.from(ks.scope.querySelectorAll('a, li, span, div, button'))
      .filter(el => ownText(el) === name && isVisible(el));
    const tab = cands.find(el => el.tagName === 'SPAN' && /bold|700/.test(el.style.fontWeight || '')) || cands[0];
    if (!tab) throw new Error(`Không thấy tab "${name}"`);
    click(tab.closest('a, li, button') || tab.parentElement || tab);
    await waitFor(() => findDocRows(ks).length > 0, 8000, 120);
    await sleep(150);
  }
  const openTabKhac = ks => openTab(ks, 'Khác');

  function findDocRows(ks) {
    const grid = ks.scope.querySelector('#smartca-ad-grid-thong-tin-phieu');
    if (grid) return Array.from(grid.querySelectorAll('tr.jqgrow')).filter(isVisible);
    return Array.from(ks.scope.querySelectorAll('tr'))
      .filter(tr => isVisible(tr) && /XML|Đã ký|Chưa ký/i.test(tr.textContent || '') && tr.querySelectorAll('td').length >= 3);
  }

  const cellText = (tr, col) => (tr.querySelector(`td[aria-describedby$="_${col}"]`)?.textContent || '').normalize('NFC').trim();

  function rowForCode(ks, code) {
    const rows = findDocRows(ks);
    // Lưới có cột mã ký hiệu phiếu -> CHỈ nhận đúng mã (không đoán theo tên, tránh nhầm
    // "Giấy ra viện nội trú (Chuyển tuyến)" với "XML ... GIẤY RA VIỆN CT03")
    const hasKh = rows.some(tr => cellText(tr, 'KY_HIEU_PHIEU'));
    if (hasKh) return rows.find(tr => CODES[code].kh.test(cellText(tr, 'KY_HIEU_PHIEU'))) || null;
    // Dự phòng (lưới kiểu cũ không có cột mã): phiếu XML phải có chữ "XML" trong tên
    return rows.find(tr => {
      const name = (cellText(tr, 'TEN_PHIEU') || tr.querySelector('td')?.textContent || '').normalize('NFC').trim();
      return CODES[code].re.test(name) && (CODES[code].pdf || /XML/i.test(name));
    }) || null;
  }

  // Đọc ĐÚNG ô Trạng thái (không đọc cả dòng: tên phiếu có thể kèm chữ "... đã ký" của người khác)
  function rowStatus(tr) {
    const st = cellText(tr, 'STATUS_F');
    if (st) {
      if (/^Đã ký/i.test(st)) return 'done';
      if (/^Chưa ký/i.test(st)) return 'todo';
      if (/^Đã cập nhật/i.test(st)) return 'partial'; // Bảng kê: đã có người ký một phần
      return 'unknown';
    }
    const tds = Array.from(tr.querySelectorAll(':scope > td'));
    const statusTd = tds.find(td => /^(Đã ký|Chưa ký|Đã cập nhật|Đang ký|Ký lỗi)/i.test((td.textContent || '').normalize('NFC').trim()))
      || tds[1];
    const t = ((statusTd || tr).textContent || '').normalize('NFC').trim();
    if (/Đã ký/i.test(t)) return 'done';
    if (/Chưa ký/i.test(t)) return 'todo';
    return 'unknown';
  }

  // Tìm nút "Ký" trong cột Thao tác của dòng phiếu
  function findSignButton(tr) {
    const exact = tr.querySelector('.smartca-ad-sign-button-scanner');
    if (exact && isVisible(exact)) return { btn: exact, why: 'nút "Ký số SmartCA"' };
    const cell = tr.querySelector('td:last-child');
    if (!cell) return { btn: null, why: 'Không có cột Thao tác' };
    const raw = Array.from(cell.querySelectorAll('button, a, img, input[type="button"], [onclick], [title], i, span'))
      .filter(isVisible);
    const roots = [];
    raw.forEach(el => {
      const r = el.closest('button, a, [onclick]') || el;
      if (cell.contains(r) && !roots.includes(r) && !roots.some(x => x.contains(r))) roots.push(r);
    });
    const desc = el => [el.getAttribute('title'), el.getAttribute('alt'), el.className, el.id, el.getAttribute('onclick'),
      ...Array.from(el.querySelectorAll('img, i, span')).map(x => [x.getAttribute('src'), x.getAttribute('title'), x.getAttribute('alt'), x.className].join(' ')),
      el.getAttribute('src')].join(' ').toLowerCase();
    const isSign = d => /k[yý]\s*s[oố]|kyso|ky_so|sign|smartca|vnptca|chukyso|chữ ký|\bca\b|ca\.(png|svg|jpg)/i.test(d);
    const isOther = d => /xem|view|eye|preview|download|tải|tai_|hủy|huỷ|huy|xóa|xoa|delete|remove|print|nguoi|người|user|person|times|close/i.test(d);
    const signs = roots.filter(r => { const d = desc(r); return isSign(d) && !isOther(d); });
    if (signs.length === 1) return { btn: signs[0], why: 'theo tên/biểu tượng' };
    // Dự phòng theo vị trí: [xem, KÝ, tài liệu] hoặc [xem, người ký, KÝ, tải]
    if (roots.length === 3) return { btn: roots[1], why: 'theo vị trí (2/3)' };
    if (roots.length === 4) return { btn: roots[2], why: 'theo vị trí (3/4)' };
    return { btn: null, why: `Không xác định được nút ký (${roots.length} nút, ${signs.length} khớp)` };
  }

  // Bấm OK các thông báo "thành công"; trả về { success, error }.
  // Nhận diện theo NỘI DUNG chữ (VD hộp "Thông báo hệ thống - Ký số thành công!" + nút "Xác nhận"),
  // không phụ thuộc class của hộp thoại.
  const OK_BTN_RE = /^(OK|Đồng ý|Đóng|Close|Xác nhận)$/i;
  const ERR_RE = /lỗi|thất bại|không thành công|hết hạn|không hợp lệ|error/i;
  const btnText = x => String(x.value || x.textContent || '').normalize('NFC')
    .replace(/\s+/g, ' ').replace(/^[^A-Za-zÀ-ỹĐđ]+|[^A-Za-zÀ-ỹĐđ]+$/g, '').trim(); // bỏ ký tự ✔ / icon ở đầu-cuối

  // Tìm nút Xác nhận/OK trong khối (bất kể thẻ gì: button, a, div, span...)
  function findOkButton(container) {
    const cands = Array.from(container.querySelectorAll('*'))
      .filter(x => OK_BTN_RE.test(btnText(x)) && isVisible(x));
    if (!cands.length) return null;
    // Lấy phần tử sâu nhất có chữ đó, rồi leo lên phần tử bấm được gần nhất
    const deepest = cands.find(x => !cands.some(y => y !== x && x.contains(y))) || cands[0];
    const clickable = deepest.closest('button, a, input, [onclick], [role="button"], .l-btn');
    return clickable && container.contains(clickable) ? clickable : deepest;
  }

  function pressButton(el) {
    const win = el.ownerDocument.defaultView;
    // Hộp SmartCA của HIS: mọi hộp cùng id="smartca-alert" -> bấm Xác nhận hộp trên lại đóng NHẦM hộp dưới.
    // Bấm xong mà hộp này vẫn còn -> tự gỡ đúng hộp này (hộp chỉ thông báo, đã bấm Xác nhận).
    const wrap = el.closest && el.closest('.smartca-alert-wrapper');
    ['mousedown', 'mouseup'].forEach(type => el.dispatchEvent(new win.MouseEvent(type, { bubbles: true, cancelable: true, view: win })));
    el.click();
    if (wrap) setTimeout(() => { if (wrap.isConnected) wrap.remove(); }, 400);
  }

  function isInDocGridRow(el) {
    const tr = el.closest('tr');
    return !!(tr && /Đã ký|Chưa ký|Đã cập nhật/i.test(tr.textContent || ''));
  }

  const NODATA_RE = /không có dữ liệu|không tìm thấy dữ liệu|không tải được tài liệu|không tải được file|không có file/i;
  const LOCK_RE = /bị kh[oó]a|bị khoá|để mở kh[oó]a|mở khoá/i;
  const UNLOCKED_RE = /đã được mở kh[oó]a|đã mở kh[oó]a|đã được mở khoá/i;
  // Cảnh báo chỉ để biết (bấm Xác nhận rồi làm tiếp), VD sau khi ký lại XML: "Số lần gửi XML 130 hoặc 4210 vượt quá 1 lần..."
  // (HIS viết sai chính tả "vướt quá" -> chỉ dựa vào cụm "Số lần gửi XML"; có cả hộp SmartCA lẫn jAlert "Cảnh báo")
  const INFO_RE = /Số lần gửi XML/i;
  let lastSuccessAt = 0, lastErrorAt = 0, lastErrorMsg = '', lastNoDataAt = 0, lastLockAt = 0, lastUnlockedAt = 0, lastInfoAt = 0, lastInfoMsg = '';
  function handleMessageBoxes() {
    const res = { success: false, error: '' };
    for (const doc of allDocs()) {
      const msgs = Array.from(doc.querySelectorAll('body *'))
        .filter(el => {
          if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return false;
          const t = ownText(el).normalize('NFC');
          return t && t.length < 300 && (/thành công/i.test(t) || ERR_RE.test(t) || NODATA_RE.test(t) || LOCK_RE.test(t) || UNLOCKED_RE.test(t) || INFO_RE.test(t)) && isVisible(el)
            && !el.closest('#bhyt-ksh-panel') && !isInDocGridRow(el);
        });
      for (const m of msgs) {
        const t = ownText(m).normalize('NFC');
        // Đi ngược lên tối đa 8 cấp tìm khối chứa nút Xác nhận
        let okBtn = null;
        for (let el = m.parentElement, i = 0; el && i < 8 && !okBtn; el = el.parentElement, i++) {
          if (el === doc.body || /Danh sách các phiếu ký số/i.test(el.textContent || '')) break;
          okBtn = findOkButton(el);
        }
        if (!okBtn) continue; // chỉ là chữ trên trang, không phải hộp thông báo
        const isSuccess = /thành công/i.test(t) && !/không thành công/i.test(t);
        pressButton(okBtn);
        if (INFO_RE.test(t)) { lastInfoAt = Date.now(); lastInfoMsg = t.slice(0, 160); continue; } // chỉ cảnh báo -> làm tiếp
        if (UNLOCKED_RE.test(t)) { lastUnlockedAt = Date.now(); continue; } // "Phiếu đã được mở khóa" -> phải bấm Ký lại
        if (LOCK_RE.test(t)) { lastLockAt = Date.now(); continue; } // "Phiếu đang bị KHÓA" -> Xác nhận để mở khóa
        if (NODATA_RE.test(t)) { lastNoDataAt = Date.now(); continue; } // "Không có dữ liệu!" -> bỏ qua phiếu
        if (!isSuccess) { res.error = t.slice(0, 200); lastErrorMsg = res.error; lastErrorAt = Date.now(); return res; }
        res.success = true;
        lastSuccessAt = Date.now();
      }
    }
    return res;
  }

  // Luôn tự bấm "Xác nhận" cho hộp "Ký số thành công!" trong lúc đang chạy (kể cả lúc chờ chọn BN / mở cửa sổ)
  // ... và thêm 8 giây sau khi chạy xong (HIS có thể báo "Số lần gửi XML ... vượt quá" muộn)
  let sweepUntil = 0, wasRunning = false;
  setInterval(() => {
    if (wasRunning && !running) sweepUntil = Date.now() + 8000;
    wasRunning = running;
    if (running || Date.now() < sweepUntil) { try { handleMessageBoxes(); } catch (_) {} }
  }, 250);

  // Cửa sổ ký số đúng bệnh nhân đang mở (không mở mới)
  function currentKySoFor(ctx) {
    const s = findKySoScope();
    if (!s) return null;
    const txt = normName(s.scope.textContent);
    if (!txt.includes(normName(ctx.p.name))) return null;
    if (ctx.info.soBa && !txt.includes(normName(ctx.info.soBa))) return null;
    return s;
  }

  // Bảo đảm: cửa sổ ký số đúng BN đang mở và đang ở tab "Khác" (HIS có thể tự đóng / tải lại / về tab đầu sau khi ký)
  async function ensureKhac(ctx, tab = 'Khác') {
    let ks = currentKySoFor(ctx);
    if (!ks) {
      if (findKySoScope()) { // đang mở nhưng không khớp BN -> đóng đi
        await closeKySo(findKySoScope());
      }
      ctx.log('    (mở lại cửa sổ Ký số)');
      ks = await openKySo(ctx.p, ctx.info);
      ctx.curTab = null;
    }
    if (ctx.curTab !== tab || !findDocRows(ks).length) {
      await openTab(ks, tab);
      ctx.curTab = tab;
    }
    ctx.ks = ks;
    return ks;
  }

  function visibleDialogTitles() {
    const out = [];
    allDocs().forEach(doc => doc.querySelectorAll('.ui-dialog-title, .panel-title, .modal-title, .window-title, .swal2-title, .messager-body')
      .forEach(el => { if (isVisible(el) && ownText(el)) out.push(ownText(el).slice(0, 60)); }));
    return out.join(' | ');
  }

  // Hộp thông báo của HIS còn đang hiện không?
  function messageBoxVisible() {
    return allDocs().some(doc => Array.from(doc.querySelectorAll('body *')).some(el =>
      /^(Thông báo hệ thống)$/i.test(ownText(el).normalize('NFC')) && isVisible(el)));
  }

  // Chờ lưới phiếu nạp xong và đứng yên (nội dung không đổi 500ms), không còn hộp thông báo
  async function waitGridStable(ctx, timeout = 4000) {
    const start = Date.now();
    let last = '', since = Date.now();
    while (Date.now() - start < timeout) {
      if (stopRequested) throw new Error('Đã dừng');
      handleMessageBoxes();
      const cur = currentKySoFor(ctx);
      const sig = cur ? findDocRows(cur).map(r => r.textContent).join('|') : '';
      if (sig !== last) { last = sig; since = Date.now(); }
      else if (sig && !messageBoxVisible() && Date.now() - since >= 500) return true;
      await sleep(120);
    }
    return false;
  }

  async function signOne(ctx, code) {
    let tabOf = CODES[code].tab || 'Khác'; // tab chứa phiếu trong cửa sổ ký số
    let ks = await ensureKhac(ctx, tabOf);
    await waitGridStable(ctx);
    // Lưới có thể đang tải lại sau lần ký trước -> chờ tối đa 5 giây cho dòng phiếu xuất hiện
    const findIn = ms => waitFor(() => {
      handleMessageBoxes();
      const cur = currentKySoFor(ctx) || ks;
      return rowForCode(cur, code);
    }, ms, 150);
    let tr = await findIn(5000);
    // Phiếu có thể nằm ở tab khác tuỳ trang (VD trang BANT) -> tìm tiếp; thấy thì nhớ tab đó cho các BN sau
    // (Tìm tab khác tối đa 2 BN không thấy, tránh làm chậm mọi BN không có phiếu này)
    const c = CODES[code];
    if (!tr && c.altTabs && (c.altMiss || 0) < 2) {
      for (const alt of c.altTabs) {
        try { ks = await ensureKhac(ctx, alt); } catch (_) { continue; }
        await waitGridStable(ctx);
        tr = await findIn(1500);
        if (tr) { tabOf = alt; c.tab = alt; c.altTabs = null; ctx.log(`  ${code}: phiếu nằm ở tab "${alt}"`); break; }
      }
      if (!tr) c.altMiss = (c.altMiss || 0) + 1;
    }
    if (!tr) return { code, result: 'skip', note: 'Không có phiếu' };
    let st = rowStatus(tr);
    // Phiếu XML "Đã cập nhật" (đã từng ký rồi bị HỦY KÝ, VD khoa hủy để sửa bệnh) và KHÔNG còn nút Hủy ký số (X)
    // = hiện đang chưa có chữ ký -> ký lại
    if (st === 'partial' && !tr.querySelector('[data-type="btn-huy-ky-so"]')) { st = 'todo'; ctx.log(`  ${code}: đã bị hủy ký trước đó -> ký lại`); }
    if (st === 'done') return { code, result: 'skip', note: 'Đã ký từ trước' };
    if (st === 'partial') return { code, result: 'skip', note: 'Đã ký (Đã cập nhật, còn nút Hủy ký số)' };
    if (st !== 'todo') return { code, result: 'error', note: 'Không rõ trạng thái: ' + (tr.textContent || '').replace(/\s+/g, ' ').slice(0, 80) };
    let { btn, why } = findSignButton(tr);
    if (!btn) return { code, result: 'error', note: why };
    ctx.log(`  ${code}: đang ký...`);
    let clickedAt = Date.now();
    click(btn);

    let errMsg = '', lastEnsure = Date.now(), sawSuccessAt = 0, unlockTries = 0;
    let start = Date.now();
    while (Date.now() - start < SIGN_WAIT_MS) {
      if (stopRequested) throw new Error('Đã dừng');
      await sleep(150);
      handleMessageBoxes();
      // "Phiếu này đang bị KHÓA ... Nhấn xác nhận để mở khóa" -> đã bấm Xác nhận; chờ rồi bấm Ký lại
      if (lastLockAt > clickedAt) {
        if (++unlockTries > 2) { errMsg = 'Phiếu bị khóa, đã mở khóa 2 lần vẫn không ký được'; break; }
        ctx.log(`  ${code}: 🔓 phiếu bị khóa -> đã mở khóa, ký lại (lần ${unlockTries})`);
        // Có thể HIS tự ký luôn sau khi mở khóa -> chờ 2 giây xem có "thành công" không
        const unlockAt = Date.now();
        await waitFor(() => { handleMessageBoxes(); return lastSuccessAt > unlockAt || lastErrorAt > unlockAt; }, 2000, 150);
        if (lastSuccessAt > unlockAt) { await sleep(600); await waitGridStable(ctx); return { code, result: 'ok', note: 'Đã ký (sau khi mở khóa)' }; }
        await waitGridStable(ctx);
        const cur = currentKySoFor(ctx);
        const row = cur && rowForCode(cur, code);
        if (!row) break;
        if (rowStatus(row) === 'done') return { code, result: 'ok', note: 'Đã ký (sau khi mở khóa)' };
        ({ btn, why } = findSignButton(row));
        if (!btn) { errMsg = why; break; }
        clickedAt = Date.now();
        start = Date.now();
        click(btn);
        continue;
      }
      if (lastErrorAt > clickedAt) { errMsg = lastErrorMsg; break; }
      if (lastNoDataAt > clickedAt) { await sleep(200); return { code, result: 'skip', nodata: true, note: 'HIS báo "Không có dữ liệu" -> bỏ qua' }; }
      // Ký nhanh: HIS báo "Ký số thành công!" (đã tự bấm Xác nhận) -> qua phiếu kế tiếp ngay
      if (lastSuccessAt > clickedAt) {
        await sleep(600);
        await waitGridStable(ctx); // chờ HIS cập nhật lưới xong rồi mới qua phiếu kế
        return { code, result: 'ok', note: 'Đã ký' };
      }

      const cur = currentKySoFor(ctx);
      const r = cur ? rowForCode(cur, code) : null;
      if (r && rowStatus(r) === 'done') return { code, result: 'ok', note: 'Đã ký' };

      // Cửa sổ bị đóng hoặc về tab khác -> mở lại để đọc trạng thái (mỗi 3 giây tối đa 1 lần)
      if ((!cur || !findDocRows(cur).length) && Date.now() - lastEnsure > 1500) {
        lastEnsure = Date.now();
        try { await ensureKhac(ctx, tabOf); } catch (e) { ctx.log('    ' + e.message); }
      }
      // Đã báo "Ký số thành công": nếu dòng phiếu biến khỏi danh sách "Chưa hoàn thành" (lưới đã nạp xong) -> đã ký
      if (sawSuccessAt && cur && !r && findDocRows(cur).length && Date.now() - sawSuccessAt > 1500) {
        return { code, result: 'ok', note: 'Đã ký (thông báo thành công)' };
      }
      // Báo thành công mà 20 giây vẫn không đọc được trạng thái -> coi như đã ký
      if (sawSuccessAt && Date.now() - sawSuccessAt > 2000) return { code, result: 'ok', note: 'Đã ký (thông báo thành công)' };
    }
    if (errMsg) return { code, result: 'error', note: errMsg };
    const cur = currentKySoFor(ctx);
    const r = cur ? rowForCode(cur, code) : null;
    return { code, result: 'error', note: `Quá ${SIGN_WAIT_MS / 1000} giây chưa thấy "Đã ký". Trạng thái dòng: ${r ? (r.textContent || '').replace(/\s+/g, ' ').slice(0, 80) : 'không thấy dòng'}. Cửa sổ đang mở: ${visibleDialogTitles() || 'không có'}` };
  }

  async function closeKySo(ks) {
    const btn = findCloseButton(ks);
    if (btn) click(btn.closest('button, a') || btn);
    else ks.doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    const closed = await waitFor(() => !findKySoScope(), 8000, 120);
    if (!closed) throw new Error('Không đóng được cửa sổ Ký số');
    await sleep(150);
  }

  // Nút X đỏ = nút CUỐI CÙNG trên thanh tiêu đề "KÝ SỐ VNPTCA" (sách, bánh răng, cắt, X).
  function findHeaderCloseButton(ks) {
    const title = Array.from(ks.scope.querySelectorAll('h1, h2, h3, h4, div, span, b, strong, td'))
      .find(el => /^KÝ SỐ (VNPTCA|SMART\s*CA)\b/i.test(ownText(el).normalize('NFC')) && isVisible(el));
    if (!title) return null;
    for (let el = title.parentElement, i = 0; el && i < 5; el = el.parentElement, i++) {
      if (/Danh sách các phiếu ký số|Mã bệnh án/i.test(el.textContent || '')) break; // đã ra khỏi thanh tiêu đề
      const btns = [];
      el.querySelectorAll('button, a, [onclick], [role="button"], img, i, svg').forEach(x => {
        if (!isVisible(x) || title.contains(x)) return;
        const r = x.closest('button, a, [onclick], [role="button"]') || x;
        if (el.contains(r) && !btns.includes(r) && !btns.some(b => b.contains(r) || r.contains(b))) btns.push(r);
      });
      if (btns.length >= 2) {
        // Lấy nút nằm bên PHẢI nhất, và phải nằm bên phải tiêu đề
        const tRight = title.getBoundingClientRect().right;
        const right = btns.filter(b => b.getBoundingClientRect().left > tRight)
          .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)[0];
        if (right) return right;
      }
    }
    return null;
  }

  function findCloseButton(ks) {
    const exact = document.getElementById('smartca-ad-modal-close-button');
    if (exact && isVisible(exact)) return exact;
    const header = findHeaderCloseButton(ks);
    if (header) return header;
    const isClose = el => {
      const d = [el.getAttribute('title'), el.className?.baseVal ?? el.className, el.id, el.getAttribute('aria-label'),
        el.getAttribute('data-dismiss'), el.getAttribute('data-bs-dismiss'),
        ...Array.from(el.querySelectorAll('i, img, span, svg, use')).map(x => [x.className?.baseVal ?? x.className, x.getAttribute('src'), x.getAttribute('title'), x.getAttribute('href'), x.getAttribute('xlink:href')].join(' '))]
        .join(' ').toLowerCase();
      if (/hoàn thành/i.test(el.parentElement?.parentElement?.textContent || '')) return false; // nút gạt Chưa/Đã hoàn thành
      return /đóng|close|thoát|exit|fa-times|fa-close|fa-xmark|btn-close|panel-tool-close|modal/.test(d) || /^[×✕✖]$/i.test((el.textContent || '').trim());
    };
    const pools = [ks.scope];
    const frame = ks.doc.defaultView.frameElement;
    if (frame) {
      const host = frame.closest('.window, .ui-dialog, .modal, [role="dialog"], .panel');
      if (host) pools.push(host);
    }
    let btn = null;
    for (const pool of pools) {
      // Chỉ lấy nút đóng của cửa sổ, TUYỆT ĐỐI không lấy nút "hủy ký" (X đỏ) trong lưới phiếu
      btn = Array.from(pool.querySelectorAll('button, a, span, div, i, img'))
        .filter(el => isVisible(el) && !el.closest('.ui-jqgrid, .ui-jqgrid-btable') &&
          !(el.closest('tr') && /Đã ký|Chưa ký/i.test(el.closest('tr').textContent || '')) && isClose(el))[0];
      if (btn) break;
    }
    return btn;
  }

  // ---------- Ký BẢNG KÊ trên PDF (trình ký SmartCA V2) ----------
  // Gọi sang kyso_main.js (MAIN world) để đọc vị trí chữ trong PDF
  let mainReqId = 0;
  function mainCall(cmd, args, timeout = 8000) {
    return new Promise((resolve, reject) => {
      const id = 'ksh' + (++mainReqId) + '_' + Date.now();
      const onMsg = e => {
        const d = e.data;
        if (e.source !== window || !d || d.__bhytKsh !== 'res' || d.id !== id) return;
        window.removeEventListener('message', onMsg);
        clearTimeout(timer);
        d.error ? reject(new Error(d.error)) : resolve(d.result);
      };
      const timer = setTimeout(() => { window.removeEventListener('message', onMsg); reject(new Error('Không đọc được nội dung PDF (hết thời gian)')); }, timeout);
      window.addEventListener('message', onMsg);
      window.postMessage({ __bhytKsh: 'req', id, cmd, args }, '*');
    });
  }

  const $id = id => document.getElementById(id);
  // Hiện thật trên màn hình (đo kích thước thật, vì HIS hay ẩn bằng cách thu nhỏ về 0)
  const shown = el => { if (!el || !isVisible(el)) return false; const r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; };
  const pdfViewerOpen = () => shown($id('smartcav2-plugin')) && shown($id('smartcav2-plugin-button-complete-sign'));
  // Màn hình chờ của HIS ("Đang kiểm tra thông tin phiếu ký số. Vui lòng đợi...")
  const hisLoading = () => Array.from(document.querySelectorAll('body *')).some(el =>
    /Vui lòng đợi|Đang kiểm tra thông tin phiếu|Đang thực hiện yêu cầu|Đang lấy dữ liệu/i.test(ownText(el)) && shown(el));
  // Trình ký PDF đã sẵn sàng: hiện khung ký, nút "Chữ ký", đã vẽ trang cuối, không còn màn hình chờ
  const pdfViewerReady = () => {
    const total = pdfTotalPages();
    const cv = total ? pdfCanvas(total) : null;
    // (Không dựa vào chữ "Vui lòng đợi": HIS để sẵn chữ này trong trang dù đã tải xong)
    // (Bảng "Chữ ký" chỉ được HIS tạo khi rê chuột vào nút lần đầu -> không đòi có sẵn)
    return pdfViewerOpen() && shown($id('smartcav2-plugin-top-menu-button-sign-list'))
      && total > 0 && cv && cv.width > 0;
  };
  const PDF_OPEN_WAIT_MS = 15000; // thời gian chờ tối đa HIS mở trình ký PDF
  const pdfTotalPages = () => parseInt($id('smartcav2-plugin-top-menu-page-nums-text')?.value || '0', 10) || 0;
  const pdfCurrentPage = () => parseInt($id('smartcav2-plugin-top-menu-input-page')?.value || '0', 10) || 0;
  const pdfCanvas = n => $id('smartcav2-plugin-canvas-' + n);
  const pageWrappers = n => Array.from(document.querySelectorAll(`#smartcav2-plugin-pdf-viewer-${n} .smartcav2-plugin-signature-wrapper`));

  function fireMouse(type, x, y, target) {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: type === 'mouseup' ? 0 : 1 }));
  }

  // Kéo khung chữ ký (jQuery UI draggable của HIS) tới vị trí left/top (px trong trang PDF) bằng thao tác chuột giả lập
  // getW(): tìm lại khung mỗi lần (HIS vẽ lại khung chữ ký khi cuộn/chuyển trang). KHÔNG tự cuộn trang khi kéo.
  async function dragWrapperTo(getW, left, top) {
    fireMouse('mouseup', 0, 0, document); // xóa trạng thái "đang giữ chuột" bị kẹt của jQuery UI (nếu có)
    await sleep(80);
    for (let attempt = 0; attempt < 4; attempt++) {
      const w = getW();
      if (!w) return false;
      const curL = parseFloat(w.style.left) || 0, curT = parseFloat(w.style.top) || 0;
      const dx = left - curL, dy = top - curT;
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return true;
      const grip = w.querySelector('img') || w;
      const r = grip.getBoundingClientRect();
      const sx = r.left + r.width / 2, sy = r.top + r.height / 2;
      const hit = document.elementFromPoint(sx, sy);
      fireMouse('mousedown', sx, sy, hit && w.contains(hit) ? hit : grip);
      for (let i = 1; i <= 12; i++) { fireMouse('mousemove', sx + dx * i / 12, sy + dy * i / 12, document); await sleep(15); }
      fireMouse('mouseup', sx + dx, sy + dy, document);
      await sleep(250);
    }
    const w = getW();
    return !!w && Math.abs((parseFloat(w.style.left) || 0) - left) < 4 && Math.abs((parseFloat(w.style.top) || 0) - top) < 4;
  }

  async function gotoPdfPage(n) {
    if (pdfCurrentPage() === n) return;
    if (n === pdfTotalPages()) click($id('smartcav2-plugin-top-menu-button-last-page'));
    else {
      for (let i = 0; i < 50 && pdfCurrentPage() > n; i++) { click($id('smartcav2-plugin-top-menu-button-previous-page')); await sleep(250); }
      for (let i = 0; i < 50 && pdfCurrentPage() < n; i++) { click($id('smartcav2-plugin-top-menu-button-next-page')); await sleep(250); }
    }
    if (!await waitFor(() => pdfCurrentPage() === n && pdfCanvas(n), 5000, 100)) throw new Error('Không chuyển được tới trang ' + n + ' của bảng kê');
    await sleep(300);
  }

  // Khung chữ ký trên MỌI trang + trang chứa nó
  const allWrappers = () => Array.from(document.querySelectorAll('[id^="smartcav2-plugin-pdf-viewer-"] .smartcav2-plugin-signature-wrapper'));
  const wrapperPage = w => parseInt((w.closest('[id^="smartcav2-plugin-pdf-viewer-"]')?.id || '').split('-').pop(), 10) || 0;
  const roleWrappers = role => role.anyRole ? allWrappers() : allWrappers().filter(x => role.optRe.test((x.textContent || '').normalize('NFC')));

  // Xóa khung chữ ký (nút x nhỏ trên đầu khung - chỉ bỏ khung khỏi lượt ký đang làm, KHÔNG phải "Hủy ký số")
  async function removeWrapper(w) {
    const x = w.querySelector('[id^="smartcav2-plugin-signature-button-"]') || w.querySelector('.fa-times')?.parentElement;
    if (!x) return false;
    const id = w.id;
    click(x);
    // HIS hỏi "Xóa chữ ký này?" -> Xác nhận
    return !!await waitFor(() => {
      acceptConfirm(/Xóa chữ ký này/i);
      const cur = id ? document.getElementById(id) : w;
      return !cur || !cur.isConnected || !shown(cur);
    }, 4000, 150);
  }

  // Thêm chữ ký vai trò vào ĐÚNG trang `page`. Khi phiếu chỉ còn 1 vai trò, HIS tự thêm sẵn 1 khung lúc mở
  // (thường ở trang đầu) -> dùng lại nếu đúng trang, sai trang thì xóa rồi thêm lại.
  async function addSignatureForRole(role, page) {
    for (const w of roleWrappers(role)) {
      if (wrapperPage(w) === page) return w;
      await removeWrapper(w);
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      await gotoPdfPage(page);
      const w = await addSignatureOnce(role);
      if (w && wrapperPage(w) === page) return w;
      if (w) await removeWrapper(w); // HIS thêm nhầm trang -> xóa, thử lại
    }
    const again = roleWrappers(role).find(x => wrapperPage(x) === page);
    if (again) return again;
    throw new Error(`Không thêm được chữ ký vai trò "${role.label}" vào trang ${page}`);
  }

  // Mở bảng "Chữ ký", chọn vai trò, bấm thêm chữ ký; trả về khung mới (ở bất kỳ trang nào)
  async function addSignatureOnce(role) {
    await waitFor(() => shown($id('smartcav2-plugin-top-menu-button-sign-list')), 15000, 200);
    const btn = $id('smartcav2-plugin-top-menu-button-sign-list');
    if (!btn) throw new Error('Không thấy nút "Chữ ký" trong trình ký');
    // HIS tạo + mở bảng chữ ký khi rê chuột vào nút "Chữ ký"
    const pop = await waitFor(() => {
      const p = $id('smartcav2-plugin-chu-ky-popover');
      if (p && shown(p) && $id('smartcav2-plugin-chu-ky-popover-vai-tro-select')) return p;
      btn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, view: window }));
      btn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, view: window }));
      return null;
    }, 8000, 400);
    if (!pop) throw new Error('Không mở được bảng "Chữ ký"');
    const sel = $id('smartcav2-plugin-chu-ky-popover-vai-tro-select');
    const opts = sel ? Array.from(sel.options).filter(o => o.value !== '-1') : [];
    const opt = role.anyRole
      ? (opts.find(o => role.prefer.test(o.text.normalize('NFC'))) || opts[0])
      : opts.find(o => role.optRe.test(o.text.normalize('NFC')));
    if (!opt) throw new Error(`Tài khoản không có vai trò "${role.label}" trên phiếu này`);
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(250);
    const add = pop.querySelector('[id^="smartcav2-plugin-chu-ky-list-chu-ky-item-button-add-"]');
    if (!add) throw new Error('Chưa có mẫu chữ ký nào (vào "Chữ ký" -> "Thêm mẫu chữ ký" trước)');
    const before = new Set(allWrappers().map(x => x.id || x));
    click(add);
    const w = await waitFor(() => {
      // Vai trò đã có 1 khung -> HIS hỏi "Vai trò này đã có chữ ký tồn tại. Bạn có muốn tiếp tục thêm không?" -> Đồng ý
      acceptConfirm(/đã có chữ ký tồn tại/i);
      return roleWrappers(role).find(x => !before.has(x.id || x));
    }, 5000, 100);
    // Đóng bảng chữ ký cho khỏi che
    const closeBtn = Array.from(pop.querySelectorAll('*')).find(x => /^Đóng$/.test(btnText(x)) && isVisible(x));
    if (closeBtn) click(closeBtn.closest('[id], button, div') || closeBtn);
    await sleep(200);
    return w || null;
  }

  // Bấm Đồng ý/OK cho hộp hỏi xác nhận có nội dung khớp `re`
  function acceptConfirm(re) {
    const msg = Array.from(document.querySelectorAll('body *'))
      .find(el => re.test(ownText(el).normalize('NFC')) && isVisible(el) && !el.closest('#bhyt-ksh-panel'));
    for (let el = msg && msg.parentElement, i = 0; el && i < 8; el = el.parentElement, i++) {
      if (el === document.body) break;
      // Chỉ bấm nút ĐỒNG Ý (không bấm Đóng/Hủy). Nút có thể là div/span (hộp thông báo SmartCA) -> xét mọi thẻ
      const cands = Array.from(el.querySelectorAll('*'))
        .filter(x => /^(OK|Đồng ý|Xác nhận|Tiếp tục|Có|Yes)$/i.test(btnText(x)) && isVisible(x));
      if (cands.length) {
        const CLICKABLE = 'button, a, input, [onclick], [role="button"], .l-btn';
        // Ưu tiên phần tử là nút thật (tránh bấm nhầm tiêu đề hộp thoại "Xác nhận"), sau đó tới phần tử sâu nhất
        const real = cands.map(x => x.closest(CLICKABLE)).find(b => b && el.contains(b) && !/title/i.test(b.id + ' ' + b.className));
        const deepest = cands.filter(x => !/title|header/i.test(x.id + ' ' + x.className))
          .find(x => !cands.some(y => y !== x && x.contains(y)));
        const target = real || deepest;
        if (target) { pressButton(target); return true; }
      }
    }
    return false;
  }

  // Tìm vị trí đặt chữ ký: ngay dưới dòng "(ký, ghi rõ họ tên)" của cột tiêu đề vai trò
  function computeTarget(info, role, page, w) {
    const anchors = info.hits.filter(h => h.page === page && h.s.toUpperCase().includes(role.anchor));
    if (!anchors.length) return null;
    const a = anchors[anchors.length - 1];
    const aCx = a.x + a.w / 2;
    const sub = info.hits.filter(h => h.page === page && /ký, ghi rõ họ tên/i.test(h.s)
      && Math.abs((h.x + h.w / 2) - aCx) < 60 && h.y < a.y && a.y - h.y < 30)
      .sort((p, q) => q.y - p.y)[0];
    const ref = sub || a;
    const pg = info.pages.find(p => p.n === page) || { h: 842, w: 595 };
    const sc = info.scale || 1.5;
    const cv = pdfCanvas(page);
    const maxL = (cv ? cv.offsetWidth : pg.w * sc) - w.offsetWidth;
    const maxT = (cv ? cv.offsetHeight : pg.h * sc) - w.offsetHeight;
    const left = Math.max(0, Math.min(maxL, Math.round((ref.x + ref.w / 2) * sc - w.offsetWidth / 2)));
    const top = Math.max(0, Math.min(maxT, Math.round((pg.h - ref.y) * sc + 4)));
    return { left, top };
  }

  // Vai trò đã ký sẵn: tên phiếu HIS ghi kèm dòng "KẾ TOÁN; NHÂN VIÊN LẬP PHIẾU đã ký"
  function signedRolesText(tr) {
    const t = (tr.querySelector('td[aria-describedby$="_TEN_PHIEU_F"]')?.innerText || '').normalize('NFC');
    const m = t.match(/\n([^\n]*)đã ký/i);
    return m ? m[1].toUpperCase() : '';
  }

  async function signBangKe(ctx, roleKeys, dryRun, code = 'BANGKE') {
    let ks = await ensureKhac(ctx, CODES[code].tab || 'Khác');
    await waitGridStable(ctx);
    const tr = rowForCode(currentKySoFor(ctx) || ks, code);
    if (!tr) return { code, result: 'skip', note: 'Không có phiếu bảng kê' };
    const signed = signedRolesText(tr);
    if (ctx.bkSigned) ctx.bkSigned[code] = signed; // để ghi nhận vai trò nào đã ký (xuất Excel vị trí chưa ký)
    // Ô trạng thái của Bảng kê không đáng tin ("Đã ký" dù mới 1 vai trò ký) -> dựa vào dòng "<vai trò> đã ký" dưới tên phiếu.
    // Chỉ bỏ qua theo trạng thái khi "Đã ký" mà HIS không ghi vai trò nào.
    if (rowStatus(tr) === 'done' && !signed) return { code, result: 'skip', note: 'Đã ký từ trước' };
    const ORDER = ['NV', 'KT']; // Nhân viên lập phiếu ký trước, Kế toán ký sau
    const todo = roleKeys.filter(k => !BK_ROLES[k].optRe.test(signed)).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
    if (!todo.length) return { code, result: 'skip', note: `Đã ký (${signed.trim()})` };
    // Kế toán chỉ ký được khi Nhân viên lập phiếu đã ký (hoặc ký cùng lượt)
    if (todo.includes('KT') && !todo.includes('NV') && !BK_ROLES.NV.optRe.test(signed)) {
      return { code, result: 'skip', note: 'Kế toán chỉ ký được sau Nhân viên lập phiếu -> tích thêm "Nhân viên lập phiếu" để ký cùng lượt' };
    }
    const { btn, why } = findSignButton(tr);
    if (!btn) return { code, result: 'error', note: why };

    ctx.log(`  BK: mở trình ký PDF (${todo.map(k => BK_ROLES[k].label).join(' + ')})...`);
    const ready = await openPdfViewer(ctx, btn, () => rowForCode(currentKySoFor(ctx) || ks, code), 'BK');
    if (ready !== true) {
      if (ready) return { code, result: 'error', note: ready };
      if (signed) {
        // HIS: tài khoản đã ký phiếu này rồi thì chỉ hiện/tải file đã ký, KHÔNG mở trình ký lần 2
        return { code, result: 'skip', note: `HIS không mở trình ký vì phiếu đã có chữ ký (${signed.trim()}). Một tài khoản chỉ ký bảng kê 1 lần -> vai trò còn lại phải ký bằng tài khoản khác, hoặc lần sau tích cả 2 vai trò để ký cùng lượt.` };
      }
      return { code, result: 'error', note: `Quá ${PDF_OPEN_WAIT_MS / 1000} giây HIS chưa mở xong trình ký PDF` };
    }

    const info = await mainCall('pdfText', { patterns: [BK_ROLES.NV.anchor, BK_ROLES.KT.anchor, 'ký, ghi rõ họ tên', 'XÁC NHẬN CỦA NGƯỜI BỆNH'] });
    const hitsOf = text => info.hits.filter(h => h.s.toUpperCase().includes(text));
    // Mẫu không có "NGƯỜI LẬP BẢNG KÊ" (VD bảng kê KHÔNG BHYT ngoại trú): Nhân viên lập phiếu ký ở CỘT TRÁI,
    // cùng hàng với "KẾ TOÁN VIỆN PHÍ" (thẳng cột với "XÁC NHẬN CỦA NGƯỜI BỆNH" nếu có)
    if (todo.includes('NV') && !hitsOf(BK_ROLES.NV.anchor).length && hitsOf(BK_ROLES.KT.anchor).length) {
      const kt = hitsOf(BK_ROLES.KT.anchor).sort((a, b) => b.page - a.page || a.y - b.y)[0];
      const xn = hitsOf('XÁC NHẬN CỦA NGƯỜI BỆNH').filter(h => h.page === kt.page).sort((a, b) => b.y - a.y)[0];
      const pg = info.pages.find(p => p.n === kt.page) || { w: 595 };
      const cx = xn ? xn.x + xn.w / 2 : pg.w * 0.25;
      info.hits.push({ page: kt.page, s: BK_ROLES.NV.anchor, x: cx - kt.w / 2, y: kt.y, w: kt.w, fallback: true });
      ctx.log('  BK: mẫu không có "NGƯỜI LẬP BẢNG KÊ" -> đặt chữ ký Nhân viên ở cột trái, cùng hàng Kế toán');
    }
    for (const k of todo) {
      const role = BK_ROLES[k];
      const pages = info.hits.filter(h => h.s.toUpperCase().includes(role.anchor)).map(h => h.page);
      if (!pages.length) throw new Error(`Không tìm thấy chữ "${role.anchor}" trong bảng kê`);
      const page = Math.max(...pages);
      await gotoPdfPage(page);
      const w = await addSignatureForRole(role, page);
      const t = computeTarget(info, role, page, w);
      if (!t) throw new Error(`Không tính được vị trí ký "${role.anchor}"`);
      // Khung chữ ký của vai trò này trên trang (HIS có thể vẽ lại -> tìm lại theo tên vai trò)
      const getW = () => pageWrappers(page).filter(x => role.optRe.test((x.textContent || '').normalize('NFC'))).pop();
      let moved = await dragWrapperTo(getW, t.left, t.top);
      if (!moved) {
        // Kéo thả không ăn -> đặt trực tiếp bằng hàm của HIS
        try {
          const res = await mainCall('placeSignature', { page, roleRe: role.optRe.source, left: t.left, top: t.top });
          const s = res.saved;
          moved = !!s && Math.abs(s.left - t.left) < 4 && Math.abs(s.top - t.top) < 4;
        } catch (e) { ctx.log('    ' + e.message); }
      }
      if (!moved) throw new Error(`Không kéo được chữ ký "${role.label}" vào đúng vị trí`);
      ctx.log(`  BK: đặt chữ ký ${role.label} dưới "${role.anchor}" (trang ${page})`);
    }

    if (dryRun) {
      return { code, result: 'skip', note: 'CHẠY THỬ: đã đặt chữ ký, CHƯA bấm "Hoàn tất ký số". Bạn kiểm tra rồi bấm Đóng.', dry: true };
    }

    const err = await completePdfSign(ctx, 'BK');
    if (err) return { code, result: 'error', note: err };
    if (ctx.bkSigned) ctx.bkSigned[code] = (signed + ' ' + todo.map(k => BK_ROLES[k].label).join(' ')).toUpperCase();
    return { code, result: 'ok', note: `Đã ký (${todo.map(k => BK_ROLES[k].label).join(' + ')})` };
  }

  // Bấm nút ký trên dòng phiếu rồi chờ trình ký PDF mở xong.
  // Trả về true = sẵn sàng; chuỗi = lỗi; false = hết giờ chưa mở.
  async function openPdfViewer(ctx, btn, findRow, tag) {
    let clickAt = Date.now();
    click(btn);
    let openStart = Date.now();
    let lastTick = 0, reclicks = 0, ready = false;
    while (Date.now() - openStart < PDF_OPEN_WAIT_MS) {
      if (stopRequested) throw new Error('Đã dừng');
      handleMessageBoxes();
      if (pdfViewerReady()) { ready = true; break; }
      // Phiếu bị khóa -> HIS mở khóa xong báo "Phiếu đã được mở khóa" nhưng KHÔNG tự mở trình ký -> bấm Ký lại
      if (lastUnlockedAt > clickAt && reclicks < 2) {
        reclicks++;
        ctx.log(`  ${tag}: 🔓 phiếu đã được mở khóa -> bấm Ký lại`);
        await sleep(800);
        const row = findRow();
        const b2 = row && findSignButton(row).btn;
        if (!b2) return 'Mở khóa xong nhưng không thấy lại nút ký';
        clickAt = Date.now();
        click(b2);
        openStart = Date.now();
        lastTick = 0;
        continue;
      }
      if (lastNoDataAt > clickAt) return 'HIS báo "Không có dữ liệu"';
      if (lastErrorAt > clickAt) return lastErrorMsg;
      const sec = Math.floor((Date.now() - openStart) / 1000);
      if (sec - lastTick >= 5) { lastTick = sec; ctx.log(`  ${tag}: đang chờ HIS mở trình ký... ${sec}s`); }
      await sleep(300);
    }
    if (!ready) return false;
    await sleep(1000); // chờ HIS vẽ xong và gắn sự kiện cho các nút
    // Chờ HIS làm xong việc của nó (về trang đầu, tự thêm khung chữ ký khi chỉ còn 1 vai trò): đứng yên 1,2 giây
    let sig = '', since = Date.now();
    const t0 = Date.now();
    while (Date.now() - t0 < 6000) {
      const s = pdfCurrentPage() + '|' + allWrappers().length;
      if (s !== sig) { sig = s; since = Date.now(); } else if (Date.now() - since >= 1200) break;
      await sleep(150);
    }
    return true;
  }

  // Bấm "Hoàn tất ký số" và chờ kết quả. Trả về '' nếu thành công, ngược lại là nội dung lỗi.
  async function completePdfSign(ctx, tag) {
    const doneAt = Date.now();
    click($id('smartcav2-plugin-button-complete-sign'));
    ctx.log(`  ${tag}: Hoàn tất ký số...`);
    const ok = await waitFor(() => {
      handleMessageBoxes();
      return lastSuccessAt > doneAt || lastErrorAt > doneAt || !pdfViewerOpen();
    }, 30000, 200);
    if (lastErrorAt > doneAt) return lastErrorMsg;
    if (!ok) return 'Quá 30 giây chưa ký xong';
    await waitFor(() => { handleMessageBoxes(); return !pdfViewerOpen(); }, 8000, 200);
    await sleep(500);
    await waitGridStable(ctx);
    return '';
  }

  // Đóng trình ký PDF KHÔNG ký (nút "Đóng" + Xác nhận "Vẫn đóng form?") - phiếu được mở khóa lại
  async function closePdfNoSign() {
    if (!pdfViewerOpen()) return;
    click($id('smartcav2-plugin-button-close-form'));
    // HIS hỏi "Trong khung ký hiện đã có chữ ký được thêm. Vẫn đóng form?" -> Xác nhận (đóng, KHÔNG ký)
    await waitFor(() => { acceptConfirm(/Vẫn đóng form/i); return !pdfViewerOpen(); }, 8000, 300);
  }

  // ---------- Ký PHIẾU ĐIỀU TRỊ (trang Khám bệnh nội trú) ----------
  // Mỗi tờ điều trị có thể có nhiều y lệnh, mỗi y lệnh kết thúc bằng dòng "BSCKI.Tên bác sĩ" ->
  // đặt 1 khung chữ ký ngay PHÍA TRÊN mỗi dòng đó (vị trí thay đổi theo từng phiếu nên đọc từ PDF).
  const pdtSoPhieu = tr => cellText(tr, 'SO_PHIEU_DIEU_TRI') || cellText(tr, 'SO_PHIEU');
  const pdtRows = ks => findDocRows(ks).filter(tr => CODES.PDT.kh.test(cellText(tr, 'KY_HIEU_PHIEU')));

  async function signPhieuDieuTri(ctx, ngay, dryRun) {
    const results = [];
    const tried = new Set();
    let otherDays = null;
    for (let guard = 0; guard < 40 && !stopRequested; guard++) {
      const ks = await ensureKhac(ctx, CODES.PDT.tab);
      await waitGridStable(ctx);
      const rows = pdtRows(currentKySoFor(ctx) || ks);
      if (otherDays === null) {
        otherDays = rows.filter(tr => cellText(tr, 'NGAY_TAO_PHIEU') !== ngay && rowStatus(tr) === 'todo')
          .map(tr => `${pdtSoPhieu(tr)} (${cellText(tr, 'NGAY_TAO_PHIEU')})`);
        if (otherDays.length) ctx.log(`  PĐT: bỏ qua phiếu khác ngày ${ngay}: ${otherDays.join(', ')}`);
      }
      const tr = rows.find(r => cellText(r, 'NGAY_TAO_PHIEU') === ngay && rowStatus(r) === 'todo' && !tried.has(pdtSoPhieu(r)));
      if (!tr) break;
      const so = pdtSoPhieu(tr);
      tried.add(so);
      let r;
      try { r = await signPdtRow(ctx, tr, so, dryRun); }
      catch (e) {
        if (e.message === 'Đã dừng') throw e;
        r = { code: 'PDT', result: 'error', note: `Phiếu ${so}: ${e.message}` };
        await closePdfNoSign();
      }
      results.push(r);
      ctx.log(`  PĐT: ${r.result === 'ok' ? '✅' : r.result === 'skip' ? '⏭' : '❌'} ${r.note}`);
      if (dryRun) break;
    }
    if (!tried.size) {
      const r = { code: 'PDT', result: 'skip', note: `Không có phiếu điều trị ngày ${ngay} chưa ký` };
      ctx.log(`  PĐT: ⏭ ${r.note}`);
      results.push(r);
    }
    return results;
  }

  async function signPdtRow(ctx, tr, so, dryRun) {
    const { btn, why } = findSignButton(tr);
    if (!btn) return { code: 'PDT', result: 'error', note: `Phiếu ${so}: ${why}` };
    ctx.log(`  PĐT: phiếu ${so} - mở trình ký PDF...`);
    const findRow = () => pdtRows(currentKySoFor(ctx) || ctx.ks).find(r => pdtSoPhieu(r) === so);
    const ready = await openPdfViewer(ctx, btn, findRow, 'PĐT');
    if (ready !== true) return { code: 'PDT', result: 'error', note: `Phiếu ${so}: ${ready || `quá ${PDF_OPEN_WAIT_MS / 1000} giây HIS chưa mở trình ký PDF`}` };

    const info = await mainCall('pdfText', { patterns: [BS_LINE] });
    const hits = info.hits.slice().sort((a, b) => a.page - b.page || b.y - a.y); // trên xuống dưới
    if (!hits.length) throw new Error('Không thấy dòng tên bác sĩ (BS/BSCKI/BSCKII...) trong phiếu');
    const used = new Set();
    for (const h of hits) {
      if (stopRequested) throw new Error('Đã dừng');
      await gotoPdfPage(h.page);
      // Dùng lại khung HIS tự thêm (chưa dùng) nếu đúng trang; khung chưa dùng ở trang khác thì bỏ
      let w = roleWrappers(PDT_ROLE).find(x => !used.has(x.id) && wrapperPage(x) === h.page);
      // Đã có chữ ký trên trang này -> "Tạo bản sao" (nút clone ở cột "Chữ ký đã thêm trong lượt ký"), không bị hỏi xác nhận
      if (!w) {
        const src = roleWrappers(PDT_ROLE).find(x => used.has(x.id) && wrapperPage(x) === h.page);
        if (src) w = await cloneWrapper(src);
      }
      if (!w) {
        for (const x of roleWrappers(PDT_ROLE).filter(x => !used.has(x.id))) await removeWrapper(x);
        await gotoPdfPage(h.page);
        w = await addSignatureOnce(PDT_ROLE);
        if (w && wrapperPage(w) !== h.page) { await removeWrapper(w); w = null; }
      }
      if (!w || !w.id) throw new Error(`Không thêm được khung chữ ký ở trang ${h.page}`);
      used.add(w.id);
      const t = bsTarget(info, h, w);
      const id = w.id;
      let moved = await dragWrapperTo(() => document.getElementById(id), t.left, t.top);
      if (!moved) {
        try {
          const res = await mainCall('placeSignature', { id, page: h.page, roleRe: '.', left: t.left, top: t.top });
          moved = !!res.saved && Math.abs(res.saved.left - t.left) < 4 && Math.abs(res.saved.top - t.top) < 4;
        } catch (e) { ctx.log('    ' + e.message); }
      }
      if (!moved) throw new Error(`Không kéo được chữ ký tới trên dòng "${h.s.trim()}"`);
    }
    // Khung thừa (HIS tự thêm, có khi thêm trễ) không dùng tới -> bỏ; kiểm tra lại đúng số khung rồi mới ký
    await sleep(600);
    for (let k = 0; k < 3; k++) {
      const extra = allWrappers().filter(x => !used.has(x.id));
      if (!extra.length) break;
      for (const x of extra) await removeWrapper(x);
      await sleep(400);
    }
    const left = allWrappers().filter(x => !used.has(x.id)).length;
    if (left || allWrappers().length !== hits.length) {
      throw new Error(`Số khung chữ ký (${allWrappers().length}) khác số dòng BS (${hits.length}), không xóa được khung thừa -> không ký phiếu này`);
    }
    ctx.log(`  PĐT: phiếu ${so} - đặt ${hits.length} chữ ký trên dòng ${[...new Set(hits.map(h => h.s.trim().split(/[.\s]/)[0]))].join(', ')}`);

    if (dryRun) return { code: 'PDT', result: 'skip', dry: true, note: `CHẠY THỬ phiếu ${so}: đã đặt ${hits.length} chữ ký, CHƯA bấm "Hoàn tất ký số". Bạn kiểm tra rồi bấm Đóng.` };
    const err = await completePdfSign(ctx, 'PĐT');
    if (err) return { code: 'PDT', result: 'error', note: `Phiếu ${so}: ${err}` };
    return { code: 'PDT', result: 'ok', note: `Đã ký phiếu ${so} (${hits.length} chữ ký)` };
  }

  // Bấm "Tạo bản sao của chữ ký này" cho khung src; trả về khung mới (cùng trang với src)
  async function cloneWrapper(src) {
    const idSign = (src.id || '').replace('smartcav2-plugin-signature-', '');
    if (!idSign) return null;
    const btn = Array.from(document.querySelectorAll('[id^="smartcav2-plugin-left-side-bar-list-chu-ky-list-item-button-clone-"]'))
      .find(b => b.getAttribute('data-id-sign') === idSign);
    if (!btn) return null;
    const before = new Set(allWrappers().map(x => x.id));
    btn.click(); // nút nằm ở cột trái (có thể đang thu gọn) -> bấm trực tiếp, không cuộn
    const w = await waitFor(() => allWrappers().find(x => x.id && !before.has(x.id)), 4000, 100);
    return w && wrapperPage(w) === wrapperPage(src) ? w : null;
  }

  // ---------- Ký VỎ BỆNH ÁN (tab "Hồ sơ bệnh án", Trang 1/2/3) ----------
  // trang: số trang bệnh án (từ mã ..._TRANG_n); optRe: TÊN CHỨC VỤ trong HIS (trang smartca-cauhinh-loaiphieu);
  // anchor: dòng mốc in trên PDF (có thể khác tên chức vụ, VD chức vụ "BÁC SĨ LẬP BỆNH ÁN" - PDF in "Bác sĩ làm bệnh án")
  const HSBA_ROLES = {
    GD: { trang: 1, label: 'T1 · Giám đốc', optRe: /GIÁM ĐỐC/i, anchor: 'GIÁM ĐỐC', def: false },
    TK: { trang: 1, label: 'T1 · Trưởng khoa', optRe: /TRƯỞNG KHOA/i, anchor: 'TRƯỞNG KHOA', def: false },
    BSLBA: { trang: 2, label: 'T2 · BS lập bệnh án', optRe: /(LẬP|LÀM) BỆNH ÁN/i, anchor: 'BÁC SĨ LÀM BỆNH ÁN', def: true },
    BSDT: { trang: 3, label: 'T3 · BS điều trị', optRe: /BÁC S[ĨỸ] ĐIỀU TRỊ|THẦY THUỐC ĐIỀU TRỊ/i, anchor: 'BÁC SĨ ĐIỀU TRỊ', def: true },
    NGIAO: { trang: 3, label: 'T3 · NV giao hồ sơ', optRe: /GIAO HỒ SƠ/i, anchor: 'NGƯỜI GIAO HỒ SƠ', def: false },
    NNHAN: { trang: 3, label: 'T3 · NV nhận hồ sơ', optRe: /NHẬN HỒ SƠ/i, anchor: 'NGƯỜI NHẬN HỒ SƠ', def: false }
  };
  const hsbaTrang = tr => Number((cellText(tr, 'KY_HIEU_PHIEU').match(/_TRANG_([123])$/i) || [])[1] || (clsName(tr).match(/\(Trang ([123])\)/i) || [])[1] || 0);

  async function signHsbaAll(ctx, roleKeys, dryRun) {
    const results = [];
    const tried = new Set();
    for (let guard = 0; guard < 6 && !stopRequested; guard++) {
      const ks = await ensureKhac(ctx, CODES.HSBA.tab);
      await waitGridStable(ctx);
      const rows = findDocRows(currentKySoFor(ctx) || ks)
        .filter(tr => hsbaTrang(tr) && !tried.has(hsbaTrang(tr)) && rowStatus(tr) !== 'done')
        .sort((a, b) => hsbaTrang(a) - hsbaTrang(b));
      const tr = rows.find(r => roleKeys.some(k => HSBA_ROLES[k].trang === hsbaTrang(r)));
      if (!tr) break;
      const n = hsbaTrang(tr);
      tried.add(n);
      let r;
      try { r = await signHsbaRow(ctx, tr, n, roleKeys.filter(k => HSBA_ROLES[k].trang === n), dryRun); }
      catch (e) {
        if (e.message === 'Đã dừng') throw e;
        r = { code: 'HSBA', result: 'error', note: `Trang ${n}: ${e.message}` };
        await closePdfNoSign();
      }
      results.push(r);
      ctx.log(`  BA: ${r.result === 'ok' ? '✅' : r.result === 'skip' ? '⏭' : '❌'} ${r.note}`);
      if (dryRun) break;
    }
    if (!tried.size) {
      const r = { code: 'HSBA', result: 'skip', note: 'Không có trang bệnh án nào cần ký (theo vai trò đã chọn)' };
      ctx.log(`  BA: ⏭ ${r.note}`);
      results.push(r);
    }
    return results;
  }

  async function signHsbaRow(ctx, tr, n, keys, dryRun) {
    const signed = signedRolesText(tr); // "... đã ký" dưới tên phiếu
    const todo = keys.filter(k => !HSBA_ROLES[k].optRe.test(signed));
    if (!todo.length) return { code: 'HSBA', result: 'skip', note: `Trang ${n}: đã ký (${signed.trim() || 'đủ vai trò'})` };
    const { btn, why } = findSignButton(tr);
    if (!btn) return { code: 'HSBA', result: 'error', note: `Trang ${n}: ${why}` };
    ctx.log(`  BA: Trang ${n} - mở trình ký (${todo.map(k => HSBA_ROLES[k].label).join(' + ')})...`);
    const ready = await openPdfViewer(ctx, btn, () => findDocRows(currentKySoFor(ctx) || ctx.ks).find(r => hsbaTrang(r) === n), 'BA');
    if (ready !== true) {
      if (ready) return { code: 'HSBA', result: 'error', note: `Trang ${n}: ${ready}` };
      return signed ? { code: 'HSBA', result: 'skip', note: `Trang ${n}: HIS không mở trình ký (đã có chữ ký: ${signed.trim()}) - vai trò còn lại ký bằng tài khoản khác` }
        : { code: 'HSBA', result: 'error', note: `Trang ${n}: quá ${PDF_OPEN_WAIT_MS / 1000} giây HIS chưa mở trình ký` };
    }
    const info = await mainCall('pdfText', { patterns: todo.map(k => HSBA_ROLES[k].anchor.replace(/\s+/g, '\\s+')).concat(['ký, ghi rõ họ tên']) });
    const up = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').toUpperCase();
    info.hits = info.hits.map(h => ({ ...h, s: up(h.s) }));
    const done = [], keep = [];
    for (const k of todo) {
      const role = HSBA_ROLES[k];
      const pages = info.hits.filter(h => h.s.includes(role.anchor)).map(h => h.page);
      if (!pages.length) { ctx.log(`    ⚠ không thấy dòng "${role.anchor}" trên trang ${n}`); continue; }
      const page = Math.max(...pages);
      await gotoPdfPage(page);
      let w;
      try { w = await addSignatureForRole(role, page); }
      catch (e) { ctx.log(`    ⏭ ${role.label}: ${e.message}`); continue; } // tài khoản không có vai trò này
      const t = computeTarget(info, role, page, w);
      if (!t) { ctx.log(`    ⚠ không tính được vị trí "${role.anchor}"`); continue; }
      await liftAboveName(ctx, page, role.anchor, w, t); // không che tên in sẵn dưới dòng mốc
      const getW = () => pageWrappers(page).filter(x => role.optRe.test((x.textContent || '').normalize('NFC'))).pop();
      let moved = await dragWrapperTo(getW, t.left, t.top);
      if (!moved) {
        try {
          const res = await mainCall('placeSignature', { page, roleRe: role.optRe.source, left: t.left, top: t.top });
          moved = !!res.saved && Math.abs(res.saved.left - t.left) < 4 && Math.abs(res.saved.top - t.top) < 4;
        } catch (e) { ctx.log('    ' + e.message); }
      }
      if (!moved) { ctx.log(`    ⚠ không kéo được chữ ký ${role.label}`); continue; }
      done.push(role.label); keep.push(role);
    }
    // Bỏ khung thừa (VD HIS tự thêm vai trò không chọn)
    for (const x of allWrappers()) {
      const tx = (x.textContent || '').normalize('NFC');
      if (!keep.some(r => r.optRe.test(tx))) await removeWrapper(x);
    }
    if (!done.length) { await closePdfNoSign(); return { code: 'HSBA', result: 'skip', note: `Trang ${n}: tài khoản không ký được vai trò nào đã chọn -> bỏ qua` }; }
    if (dryRun) return { code: 'HSBA', result: 'skip', dry: true, note: `CHẠY THỬ Trang ${n}: đã đặt chữ ký ${done.join(' + ')}, CHƯA bấm "Hoàn tất ký số". Bạn kiểm tra rồi bấm Đóng.` };
    const err = await completePdfSign(ctx, 'BA');
    if (err) return { code: 'HSBA', result: 'error', note: `Trang ${n}: ${err}` };
    return { code: 'HSBA', result: 'ok', note: `Đã ký Trang ${n} (${done.join(' + ')})` };
  }

  // ---------- Ký CẬN LÂM SÀNG (trang Khám bệnh nội trú): mọi phiếu "Chưa ký" trong tab ----------
  const clsKey = tr => [cellText(tr, 'KY_HIEU_PHIEU'), cellText(tr, 'SO_PHIEU'), cellText(tr, 'TEN_PHIEU_F') || cellText(tr, 'TEN_PHIEU')].join('|');
  const clsName = tr => (cellText(tr, 'TEN_PHIEU_F') || cellText(tr, 'TEN_PHIEU') || cellText(tr, 'KY_HIEU_PHIEU')).split('\n')[0].slice(0, 90);
  // Loại phiếu CLS KHÔNG ký (theo yêu cầu): Kết quả test tâm lý, Phiếu đo chức năng hô hấp
  const CLS_SKIP_KH = /^(KQ_TEST_TAM_LY|PHIEU_DO_CN_HO_HAP)/i;
  const CLS_SKIP_NAME = /TEST TÂM LÝ|ĐO CHỨC NĂNG HÔ HẤP/i;
  const clsSkipped = tr => CLS_SKIP_KH.test(cellText(tr, 'KY_HIEU_PHIEU')) || CLS_SKIP_NAME.test(clsName(tr));
  const clsTodo = tr => {
    if (clsSkipped(tr)) return false;
    const s = rowStatus(tr);
    return s === 'todo' || (s === 'partial' && !tr.querySelector('[data-type="btn-huy-ky-so"]'));
  };

  // Có dòng TÊN NGƯỜI KÝ in sẵn ngay dưới dòng mốc (VD "BSCKII Trần Xêm" dưới "GIÁM ĐỐC") -> đẩy chữ ký LÊN,
  // nằm gọn giữa dòng mốc và dòng tên, không che tên. t = {left, top} (px) sẽ được sửa trực tiếp.
  async function liftAboveName(ctx, page, anchorUpper, w, t) {
    try {
      const all = await mainCall('pdfText', { patterns: ['\\S'] });
      const up = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').toUpperCase();
      const sc = all.scale || 1.5;
      const pg = all.pages.find(p => p.n === page) || { h: 842 };
      const a = all.hits.filter(h => h.page === page && up(h.s).includes(anchorUpper)).pop();
      if (!a) return;
      const aCx = a.x + a.w / 2;
      const below = all.hits.filter(h => h.page === page && h.y < a.y - 3 && h.y > a.y - 130 &&
        Math.abs((h.x + h.w / 2) - aCx) < 110 && !/ký, ghi rõ|ghi rõ họ tên/i.test(h.s) && h.s.trim().length > 2);
      if (!below.length) return;
      const nm = below.sort((p, q) => q.y - p.y)[0];                 // dòng gần mốc nhất phía dưới = tên người ký
      const nameTop = (pg.h - nm.y - (nm.fs || 11)) * sc;           // mép trên dòng tên (px)
      const labelBottom = (pg.h - a.y) * sc + 2;                     // ngay dưới dòng mốc (px)
      const wh = w.offsetHeight || 65;
      if (t.top + wh > nameTop - 2) {
        // nằm sát trên tên; thiếu chỗ thì cho phép chồng nhẹ lên dòng mốc (tối đa nửa khung)
        t.top = Math.max(0, Math.round(Math.max(labelBottom - wh / 2, nameTop - wh - 2)));
      }
    } catch (e) { ctx.log('    (không đọc được dòng tên người ký: ' + e.message + ')'); }
  }

  // Dòng mốc vị trí ký của bác sĩ trên phiếu CLS (ưu tiên từ trên xuống)
  const CLS_ANCHORS = ['BÁC SĨ ĐIỀU TRỊ', 'BÁC SĨ CHỈ ĐỊNH', 'NGƯỜI CHỈ ĐỊNH', 'BÁC SĨ KHÁM BỆNH', 'BÁC SỸ ĐIỀU TRỊ', 'BÁC SỸ CHỈ ĐỊNH'];
  async function clsPlace(ctx, name) {
    const info = await mainCall('pdfText', { patterns: [...CLS_ANCHORS.map(a => a.replace(/\s+/g, '\\s+')), 'ký, ghi rõ họ tên'] });
    const up = s => String(s || '').normalize('NFC').replace(/\s+/g, ' ').toUpperCase();
    let anchor = null, hits = [];
    for (const a of CLS_ANCHORS) { hits = info.hits.filter(h => up(h.s).includes(a)); if (hits.length) { anchor = a; break; } }
    if (!anchor) {
      // Không thấy dòng mốc -> giữ vị trí HIS (bảo đảm có khung)
      if (!allWrappers().length && !await addSignatureOnce(PDT_ROLE)) throw new Error('Không thêm được khung chữ ký');
      return 'KHÔNG thấy dòng "Bác sĩ điều trị/chỉ định" -> để vị trí HIS đặt sẵn, cần kiểm tra';
    }
    const page = Math.max(...hits.map(h => h.page));
    await gotoPdfPage(page);
    const role = { ...PDT_ROLE, anchor };
    const w = await addSignatureForRole(role, page); // dùng lại khung HIS đã thêm (đúng trang) hoặc thêm mới
    // Chỉ giữ 1 khung (bỏ khung thừa ở trang khác)
    for (const x of allWrappers()) if (x !== w && x.id !== w.id) await removeWrapper(x);
    const t = computeTarget({ ...info, hits: info.hits.map(h => ({ ...h, s: up(h.s) })) }, role, page, w);
    if (!t) throw new Error(`Không tính được vị trí dưới "${anchor}"`);
    await liftAboveName(ctx, page, anchor, w, t);
    const id = w.id;
    let moved = await dragWrapperTo(() => (id && document.getElementById(id)) || allWrappers().find(x => wrapperPage(x) === page), t.left, t.top);
    if (!moved && id) {
      try {
        const res = await mainCall('placeSignature', { id, page, roleRe: '.', left: t.left, top: t.top });
        moved = !!res.saved && Math.abs(res.saved.left - t.left) < 4 && Math.abs(res.saved.top - t.top) < 4;
      } catch (e) { ctx.log('    ' + e.message); }
    }
    if (!moved) throw new Error(`Không kéo được chữ ký tới dưới "${anchor}"`);
    return `đặt chữ ký dưới "${anchor}" (trang ${page})`;
  }

  async function signClsAll(ctx, dryRun) {
    const results = [];
    const tried = new Set();
    let loggedSkip = false;
    for (let guard = 0; guard < 60 && !stopRequested; guard++) {
      const ks = await ensureKhac(ctx, CODES.CLS.tab);
      await waitGridStable(ctx);
      if (!loggedSkip) {
        loggedSkip = true;
        const sk = findDocRows(currentKySoFor(ctx) || ks).filter(tr => clsSkipped(tr) && rowStatus(tr) !== 'done');
        if (sk.length) ctx.log(`  CLS: ⏭ bỏ qua (không ký) ${sk.length} phiếu: ${[...new Set(sk.map(clsName))].join('; ')}`);
      }
      // Thứ tự: PHIẾU CHỈ ĐỊNH ký trước, rồi phiếu khác, KẾT QUẢ ký sau cùng
      const rank = tr => {
        const kh = cellText(tr, 'KY_HIEU_PHIEU'), nm = clsName(tr);
        if (/^CD_|CHI_DINH|CHIDINH/i.test(kh) || /chỉ định/i.test(nm)) return 0;
        if (/^KQ_|KET_QUA|KETQUA/i.test(kh) || /kết quả/i.test(nm)) return 2;
        return 1;
      };
      const rows = findDocRows(currentKySoFor(ctx) || ks)
        .filter(tr => cellText(tr, 'KY_HIEU_PHIEU') && clsTodo(tr) && !tried.has(clsKey(tr)))
        .sort((a, b) => rank(a) - rank(b));
      const tr = rows[0];
      if (!tr) break;
      const key = clsKey(tr), name = clsName(tr);
      tried.add(key);
      let r;
      try { r = await signClsRow(ctx, tr, key, name, dryRun); }
      catch (e) {
        if (e.message === 'Đã dừng') throw e;
        r = { code: 'CLS', result: 'error', note: `${name}: ${e.message}` };
        await closePdfNoSign();
      }
      results.push(r);
      ctx.log(`  CLS: ${r.result === 'ok' ? '✅' : r.result === 'skip' ? '⏭' : '❌'} ${r.note}`);
      if (dryRun) break;
    }
    if (!tried.size) {
      const r = { code: 'CLS', result: 'skip', note: 'Không có phiếu cận lâm sàng chưa ký' };
      ctx.log(`  CLS: ⏭ ${r.note}`);
      results.push(r);
    }
    return results;
  }

  async function signClsRow(ctx, tr, key, name, dryRun) {
    const { btn, why } = findSignButton(tr);
    if (!btn) return { code: 'CLS', result: 'error', note: `${name}: ${why}` };
    ctx.log(`  CLS: ${name} - bấm ký...`);
    let t0 = Date.now(), reclicks = 0, lastTick = 0, ready = false;
    click(btn);
    // Có phiếu bấm là ký luôn (XML), có phiếu mở trình ký PDF; phiếu rỗng -> HIS báo không có dữ liệu / không tải được
    while (Date.now() - t0 < PDF_OPEN_WAIT_MS) {
      if (stopRequested) throw new Error('Đã dừng');
      await sleep(250);
      handleMessageBoxes();
      if (pdfViewerReady()) { ready = true; break; }
      if (lastSuccessAt > t0) { await sleep(500); await waitGridStable(ctx); return { code: 'CLS', result: 'ok', note: `Đã ký: ${name}` }; }
      if (lastNoDataAt > t0) { await closePdfNoSign(); return { code: 'CLS', result: 'skip', nodata: true, note: `${name}: không có dữ liệu / không tải được phiếu -> bỏ qua` }; }
      if (lastErrorAt > t0) { await closePdfNoSign(); return { code: 'CLS', result: 'error', note: `${name}: ${lastErrorMsg}` }; }
      if (lastUnlockedAt > t0 && reclicks < 2) {
        reclicks++;
        await sleep(800);
        const row = findDocRows(currentKySoFor(ctx) || ctx.ks).find(r => clsKey(r) === key);
        const b2 = row && findSignButton(row).btn;
        if (!b2) return { code: 'CLS', result: 'error', note: `${name}: mở khóa xong không thấy lại nút ký` };
        t0 = Date.now(); click(b2); continue;
      }
      const sec = Math.floor((Date.now() - t0) / 1000);
      if (sec - lastTick >= 5) { lastTick = sec; ctx.log(`    đang chờ HIS mở phiếu... ${sec}s`); }
    }
    if (!ready) {
      // Không mở được trình ký (thường do phiếu không có nội dung PDF) -> bỏ qua
      await closePdfNoSign();
      return { code: 'CLS', result: 'skip', nodata: true, note: `${name}: HIS không mở được phiếu (không có dữ liệu / không tải được PDF) -> bỏ qua` };
    }
    // Chờ HIS tự đặt khung chữ ký theo vị trí cấu hình sẵn
    await sleep(1000);
    { let sig = '', since = Date.now(); const s0 = Date.now();
      while (Date.now() - s0 < 6000) { const s = pdfCurrentPage() + '|' + allWrappers().length; if (s !== sig) { sig = s; since = Date.now(); } else if (Date.now() - since >= 1200) break; await sleep(150); } }
    // Kéo chữ ký vào ngay DƯỚI dòng mốc của người ký (VD "BÁC SĨ ĐIỀU TRỊ" ở cột trái phiếu kết quả XN)
    const pos = await clsPlace(ctx, name);
    ctx.log(`    ${pos}`);
    if (dryRun) return { code: 'CLS', result: 'skip', dry: true, note: `CHẠY THỬ ${name}: đã đặt chữ ký (${pos}), CHƯA bấm "Hoàn tất ký số". Bạn kiểm tra vị trí rồi bấm Đóng.` };
    const err = await completePdfSign(ctx, 'CLS');
    if (err) return { code: 'CLS', result: 'error', note: `${name}: ${err}` };
    return { code: 'CLS', result: 'ok', note: `Đã ký: ${name}` };
  }

  // Khung chữ ký nằm ngay PHÍA TRÊN dòng tên bác sĩ
  function bsTarget(info, h, w) {
    const pg = info.pages.find(p => p.n === h.page) || { h: 842, w: 595 };
    const sc = info.scale || 1.5;
    const cv = pdfCanvas(h.page);
    const ww = w.offsetWidth || 200, wh = w.offsetHeight || 65;
    const maxL = (cv ? cv.offsetWidth : pg.w * sc) - ww;
    const maxT = (cv ? cv.offsetHeight : pg.h * sc) - wh;
    const fs = h.fs || 10;
    // Canh TRÁI chữ ký thẳng với chữ "BSCKI..." (khung HIS rộng hơn tên BS, canh giữa sẽ bị lệch trái)
    const lead = (h.s.match(/^\s*/) || [''])[0].length * fs * 0.25; // bỏ khoảng trắng đầu dòng
    const left = Math.max(0, Math.min(maxL, Math.round((h.x + lead) * sc)));
    const top = Math.max(0, Math.min(maxT, Math.round((pg.h - h.y - fs) * sc - wh + 2)));
    return { left, top };
  }

  // ---------- Chạy ----------
  async function processPatient(p, allCodes, dryRun, log, opts = {}) {
    const codes = allCodes.filter(c => !CODES[c].pdf);     // phiếu XML (bấm là ký)
    const pdfCodes = allCodes.filter(c => CODES[c].pdf);   // bảng kê (ký trên PDF)
    log('  - chọn bệnh nhân...');
    const info = await selectPatient(p);
    log(`  - mở cửa sổ Ký số (Số BA ${info.soBa || '?'})...`);
    const ks = await openKySo(p, info);
    const firstTab = CODES[codes.length ? codes[0] : pdfCodes[0]].tab || 'Khác';
    log(`  - mở tab ${firstTab}...`);
    await openTab(ks, firstTab);
    const ctx = { p, info, ks, log, curTab: firstTab, bkSigned: opts.ctxInfo && opts.ctxInfo.bkSigned };
    if (dryRun) {
      if (pdfCodes[0] === 'HSBA') {
        try { await signHsbaAll(ctx, opts.hroles || [], true); }
        catch (e) { if (e.message === 'Đã dừng') throw e; log(`  BA: ❌ ${e.message}`); }
        return [];
      }
      if (pdfCodes[0] === 'CLS') {
        try { await signClsAll(ctx, true); }
        catch (e) { if (e.message === 'Đã dừng') throw e; log(`  CLS: ❌ ${e.message}`); }
        return [];
      }
      if (pdfCodes[0] === 'PDT') {
        try { await signPhieuDieuTri(ctx, opts.ngay || todayVN(), true); }
        catch (e) { if (e.message === 'Đã dừng') throw e; log(`  PĐT: ❌ ${e.message}`); }
        return [];
      }
      if (pdfCodes.length) {
        const r = await signBangKe(ctx, opts.roles || ['NV', 'KT'], true, pdfCodes[0]);
        log(`  BK: ${r.note}`);
        return [];
      }
      for (const code of codes) {
        const cur = await ensureKhac(ctx, CODES[code].tab || 'Khác');
        const tr = rowForCode(cur, code);
        if (!tr) { log(`  ${code}: không có phiếu`); continue; }
        const st = rowStatus(tr);
        const { btn, why } = findSignButton(tr);
        if (btn) { btn.style.outline = '3px solid red'; btn.style.outlineOffset = '2px'; }
        log(`  ${code}: ${st === 'done' ? 'Đã ký' : st === 'todo' ? 'Chưa ký' : 'Không rõ'} | nút ký: ${btn ? 'tìm thấy (' + why + ') - đã tô viền đỏ' : why}`);
        if (btn) console.log('[Ký hàng loạt] Nút ký', code, btn);
      }
      const cb = findCloseButton(ks);
      if (cb) { cb.style.outline = '3px solid #1e88e5'; cb.style.outlineOffset = '2px'; console.log('[Ký hàng loạt] Nút đóng', cb); }
      log(`  Nút đóng cửa sổ: ${cb ? 'tìm thấy - đã tô viền xanh' : 'KHÔNG thấy (sẽ thử phím Esc)'}`);
      log('Chạy thử xong. Cửa sổ ký số để mở cho bạn kiểm tra viền đỏ có đúng nút Ký không.');
      return [];
    }
    const results = [];
    for (const code of codes) {
      if (stopRequested) break;
      let r;
      try { r = await signOne(ctx, code); }
      catch (e) { if (e.message === 'Đã dừng') throw e; r = { code, result: 'error', note: e.message }; }
      results.push(r);
      log(`  ${code}: ${r.result === 'ok' ? '✅' : r.result === 'skip' ? '⏭' : '❌'} ${r.note}`);
    }

    // KIỂM TRA LẠI trước khi đóng: phiếu nào vẫn "Chưa ký" (trừ phiếu HIS báo không có dữ liệu) -> ký bù, tối đa 2 lượt
    for (let round = 1; round <= 2 && !stopRequested && codes.length; round++) {
      let missed;
      try {
        missed = [];
        // Phiếu ở nhiều tab khác nhau (VD CT07 ở "Khác", XML 4750 ở "Bảng kê") -> kiểm tra từng tab
        for (const tab of [...new Set(codes.map(c => CODES[c].tab || 'Khác'))]) {
          await ensureKhac(ctx, tab);
          await sleep(500);
          await waitGridStable(ctx);
          const cur = currentKySoFor(ctx);
          missed.push(...codes.filter(code => {
            if ((CODES[code].tab || 'Khác') !== tab) return false;
            const prev = results.find(x => x.code === code);
            if (prev && prev.nodata) return false;
            const row = cur && rowForCode(cur, code);
            const s = row && rowStatus(row);
            return row && (s === 'todo' || (s === 'partial' && !row.querySelector('[data-type="btn-huy-ky-so"]')));
          }));
        }
      } catch (e) { if (e.message === 'Đã dừng') throw e; log('    kiểm tra lại: ' + e.message); break; }
      if (!missed.length) break;
      for (const code of missed) {
        log(`  ${code}: ⚠ vẫn "Chưa ký" -> ký bù (lượt ${round})`);
        let r;
        try { r = await signOne(ctx, code); }
        catch (e) { if (e.message === 'Đã dừng') throw e; r = { code, result: 'error', note: e.message }; }
        const i = results.findIndex(x => x.code === code);
        if (i >= 0) results[i] = r; else results.push(r);
        log(`  ${code}: ${r.result === 'ok' ? '✅' : r.result === 'skip' ? '⏭' : '❌'} ${r.note}`);
      }
    }

    for (const bkCode of pdfCodes) {
      if (stopRequested) break;
      if (bkCode === 'PDT') {
        // signPhieuDieuTri tự ghi log từng phiếu
        results.push(...await signPhieuDieuTri(ctx, opts.ngay || todayVN(), false));
        continue;
      }
      if (bkCode === 'CLS') {
        results.push(...await signClsAll(ctx, false));
        continue;
      }
      if (bkCode === 'HSBA') {
        results.push(...await signHsbaAll(ctx, opts.hroles || [], false));
        continue;
      }
      let r;
      try { r = await signBangKe(ctx, opts.roles || ['NV', 'KT'], false, bkCode); }
      catch (e) {
        if (e.message === 'Đã dừng') throw e;
        r = { code: bkCode, result: 'error', note: e.message };
        // Lỗi giữa chừng: đóng trình ký PDF (không ký) để qua BN kế
        // (HIS hỏi "Trong khung ký hiện đã có chữ ký được thêm. Vẫn đóng form?" -> Xác nhận)
        await closePdfNoSign();
      }
      results.push(r);
      log(`  ${CODES[bkCode].label.replace(/ \(ký trên PDF\)/, '')}: ${r.result === 'ok' ? '✅' : r.result === 'skip' ? '⏭' : '❌'} ${r.note}`);
    }

    const open = findKySoScope();
    if (open) await closeKySo(open);
    return results;
  }

  // ---------- Ghi nhớ vị trí đã ký xong (để lượt 2, 3 không mở lại hồ sơ đã ký) ----------
  // Lưu trong trình duyệt máy này: { "<trang>|<số phiếu>|<HỌ TÊN>": { "<vị trí>": "thời điểm" } }
  // Vị trí: mã phiếu XML (CT03...), "BANGKE:NV" / "BANGKE:KT" (từng vai trò bảng kê), "PDT:dd/mm/yyyy".
  const LS_DONE = 'bhyt_ksh_done_v1';
  const loadDone = () => { try { return JSON.parse(localStorage.getItem(LS_DONE)) || {}; } catch (_) { return {}; } };
  const saveDone = d => { try { localStorage.setItem(LS_DONE, JSON.stringify(d)); } catch (_) {} };
  const patKey = p => `${PAGE}|${p.phieu}|${normName(p.name)}`;
  // Các vị trí cần ký của 1 BN theo lựa chọn hiện tại
  const itemsFor = (codes, opts) => codes.flatMap(c =>
    c === 'PDT' ? [`PDT:${opts.ngay || todayVN()}`]
      : c === 'CLS' || c === 'HSBA' ? [c]
      : CODES[c].pdf ? (opts.roles || ['NV', 'KT']).map(k => `${c}:${k}`)
        : [c]);
  const itemLabel = it => {
    const [c, x] = it.split(':');
    if (c === 'PDT') return `Phiếu điều trị ngày ${x}`;
    const name = (CODES[c] ? CODES[c].label : c).replace(/ \(ký trên PDF.*\)$/, '');
    return x ? `${name} - vai trò ${BK_ROLES[x] ? BK_ROLES[x].label : x}` : name;
  };
  // Kết quả coi là "đã xong": ký thành công, đã ký từ trước, hoặc không có phiếu / HIS báo không có dữ liệu
  const isDoneResult = r => !!r && !r.dry && (r.result === 'ok' || r.nodata || /^(Không có phiếu|Đã ký)/i.test(r.note || ''));
  const pendingItems = (p, codes, opts) => { const d = loadDone()[patKey(p)] || {}; return itemsFor(codes, opts).filter(it => !d[it]); };

  // Ghi nhận kết quả 1 BN: đánh dấu vị trí xong, trả về danh sách vị trí CHƯA ký (kèm lý do)
  function recordPatient(p, codes, opts, rs, ctxInfo) {
    const all = loadDone();
    const mine = all[patKey(p)] || {};
    const at = new Date().toLocaleString('vi-VN');
    const missing = [];
    for (const c of codes) {
      if (c === 'PDT' || c === 'CLS' || c === 'HSBA') {
        const it = c === 'PDT' ? `PDT:${opts.ngay || todayVN()}` : c;
        const pr = rs.filter(r => r.code === c);
        // CLS / Bệnh án: KHÔNG ghi nhớ "đã xong" (lượt sau vẫn kiểm tra tab), chỉ báo phiếu lỗi
        if (c === 'CLS' || c === 'HSBA') { pr.filter(r => !isDoneResult(r)).forEach(r => missing.push({ it, note: r.note })); continue; }
        if (pr.length && pr.every(isDoneResult)) mine[it] = at;
        else missing.push({ it, note: pr.filter(r => !isDoneResult(r)).map(r => r.note).join('; ') || 'Chưa chạy tới' });
        continue;
      }
      const r = rs.find(x => x.code === c);
      if (CODES[c].pdf) {
        const roles = opts.roles || ['NV', 'KT'];
        if (isDoneResult(r)) { roles.forEach(k => { mine[`${c}:${k}`] = at; }); continue; }
        // Vai trò nào đã có chữ ký (HIS ghi dưới tên phiếu) thì coi là xong, còn lại là chưa ký
        const signed = (ctxInfo && ctxInfo.bkSigned && ctxInfo.bkSigned[c]) || '';
        roles.forEach(k => {
          if (BK_ROLES[k].optRe.test(signed)) mine[`${c}:${k}`] = at;
          else missing.push({ it: `${c}:${k}`, note: r ? r.note : 'Chưa chạy tới' });
        });
        continue;
      }
      if (isDoneResult(r)) mine[c] = at;
      else missing.push({ it: c, note: r ? r.note : 'Chưa chạy tới' });
    }
    all[patKey(p)] = mine;
    saveDone(all);
    return missing;
  }

  // Danh sách vị trí chưa ký của lượt gần nhất (để xuất Excel)
  let lastMissing = [];
  function exportMissing() {
    if (!lastMissing.length) { alert('Lượt ký gần nhất không còn vị trí nào chưa ký.'); return; }
    const cell = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const now = new Date();
    const lines = [[`DANH SÁCH VỊ TRÍ CHƯA KÝ - ${location.pathname.split('/').pop()} - ${now.toLocaleString('vi-VN')}`], [],
      ['STT', 'Số phiếu / Mã BA', 'Họ tên bệnh nhân', 'Vị trí chưa ký', 'Lý do'],
      ...lastMissing.map((m, i) => [i + 1, m.phieu, m.name, itemLabel(m.it), m.note])];
    const csv = '﻿' + lines.map(r => r.map(cell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const pad = n => String(n).padStart(2, '0');
    a.download = `ChuaKy_${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}_${pad(now.getHours())}${pad(now.getMinutes())}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function run(patients, codes, dryRun, ui, opts = {}) {
    running = true; stopRequested = false;
    ui.setRunning(true);
    const summary = { ok: 0, skip: 0, error: 0, failed: [], skippedPat: 0 };
    const missingAll = [];
    try {
      const list = dryRun ? patients.slice(0, 1) : patients;
      for (let i = 0; i < list.length; i++) {
        if (stopRequested) { ui.log('⛔ Đã dừng theo yêu cầu.'); break; }
        const p = list[i];
        // Lượt 2, 3: chỉ chạy vị trí CHƯA ký; BN đã ký xong hết thì bỏ qua, không mở lại
        let pCodes = codes, pOpts = opts;
        if (!dryRun && opts.skipDone) {
          const pend = pendingItems(p, codes, opts);
          if (!pend.length) { summary.skippedPat++; ui.log(`${i + 1}. ${p.name} (${p.phieu}): ⏭ đã ký xong ở lượt trước`); continue; }
          pCodes = codes.filter(c => pend.some(it => it === c || it.startsWith(c + ':')));
          const roles = (opts.roles || []).filter(k => pend.some(it => it.endsWith(':' + k)));
          // Kế toán phải ký sau Nhân viên lập phiếu: nếu NV đã ký xong ở lượt trước thì chỉ còn KT
          pOpts = { ...opts, roles: roles.length ? roles : opts.roles };
        }
        ui.status(`${dryRun ? 'Chạy thử' : 'Đang ký'} ${i + 1}/${list.length}: ${p.name}`);
        ui.log(`${i + 1}. ${p.name} (${p.phieu})${pCodes !== codes ? ' - chỉ ký: ' + itemsFor(pCodes, pOpts).map(itemLabel).join(', ') : ''}`);
        let rs = [];
        const ctxInfo = { bkSigned: {} };
        try {
          rs = await processPatient(p, pCodes, dryRun, ui.log, { ...pOpts, ctxInfo });
          rs.forEach(r => { summary[r.result]++; if (r.result === 'error') summary.failed.push(`${p.name} - ${r.code}: ${r.note}`); });
        } catch (err) {
          summary.error++;
          summary.failed.push(`${p.name}: ${err.message}`);
          ui.log(`  ❌ ${err.message}`);
          rs.push(...pCodes.map(c => ({ code: c, result: 'error', note: err.message })));
          if (err.message !== 'Đã dừng') {
            // Cửa sổ ký số còn mở thì cố đóng để qua BN kế tiếp
            const ks = findKySoScope();
            if (ks && !dryRun) { try { await closeKySo(ks); } catch (e2) { ui.log('  ⛔ ' + e2.message + ' -> Dừng.'); stopRequested = true; } }
          }
        }
        if (!dryRun) {
          recordPatient(p, pCodes, pOpts, rs, ctxInfo)
            .forEach(m => missingAll.push({ phieu: p.phieu, name: p.fullName || p.name, it: m.it, note: m.note }));
        }
        if (dryRun || stopRequested) break;
      }
      if (!dryRun) {
        ui.log(`—— Kết quả: ✅ ký ${summary.ok} | ⏭ bỏ qua ${summary.skip} | ❌ lỗi ${summary.error}` +
          (summary.skippedPat ? ` | ${summary.skippedPat} BN đã ký xong từ lượt trước (không mở lại)` : ''));
        summary.failed.forEach(f => ui.log('  ❌ ' + f));
        lastMissing = missingAll;
        ui.log(missingAll.length
          ? `📋 Còn ${missingAll.length} vị trí CHƯA KÝ ở ${new Set(missingAll.map(m => m.phieu + m.name)).size} BN -> bấm "⬇ Excel vị trí chưa ký". Chạy lượt sau (giữ ô "Bỏ qua hồ sơ đã ký xong") để ký bù.`
          : '🎉 Tất cả vị trí đã ký xong.');
        ui.setMissing(missingAll.length);
      }
    } finally {
      running = false;
      ui.setRunning(false);
      ui.status(stopRequested ? 'Đã dừng' : 'Xong');
    }
  }

  // ---------- ĐỒNG BỘ LẠI HỒ SƠ - BƯỚC 3: hủy ký + ký lại "01. XML ... BHXH 4750" ----------
  // Danh sách lấy ở checkxml (B1), đã xóa hồ sơ cũ trên cổng gdbhyt (B2). Trang nội trú xử lý HS "Nội trú /
  // Điều trị nội trú ban ngày"; trang kiemtrabangke xử lý HS "Ngoại trú".
  const RS_KEY = 'bhytResyncQueue';
  const rsLoad = () => new Promise(r => chrome.storage.local.get(RS_KEY, d => r(d[RS_KEY] || [])));
  const rsSave = q => new Promise(r => chrome.storage.local.set({ [RS_KEY]: q }, r));
  // Trang ký theo loại KCB (checkxml): Ngoại trú (khám bệnh) -> kiemtrabangke;
  // Điều trị ngoại trú -> kiemtrabangkebannt (01. XML BANT BHXH 4750);
  // Nội trú và Điều trị nội trú ban ngày -> kiemtrabangkenoitru
  const RS_PAGE = /kiemtrabangkebannt/i.test(location.pathname) ? 'bannt' : IS_NOITRU ? 'noitru' : 'ngoaitru';
  const rsKind = x => {
    const l = String(x.loai || '');
    if (/(ĐIỀU TRỊ|ĐT)\s*NGOẠI|ĐIỀU TRỊ NGT|ĐTNGT/i.test(l)) return 'bannt';
    if (/NGOẠI TRÚ|KHÁM/i.test(l)) return 'ngoaitru';
    return 'noitru';
  };
  const RS_PAGE_NAME = { noitru: 'kiemtrabangkenoitru (nội trú + ĐT nội trú ban ngày)', ngoaitru: 'kiemtrabangke (ngoại trú)', bannt: 'kiemtrabangkebannt (ĐT ngoại trú)' };
  const rsForPage = x => rsKind(x) === RS_PAGE;
  // "Còn N HS ở trang ..." cho các loại KCB thuộc trang khác
  const rsOtherPages = (q, sep) => Object.keys(RS_PAGE_NAME).filter(k => k !== RS_PAGE).map(k => {
    const n = q.filter(x => rsKind(x) === k && (x.gd === 'deleted' || x.gd === 'absent') && x.his !== 'done').length;
    return n ? `${sep}${n} HS ký ở trang ${RS_PAGE_NAME[k]}` : '';
  }).join('');
  const RS_CODE = () => (IS_NOITRU ? 'XML4750_NT' : 'XML4750');
  // Ký lại khi: đã xóa trên cổng (deleted) hoặc không có trên cổng (absent). "paid" (đã đề nghị TT) -> không đẩy lại
  const rsReady = x => (x.gd === 'deleted' || x.gd === 'absent') && x.his !== 'done';
  // Đã ký lại trên HIS nhưng B4 (cổng giám định) vẫn CHƯA thấy hồ sơ -> cho phép ký lại lần nữa (hỏi xác nhận)
  const rsNotUp = x => (x.gd === 'deleted' || x.gd === 'absent') && x.his === 'done' && x.up === 'notup';

  function setVal(el, v) {
    if (!el) return;
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // Tìm BN trên lưới: đặt ngày = ngày ra, khoa Tất cả, tích Có BHYT (nội trú) / Đã in bảng kê (ngoại trú), Xem thông tin
  async function rsFindPatient(x, log) {
    const d = (x.ngayRa.match(/\d{2}\/\d{2}\/\d{4}/) || [])[0];
    if (!d) throw new Error('Thiếu ngày ra');
    // Lưới nội trú có thể lọc theo NGÀY VÀO (checkxml chỉ có ngày ra) -> không thấy thì lùi 60 ngày trước ngày ra
    const [dd, mm, yy] = d.split('/').map(Number);
    const back = new Date(yy, mm - 1, dd);
    back.setDate(back.getDate() - 60);
    const backStr = `${String(back.getDate()).padStart(2, '0')}/${String(back.getMonth() + 1).padStart(2, '0')}/${back.getFullYear()}`;
    const tries = [[d, d], [d, todayVN()], [backStr, todayVN()]];
    for (const [tu, den] of tries) {
      setVal(document.getElementById('tungay'), tu);
      setVal(document.getElementById('denngay'), den);
      setVal(document.getElementById('cb_khoa'), '-1');
      const cb = document.getElementById(IS_NOITRU ? 'cobh' : 'dain');
      if (cb && !cb.checked) cb.click();
      const grid = findPatientGrid();
      const before = grid ? grid.querySelectorAll('tr.jqgrow').length : 0;
      click(document.getElementById('lammoi'));
      // chờ lưới nạp xong (số dòng đứng yên 1 giây)
      let last = -1, since = Date.now();
      const t0 = Date.now();
      await sleep(800);
      while (Date.now() - t0 < 20000) {
        const n = findPatientGrid() ? findPatientGrid().querySelectorAll('tr.jqgrow').length : 0;
        if (n !== last) { last = n; since = Date.now(); } else if (Date.now() - since > 1000) break;
        await sleep(200);
      }
      void before;
      const g = findPatientGrid();
      const iMa = colIndex(g, /^Mã y tế$/i);
      const pats = listPatients();
      const p = pats.find(pp => {
        const tr = g.querySelector(`tr.jqgrow[id="${CSS.escape(pp.rowId)}"]`);
        const ma = iMa >= 0 && tr ? (tr.querySelectorAll(':scope > td')[iMa]?.textContent || '').trim() : '';
        return ma === String(x.maBN) && normName(pp.fullName || pp.name) === normName(x.name);
      }) || pats.find(pp => normName(pp.fullName || pp.name) === normName(x.name) && (!x.maHSBA || pp.phieu === x.maHSBA || pp.phieu === x.soPhieu));
      if (p) return p;
      log(`    (không thấy BN ngày ${tu}${tu !== den ? ' - ' + den : ''})`);
    }
    throw new Error('Không thấy bệnh nhân trên lưới (kiểm tra ngày ra / Có BHYT / Đã in bảng kê)');
  }

  const toggleDone = () => document.getElementById('smartca-ad-ckb-trang-thai');
  async function setDoneView(ctx, on) {
    const t = toggleDone();
    if (!t) throw new Error('Không thấy nút gạt "Chưa / Đã hoàn thành"');
    if (t.checked !== on) { t.click(); await sleep(500); }
    await waitGridStable(ctx, 6000);
  }
  const visibleText = re => Array.from(document.querySelectorAll('body *'))
    .find(el => re.test(ownText(el).normalize('NFC')) && isVisible(el) && !el.closest('#bhyt-ksh-panel'));

  // Hủy ký XML 4750 (đang ở chế độ "Đã hoàn thành") - trả về '' nếu xong, ngược lại là lý do
  async function rsCancelSign(ctx, code, dry) {
    await setDoneView(ctx, true);
    const ks = currentKySoFor(ctx) || ctx.ks;
    const tr = rowForCode(ks, code);
    if (!tr) return 'nosign'; // chưa có chữ ký -> ký luôn
    const btn = tr.querySelector('[data-type="btn-huy-ky-so"]');
    // Không có nút X = phiếu hiện không có chữ ký (VD khoa đã tự hủy ký để sửa bệnh) -> ký luôn
    if (!btn) return 'nosign';
    if (dry) { btn.style.outline = '3px solid red'; btn.style.outlineOffset = '2px'; return 'dry'; }
    for (let attempt = 1; attempt <= 2; attempt++) {
      const t0 = Date.now();
      click(btn.closest('[data-type]') || btn);
      let asked = false;
      while (Date.now() - t0 < 25000) {
        if (stopRequested) throw new Error('Đã dừng');
        await sleep(200);
        if (visibleText(/đã gửi EMR/i)) { acceptConfirm(/đã gửi EMR/i); return 'HIS: "Bệnh nhân đã gửi EMR. Không thể thực hiện thao tác này" -> hủy EMR trước'; }
        if (!asked && acceptConfirm(/^Hủy ký số phiếu/i)) { asked = true; ctx.log('    đã xác nhận "Hủy ký số phiếu ...?"'); continue; }
        handleMessageBoxes();
        if (lastErrorAt > t0) return 'Hủy ký lỗi: ' + lastErrorMsg;
        if (asked && lastSuccessAt > t0) return '';
        if (lastUnlockedAt > t0 || lastLockAt > t0) break; // phiếu bị khóa -> đã mở khóa, bấm X lại
        // Dòng đã biến khỏi danh sách "Đã hoàn thành" -> đã hủy
        if (asked) {
          const cur = currentKySoFor(ctx);
          if (cur && findDocRows(cur).length && !rowForCode(cur, code)) return '';
        }
      }
      if (attempt === 1 && (lastUnlockedAt > t0 || lastLockAt > t0)) { await sleep(800); ctx.log('    phiếu bị khóa -> đã mở khóa, hủy lại'); continue; }
      break;
    }
    // Kiểm tra lại: còn ở "Đã hoàn thành" không
    await waitGridStable(ctx, 4000);
    const cur = currentKySoFor(ctx);
    return cur && rowForCode(cur, code) ? 'Quá thời gian, phiếu vẫn còn chữ ký' : '';
  }

  async function rsProcess(x, dry, log) {
    const code = RS_CODE();
    log('  - tìm bệnh nhân...');
    const p = await rsFindPatient(x, log);
    const info = await selectPatient(p);
    log('  - mở cửa sổ Ký số...');
    const ks = await openKySo(p, info);
    const ctx = { p, info, ks, log, curTab: null };
    await ensureKhac(ctx, CODES[code].tab || 'Khác');
    const r = await rsCancelSign(ctx, code, dry);
    if (r === 'dry') return { st: 'dry', note: 'CHẠY THỬ: đã tô đỏ nút Hủy ký số (X) của dòng XML 4750, CHƯA hủy. Bạn kiểm tra rồi đóng cửa sổ.' };
    if (r && r !== 'nosign') { await setDoneView(ctx, false).catch(() => {}); return { st: 'error', note: r }; }
    log(r === 'nosign' ? '  - XML 4750 đang CHƯA KÝ (khoa đã hủy ký / chưa ký) -> ký luôn' : '  - ✅ đã hủy ký XML 4750 -> ký lại');
    await setDoneView(ctx, false);
    ctx.curTab = CODES[code].tab || 'Khác';
    const signAt = Date.now();
    const s = await signOne(ctx, code);
    // HIS gửi lại XML lên cổng -> có thể báo "Số lần gửi XML 130 ... vượt quá 1 lần" (tool tự Xác nhận)
    await waitFor(() => { handleMessageBoxes(); return lastInfoAt > signAt; }, 3000, 200);
    const open = findKySoScope();
    if (open) await closeKySo(open);
    await waitFor(() => { handleMessageBoxes(); return lastInfoAt > signAt; }, 2000, 200);
    const infoNote = lastInfoAt > signAt ? ` · HIS: "${lastInfoMsg}" (đã gửi lại XML lên cổng)` : '';
    return s.result === 'ok' || /^Đã ký/.test(s.note) ? { st: 'done', note: s.note + infoNote } : { st: 'error', note: 'Ký lại: ' + s.note };
  }

  async function rsRun(dry, ui, limit = 0) {
    if (running) return;
    const q = await rsLoad();
    let todo = q.filter(x => rsForPage(x) && rsReady(x));
    let again = false;
    if (!todo.length) {
      const nu = q.filter(x => rsForPage(x) && rsNotUp(x));
      if (nu.length && (dry || confirm(`Không còn HS chờ ký lại, nhưng có ${nu.length} HS ĐÃ ký lại mà cổng giám định (B4) vẫn CHƯA thấy:\n\n` +
          `${nu.slice(0, 15).map(x => `- ${x.name} (${x.maHSBA}, ra ${x.ngayRa})`).join('\n')}${nu.length > 15 ? '\n...' : ''}\n\n` +
          `Hủy ký + ký lại XML 4750 LẦN NỮA cho các HS này?`))) { todo = nu; again = true; }
    }
    if (limit) todo = todo.slice(0, limit);
    if (!todo.length) {
      alert(`Không có hồ sơ nào cần ký lại ở trang ${RS_PAGE_NAME[RS_PAGE]}.` + rsOtherPages(q, '\n\n'));
      return;
    }
    if (findKySoScope()) { alert('Hãy đóng cửa sổ Ký số đang mở trước.'); return; }
    if (!dry && !again && !confirm(`HỦY KÝ + KÝ LẠI "01. XML ... BHXH 4750" cho ${todo.length} hồ sơ:\n\n${todo.slice(0, 15).map(x => `- ${x.name} (${x.maHSBA}, ra ${x.ngayRa})`).join('\n')}${todo.length > 15 ? '\n...' : ''}\n\nTiếp tục?`)) return;
    running = true; stopRequested = false; ui.setRunning(true);
    ui.log(`🔁 ${dry ? 'CHẠY THỬ (1 HS, không hủy)' : 'Ký lại XML 4750'}: ${todo.length} hồ sơ`);
    try {
      for (const x of (dry ? todo.slice(0, 1) : todo)) {
        if (stopRequested) { ui.log('⛔ Đã dừng.'); break; }
        ui.status(`${x.name} (${x.maHSBA})`);
        ui.log(`• ${x.name} - ${x.maHSBA} - ra ${x.ngayRa}`);
        let r;
        try { r = await rsProcess(x, dry, ui.log); }
        catch (e) {
          r = { st: 'error', note: e.message };
          if (e.message !== 'Đã dừng' && !dry) { const o = findKySoScope(); if (o) { try { await closeKySo(o); } catch (_) {} } }
        }
        ui.log(`  ${r.st === 'done' ? '✅' : r.st === 'dry' ? '🔎' : '❌'} ${r.note}`);
        if (dry) break;
        x.his = r.st; x.hisNote = r.st === 'done' ? '' : r.note;
        if (r.st === 'done' && again) { x.up = ''; x.upNote = ''; } // B4 kiểm tra lại từ đầu
        await rsSave(q);
      }
      if (!dry) {
        const n = s => todo.filter(x => x.his === s).length;
        ui.log(`—— Ký lại XML 4750: ✅ ${n('done')} | ❌ ${n('error')}. Hồ sơ lỗi xem lý do ở trên; sửa xong bấm lại để chạy tiếp.`);
      }
    } finally { running = false; ui.setRunning(false); ui.status(''); }
  }

  // ---------- Giao diện ----------
  function buildUi() {
    if (document.getElementById('bhyt-ksh-launch')) return;
    const launch = document.createElement('button');
    launch.id = 'bhyt-ksh-launch';
    launch.type = 'button';
    launch.textContent = '✍ Ký hàng loạt';
    document.body.appendChild(launch);

    const panel = document.createElement('div');
    panel.id = 'bhyt-ksh-panel';
    panel.innerHTML = `
      <div class="ksh-head"><b>Ký số hàng loạt ${IS_PDT ? 'PĐT / Bảng kê / CLS / Bệnh án' : 'XML'} <span style="font-weight:normal;opacity:.8">(bản 13.1)</span></b><span class="ksh-x" title="Đóng">✕</span></div>
      <div class="ksh-codes"></div>
      <div class="ksh-skip"><label><input type="checkbox" class="ksh-skipdone" checked> <b>Bỏ qua vị trí đã ký xong ở lượt trước</b> (không mở lại hồ sơ đã ký)</label></div>
      <div class="ksh-bar">
        <label><input type="checkbox" class="ksh-all"> Chọn tất cả</label>
        <button type="button" class="ksh-pend" title="Chỉ tích các BN còn vị trí chưa ký (theo loại phiếu / vai trò đang chọn)">☐ Chọn BN chưa ký xong</button>
        <span class="ksh-count"></span>
        <button type="button" class="ksh-reload">↻ Tải lại DS</button>
      </div>
      <div class="ksh-list"></div>
      <div class="ksh-actions">
        <button type="button" class="ksh-dry">Chạy thử (1 BN, không ký)</button>
        <button type="button" class="ksh-start">Bắt đầu ký</button>
        <button type="button" class="ksh-stop" disabled>Dừng</button>
      </div>
      <div class="ksh-actions">
        <button type="button" class="ksh-xls" disabled title="Danh sách vị trí chưa ký của lượt ký gần nhất (họ tên đầy đủ, vai trò, lý do)">⬇ Excel vị trí chưa ký</button>
        <button type="button" class="ksh-clear" title="Xóa ghi nhớ 'đã ký xong' trên máy này (lượt sau sẽ kiểm tra lại mọi hồ sơ)">🗑 Xóa ghi nhớ đã ký</button>
      </div>
      ${IS_PDT ? '' : `<div class="ksh-actions ksh-rs">
        <b>🔁 Đồng bộ lại (B3/3):</b>
        <button type="button" class="ksh-rs-dry" title="Mở hồ sơ đầu tiên, tô đỏ nút Hủy ký số của XML 4750 - không hủy">Chạy thử</button>
        <button type="button" class="ksh-rs-one" title="Hủy ký + ký lại THẬT cho 1 hồ sơ đầu tiên, rồi dừng">Thật 1 HS</button>
        <button type="button" class="ksh-rs-go" title="Hủy ký + ký lại 01. XML ... BHXH 4750 cho các hồ sơ đã xóa trên cổng (B2)">Hủy ký + ký lại XML 4750</button>
        <span class="ksh-rs-n"></span>
      </div>`}
      <div class="ksh-status"></div>
      <div class="ksh-log"></div>`;
    document.body.appendChild(panel);

    const $ = s => panel.querySelector(s);
    const codesBox = $('.ksh-codes');
    const pageCodes = Object.keys(CODES).filter(codeOnThisPage);
    const pdfBoxes = [];
    pageCodes.forEach(code => {
      const lb = document.createElement('label');
      lb.innerHTML = `<input type="checkbox" value="${code}" ${DEFAULT_CODES.includes(code) ? 'checked' : ''}> ${CODES[code].label}`;
      codesBox.appendChild(lb);
      if (CODES[code].pdf && code !== 'PDT') pdfBoxes.push(lb.querySelector('input'));
    });
    if (IS_PDT) {
      // Tờ điều trị tạo ngày nào thì ký ngày đó: chỉ ký phiếu có NGÀY TẠO đúng ngày chọn (mặc định hôm nay)
      const d = new Date();
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const day = document.createElement('div');
      day.className = 'ksh-roles';
      day.innerHTML = `Ngày tạo phiếu: <input type="date" class="ksh-ngay" value="${iso}"> <span style="color:#666">(chỉ ký phiếu tạo đúng ngày này)</span>`;
      codesBox.appendChild(day);
      // Vai trò ký vỏ bệnh án (mỗi trang 1 nhóm); mặc định: BS làm bệnh án (T2) + BS điều trị (T3)
      const hr = document.createElement('div');
      hr.className = 'ksh-roles';
      hr.innerHTML = 'Vai trò bệnh án: ' + Object.keys(HSBA_ROLES).map(k =>
        `<label><input type="checkbox" class="ksh-hrole" value="${k}" ${HSBA_ROLES[k].def ? 'checked' : ''}> ${HSBA_ROLES[k].label}</label>`).join(' ');
      codesBox.appendChild(hr);
    }
    if (pdfBoxes.length) {
      // 1 dòng chọn vai trò dùng chung cho các loại Bảng kê
      const roles = document.createElement('div');
      roles.className = 'ksh-roles';
      roles.innerHTML = 'Ký vai trò: ' + Object.keys(BK_ROLES).map(k =>
        // Trang Khám bệnh nội trú (khoa lâm sàng): mặc định chỉ ký NGƯỜI LẬP BẢNG KÊ (Nhân viên lập phiếu)
        `<label><input type="checkbox" class="ksh-role" value="${k}" ${IS_PDT && k !== 'NV' ? '' : 'checked'}> ${BK_ROLES[k].label}</label>`).join(' ');
      codesBox.appendChild(roles);
      // Tích vai trò mà chưa tích loại bảng kê nào -> tự tích loại bảng kê đầu tiên
      roles.addEventListener('change', () => {
        if (roles.querySelector('.ksh-role:checked') && !pdfBoxes.some(b => b.checked)) pdfBoxes[0].checked = true;
      });
      pdfBoxes.forEach(b => b.addEventListener('change', () => {
        if (b.checked && !roles.querySelector('.ksh-role:checked')) roles.querySelectorAll('.ksh-role').forEach(c => { c.checked = true; });
      }));
    }

    let patients = [];
    const renderList = () => {
      patients = listPatients();
      const box = $('.ksh-list');
      box.innerHTML = '';
      const sel = readSel();
      patients.forEach((p, i) => {
        const lb = document.createElement('label');
        const done = sel.codes.length && !pendingItems(p, sel.codes, sel).length;
        if (done) { lb.className = 'ksh-done'; lb.title = 'Đã ký xong (theo ghi nhớ trên máy này)'; }
        lb.innerHTML = `<input type="checkbox" data-i="${i}"> <span>${p.phieu}</span> ${(p.fullName || p.name).replace(/</g, '&lt;')}${done ? ' <b>✓</b>' : ''}`;
        box.appendChild(lb);
      });
      $('.ksh-all').checked = false;
      updateCount();
    };
    // Lựa chọn hiện tại: loại phiếu, vai trò bảng kê, ngày phiếu điều trị
    function readSel() {
      const codes = Array.from(codesBox.querySelectorAll('input:checked:not(.ksh-role):not(.ksh-ngay)')).map(c => c.value).filter(c => CODES[c] && codeOnThisPage(c));
      const roles = Array.from(panel.querySelectorAll('.ksh-role:checked')).map(c => c.value);
      const v = (panel.querySelector('.ksh-ngay')?.value || '').split('-');
      const ngay = v.length === 3 ? `${v[2]}/${v[1]}/${v[0]}` : '';
      return { codes, roles, ngay };
    }
    const checked = () => Array.from(panel.querySelectorAll('.ksh-list input:checked')).map(c => patients[+c.dataset.i]);
    const updateCount = () => { $('.ksh-count').textContent = `${checked().length}/${patients.length} BN`; };

    const ui = {
      log: msg => { const d = document.createElement('div'); d.textContent = msg; $('.ksh-log').appendChild(d); $('.ksh-log').scrollTop = 1e9; },
      status: msg => { $('.ksh-status').textContent = msg; },
      setRunning: on => {
        $('.ksh-start').disabled = on; $('.ksh-dry').disabled = on; $('.ksh-reload').disabled = on;
        $('.ksh-pend').disabled = on; $('.ksh-clear').disabled = on;
        panel.querySelectorAll('.ksh-rs button').forEach(b => { b.disabled = on; });
        $('.ksh-stop').disabled = !on;
        if (!on) renderMarks();
      },
      setMissing: n => {
        const b = $('.ksh-xls');
        b.disabled = !n;
        b.textContent = n ? `⬇ Excel vị trí chưa ký (${n})` : '⬇ Excel vị trí chưa ký';
      }
    };
    // Cập nhật dấu ✓ (đã ký xong) trên danh sách mà KHÔNG mất các ô đang tích
    const renderMarks = () => {
      const sel = readSel();
      panel.querySelectorAll('.ksh-list label').forEach(lb => {
        const p = patients[+lb.querySelector('input').dataset.i];
        if (!p) return;
        const done = sel.codes.length && !pendingItems(p, sel.codes, sel).length;
        lb.classList.toggle('ksh-done', !!done);
        let mark = lb.querySelector('b');
        if (done && !mark) { mark = document.createElement('b'); mark.textContent = '✓'; lb.append(' ', mark); }
        if (!done && mark) mark.remove();
      });
    };
    codesBox.addEventListener('change', renderMarks);
    if (!IS_PDT) {
      const rsCount = async () => {
        const q = await rsLoad();
        const n = q.filter(x => rsForPage(x) && rsReady(x)).length;
        const wait = q.filter(x => rsForPage(x) && !['deleted', 'absent', 'paid'].includes(x.gd)).length;
        const paid = q.filter(x => rsForPage(x) && x.gd === 'paid').length;
        const notUp = q.filter(x => rsForPage(x) && rsNotUp(x)).length;
        $('.ksh-rs-n').textContent = `${n} HS chờ ký lại ở trang này` +
          (notUp ? ` · ${notUp} đã ký lại nhưng cổng chưa thấy (bấm nút để ký lại lần nữa)` : '') +
          (wait ? ` · ${wait} chưa xử lý trên cổng` : '') + (paid ? ` · ${paid} đã ĐNTT (bỏ qua)` : '') + rsOtherPages(q, ' · ');
      };
      launch.addEventListener('click', rsCount);
      $('.ksh-rs-dry').addEventListener('click', () => { $('.ksh-log').innerHTML = ''; rsRun(true, ui).then(rsCount); });
      $('.ksh-rs-go').addEventListener('click', () => { $('.ksh-log').innerHTML = ''; rsRun(false, ui).then(rsCount); });
      $('.ksh-rs-one').addEventListener('click', () => { $('.ksh-log').innerHTML = ''; rsRun(false, ui, 1).then(rsCount); });
      rsCount();
    }
    $('.ksh-xls').addEventListener('click', exportMissing);
    $('.ksh-pend').addEventListener('click', () => {
      const sel = readSel();
      if (!sel.codes.length) { alert('Chọn loại phiếu trước.'); return; }
      let n = 0;
      panel.querySelectorAll('.ksh-list input').forEach(c => {
        const p = patients[+c.dataset.i];
        c.checked = !!p && pendingItems(p, sel.codes, sel).length > 0;
        if (c.checked) n++;
      });
      $('.ksh-all').checked = false;
      updateCount();
      ui.status(`Đã chọn ${n} BN còn vị trí chưa ký.`);
    });
    $('.ksh-clear').addEventListener('click', () => {
      if (!confirm('Xóa toàn bộ ghi nhớ "đã ký xong" trên máy này?\nLượt sau công cụ sẽ mở lại và kiểm tra mọi hồ sơ được chọn.')) return;
      saveDone({});
      renderMarks();
      ui.status('Đã xóa ghi nhớ đã ký.');
    });

    launch.addEventListener('click', () => {
      panel.style.display = panel.style.display === 'flex' ? 'none' : 'flex';
      if (panel.style.display === 'flex' && !running) renderList();
    });
    $('.ksh-x').addEventListener('click', () => { panel.style.display = 'none'; });
    $('.ksh-reload').addEventListener('click', renderList);
    $('.ksh-all').addEventListener('change', e => {
      panel.querySelectorAll('.ksh-list input').forEach(c => { c.checked = e.target.checked; });
      updateCount();
    });
    $('.ksh-list').addEventListener('change', updateCount);
    $('.ksh-stop').addEventListener('click', () => { stopRequested = true; ui.status('Đang dừng sau bước hiện tại...'); });

    const start = dryRun => {
      if (running) return;
      // Chỉ ký đúng các loại phiếu được tích (ô vai trò KHÔNG tự kéo theo việc ký Bảng kê)
      const codes = Array.from(codesBox.querySelectorAll('input:checked:not(.ksh-role)')).map(c => c.value).filter(c => CODES[c] && codeOnThisPage(c));
      const list = checked();
      if (!codes.length) { alert('Chọn ít nhất 1 loại phiếu.'); return; }
      if (!list.length) { alert('Chọn ít nhất 1 bệnh nhân.'); return; }
      if (findKySoScope()) { alert('Hãy đóng cửa sổ Ký số đang mở trước.'); return; }
      const roles = Array.from(panel.querySelectorAll('.ksh-role:checked')).map(c => c.value);
      if (codes.some(c => CODES[c].pdf && c !== 'PDT') && !roles.length) { alert('Chọn vai trò ký Bảng kê: Nhân viên lập phiếu và/hoặc Kế toán.'); return; }
      let ngay = '';
      if (codes.includes('PDT')) {
        const v = (panel.querySelector('.ksh-ngay')?.value || '').split('-');
        if (v.length !== 3) { alert('Chọn ngày tạo phiếu điều trị cần ký.'); return; }
        ngay = `${v[2]}/${v[1]}/${v[0]}`;
        if (!dryRun && ngay !== todayVN() && !confirm(`Ngày đang chọn (${ngay}) KHÁC hôm nay (${todayVN()}).\nVẫn ký phiếu điều trị tạo ngày ${ngay}?`)) return;
      }
      const hrolesPre = Array.from(panel.querySelectorAll('.ksh-hrole:checked')).map(c => c.value);
      const desc = codes.map(c => c === 'PDT' ? `Phiếu điều trị tạo ngày ${ngay}`
        : c === 'CLS' ? 'Cận lâm sàng (mọi phiếu chưa ký)'
          : c === 'HSBA' ? `Bệnh án (${hrolesPre.map(k => HSBA_ROLES[k].label).join(' + ')})`
            : CODES[c].pdf ? `${CODES[c].label.replace(/ \(ký trên PDF\)/, '')} (${roles.map(k => BK_ROLES[k].label).join(' + ')})` : c).join(', ');
      if (!dryRun && !confirm(`Ký số ${desc} cho ${list.length} bệnh nhân?\n\nChữ ký số có giá trị pháp lý. Chỉ chọn những hồ sơ đã rà soát xong.`)) return;
      $('.ksh-log').innerHTML = '';
      const hroles = Array.from(panel.querySelectorAll('.ksh-hrole:checked')).map(c => c.value);
      if (codes.includes('HSBA') && !hroles.length) { alert('Chọn ít nhất 1 vai trò ký bệnh án.'); return; }
      run(list, codes, dryRun, ui, { roles, ngay, hroles, skipDone: $('.ksh-skipdone').checked });
    };
    $('.ksh-dry').addEventListener('click', () => start(true));
    $('.ksh-start').addEventListener('click', () => start(false));
  }

  const style = document.createElement('style');
  style.textContent = `
    #bhyt-ksh-launch { position: fixed; left: 12px; bottom: 12px; z-index: 2147483000; padding: 6px 12px; font: bold 12px Arial;
      color: #fff; background: #0d47a1; border: 1px solid #08306b; border-radius: 4px; cursor: pointer; box-shadow: 0 2px 6px rgba(0,0,0,.3); }
    #bhyt-ksh-panel { display: none; flex-direction: column; position: fixed; left: 12px; bottom: 48px; z-index: 2147483000;
      width: 440px; max-width: calc(100vw - 24px); max-height: calc(100vh - 60px); overflow: hidden; box-sizing: border-box; background: #fff; border: 1px solid #0d47a1; border-radius: 6px; font: 12px Arial; color: #222;
      box-shadow: 0 4px 16px rgba(0,0,0,.3); }
    #bhyt-ksh-panel .ksh-head { display: flex; justify-content: space-between; padding: 6px 10px; background: #0d47a1; color: #fff; border-radius: 5px 5px 0 0; }
    #bhyt-ksh-panel .ksh-x { cursor: pointer; }
    #bhyt-ksh-panel .ksh-codes { padding: 6px 10px; display: flex; flex-direction: column; gap: 2px; border-bottom: 1px solid #ddd; }
    #bhyt-ksh-panel .ksh-roles { margin: 0 0 2px 20px; color: #0d47a1; }
    #bhyt-ksh-panel .ksh-roles label { margin-left: 6px; }
    #bhyt-ksh-panel .ksh-bar { display: flex; align-items: center; gap: 8px; padding: 4px 10px; background: #f3f6fb; }
    #bhyt-ksh-panel .ksh-count { flex: 1; color: #555; }
    #bhyt-ksh-panel .ksh-list { overflow: auto; max-height: 40vh; min-height: 80px; padding: 4px 10px; border-bottom: 1px solid #ddd; }
    #bhyt-ksh-panel .ksh-list label { display: block; padding: 1px 0; white-space: nowrap; }
    #bhyt-ksh-panel .ksh-list span { display: inline-block; min-width: 72px; color: #666; }
    #bhyt-ksh-panel .ksh-actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 10px; }
    #bhyt-ksh-panel .ksh-bar { flex-wrap: wrap; }
    #bhyt-ksh-panel .ksh-list label { overflow: hidden; text-overflow: ellipsis; }
    #bhyt-ksh-panel button { padding: 3px 8px; font: bold 12px Arial; cursor: pointer; border-radius: 3px; border: 1px solid #999; background: #f5f5f5; }
    #bhyt-ksh-panel .ksh-start { background: #1d6f42; color: #fff; border-color: #145a32; }
    #bhyt-ksh-panel .ksh-skip { padding: 4px 10px; background: #fff8e1; border-bottom: 1px solid #ddd; color: #6d4c00; }
    #bhyt-ksh-panel .ksh-list label.ksh-done { color: #999; }
    #bhyt-ksh-panel .ksh-list label.ksh-done b { color: #1d6f42; }
    #bhyt-ksh-panel .ksh-xls { background: #1d6f42; color: #fff; border-color: #145a32; }
    #bhyt-ksh-panel .ksh-pend { font-weight: normal !important; }
    #bhyt-ksh-panel .ksh-rs { flex-wrap: wrap; align-items: center; background: #f3e5f5; color: #6a1b9a; border-top: 1px solid #ddd; }
    #bhyt-ksh-panel .ksh-rs-go { background: #6a1b9a; color: #fff; border-color: #4a148c; }
    #bhyt-ksh-panel .ksh-rs-n { font-size: 11px; }
    #bhyt-ksh-panel .ksh-stop { background: #c62828; color: #fff; border-color: #8e0000; }
    #bhyt-ksh-panel button:disabled { opacity: .5; cursor: default; }
    /* Chỉ danh sách BN được co lại khi panel chạm 75vh; trạng thái + nhật ký luôn đủ cao, không đè lên nhau */
    #bhyt-ksh-panel > * { flex-shrink: 0; }
    #bhyt-ksh-panel > .ksh-list { flex-shrink: 1; }
    #bhyt-ksh-panel .ksh-status { padding: 6px 10px 4px; font-size: 13.5px; line-height: 1.4; font-weight: bold; color: #0d47a1;
      border-top: 1px solid #ddd; white-space: pre-wrap; word-break: break-word; }
    #bhyt-ksh-panel .ksh-status:empty { display: none; }
    #bhyt-ksh-panel .ksh-log { overflow: auto; min-height: 120px; max-height: 34vh; margin: 0 10px 8px; padding: 6px 8px;
      white-space: pre-wrap; word-break: break-word; font-family: Consolas, monospace; font-size: 12.5px; line-height: 1.45;
      background: #f7f9fc; border: 1px solid #dde3ee; border-radius: 4px; }
    #bhyt-ksh-panel .ksh-log:empty { display: none; }
    #bhyt-ksh-panel .ksh-rs-n { font-size: 12.5px; }
  `;
  (document.head || document.documentElement).appendChild(style);

  const init = () => { if (findPatientGrid()) buildUi(); };
  init();
  const t = setInterval(() => { init(); if (document.getElementById('bhyt-ksh-launch')) clearInterval(t); }, 1500);
})();
