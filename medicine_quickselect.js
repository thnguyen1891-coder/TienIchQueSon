// Tích chọn nhanh các dòng trong lưới jqGrid (VD: "Thông tin chi tiết toa thuốc nội trú")
// trên trang tool-Medicine-Client-CV130 (áp dụng cho mọi tab: #tab1-tab, #tab2-tab...).
//  - Bấm giữ chuột vào ô tích của 1 dòng rồi kéo lên/xuống: các dòng đi qua được tích (hoặc bỏ tích) theo dòng đầu tiên.
//  - Bấm 1 ô, giữ Shift bấm ô khác: tích (hoặc bỏ tích) cả khoảng giữa 2 dòng.
//  - Nút "Chọn tất cả" cạnh "Thời gian kê" (hoặc trên thanh tiêu đề lưới nếu tab không có chữ đó).
// Không đụng tới ô tích "chọn tất cả" trên thanh tiêu đề.
(function () {
  if (window.__bhytQuickSelectLoaded) return;
  window.__bhytQuickSelectLoaded = true;

  let drag = null;            // { tbody, target, startRow }
  let suppressClickOn = null; // checkbox vừa được xử lý ở mousedown, bỏ qua click gốc
  let lastClicked = null;     // { tbody, row } cho Shift+click
  let synthetic = false;      // đang click giả lập, bỏ qua listener

  function getRowCheckbox(row) {
    return row ? row.querySelector('td input.cbox[type="checkbox"]') : null;
  }

  // Trả về { row, cb, tbody } nếu phần tử nằm trong ô tích của 1 dòng dữ liệu (không phải tiêu đề).
  function getCheckboxCell(el) {
    if (!el || !el.closest) return null;
    const td = el.closest('td');
    if (!td) return null;
    const row = td.closest('tr.jqgrow');
    if (!row) return null;
    const table = row.closest('table.ui-jqgrid-btable');
    if (!table) return null;
    const cb = td.querySelector('input.cbox[type="checkbox"]');
    if (!cb) return null;
    return { row, cb, tbody: row.parentElement };
  }

  function setRowChecked(row, checked) {
    const cb = getRowCheckbox(row);
    if (!cb || cb.disabled || cb.checked === checked) return;
    synthetic = true;
    try { cb.click(); } finally { synthetic = false; }
  }

  function rowsBetween(tbody, a, b) {
    const rows = Array.from(tbody.querySelectorAll(':scope > tr.jqgrow'))
      .filter(r => r.style.display !== 'none');
    let i = rows.indexOf(a), j = rows.indexOf(b);
    if (i < 0 || j < 0) return [];
    if (i > j) [i, j] = [j, i];
    return rows.slice(i, j + 1);
  }

  function endDrag() {
    if (!drag) return;
    drag = null;
    document.documentElement.classList.remove('bhyt-qs-dragging');
  }

  document.addEventListener('mousedown', function (e) {
    if (e.button !== 0 || synthetic) return;
    const hit = getCheckboxCell(e.target);
    if (!hit || hit.cb.disabled) return;

    // Shift+click: chọn cả khoảng
    if (e.shiftKey && lastClicked && lastClicked.tbody === hit.tbody && lastClicked.row.isConnected) {
      e.preventDefault();
      const target = getRowCheckbox(lastClicked.row)?.checked ?? true;
      rowsBetween(hit.tbody, lastClicked.row, hit.row).forEach(r => setRowChecked(r, target));
      suppressClickOn = hit.cb;
      lastClicked = { tbody: hit.tbody, row: hit.row };
      return;
    }

    // Bắt đầu kéo: tự đảo trạng thái dòng đầu ngay khi bấm
    e.preventDefault(); // tránh bôi đen chữ khi kéo
    const target = !hit.cb.checked;
    setRowChecked(hit.row, target);
    suppressClickOn = hit.cb;
    lastClicked = { tbody: hit.tbody, row: hit.row };
    drag = { tbody: hit.tbody, target, startRow: hit.row };
    document.documentElement.classList.add('bhyt-qs-dragging');
  }, true);

  document.addEventListener('mouseover', function (e) {
    if (!drag) return;
    if (!(e.buttons & 1)) { endDrag(); return; }
    const row = e.target.closest && e.target.closest('tr.jqgrow');
    if (!row || row.parentElement !== drag.tbody) return;
    // Áp dụng cho cả khoảng từ dòng đầu tới dòng hiện tại (phòng khi kéo nhanh bỏ sót dòng)
    rowsBetween(drag.tbody, drag.startRow, row).forEach(r => setRowChecked(r, drag.target));
    lastClicked = { tbody: drag.tbody, row };
  }, true);

  document.addEventListener('mouseup', endDrag, true);
  window.addEventListener('blur', endDrag);

  // Chặn click gốc của trình duyệt trên ô đã xử lý ở mousedown (tránh bị đảo 2 lần)
  document.addEventListener('click', function (e) {
    if (synthetic || !suppressClickOn) return;
    const hit = getCheckboxCell(e.target);
    if (hit && hit.cb === suppressClickOn) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
    suppressClickOn = null;
  }, true);

  // ===== Nút "Chọn tất cả" =====
  // Lưới có cột ô tích (multiselect)
  function isMultiselectGrid(g) {
    return !!g.querySelector('input.cbox[type="checkbox"]');
  }

  function gridBody(g) {
    const row = g.querySelector('table.ui-jqgrid-btable tr.jqgrow');
    return row ? row.parentElement : g.querySelector('table.ui-jqgrid-btable > tbody');
  }

  // Từ chữ "Thời gian kê", đi ngược lên tìm khối gần nhất có lưới multiselect (cùng tab).
  function findGridNearLabel(label) {
    for (let el = label.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      const grids = Array.from(el.querySelectorAll('.ui-jqgrid')).filter(isMultiselectGrid);
      if (grids.length) {
        return grids.find(g => /chi\s*ti[eế]t/i.test(g.querySelector('.ui-jqgrid-title')?.textContent || ''))
          || grids[grids.length - 1];
      }
    }
    return null;
  }

  function visibleRows(tbody) {
    return Array.from(tbody.querySelectorAll(':scope > tr.jqgrow'))
      .filter(r => r.style.display !== 'none' && getRowCheckbox(r) && !getRowCheckbox(r).disabled);
  }

  function findThoiGianKeLabels() {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (/^\s*Th[oờ]i gian k[eê]\s*:?\s*$/i.test(n.nodeValue || '') && n.parentElement) out.push(n.parentElement);
    }
    return out;
  }

  function updateBtn(btn) {
    const g = btn.__bhytGrid;
    const tbody = g && g.isConnected ? gridBody(g) : null;
    const rows = tbody ? visibleRows(tbody) : [];
    const allChecked = rows.length > 0 && rows.every(r => getRowCheckbox(r).checked);
    const text = allChecked ? 'Bỏ chọn tất cả' : 'Chọn tất cả';
    if (btn.textContent !== text) btn.textContent = text;
    btn.disabled = rows.length === 0;
  }

  function makeBtn(grid, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bhyt-qs-select-all' + (extraClass ? ' ' + extraClass : '');
    btn.textContent = 'Chọn tất cả';
    btn.__bhytGrid = grid;
    grid.__bhytHasSelectAll = true;
    btn.addEventListener('mousedown', e => e.stopPropagation());
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      const tbody = gridBody(grid);
      if (!tbody) return;
      const rows = visibleRows(tbody);
      const target = !rows.every(r => getRowCheckbox(r).checked);
      rows.forEach(r => setRowChecked(r, target));
      updateBtn(btn);
    });
    return btn;
  }

  function ensureButtons() {
    // 1) Cạnh chữ "Thời gian kê" ở mỗi tab
    findThoiGianKeLabels().forEach(label => {
      if (label.__bhytQsDone) return;
      const grid = findGridNearLabel(label);
      if (!grid) return;
      label.__bhytQsDone = true;
      label.parentNode.insertBefore(makeBtn(grid), label);
    });
    // 2) Lưới multiselect nào chưa có nút (tab không có "Thời gian kê") -> đặt trên thanh tiêu đề lưới
    document.querySelectorAll('.ui-jqgrid').forEach(g => {
      if (g.__bhytHasSelectAll || !isMultiselectGrid(g)) return;
      const bar = g.querySelector('.ui-jqgrid-titlebar');
      if (!bar) return;
      const title = bar.querySelector('.ui-jqgrid-title');
      const btn = makeBtn(g, 'bhyt-qs-in-title');
      if (title) title.after(btn); else bar.appendChild(btn);
    });
    document.querySelectorAll('.bhyt-qs-select-all').forEach(updateBtn);
  }

  ensureButtons();
  setInterval(ensureButtons, 800);

  const style = document.createElement('style');
  style.textContent =
    '.bhyt-qs-select-all { margin-right: 12px; padding: 5px 14px; font-weight: bold; cursor: pointer;' +
    ' background: #1565c0; color: #fff; border: 1px solid #0d47a1; border-radius: 4px; vertical-align: middle; }' +
    '.bhyt-qs-select-all:hover:not(:disabled) { background: #0d47a1; }' +
    '.bhyt-qs-select-all:disabled { opacity: .5; cursor: default; }' +
    '.bhyt-qs-select-all.bhyt-qs-in-title { margin: 0 0 0 12px; padding: 1px 10px; font-size: 12px;' +
    ' background: #fff; color: #0d47a1; border-color: #fff; }' +
    '.bhyt-qs-select-all.bhyt-qs-in-title:hover:not(:disabled) { background: #e3f2fd; }' +
    '.bhyt-qs-dragging, .bhyt-qs-dragging * { user-select: none !important; cursor: row-resize !important; }' +
    '.ui-jqgrid-btable tr.jqgrow td[aria-describedby$="_cb"] { cursor: pointer; }';
  (document.head || document.documentElement).appendChild(style);
})();
