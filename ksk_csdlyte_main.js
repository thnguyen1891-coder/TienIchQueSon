// KSK ký lại — chạy trong MAIN world của csdlyte.danang.gov.vn.
// Khi ksk_csdlyte.js đang chạy hàng loạt (cờ sessionStorage), tự trả lời OK cho hộp confirm
// "Hủy đánh dấu Đã liên thông" / liên thông / ký số — để trình duyệt không bị chặn bởi hộp thoại.
// Các hộp confirm khác (vd. Xóa hồ sơ) KHÔNG bị tự động đồng ý.
(() => {
  const FLAG = '__tiq_ksk_autoconfirm';
  const origConfirm = window.confirm;
  window.confirm = function (msg) {
    try {
      if (sessionStorage.getItem(FLAG) === '1' && /liên thông|ký số|đẩy lại|Cổng/i.test(String(msg || '')) && !/xóa|xoá/i.test(String(msg || ''))) {
        return true;
      }
    } catch (e) { /* bỏ qua */ }
    return origConfirm.call(window, msg);
  };
})();
