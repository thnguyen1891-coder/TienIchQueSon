// Cầu nối (isolated world) cho script MAIN world của "Đồng bộ lại hồ sơ": đọc / ghi danh sách chung
// (chrome.storage.local -> bhytResyncQueue) qua window.postMessage.
(function () {
  if (window.top !== window || window.__bhytRsBridge) return;
  window.__bhytRsBridge = true;
  const KEY = 'bhytResyncQueue';
  window.addEventListener('message', e => {
    const d = e.data;
    if (e.source !== window || !d || d.__bhytRsReq !== true) return;
    const reply = res => window.postMessage({ __bhytRsRes: true, id: d.id, res }, '*');
    try {
      if (d.op === 'get') chrome.storage.local.get(KEY, r => reply({ queue: r[KEY] || [] }));
      else if (d.op === 'set') chrome.storage.local.set({ [KEY]: d.queue || [] }, () => reply({ ok: true }));
      // Khoá khác (chỉ các khoá bhyt*) - VD bhytLog130 (mã giao dịch -> bệnh nhân)
      else if (d.op === 'kget' && /^bhyt\w+$/.test(d.key)) chrome.storage.local.get(d.key, r => reply({ value: r[d.key] }));
      else if (d.op === 'kset' && /^bhyt\w+$/.test(d.key)) chrome.storage.local.set({ [d.key]: d.value }, () => reply({ ok: true }));
      // Tra khoa của hồ sơ trên checkxml (qua background, chỉ đọc)
      else if (d.op === 'cxKhoa') chrome.runtime.sendMessage({ type: 'CX_KHOA', maLKs: d.value }, r => reply(chrome.runtime.lastError ? { error: chrome.runtime.lastError.message } : (r || {})));
      else reply({ error: 'op?' });
    } catch (err) { reply({ error: 'Tiện ích vừa cập nhật - bấm F5 để tải lại trang.' }); }
  });
})();
