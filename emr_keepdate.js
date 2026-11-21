// Trang "Đồng bộ hồ sơ bệnh án sang EMR" (sync-send-xml-emr-*):
// mỗi lần chuyển tab (DS BN sẵn sàng / Đã gửi / Log gửi / Log hủy) HIS tự đặt Từ ngày - Đến ngày về HÔM NAY rồi tải danh sách.
// Script này (chạy trong MAIN world) bọc hàm chuyển tab của HIS: trong lúc hàm đó chạy, bỏ qua lệnh đặt lại 2 ô ngày
// -> giữ nguyên ngày người dùng đã chọn và danh sách được tải theo đúng ngày đó.
(function () {
  if (window.__bhytEmrKeepDate) return;
  window.__bhytEmrKeepDate = true;

  const DATE_IDS = ['tungay', 'denngay'];

  function wrapTabs() {
    const $ = window.jQuery;
    if (!$ || !$._data) return false;
    const anchors = document.querySelectorAll('#tabs a[data-toggle="tab"], a[data-toggle="tab"][href^="#tabs-"]');
    if (!anchors.length) return false;
    let wrapped = 0;
    anchors.forEach(a => {
      const ev = $._data(a, 'events');
      const list = ev && ev.shown;
      if (!list || !list.length) return;
      list.forEach(h => {
        if (h.__bhytKeepDate) { wrapped++; return; }
        const orig = h.handler;
        h.handler = function () {
          const origVal = $.fn.val;
          // Chặn lệnh ghi giá trị vào ô Từ ngày / Đến ngày trong lúc HIS xử lý chuyển tab
          $.fn.val = function (v) {
            if (arguments.length && this.length && DATE_IDS.includes(this[0].id)) return this;
            return origVal.apply(this, arguments);
          };
          try { return orig.apply(this, arguments); }
          finally { $.fn.val = origVal; }
        };
        h.__bhytKeepDate = true;
        wrapped++;
      });
    });
    return wrapped > 0;
  }

  // HIS gắn sự kiện sau khi trang tải xong -> thử lại vài lần
  let tries = 0;
  const t = setInterval(() => {
    if (wrapTabs() || ++tries > 40) clearInterval(t);
  }, 500);
})();
