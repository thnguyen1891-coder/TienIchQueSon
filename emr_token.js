// Chạy trên emr.vncare.vn: lưu phiên đăng nhập EMR (token) vào bộ nhớ của tiện ích,
// để trang "Đồng bộ EMR" bên HIS tra được SỐ LƯU TRỮ (HIS không lưu số này).
// Token chỉ nằm trong máy (chrome.storage.local), chỉ dùng để GỌI TÌM KIẾM hồ sơ trên API EMR.
(function () {
  if (window.top !== window) return;
  function save() {
    let tok = null;
    try { tok = JSON.parse(localStorage.getItem('jhi-authenticationtoken') || 'null'); } catch (_) {}
    if (!tok || typeof tok !== 'string') return;
    chrome.storage.local.get('emrToken', d => {
      if (d.emrToken !== tok) chrome.storage.local.set({ emrToken: tok, emrTokenAt: Date.now() });
    });
  }
  save();
  setInterval(save, 60000); // EMR tự làm mới token -> cập nhật theo
})();
