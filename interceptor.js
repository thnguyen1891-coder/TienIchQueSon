// =========================================================================
// BHYT EXTENSION - MAIN WORLD INTERCEPTOR
// Chạy trong Main World tại document_start để triệt tiêu toàn bộ popup
// cảnh báo lỗi Cổng BHXH của VNPT HIS và chặn HIS gọi check trùng lặp
// =========================================================================

(function () {
  'use strict';

  const path = (window.location.pathname || '').toLowerCase();
  const href = (window.location.href || '').toLowerCase();

  // BỎ QUA HOÀN TOÀN TRANG KIỂM TRA BẢNG KÊ KHÔNG BHYT (kiemtrabangke_khongbhyt) THEO YÊU CẦU: GIỮ NGUYÊN 100% THEO MẶC ĐỊNH CỦA HIS
  // VÀ CÁC TRANG KHÁM BỆNH (khambenhcapcuu, khambenhngoaitru, khambenhBANT, khambenhnoitru), BÁO CÁO / THỐNG KÊ / VIỆN PHÍ / DƯỢC / CLS / SMARTCA / KÝ SỐ / HỒ SƠ BỆNH ÁN ĐIỆN TỬ (EMR)
  const isExcludedPage =
    path.includes('ho-so-benh-an-dien-tu') || href.includes('ho-so-benh-an-dien-tu') ||
    path.includes('hosobenhandientu') || href.includes('hosobenhandientu') ||
    path.includes('hosobenhan') || href.includes('hosobenhan') ||
    path.includes('ho-so-benh-an') || href.includes('ho-so-benh-an') ||
    path.includes('benhandientu') || href.includes('benhandientu') ||
    path.includes('benh-an-dien-tu') || href.includes('benh-an-dien-tu') ||
    path.includes('emr') || href.includes('emr') ||
    path.includes('kiemtrabangke_khongbhyt') || href.includes('kiemtrabangke_khongbhyt') ||
    path.includes('khongbhyt') || href.includes('khongbhyt') ||
    path.includes('khong_bhyt') || href.includes('khong_bhyt') ||
    path.includes('khambenhcapcuu') || href.includes('khambenhcapcuu') ||
    path.includes('khambenhngoaitru') || href.includes('khambenhngoaitru') ||
    path.includes('khambenhnoitru') || href.includes('khambenhnoitru') ||
    path.includes('baocaotiepnhan') || href.includes('baocaotiepnhan') ||
    path.includes('baocao_tiepnhan') || href.includes('baocao_tiepnhan') ||
    path.includes('baocao') ||
    path.includes('thongke') ||
    path.includes('vienphi') ||
    path.includes('duoc') ||
    path.includes('khoaduoc') ||
    path.includes('cls') ||
    path.includes('canlamsang') ||
    path.includes('smartca') || href.includes('smartca') ||
    path.includes('kyso') || href.includes('kyso') ||
    path.includes('chuky') || href.includes('chuky') ||
    path.includes('casign') || href.includes('casign') ||
    path.includes('vnptca') || href.includes('vnptca');

  if (isExcludedPage) {
    console.log('[BHYT Extension Main World] Bỏ qua trang (giữ nguyên mặc định HIS theo yêu cầu):', path);
    return;
  }

  console.log('[BHYT Extension] Main World Interceptor đã nạp tại document_start trên trang:', path);

  // Kiểm tra chính xác thông báo lỗi kết nối Cổng BHXH từ HIS (tránh xóa nhầm các nội dung thông thường)
  function isHisGatewayError(text) {
    if (!text) return false;
    const str = String(text).toLowerCase();
    const hasGateway =
      str.includes('cổng bhxh') ||
      str.includes('cổng tiếp nhận') ||
      str.includes('cong bhxh') ||
      str.includes('cong tiep nhan');
    const hasError =
      str.includes('lỗi') ||
      str.includes('loi') ||
      str.includes('không trả về dữ liệu') ||
      str.includes('khong tra ve du lieu') ||
      str.includes('liên hệ bộ phận cntt') ||
      str.includes('lien he bo phan cntt') ||
      str.includes('thất bại') ||
      str.includes('that bai') ||
      str.includes('không lấy được dữ liệu') ||
      str.includes('khong lay duoc du lieu') ||
      str.includes('không kết nối') ||
      str.includes('khong ket noi') ||
      str.includes('bị lỗi') ||
      str.includes('bi loi');
    return hasGateway && hasError;
  }

  // -----------------------------------------------------------------------
  // 1. Chặn window.alert của trình duyệt
  // -----------------------------------------------------------------------
  const _origAlert = window.alert;
  window.alert = function (msg) {
    if (isHisGatewayError(msg)) {
      console.log('[BHYT Extension Main World] Đã triệt tiêu window.alert lỗi của HIS:', msg);
      return;
    }
    return _origAlert.apply(this, arguments);
  };

  // -----------------------------------------------------------------------
  // 2. Chặn window.jAlert và window.hiAlert (kể cả khi HIS gán sau này)
  // -----------------------------------------------------------------------
  function createAlertHook(propName) {
    let currentFn = window[propName];

    function wrapAlert(fn) {
      if (!fn || fn._bhytHooked) return fn;
      const wrapped = function (msg, title, callback) {
        if (isHisGatewayError(msg) || isHisGatewayError(title)) {
          console.log(`[BHYT Extension Main World] Đã triệt tiêu ${propName} lỗi của HIS:`, msg);
          if (typeof callback === 'function') {
            try { callback(true); } catch (e) {}
          }
          return;
        }
        return fn.apply(this, arguments);
      };
      wrapped._bhytHooked = true;
      return wrapped;
    }

    if (currentFn) {
      currentFn = wrapAlert(currentFn);
    }

    try {
      Object.defineProperty(window, propName, {
        configurable: true,
        enumerable: true,
        get: () => currentFn,
        set: (newFn) => {
          currentFn = typeof newFn === 'function' ? wrapAlert(newFn) : newFn;
        }
      });
    } catch (e) {
      // Fallback nếu không defineProperty được
      setInterval(() => {
        if (window[propName] && !window[propName]._bhytHooked) {
          window[propName] = wrapAlert(window[propName]);
        }
      }, 300);
    }
  }

  createAlertHook('jAlert');
  createAlertHook('hiAlert');

  // -----------------------------------------------------------------------
  // 3. Định kỳ kiểm tra và hook jQuery.alerts, $.messager, bootbox, swal
  // -----------------------------------------------------------------------
  function hookThirdPartyAlerts() {
    // 3.1. jQuery.alerts.alert
    if (window.jQuery && window.jQuery.alerts && !window.jQuery.alerts._bhytHooked) {
      const _orig = window.jQuery.alerts.alert;
      window.jQuery.alerts.alert = function (msg, title, callback) {
        if (isHisGatewayError(msg) || isHisGatewayError(title)) {
          console.log('[BHYT Extension Main World] Đã triệt tiêu jQuery.alerts.alert lỗi của HIS:', msg);
          if (typeof callback === 'function') {
            try { callback(true); } catch (e) {}
          }
          return;
        }
        return _orig.apply(this, arguments);
      };
      window.jQuery.alerts._bhytHooked = true;
    }

    // 3.2. $.messager.alert (jQuery EasyUI)
    if (window.$ && window.$.messager && window.$.messager.alert && !window.$.messager.alert._bhytHooked) {
      const _orig = window.$.messager.alert;
      window.$.messager.alert = function (title, msg, icon, fn) {
        if (isHisGatewayError(msg) || isHisGatewayError(title)) {
          console.log('[BHYT Extension Main World] Đã triệt tiêu $.messager.alert lỗi của HIS:', msg || title);
          if (typeof fn === 'function') {
            try { fn(); } catch (e) {}
          }
          return;
        }
        // BẮT SỰ KIỆN LƯU / CẬP NHẬT THÀNH CÔNG TỪ VNPT HIS
        try {
          const fullMsg = `${title || ''} ${msg || ''}`.toLowerCase();
          if (fullMsg.includes('thành công') || fullMsg.includes('thanh cong')) {
            console.log('[BHYT Extension Main World] Phát hiện $.messager.alert Lưu/Cập nhật thành công:', msg || title);
            const evt = new CustomEvent('bhyt-ext-save-success', { detail: { message: msg || title || 'Lưu thành công!' } });
            window.dispatchEvent(evt);
            document.dispatchEvent(evt);
          }
        } catch (e) {}

        return _orig.apply(this, arguments);
      };
      window.$.messager.alert._bhytHooked = true;
    }

    // 3.2b. $.messager.show (jQuery EasyUI)
    if (window.$ && window.$.messager && window.$.messager.show && !window.$.messager.show._bhytHooked) {
      const _origShow = window.$.messager.show;
      window.$.messager.show = function (options) {
        try {
          const fullMsg = `${options?.title || ''} ${options?.msg || ''}`.toLowerCase();
          if (fullMsg.includes('thành công') || fullMsg.includes('thanh cong')) {
            console.log('[BHYT Extension Main World] Phát hiện $.messager.show Lưu/Cập nhật thành công:', options?.msg || options?.title);
            const evt = new CustomEvent('bhyt-ext-save-success', { detail: { message: options?.msg || options?.title || 'Lưu thành công!' } });
            window.dispatchEvent(evt);
            document.dispatchEvent(evt);
          }
        } catch (e) {}
        return _origShow.apply(this, arguments);
      };
      window.$.messager.show._bhytHooked = true;
    }

    // 3.3. bootbox.alert
    if (window.bootbox && window.bootbox.alert && !window.bootbox.alert._bhytHooked) {
      const _orig = window.bootbox.alert;
      window.bootbox.alert = function (options, cb) {
        const msg = typeof options === 'string' ? options : options?.message;
        if (isHisGatewayError(msg)) {
          console.log('[BHYT Extension Main World] Đã triệt tiêu bootbox.alert lỗi của HIS:', msg);
          const callback = typeof options === 'object' ? options.callback : cb;
          if (typeof callback === 'function') {
            try { callback(); } catch (e) {}
          }
          return;
        }
        return _orig.apply(this, arguments);
      };
      window.bootbox.alert._bhytHooked = true;
    }

    // 3.4. swal / Swal (SweetAlert)
    const swalObj = window.swal || window.Swal;
    if (swalObj && !swalObj._bhytHooked) {
      const _orig = swalObj;
      const wrapped = function () {
        const firstArg = arguments[0];
        const msg = typeof firstArg === 'string' ? firstArg : firstArg?.text || firstArg?.title || '';
        if (isHisGatewayError(msg)) {
          console.log('[BHYT Extension Main World] Đã triệt tiêu swal lỗi của HIS:', msg);
          return Promise.resolve({ isConfirmed: true, value: true });
        }
        return _orig.apply(this, arguments);
      };
      wrapped._bhytHooked = true;
      if (window.swal) window.swal = wrapped;
      if (window.Swal) window.Swal = wrapped;
    }
  }

  hookThirdPartyAlerts();
  let thirdPartyHookAttempts = 0;
  const thirdPartyTimer = setInterval(() => {
    hookThirdPartyAlerts();
    thirdPartyHookAttempts++;
    if (thirdPartyHookAttempts >= 8 || (window.jQuery?.alerts?._bhytHooked && window.$.messager?.alert?._bhytHooked)) {
      clearInterval(thirdPartyTimer);
    }
  }, 500);

  // -----------------------------------------------------------------------
  // 4. Bắt và triệt tiêu ngay lập tức bất kỳ Modal / Dialog lỗi Cổng BHXH
  //    (CHỈ KÍCH HOẠT TRÊN TRANG TIẾP NHẬN - BẢO VỆ 100% HIỆU NĂNG CHO KHÁM BỆNH)
  // -----------------------------------------------------------------------
  const isTiepNhanPage = (path.includes('tiepnhan') || path.includes('tiep_nhan') || path.includes('tiep-nhan') || path.includes('tiepdon')) && !path.includes('khambenh') && !href.includes('khambenh');
  const isKhongBhyt = path.includes('kiemtrabangke_khongbhyt') || href.includes('kiemtrabangke_khongbhyt') || path.includes('khongbhyt') || href.includes('khongbhyt');
  const isBangKePage = !isKhongBhyt && (path.includes('kiemtrabangke') || path.includes('kiemtra_bangke') || href.includes('kiemtrabangke') || path.includes('kiemtrabangkenoitru') || path.includes('kiemtrabangkebannt'));

  if (isTiepNhanPage) {
    const domObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType === 1) { // ELEMENT_NODE
            const isModal =
              node.id === 'popup_container' ||
              node.classList?.contains('jAlert') ||
              node.classList?.contains('modal') ||
              node.classList?.contains('messager-window') ||
              node.classList?.contains('ui-dialog') ||
              node.getAttribute?.('role') === 'dialog' ||
              (node.tagName === 'DIV' && (node.id?.includes('popup') || node.className?.includes('Alert')));

            if (isModal) {
              const nodeClassId = `${node.id || ''} ${node.className || ''}`.toLowerCase();
              const txt = (node.textContent || '').toLowerCase();
              // BẢO VỆ TUYỆT ĐỐI SMARTCA / KÝ SỐ: Hoạt động 100% mặc định theo HIS, tiện ích tuyệt đối không can thiệp
              if (nodeClassId.includes('smartca') || nodeClassId.includes('kyso') || nodeClassId.includes('chuky') || txt.includes('smartca') || txt.includes('ký số') || txt.includes('chữ ký')) {
                continue;
              }
              if (isHisGatewayError(txt)) {
                console.log('[BHYT Extension Main World] Phát hiện popup lỗi của HIS vừa thêm -> xóa ngay:', node);
                try { node.remove(); } catch (e) { node.style.display = 'none'; }
                document.querySelectorAll('#popup_overlay, .modal-backdrop, .blockOverlay').forEach((o) => {
                  try { o.remove(); } catch (err) { o.style.display = 'none'; }
                });
              }
            }
          }
        }
      }
    });

    if (document.documentElement) {
      domObserver.observe(document.documentElement, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        domObserver.observe(document.documentElement || document.body, { childList: true, subtree: true });
      });
    }
  }

  // -----------------------------------------------------------------------
  // 5. Xử lý quét QR CCCD & đồng bộ dữ liệu vào Form bằng jQuery trong Main World
  //    (CHỈ KÍCH HOẠT TRÊN TRANG TIẾP NHẬN BỆNH NHÂN)
  // -----------------------------------------------------------------------
  let isInternalFieldSync = false;
  let isApplyingQr = false;
  let qrInputTimer = null;

  function isCompleteQrCccd(raw) {
    if (!raw || typeof raw !== 'string') return false;
    const s = raw.replace(/[\r\n]+/g, '').trim();
    if (!s.includes('|')) return false;
    const parts = s.split('|');
    // Chuẩn CCCD Bộ Công An có ít nhất 7 trường: CCCD|CMND|Họ tên|Ngày sinh|Giới tính|Địa chỉ|Ngày cấp...
    if (parts.length < 7) return false;
    const cccd = (parts[0] || '').trim();
    const hoTen = (parts[2] || '').trim();
    const dob = (parts[3] || '').trim();
    const address = (parts[5] || '').trim();
    const ngayCap = (parts[6] || '').trim();
    const currentYear = new Date().getFullYear();
    let isValidDob = false;
    if (/^\d{8}$/.test(dob)) {
      const y1 = parseInt(dob.substring(4, 8), 10);
      const y2 = parseInt(dob.substring(0, 4), 10);
      isValidDob = (y1 >= 1900 && y1 <= currentYear) || (y2 >= 1900 && y2 <= currentYear);
    } else if (/^\d{4}$/.test(dob)) {
      const y = parseInt(dob, 10);
      isValidDob = (y >= 1900 && y <= currentYear);
    }
    const isValidNgayCap = /^\d{8}$/.test(ngayCap) || /^\d{2}\/\d{2}\/\d{4}$/.test(ngayCap);
    return /^\d{9,12}$/.test(cccd) && hoTen.length >= 2 && isValidDob && address.length >= 2 && isValidNgayCap;
  }

  function isCompleteQrTheGiayBhyt(raw) {
    if (!raw || typeof raw !== 'string') return false;
    const s = raw.replace(/[\r\n]+/g, '').trim();
    if (!s.includes('|')) return false;
    const parts = s.split('|');
    if (parts.length < 5) return false;
    const f0 = (parts[0] || '').trim();
    const f1 = (parts[1] || '').trim();
    if (s.endsWith('$')) return true;
    const isMaTheBhyt = /^[A-Z]{2}[1-9]\d{2}\d{12}$/i.test(f0) || /^[A-Z]{2}\d{15}$/i.test(f0) || /^[A-Z]{2}[1-9]\d{2}\d{10}$/i.test(f0) || /^[A-Z]{2}\d{13}$/i.test(f0) || /^[A-Z]{2}\d{8,15}$/i.test(f0);
    const isHexName = /^[0-9a-fA-F]{4,}$/.test(f1) && f1.length % 2 === 0;
    return Boolean(isMaTheBhyt || isHexName);
  }

  function isAnyCompleteQr(raw) {
    return isCompleteQrCccd(raw) || isCompleteQrTheGiayBhyt(raw);
  }

  function applyQrCccdInMainWorld(cleanRaw) {
    if (isApplyingQr) return;
    if (!cleanRaw || !cleanRaw.includes('|')) return;
    const clean = String(cleanRaw).replace(/[\r\n]+/g, '').trim();
    const parts = clean.split('|');
    if (parts.length < 6) return;

    isApplyingQr = true;
    isInternalFieldSync = true;

    try {
      const soCccd = (parts[0] || '').trim();
      const soCmnd = (parts[1] || '').trim();
      const hoTen = (parts[2] || '').trim().toUpperCase();
      const rawDob = (parts[3] || '').trim();
      const rawGender = (parts[4] || '').trim();
      const rawAddress = (parts[5] || '').trim();

      const currentYear = new Date().getFullYear();
      let formattedDob = rawDob;
      if (/^\d{8}$/.test(rawDob)) {
        const p1 = parseInt(rawDob.substring(0, 4), 10);
        const p2 = parseInt(rawDob.substring(4, 8), 10);
        if (p2 >= 1900 && p2 <= currentYear) {
          formattedDob = `${rawDob.substring(0, 2)}/${rawDob.substring(2, 4)}/${rawDob.substring(4, 8)}`;
        } else if (p1 >= 1900 && p1 <= currentYear) {
          formattedDob = `${rawDob.substring(6, 8)}/${rawDob.substring(4, 6)}/${rawDob.substring(0, 4)}`;
        } else {
          formattedDob = `${rawDob.substring(0, 2)}/${rawDob.substring(2, 4)}/${rawDob.substring(4, 8)}`;
        }
      } else if (/^\d{4}$/.test(rawDob)) {
        const y = parseInt(rawDob, 10);
        if (y >= 1900 && y <= currentYear) {
          formattedDob = rawDob;
        } else {
          formattedDob = '';
        }
      } else if (rawDob.includes('/')) {
        const dParts = rawDob.split('/');
        const y = parseInt(dParts[dParts.length - 1], 10);
        if (y >= 1900 && y <= currentYear) {
          formattedDob = rawDob;
        } else {
          formattedDob = '';
        }
      } else {
        formattedDob = '';
      }

      console.log('[BHYT Extension Main World] Nhận dạng & điền dữ liệu QR CCCD:', { soCccd, hoTen, formattedDob });

      const $ = window.$ || window.jQuery;
      if ($) {
        // 1. Số CCCD: Gán số 12 chữ số sạch vào #socmt (gỡ bỏ chuỗi quét dài)
        const $cccd = $('#socmt, input[name="socmt"], #so_cccd, #socccd');
        if ($cccd.length) {
          $cccd.val(soCccd);
        }

        // 2. Họ và tên
        if (hoTen) {
          const $ht = $('#hoten, input[name="hoten"], #tenbn');
          if ($ht.length) {
            $ht.val(hoTen);
          }
        }

        // 3. Checkbox Năm sinh: uncheck nếu có ngày sinh đầy đủ
        if (formattedDob.length === 10) {
          const $chk = $('#chinamsinh, input[name="chinamsinh"]');
          if ($chk.length) {
            $chk.prop('checked', false).removeAttr('checked');
          }
        }

        // 4. Ngày sinh (*): Gán trực tiếp qua jQuery trong Main World
        if (formattedDob) {
          const setNs = () => {
            const $ns = $('#namsinh, input[name="namsinh"]');
            if ($ns.length) {
              $ns.removeAttr('maxlength');
              $ns.val(formattedDob);
            }
          };
          setNs();
          [50, 150, 300, 600, 1000].forEach((delay) => {
            setTimeout(setNs, delay);
          });
        }

        // 5. Giới tính
        if (rawGender) {
          const isNam = rawGender.toLowerCase().includes('nam') || rawGender === '1';
          $('#gioitinh').val(isNam ? '1' : '0');
          $('#cbgioitinh').val(isNam ? 'true' : 'false');
        }

        // 6. Địa chỉ
        if (rawAddress) {
          $('#diachi, input[name="diachi"], #dia_chi').val(rawAddress);
        }

        // 7. Thông tin cha, mẹ, người liên hệ (áp dụng cho thẻ CCCD trẻ em)
        const isRealName = (s) => Boolean(s && s.length >= 3 && !/^\d+$/.test(s) && !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s));
        let hoTenCha = '';
        let hoTenMe = '';
        for (let pIdx = 7; pIdx < parts.length; pIdx++) {
          const pVal = (parts[pIdx] || '').trim().toUpperCase();
          if (isRealName(pVal)) {
            if (!hoTenCha) {
              hoTenCha = pVal;
            } else if (!hoTenMe && pVal !== hoTenCha) {
              hoTenMe = pVal;
              break;
            }
          }
        }
        
        if (hoTenCha) {
          $('#ho_ten_cha, #hotencha, input[name="ho_ten_cha"], input[name="hotencha"]').val(hoTenCha);
        }
        if (hoTenMe) {
          $('#ho_ten_me, #hotenme, input[name="ho_ten_me"], input[name="hotenme"]').val(hoTenMe);
        }
        
        // Gán người liên hệ ưu tiên tên mẹ, nếu không có thì tên cha
        const nguoiLienHe = hoTenMe || hoTenCha;
        if (nguoiLienHe) {
          $('#nguoilienhe, #nguoi_lien_he, input[name="nguoilienhe"]').val(nguoiLienHe);
        }

        // Tự động làm sạch ô thẻ BHYT hoặc chuỗi nhận dạng nếu vô tình dính chuỗi quét mã vạch thô
        $('#sobhyt, input[name="sobhyt"], #chuoinhandang').each(function() {
          const v = $(this).val() || '';
          if (v.includes('|')) {
            $(this).val('');
          }
        });
      }
    } finally {
      setTimeout(() => {
        isApplyingQr = false;
        isInternalFieldSync = false;
      }, 300);
    }
  }

  // Trợ thủ cập nhật triệt để giá trị vào EasyUI component và DOM
  // ĐIỀN GIÁ TRỊ VÀ ĐỒNG BỘ TOÀN DIỆN EASYUI (KHÔNG KÍCH HOẠT ONCHANGE CỦA HIS)
  function safelySetEasyUiComponentVal($el, val) {
    if (!$el || !$el.length || val === undefined || val === null) return false;
    const $ = window.$ || window.jQuery;
    if (!$) {
      try {
        if ($el[0]) {
          $el[0].value = val;
          $el[0].dispatchEvent(new Event('input', { bubbles: true }));
          $el[0].dispatchEvent(new Event('change', { bubbles: true }));
        }
      } catch (e) {}
      return true;
    }
    let anyUpdated = false;
    $el.each(function () {
      const $t = $(this);
      
      // 1. Native DOM & jQuery
      $t.val(val);
      anyUpdated = true;
      
      // 2. EasyUI Component (Datebox / Combobox / Textbox)
      const state = $t.data('textbox') || $t.data('combo') || $t.data('datebox');
      if (state && state.options) {
        const opts = state.options;
        const prevOnChange = opts.onChange;
        // TẠM THỜI MUTE onChange ĐỂ KHÔNG KÍCH HOẠT HIS RESET
        opts.onChange = function() {};
        
        try {
          if ($t.data('datebox') || $t.hasClass('datebox-f') || $t.hasClass('easyui-datebox')) {
            $t.datebox('setValue', val);
            try { $t.datebox('setText', val); } catch (e) {}
          } else if ($t.data('combobox') || $t.hasClass('combobox-f') || $t.hasClass('easyui-combobox')) {
            $t.combobox('setValue', val);
          } else if ($t.data('textbox') || $t.hasClass('textbox-f') || $t.hasClass('easyui-textbox')) {
            $t.textbox('setValue', val);
          }
        } catch (e) {}

        try {
          const $prevDatebox = $t.closest('.textbox, .combo').prev('.datebox-f');
          if ($prevDatebox.length && $prevDatebox.data('datebox')) {
            $prevDatebox.datebox('setValue', val);
            try { $prevDatebox.datebox('setText', val); } catch (e) {}
          }
        } catch (e) {}

        try {
          if (($t.data('textbox') || $t.hasClass('textbox-f')) && typeof $t.textbox === 'function') {
            $t.textbox('initValue', val);
          }
        } catch (e) {}

        opts.value = val;
        // Phục hồi lại onChange ban đầu
        opts.onChange = prevOnChange;
      }

      // 3. Cập nhật trực tiếp visible DOM và hidden value input
      let wrap = $t.closest('.textbox, .combo');
      if (!wrap.length) wrap = $t.next('.textbox, .combo');
      if (!wrap.length && $t.parent().length) wrap = $t.parent().find('.textbox, .combo');
      if (wrap.length) {
        const txt = wrap.find('.textbox-text, .combo-text, .datebox-text');
        if (txt.length) {
          txt.val(val);
          txt.prop('value', val);
        }
        const hid = wrap.find('.textbox-value, .combo-value');
        if (hid.length) {
          hid.val(val);
          hid.prop('value', val);
        }
      }
    });
    return anyUpdated;
  }

  function setEasyUiComponentVal($el, val) {
    return safelySetEasyUiComponentVal($el, val);
  }

  function setValQuietly($el, val) {
    return safelySetEasyUiComponentVal($el, val);
  }

  // Biến lưu trữ mã thẻ BHYT hợp lệ gần nhất
  let lastVerifiedBhytCardNo = '';
  let lastVerifiedTuNgay = '';
  let lastVerifiedDenNgay = '';
  let lastVerifiedDob = '';

  function getActiveVerifiedTuNgay() {
    return (lastVerifiedTuNgay || (typeof document !== 'undefined' ? document.documentElement?.dataset?.verifiedTuNgay : '') || '').trim();
  }

  function getActiveVerifiedDenNgay() {
    return (lastVerifiedDenNgay || (typeof document !== 'undefined' ? document.documentElement?.dataset?.verifiedDenNgay : '') || '').trim();
  }

  // Ô Ngày sinh / Năm sinh (kể cả ô hiển thị .textbox-text của EasyUI đi kèm)
  function isDobFieldElement(t) {
    if (!t || t.nodeType !== 1 || t.tagName !== 'INPUT' || t.type === 'checkbox') return false;
    const ids = ['namsinh', 'ngaysinh', 'suatt_namsinh', 'namsinh_hc', 'ngaysinh_hc'];
    const id = (t.id || '').toLowerCase();
    const name = (t.name || '').toLowerCase();
    if (ids.includes(id) || ids.includes(name)) return true;
    const prev = t.closest?.('.textbox, .combo')?.previousElementSibling;
    if (prev) {
      const pid = (prev.id || '').toLowerCase();
      const pname = (prev.name || '').toLowerCase();
      if (ids.includes(pid) || ids.includes(pname)) return true;
    }
    return false;
  }

  function getActiveVerifiedDob() {
    // Người dùng đang tự nhập (cờ do content.js đặt) hoặc con trỏ đang ở ô Ngày sinh -> không bảo vệ/ghi đè
    try {
      if (typeof document !== 'undefined') {
        if (document.documentElement?.dataset?.bhytUserDob === '1') return '';
        if (isDobFieldElement(document.activeElement)) return '';
      }
    } catch (e) {}
    return (lastVerifiedDob || (typeof document !== 'undefined' ? document.documentElement?.dataset?.verifiedDob : '') || '').trim();
  }

  function getActiveVerifiedCardNo() {
    return (lastVerifiedBhytCardNo || window.__lastVerifiedBhytCard || (typeof document !== 'undefined' ? document.documentElement?.dataset?.verifiedCardNo : '') || '').trim();
  }

  window.addEventListener('bhyt_verified_card', (e) => {
    if (e.detail?.card) {
      lastVerifiedBhytCardNo = String(e.detail.card).trim();
      window.__lastVerifiedBhytCard = lastVerifiedBhytCardNo;
    }
  });

  window.addEventListener('bhyt_verified_dob', (e) => {
    if (e.detail?.dob) {
      lastVerifiedDob = String(e.detail.dob).trim();
    }
  });

  window.addEventListener('bhyt_verified_tungay', (e) => {
    if (e.detail?.tuNgay) {
      lastVerifiedTuNgay = String(e.detail.tuNgay).trim();
      try { document.documentElement.dataset.verifiedTuNgay = lastVerifiedTuNgay; } catch (e) {}
    }
  });

  window.addEventListener('bhyt_verified_denngay', (e) => {
    if (e.detail?.denNgay) {
      lastVerifiedDenNgay = String(e.detail.denNgay).trim();
      try { document.documentElement.dataset.verifiedDenNgay = lastVerifiedDenNgay; } catch (e) {}
    }
  });

  // =========================================================================
  // HOOK ĐÁNH CHẶN CHỦ ĐỘNG 0MS TRÊN NATIVE DOM APIS (TIẾP NHẬN & BẢNG KÊ & MODAL HÀNH CHÍNH)
  // Chặn đứng hoàn toàn việc VNPT HIS hoặc jquery.inputmask tự động gán ngày đầu năm
  // 01/01/YYYY hoặc khóa disabled kèm nền vàng vào ô #tungay, gán dd/mm/yyyy vào #ngaysinh,
  // hoặc ghi đè mã thẻ cũ / 0 vào ô Số BHYT trong modal của form kiemtrabangke / suatt
  // =========================================================================
  if (!isExcludedPage) {
    try {
      const descVal = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      if (descVal && descVal.set && !descVal.set._bhytValHooked) {
        const origValSetter = descVal.set;
        const origValGetter = descVal.get;
        Object.defineProperty(HTMLInputElement.prototype, 'value', {
          get: function () {
            return origValGetter.call(this);
          },
          set: function (val) {
            try {
              if (this && this.nodeType === 1) {
                const id = (this.id || '').toLowerCase();
                const name = (this.name || '').toLowerCase();
                const prevSibling = this.closest?.('.textbox, .combo')?.previousElementSibling;

                // 1. Hook bảo vệ ô Từ ngày (#tungay)
                const isTuNgayField = id === 'tungay' || id === 'the_tungay' || name === 'tungay' || name === 'the_tungay' ||
                  (prevSibling && (prevSibling.id === 'tungay' || prevSibling.name === 'tungay' || prevSibling.id === 'the_tungay'));
                const activeTu = getActiveVerifiedTuNgay();

                if (isTuNgayField && activeTu) {
                  const valStr = String(val || '').trim();
                  // Tuyệt đối không cho phép HIS ghi đè ngày khác activeTu khi đã có kết quả Cổng xác thực
                  if (valStr !== activeTu) {
                    console.log(`[BHYT Extension Main World] Hook input.value (0ms): Chặn HIS gán đè (${valStr}) vào ô Từ ngày -> Ép giữ nguyên ngày Cổng:`, activeTu);
                    val = activeTu;
                    if (this.disabled) {
                      this.disabled = false;
                      this.removeAttribute('disabled');
                    }
                    if (this.style && (this.style.backgroundColor === 'rgb(255, 255, 153)' || this.style.background?.includes('255, 255, 153'))) {
                      this.style.backgroundColor = '';
                      this.style.background = '';
                    }
                  }
                } else if (id === 'denngay' || id === 'the_denngay' || name === 'denngay' || name === 'the_denngay' ||
                  (prevSibling && (prevSibling.id === 'denngay' || prevSibling.name === 'denngay' || prevSibling.id === 'the_denngay'))) {
                  const activeDen = getActiveVerifiedDenNgay();
                  if (activeDen) {
                    const valStr = String(val || '').trim();
                    if (valStr !== activeDen) {
                      console.log(`[BHYT Extension Main World] Hook input.value (0ms): Chặn HIS gán đè (${valStr}) vào ô Đến ngày -> Ép giữ nguyên ngày Cổng:`, activeDen);
                      val = activeDen;
                    }
                  }
                } else if (id === 'ngaysinh' || id === 'namsinh' || name === 'ngaysinh' || name === 'namsinh' || id === 'ngaysinh_hc' || id === 'namsinh_hc' || id === 'suatt_namsinh' ||
                  (prevSibling && (prevSibling.id === 'namsinh' || prevSibling.name === 'namsinh' || prevSibling.id === 'ngaysinh' || prevSibling.name === 'ngaysinh'))) {
                  // Hook bảo vệ Ngày sinh: Chặn HIS gán placeholder dd/mm/yyyy khi đang có ngày sinh cổng
                  const activeDob = getActiveVerifiedDob();
                  if (activeDob && !window.__bhytIsResettingForm) {
                    const valStr = String(val || '').trim();
                    // CHỈ can thiệp nếu val không rỗng và là placeholder dd/mm/yyyy hoặc __/__/____
                    // TUYỆT ĐỐI không chặn khi val rỗng (val === '') vì đó là thao tác reset/xóa form hợp lệ của HIS!
                    if (valStr && (valStr.toLowerCase() === 'dd/mm/yyyy' || valStr === '__/__/____')) {
                      console.log(`[BHYT Extension Main World] Hook input.value (0ms): Chặn HIS gán placeholder (${valStr}) vào ô Ngày sinh -> Giữ nguyên ngày sinh Cổng:`, activeDob);
                      val = activeDob;
                    }
                  }
                } else if (id === 'sobhyt_hc' || name === 'sobhyt_hc' || id === 'suatt_sobhyt' || name === 'suatt_sobhyt' || (isBangKePage && (id === 'sobhyt' || name === 'sobhyt'))) {
                  // Hook bảo vệ Số BHYT trong modal: Chặn đứng hoàn toàn việc HIS gán 0 hoặc đè mất thẻ hợp lệ
                  const valStr = String(val || '').trim().replace(/\s+/g, '').toUpperCase();
                  if (valStr === '0' || val === 0) {
                    const currentGoodCard = this.dataset?.lastGoodCard || this.getAttribute('data-last-good-card') || this.getAttribute('data-last-card') ||
                                         getActiveVerifiedCardNo() || window.__lastVerifiedBhytCard ||
                                         (this.value && this.value !== '0' && this.value.length >= 8 ? this.value : '');
                    if (currentGoodCard && currentGoodCard.length >= 8) {
                      console.log(`[BHYT Extension Main World] Hook input.value (0ms): Chặn đứng HIS gán 0 vào ${id || name} -> Ép giữ nguyên thẻ BHYT:`, currentGoodCard);
                      val = currentGoodCard;
                      if (window.$) {
                        try { window.$(this).data('bhyt17BaoCaoHCValue', currentGoodCard); } catch (e) {}
                      }
                    } else {
                      console.log(`[BHYT Extension Main World] Hook input.value (0ms): Chặn gán 0 vào ${id || name} (bỏ qua lệnh gán 0 của HIS)`);
                      return; // Bỏ qua hoàn toàn lệnh gán 0 của HIS
                    }
                  } else if (valStr && valStr.length >= 8 && valStr !== '0') {
                    if (this.dataset) this.dataset.lastGoodCard = valStr;
                    window.__lastVerifiedBhytCard = valStr;
                  }
                }
              }
            } catch (e) {}
            return origValSetter.call(this, val);
          },
          configurable: true,
          enumerable: true
        });
        descVal.set._bhytValHooked = true;
      }
    } catch (e) {}

    // Hook native setter disabled để ngăn HIS khóa ô Từ ngày khi đã có thẻ BHYT hợp lệ
    try {
      const descDis = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'disabled');
      if (descDis && descDis.set && !descDis.set._bhytDisHooked) {
        const origDisSetter = descDis.set;
        const origDisGetter = descDis.get;
        Object.defineProperty(HTMLInputElement.prototype, 'disabled', {
          get: function () {
            return origDisGetter.call(this);
          },
          set: function (dis) {
            try {
              if (this && this.nodeType === 1 && dis) {
                const id = (this.id || '').toLowerCase();
                const name = (this.name || '').toLowerCase();
                const isTuNgayField = id === 'tungay' || id === 'the_tungay' || name === 'tungay' || name === 'the_tungay';
                const activeTu = getActiveVerifiedTuNgay();
                if (isTuNgayField && activeTu) {
                  return origDisSetter.call(this, false);
                }
              }
            } catch (e) {}
            return origDisSetter.call(this, dis);
          },
          configurable: true,
          enumerable: true
        });
        descDis.set._bhytDisHooked = true;
      }
    } catch (e) {}

    // Hook setAttribute('disabled')
    try {
      const origSetAttr = HTMLInputElement.prototype.setAttribute;
      if (origSetAttr && !origSetAttr._bhytAttrDisHooked) {
        HTMLInputElement.prototype.setAttribute = function (attrName, attrVal) {
          try {
            if (attrName && String(attrName).toLowerCase() === 'disabled') {
              const id = (this.id || '').toLowerCase();
              const elName = (this.name || '').toLowerCase();
              const isTuNgayField = id === 'tungay' || id === 'the_tungay' || elName === 'tungay' || elName === 'the_tungay';
              const activeTu = getActiveVerifiedTuNgay();
              if (isTuNgayField && activeTu) {
                return;
              }
            }
          } catch (e) {}
          return origSetAttr.apply(this, arguments);
        };
        HTMLInputElement.prototype.setAttribute._bhytAttrDisHooked = true;
      }
    } catch (e) {}
  }

  // Lắng nghe lệnh điền trường từ Content Script vào Main World qua jQuery
  function handleFillFieldEvent(e) {
    if (isInternalFieldSync) return;
    const { field, fields, value } = e.detail || {};
    if ((!field && (!fields || !fields.length)) || value === undefined) return;
    const $ = window.$ || window.jQuery;
    if (!$) return;

    isInternalFieldSync = true;
    try {
      const targetFields = Array.from(new Set([field].concat(fields || []))).filter(Boolean);
      const isCardField = targetFields.some(f => f.includes('sobhyt') || f.includes('mathe') || f.includes('sothe'));

      // BẢO VỆ TUYỆT ĐỐI: Không can thiệp vùng Ngày/Giờ bắt đầu, Ngày/Giờ kết thúc, Sửa thời gian theo mặc định của HIS
      const isTreatmentPeriodField = targetFields.some(f => 
        f.includes('ngaybatdau') || f.includes('ngay_batdau') || f.includes('suatt_ngaybatdau') || f.includes('sua_ngaybatdau') ||
        f.includes('giobatdau') || f.includes('gio_batdau') || f.includes('suatt_giobatdau') || f.includes('sua_giobatdau') ||
        f.includes('ngayketthuc') || f.includes('ngay_ketthuc') || f.includes('suatt_ngayketthuc') || f.includes('sua_ngayketthuc') ||
        f.includes('gioketthuc') || f.includes('gio_ketthuc') || f.includes('suatt_gioketthuc') || f.includes('sua_gioketthuc') ||
        f.includes('suathoigian') || f.includes('sua_thoigian') ||
        f.includes('ngay_bd') || f.includes('ngay_kt') || f.includes('gio_bd') || f.includes('gio_kt') ||
        f.includes('ngay_vao') || f.includes('ngayvao') || f.includes('giovao') || f.includes('gio_vao') ||
        f.includes('ngay_ra') || f.includes('ngayra') || f.includes('giora') || f.includes('gio_ra') ||
        f.includes('batdau') || f.includes('ketthuc') ||
        f.includes('suatt_tungay') || f.includes('sua_tungay') || f.includes('suatt_denngay') || f.includes('sua_denngay')
      );
      if (isTreatmentPeriodField) {
        return;
      }

      // TUYỆT ĐỐI KHÔNG GÁN '0' VÀO Ô SỐ THẺ BHYT
      if (isCardField && (value === '0' || value === 0)) {
        return;
      }

      // 1. Tỷ lệ miễn giảm / Mức hưởng (#tlmiengiam, #tlmiengiam_hc, #tilemiengiam_hc)
      const isTlMienGiam = targetFields.some(f => f.includes('tlmiengiam') || f.includes('tilemiengiam') || f.includes('muchuong') || f.includes('muc_huong'));
      if (isTlMienGiam) {
        const $tl = $('#tlmiengiam, input[name="tlmiengiam"], #tlmiengiam_hc, #tilemiengiam_hc, #suatt_tlmiengiam, #suatt_tilemiengiam, #sua_tlmiengiam, #sua_tilemiengiam, #tl_miengiam_hc, #tile_miengiam_hc, input[name="tlmiengiam_hc"], input[name="tilemiengiam_hc"], #muchuong, #muchuong_hc, #muc_huong_hc, #txt_tlmiengiam');
        safelySetEasyUiComponentVal($tl, value);
      }

      // 2. Số thẻ BHYT (#sobhyt_hc, #sobhyt, #suatt_sobhyt)
      if (isCardField) {
        lastVerifiedBhytCardNo = String(value).trim();
        const $sb = $('#sobhyt_hc, input[name="sobhyt_hc"], #suatt_sobhyt, #sua_sobhyt, #sobhyt, input[name="sobhyt"], #so_the_bhyt, input[name="so_the_bhyt"], #mathe_bhyt, input[name="mathe_bhyt"]');
        safelySetEasyUiComponentVal($sb, value);

        const cleanCard = String(value || '').trim().replace(/\s+/g, '').toUpperCase();
        if (cleanCard.length >= 3) {
          const chuoiNd = cleanCard.substring(0, 3);
          const $cnd = $('#chuoinhandang, input[name="chuoinhandang"], #chuoinhandang_hc, input[name="chuoinhandang_hc"], #suatt_chuoinhandang, input[name="suatt_chuoinhandang"], #sua_chuoinhandang, #chuoind, #chuoind_hc, #txt_chuoinhandang');
          safelySetEasyUiComponentVal($cnd, chuoiNd);
        }
      }

      // 3. Từ ngày (Hạn thẻ BHYT, TUYỆT ĐỐI không ghi vào ô Ngày bắt đầu đợt điều trị)
      const isTuNgay = targetFields.some(f => f.includes('gtthetu') || f.includes('tungay_hc') || (isTiepNhanPage && (f.includes('tungay') || f.includes('tu_ngay'))));
      if (isTuNgay) {
        lastVerifiedTuNgay = String(value || '').trim();
        try { document.documentElement.dataset.verifiedTuNgay = lastVerifiedTuNgay; } catch (e) {}
        const tuSelectors = isTiepNhanPage
          ? '#tungay, #the_tungay, #gtthetu, #gtTheTu, #hanthe_tu, #tu_ngay, input[name="tungay"], input[name="the_tungay"]'
          : '#suatt_gtthetu, #sua_gtthetu, #gtthetu, #gtTheTu, #the_tungay, #the_tu_ngay, #hanthe_tu, #tungay_hc, input[name="tungay_hc"], input[name="the_tungay"]';
        const $tu = $(tuSelectors);
        safelySetEasyUiComponentVal($tu, value);
        $tu.each(function () {
          if (this.disabled) {
            this.disabled = false;
            this.removeAttribute('disabled');
          }
          if (this.style && (this.style.backgroundColor === 'rgb(255, 255, 153)' || this.style.background?.includes('255, 255, 153'))) {
            this.style.backgroundColor = '';
            this.style.background = '';
          }
        });
      }

      // 4. Đến ngày (Hạn thẻ BHYT, TUYỆT ĐỐI không ghi vào ô Ngày kết thúc đợt điều trị)
      const isDenNgay = targetFields.some(f => f.includes('gttheden') || f.includes('denngay_hc') || (isTiepNhanPage && (f.includes('denngay') || f.includes('den_ngay'))));
      if (isDenNgay) {
        lastVerifiedDenNgay = String(value || '').trim();
        try { document.documentElement.dataset.verifiedDenNgay = lastVerifiedDenNgay; } catch (e) {}
        const denSelectors = isTiepNhanPage
          ? '#denngay, #the_denngay, #gttheden, #gtTheDen, #hanthe_den, #den_ngay, input[name="denngay"], input[name="the_denngay"]'
          : '#suatt_gttheden, #sua_gttheden, #gttheden, #gtTheDen, #the_denngay, #the_den_ngay, #hanthe_den, #denngay_hc, input[name="denngay_hc"], input[name="the_denngay"]';
        const $den = $(denSelectors);
        safelySetEasyUiComponentVal($den, value);
      }

      // 5. Năm sinh / Ngày sinh
      const isDob = targetFields.some(f => f.includes('namsinh') || f.includes('ngaysinh'));
      if (isDob) {
        lastVerifiedDob = String(value || '').trim();
        const $ns = $('#namsinh_hc, #ngaysinh_hc, #suatt_namsinh, #suatt_ngaysinh, #sua_namsinh, #sua_ngaysinh, #namsinh, #ngaysinh, input[name="namsinh_hc"], input[name="ngaysinh_hc"], input[name="namsinh"], input[name="ngaysinh"]');
        $ns.removeAttr('maxlength');
        safelySetEasyUiComponentVal($ns, value);
      }

      // 6. Nơi đăng ký KCB ban đầu (Tách biệt rõ ràng giữa Mã CSKCB và Tên CSKCB)
      const isTenNdk = targetFields.some(f => f.includes('hienthi') || f.includes('ten_') || f.includes('tenmadangky') || f.includes('tennoidangky'));
      if (isTenNdk) {
        const $tenNdk = $('#noidangky_hienthi, #noidangky_hienthi_hc, #ten_madangky, #ten_noidangky, #txt_ten_noidangky, #suatt_ten_noidangky, input[name="noidangky_hienthi"], input[name="ten_madangky"]');
        safelySetEasyUiComponentVal($tenNdk, value);
      } else {
        const isMaNdk = targetFields.some(f => (f.includes('noidangky') || f.includes('madangky') || f.includes('kcbbd') || f.includes('makcb')) && !f.includes('hienthi') && !f.includes('ten'));
        if (isMaNdk) {
          // BẢO VỆ TUYỆT ĐỐI: Chỉ gán vào ô Mã CSKCB khi giá trị là Mã (5 chữ số), TUYỆT ĐỐI không gán tên vào ô Mã
          const cleanCode = String(value || '').trim().replace(/\D/g, '').slice(0, 5);
          if (cleanCode && cleanCode.length === 5) {
            const $ndk = $('#noidangky_hc, #suatt_madangky, #sua_madangky, #noidangky, #madangky, #ma_noikcb, input[name="noidangky_hc"], input[name="noidangky"], input[name="madangky"]');
            safelySetEasyUiComponentVal($ndk, cleanCode);
          }
        }
      }

      // 7. Thời gian đủ 5 năm liên tục
      const is5Nam = targetFields.some(f => f.includes('5nam') || f.includes('du5nam'));
      if (is5Nam) {
        const $5n = $('#thoigian_du5namlientuc_tnhc, #suatt_thoigian_du5namlientuc, #suatt_ngaydu5nam, #sua_ngaydu5nam, #thoigian_du5namlientuc, #ngay_du_5nam, #ngaydu5nam, input[name="thoigian_du5namlientuc_tnhc"], input[name="thoigian_du5namlientuc"], input[name="ngaydu5nam"]');
        safelySetEasyUiComponentVal($5n, value);
      }

      // 8. Giới tính
      const isGt = targetFields.some(f => f.includes('gioitinh'));
      if (isGt) {
        const $gt = $('#cbgioitinh_hc, #gioitinh_hc, #suatt_gioitinh, #cbgioitinh, #gioitinh, select[name="cbgioitinh_hc"], input[name="cbgioitinh_hc"], select[name="cbgioitinh"], input[name="gioitinh_hc"]');
        safelySetEasyUiComponentVal($gt, value);
      }

      // 9. Mã khu vực (K1, K2, K3)
      const isKv = targetFields.some(f => f.includes('manoidoituong') || f.includes('makv') || f.includes('khuvuc'));
      if (isKv) {
        const $kv = $('#manoidoituong, #makv_hc, #suatt_makv, #sua_makv, #makv, input[name="manoidoituong"], input[name="makv_hc"], input[name="suatt_makv"]');
        safelySetEasyUiComponentVal($kv, value);
      }

      // 10. Họ tên
      const isHt = targetFields.some(f => f.includes('hoten') || f.includes('tenbn') || f.includes('ten_benh_nhan'));
      if (isHt) {
        const $ht = $('#hoten_hc, #suatt_hoten, #sua_hoten, #hoten, #tenbn, input[name="hoten_hc"], input[name="hoten"]');
        safelySetEasyUiComponentVal($ht, value);
      }

      // 11. Địa chỉ
      const isDc = targetFields.some(f => f.includes('diachi'));
      if (isDc) {
        const $dc = $('#diachi_hc, #suatt_diachi, #sua_diachi, #diachi, input[name="diachi_hc"], input[name="diachi"]');
        safelySetEasyUiComponentVal($dc, value);
      }

      // 12. Chuỗi nhận dạng & Đối tượng thẻ
      const isCnd = targetFields.some(f => f.includes('chuoinhandang') || f.includes('chuoi_nhandang'));
      if (isCnd) {
        const $cnd = $('#chuoinhandang, input[name="chuoinhandang"], #chuoinhandang_hc, input[name="chuoinhandang_hc"], #suatt_chuoinhandang, input[name="suatt_chuoinhandang"], #sua_chuoinhandang, #chuoind, #chuoind_hc, #txt_chuoinhandang');
        safelySetEasyUiComponentVal($cnd, value);
      }
      const isDtt = targetFields.some(f => f.includes('doituongthe') || f.includes('tendoituong'));
      if (isDtt) {
        const $dtt = $('#doituongthe_hc, #suatt_doituongthe, #sua_doituongthe, #doituongthe, #ten_doituong, #tendoituong_the, #suatt_ten_doituong, #sua_ten_doituong, input[name="doituongthe_hc"], input[name="doituongthe"]');
        safelySetEasyUiComponentVal($dtt, value);
      }
      const isMdt = targetFields.some(f => f.includes('madoituong') && !f.includes('doituongthe') && !f.includes('kcb'));
      if (isMdt) {
        const $mdt = $('#madoituong_hc, #suatt_madoituong, #sua_madoituong, #madoituong, #ma_doituong, input[name="madoituong_hc"], input[name="madoituong"]');
        safelySetEasyUiComponentVal($mdt, value);
      }

      // 12b. Mã y tế / Mã bệnh nhân (#mayte, #mabenhnhan, #mabn, #suatt_mayte)
      const isMayte = targetFields.some(f => f.includes('mayte') || f.includes('mabenhnhan') || f.includes('mabn'));
      if (isMayte) {
        const $myte = $('#mayte, #mabenhnhan, #mabn, #suatt_mayte, #sua_mayte, #txt_mayte, #txt_mabenhnhan, input[name="mayte"], input[name="mabenhnhan"], input[name="mabn"]');
        safelySetEasyUiComponentVal($myte, value);
      }

      // 12c. Số điện thoại (#sodt, #so_dt, #sodienthoai, #dienthoai, #txt_sodt, ...)
      const isSdt = targetFields.some(f => f.includes('sodt') || f.includes('dienthoai') || f.includes('dien_thoai') || f.includes('phone') || f.includes('so_dt') || f.includes('sdt'));
      if (isSdt && value) {
        const $sdt = $('#sodt, input[name="sodt"], #so_dt, input[name="so_dt"], #sodienthoai, input[name="sodienthoai"], #dienthoai, input[name="dienthoai"], #txt_sodt, #txtSodt, #txt_dienthoai, #txtDienthoai, #dt_benhnhan, #so_dt_bn, #sodt_bn, input[name="sodt_bn"], #sdt, input[name="sdt"]');
        safelySetEasyUiComponentVal($sdt, value);
      }

      // 13. Fallback cho mọi selector cụ thể được truyền vào
      for (const fn of targetFields) {
        const $el = $(`#${fn}, input[name="${fn}"], select[name="${fn}"], textarea[name="${fn}"]`);
        safelySetEasyUiComponentVal($el, value);
      }
    } finally {
      setTimeout(() => { isInternalFieldSync = false; }, 100);
    }
  }

  // =========================================================================
  // DỌN DẸP NÚT taothete1 / TE1KT DƯ THỪA TRONG MODAL (NẾU CÓ)
  // Vùng thông tin đợt điều trị (Ngày/Giờ bắt đầu/kết thúc) được giữ nguyên vẹn
  // 100% theo mặc định của HIS, tiện ích tuyệt đối không can thiệp.
  // =========================================================================
  function cleanUpTe1KtEasyUi() {
    if (!window.$ && !window.jQuery) return;
    const $ = window.$ || window.jQuery;
    try {
      $('#taothete1_3434, [name="taothete1_3434"], [id*="taothete1"], [name*="taothete1"], [id*="taothete"], [name*="taothete"], a[onclick*="taothete1"], button[onclick*="taothete1"]').each(function() {
        const $b = $(this);
        const $wrap = $b.closest('.l-btn, a, button') || $b;
        $wrap.remove();
      });
      $('button, a, input[type="button"], span.l-btn, span.l-btn-text').each(function() {
        const t = ($(this).text() || $(this).val() || '').trim();
        if (t === 'TE1KT' || t.includes('TE1KT')) {
          const $wrap = $(this).closest('.l-btn, a, button, td > div') || $(this);
          $wrap.remove();
        }
      });
    } catch (e) {}
  }

  // =========================================================================
  // KHỞI TẠO CÁC TÍNH NĂNG DÙNG JQUERY (CHỜ JQUERY SẴN SÀNG)
  // Tuyệt đối không gọi trực tiếp tại document_start để tránh: ReferenceError: $ is not defined
  // =========================================================================
  // Lắng nghe trực tiếp trên document bằng native event để không bao giờ bị phụ thuộc vào phiên bản jQuery (jQuery 1.4-1.6 không có .on)
  const cardInputSelectors = '#sobhyt_hc, input[name="sobhyt_hc"], #suatt_sobhyt, input[name="suatt_sobhyt"], #sua_sobhyt, #sobhyt, input[name="sobhyt"], #mathe_bhyt, #so_the_bhyt';

  // Lắng nghe sự kiện reset bộ nhớ thẻ từ content script khi form tiếp nhận được làm mới
  function clearAllVerifiedCardCache() {
    lastVerifiedBhytCardNo = '';
    window.__lastVerifiedBhytCard = '';
    lastVerifiedTuNgay = '';
    lastVerifiedDenNgay = '';
    lastVerifiedDob = '';
    window.__bhytIsResettingForm = true;
    setTimeout(() => { window.__bhytIsResettingForm = false; }, 150);
    try {
      if (typeof document !== 'undefined' && document.documentElement) {
        delete document.documentElement.dataset.verifiedTuNgay;
        delete document.documentElement.dataset.verifiedDenNgay;
        delete document.documentElement.dataset.verifiedDob;
        delete document.documentElement.dataset.verifiedCardNo;
      }
    } catch (e) {}
  }
  window.addEventListener('bhyt_clear_card_cache', clearAllVerifiedCardCache);
  document.addEventListener('bhyt_clear_card_cache', clearAllVerifiedCardCache);
  window.addEventListener('bhyt-ext-reset-state', clearAllVerifiedCardCache);
  document.addEventListener('bhyt-ext-reset-state', clearAllVerifiedCardCache);
  window.addEventListener('bhyt-ext-save-success', clearAllVerifiedCardCache);

  function setupJQueryDependentFeatures() {
    try {
      const $ = window.$ || window.jQuery;
      if (!$ || !$.fn) return false;
      if (window._bhytJQueryFeaturesInitialized) return true;
      window._bhytJQueryFeaturesInitialized = true;

      const $doc = $(document);



      // 4. Bắt sự kiện AJAX lưu / cập nhật thành công từ VNPT HIS
      if ($doc && typeof $doc.ajaxSuccess === 'function') {
        $doc.ajaxSuccess(function (event, xhr, settings) {
          try {
            const type = (settings?.type || settings?.method || 'GET').toUpperCase();
            const url = (settings?.url || '').toLowerCase();
            // Bỏ qua các URL truy vấn thông thường hoặc API tra cứu dữ liệu
            if (url.includes('timkiem') || url.includes('chitiet') || url.includes('danhsach') || url.includes('theomabenhnhan') || url.includes('laythongtin') || url.includes('load')) {
              return;
            }

            const isExplicitSaveUrl = url.includes('/save') || url.includes('luu') || url.includes('capnhat') ||
                                      url.includes('chinhsua') || url.includes('suatt') || url.includes('update');
            if (!isExplicitSaveUrl && type !== 'POST') return;

            const respText = xhr?.responseText || '';
            const isSuccessContent = respText.includes('thành công') || respText.includes('thanh cong') ||
                                     respText.includes('"result":1') || respText.includes('"result":"1"') ||
                                     respText.includes('"success":true') || respText.includes('"status":1');

            if (isExplicitSaveUrl && isSuccessContent) {
              console.log('[BHYT Extension Main World] ajaxSuccess phát hiện thao tác lưu thành công:', url);
              const evt = new CustomEvent('bhyt-ext-save-success', { detail: { url: url, message: 'Lưu thành công!' } });
              window.dispatchEvent(evt);
            }
          } catch (e) {}
        });
      }

      return true;
    } catch (e) {
      console.warn('[BHYT Extension] setupJQueryDependentFeatures catch:', e);
      return false;
    }
  }

  if (!setupJQueryDependentFeatures()) {
    let jqAttempts = 0;
    const jqTimer = setInterval(() => {
      jqAttempts++;
      if (setupJQueryDependentFeatures() || jqAttempts >= 30) {
        clearInterval(jqTimer);
      }
    }, 200);
    document.addEventListener('DOMContentLoaded', setupJQueryDependentFeatures, { once: true });
    window.addEventListener('load', setupJQueryDependentFeatures, { once: true });
  }

  window.addEventListener('bhyt-ext-fill-field', handleFillFieldEvent);
  document.addEventListener('bhyt-ext-fill-field', handleFillFieldEvent);

  function handleMainWorldKeydown(e) {
    if (e.key === 'Enter') {
      const target = e.target;
      if (!target) return;

      // Tuyệt đối không can thiệp nếu đang thao tác trong Modal
      if (target.closest('.window, .panel.window, .ui-dialog, .modal, [role="dialog"], #suattModal, .suatt-modal')) {
        return;
      }

      const id = (target.id || '').toLowerCase();
      const name = (target.name || '').toLowerCase();

      const isBhytCardField = (id === 'sobhyt' || name === 'sobhyt');
      const isCccdField =
        id === 'socmt' || id === 'so_cccd' || id === 'socccd' || id === 'cmt' || id === 'so_cmt' ||
        id === 'cmnd' || id === 'socmnd' || name === 'socmt' || name === 'so_cccd' || name === 'socccd' ||
        id === 'mayte' || name === 'mayte';

      if (isBhytCardField) {
        // Chỉ chặn Enter trên ô Thẻ BHYT vì HIS tự động gọi popup lỗi Cổng BHXH của HIS
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        console.log('[BHYT Extension Main World] Đã chặn phím Enter trên ô BHYT để chuyển sang plugin tra cứu:', target.value);

        const detailData = { field: id || name, value: target.value };
        window.dispatchEvent(new CustomEvent('bhyt-ext-trigger-check', { detail: detailData }));
      } else if (isCccdField) {
        const val = (target.value || '').trim();
        // NẾU Ô CCCD CHỨA KÝ TỰ '|' (DỮ LIỆU TỪ MÁY QUÉT QR CODE CCCD)
        if (val.includes('|')) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          console.log('[BHYT Extension Main World] Đã bắt chuỗi QR CCCD trong Main World qua Enter:', val);
          applyQrCccdInMainWorld(val);

          const detailData = { field: id || name, value: val, isQr: true };
          window.dispatchEvent(new CustomEvent('bhyt-ext-trigger-check', { detail: detailData }));
          return;
        }

        // Trên ô Mã BN: Báo cho Content Script kiểm tra (ô CCCD đã do content.js tự lắng nghe trực tiếp)
        if (id === 'mayte' || name === 'mayte') {
          console.log('[BHYT Extension Main World] Nhận phím Enter trên ô Mã BN:', target.value);
          setTimeout(() => {
            const detailData = { field: id || name, value: target.value };
            window.dispatchEvent(new CustomEvent('bhyt-ext-trigger-check', { detail: detailData }));
          }, 150);
        }
      }
    }
  }

  if (isTiepNhanPage) {
    window.addEventListener('keydown', handleMainWorldKeydown, true);
    window.addEventListener('keypress', handleMainWorldKeydown, true);

    // Bắt sự kiện input khi máy quét QR CCCD bắn ký tự mà không kích hoạt Enter (có debounce)
    window.addEventListener('input', function (e) {
      if (isApplyingQr) return;
      const target = e.target;
      if (!target) return;
      const val = (target.value || '').trim();
      if (val.includes('|')) {
        clearTimeout(qrInputTimer);
        // Luôn debounce 200ms để máy quét hardware hoàn tất truyền đầy đủ tất cả các trường (kể cả họ tên cha, mẹ, địa chỉ)
        qrInputTimer = setTimeout(() => {
          const cur = (target.value || '').trim();
          if (cur.includes('|') && isCompleteQrCccd(cur)) {
            console.log('[BHYT Extension Main World] Nhận dạng chuỗi QR CCCD đầy đủ sau khi máy quét hoàn tất:', cur);
            applyQrCccdInMainWorld(cur);
            const detailData = { field: target.id || target.name, value: cur, isQr: true };
            window.dispatchEvent(new CustomEvent('bhyt-ext-trigger-check', { detail: detailData }));
          } else if (cur.includes('|') && isCompleteQrTheGiayBhyt(cur)) {
            console.log('[BHYT Extension Main World] Nhận dạng chuỗi QR Thẻ giấy BHYT sau khi máy quét hoàn tất:', cur);
            const detailData = { field: target.id || target.name, value: cur, isQr: true };
            window.dispatchEvent(new CustomEvent('bhyt-ext-trigger-check', { detail: detailData }));
          }
        }, 200);
      }
    }, true);
  }

  // -----------------------------------------------------------------------
  // 6. Chặn click nút Kiểm tra thẻ của HIS ở Main World capture phase
  //    (CHỈ chuyển tiếp khi click đúng nút Kiểm tra BHYT của HIS để kích hoạt Tiện ích)
  //    HOÀN TOÀN KHÔNG can thiệp hàng nút tác vụ mặc định của HIS:
  //    [Đo sinh hiệu] [Chụp] [Chỉ định CLS] [Thêm] [Lưu] [Sửa] [Xoá] [Hủy] [Lịch sử khám] [LS Thuốc/CLS]
  // -----------------------------------------------------------------------
  if (isTiepNhanPage) {
    window.addEventListener('click', function (e) {
      const target = e.target;
      if (!target) return;

      const btn = target.closest('button, input[type="button"], input[type="submit"], a, .btn, [class*="button"], .l-btn');
      if (!btn) return;

      // Bỏ qua nếu là các nút do Extension tạo hoặc nằm trong Modal
      if (
        btn.id === 'btnCheckTheBHYT_modal' ||
        btn.id === 'bhytExtInlineBtn' ||
        btn.id === 'bhytExtFloatingRightBtn' ||
        btn.id === 'btnKhamBenhNoiTruCheckBHYT' ||
        btn.id === 'btnBantCheckBHYT' ||
        btn.id === 'btnKhamBenhCheckBHYT' ||
        btn.id === 'btnBangKeCardCheckBHYT' ||
        btn.id === 'btnKhamBenhFormCheckBHYT' ||
        btn.id === 'bhytExtKhamBenhInlineBtn' ||
        btn.id === 'bhytExtBangKeInlineBtn' ||
        btn.id === 'sua_CCCD' ||
        btn.id === 'sua_5nam' ||
        btn.classList.contains('bhyt-btn-modal-check') ||
        btn.classList.contains('bhyt-btn-khambenh-check') ||
        btn.classList.contains('bhyt-btn-bangke-card-check') ||
        btn.closest('#bhyt_modal_btn_wrapper, #bhyt_noitru_btn_wrapper, #bhyt_bant_btn_wrapper, #bhyt_khambenh_btn_wrapper, #bhyt_bangke_card_btn_wrapper, .bhyt-btn-modal-check, .window, .panel.window, .ui-dialog, .modal, [role="dialog"], #suattModal, .suatt-modal')
      ) {
        return;
      }

      const txt = (btn.value || btn.textContent || '').trim().toLowerCase();
      const id = (btn.id || '').toLowerCase();
      const name = (btn.name || '').toLowerCase();

      // CHỈ xử lý khi người dùng click đúng nút "Kiểm tra BHYT" của HIS trên form chính
      const isCheckBtn =
        txt === 'kiểm tra bhyt' ||
        txt === 'ktra tt thẻ bhyt' ||
        txt === 'kiểm tra thẻ bhyt' ||
        txt === 'kiểm tra thẻ bảo hiểm' ||
        txt === 'ktthẻ bhyt' ||
        txt === 'kt thẻ' ||
        id.includes('kiemtrathe') ||
        id.includes('kiemtra_bhyt') ||
        id.includes('btn_kiemtrabhyt') ||
        id.includes('ktratt_bhyt') ||
        name.includes('kiemtrathe') ||
        name.includes('kiemtra_bhyt');

      if (isCheckBtn) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        console.log('[BHYT Extension Main World] Đã chuyển tiếp click nút kiểm tra thẻ của HIS sang Tiện ích:', txt, id);

        const evt = new CustomEvent('bhyt-ext-trigger-check', {
          bubbles: true,
          composed: true,
          detail: { field: 'button', value: id || txt }
        });
        document.dispatchEvent(evt);
        window.dispatchEvent(evt);
      }
    }, true);
  }

  // -----------------------------------------------------------------------
  // 7. Bảo vệ và ưu tiên tuyệt đối mã 1.12 thay vì mã 3.3 cho Đối tượng KCB
  //    (Nếu có tích ô Cấp cứu thì MA_DOITUONG_KCB = 2)
  // -----------------------------------------------------------------------
  function getDoiTuongSelect() {
    const candidates = [
      'doituong', 'cbdoituong', 'madoituongkcb', 'doituongkcb', 'doituong_kcb',
      'cb_doituong', 'cb_doituongkcb', 'cbo_doituong', 'cboDoituong', 'cbdoituongkcb',
      'madoituong', 'ma_doituong', 'cb_madoituong', 'doituong_kcb_bhyt'
    ];
    for (const id of candidates) {
      const el = document.getElementById(id) || document.querySelector(`select[name="${id}"]`);
      if (el && el.tagName === 'SELECT') return el;
    }
    const allLabels = document.querySelectorAll('label, span, td, div, b, strong');
    for (const lbl of allLabels) {
      const txt = (lbl.textContent || '').trim().toLowerCase();
      if (txt === 'đối tượng kcb' || txt.startsWith('đối tượng kcb') || txt.includes('đối tượng kcb')) {
        const forId = lbl.getAttribute?.('for');
        if (forId) {
          const el = document.getElementById(forId);
          if (el && el.tagName === 'SELECT') return el;
        }
        const parent = lbl.closest('tr, .form-group, .row, div');
        if (parent) {
          const sel = parent.querySelector('select');
          if (sel) return sel;
        }
        const nextSel = lbl.nextElementSibling;
        if (nextSel && nextSel.tagName === 'SELECT') return nextSel;
      }
    }
    const allSelects = document.querySelectorAll('select');
    for (const sel of allSelects) {
      for (let i = 0; i < sel.options.length; i++) {
        const opt = sel.options[i];
        const v = String(opt.value || '').trim();
        const t = String(opt.text || '').trim();
        if (
          v === '3.3' || v === '1.12' ||
          t.startsWith('3.3') || t.includes('3.3') ||
          t.startsWith('1.12') || t.includes('1.12') ||
          t.toLowerCase().includes('tự đến kcb') ||
          t.toLowerCase().includes('cơ bản đạt dưới 50')
        ) {
          return sel;
        }
      }
    }
    return document.getElementById('doituong') || document.getElementById('cbdoituong') || document.querySelector('select[name="doituong"]');
  }

  function hasOption112(selectEl) {
    if (!selectEl || !selectEl.options) return false;
    return Array.from(selectEl.options).some(o => {
      const v = String(o.value || '').trim();
      const t = String(o.text || '').trim();
      return v === '1.12' || /^1\.12([^\d]|$)/.test(v) || /^1\.12([^\d]|$)/.test(t) || t.includes('1.12');
    });
  }

  function syncSelect2DoiTuong(selectEl, text) {
    const s2List = [
      document.getElementById('select2-doituong-container'),
      document.getElementById('select2-cbdoituong-container'),
      selectEl?.id ? document.getElementById(`select2-${selectEl.id}-container`) : null,
      selectEl?.parentElement?.querySelector('.select2-selection__rendered'),
      selectEl?.closest('tr, .form-group, .row, div')?.querySelector('.select2-selection__rendered')
    ].filter(Boolean);
    s2List.forEach(s2 => {
      s2.textContent = text;
      s2.title = text;
    });
  }

  function enforceDoiTuongPriority() {
    const doituongEl = getDoiTuongSelect();
    if (!doituongEl || !doituongEl.options || doituongEl.options.length === 0) return;

    const isCapCuu = Boolean(
      document.getElementById('capcuu')?.checked ||
      document.getElementById('chk_capcuu')?.checked ||
      document.querySelector('input[name="capcuu"]')?.checked
    );

    const curOpt = doituongEl.selectedOptions?.[0];
    const curVal = String(curOpt?.value || doituongEl.value || '').trim();
    const curTxt = String(curOpt?.text || '').trim();

    // 1. Cấp cứu: Luôn ưu tiên mã 2
    if (isCapCuu) {
      if (curVal !== '2' && !curTxt.toLowerCase().includes('cấp cứu')) {
        for (let i = 0; i < doituongEl.options.length; i++) {
          const o = doituongEl.options[i];
          if (o.value === '2' || o.text.toLowerCase().includes('cấp cứu')) {
            doituongEl.selectedIndex = i;
            doituongEl.value = o.value;
            syncSelect2DoiTuong(doituongEl, o.text);
            return;
          }
        }
      }
      return;
    }

    // 2. Giữa mã 3.3 và 1.12 / 1.1:
    const is33 = curVal === '3.3' || curVal === '3' || curTxt.startsWith('3.3') || curTxt.includes('3.3') || curTxt.startsWith('3 -');
    if (is33) {
      const isDungTuyen = checkIsDungTuyenInMainWorld();
      if (isDungTuyen) {
        for (let i = 0; i < doituongEl.options.length; i++) {
          const o = doituongEl.options[i];
          const v = String(o.value || '').trim();
          const t = String(o.text || '').trim();
          if ((v === '1.1' || /^1\.1([^\d]|$)/.test(v) || /^1\.1([^\d]|$)/.test(t) ||
               t.toLowerCase().includes('đúng nơi đăng ký') || t.toLowerCase().includes('đúng cơ sở kcb') || t.toLowerCase().includes('đúng nơi đkkcb')) &&
              !/^1\.1[1-9]/.test(v) && !/^1\.1[1-9]/.test(t)) {
            console.log('[BHYT Extension Main World] Tự động chọn mã 1.1 (Đúng tuyến) thay vì 3.3:', o.text);
            doituongEl.selectedIndex = i;
            doituongEl.value = o.value;
            syncSelect2DoiTuong(doituongEl, o.text);
            return;
          }
        }
      }

      let idx112 = -1;
      for (let i = 0; i < doituongEl.options.length; i++) {
        const o = doituongEl.options[i];
        const v = String(o.value || '').trim();
        const t = String(o.text || '').trim();
        if (v === '1.12' || /^1\.12([^\d]|$)/.test(v) || /^1\.12([^\d]|$)/.test(t) || t.includes('1.12') || t.toLowerCase().includes('dưới 50 điểm')) {
          idx112 = i;
          break;
        }
      }
      if (idx112 >= 0) {
        console.log('[BHYT Extension Main World] Tự động ưu tiên chuyển mã 3.3 sang mã 1.12 chuẩn xác:', doituongEl.options[idx112].text);
        doituongEl.selectedIndex = idx112;
        doituongEl.value = doituongEl.options[idx112].value;
        syncSelect2DoiTuong(doituongEl, doituongEl.options[idx112].text);
      }
    }
  }

  function checkIsDungTuyenInMainWorld() {
    const dt = document.getElementById('dungtuyen')?.checked ||
               document.getElementById('chk_dungtuyen')?.checked ||
               document.querySelector('input[name="dungtuyen"]')?.checked ||
               document.querySelector('input[name="chk_dungtuyen"]')?.checked;
    const tt = document.getElementById('thongtuyen')?.checked ||
               document.getElementById('chk_thongtuyen')?.checked ||
               document.querySelector('input[name="thongtuyen"]')?.checked ||
               document.querySelector('input[name="chk_thongtuyen"]')?.checked;
    if (tt && !dt) return false;
    // Đối tượng 1.1 là ĐÚNG NƠI ĐĂNG KÝ BAN ĐẦU -> Nơi ĐK BẮT BUỘC phải trùng mã CSKCB tiếp nhận (49008)
    const dk = (document.getElementById('noidangky')?.value || document.querySelector('input[name="noidangky"]')?.value || '').trim().replace(/\D/g, '').substring(0, 5);
    const myCskcb = (window.__myCskcbCode || (typeof document !== 'undefined' ? document.documentElement?.dataset?.myCskcb : '') || '49008').trim();
    if (!dk) return false;
    return Boolean(myCskcb && dk === myCskcb);
  }

  // Chỉ chạy logic ưu tiên đối tượng KCB trên trang Tiếp nhận bệnh nhân
  const isTiepNhan = path.includes('tiepnhan') || path.includes('tiep_nhan') || path.includes('tiep-nhan') || path.includes('tiepdon');
  if (isTiepNhan) {
    // BẢO VỆ HIỆU NĂNG: Lắng nghe sự kiện change thay vì polling setInterval mỗi giây gây chiếm dụng CPU
    document.addEventListener('change', (e) => {
      const id = (e.target?.id || '').toLowerCase();
      const name = (e.target?.name || '').toLowerCase();
      if (id === 'doituong' || id === 'cbdoituong' || name === 'doituong' || id.includes('capcuu')) {
        enforceDoiTuongPriority();
      }
    }, true);

    // Bảo vệ sự kiện hover/focus trên các ô Ngày sinh, Từ ngày / Đến ngày để ngăn EasyUI revert giá trị hoặc làm rỗng
    function handleDateHoverFocus(e) {
      if (window.__bhytIsResettingForm) return;
      const target = e.target;
      if (!target) return;
      const isDateInput = target.matches && target.matches('#tungay, #the_tungay, input[name="tungay"], #denngay, #the_denngay, input[name="denngay"], #namsinh, #ngaysinh, #suatt_namsinh, input[name="namsinh"], input[name="ngaysinh"], .datebox-text, .textbox-text');
      if (!isDateInput) return;

      const $ = window.$ || window.jQuery;
      const $t = $ ? $(target) : null;

      // 1. Bảo vệ ô Ngày sinh / Năm sinh
      const activeDob = getActiveVerifiedDob();
      if (activeDob && activeDob.toLowerCase() !== 'dd/mm/yyyy') {
        const isNs = (target.matches && target.matches('#namsinh, #ngaysinh, #suatt_namsinh, input[name="namsinh"], input[name="ngaysinh"]')) ||
                     (target.closest && target.closest('.textbox, .combo')?.previousElementSibling?.matches?.('#namsinh, #ngaysinh, #suatt_namsinh, input[name="namsinh"], input[name="ngaysinh"]'));
        if (isNs) {
          const curVal = (target.value || '').trim();
          // Chỉ khôi phục khi HIS đổ placeholder; không ghi đè giá trị người dùng đang nhập
          if (curVal.toLowerCase() === 'dd/mm/yyyy' || curVal === '__/__/____') {
            if ($t) safelySetEasyUiComponentVal($t, activeDob);
            else target.value = activeDob;
          }
        }
      }

      // 2. Bảo vệ ô Từ ngày
      const activeTu = getActiveVerifiedTuNgay();
      if (activeTu) {
        const isTu = (target.matches && target.matches('#tungay, #the_tungay, input[name="tungay"]')) ||
                     (target.closest && target.closest('.textbox, .combo')?.previousElementSibling?.matches?.('#tungay, #the_tungay, input[name="tungay"]'));
        if (isTu && target.value && target.value !== activeTu) {
          if ($t) safelySetEasyUiComponentVal($t, activeTu);
          else target.value = activeTu;
        }
      }

      // 3. Bảo vệ ô Đến ngày
      const activeDen = getActiveVerifiedDenNgay();
      if (activeDen) {
        const isDen = (target.matches && target.matches('#denngay, #the_denngay, input[name="denngay"]')) ||
                     (target.closest && target.closest('.textbox, .combo')?.previousElementSibling?.matches?.('#denngay, #the_denngay, input[name="denngay"]'));
        if (isDen && target.value && target.value !== activeDen) {
          if ($t) safelySetEasyUiComponentVal($t, activeDen);
          else target.value = activeDen;
        }
      }
    }

    document.addEventListener('mouseover', handleDateHoverFocus, true);
    document.addEventListener('mouseenter', handleDateHoverFocus, true);
    document.addEventListener('focusin', handleDateHoverFocus, true);

    // Hook jQuery fn.val nếu HIS dùng jQuery để gán giá trị
    function hookJQueryVal() {
      if (window.jQuery && window.jQuery.fn && window.jQuery.fn.val && !window.jQuery.fn.val._bhytValHooked) {
        const origVal = window.jQuery.fn.val;
        window.jQuery.fn.val = function (value) {
          try {
            if (arguments.length > 0 && this.length > 0) {
              const el = this[0];
              if (el && el.nodeType === 1) {
                const id = (el.id || '').toLowerCase();
                const name = (el.name || '').toLowerCase();
                const prevSibling = el.closest?.('.textbox, .combo')?.previousElementSibling;

                // 1. Hook bảo vệ ô Từ ngày (#tungay)
                const isTuNgayField = id === 'tungay' || id === 'the_tungay' || name === 'tungay' || name === 'the_tungay' ||
                  (prevSibling && (prevSibling.id === 'tungay' || prevSibling.name === 'tungay' || prevSibling.id === 'the_tungay'));
                const activeTu = getActiveVerifiedTuNgay();
                if (isTuNgayField && activeTu) {
                  const vStr = String(value || '').trim();
                  if (vStr !== activeTu) {
                    console.log(`[BHYT Extension Main World] Hook $.fn.val (0ms): Chặn HIS gán đè (${vStr}) vào ô Từ ngày -> Ép giữ nguyên ngày từ Cổng:`, activeTu);
                    const res = origVal.call(this, activeTu);
                    if (el.disabled) {
                      el.disabled = false;
                      el.removeAttribute('disabled');
                    }
                    if (el.style && (el.style.backgroundColor === 'rgb(255, 255, 153)' || el.style.background?.includes('255, 255, 153'))) {
                      el.style.backgroundColor = '';
                      el.style.background = '';
                    }
                    return res;
                  }
                }

                // 2. Hook bảo vệ ô Đến ngày (#denngay)
                const isDenNgayField = id === 'denngay' || id === 'the_denngay' || name === 'denngay' || name === 'the_denngay' ||
                  (prevSibling && (prevSibling.id === 'denngay' || prevSibling.name === 'denngay' || prevSibling.id === 'the_denngay'));
                const activeDen = getActiveVerifiedDenNgay();
                if (isDenNgayField && activeDen) {
                  const vStr = String(value || '').trim();
                  if (vStr !== activeDen) {
                    console.log(`[BHYT Extension Main World] Hook $.fn.val (0ms): Chặn HIS gán đè (${vStr}) vào ô Đến ngày -> Ép giữ nguyên ngày từ Cổng:`, activeDen);
                    return origVal.call(this, activeDen);
                  }
                }

                // 2.1. Hook bảo vệ ô Ngày sinh / Năm sinh (#ngaysinh, #namsinh)
                const isDobField = id === 'ngaysinh' || id === 'namsinh' || name === 'ngaysinh' || name === 'namsinh' || id === 'ngaysinh_hc' || id === 'namsinh_hc' || id === 'suatt_namsinh' ||
                  (prevSibling && (prevSibling.id === 'namsinh' || prevSibling.name === 'namsinh' || prevSibling.id === 'ngaysinh' || prevSibling.name === 'ngaysinh'));
                const activeDob = getActiveVerifiedDob();
                if (isDobField && activeDob && !window.__bhytIsResettingForm && arguments.length > 0) {
                  const vStr = String(value || '').trim();
                  // CHỈ can thiệp nếu vStr không rỗng và là placeholder dd/mm/yyyy hoặc __/__/____
                  // TUYỆT ĐỐI không chặn khi value là rỗng ('') vì đó là thao tác reset/xóa form hợp lệ của HIS!
                  if (vStr && (vStr.toLowerCase() === 'dd/mm/yyyy' || vStr === '__/__/____')) {
                    console.log(`[BHYT Extension Main World] Hook $.fn.val (0ms): Chặn HIS gán placeholder (${vStr}) vào ô Ngày sinh -> Ép giữ nguyên ngày sinh Cổng:`, activeDob);
                    return origVal.call(this, activeDob);
                  }
                }

                // 2.2. Hook bảo vệ ô Số BHYT trong modal (#sobhyt_hc, #suatt_sobhyt)
                const isCardHcField = id === 'sobhyt_hc' || name === 'sobhyt_hc' || id === 'suatt_sobhyt' || name === 'suatt_sobhyt' || (isBangKePage && (id === 'sobhyt' || name === 'sobhyt'));
                if (isCardHcField && arguments.length > 0) {
                  const vStr = String(value || '').trim().replace(/\s+/g, '').toUpperCase();
                  if (vStr === '0' || value === 0) {
                    const currentGoodCard = el.dataset?.lastGoodCard || el.getAttribute?.('data-last-good-card') || el.getAttribute?.('data-last-card') ||
                                         getActiveVerifiedCardNo() || window.__lastVerifiedBhytCard ||
                                         (el.value && el.value !== '0' && el.value.length >= 8 ? el.value : '');
                    if (currentGoodCard && currentGoodCard.length >= 8) {
                      console.log(`[BHYT Extension Main World] Hook $.fn.val (0ms): Chặn HIS gán 0 vào ${id || name} -> Ép giữ thẻ BHYT:`, currentGoodCard);
                      if (window.$) {
                        try { window.$(el).data('bhyt17BaoCaoHCValue', currentGoodCard); } catch (e) {}
                      }
                      return origVal.call(this, currentGoodCard);
                    } else {
                      console.log(`[BHYT Extension Main World] Hook $.fn.val (0ms): Chặn HIS gán 0 vào ${id || name} (bỏ qua lệnh)`);
                      return this;
                    }
                  } else if (vStr && vStr.length >= 8 && vStr !== '0') {
                    if (el.dataset) el.dataset.lastGoodCard = vStr;
                    window.__lastVerifiedBhytCard = vStr;
                  }
                }

                const isDoiTuongField = id === 'doituong' || id === 'cbdoituong' || name === 'doituong';

                if (isDoiTuongField) {
                  const vStr = String(value || '').trim();
                  if (vStr === '3.3' || vStr === '3') {
                    const isCapCuu = Boolean(
                      document.getElementById('capcuu')?.checked ||
                      document.getElementById('chk_capcuu')?.checked ||
                      document.querySelector('input[name="capcuu"]')?.checked
                    );
                    if (isCapCuu) {
                      return origVal.call(this, '2');
                    }
                    const isDungTuyen = checkIsDungTuyenInMainWorld();
                    if (isDungTuyen) {
                      console.log('[BHYT Extension Main World] Hook jQuery .val("3.3") -> Chuyển thành "1.1" (Đúng tuyến)');
                      const res = origVal.call(this, '1.1');
                      syncSelect2DoiTuong(el, '1.1 - Khám bệnh, chữa bệnh đúng nơi đăng ký KCB ban đầu');
                      return res;
                    }
                    if (hasOption112(el)) {
                      console.log('[BHYT Extension Main World] Hook jQuery .val("3.3") -> Chuyển thành "1.12" (Thông tuyến)');
                      const res = origVal.call(this, '1.12');
                      syncSelect2DoiTuong(el, '1.12 - Tự đến KCB ngoại trú cấp cơ bản đạt dưới 50 điểm');
                      return res;
                    }
                    return origVal.call(this, '3.3');
                  }
                }
              }
            }
          } catch (e) {}
          return origVal.apply(this, arguments);
        };
        window.jQuery.fn.val._bhytValHooked = true;
      }
    }

    // Hook EasyUI Datebox (setValue, setText) để bảo vệ ô Từ ngày, Đến ngày, Ngày sinh
    function hookEasyUiDatebox() {
      if (window.jQuery && window.jQuery.fn && window.jQuery.fn.datebox && !window.jQuery.fn.datebox._bhytDateboxHooked) {
        const origDatebox = window.jQuery.fn.datebox;
        window.jQuery.fn.datebox = function (options, param) {
          try {
            if (typeof options === 'string' && (options === 'setValue' || options === 'setText') && this.length > 0) {
              const el = this[0];
              if (el && el.nodeType === 1) {
                const id = (el.id || '').toLowerCase();
                const name = (el.name || '').toLowerCase();
                const prevSibling = el.closest?.('.textbox, .combo')?.previousElementSibling;

                const isTu = id === 'tungay' || id === 'the_tungay' || name === 'tungay' || name === 'the_tungay' ||
                  (prevSibling && (prevSibling.id === 'tungay' || prevSibling.name === 'tungay' || prevSibling.id === 'the_tungay'));
                const activeTu = getActiveVerifiedTuNgay();
                if (isTu && activeTu) {
                  const valStr = String(param || '').trim();
                  if (valStr !== activeTu) {
                    console.log(`[BHYT Extension Main World] Hook $.fn.datebox.${options} (0ms): Chặn HIS gán đè (${valStr}) vào Từ ngày -> Ép giữ ngày Cổng:`, activeTu);
                    param = activeTu;
                  }
                }

                const isDen = id === 'denngay' || id === 'the_denngay' || name === 'denngay' || name === 'the_denngay' ||
                  (prevSibling && (prevSibling.id === 'denngay' || prevSibling.name === 'denngay' || prevSibling.id === 'the_denngay'));
                const activeDen = getActiveVerifiedDenNgay();
                if (isDen && activeDen) {
                  const valStr = String(param || '').trim();
                  if (valStr !== activeDen) {
                    console.log(`[BHYT Extension Main World] Hook $.fn.datebox.${options} (0ms): Chặn HIS gán đè (${valStr}) vào Đến ngày -> Ép giữ ngày Cổng:`, activeDen);
                    param = activeDen;
                  }
                }

                const isDob = id === 'ngaysinh' || id === 'namsinh' || name === 'ngaysinh' || name === 'namsinh' ||
                  (prevSibling && (prevSibling.id === 'namsinh' || prevSibling.name === 'namsinh' || prevSibling.id === 'ngaysinh' || prevSibling.name === 'ngaysinh'));
                const activeDob = getActiveVerifiedDob();
                if (isDob && activeDob && !window.__bhytIsResettingForm) {
                  const valStr = String(param || '').trim();
                  // Không chặn khi gán rỗng (xóa form / người dùng xóa để nhập lại)
                  if (valStr.toLowerCase() === 'dd/mm/yyyy' || valStr === '__/__/____') {
                    param = activeDob;
                  }
                }
              }
              return origDatebox.call(this, options, param);
            }
          } catch (e) {}
          return origDatebox.apply(this, arguments);
        };
        Object.assign(window.jQuery.fn.datebox, origDatebox);
        window.jQuery.fn.datebox._bhytDateboxHooked = true;

        if (origDatebox.methods) {
          const origSetValue = origDatebox.methods.setValue;
          if (origSetValue && !origSetValue._bhytHooked) {
            origDatebox.methods.setValue = function (jq, val) {
              try {
                if (!window.__bhytIsResettingForm && jq && jq.length) {
                  const el = jq[0];
                  const id = (el.id || '').toLowerCase();
                  const name = (el.name || '').toLowerCase();
                  const prevSibling = el.closest?.('.textbox, .combo')?.previousElementSibling;
                  const isTu = id === 'tungay' || id === 'the_tungay' || name === 'tungay' || name === 'the_tungay' ||
                    (prevSibling && (prevSibling.id === 'tungay' || prevSibling.name === 'tungay' || prevSibling.id === 'the_tungay'));
                  const activeTu = getActiveVerifiedTuNgay();
                  if (isTu && activeTu) {
                    const valStr = String(val || '').trim();
                    if (valStr !== activeTu) {
                      val = activeTu;
                    }
                  }
                  const isDen = id === 'denngay' || id === 'the_denngay' || name === 'denngay' || name === 'the_denngay' ||
                    (prevSibling && (prevSibling.id === 'denngay' || prevSibling.name === 'denngay' || prevSibling.id === 'the_denngay'));
                  const activeDen = getActiveVerifiedDenNgay();
                  if (isDen && activeDen) {
                    const valStr = String(val || '').trim();
                    if (valStr !== activeDen) {
                      val = activeDen;
                    }
                  }
                }
              } catch (e) {}
              return origSetValue.call(this, jq, val);
            };
            origDatebox.methods.setValue._bhytHooked = true;
          }
        }
      }
    }

    // Hook EasyUI Textbox (setValue, setText) để bảo vệ ô Từ ngày, Đến ngày
    function hookEasyUiTextbox() {
      if (window.jQuery && window.jQuery.fn && window.jQuery.fn.textbox && !window.jQuery.fn.textbox._bhytTextboxHooked) {
        const origTextbox = window.jQuery.fn.textbox;
        window.jQuery.fn.textbox = function (options, param) {
          try {
            if (typeof options === 'string' && (options === 'setValue' || options === 'setText') && this.length > 0) {
              const el = this[0];
              if (el && el.nodeType === 1) {
                const id = (el.id || '').toLowerCase();
                const name = (el.name || '').toLowerCase();
                const prevSibling = el.closest?.('.textbox, .combo')?.previousElementSibling;

                const isTu = id === 'tungay' || id === 'the_tungay' || name === 'tungay' || name === 'the_tungay' ||
                  (prevSibling && (prevSibling.id === 'tungay' || prevSibling.name === 'tungay' || prevSibling.id === 'the_tungay'));
                const activeTu = getActiveVerifiedTuNgay();
                if (isTu && activeTu) {
                  const valStr = String(param || '').trim();
                  if (valStr !== activeTu) {
                    param = activeTu;
                  }
                }

                const isDen = id === 'denngay' || id === 'the_denngay' || name === 'denngay' || name === 'the_denngay' ||
                  (prevSibling && (prevSibling.id === 'denngay' || prevSibling.name === 'denngay' || prevSibling.id === 'the_denngay'));
                const activeDen = getActiveVerifiedDenNgay();
                if (isDen && activeDen) {
                  const valStr = String(param || '').trim();
                  if (valStr !== activeDen) {
                    param = activeDen;
                  }
                }
              }
              return origTextbox.call(this, options, param);
            }
          } catch (e) {}
          return origTextbox.apply(this, arguments);
        };
        Object.assign(window.jQuery.fn.textbox, origTextbox);
        window.jQuery.fn.textbox._bhytTextboxHooked = true;

        if (origTextbox.methods) {
          const origSetVal = origTextbox.methods.setValue;
          if (origSetVal && !origSetVal._bhytHooked) {
            origTextbox.methods.setValue = function (jq, val) {
              try {
                if (jq && jq.length) {
                  const el = jq[0];
                  const id = (el.id || '').toLowerCase();
                  const name = (el.name || '').toLowerCase();
                  const prevSibling = el.closest?.('.textbox, .combo')?.previousElementSibling;
                  const isTu = id === 'tungay' || id === 'the_tungay' || name === 'tungay' || name === 'the_tungay' ||
                    (prevSibling && (prevSibling.id === 'tungay' || prevSibling.name === 'tungay' || prevSibling.id === 'the_tungay'));
                  const activeTu = getActiveVerifiedTuNgay();
                  if (isTu && activeTu) {
                    const valStr = String(val || '').trim();
                    if (valStr !== activeTu) {
                      val = activeTu;
                    }
                  }
                  const isDen = id === 'denngay' || id === 'the_denngay' || name === 'denngay' || name === 'the_denngay' ||
                    (prevSibling && (prevSibling.id === 'denngay' || prevSibling.name === 'denngay' || prevSibling.id === 'the_denngay'));
                  const activeDen = getActiveVerifiedDenNgay();
                  if (isDen && activeDen) {
                    const valStr = String(val || '').trim();
                    if (valStr !== activeDen) {
                      val = activeDen;
                    }
                  }
                }
              } catch (e) {}
              return origSetVal.call(this, jq, val);
            };
            origTextbox.methods.setValue._bhytHooked = true;
          }
        }
      }
    }

    hookJQueryVal();
    hookEasyUiDatebox();
    hookEasyUiTextbox();
    let jqValAttempts = 0;
    const jqValTimer = setInterval(() => {
      hookJQueryVal();
      hookEasyUiDatebox();
      hookEasyUiTextbox();
      jqValAttempts++;
      if (jqValAttempts >= 10 || (window.jQuery?.fn?.val?._bhytValHooked && window.jQuery?.fn?.datebox?._bhytDateboxHooked && window.jQuery?.fn?.textbox?._bhytTextboxHooked)) {
        clearInterval(jqValTimer);
      }
    }, 400);
  }

  // =========================================================================
  // GHI NHẬN DỮ LIỆU BỆNH NHÂN KHI CHỌN DÒNG TRONG JQGRID / DATAGRID (MAIN WORLD)
  // Giúp Extension Isolated World lấy trọn vẹn thông tin bệnh nhân khi người dùng
  // click hoặc dùng phím điều hướng trong Danh sách tiếp nhận
  // =========================================================================
  function setupGridRowDataCapture() {
    const isBangKe = path.includes('kiemtrabangke') || path.includes('kiemtra_bangke') || href.includes('kiemtrabangke') || path.includes('kiemtrabangkenoitru') || path.includes('kiemtrabangkebannt');
    if (isBangKe) {
      return;
    }

    function captureRow(target) {
      try {
        if (!target) return;
        // BẢO VỆ HIỆU NĂNG: Chỉ xử lý nếu tương tác nằm trong danh sách bệnh nhân / tiếp nhận / bảng kê
        const patientContainer = target.closest ? target.closest('.ui-jqgrid-btable, #list200, #danhsachtiepnhan, table[id*="danhsach"], table[id*="ds_"], table[id*="benhnhan"], table[id*="tiepnhan"], table[id*="bangke"], [id*="danhsach"], [id*="ds_bn"], [id*="dsbenhnhan"]') : null;
        if (!patientContainer) return;

        // BẢO VỆ HIỆU NĂNG: Bỏ qua tuyệt đối nếu tương tác trong khu vực Toa thuốc / Đơn thuốc / Cận lâm sàng / Combobox / Dịch vụ
        if (target.closest('.combo-panel, .combo-p, .combobox-item, [id*="toa"], [class*="toa"], [id*="donthuoc"], [class*="donthuoc"], [id*="thuoc"], [class*="thuoc"], [id*="vattu"], [id*="dichvu"], [id*="cls"], [id*="icd"], [id*="don_thuoc"], .tabs-panels')) {
          return;
        }

        const row = target?.closest ? target.closest('.ui-jqgrid-btable tr, #list200 tr, #danhsachtiepnhan tr, table[id*="danhsach"] tr, table[id*="ds_"] tr, tr.datagrid-row, tr[datagrid-row-index]') : null;
        if (!row || row.classList.contains('jqgfirstrow') || row.classList.contains('ui-jqgrid-labels') || row.closest('thead')) return;
        if (row.closest('.window, .modal, .ui-dialog, [role="dialog"], #modalLichSu, [id*="lichsu"], [id*="history"], [id*="lskcb"], [id*="kcb"], table[id*="lichsu"], [class*="history"], [id*="toa"], [class*="toa"], [id*="donthuoc"], [class*="donthuoc"], [id*="thuoc"], [class*="thuoc"], [id*="vattu"], [id*="dichvu"], [id*="cls"], [id*="icd"], .tabs-panels')) return;

        let rowData = null;
        const $ = window.$ || window.jQuery;

        // A. Thử trích xuất từ jqGrid
        const gridTable = row.closest('.ui-jqgrid-btable') || document.getElementById('list200') || document.getElementById('danhsachtiepnhan');
        if ($ && typeof $.fn?.jqGrid === 'function' && gridTable && row.id) {
          try {
            rowData = $(gridTable).jqGrid('getRowData', row.id);
          } catch (e) {}
        }

        // B. Thử trích xuất từ EasyUI DataGrid
        if ((!rowData || !Object.keys(rowData).length) && $ && typeof $.fn?.datagrid === 'function') {
          try {
            let $dg = $(row).closest('.datagrid-view, .datagrid-wrap, .panel-body').find('.easyui-datagrid, .datagrid-f');
            if (!$dg.length) $dg = $('.easyui-datagrid, .datagrid-f');
            const idx = row.getAttribute('datagrid-row-index');
            if ($dg.length && idx !== null) {
              const rows = $dg.datagrid('getRows');
              if (rows && rows[parseInt(idx, 10)]) {
                rowData = rows[parseInt(idx, 10)];
              }
            }
            if (!rowData && $dg.length) {
              rowData = $dg.datagrid('getSelected');
            }
          } catch (e) {}
        }

        // C. Fallback trích xuất trực tiếp từ các ô td của dòng
        if (!rowData || !Object.keys(rowData).length) {
          const cells = row.querySelectorAll('td');
          if (cells.length > 0) {
            const parsed = {};
            cells.forEach(td => {
              const desc = (td.getAttribute('aria-describedby') || td.getAttribute('field') || td.getAttribute('data-field') || '').toLowerCase();
              const txt = (td.textContent || td.title || '').trim();
              if (!txt) return;
              if (desc.includes('mabenhnhan') || desc.includes('mayte') || desc.includes('ma_benh_nhan') || desc.includes('ma_bn') || desc.includes('mabn')) {
                parsed.MA_BENH_NHAN = txt;
              } else if (desc.includes('hoten') || desc.includes('ten_benh_nhan') || desc.includes('tenbn') || desc.includes('ten_bn')) {
                parsed.TEN_BENH_NHAN = txt;
              } else if (desc.includes('so_the') || desc.includes('sobhyt') || desc.includes('mathe') || desc.includes('ma_the') || desc.includes('sothe')) {
                parsed.SO_THE_BHYT = txt;
              } else if (desc.includes('cmt') || desc.includes('cccd') || desc.includes('cmnd')) {
                parsed.CMT_BENHNHAN = txt;
              } else if (desc.includes('ngaysinh') || desc.includes('ngay_sinh') || desc.includes('namsinh')) {
                parsed.NGAY_SINH = txt;
              } else if (desc.includes('gioitinh') || desc.includes('gioi_tinh')) {
                parsed.GIOI_TINH = txt;
              } else if (desc.includes('diachi') || desc.includes('dia_chi')) {
                parsed.DIA_CHI = txt;
              } else if (desc.includes('noidangky') || desc.includes('ma_kcbbd') || (desc.includes('makcb') && !desc.includes('muc') && !desc.includes('tyle'))) {
                if (txt && !txt.includes('%') && !/^\d{1,3}\s*%?$/.test(txt)) {
                  parsed.NOIDANGKY_KCB = txt;
                }
              } else if (desc.includes('5nam') || desc.includes('du_5_nam') || desc.includes('thoigian_du5nam') || desc.includes('du5nam')) {
                parsed.KB_THOIDIEM_5NAM_LIENTUC = txt;
              } else if (desc.includes('sodt') || desc.includes('dienthoai') || desc.includes('so_dt') || desc.includes('sodienthoai') || desc.includes('tel') || desc.includes('phone')) {
                parsed.SO_DIEN_THOAI = txt;
              }
            });
            if (parsed.MA_BENH_NHAN || parsed.TEN_BENH_NHAN || parsed.SO_THE_BHYT || parsed.CMT_BENHNHAN) {
              rowData = parsed;
            }
          }
        }

        if (rowData && typeof rowData === 'object' && Object.keys(rowData).length > 0) {
          document.documentElement.dataset.selectedPatientJson = JSON.stringify(rowData);
          document.dispatchEvent(new CustomEvent('bhyt_grid_patient_selected', { detail: rowData }));
          window.dispatchEvent(new CustomEvent('bhyt_grid_patient_selected', { detail: rowData }));
        }
      } catch (err) {}
    }

    document.addEventListener('click', (e) => captureRow(e.target), true);

    document.addEventListener('dblclick', (e) => {
      captureRow(e.target);
      try {
        const row = e.target?.closest ? e.target.closest('.ui-jqgrid-btable tr, #list200 tr, #danhsachtiepnhan tr, table[id*="danhsach"] tr, table[id*="ds_"] tr') : null;
        if (row && row.id && window.$ && !row.closest('.window, .modal, .ui-dialog, [role="dialog"], #modalLichSu, [id*="lichsu"], [id*="history"], [id*="lskcb"], [id*="kcb"]')) {
          const gridTable = row.closest('.ui-jqgrid-btable') || document.getElementById('list200') || document.getElementById('danhsachtiepnhan');
          if (gridTable) {
            const ondbl = window.$(gridTable).jqGrid?.('getGridParam', 'ondblClickRow');
            if (typeof ondbl === 'function') {
              ondbl.call(gridTable, row.id);
            }
          }
        }
      } catch (err) {}
    }, false);

    let gridKeyTimer = null;
    let cachedPatientGrid = null;
    document.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'Enter'].includes(e.key)) {
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable || active.closest?.('.combo-panel, .combo-p, [id*="toa"], [class*="toa"], [id*="donthuoc"], [class*="donthuoc"], [id*="thuoc"], [class*="thuoc"], [id*="vattu"], [id*="dichvu"], [id*="cls"], [id*="icd"], .tabs-panels, table, .datagrid, #bhyt_bangke_inline_result'))) {
          return;
        }
        if (!cachedPatientGrid || !cachedPatientGrid.isConnected) {
          cachedPatientGrid = document.querySelector('.ui-jqgrid-btable, #list200, #danhsachtiepnhan, table[id*="danhsach"], table[id*="ds_"], table[id*="benhnhan"], table[id*="tiepnhan"], table[id*="bangke"]');
        }
        if (!cachedPatientGrid) return;

        clearTimeout(gridKeyTimer);
        gridKeyTimer = setTimeout(() => {
          const activeRow = cachedPatientGrid.querySelector('tr.ui-state-highlight, tr.datagrid-row-selected');
          if (activeRow) captureRow(activeRow);
        }, 100);
      }
    }, true);
  }

  // =========================================================================
  // =========================================================================
  // XỬ LÝ HÀNH ĐỘNG NỘI TRÚ (CHUYỂN DƯỢC, CHUYỂN BHYT, CHUYỂN KBHYT)
  // Trong Main World, có thể gọi trực tiếp các hàm JavaScript của VNPT HIS
  // - click Chuyển Dược: Mở form "Chuyển đối tượng dược"
  // - click Chuyển KBHYT: Mở form "Chuyển đổi đối tượng - dịch vụ cận lâm sàng"
  // - click Chuyển BHYT: Mở form "Chuyển đổi đối tượng - dịch vụ cận lâm sàng"
  // =========================================================================
  function setupNoiTruActionBridge() {
    document.addEventListener('bhyt_trigger_noitru_action', (event) => {
      const actionType = event.detail?.action;
      console.log('[BHYT Extension Main World] Nhận lệnh mở form hành động nội trú:', actionType);
      if (!actionType) return;

      const win = window;
      const jq = win.$ || win.jQuery;

      // 1. Thử gọi hàm JavaScript native của VNPT HIS nếu có trên window
      try {
        if (actionType === 'chuyenduoc') {
          // Danh sách hàm mở form "Chuyển đối tượng dược"
          const fns = [
            'openFormChuyenDoiTuongDuoc', 'openChuyenDoiTuongDuoc', 'chuyenDoiTuongDuoc',
            'openDialogChuyenDuoc', 'openFormChuyenDuoc', 'openChuyenDuoc', 'chuyenDuoc',
            'chuyenKhoaDuoc', 'doChuyenDuoc', 'chuyen_duoc', 'btnChuyenDuoc_Click',
            'showChuyenDuoc', 'loadChuyenDuoc', 'fn_chuyenduoc', 'f_chuyenduoc'
          ];
          for (const fnName of fns) {
            if (typeof win[fnName] === 'function') {
              console.log(`[BHYT Extension Main World] Gọi hàm native: window.${fnName}()`);
              win[fnName]();
              return;
            }
          }

          // Thử mở qua EasyUI Dialog / Window
          if (jq) {
            const dlgs = [
              '#dlg_chuyenduoc', '#dlg_chuyen_duoc', '#dlgChuyenDuoc',
              '#dlg_chuyenkhoaduoc', '#dlg_chuyendoituongduoc', '#dlg_chuyendoituong_duoc',
              '#dialog_chuyenduoc', '#win_chuyenduoc', '#win_chuyenkhoaduoc'
            ];
            for (const dId of dlgs) {
              const $d = jq(dId);
              if ($d.length) {
                try { $d.dialog('open'); return; } catch (e) {}
                try { $d.window('open'); return; } catch (e) {}
              }
            }
          }
        } else if (actionType === 'chuyenkbh' || actionType === 'chuyenbh') {
          // Cả Chuyển KBHYT và Chuyển BHYT đều mở form "Chuyển đổi đối tượng - dịch vụ cận lâm sàng"
          const fns = [
            'openFormChuyenDoiTuongCLS', 'openChuyenDoiTuongCLS', 'chuyenDoiTuongCLS',
            'openDialogChuyenDoiTuong', 'openChuyenDoiTuong', 'chuyenDoiTuong',
            'openFormChuyenDoiTuongDichVu', 'chuyenDoiTuongDichVu',
            'chuyenKBHYT', 'chuyen_kbhyt', 'chuyenKBH', 'chuyen_kbh',
            'chuyenBHYT', 'chuyen_bhyt', 'chuyenBH', 'chuyen_bh',
            'openDialogChuyenKBHYT', 'openDialogChuyenBHYT',
            'doChuyenKBHYT', 'doChuyenBHYT', 'doChuyenDoiTuong',
            'btnChuyenKBH_Click', 'btnChuyenBH_Click', 'btnChuyenDoiTuong_Click'
          ];
          for (const fnName of fns) {
            if (typeof win[fnName] === 'function') {
              console.log(`[BHYT Extension Main World] Gọi hàm native: window.${fnName}()`);
              win[fnName]();
              return;
            }
          }

          // Thử mở qua EasyUI Dialog / Window
          if (jq) {
            const dlgs = [
              '#dlg_chuyendoituong', '#dlg_chuyendoituong_cls', '#dlg_chuyen_doituong_cls',
              '#dlg_chuyenkbhyt', '#dlg_chuyenbhyt', '#dlg_chuyencls',
              '#dlg_chuyendoituongcls', '#dialog_chuyendoituong', '#win_chuyendoituong',
              '#dlg_chuyendoituongdichvu'
            ];
            for (const dId of dlgs) {
              const $d = jq(dId);
              if ($d.length) {
                try { $d.dialog('open'); return; } catch (e) {}
                try { $d.window('open'); return; } catch (e) {}
              }
            }
          }
        }
      } catch (err) {
        console.warn('[BHYT Extension Main World] Lỗi khi gọi hàm native:', err);
      }

      // 2. Thử tìm dialog hiện có trong DOM theo tiêu đề và gọi .dialog('open')
      if (jq) {
        try {
          const targetTitle = actionType === 'chuyenduoc' ? 'đối tượng dược' : 'đối tượng';
          jq('.panel.window, .window, .ui-dialog, div[id*="dlg"], div[id*="win"]').each(function() {
            const $this = jq(this);
            const title = ($this.find('.panel-title, .window-title, .ui-dialog-title').text() || '').toLowerCase();
            if (title.includes(targetTitle) || (actionType !== 'chuyenduoc' && (title.includes('cận lâm sàng') || title.includes('dịch vụ')))) {
              console.log('[BHYT Extension Main World] Tìm thấy dialog theo tiêu đề -> Mở dialog:', title);
              try { $this.dialog('open'); } catch (e) {}
              try { $this.window('open'); } catch (e) {}
            }
          });
        } catch (e) {}
      }
    });
  }

  // =========================================================================
  // XUẤT DANH SÁCH TIẾP NHẬN RA EXCEL (MAIN WORLD BRIDGE)
  // Trích xuất toàn bộ dữ liệu bệnh nhân từ jqGrid (#list200) trên form Tiếp nhận
  // Hỗ trợ xuất đúng 100% theo trang (20, 40, 60 dòng hoặc lọc) & xuất toàn bộ
  // =========================================================================
  function setupDsTiepNhanExportBridge() {
    // 1. Helper làm sạch giá trị cell (bỏ HTML tags, entities)
    function cleanCellVal(val) {
      if (val === null || val === undefined) return '';
      let s = String(val).trim();
      if (!s) return '';
      s = s.replace(/<[^>]*>/g, '').trim();
      s = s.replace(/&nbsp;/gi, ' ')
           .replace(/&amp;/gi, '&')
           .replace(/&quot;/gi, '"')
           .replace(/&lt;/gi, '<')
           .replace(/&gt;/gi, '>')
           .trim();
      return s;
    }

    // 1b. Helper bóc tách mã bệnh nhân số nguyên (loại bỏ hoàn toàn dấu '!', '*', ký tự rác)
    function cleanMaBn(val) {
      if (val === null || val === undefined) return '';
      const s = String(val).replace(/<[^>]*>/g, '').replace(/[^\d]/g, '').trim();
      if (s.length >= 3 && s.length <= 10) return s;
      return '';
    }

    // 2. Helper làm sạch row object và chuẩn hóa dữ liệu
    function cleanAndStandardizeRow(rawRow, colModel) {
      if (!rawRow || typeof rawRow !== 'object') return {};
      const row = {};
      for (const [k, v] of Object.entries(rawRow)) {
        row[k] = cleanCellVal(v);
      }

      // Nếu có _rawCell hoặc cell array từ jqGrid server response
      if (Array.isArray(rawRow.cell) && Array.isArray(colModel)) {
        colModel.forEach((col, idx) => {
          if (col && col.name) {
            row[col.name] = cleanCellVal(rawRow.cell[idx]);
          }
        });
        row._rawCell = rawRow.cell.map(cleanCellVal);
      }

      // Luôn trích xuất và làm sạch MA_BENH_NHAN (loại bỏ dứt điểm dấu '!' của VNPT HIS)
      let ma = cleanMaBn(row.MA_BENH_NHAN || row.MABENHNHAN || row.MAYTE || row.MA_YTE || row.MABN || row.MA_BN || row.SO_VAO_VIEN || row.SOVAOVIEN || '');
      if (!ma) {
        for (const [k, v] of Object.entries(row)) {
          const kl = k.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (kl.includes('mayte') || kl.includes('mabn') || kl.includes('mabenhnhan') || kl.includes('sovaovien')) {
            const c = cleanMaBn(v);
            if (c) { ma = c; break; }
          }
        }
      }
      if (!ma && Array.isArray(row._rawCell)) {
        if (row._rawCell[3]) ma = cleanMaBn(row._rawCell[3]);
        if (!ma) {
          for (const cellVal of row._rawCell) {
            const c = cleanMaBn(cellVal);
            if (c.length >= 4 && c.length <= 8) { ma = c; break; }
          }
        }
      }
      if (ma) {
        row.MA_BENH_NHAN = ma;
      }

      return row;
    }

    // 2b. Bộ giải mã dữ liệu trả về từ máy chủ VNPT HIS (Hỗ trợ đa định dạng XML và JSON)
    function parseServerResponse(textRes, colModel) {
      if (!textRes) return [];
      if (typeof textRes === 'object') {
        const rawItems = Array.isArray(textRes?.rows) ? textRes.rows :
                         (Array.isArray(textRes?.data) ? textRes.data :
                         (Array.isArray(textRes?.list) ? textRes.list :
                         (Array.isArray(textRes?.result) ? textRes.result :
                         (Array.isArray(textRes) ? textRes : []))));
        return rawItems.map(r => cleanAndStandardizeRow(r, colModel));
      }

      const cleanText = String(textRes).replace(/^\uFEFF/, '').trim();
      if (!cleanText) return [];

      // TH1: Dữ liệu dạng XML (<rows><row>...)
      if (cleanText.startsWith('<') || cleanText.includes('<rows>') || cleanText.includes('<row')) {
        try {
          const parser = new DOMParser();
          const xmlDoc = parser.parseFromString(cleanText, 'text/xml');
          const rowEls = xmlDoc.querySelectorAll('row');
          if (rowEls && rowEls.length > 0) {
            const list = [];
            rowEls.forEach(rowEl => {
              const rowObj = {};
              const id = rowEl.getAttribute('id');
              if (id) rowObj.id = id;

              // Các thẻ cell con: <cell>value</cell>
              const cellEls = rowEl.querySelectorAll('cell');
              if (cellEls && cellEls.length > 0) {
                const rawCells = [];
                cellEls.forEach((cell, idx) => {
                  const val = cleanCellVal(cell.textContent || '');
                  rawCells.push(val);
                  if (Array.isArray(colModel) && colModel[idx] && colModel[idx].name) {
                    rowObj[colModel[idx].name] = val;
                  }
                });
                rowObj._rawCell = rawCells;
              }

              // Các thẻ con trực tiếp theo tên thuộc tính
              for (let i = 0; i < rowEl.children.length; i++) {
                const ch = rowEl.children[i];
                const nodeName = ch.nodeName;
                if (nodeName && nodeName.toLowerCase() !== 'cell') {
                  rowObj[nodeName] = cleanCellVal(ch.textContent || '');
                }
              }

              list.push(cleanAndStandardizeRow(rowObj, colModel));
            });
            if (list.length > 0) return list;
          }
        } catch (errXml) {
          console.warn('[BHYT Extension Main World] Lỗi parse XML response:', errXml);
        }
      }

      // TH2: Dữ liệu dạng JSON
      try {
        const jsonRes = JSON.parse(cleanText);
        const rawItems = Array.isArray(jsonRes?.rows) ? jsonRes.rows :
                         (Array.isArray(jsonRes?.data) ? jsonRes.data :
                         (Array.isArray(jsonRes?.list) ? jsonRes.list :
                         (Array.isArray(jsonRes?.result) ? jsonRes.result :
                         (Array.isArray(jsonRes) ? jsonRes : []))));
        return rawItems.map(r => cleanAndStandardizeRow(r, colModel));
      } catch (errJson) {
        console.warn('[BHYT Extension Main World] Lỗi parse JSON response:', errJson);
      }

      return [];
    }

    // 3. Hàm tìm jqGrid Danh sách tiếp nhận (#list200)
    // 3. Hàm tìm jqGrid Danh sách tiếp nhận mục tiêu đang hiển thị
    function getTiepNhanGrid() {
      const $ = window.$ || window.jQuery;
      if (!$ || typeof $.fn?.jqGrid !== 'function') return null;

      // 1. ƯU TIÊN SỐ 1: #list200 (ID chuẩn của Danh sách tiếp nhận VNPT HIS)
      let $list200 = $('#list200');
      if ($list200.length && typeof $list200.jqGrid === 'function') {
        return $list200;
      }

      // 2. ƯU TIÊN SỐ 2: Grid nằm trong container tab Danh sách tiếp nhận (#danhsachtiepnhan hoặc gbox_list200)
      let $tabGrid = $('#danhsachtiepnhan table.ui-jqgrid-btable, #gbox_list200 table.ui-jqgrid-btable');
      if ($tabGrid.length && typeof $tabGrid.first().jqGrid === 'function') {
        return $tabGrid.first();
      }

      // 3. ƯU TIÊN SỐ 3: Grid nằm trong container chứa ô ngày #dsdenngay hoặc nút Xuất
      const anchor = document.getElementById('dsdenngay') || document.getElementById('bhytBtnXuatDsTiepNhan');
      if (anchor) {
        const container = anchor.closest('.tab-pane, [id*="danhsach"], form, div[role="tabpanel"], .ui-tabs-panel')
          || anchor.parentElement?.parentElement;
        if (container) {
          const $cGrid = $(container).find('#list200, table.ui-jqgrid-btable');
          if ($cGrid.length && typeof $cGrid.first().jqGrid === 'function') {
            return $cGrid.first();
          }
        }
      }

      // 4. Quét các bảng jqGrid và chọn bảng có điểm số cao nhất (ưu tiên có mã y tế, họ tên và số bản ghi lớn)
      const $visibleTables = $('.ui-jqgrid-btable:visible');
      let bestGrid = null;
      let maxScore = -1;

      for (let i = 0; i < $visibleTables.length; i++) {
        const $t = $($visibleTables[i]);
        const tblId = ($t.attr('id') || '').toLowerCase();
        if (tblId.includes('phong') || tblId.includes('lichsu') || tblId.includes('history')) continue;

        let score = 0;
        if (tblId === 'list200') score += 1000;
        if (tblId.includes('tiepnhan') || tblId.includes('danhsach')) score += 200;

        const colModel = (Array.isArray($t.jqGrid('getGridParam', 'colModel')) ? $t.jqGrid('getGridParam', 'colModel') : []) || [];
        const colNames = colModel.map(c => (c && c.name ? String(c.name).toLowerCase() : '')).join(' ');

        if (colNames.includes('mayte') || colNames.includes('mabn') || colNames.includes('mabenhnhan')) score += 300;
        if (colNames.includes('hoten') || colNames.includes('tenbn') || colNames.includes('tenbenhnhan')) score += 200;
        if (colNames.includes('sobhyt') || colNames.includes('thebhyt') || colNames.includes('mathe')) score += 200;

        const recs = parseInt($t.jqGrid('getGridParam', 'records') || 0, 10);
        score += recs;

        if (score > maxScore) {
          maxScore = score;
          bestGrid = $t;
        }
      }

      if (bestGrid) return bestGrid;
      return $list200.length ? $list200 : $('.ui-jqgrid-btable').first();
    }

    // 4. Lấy toàn bộ dòng hiện tại của grid (bất kể 20, 40, 60 dòng hay đã lọc)
    function getCurrentGridRows($grid) {
      const list = [];
      if (!$grid || !$grid.length) return list;

      const colModel = (Array.isArray($grid.jqGrid('getGridParam', 'colModel')) ? $grid.jqGrid('getGridParam', 'colModel') : []) || [];

      // Cách 1: Lấy qua jqGrid getRowData API
      try {
        let ids = $grid.jqGrid('getDataIDs');
        if (Array.isArray(ids) && ids.length > 0) {
          for (let i = 0; i < ids.length; i++) {
            try {
              const rd = $grid.jqGrid('getRowData', ids[i]);
              if (rd && typeof rd === 'object' && Object.keys(rd).length > 0) {
                list.push(cleanAndStandardizeRow(rd, colModel));
              }
            } catch (_) {}
          }
        }
      } catch (_) {}

      // Cách 2: Quét trực tiếp các hàng tr.jqgrow nếu API getRowData chưa lấy đủ
      if (list.length === 0 && $grid[0]) {
        try {
          const trs = $grid[0].querySelectorAll('tr.jqgrow:not(.jqgfirstrow)');
          trs.forEach(tr => {
            const row = {};
            const tds = tr.querySelectorAll('td');
            tds.forEach((td, idx) => {
              const txt = cleanCellVal(td.title || td.textContent || '');
              const col = colModel[idx];
              if (col && col.name) row[col.name] = txt;

              const aria = (td.getAttribute('aria-describedby') || '').toLowerCase();
              if (aria.includes('mayte') || aria.includes('mabn') || aria.includes('mabenhnhan')) {
                const cMa = cleanMaBn(txt);
                if (cMa) row.MA_BENH_NHAN = cMa;
              } else if (aria.includes('hoten') || aria.includes('tenbn')) {
                row.TEN_BENH_NHAN = txt;
              } else if (aria.includes('sobhyt') || aria.includes('the_bhyt')) {
                row.SO_THE_BAOHIEM_YTE = txt;
              } else if (aria.includes('phongkham') || aria.includes('phong_kham')) {
                row.TEN_PHONGKHAM = txt;
              } else if (aria.includes('lydo') || aria.includes('ly_do')) {
                row.LY_DO_VV = txt;
              }
            });
            // Bổ sung theo index mặc định của jqGrid Tiếp nhận trên VNPT HIS (chuẩn v2.1.8)
            if (tds.length >= 10) {
              if (!row.STT && tds[0]) row.STT = cleanCellVal(tds[0].title || tds[0].textContent || '');
              if (!row.TEN_PHONGKHAM && tds[1]) row.TEN_PHONGKHAM = cleanCellVal(tds[1].title || tds[1].textContent || '');
              if (!row.MA_BENH_NHAN && tds[3]) {
                const c = cleanMaBn(tds[3].title || tds[3].textContent || '');
                if (c) row.MA_BENH_NHAN = c;
              }
              if (!row.TEN_BENH_NHAN && tds[5]) row.TEN_BENH_NHAN = cleanCellVal(tds[5].title || tds[5].textContent || '');
              if (!row.SO_THE_BAOHIEM_YTE && tds[9]) row.SO_THE_BAOHIEM_YTE = cleanCellVal(tds[9].title || tds[9].textContent || '');
            }

            if (!row.MA_BENH_NHAN) {
              tds.forEach((td, idx) => {
                if (idx === 0 || idx === 2) return;
                const c = cleanMaBn(td.title || td.textContent || '');
                if (c.length >= 4 && c.length <= 10) { row.MA_BENH_NHAN = c; }
              });
            }
            if (row.MA_BENH_NHAN || row.TEN_BENH_NHAN || row.SO_THE_BAOHIEM_YTE) {
              list.push(cleanAndStandardizeRow(row, colModel));
            }
          });
        } catch (_) {}
      }

      return list;
    }

    // 4.1. Hàm bóc tách dữ liệu phản hồi JSON từ jqGrid backend
    function parseGridResponseRows(res, colModel) {
      if (!res) return [];
      let rawList = [];

      if (Array.isArray(res)) {
        rawList = res;
      } else if (res.rows && Array.isArray(res.rows)) {
        rawList = res.rows;
      } else if (res.data && Array.isArray(res.data)) {
        rawList = res.data;
      } else if (res.data && res.data.rows && Array.isArray(res.data.rows)) {
        rawList = res.data.rows;
      } else if (res.items && Array.isArray(res.items)) {
        rawList = res.items;
      }

      const result = [];
      rawList.forEach((item, idx) => {
        if (!item) return;

        // Định dạng jqGrid cell array: { id: "...", cell: ["1", "Buồng bệnh...", ...] }
        if (item.cell && Array.isArray(item.cell)) {
          const rowObj = { id: item.id || String(idx + 1) };
          item.cell.forEach((val, cIdx) => {
            const col = colModel[cIdx];
            if (col && col.name) rowObj[col.name] = cleanCellVal(val);
          });
          if (item.cell.length >= 10) {
            if (!rowObj.STT) rowObj.STT = cleanCellVal(item.cell[0]);
            if (!rowObj.TEN_PHONGKHAM) rowObj.TEN_PHONGKHAM = cleanCellVal(item.cell[1]);
            if (!rowObj.MA_BENH_NHAN) rowObj.MA_BENH_NHAN = cleanMaBn(item.cell[3]);
            if (!rowObj.TEN_BENH_NHAN) rowObj.TEN_BENH_NHAN = cleanCellVal(item.cell[5]);
            if (!rowObj.SO_THE_BAOHIEM_YTE) rowObj.SO_THE_BAOHIEM_YTE = cleanCellVal(item.cell[9]);
          }
          result.push(cleanAndStandardizeRow(rowObj, colModel));
        }
        // Định dạng object trực tiếp: { MA_BENH_NHAN: "...", TEN_BENH_NHAN: "...", ... }
        else if (typeof item === 'object') {
          result.push(cleanAndStandardizeRow(item, colModel));
        }
      });

      return result;
    }

    // 5. Hàm khai thác trực tiếp cơ chế xuất file của nút "Xuất Excel" (#xuatdanhsach) của VNPT HIS
    async function tryExtractFromHisExportExcel($grid, totalRecords, colModel) {
      const $ = window.$ || window.jQuery;
      const btn = document.getElementById('xuatdanhsach') || document.querySelector('input[name="xuatdanhsach"]');
      if (!btn) return null;

      console.log('[BHYT Extension Main World] [CHIẾN LƯỢC 1] Khám phá cơ chế nút #xuatdanhsach của HIS...');

      let exportUrl = '';
      let exportMethod = 'GET';
      let exportParams = {};

      // 5.1. Kiểm tra Form chứa nút
      const form = btn.form || btn.closest('form') || document.getElementById('frm') || document.getElementById('searchForm');
      if (form) {
        exportUrl = form.action || '';
        exportMethod = (form.method || 'POST').toUpperCase();
        if ($ && typeof $(form).serializeArray === 'function') {
          const arr = $(form).serializeArray();
          arr.forEach(item => { if (item.name) exportParams[item.name] = item.value; });
        }
      }

      // 5.2. Phân tích handler của nút #xuatdanhsach
      let handlerCode = btn.getAttribute('onclick') || '';
      if ($ && typeof $._data === 'function') {
        try {
          const ev = $._data(btn, 'events');
          if (ev && ev.click) {
            ev.click.forEach(h => {
              if (h.handler) handlerCode += '\n' + h.handler.toString();
            });
          }
        } catch (_) {}
      }

      // Tìm kiếm URL xuất trong handlerCode
      const urlMatch = handlerCode.match(/['"](\/[^'"]*(?:xuat|export|excel|danhsach)[^'"]*)['"]/i)
        || handlerCode.match(/['"]([^'"]*(?:xuat|export|excel|danhsach)[^'"]*)['"]/i);
      if (urlMatch && urlMatch[1]) {
        exportUrl = urlMatch[1];
      }

      // Kiểm tra tên hàm gọi (ví dụ onclick="xuatExcel()", xuatDanhSach()...)
      const fnMatches = handlerCode.matchAll(/([a-zA-Z0-9_$]+)\s*\(/g);
      for (const m of fnMatches) {
        const fnName = m[1];
        if (typeof window[fnName] === 'function' && fnName !== 'click' && fnName !== 'toString') {
          try {
            const fnCode = window[fnName].toString();
            console.log(`[BHYT Extension Main World] Phân tích hàm HIS ${fnName}():`, fnCode);
            const uM = fnCode.match(/['"](\/[^'"]*(?:xuat|export|excel|danhsach)[^'"]*)['"]/i)
              || fnCode.match(/['"]([^'"]*(?:xuat|export|excel|danhsach)[^'"]*)['"]/i);
            if (uM && uM[1]) {
              exportUrl = uM[1];
              break;
            }
          } catch (_) {}
        }
      }

      if (!exportUrl) {
        console.log('[BHYT Extension Main World] Không phát hiện URL trực tiếp từ #xuatdanhsach.');
        return null;
      }

      // Chuẩn hóa đường dẫn tương đối thành tuyệt đối
      if (!exportUrl.startsWith('http') && !exportUrl.startsWith('/')) {
        exportUrl = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1) + exportUrl;
      }
      console.log('[BHYT Extension Main World] Phát hiện URL xuất của HIS:', exportUrl, exportMethod);

      try {
        let reqBody = undefined;
        let reqUrl = exportUrl;
        if (exportMethod === 'POST') {
          reqBody = new URLSearchParams(exportParams);
        } else if (Object.keys(exportParams).length > 0) {
          const sep = reqUrl.includes('?') ? '&' : '?';
          reqUrl += sep + new URLSearchParams(exportParams).toString();
        }

        const response = await fetch(reqUrl, {
          method: exportMethod,
          headers: { 'X-Requested-With': 'XMLHttpRequest' },
          body: reqBody
        });

        if (response.ok) {
          const buf = await response.arrayBuffer();
          const xlsxLib = window.XLSX || (typeof XLSX !== 'undefined' ? XLSX : null);
          if (buf && buf.byteLength > 200 && xlsxLib && xlsxLib.read) {
            const wb = xlsxLib.read(new Uint8Array(buf), { type: 'array' });
            const sheet = wb.Sheets[wb.SheetNames[0]];
            const tableData = xlsxLib.utils.sheet_to_json(sheet, { header: 1, defval: '' });

            console.log(`[BHYT Extension Main World] Đọc thành công file Excel HIS: ${tableData.length} dòng.`);

            // Tìm dòng tiêu đề cột
            let headerRowIdx = -1;
            let colIdxMap = { stt: -1, ma: -1, ten: -1, the: -1, phong: -1 };

            for (let r = 0; r < Math.min(12, tableData.length); r++) {
              const row = tableData[r];
              if (Array.isArray(row)) {
                row.forEach((cell, c) => {
                  const str = String(cell || '').toLowerCase().trim();
                  if (str.includes('stt')) colIdxMap.stt = c;
                  else if (str.includes('mã y tế') || str.includes('mã bn') || str.includes('mã bệnh nhân') || str === 'mabn' || str === 'mayte') colIdxMap.ma = c;
                  else if (str.includes('họ') || str.includes('tên') || str.includes('người bệnh') || str === 'hoten') colIdxMap.ten = c;
                  else if (str.includes('thẻ') || str.includes('bhyt') || str === 'sobhyt') colIdxMap.the = c;
                  else if (str.includes('phòng') || str.includes('khoa') || str === 'phongkham') colIdxMap.phong = c;
                });
                if (colIdxMap.ma !== -1 && (colIdxMap.ten !== -1 || colIdxMap.stt !== -1)) {
                  headerRowIdx = r;
                  break;
                }
              }
            }

            if (headerRowIdx !== -1 && colIdxMap.ma !== -1) {
              const parsedPatients = [];
              for (let r = headerRowIdx + 1; r < tableData.length; r++) {
                const row = tableData[r];
                if (!Array.isArray(row) || row.length === 0) continue;
                const rawMa = colIdxMap.ma !== -1 ? row[colIdxMap.ma] : '';
                const cMa = cleanMaBn(rawMa);
                if (!cMa) continue;

                const pItem = {
                  STT: colIdxMap.stt !== -1 ? cleanCellVal(row[colIdxMap.stt]) : String(parsedPatients.length + 1),
                  MA_BENH_NHAN: cMa,
                  TEN_BENH_NHAN: colIdxMap.ten !== -1 ? cleanCellVal(row[colIdxMap.ten]) : '',
                  SO_THE_BAOHIEM_YTE: colIdxMap.the !== -1 ? cleanCellVal(row[colIdxMap.the]) : '',
                  TEN_PHONGKHAM: colIdxMap.phong !== -1 ? cleanCellVal(row[colIdxMap.phong]) : ''
                };
                parsedPatients.push(cleanAndStandardizeRow(pItem, colModel));
              }

              if (parsedPatients.length > 0) {
                console.log(`[BHYT Extension Main World] [CHIẾN LƯỢC 1 THÀNH CÔNG] Khai thác được ${parsedPatients.length} bệnh nhân từ file Excel của HIS!`);
                return parsedPatients;
              }
            }
          }
        }
      } catch (errExcel) {
        console.warn('[BHYT Extension Main World] Lỗi khi khai thác nút xuất HIS:', errExcel);
      }

      return null;
    }

    function removeDiacritics(str) {
      if (!str || typeof str !== 'string') return '';
      return str.normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'd')
        .toLowerCase()
        .trim();
    }

    function getActiveGridFilters($grid, colModel) {
      const filters = [];
      if (!$grid || !$grid.length) return filters;
      const $ = window.$ || window.jQuery;

      // 1. Kiểm tra postData.filters (chuẩn jqGrid)
      try {
        const postData = $grid.jqGrid('getGridParam', 'postData');
        if (postData) {
          if (typeof postData.filters === 'string' && postData.filters.trim()) {
            const parsed = JSON.parse(postData.filters);
            if (Array.isArray(parsed.rules)) {
              parsed.rules.forEach(r => {
                if (r && r.field && r.data) {
                  filters.push({ field: String(r.field).trim(), val: String(r.data).trim(), op: r.op || 'cn' });
                }
              });
            }
          }
          if (postData.searchField && postData.searchString) {
            filters.push({ field: String(postData.searchField).trim(), val: String(postData.searchString).trim(), op: postData.searchOper || 'cn' });
          }
        }
      } catch (_) {}

      // 2. Quét trực tiếp các ô input trong ui-search-toolbar trên header của jqGrid
      try {
        const $container = $grid.closest('.ui-jqgrid');
        const $toolbarInputs = $container.find('.ui-search-toolbar input, tr.ui-search-toolbar input');
        $toolbarInputs.each(function() {
          const val = $(this).val();
          if (val && typeof val === 'string' && val.trim()) {
            const rawVal = val.trim();
            let colName = $(this).attr('name') || '';
            const inputId = $(this).attr('id') || '';
            if (!colName && inputId.startsWith('gs_')) {
              colName = inputId.substring(3);
            }
            if (!colName) {
              const th = $(this).closest('th, td');
              const thId = th.attr('id') || '';
              if (thId.startsWith($grid[0].id + '_')) {
                colName = thId.substring($grid[0].id.length + 1);
              } else {
                const idx = th.index();
                if (colModel && colModel[idx]) {
                  colName = colModel[idx].name;
                }
              }
            }
            if (colName && !filters.some(f => f.field.toLowerCase() === colName.toLowerCase())) {
              filters.push({ field: colName, val: rawVal, op: 'cn' });
            }
          }
        });
      } catch (_) {}

      return filters;
    }

    function rowMatchesFilters(row, filters) {
      if (!filters || filters.length === 0) return true;
      for (const f of filters) {
        const filterVal = f.val.toLowerCase();
        const filterValNoAcc = removeDiacritics(f.val);
        let cellVal = '';
        if (f.isStatus) {
          cellVal = String(row.TRANG_THAI || row.TRANGTHAI || row.TEN_TRANGTHAI || row.TENTRANGTHAI || row.STATUS || row.TINHTRANG || '');
          if (!cellVal) {
            for (const [k, v] of Object.entries(row)) {
              if (k.toLowerCase().includes('trangthai') || k.toLowerCase().includes('status')) {
                cellVal = String(v || '');
                break;
              }
            }
          }
        } else if (row[f.field] !== undefined) {
          cellVal = String(row[f.field] || '');
        } else {
          const targetKey = f.field.toLowerCase().replace(/[^a-z0-9]/g, '');
          for (const [k, v] of Object.entries(row)) {
            if (k.toLowerCase().replace(/[^a-z0-9]/g, '') === targetKey) {
              cellVal = String(v || '');
              break;
            }
          }
        }
        const cValLower = cleanCellVal(cellVal).toLowerCase();
        const cValNoAcc = removeDiacritics(cellVal);
        if (!cValLower.includes(filterVal) && !cValNoAcc.includes(filterValNoAcc)) {
          return false;
        }
      }
      return true;
    }

    const handleExportRequest = async (e) => {
      const exportMode = e?.detail?.mode || 'current_page';
      const $ = window.$ || window.jQuery;
      const $grid = getTiepNhanGrid();

      const finishExport = (rows) => {
        const safeRows = Array.isArray(rows) ? rows : [];
        console.log(`[BHYT Extension Main World] Hoàn tất trích xuất (${exportMode}): ${safeRows.length} bệnh nhân.`);
        try {
          if (safeRows.length > 0) {
            document.documentElement.dataset.dsTiepNhanExportJson = JSON.stringify(safeRows);
          }
        } catch (_) {}
        const evt = new CustomEvent('bhyt-ext-export-ds-tiepnhan-data', {
          detail: { rows: safeRows, mode: exportMode }
        });
        window.dispatchEvent(evt);
        document.dispatchEvent(evt);
      };

      try {
        if (!$grid || !$grid.length) {
          console.warn('[BHYT Extension Main World] Không tìm thấy jqGrid Danh sách tiếp nhận (#list200).');
          finishExport([]);
          return;
        }

        const colModel = (Array.isArray($grid.jqGrid('getGridParam', 'colModel')) ? $grid.jqGrid('getGridParam', 'colModel') : []) || [];
        const currentRows = getCurrentGridRows($grid);

        // NẾU XUẤT TRANG HIỆN TẠI (current_page):
        // Trả về ngay lập tức currentRows!
        // Số lượng dòng chính xác 100% theo lựa chọn 20, 40, 60 hoặc theo bộ lọc tìm kiếm!
        if (exportMode === 'current_page') {
          console.log(`[BHYT Extension Main World] Xuất trang hiện tại: ${currentRows.length} bệnh nhân.`);
          finishExport(currentRows);
          return;
        }

        // NẾU XUẤT TOÀN BỘ (all):
        const pagerSelector = $grid[0]?.p?.pager;
        let $pager = pagerSelector ? $(pagerSelector) : $grid.closest('.ui-jqgrid').find('.ui-jqgrid-pager');
        if (!$pager.length || !$pager.is(':visible')) {
          $pager = $('.ui-jqgrid-pager:visible').first();
        }

        let totalRecords = parseInt($grid.jqGrid('getGridParam', 'records') || 0, 10);
        let totalPages = parseInt($grid.jqGrid('getGridParam', 'lastpage') || 0, 10);
        let activeRowNum = parseInt($grid.jqGrid('getGridParam', 'rowNum') || 0, 10);
        let origPage = parseInt($grid.jqGrid('getGridParam', 'page') || 1, 10);

        if ($pager.length) {
          const pagerText = $pager.find('.ui-paging-info').text() || '';
          const nums = pagerText.match(/\d+/g);
          if (nums && nums.length >= 3) {
            const parsedTotal = parseInt(nums[nums.length - 1], 10) || 0;
            if (parsedTotal > totalRecords) totalRecords = parsedTotal;
          } else if (nums && nums.length > 0) {
            const m = pagerText.match(/[\/\s](\d+)/);
            if (m) {
              const parsedTotal = parseInt(m[1], 10) || 0;
              if (parsedTotal > totalRecords) totalRecords = parsedTotal;
            }
          }

          const totalPagesText = $pager.find('.ui-pg-total, [id^="sp_1_"]').text() || '';
          const pNums = totalPagesText.match(/\d+/);
          if (pNums) {
            const parsedPages = parseInt(pNums[0], 10) || 0;
            if (parsedPages > totalPages) totalPages = parsedPages;
          }

          const selVal = parseInt($pager.find('.ui-pg-selbox').val() || 0, 10);
          if (selVal > 0) activeRowNum = selVal;

          const pageInputVal = parseInt($pager.find('.ui-pg-input').val() || 0, 10);
          if (pageInputVal > 0) origPage = pageInputVal;
        }

        if (!activeRowNum) activeRowNum = (currentRows.length > 0 ? currentRows.length : 20);
        if (totalRecords === 0) totalRecords = currentRows.length;
        if (!totalPages || totalPages <= 0) {
          totalPages = Math.ceil(totalRecords / activeRowNum) || 1;
        }
        if (totalRecords > 0 && activeRowNum > 0) {
          const calcPages = Math.ceil(totalRecords / activeRowNum);
          if (calcPages > totalPages) totalPages = calcPages;
        }

        console.log(`[BHYT Extension Main World] Xuất toàn bộ danh sách: ${totalRecords} bản ghi (${totalPages} trang), số dòng/trang: ${activeRowNum}...`);

        // Lưu thông số vào dataset để Content Script có thể đồng bộ ngay
        try {
          if (totalRecords > 0) document.documentElement.dataset.hisGridRecords = totalRecords;
          if (totalPages > 0) document.documentElement.dataset.hisGridLastpage = totalPages;
          if (origPage > 0) document.documentElement.dataset.hisGridPage = origPage;
          if (activeRowNum > 0) document.documentElement.dataset.hisGridRowNum = activeRowNum;
        } catch (_) {}

        // CHỈ THOÁT SỚM NẾU TỔNG SỐ TRANG <= 1 HOẶC TỔNG SỐ BẢN GHI <= SỐ DÒNG TRANG HIỆN TẠI
        if (totalPages <= 1 || (totalRecords <= currentRows.length && totalRecords > 0)) {
          console.log(`[BHYT Extension Main World] Chỉ có 1 trang (${currentRows.length} bản ghi), trả về ngay trang hiện tại.`);
          finishExport(currentRows);
          return;
        }

        const emitProgress = (msg, current, total, count) => {
          try {
            const evt = new CustomEvent('bhyt-ext-export-progress', {
              detail: { message: msg, current, total, count }
            });
            window.dispatchEvent(evt);
            document.dispatchEvent(evt);
          } catch (_) {}

          // Cập nhật an toàn chữ trên nút với font sạch đẹp
          const exportBtn = document.getElementById('bhytBtnXuatDsTiepNhan');
          if (exportBtn) {
            exportBtn.innerHTML = `
              <svg class="bhyt-btn-icon-excel" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display: inline-block; flex-shrink: 0; pointer-events: none !important;">
                <rect x="1.5" y="1.5" width="13" height="13" rx="2.5" />
                <line x1="1.5" y1="8" x2="14.5" y2="8" />
                <line x1="8" y1="1.5" x2="8" y2="14.5" />
              </svg>
              <span class="bhyt-btn-xuat-text" style="color: #ffffff !important; font-weight: 600 !important; font-size: 12px !important; line-height: 1 !important; white-space: nowrap !important; display: inline-block; pointer-events: none !important; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif !important; -webkit-font-smoothing: antialiased !important; text-shadow: none !important;">${msg}</span>
            `;
          }
        };

        // =========================================================================
        // TIER 1: TRÍCH XUẤT TRỰC TIẾP TỪ BỘ NHỚ JQGRID (allData) KẾT HỢP BỘ LỌC
        // Nếu không có bộ lọc: allData khớp chính xác totalRecords -> Xuất ngay lập tức!
        // Nếu có bộ lọc: Lọc allData theo các ô tìm kiếm cột (.ui-search-toolbar) -> Khớp totalRecords -> Xuất ngay!
        // =========================================================================
        try {
          const allData = $grid.jqGrid('getGridParam', 'data');
          if (Array.isArray(allData) && allData.length > 0 && totalRecords > 0) {
            // Trường hợp 1: Không có bộ lọc cột hoặc allData bằng đúng totalRecords
            if (allData.length === totalRecords) {
              console.log(`[BHYT Extension Main World] [TIER 1] Toàn bộ ${allData.length} BN trong allData khớp chính xác totalRecords (${totalRecords} BN).`);
              const cleaned = allData.map(r => cleanAndStandardizeRow(r, colModel));
              finishExport(cleaned);
              return;
            }

            // Trường hợp 2: Có bộ lọc đang áp dụng trên màn hình
            const activeFilters = getActiveGridFilters($grid, colModel);
            console.log(`[BHYT Extension Main World] [TIER 1] Phát hiện ${activeFilters.length} bộ lọc đang kích hoạt trên màn hình:`, activeFilters);

            if (activeFilters.length > 0) {
              const filtered = allData.filter(r => rowMatchesFilters(r, activeFilters));
              console.log(`[BHYT Extension Main World] [TIER 1] Kết quả lọc allData: ${filtered.length}/${allData.length} BN (Mục tiêu totalRecords: ${totalRecords}).`);
              if (filtered.length === totalRecords || Math.abs(filtered.length - totalRecords) <= 1) {
                console.log(`[BHYT Extension Main World] [TIER 1] Lọc in-memory khớp hoàn hảo: ${filtered.length} BN!`);
                const cleaned = filtered.map(r => cleanAndStandardizeRow(r, colModel));
                finishExport(cleaned);
                return;
              }
            }
          }
        } catch (eTier1) {
          console.warn('[BHYT Extension Main World] Lỗi Tier 1:', eTier1);
        }

        // =========================================================================
        // TIER 2: MỞ RỘNG TẠM THỜI rowNum LÊN totalRecords ĐỂ LẤY TOÀN BỘ TRONG 1 NHỊP
        // Khi rowNum >= totalRecords, jqGrid sẽ render toàn bộ các dòng đã lọc lên màn hình trong 1 nhịp
        // =========================================================================
        try {
          emitProgress(`⏳ Đang tải toàn bộ ${totalRecords} BN...`, 1, 1, 0);
          const origRowNum = parseInt($grid.jqGrid('getGridParam', 'rowNum') || 20, 10);
          const origPage = parseInt($grid.jqGrid('getGridParam', 'page') || 1, 10);
          const targetExpNum = Math.max(totalRecords + 20, 1000);

          $grid.jqGrid('setGridParam', { rowNum: targetExpNum, page: 1 }).trigger('reloadGrid', [{ current: true }]);
          await new Promise(r => setTimeout(r, 250));

          const expandedRows = getCurrentGridRows($grid);
          if (Array.isArray(expandedRows) && expandedRows.length >= totalRecords && totalRecords > 0) {
            console.log(`[BHYT Extension Main World] [TIER 2] Mở rộng rowNum thành công: ${expandedRows.length} BN!`);
            // Khôi phục lại rowNum ban đầu
            $grid.jqGrid('setGridParam', { rowNum: origRowNum, page: origPage }).trigger('reloadGrid', [{ current: true }]);
            finishExport(expandedRows);
            return;
          }
          // Khôi phục nếu chưa đủ
          $grid.jqGrid('setGridParam', { rowNum: origRowNum, page: origPage }).trigger('reloadGrid', [{ current: true }]);
        } catch (eTier2) {
          console.warn('[BHYT Extension Main World] Lỗi Tier 2:', eTier2);
        }

        // =========================================================================
        // TIER 3: LẬT TRANG TUẦN TỰ JQGRID (PAGING STEPPER AUTOMATION TRONG MAIN WORLD)
        // Đảm bảo 100% dữ liệu xuất ra ĐÚNG THEO BỘ LỌC HIỆN TẠI trên màn hình
        // =========================================================================
        console.log(`[BHYT Extension Main World] [TIER 3] Bắt đầu lật trang tự động thu thập ${totalPages} trang (${totalRecords} BN theo bộ lọc)...`);
        const allStepperRows = [];
        const seenKeys = new Set();

        const addRowsToStepper = (rows) => {
          if (!Array.isArray(rows)) return;
          rows.forEach((r, idx) => {
            const ma = r.MA_BENH_NHAN || '';
            const the = r.SO_THE_BAOHIEM_YTE || '';
            const pk = r.TEN_PHONGKHAM || '';
            const phieu = r.PHIEU || '';
            const stt = r.STT || '';
            const ten = r.TEN_BENH_NHAN || '';
            // Khóa duy nhất theo bản ghi thực tế, không dùng tr.id để tránh trùng giữa các trang
            const key = `${ma}_${the}_${phieu}_${ten}_${pk}_${stt}` || `r_${allStepperRows.length}`;
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              allStepperRows.push(r);
            }
          });
        };

        // Đọc ngay các dòng của trang hiện tại
        addRowsToStepper(currentRows);

        const goToPageAndWaitMainWorld = (targetPage) => {
          return new Promise((resolve) => {
            let isDone = false;
            let timer = null;

            const cleanup = () => {
              if (isDone) return;
              isDone = true;
              if (timer) clearTimeout(timer);
              $(document).off('ajaxComplete', onAjaxComplete);
              $grid.off('jqGridLoadComplete', onGridComplete);
              setTimeout(resolve, 250); // Đợi 250ms để jqGrid cập nhật xong DOM
            };

            const onAjaxComplete = (event, xhr, settings) => {
              cleanup();
            };
            const onGridComplete = () => {
              cleanup();
            };

            $(document).on('ajaxComplete', onAjaxComplete);
            $grid.on('jqGridLoadComplete', onGridComplete);
            timer = setTimeout(cleanup, 3500); // Timeout an toàn 3.5s

            // Ra lệnh jqGrid chuyển trang CHUẨN XÁC:
            // BẮT BUỘC TRUYỀN [{ page: targetPage, current: true }] để jqGrid không reset về trang 1!
            try {
              $grid.jqGrid('setGridParam', { page: targetPage }).trigger('reloadGrid', [{ page: targetPage, current: true }]);
            } catch (eGrid) {
              console.warn('[BHYT Extension Main World] Lỗi setGridParam/reloadGrid:', eGrid);
            }

            // Đồng thời kích hoạt qua pager controls
            try {
              const $pg = ($pager && $pager.length) ? $pager : $($grid[0]?.p?.pager || '.ui-jqgrid-pager:visible');
              if ($pg.length) {
                const $input = $pg.find('.ui-pg-input');
                if ($input.length) {
                  $input.val(targetPage);
                  $input.trigger($.Event('keydown', { which: 13, keyCode: 13 }));
                  $input.trigger($.Event('keypress', { which: 13, keyCode: 13 }));
                }
              }
            } catch (_) {}
          });
        };

        for (let p = 1; p <= totalPages; p++) {
          if (p === origPage) continue;

          emitProgress(`⏳ Đang đọc trang ${p}/${totalPages} (${allStepperRows.length} BN)...`, p, totalPages, allStepperRows.length);
          console.log(`[BHYT Extension Main World] Đang lật sang trang ${p}/${totalPages}...`);
          await goToPageAndWaitMainWorld(p);

          const pageRows = getCurrentGridRows($grid);
          addRowsToStepper(pageRows);
          console.log(`[BHYT Extension Main World] Sau trang ${p}: thu được ${allStepperRows.length} BN.`);
        }

        // Khôi phục lại đúng trang ban đầu cho người dùng trên màn hình
        emitProgress(`⏳ Đang hoàn tất (${allStepperRows.length} BN)...`, totalPages, totalPages, allStepperRows.length);
        await goToPageAndWaitMainWorld(origPage);

        console.log(`[BHYT Extension Main World] Lật trang hoàn tất! Tổng cộng thu được ${allStepperRows.length} bệnh nhân.`);
        finishExport(allStepperRows.length > 0 ? allStepperRows : currentRows);
        return;
      } catch (err) {
        console.warn('[BHYT Extension Main World] Lỗi khi xử lý xuất DS tiếp nhận:', err);
        finishExport([]);
      }
    };

    // Lắng nghe sự kiện yêu cầu chuyển trang jqGrid từ Content Script
    const onGotoPage = (e) => {
      try {
        const p = e.detail?.page;
        if (!p) return;
        const $ = window.$ || window.jQuery;
        if (!$ || typeof $.fn?.jqGrid !== 'function') return;
        const $grid = getTiepNhanGrid();
        if ($grid && $grid.length && typeof $grid.jqGrid === 'function') {
          console.log(`[BHYT Extension Main World] Nhận lệnh chuyển trang jqGrid sang trang ${p}...`);
          $grid.jqGrid('setGridParam', { page: p }).trigger('reloadGrid', [{ page: p, current: true }]);
          try {
            const pager = $grid[0]?.p?.pager;
            const $pg = pager ? $(pager) : $grid.closest('.ui-jqgrid').find('.ui-jqgrid-pager');
            if ($pg.length) {
              const $input = $pg.find('.ui-pg-input');
              if ($input.length) {
                $input.val(p);
                $input.trigger($.Event('keydown', { which: 13, keyCode: 13 }));
                $input.trigger($.Event('keypress', { which: 13, keyCode: 13 }));
              }
            }
          } catch (_) {}
        }
      } catch (err) {
        console.warn('[BHYT Extension Main World] Lỗi khi chuyển trang jqGrid:', err);
      }
    };
    window.addEventListener('bhyt-ext-goto-page', onGotoPage);
    document.addEventListener('bhyt-ext-goto-page', onGotoPage);

    window.addEventListener('bhyt-ext-export-ds-tiepnhan', handleExportRequest);
    document.addEventListener('bhyt-ext-export-ds-tiepnhan', handleExportRequest);

    // Tự động lắng nghe ajaxComplete để phát tín hiệu lưới đã reload xong & lưu bản sao dữ liệu vào DOM
    try {
      const $ = window.$ || window.jQuery;
      if ($ && typeof $(document).ajaxComplete === 'function') {
        $(document).ajaxComplete(function(event, xhr, settings) {
          try {
            const relEvt = new CustomEvent('bhyt-ext-grid-reloaded');
            window.dispatchEvent(relEvt);
            document.dispatchEvent(relEvt);
          } catch (_) {}
          try {
            const $grid = getTiepNhanGrid();
            if ($grid && $grid.length && typeof $grid.jqGrid === 'function') {
              const currentList = getCurrentGridRows($grid);
              if (currentList.length > 0) {
                document.documentElement.dataset.dsTiepNhanExportJson = JSON.stringify(currentList);
              }
              const recs = $grid.jqGrid('getGridParam', 'records');
              const lastp = $grid.jqGrid('getGridParam', 'lastpage');
              const curp = $grid.jqGrid('getGridParam', 'page');
              const rowN = $grid.jqGrid('getGridParam', 'rowNum');
              if (recs) document.documentElement.dataset.hisGridRecords = recs;
              if (lastp) document.documentElement.dataset.hisGridLastpage = lastp;
              if (curp) document.documentElement.dataset.hisGridPage = curp;
              if (rowN) document.documentElement.dataset.hisGridRowNum = rowN;
            }
          } catch (_) {}
        });
      }
    } catch (_) {}
  }

  setupNoiTruActionBridge();

  setupGridRowDataCapture();

  setupDsTiepNhanExportBridge();

})();






