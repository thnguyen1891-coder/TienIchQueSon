// KSK ký lại — phần chạy trên csdlyte.danang.gov.vn.
// 2) Đối chiếu: với mỗi hồ sơ trong hàng đợi, tìm theo tên ở các kho KSK, khớp năm sinh + ngày tạo = ngày khám.
// 4) Ký & đẩy lại: với các hồ sơ đã xóa bên csdlksk: Hủy đánh dấu liên thông → Ký số → Liên thông.
// Trang tải lại sau mỗi thao tác nên tiến trình được lưu trong chrome.storage.local ("kskRun").
(() => {
  'use strict';
  if (window.__tiqKskYte) return;
  window.__tiqKskYte = true;

  const QKEY = 'kskQueue', RKEY = 'kskRun', FLAG = '__tiq_ksk_autoconfirm';
  const KHO = ['ksk96', 'ksk72'];
  const MAX_TRIES = 6; // mỗi bước
  const MAX_ROUNDS = 2; // số vòng làm lại (ký lại + đẩy lại) thêm khi lỗi → tổng cộng 3 lần
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toUpperCase();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const get = (k, d) => new Promise((r) => chrome.storage.local.get(k, (o) => r(o[k] ?? d)));
  const set = (k, v) => new Promise((r) => chrome.storage.local.set({ [k]: v }, r));
  const keyOf = (it) => [it.name, it.year, it.ngayKham, it.cccd].join('|');
  const setAuto = (on) => { try { on ? sessionStorage.setItem(FLAG, '1') : sessionStorage.removeItem(FLAG); } catch (e) {} };

  const STATUS = {
    new: 'Chờ đối chiếu', matched: 'Đã khớp – chờ xóa', review: 'Cần xem tay', nomatch: 'Không thấy trên csdlyte',
    ambiguous: 'Nhiều kết quả', deleted: 'Đã xóa – chờ ký', delfail: 'Xóa lỗi', pushed: 'Đã đẩy lại', error: 'Lỗi ký/đẩy',
  };

  async function updateItem(it, patch) {
    const q = await get(QKEY, []);
    const t = q.find((x) => keyOf(x) === keyOf(it));
    if (t) Object.assign(t, patch);
    await set(QKEY, q);
    return t;
  }

  // ---------- Đối chiếu ----------
  function parseRows(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return [...doc.querySelectorAll('tbody tr')].map((r) => r.textContent.replace(/\s+/g, ' ')).filter((t) => /#\d{5,}/.test(t));
  }
  // Mở hồ sơ trong iframe ẩn (trang chi tiết tự tải dữ liệu bằng JS) để đọc Số CCCD và Ngày khám.
  function labelOf(input) {
    const w = input.closest('label');
    if (w) return w.textContent;
    let p = input.parentElement;
    for (let k = 0; k < 3 && p; k++) {
      const l = [...p.querySelectorAll('label,span,div')].find((x) => x !== input && !x.contains(input) && x.textContent.trim());
      if (l) return l.textContent;
      p = p.parentElement;
    }
    return '';
  }
  function readDetail(id) {
    return new Promise((resolve) => {
      const fr = document.createElement('iframe');
      fr.style.cssText = 'position:fixed;left:-3000px;top:0;width:1200px;height:900px;visibility:hidden';
      fr.src = '/records/' + id;
      let done = false;
      const finish = (v) => { if (done) return; done = true; clearInterval(t); fr.remove(); resolve(v); };
      const started = Date.now();
      const t = setInterval(() => {
        if (Date.now() - started > 20000) return finish(null);
        let doc;
        try { doc = fr.contentDocument; } catch (e) { return finish(null); }
        if (!doc || !doc.body) return;
        if (/\/login/.test(fr.contentWindow.location.pathname)) return finish({ login: true });
        let cccd = '', ngayKham = '';
        for (const i of doc.querySelectorAll('input')) {
          const lab = labelOf(i);
          if (!cccd && /Số CCCD|định danh/i.test(lab) && i.value) cccd = i.value.replace(/\s+/g, '');
          if (!ngayKham && /^\s*Ngày khám/i.test(lab) && i.value) ngayKham = i.value.trim();
        }
        if (cccd && ngayKham) finish({ cccd, ngayKham });
      }, 400);
      document.body.appendChild(fr);
    });
  }
  // csdlksk che giữa CCCD (vd 049******205): so 3 số đầu, 3 số cuối và độ dài.
  function cccdMatch(masked, full) {
    if (!masked || !full) return false;
    if (masked.length !== full.length) return false;
    for (let i = 0; i < masked.length; i++) if (masked[i] !== '*' && masked[i] !== full[i]) return false;
    return true;
  }

  async function findMatches(it) {
    const all = [];
    const reName = new RegExp('(?:^|[\\d\\s#])' + esc(it.name) + '\\s*(\\d\\d/\\d\\d/(\\d{4}))');
    for (const kho of KHO) {
      const res = await fetch('/records?kho=' + kho + '&q=' + encodeURIComponent(it.name), { credentials: 'include' });
      if (res.url.includes('/login')) throw new Error('Hết phiên đăng nhập csdlyte');
      for (const t of parseRows(await res.text())) {
        const m = norm(t).match(reName);
        if (!m || m[2] !== it.year) continue;
        const id = (t.match(/#(\d{5,})/) || [])[1];
        const created = (t.match(/\d\d:\d\d:\d\d\s*(\d\d\/\d\d\/\d{4})/) || [])[1] || '';
        all.push({ kho, id, dob: m[1], created });
      }
    }
    return all;
  }
  let busy = false;
  // onlyNew = true (chế độ tự động): chỉ đối chiếu hồ sơ mới, không lặp lại hồ sơ đã "Không thấy"/"Nhiều kết quả".
  async function matchAll(onlyNew) {
    if (busy) return 'busy'; busy = true;
    try {
      const q = await get(QKEY, []);
      const todo = q.filter((x) => (onlyNew ? ['new'] : ['new', 'nomatch', 'ambiguous', 'review']).includes(x.status));
      if (!todo.length) { log('Không có hồ sơ cần đối chiếu. Quét bên csdlksk trước.'); return 'none'; }
      let i = 0;
      for (const it of todo) {
        log(`Đối chiếu ${++i}/${todo.length}: ${it.name}…`);
        let m;
        try { m = await findMatches(it); } catch (e) { log(String(e.message || e)); return /phiên/.test(String(e.message)) ? 'login' : 'error'; }
        // Khớp theo: họ tên + năm sinh (ở bước tìm) + Số CCCD + Ngày khám (đọc trong hồ sơ)
        const ok = [], other = [];
        for (const c of m.slice(0, 6)) {
          log(`Đối chiếu ${i}/${todo.length}: ${it.name} — mở hồ sơ #${c.id}…`);
          const d = await readDetail(c.id);
          if (d && d.login) { log('Hết phiên đăng nhập csdlyte — đăng nhập lại rồi bấm Đối chiếu.'); return 'login'; }
          if (d && cccdMatch(it.cccd, d.cccd) && d.ngayKham === it.ngayKham) ok.push(c);
          else other.push(`${c.kho} #${c.id}` + (d ? ` khám ${d.ngayKham}${cccdMatch(it.cccd, d.cccd) ? '' : ', CCCD khác'}` : ' (không đọc được)'));
        }
        let patch;
        if (ok.length === 1) patch = { status: 'matched', kho: ok[0].kho, id: ok[0].id, note: `${ok[0].kho} #${ok[0].id}` };
        else if (ok.length > 1) patch = { status: 'ambiguous', note: ok.map((x) => x.kho + ' #' + x.id).join(', ') };
        else if (m.length) patch = { status: 'nomatch', note: 'không khớp CCCD/ngày khám: ' + other.join('; ') };
        else patch = { status: 'nomatch', note: 'không có hồ sơ cùng tên + năm sinh' };
        await updateItem(it, patch);
      }
      log('Đối chiếu xong. Quay lại csdlksk bấm "Xóa hồ sơ đã khớp".');
      return 'ok';
    } finally { busy = false; }
  }

  // ---------- Ký & đẩy lại (máy trạng thái qua các lần tải trang) ----------
  const urlFor = (it) => `/records?kho=${it.kho}&q=${encodeURIComponent(it.name)}`;
  const onUrl = (it) => {
    const p = new URLSearchParams(location.search);
    return location.pathname === '/records' && p.get('kho') === it.kho && norm(p.get('q')) === it.name;
  };
  const findRow = (id) => [...document.querySelectorAll('tbody tr')].find((r) => r.innerText.includes('#' + id));
  async function waitFor(fn, ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(200); }
    return null;
  }

  async function stopRun(msg, finished) {
    await set(RKEY, { active: false });
    setAuto(false);
    if (msg) log(msg);
    render();
    // Chế độ tự động: ký xong hết → sang kiểm tra Nhật ký trên Cổng
    if (finished) {
      const a = await get(AKEY, { active: false });
      if (a.active && a.phase === 'sign') await goPhaseY('verify', 'Đã ký & liên thông xong lượt này');
    }
  }

  async function step() {
    const run = await get(RKEY, { active: false });
    if (!run.active) return;
    setAuto(true);
    if (location.pathname.startsWith('/login')) { log('Hết phiên — đăng nhập lại, tiến trình sẽ tự chạy tiếp.'); return; }
    await sleep(1200);

    const q = await get(QKEY, []);
    const it = q.find((x) => x.status === 'deleted' && x.id && x.kho);
    if (!it) return stopRun('Ký & đẩy lại: đã xong hết hồ sơ trong hàng đợi.', true);
    if (!onUrl(it)) { location.href = urlFor(it); return; }

    const stage = it.stage || 'unmark';
    // Hồ sơ lỗi: làm lại TỪ ĐẦU (hủy liên thông → ký số lại → đẩy lại) thêm tối đa MAX_ROUNDS vòng rồi mới báo lỗi
    const failItem = async (note) => {
      const rounds = it.rounds || 0;
      if (rounds < MAX_ROUNDS) {
        await updateItem(it, { stage: 'unmark', tries: 0, unmarks: 0, signedAt: 0, why: '', rounds: rounds + 1, note: `vòng ${rounds + 2}: ký lại & đẩy lại (lần trước: ${note})` });
      } else {
        await updateItem(it, { status: 'error', tries: 0, note: `${note} (đã thử ${rounds + 1} vòng)` });
      }
      location.reload();
    };
    // Thông báo (alert) của trang bị ksk_csdlyte_main.js chặn khi đang chạy → đọc lại để biết Cổng báo gì
    let lastAlert = '';
    try { lastAlert = sessionStorage.getItem('__tiq_ksk_lastalert') || ''; sessionStorage.removeItem('__tiq_ksk_lastalert'); } catch (e) {}
    if (lastAlert) {
      await updateItem(it, { why: 'trang báo: ' + lastAlert.slice(0, 160) });
      it.why = 'trang báo: ' + lastAlert.slice(0, 160);
      if (/lỗi|thất bại|không thể|không hợp lệ|thiếu|chưa ký|từ chối|error/i.test(lastAlert) && !/Đã gửi/i.test(lastAlert)) {
        return failItem(`bước ${stage}: ${lastAlert.slice(0, 200)}`);
      }
    }
    // Đếm số lần thử THEO TỪNG BƯỚC; ghi lại lý do lần thử trước để biết kẹt vì sao.
    const tries = (it.tries || 0) + 1;
    if (tries > MAX_TRIES) return failItem(`kẹt ở bước ${stage}${it.why ? ': ' + it.why : ''}`);
    await updateItem(it, { tries });
    const retry = async (why, ms = 1500) => { await updateItem(it, { why }); setTimeout(() => location.reload(), ms); };
    const goStage = async (s, extra = {}) => { await updateItem(it, Object.assign({ stage: s, tries: 0, why: '' }, extra)); };

    const row = await waitFor(() => findRow(it.id), 5000);
    if (!row) { await updateItem(it, { status: 'error', note: 'không thấy #' + it.id }); location.reload(); return; }
    // "Đã liên thông" hoặc "Chờ Cổng ETL" đều có nút "Hủy đánh dấu …" — cả hai đều tính là đã đẩy lên Cổng.
    const linked = /Chờ Cổng ETL|Đã liên thông/.test(row.innerText);
    const huyBtn = row.querySelector('button[title^="Hủy đánh dấu"],button[title^="Huỷ đánh dấu"]');
    log(`${it.name} (#${it.id}) — bước: ${stage}${tries > 1 ? ` (lần ${tries})` : ''}`);

    if (stage === 'unmark') {
      if (linked && huyBtn) {
        await goStage('sign', { unmarks: (it.unmarks || 0) + 1 });
        huyBtn.click();
        setTimeout(() => location.reload(), 6000);
        return;
      }
      await goStage('sign');
      location.reload(); return;
    }

    if (stage === 'sign') {
      if (linked) {
        // Hủy chưa ăn hoặc hồ sơ đã được đẩy lại (vd. bạn tự đẩy tay)
        if (it.signedAt) { await updateItem(it, { status: 'pushed', stage: '', tries: 0, note: 'đã lên Cổng', pushedAt: Date.now() }); location.reload(); return; }
        if ((it.unmarks || 0) >= 2) return failItem('hủy đánh dấu liên thông không được');
        await goStage('unmark'); location.reload(); return;
      }
      document.querySelectorAll('tbody input[type=checkbox]:checked').forEach((c) => c.click());
      await sleep(300);
      const cb = row.querySelector('input[type=checkbox]');
      if (!cb) return retry('không thấy ô chọn hồ sơ');
      if (!cb.checked) cb.click();
      const kyBtn = await waitFor(() => [...document.querySelectorAll('button')].find((b) => /^Ký số 1 hồ sơ$/.test(b.innerText.trim())), 4000);
      const nChecked = document.querySelectorAll('tbody input[type=checkbox]:checked').length;
      if (nChecked !== 1) return retry(`đang chọn ${nChecked} hồ sơ`);
      if (!kyBtn) return retry('không thấy nút "Ký số 1 hồ sơ"');
      kyBtn.click();
      const dlg = await waitFor(() => [...document.querySelectorAll('[role=dialog]')].find((d) => /Xác thực chữ ký số/.test(d.innerText)), 8000);
      if (!dlg) return retry('hộp "Xác thực chữ ký số" không mở', 500);
      if (!dlg.innerText.includes('#' + it.id)) return retry('hộp ký không đúng hồ sơ', 500);
      if (!run.autoSign) {
        await goStage('push', { signedAt: Date.now() });
        log(`Hãy đọc, tick ô cam kết và bấm "Xác nhận ký số" cho ${it.name}. Tiện ích sẽ tự chạy tiếp.`);
        return;
      }
      const lbl = [...dlg.querySelectorAll('label')].find((l) => /đồng ý ký số/i.test(l.innerText));
      const box = (lbl && lbl.querySelector('input[type=checkbox]')) || [...dlg.querySelectorAll('input[type=checkbox]')].pop();
      if (box && !box.checked) box.click();
      const ok = await waitFor(() => { const b = [...dlg.querySelectorAll('button')].find((x) => x.innerText.trim() === 'Xác nhận ký số'); return b && !b.disabled ? b : null; }, 5000);
      if (!ok) return retry('nút "Xác nhận ký số" không bật', 500);
      await goStage('push', { signedAt: Date.now() });
      ok.click();
      setTimeout(() => location.reload(), 15000);
      return;
    }

    if (stage === 'push') {
      if (linked) {
        await updateItem(it, { status: 'pushed', stage: '', tries: 0, why: '', pushedAt: Date.now(), note: (row.innerText.match(/Chờ Cổng ETL|Đã liên thông/) || [''])[0] });
        location.reload(); return;
      }
      const lt = [...row.querySelectorAll('button')].find((b) => ((b.title || '') + (b.getAttribute('aria-label') || '')).includes('Liên thông hồ sơ #' + it.id));
      if (!lt) return retry('không thấy nút Liên thông của hồ sơ');
      if (!it.why || !/^trang báo/.test(it.why)) await updateItem(it, { why: `đã bấm Liên thông ${tries} lần, hồ sơ chưa chuyển "Chờ Cổng ETL"` });
      lt.click();
      // Sau khi bấm, trang gọi /api/byt/sync (mất vài giây đến vài chục giây) rồi mới đổi sang "Chờ Cổng ETL"
      // ngay trên dòng. KHÔNG tải lại trang giữa chừng (sẽ cắt ngang việc đẩy) — chờ tại chỗ tối đa 2 phút.
      const done = await waitFor(() => { const r2 = findRow(it.id); return r2 && /Chờ Cổng ETL|Đã liên thông/.test(r2.innerText); }, 120000);
      if (done) {
        await updateItem(it, { status: 'pushed', stage: '', tries: 0, why: '', pushedAt: Date.now(), note: 'Chờ Cổng ETL' });
      }
      location.reload();
    }
  }

  async function startRun() {
    const q = await get(QKEY, []);
    const n = q.filter((x) => x.status === 'deleted' && x.id).length;
    if (!n) { log('Không có hồ sơ "Đã xóa – chờ ký". Xóa bên csdlksk trước.'); return; }
    const autoSign = autoBox.checked;
    if (autoSign && !confirm(`Tiện ích sẽ TỰ tick cam kết và bấm "Xác nhận ký số" cho ${n} hồ sơ.\nChữ ký số có giá trị pháp lý. Tiếp tục?`)) return;
    await set(RKEY, { active: true, autoSign });
    render();
    step();
  }

  // ================= TỰ ĐỘNG TOÀN BỘ (phần csdlyte) =================
  // Bộ điều phối nằm ở ksk_admin.js; trang này chỉ làm bước "match" và "sign", xong thì quay về Cổng.
  const AKEY = 'kskAuto';
  const URL_CHECKUP = 'https://admin.csdlksk.vn/admin/operation/health-checkup';
  const URL_LOG = 'https://admin.csdlksk.vn/admin/operation/health-data';
  const PHASE_NAME = { scan: 'Quét Cổng', match: 'Đối chiếu csdlyte', delete: 'Xóa trên Cổng', sign: 'Ký & liên thông', verify: 'Kiểm tra Nhật ký', done: 'Hoàn tất' };
  async function setA(patch) { const a = await get(AKEY, { active: false }); await set(AKEY, Object.assign(a, patch)); }
  async function goPhaseY(phase, msg) {
    await setA({ phase, msg: msg || '', phaseAt: Date.now() });
    render();
    if (phase === 'sign' || phase === 'match') { setTimeout(autoTick, 500); return; }
    location.href = phase === 'verify' ? URL_LOG : URL_CHECKUP;
  }
  let ticking = false;
  async function autoTick() {
    if (ticking) return;
    const a = await get(AKEY, { active: false });
    if (!a.active) return;
    if (location.pathname.startsWith('/login')) { log('Hết phiên csdlyte — đăng nhập lại, tự động sẽ chạy tiếp.'); return; }
    ticking = true;
    try {
      if (a.phase === 'match') {
        const r = await matchAll(true);
        if (r === 'login' || r === 'busy') return;
        if (r === 'error') { await setA({ active: false, msg: 'Lỗi khi đối chiếu — đã dừng.' }); render(); return; }
        const q = await get(QKEY, []);
        const m = q.filter((x) => x.status === 'matched').length;
        const next = m ? 'delete' : (q.some((x) => x.status === 'deleted') ? 'sign' : 'scan');
        await goPhaseY(next, `Đối chiếu: khớp ${m}`);
        return;
      }
      if (a.phase === 'sign') {
        const run = await get(RKEY, { active: false });
        if (run.active) return; // đang chạy (step được gọi khi tải trang)
        // Hồ sơ lỗi từ trước (chưa dùng hết số vòng) → đưa lại vào hàng ký lại & đẩy lại
        const q = await get(QKEY, []);
        let again = 0;
        for (const x of q) {
          if (x.status === 'error' && x.id && (x.rounds || 0) < MAX_ROUNDS) {
            Object.assign(x, { status: 'deleted', stage: 'unmark', tries: 0, unmarks: 0, signedAt: 0, why: '', rounds: (x.rounds || 0) + 1, note: `thử lại vòng ${(x.rounds || 0) + 2}` });
            again++;
          }
        }
        if (again) await set(QKEY, q);
        await set(RKEY, { active: true, autoSign: true, auto: true });
        render();
        step();
        return;
      }
      // Các bước còn lại làm trên Cổng
      location.href = a.phase === 'verify' ? URL_LOG : URL_CHECKUP;
    } finally { ticking = false; }
  }

  // ---------- Bảng điều khiển ----------
  let panel, logEl, listEl, autoBox, runEl, autoEl;
  function log(msg) { if (logEl) logEl.textContent = msg; }
  function el(tag, css, text) { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; }
  function btn(label, bg, fn) {
    const b = el('button', `margin:2px;padding:4px 8px;border:0;border-radius:6px;color:#fff;background:${bg};cursor:pointer;font-size:12px`, label);
    b.onclick = fn; return b;
  }
  async function render() {
    if (!panel) return;
    const q = await get(QKEY, []);
    const run = await get(RKEY, { active: false });
    runEl.textContent = run.active ? `● Đang chạy Ký & đẩy lại${run.autoSign ? ' (tự xác nhận ký)' : ''}` : '';
    const a = await get(AKEY, { active: false });
    autoEl.textContent = a.active
      ? `● TỰ ĐỘNG — chu kỳ ${a.cycle || 1} · bước: ${PHASE_NAME[a.phase] || a.phase}${a.msg ? ' · ' + a.msg : ''}`
      : (a.msg ? `Tự động: ${a.msg}` : '');
    autoEl.parentElement.style.display = (a.active || a.msg) ? '' : 'none';
    const cnt = {};
    q.forEach((x) => { cnt[x.status] = (cnt[x.status] || 0) + 1; });
    listEl.innerHTML = '';
    listEl.appendChild(el('div', 'margin:4px 0;font-weight:600', `Hàng đợi: ${q.length} — ` + Object.keys(cnt).map((k) => `${STATUS[k] || k}: ${cnt[k]}`).join(' · ')));
    const tbl = el('div', 'max-height:220px;overflow:auto;border-top:1px solid #ddd');
    q.forEach((x) => {
      const color = { deleted: '#0a7', pushed: '#06c', matched: '#a60', delfail: '#c00', error: '#c00', nomatch: '#888', ambiguous: '#c60', review: '#c60' }[x.status] || '#333';
      const line = el('div', 'padding:2px 0;border-bottom:1px dashed #eee');
      line.appendChild(el('span', '', `${x.name} (${x.year}) · ${x.ngayKham} — `));
      line.appendChild(el('span', `color:${color};font-weight:600`, STATUS[x.status] || x.status));
      if (x.note) line.appendChild(el('span', 'color:#777', ` · ${x.note}`));
      if (x.portal) line.appendChild(el('span', 'color:#0f766e', ` · Nhật ký: ${x.portal}`));
      if (x.status === 'error' || x.status === 'delfail') {
        const a = el('a', 'margin-left:6px;color:#0f766e;cursor:pointer;text-decoration:underline', 'đã xử lý tay');
        a.title = 'Bạn đã tự ký/đẩy hồ sơ này → đánh dấu "Đã đẩy lại"';
        a.onclick = async () => {
          if (!confirm(`Đánh dấu ${x.name} là đã xử lý tay (đã ký và đẩy lên Cổng)?`)) return;
          await updateItem(x, { status: 'pushed', note: 'xử lý tay', stage: '', tries: 0, pushedAt: Date.now() });
          render();
        };
        line.appendChild(a);
      }
      tbl.appendChild(line);
    });
    listEl.appendChild(tbl);
  }
  function mount() {
    if (panel) return;
    panel = el('div', 'position:fixed;left:12px;bottom:12px;z-index:2147483646;width:440px;background:#fff;border:1px solid #a7f3d0;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.18);font:12px/1.4 system-ui,sans-serif;color:#222');
    const head = el('div', 'padding:6px 10px;background:#047857;color:#fff;border-radius:10px 10px 0 0;cursor:pointer;font-weight:600', 'KSK ký lại — Bước 2 & 4 (csdlyte) ▾');
    const body = el('div', 'padding:8px 10px');
    head.onclick = () => { body.style.display = body.style.display === 'none' ? '' : 'none'; };
    const autoWrap = el('div', 'margin:0 0 6px;padding:6px;border:1px solid #fde68a;background:#fffbeb;border-radius:8px');
    autoEl = el('span', 'color:#b45309;font-weight:600');
    autoWrap.appendChild(autoEl);
    autoWrap.appendChild(btn('■ Dừng tự động', '#6b7280', async () => {
      await set(RKEY, { active: false }); setAuto(false);
      await setA({ active: false, msg: 'Đã dừng theo yêu cầu.' });
      log('Đã dừng tự động.'); render();
    }));
    body.appendChild(autoWrap);
    body.appendChild(el('div', 'color:#777;margin:2px 0', 'Chạy tự động: bấm "▶ Chạy" trên bảng của Cổng csdlksk. Làm tay từng bước:'));
    body.appendChild(btn('Đối chiếu', '#047857', () => matchAll(false)));
    body.appendChild(btn('Ký & đẩy lại', '#1d4ed8', startRun));
    body.appendChild(btn('Dừng', '#6b7280', () => stopRun('Đã dừng.')));
    body.appendChild(btn('Đặt lại lỗi', '#9ca3af', async () => {
      const q = await get(QKEY, []);
      q.forEach((x) => { if (x.status === 'error') { x.status = 'deleted'; x.stage = ''; x.tries = 0; x.note = ''; x.why = ''; x.unmarks = 0; } });
      await set(QKEY, q); render();
    }));
    body.appendChild(btn('Dọn hồ sơ đã xong', '#0f766e', async () => {
      const q = await get(QKEY, []);
      const keep = q.filter((x) => x.status !== 'pushed');
      if (!confirm(`Bỏ ${q.length - keep.length} hồ sơ "Đã đẩy lại" khỏi hàng đợi? (chỉ dọn danh sách trong tiện ích)`)) return;
      await set(QKEY, keep); render();
    }));
    const lab = el('label', 'display:block;margin:4px 0;color:#b91c1c');
    autoBox = el('input'); autoBox.type = 'checkbox';
    lab.appendChild(autoBox);
    lab.appendChild(document.createTextNode(' Tự tick cam kết & bấm "Xác nhận ký số" (bỏ trống = bạn tự xác nhận từng hồ sơ)'));
    body.appendChild(lab);
    runEl = el('div', 'color:#047857;font-weight:600');
    logEl = el('div', 'margin:6px 0;color:#1d4ed8;min-height:16px');
    listEl = el('div');
    body.appendChild(runEl); body.appendChild(logEl); body.appendChild(listEl);
    panel.appendChild(head); panel.appendChild(body);
    document.body.appendChild(panel);
    render();
  }

  chrome.storage.onChanged.addListener((c) => {
    if (c[QKEY] || c[RKEY] || c[AKEY]) render();
    if (c[AKEY] && c[AKEY].newValue && c[AKEY].newValue.active &&
        (!c[AKEY].oldValue || !c[AKEY].oldValue.active || c[AKEY].oldValue.phase !== c[AKEY].newValue.phase)) setTimeout(autoTick, 800);
  });
  mount();
  get(RKEY, { active: false }).then((r) => {
    if (r.active) step();
    else { setAuto(false); setTimeout(autoTick, 1500); }
  });
})();
