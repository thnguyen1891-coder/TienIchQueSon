// KSK ký lại — chạy trong MAIN world của csdlyte.danang.gov.vn.
// Khi ksk_csdlyte.js đang chạy hàng loạt (cờ sessionStorage), tự trả lời OK cho đúng các hộp confirm
// của quy trình: "Hủy đánh dấu Đã liên thông…", "Đẩy hồ sơ #… lên Cổng Bộ Y tế?", xác nhận ký số.
// Hộp hỏi XÓA hồ sơ (câu hỏi bắt đầu bằng "Xóa/Xoá") KHÔNG bao giờ được tự động đồng ý.
(() => {
  const FLAG = '__tiq_ksk_autoconfirm';
  const ALLOW = /^\s*(Hủy đánh dấu|Huỷ đánh dấu|Đẩy hồ sơ|Đẩy \d+ hồ sơ|Liên thông|Ký số)/i;
  const DENY = /^\s*(Xóa|Xoá)/i;
  const origConfirm = window.confirm;
  window.confirm = function (msg) {
    const m = String(msg || '');
    try {
      if (sessionStorage.getItem(FLAG) === '1' && ALLOW.test(m) && !DENY.test(m)) return true;
    } catch (e) { /* bỏ qua */ }
    return origConfirm.call(window, msg);
  };
})();
