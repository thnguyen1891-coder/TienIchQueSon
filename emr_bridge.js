// Cầu nối (isolated world) trên trang "Đồng bộ EMR" của HIS: emr_batch.js (MAIN world) không gọi được
// chrome.runtime -> gửi yêu cầu qua window.postMessage, script này chuyển cho background và trả kết quả về.
(function () {
  if (window.top !== window || window.__bhytEmrBridge) return;
  window.__bhytEmrBridge = true;
  window.addEventListener('message', e => {
    const d = e.data;
    if (e.source !== window || !d || d.__bhytEmrReq !== true || d.type !== 'EMR_LOOKUP_SO_LUU_TRU') return;
    try {
      chrome.runtime.sendMessage({ type: 'EMR_LOOKUP_SO_LUU_TRU', maBas: d.maBas }, res => {
        const err = chrome.runtime.lastError;
        window.postMessage({ __bhytEmrRes: true, id: d.id, res: err ? { success: false, message: err.message } : res }, '*');
      });
    } catch (err) {
      window.postMessage({ __bhytEmrRes: true, id: d.id, res: { success: false, message: 'Tiện ích vừa được cập nhật - bấm F5 để tải lại trang.' } }, '*');
    }
  });
})();
