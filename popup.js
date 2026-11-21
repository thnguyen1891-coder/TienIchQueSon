/**
 * Logic xử lý cho Popup Chrome Extension Kiểm Tra Thẻ BHYT
 * Đơn vị: Trung tâm Y tế khu vực Quế Sơn
 */

const DEFAULT_CONFIG = {
  cskcbCode: '49008',
  orgName: 'Trung tâm Y tế khu vực Quế Sơn',
  capChuyenMon: 'Cơ bản',
  diemXepCap: 25,
  bhxh_user: '',
  bhxh_pass: ''
};

// State ứng dụng
let currentConfig = { ...DEFAULT_CONFIG };
let currentResultData = null;

// Lấy Origin của tab HIS đang mở
async function getActiveHisOrigin() {
  try {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs && tabs[0] && tabs[0].url) {
        const u = new URL(tabs[0].url);
        if (u.protocol.startsWith('http')) {
          return u.origin;
        }
      }
    }
  } catch (e) {}
  return '';
}

// ==========================================
// 1. TIỆN ÍCH LƯU TRỮ (CHROME STORAGE / FALLBACK)
// ==========================================
const Storage = {
  async get(keys) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return new Promise((resolve) => {
        chrome.storage.local.get(keys, resolve);
      });
    } else {
      const res = {};
      const keyList = Array.isArray(keys) ? keys : [keys];
      keyList.forEach(k => {
        const val = localStorage.getItem(k);
        if (val) {
          try { res[k] = JSON.parse(val); } catch(e) { res[k] = val; }
        }
      });
      return res;
    }
  },

  async set(items) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return new Promise((resolve) => {
        chrome.storage.local.set(items, resolve);
      });
    } else {
      Object.keys(items).forEach(k => {
        localStorage.setItem(k, JSON.stringify(items[k]));
      });
    }
  }
};

// ==========================================
// 2. KHỞI TẠO VÀ DOM ELEMENTS
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  initElements();
  initTabs();
  initEvents();
  await loadConfiguration();
  await checkBhxhConnection(false);
  await loadHistory();
});

let dom = {};

function initElements() {
  dom = {
    // Header
    headerOrgName: document.getElementById('headerOrgName'),
    headerConnectionBadge: document.getElementById('headerConnectionBadge'),

    // Tabs
    tabButtons: document.querySelectorAll('.tab-btn'),
    tabPanes: document.querySelectorAll('.tab-pane'),
    btnTabResult: document.getElementById('btnTabResult'),

    // Search Tab
    formSearch: document.getElementById('formSearch'),
    inputCccd: document.getElementById('inputCccd'),
    inputHoTen: document.getElementById('inputHoTen'),
    inputNgaySinh: document.getElementById('inputNgaySinh'),
    inputMaThe: document.getElementById('inputMaThe'),
    btnClearCccd: document.getElementById('btnClearCccd'),
    btnResetForm: document.getElementById('btnResetForm'),
    btnSubmit: document.getElementById('btnSubmit'),
    searchLoading: document.getElementById('searchLoading'),
    searchError: document.getElementById('searchError'),
    searchErrorMessage: document.getElementById('searchErrorMessage'),

    // Result Tab
    resultEmpty: document.getElementById('resultEmpty'),
    resultCard: document.getElementById('resultCard'),
    btnGoToSearch: document.getElementById('btnGoToSearch'),
    cardStatusBanner: document.getElementById('cardStatusBanner'),
    cardStatusIcon: document.getElementById('cardStatusIcon'),
    cardStatusText: document.getElementById('cardStatusText'),
    cardStatusSub: document.getElementById('cardStatusSub'),
    resMaThe: document.getElementById('resMaThe'),
    resHoTen: document.getElementById('resHoTen'),
    resNgaySinh: document.getElementById('resNgaySinh'),
    resGioiTinh: document.getElementById('resGioiTinh'),
    resCccd: document.getElementById('resCccd'),
    resGtTu: document.getElementById('resGtTu'),
    resGtDen: document.getElementById('resGtDen'),
    resNgay5Nam: document.getElementById('resNgay5Nam'),
    resMucHuong: document.getElementById('resMucHuong'),
    resDoiTuong: document.getElementById('resDoiTuong'),
    resDkbd: document.getElementById('resDkbd'),
    resDiaChi: document.getElementById('resDiaChi'),
    btnCopyMaThe: document.getElementById('btnCopyMaThe'),
    btnCopyAll: document.getElementById('btnCopyAll'),
    btnReSearch: document.getElementById('btnReSearch'),

    // History Tab
    historyList: document.getElementById('historyList'),
    btnClearHistory: document.getElementById('btnClearHistory'),

    // Settings Tab (4 Ô Dữ Liệu Cài Đặt)
    formSettings: document.getElementById('formSettings'),
    inputMaCSKCB: document.getElementById('inputMaCSKCB'),
    inputTenCSKCB: document.getElementById('inputTenCSKCB'),
    selectCapChuyenMon: document.getElementById('selectCapChuyenMon'),
    inputDiemXepCap: document.getElementById('inputDiemXepCap'),
    connStatusBadge: document.getElementById('connStatusBadge'),
    connDetails: document.getElementById('connDetails'),
    connCskcbUser: document.getElementById('connCskcbUser'),
    btnTestConnection: document.getElementById('btnTestConnection'),
    btnSaveSettings: document.getElementById('btnSaveSettings'),
    btnAutoDetectHis: document.getElementById('btnAutoDetectHis'),
    settingsAlertBox: document.getElementById('settingsAlertBox'),
    inputBhxhPass: document.getElementById('inputBhxhPass'),

    // Toast
    toastMessage: document.getElementById('toastMessage')
  };
}

// ==========================================
// 3. ĐIỀU HƯỚNG TABS
// ==========================================
function initTabs() {
  dom.tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTabId = btn.getAttribute('data-tab');
      switchTab(targetTabId);
    });
  });
}

function switchTab(tabId) {
  dom.tabButtons.forEach(b => {
    b.classList.toggle('active', b.getAttribute('data-tab') === tabId);
  });
  dom.tabPanes.forEach(pane => {
    pane.classList.toggle('active', pane.id === tabId);
  });

  if (tabId === 'tab-history') {
    loadHistory();
  }
}

// ==========================================
// 4. LẮNG NGHE SỰ KIỆN FORM VÀ HÀNH ĐỘNG
// ==========================================
function initEvents() {
  updateCccdBadge();
  // Tự động viết hoa họ tên khi nhập
  dom.inputHoTen.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
  });

  // Tự động viết hoa mã thẻ
  dom.inputMaThe.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
  });

  // Chỉ cho phép nhập số trong ô CCCD và cập nhật bộ đếm
  dom.inputCccd.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '');
    updateCccdBadge();
  });

  // Tự động nhận dạng Ngày sinh (DD/MM/YYYY hoặc YYYY)
  dom.inputNgaySinh.addEventListener('input', (e) => {
    const raw = e.target.value;
    const digitsOnly = raw.replace(/\D/g, '');
    if (digitsOnly.length === 8 && !raw.includes('/')) {
      e.target.value = `${digitsOnly.slice(0, 2)}/${digitsOnly.slice(2, 4)}/${digitsOnly.slice(4, 8)}`;
    }
  });

  dom.inputNgaySinh.addEventListener('blur', (e) => {
    const val = e.target.value.trim();
    if (!val) return;
    const digitsOnly = val.replace(/\D/g, '');
    // 4 số: nhận dạng năm sinh YYYY
    if (digitsOnly.length === 4 && (digitsOnly.startsWith('19') || digitsOnly.startsWith('20'))) {
      e.target.value = digitsOnly;
      return;
    }
    // 8 số: nhận dạng ngày sinh đầy đủ DD/MM/YYYY
    if (digitsOnly.length === 8) {
      e.target.value = `${digitsOnly.slice(0, 2)}/${digitsOnly.slice(2, 4)}/${digitsOnly.slice(4, 8)}`;
      return;
    }
    // Dạng có ký tự phân cách / hoặc - hoặc .
    const parts = val.split(/[\/\-\.]/);
    if (parts.length === 3) {
      const d = parts[0].padStart(2, '0');
      const m = parts[1].padStart(2, '0');
      let y = parts[2];
      if (y.length === 2) y = (parseInt(y, 10) > 40 ? '19' : '20') + y;
      if (y.length === 4) e.target.value = `${d}/${m}/${y}`;
    }
  });

  // Xóa nút CCCD
  dom.btnClearCccd.addEventListener('click', () => {
    dom.inputCccd.value = '';
    updateCccdBadge();
    dom.inputCccd.focus();
  });

  // Reset form
  dom.btnResetForm.addEventListener('click', resetSearchForm);

  // Submit tra cứu
  dom.formSearch.addEventListener('submit', handleSearchSubmit);

  // Nút quay lại tra cứu
  dom.btnGoToSearch.addEventListener('click', () => switchTab('tab-search'));
  dom.btnReSearch.addEventListener('click', () => {
    resetSearchForm();
    switchTab('tab-search');
    dom.inputCccd.focus();
  });

  // Sao chép mã thẻ
  dom.btnCopyMaThe.addEventListener('click', () => {
    if (currentResultData && (currentResultData.maTheGoc || currentResultData.maThe)) {
      const code = (currentResultData.maTheGoc || currentResultData.maThe).replace(/\s+/g, '');
      copyToClipboard(code, 'Đã sao chép mã thẻ BHYT!');
    }
  });

  // Sao chép toàn bộ thông tin
  dom.btnCopyAll.addEventListener('click', () => {
    if (!currentResultData) return;
    const d = currentResultData;
    const infoText = [
      `THÔNG TIN THẺ BHYT`,
      `Mã thẻ: ${(d.maTheGoc || d.maThe || '').replace(/\s+/g, '')}`,
      d.maSoBhxh ? `Mã số BHXH: ${d.maSoBhxh}` : null,
      `Họ và tên: ${d.hoTen}`,
      `Ngày sinh: ${d.ngaySinh} (${d.gioiTinh})`,
      `Số CCCD: ${d.soCCCD}`,
      `Hạn thẻ: ${d.gtTheTu} đến ${d.gtTheDen}`,
      `Mức hưởng: ${d.mucHuong}`,
      d.tenDoiTuong ? `Đối tượng: ${d.maDoiTuong} - ${d.tenDoiTuong}` : null,
      `Nơi ĐK KCB BĐ: ${d.maDKBD} - ${d.tenDKBD}`,
      d.tuyenKcb ? `Tuyến KCB: ${d.tuyenKcb}` : null,
      d.thongTuyen ? `Thông tuyến: ${d.thongTuyen}` : null,
      `Trạng thái: ${d.trangThai === 'CON_GIA_TRI' ? 'CÒN GIÁ TRỊ' : 'HẾT HẠN'}`
    ].filter(Boolean).join('\n');

    copyToClipboard(infoText, 'Đã sao chép toàn bộ thông tin!');
  });

  // Xóa lịch sử
  dom.btnClearHistory.addEventListener('click', handleClearHistory);

  // Settings: Kiểm tra kết nối
  dom.btnTestConnection.addEventListener('click', () => checkBhxhConnection(true));

  // Settings: Tự động nhận diện từ HIS
  if (dom.btnAutoDetectHis) {
    dom.btnAutoDetectHis.addEventListener('click', () => handleAutoDetectHis(false));
  }

  // Settings: Lưu cấu hình
  dom.formSettings.addEventListener('submit', handleSaveSettings);


  // Mã CSKCB readonly — tự động nhận diện từ HIS, không cho nhập thủ công
  // (không cần event listener handleMaCSKCBInput)

  // Settings: Nhập Tên CSKCB đồng bộ lên Header
  if (dom.inputTenCSKCB) {
    dom.inputTenCSKCB.addEventListener('input', () => {
      const val = dom.inputTenCSKCB.value.trim();
      if (val && dom.headerOrgName) {
        dom.headerOrgName.textContent = val.toUpperCase();
      }
    });
  }

  // Bấm nút Submit Tra cứu
  dom.btnSubmit.addEventListener('click', (e) => {
    handleSearchSubmit(e);
  });

  // Tự động nhận diện Họ tên / Ngày sinh từ tab VNPT HIS khi nhập CCCD
  dom.inputCccd.addEventListener('change', async () => {
    const val = dom.inputCccd.value.trim().replace(/\D/g, '');
    if (val.length === 12 && (!dom.inputHoTen.value || !dom.inputNgaySinh.value)) {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs && tabs[0] && tabs[0].id) {
          chrome.tabs.sendMessage(tabs[0].id, { action: 'lookupPatientForPopup', cccd: val }, (res) => {
            if (res && res.patient) {
              if (!dom.inputHoTen.value && res.patient.hoTen) dom.inputHoTen.value = res.patient.hoTen;
              if (!dom.inputNgaySinh.value && res.patient.ngaySinh) dom.inputNgaySinh.value = res.patient.ngaySinh;
              if (!dom.inputMaThe.value && res.patient.maThe) dom.inputMaThe.value = res.patient.maThe;
            }
          });
        }
      } catch (e) {}
    }
  });
}

// ==========================================
// 5. TRA CỨU BHYT TRỰC TIẾP CỔNG BHXH VIỆT NAM (KHÔNG CẦN BACKEND)
// ==========================================
async function handleSearchSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();
  hideError();

  const soCccd = dom.inputCccd.value.trim();
  const hoTen = dom.inputHoTen.value.trim();
  const ngaySinh = dom.inputNgaySinh.value.trim();
  const maThe = dom.inputMaThe.value.trim();

  if (!soCccd && !maThe) {
    showError('Vui lòng nhập số CCCD (12 chữ số) hoặc Mã thẻ BHYT.');
    dom.inputCccd.focus();
    return;
  }

  // Hiển thị trạng thái đang xử lý
  showLoading(true);

  try {
    const activeOrigin = await getActiveHisOrigin();
    chrome.runtime.sendMessage(
      {
        action: 'checkBhyt',
        payload: {
          soCccd,
          hoTen,
          ngaySinh,
          maThe,
          hisOrigin: activeOrigin,
          username: currentConfig.bhxh_user,
          password: currentConfig.bhxh_pass
        }
      },
      async (res) => {
        showLoading(false);

        if (!res) {
          showError('Không nhận được phản hồi từ tiện ích mở rộng.');
          return;
        }

        if (res.success === false) {
          showError(res.message || 'Cổng tiếp nhận dữ liệu BHXH Việt Nam từ chối yêu cầu.');
          return;
        }

        // Tự động cập nhật trạng thái kết nối thành công lên Header
        if (res.isLive) {
          setConnectionStatus(true, { user: currentConfig.bhxh_user || 'Đã liên thông' });
        }

        const displayData = res.data || {};
        currentResultData = displayData;
        renderResult(displayData);
        // Tối ưu UI: Chuyển ngay sang tab kết quả hiển thị cho người dùng, không chờ lưu lịch sử
        switchTab('tab-result');
        // Lưu lịch sử bất đồng bộ không chặn luồng hiển thị
        saveToLocalHistory(displayData).catch(() => {});
      }
    );
  } catch (err) {
    showLoading(false);
    console.log('Lỗi gọi Cổng BHXH:', err);
    showError(`Lỗi kết nối Cổng BHXH: ${err.message}`);
  }
}

function updateCccdBadge() {
  const digits = (dom.inputCccd?.value || '').replace(/\D/g, '');
  const badge = document.getElementById('cccdCountBadge');
  if (badge) {
    badge.textContent = `${digits.length}/12`;
    if (digits.length === 12) {
      badge.classList.add('valid');
    } else {
      badge.classList.remove('valid');
    }
  }
}

function isCardExpired(dateStr) {
  if (!dateStr) return false;
  const parts = String(dateStr).trim().split('/');
  if (parts.length === 3) {
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const y = parseInt(parts[2], 10);
    if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
      const expDate = new Date(y, m, d, 23, 59, 59);
      return expDate < new Date();
    }
  }
  return false;
}

function isCardFuture(dateStr) {
  if (!dateStr) return false;
  const parts = String(dateStr).trim().split('/');
  if (parts.length === 3) {
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const y = parseInt(parts[2], 10);
    if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
      const fromDate = new Date(y, m, d, 0, 0, 0);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return fromDate > today;
    }
  }
  return false;
}

function renderResult(data) {
  dom.resultEmpty.classList.add('hidden');
  dom.resultCard.classList.remove('hidden');

  const isExpired = isCardExpired(data.gtTheDen);
  const isFuture = isCardFuture(data.gtTheTu);
  const isMa000 = data.maKetQua === '000' || data.maKetQua === '00';
  const isBaoGiam = data.maKetQua === '050' || data.maKetQua === '051' || data.maKetQua === '060' || data.maKetQua === '061';
  const isError = !isMa000 && Boolean(data.maKetQua && data.maKetQua !== 'CON_GIA_TRI');

  let bannerClass = 'status-valid';
  let bannerIcon = '🟢';
  let bannerTitle = 'THẺ BHYT CÒN GIÁ TRỊ';
  let bannerSub = data.thongBao || (data.gtTheDen ? `Giá trị sử dụng đến ${data.gtTheDen}` : 'Thẻ hợp lệ');

  if (isBaoGiam) {
    bannerClass = 'status-expired';
    bannerIcon = '⚠️';
    bannerTitle = 'THẺ BÁO GIẢM / THU HỒI';
    bannerSub = data.thongBao || `Mã kết quả [${data.maKetQua}]: ${data.ghiChu || 'Thẻ đã báo giảm hoặc không còn giá trị'}`;
  } else if (isExpired) {
    bannerClass = 'status-expired';
    bannerIcon = '🔴';
    bannerTitle = 'THẺ BHYT HẾT HẠN';
    bannerSub = data.thongBao || `Thẻ đã hết hạn sử dụng từ ngày ${data.gtTheDen}`;
  } else if (isFuture) {
    bannerClass = 'status-warning';
    bannerIcon = '⏳';
    bannerTitle = 'THẺ CHƯA ĐẾN HẠN HIỆU LỰC';
    bannerSub = `Thẻ bắt đầu có giá trị từ ngày ${data.gtTheTu}`;
  } else if (isError) {
    bannerClass = 'status-expired';
    bannerIcon = '⚠️';
    bannerTitle = `TRA CỨU THẤT BẠI [MÃ ${data.maKetQua}]`;
    bannerSub = data.thongBao || data.ghiChu || 'Thông tin thẻ không hợp lệ hoặc lỗi tra cứu';
  } else if (!data.maThe && !data.soCCCD) {
    bannerClass = 'status-expired';
    bannerIcon = '❓';
    bannerTitle = 'CHƯA ĐỦ DỮ LIỆU XÁC ĐỊNH';
    bannerSub = 'Không có thông tin thẻ hoặc phản hồi rỗng';
  }

  dom.cardStatusBanner.className = `card-status-banner ${bannerClass}`;
  dom.cardStatusIcon.textContent = bannerIcon;
  dom.cardStatusText.textContent = bannerTitle;
  dom.cardStatusSub.textContent = bannerSub;

  dom.resMaThe.textContent = data.maThe || '---';
  dom.resHoTen.textContent = data.hoTen || '---';
  dom.resNgaySinh.textContent = data.ngaySinh || '---';
  dom.resGioiTinh.textContent = data.gioiTinh || '---';
  dom.resCccd.textContent = data.soCCCD || '---';
  dom.resGtTu.textContent = data.gtTheTu || '---';
  dom.resGtDen.textContent = data.gtTheDen || '---';
  dom.resNgay5Nam.textContent = data.ngayDu5Nam || '---';
  dom.resMucHuong.textContent = data.mucHuong || '80%';
  dom.resDoiTuong.textContent = data.tenDoiTuong ? `${data.maDoiTuong} - ${data.tenDoiTuong}` : '---';

  let tenDk = data.tenDKBD || '';
  if ((!tenDk || tenDk.includes('Bảo hiểm Xã hội')) && hospitalsDb && hospitalsDb[data.maDKBD]) {
    tenDk = hospitalsDb[data.maDKBD];
  }
  dom.resDkbd.textContent = `${data.maDKBD || ''} - ${tenDk}`.trim() || '---';
  dom.resDiaChi.textContent = data.diaChi || data.thongTuyen || '---';
}

function showLoading(isLoading) {
  dom.btnSubmit.disabled = isLoading;
  if (isLoading) {
    dom.searchLoading.classList.remove('hidden');
  } else {
    dom.searchLoading.classList.add('hidden');
  }
}

function showError(msg) {
  dom.searchErrorMessage.textContent = msg;
  dom.searchError.classList.remove('hidden');
}

function hideError() {
  dom.searchError.classList.add('hidden');
}

function resetSearchForm() {
  dom.inputCccd.value = '';
  dom.inputHoTen.value = '';
  dom.inputNgaySinh.value = '';
  dom.inputMaThe.value = '';
  updateCccdBadge();
  hideError();
  dom.inputCccd.focus();
}

// ==========================================
// 6. QUẢN LÝ LỊCH SỬ TRA CỨU
// ==========================================
async function saveToLocalHistory(item) {
  const stored = await Storage.get('bhyt_local_history');
  let list = stored.bhyt_local_history || [];

  const dNow = new Date();
  const pad2 = (n) => String(n).padStart(2, '0');
  const record = {
    id: Date.now(),
    thoiGian: `${pad2(dNow.getDate())}/${pad2(dNow.getMonth() + 1)}/${dNow.getFullYear()} ${pad2(dNow.getHours())}:${pad2(dNow.getMinutes())}`,
    data: item
  };

  // Tránh trùng lặp liên tiếp
  list = list.filter(x => x.data.soCCCD !== item.soCCCD || x.data.maThe !== item.maThe);
  list.unshift(record);

  if (list.length > 50) list.pop();
  await Storage.set({ bhyt_local_history: list });
}

async function loadHistory() {
  const stored = await Storage.get('bhyt_local_history');
  const list = stored.bhyt_local_history || [];

  if (list.length === 0) {
    dom.historyList.innerHTML = `
      <div class="empty-state">
        <p>Chưa có lịch sử tra cứu nào.</p>
      </div>
    `;
    return;
  }

  dom.historyList.innerHTML = list.map(item => {
    const d = item.data;
    const isValid = d.trangThai === 'CON_GIA_TRI';
    return `
      <div class="history-item" data-id="${item.id}">
        <div class="history-item-top">
          <span class="history-name">${d.hoTen}</span>
          <span class="history-time">${item.thoiGian}</span>
        </div>
        <div class="history-item-bottom">
          <span>${d.soCCCD ? 'CCCD: ' + d.soCCCD : d.maThe}</span>
          <span class="history-tag ${isValid ? 'tag-success' : 'tag-error'}">
            ${isValid ? 'Còn hạn' : 'Hết hạn'}
          </span>
        </div>
      </div>
    `;
  }).join('');

  // Gán sự kiện click vào từng item để xem lại
  document.querySelectorAll('.history-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = parseInt(el.getAttribute('data-id'), 10);
      const target = list.find(x => x.id === id);
      if (target && target.data) {
        currentResultData = target.data;
        renderResult(target.data);
        switchTab('tab-result');
      }
    });
  });
}

async function handleClearHistory() {
  if (confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử tra cứu trên tiện ích này?')) {
    await Storage.set({ bhyt_local_history: [] });
    await loadHistory();
    showToast('Đã xóa sạch lịch sử tra cứu!');
  }
}

// ==========================================
// 7. CẤU HÌNH VÀ TỰ ĐỘNG TÌM KIẾM CSKCB
// ==========================================
let hospitalsDb = null;

async function loadHospitalsDb() {
  if (hospitalsDb) return hospitalsDb;
  try {
    if (!chrome?.runtime?.getURL) return null;
    const url = chrome.runtime.getURL('hospitals.json');
    if (!url) return null;
    const res = await fetch(url);
    if (res.ok) {
      hospitalsDb = await res.json();
    }
  } catch (e) {
    console.log('Ghi chú nạp danh mục bệnh viện hospitals.json:', e?.message || e);
  }
  return hospitalsDb;
}

async function handleMaCSKCBInput() {
  const code = (dom.inputMaCSKCB?.value || '').trim();
  const userEl = dom.connCskcbUser || document.getElementById('connCskcbUser');
  if (userEl && code) {
    userEl.textContent = `${code}_BV`;
  }
  currentConfig.cskcbCode = code;
  currentConfig.bhxh_user = `${code}_BV`;

  if (code.length !== 5) return;

  const db = await loadHospitalsDb();
  let foundName = db && db[code];
  if (!foundName) {
    if (code === '49425') foundName = 'Trạm Y tế xã Duy Xuyên';
    else if (code === '49006') foundName = 'Trung tâm Y tế khu vực Duy Xuyên';
    else if (code === '49008') foundName = 'Trung tâm Y tế khu vực Quế Sơn';
  }

  if (foundName) {
    if (dom.inputTenCSKCB) dom.inputTenCSKCB.value = foundName;
    currentConfig.orgName = foundName;
    if (dom.headerOrgName) dom.headerOrgName.textContent = foundName.toUpperCase();

    // Tự động gợi ý cấp chuyên môn & điểm xếp cấp theo loại hình cơ sở
    if (/trạm\s*y\s*tế|tyt|phòng\s*khám|điểm\s*trạm/i.test(foundName)) {
      if (dom.selectCapChuyenMon) dom.selectCapChuyenMon.value = 'Ban đầu';
      if (dom.inputDiemXepCap) dom.inputDiemXepCap.value = 0;
      currentConfig.capChuyenMon = 'Ban đầu';
      currentConfig.diemXepCap = 0;
    } else if (/chuyên\s*sâu|tỉnh|trung\s*ương/i.test(foundName)) {
      if (dom.selectCapChuyenMon) dom.selectCapChuyenMon.value = 'Chuyên sâu';
      if (dom.inputDiemXepCap) dom.inputDiemXepCap.value = 70;
      currentConfig.capChuyenMon = 'Chuyên sâu';
      currentConfig.diemXepCap = 70;
    } else {
      if (dom.selectCapChuyenMon) dom.selectCapChuyenMon.value = 'Cơ bản';
      if (dom.inputDiemXepCap) dom.inputDiemXepCap.value = 25;
      currentConfig.capChuyenMon = 'Cơ bản';
      currentConfig.diemXepCap = 25;
    }
  }
}

// TỰ ĐỘNG ĐỌC MÃ CSKCB TỪ PHIÊN LÀM VIỆC HIS ĐỂ ĐIỀN CẤU HÌNH KHI THIẾT LẬP
async function handleAutoDetectHis(silent = false) {
  const btn = dom.btnAutoDetectHis || document.getElementById('btnAutoDetectHis');
  if (btn && !silent) {
    btn.disabled = true;
    btn.innerHTML = `<span>⏳ Đang đọc từ HIS...</span>`;
  }

  try {
    chrome.runtime.sendMessage({ action: 'detectHisCskcb' }, async (res) => {
      if (btn && !silent) {
        btn.disabled = false;
        btn.innerHTML = `
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
          </svg>
          <span>Đọc từ HIS</span>
        `;
      }

      if (res && res.success && res.cskcbCode) {
        currentConfig.cskcbCode = res.cskcbCode;
        currentConfig.orgName = res.orgName;
        // Đặc biệt: Mã CSKCB 49006 luôn cố định Điểm xếp cấp = 29, Cấp chuyên môn = Cơ bản
        if (res.cskcbCode === '49006') {
          currentConfig.capChuyenMon = 'Cơ bản';
          currentConfig.diemXepCap = 29;
        } else if (res.cskcbCode === '49008') {
          // BVĐKKV Quế Sơn: cấp Cơ bản, 25 điểm
          currentConfig.capChuyenMon = 'Cơ bản';
          currentConfig.diemXepCap = 25;
        } else {
          currentConfig.capChuyenMon = res.capChuyenMon || '';
          currentConfig.diemXepCap = res.diemXepCap != null ? res.diemXepCap : '';
        }
        currentConfig.bhxh_user = res.username || `${res.cskcbCode}_BV`;

        if (dom.inputMaCSKCB) dom.inputMaCSKCB.value = res.cskcbCode;
        if (dom.inputTenCSKCB) dom.inputTenCSKCB.value = res.orgName;
        if (dom.selectCapChuyenMon && currentConfig.capChuyenMon) dom.selectCapChuyenMon.value = currentConfig.capChuyenMon;
        if (dom.inputDiemXepCap) dom.inputDiemXepCap.value = currentConfig.diemXepCap;
        if (dom.headerOrgName && res.orgName) dom.headerOrgName.textContent = res.orgName.toUpperCase();
        if (res.password) {
          currentConfig.bhxh_pass = res.password;
          if (dom.inputBhxhPass) dom.inputBhxhPass.value = res.password;
        }

        const userEl = dom.connCskcbUser || document.getElementById('connCskcbUser');
        if (userEl) userEl.textContent = `${res.cskcbCode}_BV`;

        if (!silent) {
          const alertBox = dom.settingsAlertBox || document.getElementById('settingsAlertBox');
          if (alertBox) {
            alertBox.className = 'settings-alert-box alert-success';
            alertBox.innerHTML = `<span>✔ Đã tự động đọc Mã CSKCB từ HIS: <strong>${res.cskcbCode}</strong> - ${res.orgName} (${res.capChuyenMon})</span>`;
            alertBox.classList.remove('hidden');
          }
          showToast(`✔ Nhận diện đơn vị: ${res.cskcbCode} - ${res.orgName}`);
          checkBhxhConnection(false);
        }
      } else if (!silent) {
        showToast('⚠️ Không tìm thấy phiên làm việc HIS đang mở để đọc Mã CSKCB.');
      }
    });
  } catch (err) {
    if (btn && !silent) {
      btn.disabled = false;
      btn.innerHTML = `<span>Đọc từ HIS</span>`;
    }
  }
}

async function loadConfiguration() {
  const stored = await Storage.get([
    'bhyt_cskcb_code',
    'bhyt_org_name',
    'bhyt_cap_chuyen_mon',
    'bhyt_diem_xep_cap',
    'bhxh_user',
    'bhxh_pass'
  ]);

  const cskcbCode = stored.bhyt_cskcb_code || (stored.bhxh_user ? stored.bhxh_user.split('_')[0] : '');
  currentConfig.cskcbCode = cskcbCode;
  currentConfig.bhxh_user = cskcbCode ? `${cskcbCode}_BV` : '';
  currentConfig.orgName = stored.bhyt_org_name || '';
  currentConfig.capChuyenMon = stored.bhyt_cap_chuyen_mon || '';
  currentConfig.diemXepCap = stored.bhyt_diem_xep_cap != null ? stored.bhyt_diem_xep_cap : '';
  currentConfig.bhxh_pass = stored.bhxh_pass || '';

  // Đặc biệt: Mã CSKCB 49006 luôn cố định Điểm xếp cấp = 29, Cấp chuyên môn = Cơ bản
  if (cskcbCode === '49006') {
    currentConfig.capChuyenMon = 'Cơ bản';
    currentConfig.diemXepCap = 29;
  } else if (cskcbCode === '49008') {
    // BVĐKKV Quế Sơn: cấp Cơ bản, 25 điểm
    currentConfig.capChuyenMon = 'Cơ bản';
    currentConfig.diemXepCap = 25;
  }

  if (dom.inputMaCSKCB) dom.inputMaCSKCB.value = currentConfig.cskcbCode;
  if (dom.inputTenCSKCB) dom.inputTenCSKCB.value = currentConfig.orgName;
  if (dom.selectCapChuyenMon && currentConfig.capChuyenMon) dom.selectCapChuyenMon.value = currentConfig.capChuyenMon;
  if (dom.inputDiemXepCap) dom.inputDiemXepCap.value = currentConfig.diemXepCap;
  if (dom.inputBhxhPass && currentConfig.bhxh_pass) dom.inputBhxhPass.value = currentConfig.bhxh_pass;
  if (dom.headerOrgName && currentConfig.orgName) dom.headerOrgName.textContent = currentConfig.orgName.toUpperCase();

  const userEl = dom.connCskcbUser || document.getElementById('connCskcbUser');
  if (userEl) userEl.textContent = cskcbCode ? `${cskcbCode}_BV` : '—';

  // Nạp ngầm danh bạ CSKCB
  loadHospitalsDb().catch(() => {});

  // Tự động nhận diện đơn vị MỖI LẦN mở popup (không cần bấm nút thủ công)
  // Nếu HIS đang mở ở tab hiện tại, sẽ tự đọc Mã CSKCB chính xác
  handleAutoDetectHis(true);
}

async function handleSaveSettings(e) {
  e.preventDefault();
  const code = (dom.inputMaCSKCB?.value || '').trim();
  const name = (dom.inputTenCSKCB?.value || '').trim();
  const newCapChuyenMon = dom.selectCapChuyenMon ? dom.selectCapChuyenMon.value : '';
  const rawDiemXepCap = dom.inputDiemXepCap ? dom.inputDiemXepCap.value.trim() : '';
  const newDiemXepCap = rawDiemXepCap === '' ? '' : Number(rawDiemXepCap);
  const passVal = (dom.inputBhxhPass?.value || '').trim();

  const alertBox = dom.settingsAlertBox || document.getElementById('settingsAlertBox');
  const btnSave = dom.btnSaveSettings || document.getElementById('btnSaveSettings');

  function showStatusAlert(msg, isSuccess, isWarning = false) {
    if (alertBox) {
      let cls = 'alert-danger';
      let icon = '❌';
      if (isSuccess) { cls = 'alert-success'; icon = '✔'; }
      else if (isWarning) { cls = 'alert-warning'; icon = '⚠️'; }
      alertBox.className = `settings-alert-box ${cls}`;
      alertBox.innerHTML = `<span>${icon} ${msg}</span>`;
      alertBox.classList.remove('hidden');
    }
    showToast(msg);
  }

  // 1. Kiểm tra tính hợp lệ của 4 trường dữ liệu
  if (!code || !/^\d{5}$/.test(code)) {
    showStatusAlert('Mã CSKCB không hợp lệ! Vui lòng nhập đúng 5 chữ số (Ví dụ: 49008).', false);
    return;
  }

  if (!name) {
    showStatusAlert('Tên CSKCB không được để trống! Vui lòng nhập tên CSKCB.', false);
    return;
  }

  if (newDiemXepCap !== '' && (isNaN(newDiemXepCap) || newDiemXepCap < 0 || newDiemXepCap > 100)) {
    showStatusAlert('Điểm xếp cấp không hợp lệ! Vui lòng nhập số điểm từ 0 đến 100.', false);
    return;
  }

  // 2. Tiến hành lưu cấu hình và kiểm tra thực tế kết nối với Mã CSKCB mới
  try {
    if (btnSave) {
      btnSave.disabled = true;
      btnSave.innerHTML = '<span>⏳ Đang kiểm tra kết nối Cổng BHXH...</span>';
    }

    currentConfig.cskcbCode = code;
    currentConfig.orgName = name;
    currentConfig.capChuyenMon = newCapChuyenMon;
    currentConfig.diemXepCap = newDiemXepCap;
    currentConfig.bhxh_user = `${code}_BV`;
    if (passVal) currentConfig.bhxh_pass = passVal;

    const toSave = {
      bhyt_cskcb_code: code,
      bhyt_org_name: name,
      bhyt_cap_chuyen_mon: newCapChuyenMon,
      bhyt_diem_xep_cap: newDiemXepCap,
      bhxh_user: `${code}_BV`,
      ...(passVal ? { bhxh_pass: passVal } : {})
    };

    await Storage.set(toSave);

    if (dom.headerOrgName) dom.headerOrgName.textContent = name.toUpperCase();
    const userEl = dom.connCskcbUser || document.getElementById('connCskcbUser');
    if (userEl) userEl.textContent = `${code}_BV`;

    // 3. Kiểm tra kết nối THỰC TẾ với tài khoản của Mã CSKCB mới trên Cổng BHXH
    const activeOrigin = await getActiveHisOrigin();
    const targetUser = currentConfig.bhxh_user && currentConfig.bhxh_user.startsWith(code) ? currentConfig.bhxh_user : `${code}_BV`;
    const res = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          action: 'testConnection',
          payload: {
            username: targetUser,
            password: currentConfig.bhxh_pass,
            hisOrigin: activeOrigin
          }
        },
        resolve
      );
    });

    const finalUser = res?.user || targetUser;
    if (res && res.success) {
      if (res.user) currentConfig.bhxh_user = res.user;
      if (res.password && !currentConfig.bhxh_pass) currentConfig.bhxh_pass = res.password;
      setConnectionStatus(true, {
        user: finalUser,
        message: res.message
      });
      showStatusAlert(`Lưu cấu hình và kết nối Cổng BHXH thành công với tài khoản <b>${finalUser}</b> (${name})!`, true);

      if (btnSave) {
        btnSave.disabled = false;
        btnSave.classList.add('btn-save-success');
        btnSave.innerHTML = '<span>✔ ĐÃ LƯU THÀNH CÔNG!</span>';
        setTimeout(() => {
          btnSave.classList.remove('btn-save-success');
          btnSave.innerHTML = '<span>LƯU CẤU HÌNH</span>';
        }, 2500);
      }
    } else {
      // BÁO THẤT BẠI RÕ RÀNG NẾU TÀI KHOẢN MÃ CSKCB MỚI KHÔNG KẾT NỐI ĐƯỢC
      const errMsg = res?.message || 'Không thể xác thực tài khoản trên Cổng tiếp nhận BHXH.';
      setConnectionStatus(false, {
        user: finalUser,
        error: errMsg
      });
      showStatusAlert(`Đã lưu cấu hình [<b>${code}</b> - ${name}], nhưng <b>KẾT NỐI CỔNG THẤT BẠI</b> với tài khoản <b>${finalUser}</b>: ${errMsg}`, false, true);

      if (btnSave) {
        btnSave.disabled = false;
        btnSave.classList.add('btn-save-error');
        btnSave.innerHTML = '<span>❌ LỖI XÁC THỰC CỔNG BHXH!</span>';
        setTimeout(() => {
          btnSave.classList.remove('btn-save-error');
          btnSave.innerHTML = '<span>LƯU CẤU HÌNH</span>';
        }, 3000);
      }
    }
  } catch (err) {
    console.log('Lỗi khi lưu cấu hình:', err);
    showStatusAlert(`Lưu cấu hình thất bại: ${err.message || 'Lỗi lưu trữ'}`, false);
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.classList.add('btn-save-error');
      btnSave.innerHTML = '<span>❌ LƯU THẤT BẠI!</span>';
      setTimeout(() => {
        btnSave.classList.remove('btn-save-error');
        btnSave.innerHTML = '<span>LƯU CẤU HÌNH</span>';
      }, 2500);
    }
  }
}

async function checkBhxhConnection(isManualTest = false) {
  if (!currentConfig.bhxh_pass) {
    try {
      const stored = await Storage.get(['bhxh_pass', 'bhxh_user']);
      if (stored?.bhxh_pass) currentConfig.bhxh_pass = stored.bhxh_pass;
      if (stored?.bhxh_user) currentConfig.bhxh_user = stored.bhxh_user;
    } catch (_) {}
  }
  const code = (dom.inputMaCSKCB?.value || currentConfig.cskcbCode || '49008').trim();
  const username = currentConfig.bhxh_user && currentConfig.bhxh_user.startsWith(code) ? currentConfig.bhxh_user : `${code}_BV`;

  if (isManualTest) {
    if (dom.connStatusBadge) {
      dom.connStatusBadge.className = 'badge-conn';
      dom.connStatusBadge.textContent = 'Đang kiểm tra...';
    }
    if (dom.connDetails) {
      dom.connDetails.innerHTML = `
        <p>● <strong>Cổng tiếp nhận:</strong> https://egw.baohiemxahoi.gov.vn</p>
        <p>● <strong>Tài khoản CSKCB:</strong> <span class="conn-user-highlight">${username}</span></p>
        <p style="color:#2563EB;">⏳ Đang gửi yêu cầu xin cấp Token tới Cổng tiếp nhận BHXH Việt Nam...</p>
      `;
    }
  }

  try {
    const activeOrigin = await getActiveHisOrigin();
    chrome.runtime.sendMessage(
      {
        action: 'testConnection',
        payload: {
          username: username,
          password: currentConfig.bhxh_pass,
          hisOrigin: activeOrigin
        }
      },
      async (res) => {
        if (res && res.success) {
          currentConfig.bhxh_user = username;
          if (res.password && !currentConfig.bhxh_pass) {
            currentConfig.bhxh_pass = res.password;
          }
          setConnectionStatus(true, {
            user: username,
            message: res.message
          });
          if (isManualTest) {
            showToast(`Kết nối trực tiếp Cổng BHXH thành công với tài khoản ${username}!`);
          }
        } else {
          setConnectionStatus(false, {
            user: username,
            error: res?.message || 'Chưa thể kết nối Cổng BHXH'
          });
          if (isManualTest) {
            showToast(`Kết nối thất bại: ${res?.message || 'Lỗi kết nối'}`);
          }
        }
      }
    );
  } catch (err) {
    setConnectionStatus(false, { user: username, error: err.message });
  }
}

function setConnectionStatus(isOnline, info = {}) {
  const userDisplay = info.user || (currentConfig.cskcbCode ? `${currentConfig.cskcbCode}_BV` : '') || currentConfig.bhxh_user || '49008_BV';

  // Cập nhật Header
  if (isOnline) {
    if (dom.headerConnectionBadge) {
      dom.headerConnectionBadge.className = 'header-status connected';
      const label = dom.headerConnectionBadge.querySelector('.status-label');
      if (label) label.textContent = 'Cổng BHXH: Đã kết nối';
    }
  } else {
    if (dom.headerConnectionBadge) {
      dom.headerConnectionBadge.className = 'header-status disconnected';
      const label = dom.headerConnectionBadge.querySelector('.status-label');
      if (label) label.textContent = 'Cổng BHXH: Chưa kết nối';
    }
  }

  // Cập nhật panel Cài đặt
  const userEl = dom.connCskcbUser || document.getElementById('connCskcbUser');
  if (userEl) userEl.textContent = userDisplay;

  if (isOnline) {
    if (dom.connStatusBadge) {
      dom.connStatusBadge.className = 'badge-conn badge-online';
      dom.connStatusBadge.textContent = 'Hoạt động tốt';
    }
    if (dom.connDetails) {
      dom.connDetails.innerHTML = `
        <p>● <strong>Cổng tiếp nhận:</strong> https://egw.baohiemxahoi.gov.vn</p>
        <p>● <strong>Tài khoản CSKCB:</strong> <span class="conn-user-highlight">${userDisplay}</span></p>
        <p>● <strong>Chế độ:</strong> 🟢 Trực tiếp từ trình duyệt (100% không cần backend)</p>
      `;
    }
  } else {
    if (dom.connStatusBadge) {
      dom.connStatusBadge.className = 'badge-conn badge-offline';
      dom.connStatusBadge.textContent = 'Chưa kết nối';
    }
    if (dom.connDetails) {
      dom.connDetails.innerHTML = `
        <p>● <strong>Cổng tiếp nhận:</strong> https://egw.baohiemxahoi.gov.vn</p>
        <p>● <strong>Tài khoản CSKCB:</strong> <span class="conn-user-highlight">${userDisplay}</span></p>
        <p style="color: var(--danger); margin-top: 4px; font-weight: 600;">❌ ${info.error || 'Chưa lấy được Token từ Cổng BHXH.'}</p>
        <p style="font-size:11px;color:#64748B;">Vui lòng đăng nhập VNPT HIS của đơn vị để tự động nhận diện thông tin liên thông BHXH, hoặc kiểm tra kết nối mạng.</p>
      `;
    }
  }
}

// ==========================================
// 8. TIỆN ÍCH CLIPBOARD & TOAST
// ==========================================
function copyToClipboard(text, successMsg) {
  navigator.clipboard.writeText(text).then(() => {
    showToast(successMsg);
  }).catch(() => {
    // Fallback nếu clipboard API bị chặn
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast(successMsg);
  });
}

function showToast(msg) {
  dom.toastMessage.textContent = msg;
  dom.toastMessage.classList.remove('hidden');
  clearTimeout(dom.toastMessage._timer);
  dom.toastMessage._timer = setTimeout(() => {
    dom.toastMessage.classList.add('hidden');
  }, 2200);
}
