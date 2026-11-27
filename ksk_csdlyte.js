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
  const MAX_TRIES = 10;
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
  async function matchAll() {
    if (busy) return; busy = true;
    try {
      const q = await get(QKEY, []);
      const todo = q.filter((x) => ['new', 'nomatch', 'ambiguous', 'review'].includes(x.status));
      if (!todo.length) { log('Không có hồ sơ cần đối chiếu. Quét bên csdlksk trước.'); return; }
      let i = 0;
      for (const it of todo) {
        log(`Đối chiếu ${++i}/${todo.length}: ${it.name}…`);
        let m;
        try { m = await findMatches(it); } catch (e) { log(String(e.message || e)); return; }
        const byDate = m.filter((x) => x.created === it.ngayKham);
        let patch;
        if (byDate.length === 1) patch = { status: 'matched', kho: byDate[0].kho, id: byDate[0].id, note: `${byDate[0].kho} #${byDate[0].id}` };
        else if (byDate.length > 1) patch = { status: 'ambiguous', note: byDate.map((x) => x.kho + ' #' + x.id).join(', ') };
        else if (m.length) patch = { status: 'review', note: 'khác ngày: ' + m.map((x) => `${x.kho} #${x.id} tạo ${x.created}`).join(', ') };
        else patch = { status: 'nomatch', note: '' };
        await updateItem(it, patch);
      }
      log('Đối chiếu xong. Quay lại csdlksk bấm "Xóa hồ sơ đã khớp".');
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

  async function stopRun(msg) {
    await set(RKEY, { active: false });
    setAuto(false);
    if (msg) log(msg);
    render();
  }

  async function step() {
    const run = await get(RKEY, { active: false });
    if (!run.active) return;
    setAuto(true);
    if (location.pathname.startsWith('/login')) { log('Hết phiên — đăng nhập lại, tiến trình sẽ tự chạy tiếp.'); return; }
    await sleep(1200);

    const q = await get(QKEY, []);
    const it = q.find((x) => x.status === 'deleted' && x.id && x.kho);
    if (!it) return stopRun('Ký & đẩy lại: đã xong hết hồ sơ trong hàng đợi.');
    if (!onUrl(it)) { location.href = urlFor(it); return; }

    const tries = (it.tries || 0) + 1;
    if (tries > MAX_TRIES) { await updateItem(it, { status: 'error', note: `kẹt ở bước ${it.stage || 'unmark'}`, tries: 0 }); location.reload(); return; }
    await updateItem(it, { tries });

    const row = await waitFor(() => findRow(it.id), 5000);
    if (!row) { await updateItem(it, { status: 'error', note: 'không thấy #' + it.id }); location.reload(); return; }
    const stage = it.stage || 'unmark';
    log(`${it.name} (#${it.id}) — bước: ${stage}`);

    if (stage === 'unmark') {
      const huy = row.querySelector('button[title^="Hủy đánh dấu"]');
      await updateItem(it, { stage: 'sign' });
      if (huy) { huy.click(); setTimeout(() => location.reload(), 6000); return; }
      location.reload(); return;
    }

    if (stage === 'sign') {
      if (row.querySelector('button[title^="Hủy đánh dấu"]')) { await updateItem(it, { stage: 'unmark' }); location.reload(); return; }
      document.querySelectorAll('tbody input[type=checkbox]:checked').forEach((c) => c.click());
      const cb = row.querySelector('input[type=checkbox]');
      if (!cb.checked) cb.click();
      await sleep(400);
      const nChecked = document.querySelectorAll('tbody input[type=checkbox]:checked').length;
      const kyBtn = [...document.querySelectorAll('button')].find((b) => /^Ký số 1 hồ sơ$/.test(b.innerText.trim()));
      if (nChecked !== 1 || !kyBtn) { setTimeout(() => location.reload(), 1500); return; }
      kyBtn.click();
      const dlg = await waitFor(() => [...document.querySelectorAll('[role=dialog]')].find((d) => /Xác thực chữ ký số/.test(d.innerText)), 6000);
      if (!dlg || !dlg.innerText.includes('#' + it.id)) { location.reload(); return; }
      await updateItem(it, { stage: 'push' });
      if (!run.autoSign) {
        log(`Hãy đọc, tick ô cam kết và bấm "Xác nhận ký số" cho ${it.name}. Tiện ích sẽ tự chạy tiếp.`);
        return;
      }
      const lbl = [...dlg.querySelectorAll('label')].find((l) => /đồng ý ký số/i.test(l.innerText));
      const box = (lbl && lbl.querySelector('input[type=checkbox]')) || [...dlg.querySelectorAll('input[type=checkbox]')].pop();
      if (box && !box.checked) box.click();
      const ok = await waitFor(() => { const b = [...dlg.querySelectorAll('button')].find((x) => x.innerText.trim() === 'Xác nhận ký số'); return b && !b.disabled ? b : null; }, 4000);
      if (!ok) { await updateItem(it, { stage: 'sign' }); location.reload(); return; }
      ok.click();
      setTimeout(() => location.reload(), 15000);
      return;
    }

    if (stage === 'push') {
      // Sau bước "hủy", nhãn liên thông đã mất; nếu nay hiện lại (Chờ Cổng ETL / Đã liên thông) là đã đẩy xong.
      const st = (row.innerText.match(/Chờ Cổng ETL|Đã liên thông/) || [])[0];
      if (st) {
        await updateItem(it, { status: 'pushed', stage: '', tries: 0, note: st });
        location.reload(); return;
      }
      const lt = [...row.querySelectorAll('button')].find((b) => ((b.title || '') + (b.getAttribute('aria-label') || '')).includes('Liên thông hồ sơ #' + it.id));
      if (!lt) { location.reload(); return; }
      lt.click();
      setTimeout(() => location.reload(), 6000);
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

  // ---------- Bảng điều khiển ----------
  let panel, logEl, listEl, autoBox, runEl;
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
    body.appendChild(btn('Đối chiếu', '#047857', matchAll));
    body.appendChild(btn('Ký & đẩy lại', '#1d4ed8', startRun));
    body.appendChild(btn('Dừng', '#6b7280', () => stopRun('Đã dừng.')));
    body.appendChild(btn('Đặt lại lỗi', '#9ca3af', async () => {
      const q = await get(QKEY, []);
      q.forEach((x) => { if (x.status === 'error') { x.status = 'deleted'; x.stage = ''; x.tries = 0; x.note = ''; } });
      await set(QKEY, q); render();
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

  chrome.storage.onChanged.addListener((c) => { if (c[QKEY] || c[RKEY]) render(); });
  mount();
  get(RKEY, { active: false }).then((r) => { if (!r.active) setAuto(false); else step(); });
})();
