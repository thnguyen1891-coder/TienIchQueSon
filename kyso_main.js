// Chạy trong MAIN world của trang bảng kê: đọc vị trí chữ trong PDF đang mở ở trình ký SmartCA V2
// (biến smartcaV2PDF / smartcaV2Configs của HIS), trả về cho kyso_hangloat.js qua window.postMessage.
(function () {
  if (window.__bhytKshMainLoaded) return;
  window.__bhytKshMainLoaded = true;

  function getPdf() {
    try { return typeof smartcaV2PDF !== 'undefined' ? smartcaV2PDF : window.smartcaV2PDF; } catch (_) { return null; }
  }
  function getCfg() {
    try { return typeof smartcaV2Configs !== 'undefined' ? smartcaV2Configs : window.smartcaV2Configs; } catch (_) { return null; }
  }

  const handlers = {
    // Trả về các dòng chữ (khớp 1 trong các regex) ở mọi trang, kèm tỉ lệ hiển thị và kích thước trang
    async pdfText(args) {
      const pdf = getPdf();
      const cfg = getCfg();
      if (!pdf || !cfg) throw new Error('Chưa mở được tài liệu PDF trong trình ký');
      const res = (args.patterns || []).map(p => new RegExp(p, 'i'));
      const hits = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const tc = await page.getTextContent();
        tc.items.forEach(it => {
          const s = String(it.str || '').normalize('NFC');
          if (res.some(r => r.test(s))) {
            hits.push({ page: n, s, x: it.transform[4], y: it.transform[5], w: it.width || 0, fs: Math.abs(it.transform[3]) || it.height || 10 });
          }
        });
      }
      const pages = (cfg.pageArray || []).map(p => ({ n: p.pageNumber, h: p.defaultHeight, w: p.defaultWidth }));
      return { scale: cfg.scale, currentPage: cfg.currentPage, totalPage: cfg.totalPage, pages, hits };
    },

    // Đặt khung chữ ký của vai trò tới (left, top) bằng đúng hàm "kéo thả xong" của HIS (jQuery UI draggable stop),
    // dùng khi kéo thả bằng chuột giả lập không ăn.
    placeSignature(args) {
      const $ = window.jQuery;
      const re = new RegExp(args.roleRe, 'i');
      const wraps = Array.from(document.querySelectorAll(`#smartcav2-plugin-pdf-viewer-${args.page} .smartcav2-plugin-signature-wrapper`))
        .filter(w => re.test((w.textContent || '').normalize('NFC')));
      const w = (args.id && document.getElementById(args.id)) || wraps.pop();
      if (!w || !$) throw new Error('Không thấy khung chữ ký để đặt vị trí');
      const inst = $(w).data('draggable') || $(w).data('uiDraggable') || $(w).data('ui-draggable');
      w.style.left = args.left + 'px';
      w.style.top = args.top + 'px';
      if (inst && inst.options && typeof inst.options.stop === 'function') {
        inst.options.stop(null, { helper: $(w), position: { left: args.left, top: args.top } });
      }
      let saved = null;
      try {
        const id = (w.id || '').replace('smartcav2-plugin-signature-', '');
        const arr = typeof signatureInCanvas !== 'undefined' ? signatureInCanvas : window.signatureInCanvas;
        const s = arr && arr.find(x => String(x.idSign) === id);
        if (s) saved = { left: s.left, top: s.top, page: s.page };
      } catch (_) {}
      return { left: parseFloat(w.style.left), top: parseFloat(w.style.top), saved };
    }
  };

  window.addEventListener('message', async e => {
    const d = e.data;
    if (e.source !== window || !d || d.__bhytKsh !== 'req' || !handlers[d.cmd]) return;
    try {
      const result = await handlers[d.cmd](d.args || {});
      window.postMessage({ __bhytKsh: 'res', id: d.id, result }, '*');
    } catch (err) {
      window.postMessage({ __bhytKsh: 'res', id: d.id, error: String(err && err.message || err) }, '*');
    }
  });
})();
