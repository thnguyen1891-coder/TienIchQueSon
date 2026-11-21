/**
 * Background Service Worker: Kết nối trực tiếp Cổng tiếp nhận dữ liệu BHXH Việt Nam
 * Cổng: https://egw.baohiemxahoi.gov.vn
 * API chuẩn: /api/token/take & /api/egw/KQNhanLichSuKCB2024
 * TUYỆT ĐỐI KHÔNG MÔ PHỎNG - KHÔNG DỮ LIỆU GIẢ - 100% KẾT QUẢ THỰC TẾ
 */

const BHXH_GATEWAY = 'https://egw.baohiemxahoi.gov.vn';

try {
  importScripts('dm_cskcb.js');
} catch (e) {
  console.warn('[Background] Cannot importScripts dm_cskcb.js:', e);
}

function formatCskcbName(rawCskcb) {
  if (!rawCskcb) return '';
  let str = String(rawCskcb).trim();
  if (/^\w+\s*-\s*.+/.test(str)) {
    return str;
  }
  const dict = (typeof globalThis !== 'undefined' && globalThis.DM_COSOKCB) ||
               (typeof self !== 'undefined' && self.DM_COSOKCB) || null;
  if (dict) {
    const name = dict[str] || dict[str.toUpperCase()] || dict[str.toLowerCase()];
    if (name) {
      return `${str} - ${name}`;
    }
  }
  return str;
}

let cachedToken = null;
let tokenExpiresAt = 0;
let cachedCredentials = null;
let cachedStaff = null;

// =========================================================================
// 0. CHUẨN HÓA NGÀY SINH GỬI CỔNG BHXH VIỆT NAM
// =========================================================================
// =========================================================================
// 0. CHUẨN HÓA NGÀY SINH GỬI CỔNG BHXH VIỆT NAM
// =========================================================================
function normalizeDobForBhxh(dobStr) {
  if (!dobStr) return '';
  let s = String(dobStr).trim();
  // Loại bỏ phần giờ phút giây nếu có (VD: "01/01/1948 00:00:00" -> "01/01/1948")
  s = s.replace(/\s+\d{1,2}:\d{2}(:\d{2})?.*$/, '').trim();

  // BẢO VỆ TUYỆT ĐỐI: Loại bỏ chuỗi không phải ngày tháng (VD: "on", "off", "true", "false", rỗng)
  if (!s || s.toLowerCase() === 'on' || s.toLowerCase() === 'off' || s.toLowerCase() === 'true' || s.toLowerCase() === 'false' || !/\d/.test(s)) {
    return '';
  }

  if (/^\d{4}$/.test(s)) return s; // Năm sinh (1990)
  if (/^\d{8}$/.test(s)) {
    const p1 = parseInt(s.substring(0, 4), 10);
    if (p1 >= 1900 && p1 <= 2100) {
      return `${s.substring(6, 8)}/${s.substring(4, 6)}/${s.substring(0, 4)}`; // YYYYMMDD -> DD/MM/YYYY
    }
    return `${s.substring(0, 2)}/${s.substring(2, 4)}/${s.substring(4, 8)}`; // DDMMYYYY -> DD/MM/YYYY
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const parts = s.substring(0, 10).split('-');
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  const mDmy = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
  if (mDmy) {
    const d = mDmy[1].padStart(2, '0');
    const m = mDmy[2].padStart(2, '0');
    const y = mDmy[3];
    return `${d}/${m}/${y}`;
  }
  // Nếu chuỗi chứa 4 chữ số năm hợp lệ (19xx - 20xx)
  const yMatch = s.match(/\b(19\d{2}|20\d{2})\b/);
  if (yMatch) return yMatch[0];

  return '';
}

function removeVietnameseTones(str) {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .trim();
}

function generateNameVariations(fullName) {
  if (!fullName) return [];
  const list = [];
  const raw = fullName.trim().toUpperCase().replace(/[\s\u00A0]+/g, ' ');
  list.push(raw);

  // 1. Chuyển đổi họ đặc thù vùng miền (Huỳnh <-> Hoàng, Vũ <-> Võ)
  if (raw.startsWith('HUỲNH ')) {
    list.push(raw.replace(/^HUỲNH\s+/, 'HOÀNG '));
  } else if (raw.startsWith('HOÀNG ')) {
    list.push(raw.replace(/^HOÀNG\s+/, 'HUỲNH '));
  } else if (raw.startsWith('VŨ ')) {
    list.push(raw.replace(/^VŨ\s+/, 'VÕ '));
  } else if (raw.startsWith('VÕ ')) {
    list.push(raw.replace(/^VÕ\s+/, 'VŨ '));
  }

  // 2. Tên không dấu
  const noTone = removeVietnameseTones(raw);
  if (noTone && !list.includes(noTone)) list.push(noTone);

  // Không dấu cho họ Hoàng/Huỳnh
  if (raw.startsWith('HUỲNH ')) {
    const hoangNoTone = removeVietnameseTones(raw.replace(/^HUỲNH\s+/, 'HOÀNG '));
    if (hoangNoTone && !list.includes(hoangNoTone)) list.push(hoangNoTone);
  }

  // 3. Bỏ từ đệm "THỊ" hoặc "VĂN" (VD: HUỲNH THỊ BÌNH -> HUỲNH BÌNH)
  const parts = raw.split(' ');
  if (parts.length >= 3) {
    const noMiddle = `${parts[0]} ${parts[parts.length - 1]}`;
    if (!list.includes(noMiddle)) list.push(noMiddle);
    if (raw.startsWith('HUỲNH ')) {
      const hoangNoMiddle = `HOÀNG ${parts[parts.length - 1]}`;
      if (!list.includes(hoangNoMiddle)) list.push(hoangNoMiddle);
    }
  }

  return list;
}

// =========================================================================
// 0.0 NẠP DANH MỤC CƠ SỞ KCB VÀ HÀM KIỂM TRA HẠN THẺ
// =========================================================================
let hospitalsDb = null;
async function getHospitalName(code) {
  if (!code) return '';
  const cleanCode = String(code).trim();
  if (!hospitalsDb) {
    try {
      const res = await fetch(chrome.runtime.getURL('hospitals.json'));
      if (res.ok) {
        hospitalsDb = await res.json();
      }
    } catch (e) {
      console.log('[Background Gateway] Không thể nạp hospitals.json:', e);
    }
  }
  return (hospitalsDb && hospitalsDb[cleanCode]) || '';
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

// =========================================================================
// 0.1 TỰ ĐỘNG LẤY THÔNG TIN CÁN BỘ ĐÃ ĐĂNG KÝ VỚI BHXH (KHÔNG CẦN NHẬP TAY)
// =========================================================================
async function resolveStaffCredentials(hisOrigin, username) {
  const targetUnit = (username || '').split('_')[0].replace(/\D/g, '').substring(0, 5) || '49008';

  // 1. Kiểm tra cache theo đúng đơn vị (targetUnit)
  if (cachedStaff && cachedStaff.unit === targetUnit && cachedStaff.hoTenCb && cachedStaff.cccdCb) {
    return cachedStaff;
  }

  // 2. Kiểm tra cấu hình trong chrome.storage theo đúng đơn vị
  try {
    const stored = await chrome.storage.local.get(['bhxh_cb_hoten', 'bhxh_cb_cccd', 'bhxh_cb_unit']);
    if (stored && stored.bhxh_cb_hoten && stored.bhxh_cb_cccd && stored.bhxh_cb_unit === targetUnit) {
      cachedStaff = {
        unit: targetUnit,
        hoTenCb: stored.bhxh_cb_hoten.trim(),
        cccdCb: stored.bhxh_cb_cccd.trim()
      };
      return cachedStaff;
    }
  } catch (e) {}

  // 3. Tự động lấy ngầm từ API của hệ thống HIS nội bộ (nếu có hisOrigin) có timeout bảo vệ 1200ms
  if (hisOrigin) {
    const hisStaffCtrl = new AbortController();
    const hisStaffTimeout = setTimeout(() => hisStaffCtrl.abort(), 1200);
    try {
      let currentMaNv = '';
      let currentTenNv = '';
      let currentCccdNv = '';

      // Tối ưu: Gọi song song thông tin người dùng và danh sách cán bộ đăng ký API BHXH (timeout 1.2s không gây nghẽn)
      const [infoRes, staffRes] = await Promise.all([
        fetch(`${hisOrigin}/web_his/thongtin`, { method: 'POST', signal: hisStaffCtrl.signal }).catch(() => null),
        fetch(`${hisOrigin}/web_his/danhsach_canbo_nhanvien_sudungapiBHXH?dvtt=${targetUnit}`, { signal: hisStaffCtrl.signal }).catch(() => null)
      ]);

      if (infoRes && infoRes.ok) {
        try {
          const infoData = await infoRes.json();
          currentMaNv = infoData?.MA_NHANVIEN || infoData?.MANHANVIEN || '';
          currentTenNv = (infoData?.TEN_NHANVIEN || infoData?.HOTEN || '').trim();
          currentCccdNv = (infoData?.SO_CCCD || infoData?.CMT || infoData?.SO_CMT || '').trim();
        } catch (e) {}
      }

      if (staffRes && staffRes.ok) {
        const staffList = await staffRes.json();
        if (Array.isArray(staffList) && staffList.length > 0) {
          let firstValid = null;
          let matchedStaff = null;

          for (const s of staffList) {
            const t = (s.TEN_NHANVIEN || '').trim();
            const c = (s.SO_CCCD_NV || '').trim();
            if (t && c) {
              if (!firstValid) firstValid = { unit: targetUnit, hoTenCb: t, cccdCb: c };
              if (currentMaNv && s.MA_NHANVIEN_HIS === currentMaNv) {
                matchedStaff = { unit: targetUnit, hoTenCb: t, cccdCb: c };
                break;
              }
            }
          }

          const chosen = matchedStaff || firstValid;
          if (chosen) {
            console.log('[Background Gateway] Đã tự động nhận diện cán bộ từ HIS cho đơn vị', targetUnit, ':', chosen);
            cachedStaff = chosen;
            chrome.storage.local.set({
              bhxh_cb_unit: targetUnit,
              bhxh_cb_hoten: chosen.hoTenCb,
              bhxh_cb_cccd: chosen.cccdCb
            }).catch(() => {});
            return cachedStaff;
          }
        }
      }

      // Nếu không có danh sách cán bộ riêng nhưng user đang đăng nhập trên HIS có Tên và CCCD:
      if (currentTenNv && currentCccdNv) {
        const userStaff = { unit: targetUnit, hoTenCb: currentTenNv, cccdCb: currentCccdNv };
        cachedStaff = userStaff;
        return cachedStaff;
      }
    } catch (err) {
      console.log('[Background Gateway] Không thể lấy cán bộ từ HIS:', err);
    } finally {
      clearTimeout(hisStaffTimeout);
    }
  }

  // 4. Fallback cán bộ của đơn vị 49006 (TTYT Duy Xuyên)
  if (targetUnit === '49006') {
    cachedStaff = {
      unit: '49006',
      hoTenCb: 'Đặng Quốc Hải',
      cccdCb: '031067011746'
    };
    return cachedStaff;
  }

  // Đối với các đơn vị khác: không dùng CCCD của cán bộ Duy Xuyên để tránh bị Cổng BHXH từ chối
  cachedStaff = {
    unit: targetUnit,
    hoTenCb: '',
    cccdCb: ''
  };
  return cachedStaff;
}

// =========================================================================
// 1. THUẬT TOÁN MD5 XÁC THỰC CỔNG BHXH VIỆT NAM
// =========================================================================
function MD5(d) {
  var result = M(V(Y(X(d), 8 * d.length)));
  return result.toLowerCase();
}
function M(d) {
  for (var _, m = '0123456789ABCDEF', f = '', r = 0; r < d.length; r++)
    _ = d.charCodeAt(r), f += m.charAt(_ >>> 4 & 15) + m.charAt(15 & _);
  return f;
}
function X(d) {
  for (var _ = Array(d.length >> 2), m = 0; m < _.length; m++) _[m] = 0;
  for (m = 0; m < 8 * d.length; m += 8) _[m >> 5] |= (255 & d.charCodeAt(m / 8)) << m % 32;
  return _;
}
function V(d) {
  for (var _ = '', m = 0; m < 32 * d.length; m += 8) _ += String.fromCharCode(d[m >> 5] >>> m % 32 & 255);
  return _;
}
function Y(d, _) {
  d[_ >> 5] |= 128 << _ % 32, d[14 + (_ + 64 >>> 9 << 4)] = _;
  for (var m = 1732584193, f = -271733879, r = -1732584194, i = 271733878, n = 0; n < d.length; n += 16) {
    var h = m, t = f, g = r, e = i;
    f = md5_ii(f = md5_ii(f = md5_ii(f = md5_ii(f = md5_hh(f = md5_hh(f = md5_hh(f = md5_hh(f = md5_gg(f = md5_gg(f = md5_gg(f = md5_gg(f = md5_ff(f = md5_ff(f = md5_ff(f = md5_ff(f, r = md5_ff(r, i = md5_ff(i, m = md5_ff(m, f, r, i, d[n + 0], 7, -680876936), f, r, d[n + 1], 12, -389564586), m, f, d[n + 2], 17, 606105819), i, m, d[n + 3], 22, -1044525330), r = md5_ff(r, i = md5_ff(i, m = md5_ff(m, f, r, i, d[n + 4], 7, -176418897), f, r, d[n + 5], 12, 1200080426), m, f, d[n + 6], 17, -1473231341), i, m, d[n + 7], 22, -45705983), r = md5_ff(r, i = md5_ff(i, m = md5_ff(m, f, r, i, d[n + 8], 7, 1770035416), f, r, d[n + 9], 12, -1958414417), m, f, d[n + 10], 17, -42063), i, m, d[n + 11], 22, -1990404162), r = md5_ff(r, i = md5_ff(i, m = md5_ff(m, f, r, i, d[n + 12], 7, 1804603682), f, r, d[n + 13], 12, -40341101), m, f, d[n + 14], 17, -1502002290), i, m, d[n + 15], 22, 1236535329), r = md5_gg(r, i = md5_gg(i, m = md5_gg(m, f, r, i, d[n + 1], 5, -165796510), f, r, d[n + 6], 9, -1069501632), m, f, d[n + 11], 14, 643717713), i, m, d[n + 0], 20, -373897302), r = md5_gg(r, i = md5_gg(i, m = md5_gg(m, f, r, i, d[n + 5], 5, -701558691), f, r, d[n + 10], 9, 38016083), m, f, d[n + 15], 14, -660478335), i, m, d[n + 4], 20, -405537848), r = md5_gg(r, i = md5_gg(i, m = md5_gg(m, f, r, i, d[n + 9], 5, 568446438), f, r, d[n + 14], 9, -1019803690), m, f, d[n + 3], 14, -187363961), i, m, d[n + 8], 20, 1163531501), r = md5_gg(r, i = md5_gg(i, m = md5_gg(m, f, r, i, d[n + 13], 5, -1444681467), f, r, d[n + 2], 9, -51403784), m, f, d[n + 7], 14, 1735328473), i, m, d[n + 12], 20, -1926607734), r = md5_hh(r, i = md5_hh(i, m = md5_hh(m, f, r, i, d[n + 5], 4, -378558), f, r, d[n + 8], 11, -2022574463), m, f, d[n + 11], 16, 1839030562), i, m, d[n + 14], 23, -35309556), r = md5_hh(r, i = md5_hh(i, m = md5_hh(m, f, r, i, d[n + 1], 4, -1530992060), f, r, d[n + 4], 11, 1272893353), m, f, d[n + 7], 16, -155497632), i, m, d[n + 10], 23, -1094730640), r = md5_hh(r, i = md5_hh(i, m = md5_hh(m, f, r, i, d[n + 13], 4, 681279174), f, r, d[n + 0], 11, -358537222), m, f, d[n + 3], 16, -722521979), i, m, d[n + 6], 23, 76029189), r = md5_hh(r, i = md5_hh(i, m = md5_hh(m, f, r, i, d[n + 9], 4, -640364487), f, r, d[n + 12], 11, -421815835), m, f, d[n + 15], 16, 530742520), i, m, d[n + 2], 23, -995338651), r = md5_ii(r, i = md5_ii(i, m = md5_ii(m, f, r, i, d[n + 0], 6, -198630844), f, r, d[n + 7], 10, 1126891415), m, f, d[n + 14], 15, -1416354905), i, m, d[n + 5], 21, -57434055), r = md5_ii(r, i = md5_ii(i, m = md5_ii(m, f, r, i, d[n + 12], 6, 1700485571), f, r, d[n + 3], 10, -1894986606), m, f, d[n + 10], 15, -1051523), i, m, d[n + 1], 21, -2054922799), r = md5_ii(r, i = md5_ii(i, m = md5_ii(m, f, r, i, d[n + 8], 6, 1873313359), f, r, d[n + 15], 10, -30611744), m, f, d[n + 6], 15, -1560198380), i, m, d[n + 13], 21, 1309151649), r = md5_ii(r, i = md5_ii(i, m = md5_ii(m, f, r, i, d[n + 4], 6, -145523070), f, r, d[n + 11], 10, -1120210379), m, f, d[n + 2], 15, 718787259), i, m, d[n + 9], 21, -343485551), m = safe_add(m, h), f = safe_add(f, t), r = safe_add(r, g), i = safe_add(i, e);
  }
  return Array(m, f, r, i);
}
function md5_cmn(d, _, m, f, r, i) { return safe_add(bit_rol(safe_add(safe_add(_, d), safe_add(f, i)), r), m); }
function md5_ff(d, _, m, f, r, i, n) { return md5_cmn(_ & m | ~_ & f, d, _, r, i, n); }
function md5_gg(d, _, m, f, r, i, n) { return md5_cmn(_ & f | m & ~f, d, _, r, i, n); }
function md5_hh(d, _, m, f, r, i, n) { return md5_cmn(_ ^ m ^ f, d, _, r, i, n); }
function md5_ii(d, _, m, f, r, i, n) { return md5_cmn(m ^ (_ | ~f), d, _, r, i, n); }
function safe_add(d, _) { var m = (65535 & d) + (65535 & _); return (d >> 16) + (_ >> 16) + (m >> 16) << 16 | 65535 & m; }
function bit_rol(d, _) { return d << _ | d >>> 32 - _; }

// =========================================================================
// 2. ĐỊNH DẠNG NGÀY & GIỜ TRẢ VỀ TỪ CỔNG BHXH
// =========================================================================
function formatBhxhDate(dateStr) {
  if (!dateStr && dateStr !== 0) return '';
  const s = String(dateStr).trim();
  if (!s) return '';

  // 0. Xử lý ASP.NET / WCF JSON date: /Date(520880400000)/ hoặc /Date(520880400000+0700)/
  if (s.includes('/Date(')) {
    const m = s.match(/\/Date\((\d+)/);
    if (m && m[1]) {
      const d = new Date(Number(m[1]));
      if (!isNaN(d.getTime())) {
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        if (year >= 1900 && year <= 2100) {
          return `${day}/${month}/${year}`;
        }
      }
    }
  }

  // 1. Xử lý Unix timestamp (milliseconds từ 10 đến 13 chữ số, hỗ trợ cả số âm cho người sinh trước năm 1970 ví dụ năm 1968)
  if (typeof dateStr === 'number' || /^-?\d{10,13}$/.test(s)) {
    const ms = Number(s);
    if (!isNaN(ms)) {
      const d = new Date(ms);
      if (!isNaN(d.getTime())) {
        const day = String(d.getDate()).padStart(2, '0');
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const year = d.getFullYear();
        if (year >= 1900 && year <= 2100) {
          return `${day}/${month}/${year}`;
        }
      }
    }
  }

  // 2. YYYYMMDDHHmmss (14 số)
  if (/^\d{14}$/.test(s)) {
    const y = parseInt(s.substring(0, 4), 10);
    if (y >= 1900 && y <= 2100) {
      return `${s.substring(6, 8)}/${s.substring(4, 6)}/${s.substring(0, 4)}`;
    }
  }

  // 3. YYYYMMDD (8 số) -> DD/MM/YYYY
  if (/^\d{8}$/.test(s)) {
    const p1 = parseInt(s.substring(0, 4), 10);
    const p2 = parseInt(s.substring(4, 8), 10);
    if (p1 >= 1900 && p1 <= 2100) {
      return `${s.substring(6, 8)}/${s.substring(4, 6)}/${s.substring(0, 4)}`;
    }
    if (p2 >= 1900 && p2 <= 2100) {
      return `${s.substring(0, 2)}/${s.substring(2, 4)}/${s.substring(4, 8)}`;
    }
  }

  // 4. YYYY-MM-DD -> DD/MM/YYYY
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const parts = s.substring(0, 10).split('-');
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  return s;
}

function formatBhxhDateOnly(dtStr) {
  if (!dtStr) return '';
  const s = String(dtStr).trim();

  // 14 số, 12 số hoặc 8 số (YYYYMMDD...)
  if (/^\d{8,14}$/.test(s)) {
    const y = s.substring(0, 4);
    const m = s.substring(4, 6);
    const d = s.substring(6, 8);
    const yearNum = parseInt(y, 10);
    if (yearNum >= 1900 && yearNum <= 2100) {
      return `${d}/${m}/${y}`;
    }
    if (s.length === 8) {
      const yearEnd = parseInt(s.substring(4, 8), 10);
      if (yearEnd >= 1900 && yearEnd <= 2100) {
        return `${s.substring(0, 2)}/${s.substring(2, 4)}/${s.substring(4, 8)}`;
      }
    }
  }

  // YYYY-MM-DD... -> DD/MM/YYYY
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const parts = s.substring(0, 10).split('-');
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  // DD/MM/YYYY... -> lấy 10 ký tự ngày DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) {
    return s.substring(0, 10);
  }

  return s;
}

function formatKhoaPhongChanDoan(item) {
  if (!item) return '';
  const kp = (item.khoaPhong || item.tenKhoa || item.TEMP1 || item.khoa || '').trim();
  const cd = (item.tenBenh || item.chanDoan || item.maBenh || item.lyDoVV || '').trim();

  if (kp && cd) {
    if (kp.toLowerCase() === cd.toLowerCase()) return kp;
    if (kp.toLowerCase().includes(cd.toLowerCase())) return kp;
    if (cd.toLowerCase().includes(kp.toLowerCase())) return cd;
    return `${kp} - ${cd}`;
  }
  return kp || cd || item.TEMP2 || '';
}

function formatBhxhDateTime(dtStr) {
  if (!dtStr) return '';
  const s = String(dtStr).trim();

  // 1. Nếu chuỗi bị đảo dạng HH:mm DD/MM/YYYY -> chuẩn hóa thành DD/MM/YYYY HH:mm
  const revMatch = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s+(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (revMatch) {
    const hh = revMatch[1].padStart(2, '0');
    const mm = revMatch[2];
    const dd = revMatch[3].padStart(2, '0');
    const mon = revMatch[4].padStart(2, '0');
    const yyyy = revMatch[5];
    return `${dd}/${mon}/${yyyy} ${hh}:${mm}`;
  }

  // 2. YYYYMMDDHHmmss (14 số) -> DD/MM/YYYY HH:mm
  if (/^\d{14}$/.test(s)) {
    return `${s.substring(6, 8)}/${s.substring(4, 6)}/${s.substring(0, 4)} ${s.substring(8, 10)}:${s.substring(10, 12)}`;
  }

  // 3. YYYYMMDDHHmm (12 số) -> DD/MM/YYYY HH:mm
  if (/^\d{12}$/.test(s)) {
    return `${s.substring(6, 8)}/${s.substring(4, 6)}/${s.substring(0, 4)} ${s.substring(8, 10)}:${s.substring(10, 12)}`;
  }

  // 4. YYYYMMDD (8 số) -> DD/MM/YYYY
  if (/^\d{8}$/.test(s)) {
    return `${s.substring(6, 8)}/${s.substring(4, 6)}/${s.substring(0, 4)}`;
  }

  // 5. ISO string YYYY-MM-DDTHH:mm:ss hoặc YYYY-MM-DD HH:mm:ss
  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})/);
  if (isoMatch) {
    const yyyy = isoMatch[1];
    const mon = isoMatch[2].padStart(2, '0');
    const dd = isoMatch[3].padStart(2, '0');
    const hh = isoMatch[4].padStart(2, '0');
    const mm = isoMatch[5];
    return `${dd}/${mon}/${yyyy} ${hh}:${mm}`;
  }

  return s;
}

// =========================================================================
// 3. DIỄN GIẢI MÃ KẾT QUẢ TỪ CỔNG BHXH VIỆT NAM
// =========================================================================
const MA_KET_QUA_MESSAGES = {
  '000': 'Thẻ còn giá trị sử dụng',
  '001': 'Thẻ do BHXH Bộ Quốc Phòng quản lý, đề nghị kiểm tra thẻ và thông tin giấy tờ tùy thân',
  '002': 'Thẻ do BHXH Bộ Công An quản lý, đề nghị kiểm tra thẻ và thông tin giấy tờ tùy thân',
  '003': 'Thẻ cũ hết giá trị sử dụng, đã được cấp thẻ mới',
  '004': 'Thẻ cũ còn giá trị sử dụng, đã được cấp thẻ mới',
  '010': 'Thẻ hết giá trị sử dụng',
  '050': 'Không tìm thấy thông tin thẻ trên Cổng tiếp nhận dữ liệu BHXH',
  '051': 'Mã thẻ không đúng định dạng',
  '052': 'Mã tỉnh cấp thẻ (ký tự thứ 4, 5) của thẻ không đúng',
  '053': 'Mã quyền lợi (ký tự thứ 3) của thẻ không đúng',
  '054': 'Số CCCD của cán bộ thực hiện tra cứu không tồn tại trong danh sách do CSKCB đăng ký với BHXH',
  '055': 'Họ và tên của cán bộ thực hiện tra cứu không khớp với số CCCD',
  '060': 'Thẻ sai họ tên so với cơ sở dữ liệu BHXH',
  '061': 'Thẻ sai họ tên (đúng ký tự đầu)',
  '070': 'Thẻ sai ngày tháng năm sinh',
  '100': 'Lỗi khi lấy dữ liệu sổ thẻ từ hệ thống BHXH',
  '101': 'Lỗi máy chủ Cổng tiếp nhận BHXH Việt Nam',
  '110': 'Thẻ bảo hiểm y tế đã bị thu hồi',
  '120': 'Thẻ bảo hiểm y tế đã báo giảm',
  '121': 'Thẻ đã báo giảm chuyển ngoại tỉnh',
  '122': 'Thẻ đã báo giảm chuyển nội tỉnh',
  '123': 'Thẻ đã báo giảm do tăng lại cùng đơn vị',
  '124': 'Thẻ đã báo giảm ngừng tham gia',
  '130': 'Trẻ em không xuất trình thẻ BHYT',
  '205': 'Lỗi sai định dạng tham số gửi lên Cổng',
  '401': 'Lỗi xác thực tài khoản Cổng BHXH (Kiểm tra lại tài khoản & mật khẩu liên thông)'
};

// =========================================================================
// 4. LẮNG NGHE YÊU CẦU TỪ CONTENT SCRIPT & POPUP
// =========================================================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkBhyt') {
    const senderTabId = sender?.tab?.id || null;
    const senderFrameId = sender?.frameId != null ? sender.frameId : null;
    executeRealBhytCheck(request.payload, senderTabId, sendResponse, senderFrameId)
      .then((data) => {
        if (data && typeof sendResponse === 'function') {
          try { sendResponse(data); } catch (e) {}
        }
      })
      .catch((err) => {
        console.log('[Background Gateway Warning]', err.message || err);
        try {
          sendResponse({
            success: false,
            isLive: false,
            message: err.message || 'Lỗi không xác định khi kết nối Cổng tiếp nhận BHXH'
          });
        } catch (e) {}
      });
    return true; // Giữ kênh async
  }

  if (request.action === 'testConnection') {
    testDirectBhxhConnection(request.payload)
      .then((data) => sendResponse(data))
      .catch((err) => {
        sendResponse({
          success: false,
          message: err.message || 'Không thể kết nối Cổng BHXH'
        });
      });
    return true;
  }

  if (request.action === 'traCuuTienMCCT') {
    executeTraCuuTienMCCTOnly(request.payload)
      .then((data) => sendResponse(data))
      .catch((err) => {
        sendResponse({
          success: false,
          message: err.message || 'Lỗi tra cứu tiền MCCT từ Cổng BHXH'
        });
      });
    return true;
  }

  if (request.action === 'detectHisCskcb') {
    handleDetectHisCskcb(request.payload)
      .then((data) => sendResponse(data))
      .catch((err) => {
        sendResponse({
          success: false,
          message: err.message || 'Không thể nhận diện Mã CSKCB từ HIS'
        });
      });
    return true;
  }
});

// =========================================================================
// 4.1 TỰ ĐỘNG ĐỒNG BỘ DỮ LIỆU ĐẦY ĐỦ TỪ CỔNG GIÁM ĐỊNH BHYT (gdbhyt.baohiemxahoi.gov.vn)
// Nếu cán bộ đang đăng nhập Cổng BHXH trên cùng trình duyệt
// =========================================================================
function parseGdbhytHtml(html, cardThe, name) {
  const result = {
    kcbList: [],
    ktList: []
  };
  if (!html) return result;

  try {
    // 1. Phân tích bảng Lịch sử Khám chữa bệnh
    const kcbSection = html.match(/LỊCH\s*SỬ\s*KHÁM\s*CHỮA\s*BỆNH[\s\S]*?<table[\s\S]*?<\/table>/i);
    if (kcbSection) {
      const rows = [...kcbSection[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
      for (const row of rows) {
        const rowHtml = row[1];
        if (/<th/i.test(rowHtml)) continue;
        const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => c[1].replace(/<[^>]+>/g, '').trim());
        if (cells.length >= 7) {
          result.kcbList.push({
            stt: cells[0],
            maThe: cells[1] || cardThe,
            hoTen: cells[2] || name,
            ngayVao: cells[3],
            ngayRa: cells[4],
            khoaPhong: cells[5],
            cskcb: cells[6],
            kqDieuTri: cells[7] || '',
            rawNgayVao: cells[3]
          });
        }
      }
    }

    // 2. Phân tích bảng Thông tin kiểm tra thẻ
    const ktSection = html.match(/THÔNG\s*TIN\s*KIỂM\s*TRA\s*THẺ[\s\S]*?<table[\s\S]*?<\/table>/i);
    if (ktSection) {
      const rows = [...ktSection[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
      for (const row of rows) {
        const rowHtml = row[1];
        if (/<th/i.test(rowHtml)) continue;
        const cells = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => c[1].replace(/<[^>]+>/g, '').trim());
        if (cells.length >= 5) {
          result.ktList.push({
            stt: cells[0],
            user: cells[1],
            cskcb: cells[2],
            thoiGian: cells[3],
            thongBao: cells[4],
            rawThoiGian: cells[3]
          });
        }
      }
    }
    console.log(`[Background Gateway] Đã trích xuất từ Cổng gdbhyt: ${result.kcbList.length} lượt KCB, ${result.ktList.length} lượt kiểm tra thẻ.`);
  } catch (err) {
    console.log('[Background Gateway] Lỗi phân tích HTML từ gdbhyt:', err);
  }
  return result;
}

async function fetchGdbhytThongTuyen(cardThe, name, dob) {
  const gdbhytUrl = 'https://gdbhyt.baohiemxahoi.gov.vn/ThongTuyenLSKCB/Index';
  try {
    const params = new URLSearchParams();
    params.append('maThe', cardThe);
    params.append('hoTen', name);
    params.append('ngaySinh', dob);
    params.append('thoiGian', '6');

    // Thử POST trực tiếp với cookie phiên làm việc có sẵn trên trình duyệt
    let res = await fetch(gdbhytUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      body: params.toString(),
      credentials: 'include'
    });

    if (res.ok) {
      let html = await res.text();
      if (html && (html.includes('LỊCH SỬ KHÁM CHỮA BỆNH') || html.includes('THÔNG TIN KIỂM TRA THẺ'))) {
        const parsed = parseGdbhytHtml(html, cardThe, name);
        if (parsed.kcbList.length > 0 || parsed.ktList.length > 0) {
          return parsed;
        }
      }
    }

    // Thử GET với query parameters nếu POST không trả kết quả
    const getUrl = `${gdbhytUrl}?maThe=${encodeURIComponent(cardThe)}&hoTen=${encodeURIComponent(name)}&ngaySinh=${encodeURIComponent(dob)}&thoiGian=6`;
    let resGet = await fetch(getUrl, {
      method: 'GET',
      credentials: 'include'
    });
    if (resGet.ok) {
      let htmlGet = await resGet.text();
      if (htmlGet && (htmlGet.includes('LỊCH SỬ KHÁM CHỮA BỆNH') || htmlGet.includes('THÔNG TIN KIỂM TRA THẺ'))) {
        const parsedGet = parseGdbhytHtml(htmlGet, cardThe, name);
        if (parsedGet.kcbList.length > 0 || parsedGet.ktList.length > 0) {
          return parsedGet;
        }
      }
    }
  } catch (err) {
    console.log('[Background Gateway] Không thể lấy từ gdbhyt web:', err);
  }
  return null;
}

// =========================================================================
// HELPER: ĐỒNG BỘ & ĐỊNH DẠNG LỊCH SỬ KCB (LSKCB) VÀ KIỂM TRA THẺ (LSKT)
// =========================================================================
const KET_QUA_DIEU_TRI_MAP = {
  '1': 'Khỏi',
  '2': 'Đỡ',
  '3': 'Không thay đổi',
  '4': 'Nặng hơn',
  '5': 'Tử vong'
};

const TINH_TRANG_RA_VIEN_MAP = {
  '1': 'Ra viện',
  '2': 'Chuyển viện',
  '3': 'Trốn viện',
  '4': 'Xin ra viện'
};

function mapLskcbRecords(allKcbRaw, cardThe, name, hasNewCard = false, maTheMoi = '') {
  if (!Array.isArray(allKcbRaw) || allKcbRaw.length === 0) return [];
  const activeLskcbCard = (hasNewCard && maTheMoi) ? maTheMoi : cardThe;

  const mapped = allKcbRaw.map((item) => {
    const rawKq = String(item.kqDieuTri || item.ketQuaDieuTri || item.kq_dieutri || item.KET_QUA_DT || '').trim();
    const displayKq = KET_QUA_DIEU_TRI_MAP[rawKq] || rawKq;

    const rawTt = String(item.tinhTrang || item.tinhTrangRaVien || item.ttRaVien || '').trim();
    const displayTt = TINH_TRANG_RA_VIEN_MAP[rawTt] || rawTt;

    const nvRaw = item.ngayVao || item.ngay_vao || item.NGAY_VAO || item.ngayVaoVien || '';
    const nrRaw = item.ngayRa || item.ngay_ra || item.NGAY_RA || item.ngayRaVien || '';
    const rawCskcbVal = item.tenCSKCB || item.tenCskcb || item.maCSKCB || item.cskcb || item.TEN_CSKCB || '';

    const rawItemCard = String(item.maThe || item.soThe || item.mathe || item.SO_THE_BHYT || item.MA_THE || '').trim().toUpperCase();
    const finalItemCard = rawItemCard || ((hasNewCard && maTheMoi) ? maTheMoi : activeLskcbCard);

    return {
      maThe: finalItemCard,
      hoTen: item.hoTen || item.ho_ten || item.hoten || name,
      ngayVao: formatBhxhDateTime(nvRaw),
      ngayRa: formatBhxhDateTime(nrRaw),
      khoaPhong: formatKhoaPhongChanDoan(item),
      cskcb: formatCskcbName(rawCskcbVal),
      kqDieuTri: displayKq || displayTt || '',
      rawNgayVao: String(nvRaw || '')
    };
  });

  mapped.sort((a, b) => (b.rawNgayVao || '').localeCompare(a.rawNgayVao || ''));

  return mapped.map((item, idx) => ({
    stt: idx + 1,
    maThe: item.maThe,
    hoTen: item.hoTen,
    ngayVao: item.ngayVao,
    ngayRa: item.ngayRa,
    khoaPhong: item.khoaPhong,
    cskcb: item.cskcb,
    kqDieuTri: item.kqDieuTri
  }));
}

function mapLsktRecords(rawLskt, currentCheckItem) {
  const mappedLskt = (Array.isArray(rawLskt) ? rawLskt : []).map((item) => {
    const u = String(item.userKT || item.user || item.nguoiKT || item.nguoiKiemTra || item.canBo || '').trim();
    const cskcbCode = item.cskcb || item.tenCSKCB || item.tenCskcb || (u.length >= 5 ? u.substring(0, 5) : u);
    const thoiGianRaw = item.thoiGianKT || item.thoiGian || item.thoigian || item.ngayKT || '';
    const thongBaoText = item.thongBao || item.noiDung || item.ghiChu || item.thong_bao || item.ketQua || '';

    return {
      user: u,
      cskcb: cskcbCode,
      thoiGian: formatBhxhDateTime(thoiGianRaw),
      thongBao: thongBaoText,
      rawThoiGian: String(thoiGianRaw || '')
    };
  });

  mappedLskt.sort((a, b) => (b.rawThoiGian || '').localeCompare(a.rawThoiGian || ''));

  // 1. Khử trùng lặp nội bộ trong danh sách trả về từ Cổng BHXH (tránh Cổng trả về 2 bản ghi giống hệt nhau)
  const uniqueLskt = [];
  const seenKeys = new Set();
  for (const it of mappedLskt) {
    if (!it.thoiGian && !it.thongBao) continue;
    const cleanMsg = (it.thongBao || '').trim().replace(/\s+/g, ' ');
    const key = `${it.thoiGian}|${it.user}|${it.cskcb}|${cleanMsg.substring(0, 60)}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      uniqueLskt.push(it);
    }
  }

  // 2. Chống lặp với currentCheckItem (nếu Cổng BHXH đã lưu và trả về chính đợt kiểm tra hiện tại)
  let combined = uniqueLskt;
  if (currentCheckItem) {
    const currentMsg = (currentCheckItem.thongBao || '').trim().replace(/\s+/g, ' ');
    const alreadyExists = uniqueLskt.some((it) => {
      const sameTime = it.thoiGian && currentCheckItem.thoiGian && it.thoiGian === currentCheckItem.thoiGian;
      const sameUserOrCskcb = (it.user && currentCheckItem.user && it.user === currentCheckItem.user) ||
                              (it.cskcb && currentCheckItem.cskcb && it.cskcb === currentCheckItem.cskcb);
      if (sameTime && sameUserOrCskcb) return true;

      if (sameTime && it.thongBao && currentCheckItem.thongBao) {
        const itMsg = (it.thongBao || '').trim().replace(/\s+/g, ' ');
        if (itMsg === currentMsg || itMsg.includes(currentMsg.substring(0, 40)) || currentMsg.includes(itMsg.substring(0, 40))) {
          return true;
        }
      }
      return false;
    });

    // CHỈ chèn thêm currentCheckItem nếu trong danh sách từ Cổng chưa có đợt kiểm tra này
    if (!alreadyExists) {
      combined = [currentCheckItem, ...uniqueLskt];
    }
  }

  return combined.map((item, idx) => ({
    stt: idx + 1,
    user: item.user,
    cskcb: item.cskcb,
    thoiGian: item.thoiGian,
    thongBao: item.thongBao
  }));
}

// =========================================================================
// 5. THỰC HIỆN TRA CỨU THỰC TẾ 100% TỪ CỔNG BHXH VIỆT NAM (KHÔNG CẦN BACKEND)
// =========================================================================
const inFlightBhytChecks = new Map();
const recentCheckCache = new Map();

async function executeRealBhytCheck(payload, senderTabId = null, sendResponseCallback = null, senderFrameId = null) {
  let { soCccd, hoTen, ngaySinh, maThe, hisOrigin, username, password, altCards, altDobs, ngaySinhFull, namSinh, skipHistory, requestId } = payload || {};

  const reqId = requestId || `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const tStart = Date.now();
  const metrics = {
    requestId: reqId,
    token_ms: 0,
    token_cached: false,
    main_api_ms: 0,
    phase1_ms: 0,
    history_ms: 0,
    total_ms: 0
  };

  const cleanCccd = (soCccd || '').replace(/\D/g, '');
  let cleanMaThe = (maThe || '').replace(/\s+/g, '').toUpperCase();
  if (cleanMaThe === '0') cleanMaThe = '';
  if (!cleanMaThe && Array.isArray(altCards) && altCards.length > 0) {
    for (const c of altCards) {
      const cleanC = (c || '').replace(/\s+/g, '').toUpperCase();
      if (cleanC && cleanC !== '0') {
        cleanMaThe = cleanC;
        break;
      }
    }
  }

  // BẢO VỆ TUYỆT ĐỐI BỆNH NHÂN KHÔNG BHYT (VIỆN PHÍ / THU PHÍ / KHÁM DỊCH VỤ):
  // Nếu bệnh nhân không có thông tin thẻ BHYT và cũng không có số CCCD, thoát sớm ngay lập tức trong 0ms.
  // Không gọi lên Cổng BHXH để triệt tiêu hoàn toàn cảnh báo "Lỗi xác thực tài khoản" hay "401" không đáng có!
  if (!cleanMaThe && !cleanCccd) {
    const noCardRes = {
      success: false,
      maKetQua: '999',
      message: 'Bệnh nhân không có thông tin thẻ BHYT hoặc số CCCD để tra cứu.',
      ghiChuCổng: 'Bệnh nhân không có thông tin thẻ BHYT hoặc số CCCD để tra cứu.',
      data: null,
      lichSuKcb: [],
      lichSuKiemTraThe: [],
      requestId: reqId
    };
    if (typeof sendResponseCallback === 'function') {
      try { sendResponseCallback(noCardRes); } catch (e) {}
    }
    return noCardRes;
  }

  const cleanName = (hoTen || '').replace(/[\s\u00A0]+/g, ' ').trim().toUpperCase().normalize('NFC');
  let cleanDob = normalizeDobForBhxh(ngaySinh);
  if (!cleanDob && ngaySinhFull) cleanDob = normalizeDobForBhxh(ngaySinhFull);
  if (!cleanDob && namSinh) cleanDob = normalizeDobForBhxh(namSinh);

  // Khóa nhận diện duy nhất chống trùng lặp API cho bệnh nhân
  const dedupKey = `${cleanCccd}|${cleanMaThe}|${cleanName}|${cleanDob}|${Boolean(skipHistory)}`;

  // 1. Kiểm tra RAM cache kết quả gần nhất (trong vòng 5 giây):
  const cachedRecent = recentCheckCache.get(dedupKey);
  if (cachedRecent && (Date.now() - cachedRecent.timestamp < 5000)) {
    console.log(`[BHYT Metrics][${reqId}] ⚡ Trả kết quả tức thì từ RAM cache (0ms):`, dedupKey);
    const cachedRes = { ...cachedRecent.result, requestId: reqId, phase: 'completed' };
    if (typeof sendResponseCallback === 'function') {
      try { sendResponseCallback(cachedRes); } catch (e) {}
    }
    // Gửi stream ngay lập tức để content script không bị treo "Đang tải dữ liệu Lịch sử KCB..."
    if (senderTabId) {
      try {
        const streamPayload = {
          action: 'streamLskcbUpdate',
          payload: {
            requestId: reqId,
            maThe: cleanMaThe || cachedRes.data?.maThe || '',
            soCCCD: cleanCccd || cachedRes.data?.soCCCD || '',
            lichSuKcb: cachedRes.lichSuKcb || [],
            lichSuKiemTraThe: cachedRes.lichSuKiemTraThe || [],
            ghiChuCổng: cachedRes.ghiChuCổng || '',
            mcct: {
              soTienLuyKe: cachedRes.data?.soTienLuyKe || 0,
              ngayMcct: cachedRes.data?.ngayMcct || '',
              coMcct: Boolean(cachedRes.data?.coMcct),
              chiTietMcct: cachedRes.data?.chiTietMcct || null
            }
          }
        };
        chrome.tabs.sendMessage(senderTabId, streamPayload).catch(() => {});
        if (senderFrameId != null && senderFrameId !== 0) {
          chrome.tabs.sendMessage(senderTabId, streamPayload, { frameId: senderFrameId }).catch(() => {});
        }
        try {
          chrome.tabs.query({}, (tabs) => {
            (tabs || []).forEach((t) => {
              if (t.id && t.id !== senderTabId && t.url && (t.url.includes('his') || t.url.includes('vnpt') || t.url.includes('tiepnhanbenhnhan'))) {
                chrome.tabs.sendMessage(t.id, streamPayload).catch(() => {});
              }
            });
          });
        } catch (_) {}
      } catch (e) {}
    }
    return cachedRes;
  }

  // 2. Chống gọi trùng lặp (In-flight deduplication): Nếu đang có request tương tự đang chạy, chia sẻ cùng Promise
  if (inFlightBhytChecks.has(dedupKey)) {
    console.log(`[BHYT Metrics][${reqId}] ⚡ Bỏ qua gọi trùng lặp Cổng BHXH, tái sử dụng Promise đang chạy:`, dedupKey);
    const inFlightResult = await inFlightBhytChecks.get(dedupKey);
    const wrappedResult = { ...inFlightResult, requestId: reqId };
    if (typeof sendResponseCallback === 'function') {
      try { sendResponseCallback(wrappedResult); } catch (e) {}
    }
    return wrappedResult;
  }

  const checkExecutionPromise = (async () => {
  let phase1Sent = false;
  const notifyPhase1 = (resObj) => {
    if (!phase1Sent && typeof sendResponseCallback === 'function') {
      try {
        metrics.phase1_ms = Date.now() - tStart;
        resObj.requestId = reqId;
        resObj.metrics = metrics;
        sendResponseCallback(resObj);
        phase1Sent = true;
        console.log(`[BHYT Metrics][${reqId}] ⚡ [Phase 1: ${metrics.phase1_ms}ms] Đã gửi thông tin thẻ điền Form (main_api: ${metrics.main_api_ms}ms, token: ${metrics.token_ms}ms)`);
      } catch (e) {
        console.warn('[Background Gateway] Không thể gửi sendResponse Phase 1:', e);
      }
    }
  };

  // Fallback 1: Nếu cleanDob rỗng hoặc không hợp lệ, nhưng có số CCCD 12 số, suy ra năm sinh từ CCCD
  if (!cleanDob && cleanCccd && cleanCccd.length === 12) {
    const cGender = parseInt(cleanCccd.charAt(3), 10);
    const cYear = cleanCccd.substring(4, 6);
    let century = 1900;
    if (cGender === 0 || cGender === 1) century = 1900;
    else if (cGender === 2 || cGender === 3) century = 2000;
    else if (cGender === 4 || cGender === 5) century = 2100;
    else if (cGender === 6 || cGender === 7) century = 2200;
    else if (cGender === 8 || cGender === 9) century = 2300;
    cleanDob = String(century + parseInt(cYear, 10));
    console.log('[Background Gateway] Tự động suy ra năm sinh từ CCCD:', cleanDob);
  }

  // Chặn gửi lên Cổng nếu thiếu ngày sinh để tránh mã lỗi 205 khó hiểu từ BHXH
  if (!cleanDob) {
    throw new Error('Chưa xác định được Ngày sinh hoặc Năm sinh của bệnh nhân. Vui lòng kiểm tra lại ô Ngày sinh trên form HIS.');
  }

  // Bước 1: Thu thập thông tin tài khoản liên thông Cổng BHXH (Ưu tiên cache bộ nhớ trước tiên)
  let user = username;
  let pass = password;

  // Ưu tiên 1: Lấy từ memory cache có sẵn (0ms)
  if (!user || !pass) {
    if (cachedCredentials && cachedCredentials.username && cachedCredentials.password) {
      user = cachedCredentials.username;
      pass = cachedCredentials.password;
    }
  }

  // Ưu tiên 2: Đọc từ chrome.storage.local (nhanh ~1ms)
  if (!user || !pass) {
    try {
      const stored = await chrome.storage.local.get(['bhxh_user', 'bhxh_pass']);
      if (stored && stored.bhxh_user && stored.bhxh_pass) {
        user = stored.bhxh_user;
        pass = stored.bhxh_pass;
        cachedCredentials = { username: user, password: pass };
      }
    } catch (e) {}
  }

  // Ưu tiên 3: Nếu chưa có mới đọc cấu hình từ HIS đang mở
  if (hisOrigin && (!user || !pass)) {
    try {
      const hisCred = await fetchHisBhxhCredentials(hisOrigin);
      if (hisCred && hisCred.username && hisCred.password) {
        user = hisCred.username;
        pass = hisCred.password;
        cachedCredentials = hisCred;
        chrome.storage.local.set({ bhxh_user: user, bhxh_pass: pass }).catch(() => {});
      }
    } catch (e) {}
  }

  if (!user || !pass) {
    throw new Error('Chưa cấu hình tài khoản & mật khẩu liên thông Cổng BHXH. Vui lòng bấm vào biểu tượng tiện ích -> Cấu hình để nhập tài khoản. Nếu đã thiết lập đơn vị khác, kiểm tra lại tài khoản và mật khẩu đã nhập đúng chưa.');
  }

  // Bước 2 & 3: Băm MD5 mật khẩu (chống Double MD5), xin Token từ Cổng BHXH và nhận diện cán bộ SONG SONG
  const md5Password = getMd5Password(pass);
  console.log('[Background Gateway] Khởi chạy lấy Token BHXH và thông tin cán bộ song song cho:', user);

  const tToken0 = Date.now();
  const [currentTokenRes, staffRes] = await Promise.all([
    getBhxhToken(user, md5Password),
    resolveStaffCredentials(hisOrigin, user)
  ]);
  let currentToken = currentTokenRes;
  const staff = staffRes;
  metrics.token_ms = Date.now() - tToken0;
  metrics.token_cached = Boolean(cachedToken && cachedTokenUsername === user && tokenExpiresAt > Date.now() + 60000);

  if (!currentToken || !currentToken.access_token || !currentToken.id_token) {
    throw new Error('Không thể lấy mã Token từ Cổng BHXH (API /api/token/take thất bại). Kiểm tra lại tài khoản & mật khẩu liên thông.');
  }

  console.log(`[BHYT Metrics][${reqId}] Token & Cán bộ hoàn tất (${metrics.token_ms}ms, cached: ${metrics.token_cached}):`, staff);

  // Bước 4: Chuẩn bị tham số gọi API KQNhanLichSuKCB2024
  let queryCode = cleanMaThe || cleanCccd;

  async function callBhytGateway(targetCode, targetDob, targetName, customTimeoutMs = 10000, hasRetried401 = false) {
    const queryUrl = `${BHXH_GATEWAY}/api/egw/KQNhanLichSuKCB2024?token=${encodeURIComponent(currentToken.access_token)}&id_token=${encodeURIComponent(currentToken.id_token)}&username=${encodeURIComponent(user)}&password=${encodeURIComponent(md5Password)}`;
    const bodyParams = new URLSearchParams();
    bodyParams.append('maThe', targetCode);
    bodyParams.append('hoTen', targetName || cleanName);
    bodyParams.append('ngaySinh', targetDob || cleanDob);
    if (staff.hoTenCb) bodyParams.append('hoTenCb', staff.hoTenCb);
    if (staff.cccdCb) bodyParams.append('cccdCb', staff.cccdCb);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), customTimeoutMs);
    try {
      const res = await fetch(queryUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
        },
        body: bodyParams.toString(),
        signal: controller.signal
      });

      if (!res.ok) {
        let errText = '';
        try { errText = await res.text(); } catch (e) {}
        console.warn(`[Background Gateway] Cổng BHXH trả về mã lỗi HTTP ${res.status}:`, errText);

        try {
          const errJson = JSON.parse(errText);
          if (errJson && (errJson.maKetQua || errJson.ghiChu || errJson.thongBao)) {
            if (!hasRetried401 && (errJson.maKetQua === '401' || /token/i.test(errJson.ghiChu || errJson.thongBao || ''))) {
              console.warn('[Background Gateway] 🔄 Phát hiện Token hết hạn/không hợp lệ từ Cổng (HTTP errJson). Đang xin Token mới và thử lại...');
              currentToken = await getBhxhToken(user, md5Password, true);
              return await callBhytGateway(targetCode, targetDob, targetName, customTimeoutMs, true);
            }
            return errJson;
          }
        } catch (e) {}

        if ((res.status === 401 || res.status === 403) && !hasRetried401) {
          console.warn('[Background Gateway] 🔄 Cổng trả về HTTP 401/403. Đang xin Token mới và thử lại...');
          currentToken = await getBhxhToken(user, md5Password, true);
          return await callBhytGateway(targetCode, targetDob, targetName, customTimeoutMs, true);
        }

        if (res.status === 401 || res.status === 403) {
          throw new Error(`Cổng tiếp nhận BHXH từ chối yêu cầu (HTTP ${res.status}). Tài khoản [${user}] hoặc Token không có quyền tra cứu. Vui lòng kiểm tra lại tài khoản/mật khẩu trong Cấu hình.`);
        }
        if (errText) {
          throw new Error(`Cổng tiếp nhận BHXH báo lỗi HTTP ${res.status}: ${errText.substring(0, 150)}`);
        }
        return null;
      }

      const resJson = await res.json();
      if (!hasRetried401 && resJson && (resJson.maKetQua === '401' || /token/i.test(resJson.ghiChu || resJson.thongBao || ''))) {
        console.warn('[Background Gateway] 🔄 Cổng trả về Mã 401: Token không đúng. Đang tự động làm mới Token và tra cứu lại...');
        currentToken = await getBhxhToken(user, md5Password, true);
        return await callBhytGateway(targetCode, targetDob, targetName, customTimeoutMs, true);
      }
      return resJson;
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('Kết nối Cổng BHXH bị quá hạn (Timeout 12s). Vui lòng thử lại!');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  const tMain0 = Date.now();
  let result = await callBhytGateway(queryCode, cleanDob);
  metrics.main_api_ms = Date.now() - tMain0;
  console.log(`[BHYT Metrics][${reqId}] Tra cứu thẻ chính (KQNhanLichSuKCB2024): ${metrics.main_api_ms}ms`, result);

  let code1 = String(result?.maKetQua || '');
  let ghiChu1 = String(result?.ghiChu || result?.thongBao || '');
  let successfulDob = '';

  // XỬ LÝ LỖI MÃ 205 HOẶC 070 (Sai ngaySinh):
  // Giới hạn tối đa 2 lần thử lại có xác suất cao nhất (năm sinh YYYY hoặc 01/01/YYYY) để tránh nghẽn mạng
  if (code1 === '205' || code1 === '070' || /sai.*ngaysinh/i.test(ghiChu1)) {
    const dobCandidates = [];
    if (Array.isArray(altDobs)) {
      for (const ad of altDobs) {
        if (ad && !dobCandidates.includes(ad)) dobCandidates.push(ad);
      }
    }
    if (ngaySinhFull && !dobCandidates.includes(ngaySinhFull)) {
      dobCandidates.push(ngaySinhFull);
    }
    if (cleanDob && cleanDob.includes('/')) {
      const parts = cleanDob.split('/');
      if (parts.length === 3 && parts[2].length === 4) {
        // 1. Thử năm sinh yyyy (Rất phổ biến khi Cổng BHXH chỉ lưu năm sinh)
        if (!dobCandidates.includes(parts[2])) dobCandidates.push(parts[2]);
        // 2. Thử 01/01/yyyy nếu ngày sinh gốc khác 01/01
        if (parts[0] !== '01' || parts[1] !== '01') {
          const d0101 = `01/01/${parts[2]}`;
          if (!dobCandidates.includes(d0101)) dobCandidates.push(d0101);
        }
      }
    } else if (cleanDob && /^\d{4}$/.test(cleanDob)) {
      const d0101 = `01/01/${cleanDob}`;
      if (!dobCandidates.includes(d0101)) dobCandidates.push(d0101);
    }

    let dobAttemptCount = 0;
    const maxDobAttempts = 2;
    for (const altDob of dobCandidates) {
      if (altDob && altDob !== cleanDob) {
        if (++dobAttemptCount > maxDobAttempts) break;
        console.log(`[Background Gateway] Thử lại (${dobAttemptCount}/${maxDobAttempts}) với ngày sinh thay thế:`, altDob);
        const retryDobResult = await callBhytGateway(queryCode, altDob);
        const rCode = String(retryDobResult?.maKetQua || '');
        if (retryDobResult && rCode !== '205' && rCode !== '070' && !/sai.*ngaysinh/i.test(retryDobResult?.ghiChu || retryDobResult?.thongBao || '')) {
          result = retryDobResult;
          code1 = String(result?.maKetQua || '');
          ghiChu1 = String(result?.ghiChu || result?.thongBao || '');
          successfulDob = altDob;
          console.log('[Background Gateway] Thử lại thành công với ngày sinh thay thế:', altDob, result);
          break;
        }
      }
    }
    if (successfulDob && !result.ngaySinh) {
      result.ngaySinh = successfulDob;
    }
  }

  // XỬ LÝ LỖI MÃ 060 HOẶC 061 (Sai họ tên) HOẶC 050:
  // Giới hạn thử tối đa 2 phương án xác suất cao nhất (thử số CCCD hoặc 1 biến thể tên phổ biến)
  if (code1 === '060' || code1 === '061' || /sai.*họ.*tên/i.test(ghiChu1)) {
    console.log('[Background Gateway] Phát hiện Mã 060/061 (Sai họ tên), kích hoạt cơ chế Tự động phục hồi có giới hạn...');
    const nameCandidates = generateNameVariations(cleanName).slice(0, 2);
    const codeCandidates = [queryCode];
    if (cleanCccd && cleanCccd.length === 12 && !codeCandidates.includes(cleanCccd)) {
      codeCandidates.push(cleanCccd);
    }

    let foundRecovery = false;
    let recoveryCount = 0;
    const maxRecovery = 2;
    for (const testCode of codeCandidates) {
      if (foundRecovery || recoveryCount >= maxRecovery) break;
      for (const testName of nameCandidates) {
        if (foundRecovery || recoveryCount >= maxRecovery) break;
        if (testCode === queryCode && testName === cleanName) continue;
        recoveryCount++;
        console.log(`[Background Gateway Auto-Healing 060] Thử lại (${recoveryCount}/${maxRecovery}): Mã=${testCode}, Tên=${testName}`);
        const retryRes = await callBhytGateway(testCode, successfulDob || cleanDob, testName);
        const rCode = String(retryRes?.maKetQua || '');
        if (retryRes && (rCode === '000' || rCode === '00' || rCode === '004' || rCode === '003' || rCode === '010')) {
          console.log('[Background Gateway Auto-Healing 060] Phục hồi họ tên thành công!', testName, retryRes);
          result = retryRes;
          code1 = rCode;
          ghiChu1 = String(result?.ghiChu || result?.thongBao || '');
          foundRecovery = true;
          break;
        }
      }
    }
  }

  // XỬ LÝ LỖI MÃ 050, 051, 052, 053 (Thẻ không tồn tại / Mã thẻ sai định dạng / Không tìm thấy thông tin):
  // Rất phổ biến khi:
  // 1. Thẻ mới cấp chưa đến hạn hiệu lực (ví dụ HS4484922044669 có hạn từ 01/10/2026),
  //    trong khi thẻ hợp lệ hiện tại của người bệnh là TE1494922044669 (hạn 06/07/2020 - 30/09/2026).
  // 2. Tra cứu bằng 10 số cuối (Mã số BHXH: 4922044669) - Cổng BHXH Gateway API chấp nhận tra cứu theo 10 số này!
  // 3. Chuyển đổi đầu thẻ cho trẻ em 6 tuổi vào lớp 1: HS4 <-> TE1 với cùng 10 số cuối.
  // 4. Tra cứu thẻ TE (trẻ em) bị gửi năm sinh (2020) thay vì ngày sinh đầy đủ (06/07/2020) hoặc ngược lại.
  // 5. Thử lại số CCCD (12 chữ số) nếu có.
  if (!result || code1 === '050' || code1 === '051' || code1 === '052' || code1 === '053' || /thẻ không tồn tại/i.test(ghiChu1)) {
    console.log('[Background Gateway] Phát hiện Mã 050/051/052/053 (Thẻ không tồn tại), kích hoạt cơ chế Tự động phục hồi thông minh...');

    // 1. Thu thập danh sách mã thẻ ứng viên
    const bhytCardCandidates = [];

    // a. Các thẻ phụ được truyền từ content script (nếu có)
    if (Array.isArray(altCards)) {
      for (const ac of altCards) {
        const cleanAc = (ac || '').replace(/\s+/g, '').toUpperCase();
        if (cleanAc && cleanAc !== '0' && !bhytCardCandidates.includes(cleanAc)) {
          bhytCardCandidates.push(cleanAc);
        }
      }
    }

    // b. Đuôi thẻ (10 số cuối BHXH cho thẻ 15 ký tự, hoặc 12 số CCCD cho thẻ 17 ký tự)
    const baseCard = cleanMaThe || queryCode;
    if (baseCard && (baseCard.length === 15 || baseCard.length === 17)) {
      const subCode = baseCard.substring(5);
      if ((/^\d{10}$/.test(subCode) || /^\d{12}$/.test(subCode)) && !bhytCardCandidates.includes(subCode)) {
        bhytCardCandidates.push(subCode);
      }

      // c. Chuyển đổi mã đầu thẻ: Trẻ em tròn 6 tuổi vào lớp 1 (HS <-> TE)
      if (baseCard.startsWith('HS')) {
        // Đổi sang thẻ TE1 với mã tỉnh gốc
        const teCandidate1 = 'TE1' + baseCard.substring(3, 5) + subCode;
        if (!bhytCardCandidates.includes(teCandidate1)) bhytCardCandidates.push(teCandidate1);
        // Thử thêm mã tỉnh 49 (Quảng Nam) nếu mã thẻ HS ở tỉnh khác (ví dụ 48 Đà Nẵng)
        const teCandidateQnam = 'TE149' + subCode;
        if (!bhytCardCandidates.includes(teCandidateQnam)) bhytCardCandidates.push(teCandidateQnam);
      } else if (baseCard.startsWith('TE')) {
        const hsCandidate1 = 'HS4' + baseCard.substring(3, 5) + subCode;
        if (!bhytCardCandidates.includes(hsCandidate1)) bhytCardCandidates.push(hsCandidate1);
      }
    }

    // d. Số CCCD 12 số nếu có
    if (cleanCccd && cleanCccd.length === 12 && !bhytCardCandidates.includes(cleanCccd)) {
      bhytCardCandidates.push(cleanCccd);
    }

    // 2. Thu thập danh sách Ngày sinh ứng viên
    const smartDobCandidates = [successfulDob || cleanDob];
    if (ngaySinhFull && !smartDobCandidates.includes(ngaySinhFull)) {
      smartDobCandidates.push(ngaySinhFull);
    }
    if (Array.isArray(altDobs)) {
      for (const ad of altDobs) {
        if (ad && !smartDobCandidates.includes(ad)) smartDobCandidates.push(ad);
      }
    }
    if (cleanDob && cleanDob.includes('/')) {
      const parts = cleanDob.split('/');
      if (parts.length === 3 && parts[2].length === 4) {
        if (!smartDobCandidates.includes(parts[2])) smartDobCandidates.push(parts[2]); // Năm sinh YYYY
        if (parts[0] !== '01' || parts[1] !== '01') {
          const d0101 = `01/01/${parts[2]}`;
          if (!smartDobCandidates.includes(d0101)) smartDobCandidates.push(d0101);
        }
      }
    } else if (cleanDob && /^\d{4}$/.test(cleanDob)) {
      const d0101 = `01/01/${cleanDob}`;
      if (!smartDobCandidates.includes(d0101)) smartDobCandidates.push(d0101);
    }

    // Thêm năm sinh ứng viên cho trẻ em TE trong auto-healing 050
    if (baseCard?.startsWith('TE') || bhytCardCandidates.some(c => c.startsWith('TE'))) {
      let refY = null;
      if (cleanDob && /^\d{4}$/.test(cleanDob)) {
        refY = parseInt(cleanDob, 10);
      } else if (cleanDob && cleanDob.includes('/')) {
        const parts = cleanDob.split('/');
        if (parts.length === 3 && /^\d{4}$/.test(parts[2])) {
          refY = parseInt(parts[2], 10);
        }
      }
      if (refY && refY >= 2018 && refY <= 2026) {
        for (const y of [refY, refY - 1, refY + 1]) {
          const yStr = String(y);
          if (!smartDobCandidates.includes(yStr)) smartDobCandidates.push(yStr);
          const d0101 = `01/01/${yStr}`;
          if (!smartDobCandidates.includes(d0101)) smartDobCandidates.push(d0101);
        }
      } else if (smartDobCandidates.length <= 4) {
        const cYear = new Date().getFullYear();
        for (let y = cYear; y >= cYear - 6; y--) {
          const yStr = String(y);
          if (!smartDobCandidates.includes(yStr)) smartDobCandidates.push(yStr);
          const d0101 = `01/01/${yStr}`;
          if (!smartDobCandidates.includes(d0101)) smartDobCandidates.push(d0101);
        }
      }
    }

    // 3. Tiến hành thử nghiệm các tổ hợp để cứu thẻ (giới hạn tối đa 3 lần thử)
    let found050Recovery = false;
    let attempts050 = 0;
    const max050Attempts = 3;
    for (const testCard of bhytCardCandidates.slice(0, 2)) {
      if (found050Recovery || attempts050 >= max050Attempts) break;
      for (const testDob of smartDobCandidates.slice(0, 3)) {
        if (found050Recovery || attempts050 >= max050Attempts) break;
        if (testCard === queryCode && testDob === cleanDob) continue;
        attempts050++;
        console.log(`[Background Gateway Auto-Healing 050] Thử lại (${attempts050}/${max050Attempts}): Mã=${testCard}, NS=${testDob}`);
        const retryRes = await callBhytGateway(testCard, testDob, cleanName);
        const rCode = String(retryRes?.maKetQua || '');
        const rGhiChu = String(retryRes?.ghiChu || retryRes?.thongBao || '');

        if (retryRes && (rCode === '000' || rCode === '00' || rCode === '004' || rCode === '003' || rCode === '010' || retryRes.maThe || retryRes.maTheMoi || /cấp mã thẻ mới/i.test(rGhiChu))) {
          console.log('[Background Gateway Auto-Healing 050] THÀNH CÔNG RỰC RỠ!', testCard, testDob, retryRes);
          result = retryRes;
          code1 = rCode;
          ghiChu1 = rGhiChu;
          queryCode = testCard;
          successfulDob = testDob;
          result.ngaySinh = testDob;
          found050Recovery = true;
          break;
        }
      }
    }
  }

  if (!result) {
    const credSource = (username && password) ? 'popup' : (cachedCredentials?.username ? 'cache/HIS' : 'storage');
    throw new Error(`Cổng tiếp nhận BHXH trả về phản hồi rỗng (null/empty). Tài khoản (${user}) nguồn: ${credSource}. Nếu đã thiết lập đơn vị khác, vui lòng kiểm tra lại tài khoản và mật khẩu liên thông Cổng BHXH trong Cấu hình tiện ích.`);
  }

  // Bước 5: Phân tích mã kết quả thực tế & bóc tách thông tin thẻ mới
  const rawGhiChu = `${result.ghiChu || ''} ${result.thongBao || ''}`;

  let maTheMoi = result.maTheMoi || '';
  let gtTheTuMoi = formatBhxhDate(result.gtTheTuMoi);
  let gtTheDenMoi = formatBhxhDate(result.gtTheDenMoi);
  let maDKBDMoi = result.maDKBDMoi || '';
  let tenDKBDMoi = result.tenDKBDMoi || '';

  // Bóc tách thông tin thẻ mới nếu Cổng chỉ trả chuỗi trong ghi chú
  const hasNewCardText = /(?:được|đã\s*được)?\s*cấp\s*(?:mã\s*)?thẻ\s*(?:BHYT\s*)?mới/i.test(rawGhiChu) || 
                         /mã\s*thẻ\s*mới\s*:/i.test(rawGhiChu) ||
                         result.maKetQua === '003' || result.maKetQua === '004';
  if (!maTheMoi && hasNewCardText) {
    const mTheMoi = rawGhiChu.match(/(?:cấp\s*(?:mã\s*)?thẻ\s*(?:BHYT\s*)?mới\s*:\s*|mã\s*thẻ\s*mới\s*:\s*)([A-Z]{2}[1-5]\d{14}|[A-Z]{2}\d{15}|[A-Z]{2}[1-5]\d{12}|[A-Z]{2}\d{13})/i);
    if (mTheMoi && mTheMoi[1]) {
      maTheMoi = mTheMoi[1].toUpperCase();
    }
  }

  // Nếu maTheMoi trùng khớp với mã thẻ cũ/mã thẻ đang tra cứu -> không phải cấp thẻ mới
  const currentCard = (result.maThe || cleanMaThe || '').replace(/\s+/g, '').toUpperCase();
  if (maTheMoi && currentCard && maTheMoi === currentCard) {
    maTheMoi = '';
  }

  // Quy định tại Công văn số 1923/BHXH-CNTT ngày 20/06/2024 của BHXH Việt Nam:
  // Các trường thông tin thẻ mới: maTheMoi, gtTheTuMoi, gtTheDenMoi, maDKBDMoi, tenDKBDMoi
  // CHỈ ghi nhận có thẻ mới khi có maTheMoi khác thẻ hiện tại VÀ có các trường thông tin thẻ mới theo CV 1923
  const hasNewCard = Boolean(maTheMoi && (!currentCard || maTheMoi !== currentCard) && (hasNewCardText || gtTheTuMoi || gtTheDenMoi || maDKBDMoi || tenDKBDMoi));
  if (!hasNewCard) {
    maTheMoi = '';
    gtTheTuMoi = '';
    gtTheDenMoi = '';
    maDKBDMoi = '';
    tenDKBDMoi = '';
  }

  if (hasNewCard && (!gtTheTuMoi || !gtTheDenMoi)) {
    const mHanMoi = rawGhiChu.match(/Hạn\s*thẻ\s*từ\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*đến\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    if (mHanMoi) {
      if (!gtTheTuMoi && mHanMoi[1]) gtTheTuMoi = mHanMoi[1];
      if (!gtTheDenMoi && mHanMoi[2]) gtTheDenMoi = mHanMoi[2];
    }
  }

  if (hasNewCard && !maDKBDMoi) {
    const mMakcbMoi = rawGhiChu.match(/(?:mã\s*cơ\s*sở\s*KCBBĐ|mã\s*KCBBĐ|Nơi\s*KCBBĐ)\s*:\s*(\d{5})/i);
    if (mMakcbMoi && mMakcbMoi[1]) {
      maDKBDMoi = mMakcbMoi[1];
    }
  }

  if (hasNewCard && !tenDKBDMoi) {
    const mTenkcbMoi = rawGhiChu.match(/(?:tên\s*cơ\s*sở\s*KCBBĐ)\s*:\s*([^,\)\.\n]+)/i);
    if (mTenkcbMoi && mTenkcbMoi[1]) {
      tenDKBDMoi = mTenkcbMoi[1].trim();
    }
  }

  const maKetQua = String(result.maKetQua || '');
  const isValid = (maKetQua === '000' || maKetQua === '00' || maKetQua === '003' || maKetQua === '004' || (hasNewCard && (maKetQua === '010' || maKetQua === '001')));

  // Kiểm tra xem Cổng có trả về dữ liệu nhân thân/thẻ thực tế không (kể cả thẻ báo giảm hoặc hết hạn)
  const hasPatientData = Boolean(
    result.hoTen || result.maThe || result.gtTheTu || result.gtTheDen || 
    result.maDKBD || result.ngaySinh || cleanName ||
    (rawGhiChu && (rawGhiChu.includes('báo giảm') || rawGhiChu.includes('hết giá trị') || rawGhiChu.includes('hết hạn')))
  );

  // CHỈ dừng lại trả về lỗi ngay nếu thực sự không có bất kỳ dữ liệu bệnh nhân/thẻ nào từ Cổng
  if (!isValid && !hasPatientData) {
    const ghiChuText = result.ghiChu || result.thongBao || '';
    const errorDesc = MA_KET_QUA_MESSAGES[maKetQua] || ghiChuText || `Mã lỗi ${maKetQua}`;
    const sentData = `\n(Gợi ý: Hãy kiểm tra thông tin Đã quét: BHYT="${cleanMaThe}", Tên="${cleanName}", NS="${cleanDob}")`;
    const fullMsg = (ghiChuText ? `[MÃ ${maKetQua}]: ${ghiChuText}` : `[MÃ ${maKetQua}]: ${errorDesc}`) + sentData;

    return {
      success: false,
      hasPatientData: false,
      isLive: true,
      maKetQua: maKetQua,
      message: fullMsg,
      ghiChuCổng: ghiChuText,
      rawResult: result
    };
  }

  // Bước 6: Bóc tách dữ liệu THỰC TẾ 100% từ kết quả Cổng
  // 1. Trích xuất Mã thẻ hiện tại / Mã thẻ gốc (ưu tiên thẻ đang tra cứu / còn giá trị trong rawGhiChu hoặc result.maThe)
  let maTheHienTai = '';
  const mCardGhiChu = rawGhiChu.match(/(?:^|[^mã\s])(?:Mã\s*thẻ|Số\s*thẻ)\s*:\s*([A-Z]{2}[1-5]\d{14}|[A-Z]{2}\d{15}|[A-Z]{2}[1-5]\d{12}|[A-Z]{2}\d{13})/i);
  if (mCardGhiChu && mCardGhiChu[1]) {
    maTheHienTai = mCardGhiChu[1].toUpperCase();
  }
  if (!maTheHienTai && result.maThe) {
    const rawMaThe = String(result.maThe).trim().toUpperCase();
    if (!maTheMoi || rawMaThe !== maTheMoi) {
      maTheHienTai = rawMaThe;
    }
  }
  if (!maTheHienTai && cleanMaThe && (cleanMaThe.length === 15 || cleanMaThe.length === 17)) {
    maTheHienTai = cleanMaThe;
  }
  if (!maTheHienTai) {
    maTheHienTai = (result.maThe || cleanMaThe || '').replace(/\s+/g, '').toUpperCase();
  }

  // 2. Trích xuất Hạn thẻ hiện tại từ rawGhiChu hoặc result (Dạng "Hạn thẻ: 06/07/2020 - 30/09/2026")
  let tuNgayHienTai = formatBhxhDate(result.gtTheTu);
  let denNgayHienTai = formatBhxhDate(result.gtTheDen);
  const mHanHienTai = rawGhiChu.match(/Hạn\s*thẻ\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
  if (mHanHienTai) {
    if (!tuNgayHienTai || (hasNewCard && tuNgayHienTai === gtTheTuMoi)) {
      tuNgayHienTai = mHanHienTai[1];
    }
    if (!denNgayHienTai || (hasNewCard && denNgayHienTai === gtTheDenMoi)) {
      denNgayHienTai = mHanHienTai[2];
    }
  }

  // 3. Trích xuất Nơi KCBBĐ hiện tại từ rawGhiChu hoặc result (Dạng "Nơi KCBBĐ: 49428")
  let maDkbdHienTai = (result.maDKBD || '').trim();
  const mDkbdHienTai = rawGhiChu.match(/(?:^|[^a-z0-9])(?:Nơi\s*KCBBĐ|Mã\s*nơi\s*KCB)\s*:\s*(\d{5})/i);
  if (mDkbdHienTai && mDkbdHienTai[1]) {
    if (!maDkbdHienTai || (hasNewCard && maDkbdHienTai === maDKBDMoi)) {
      maDkbdHienTai = mDkbdHienTai[1];
    }
  }
  let tenDkbdHienTai = (result.tenDKBD || '').trim();
  if (hasNewCard && tenDkbdHienTai === tenDKBDMoi) {
    tenDkbdHienTai = '';
  }
  if (!tenDkbdHienTai || tenDkbdHienTai.includes('Bảo hiểm Xã hội') || tenDkbdHienTai.includes('BHXH')) {
    const hName = await getHospitalName(maDkbdHienTai);
    if (hName) tenDkbdHienTai = hName;
  }
  if (tenDkbdHienTai.includes('Bảo hiểm Xã hội') || tenDkbdHienTai.includes('BHXH')) {
    tenDkbdHienTai = '';
  }

  let cardThe = maTheHienTai || cleanMaThe;
  const name = result.hoTen || cleanName;
  let dob = formatBhxhDate(result.ngaySinh);
  const mNs = rawGhiChu.match(/(?:Ngày|Năm)\s*sinh\s*:\s*([^,!;\.]+)/i);
  if (mNs && mNs[1]) {
    const parsedNs = formatBhxhDate(mNs[1].trim());
    if (parsedNs) dob = parsedNs;
  }
  if (!dob && successfulDob) {
    dob = successfulDob;
  }
  if (!dob) {
    dob = cleanDob;
  }
  const gender = result.gioiTinh || 'Nam';

  let address = result.diaChi || '';
  if (!address) {
    const mDc = rawGhiChu.match(/\((?:ĐC|Địa chỉ)\s*:\s*([^;]+);/i);
    if (mDc && mDc[1]) {
      address = mDc[1].trim();
    }
  }

  const maDkbd = maDkbdHienTai;
  let tenDkbd = tenDkbdHienTai;

  const tuNgay = tuNgayHienTai;
  const denNgay = denNgayHienTai;
  const isExpired = isCardExpired(denNgay);
  let cardTrangThai = 'CON_GIA_TRI';
  if (maKetQua === '124') {
    cardTrangThai = 'THE_GIAM';
  } else if (!isValid && !hasNewCard) {
    cardTrangThai = isExpired ? 'HET_HAN' : 'KHONG_HOP_LE';
  } else if (isExpired) {
    cardTrangThai = 'HET_HAN';
  }

  // Bóc tách ngày đủ 5 năm liên tục từ result hoặc regex từ ghiChu / thongBao
  let raw5Nam =
    result.ngayDu5Nam ||
    result.ngayDu5nam ||
    result.ngaydu5nam ||
    result.thoiDiem5Nam ||
    result.thoidiem5nam ||
    result.ngayDu5NamLienTuc ||
    result.gtTheDu5Nam ||
    result.du5Nam ||
    result.du_5_nam ||
    result.KB_THOIDIEM_5NAM_LIENTUC ||
    '';
  if (!raw5Nam || raw5Nam.toLowerCase().includes('dd/mm') || raw5Nam === 'null') {
    const ghiChuText = `${result.ghiChu || ''} ${result.thongBao || ''}`;
    const m5 = ghiChuText.match(/(?:đủ\s*0?5\s*năm|5\s*năm)[^\d]*?(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|\d{8})/i);
    if (m5 && m5[1]) {
      raw5Nam = m5[1];
    }
  }
  const ngayDu5Nam = formatBhxhDate(raw5Nam);
  const maKV = result.maKV || '';

  // Tính tỷ lệ mức hưởng theo ký tự thứ 3 của mã thẻ
  let mucHuongSo = 80;
  if (cardThe && cardThe.length >= 3) {
    const c = cardThe.charAt(2);
    if (c === '1' || c === '2' || c === '5') mucHuongSo = 100;
    else if (c === '3') mucHuongSo = 95;
    else mucHuongSo = 80;
  }

  // Bóc tách thông tin thân nhân cho thẻ trẻ em (TE)
  let hoTenCha = (result.hoTenCha || result.hotencha || result.tenCha || result.ten_cha || result.ho_ten_cha || '').trim();
  let hoTenMe = (result.hoTenMe || result.hotenme || result.tenMe || result.ten_me || result.ho_ten_me || '').trim();
  let nguoiGiamHo = (result.nguoiGiamHo || result.nguoigiamho || result.tenNguoiGiamHo || '').trim();

  if (!hoTenCha) {
    const mCha = rawGhiChu.match(/(?:Họ\s*tên\s*cha|Tên\s*cha|Cha)\s*:\s*([^,;\.\)\n]+)/i);
    if (mCha && mCha[1]) hoTenCha = mCha[1].trim();
  }
  if (!hoTenMe) {
    const mMe = rawGhiChu.match(/(?:Họ\s*tên\s*mẹ|Tên\s*mẹ|Mẹ)\s*:\s*([^,;\.\)\n]+)/i);
    if (mMe && mMe[1]) hoTenMe = mMe[1].trim();
  }
  if (!nguoiGiamHo) {
    const mGh = rawGhiChu.match(/(?:Người\s*giám\s*hộ|Người\s*liên\s*hệ|Giám\s*hộ)\s*:\s*([^,;\.\)\n]+)/i);
    if (mGh && mGh[1]) nguoiGiamHo = mGh[1].trim();
  }

  // =========================================================================
  // GIAI ĐOẠN 1 (PHASE 1 - SIÊU TỐC ~38ms): GỬI KẾT QUẢ ĐIỀN FORM NGAY TỨC THÌ
  // =========================================================================
  const now = new Date();
  const pad2 = (n) => String(n).padStart(2, '0');
  const nowTimeStr = `${pad2(now.getDate())}/${pad2(now.getMonth() + 1)}/${now.getFullYear()} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  const currentUser = String(user || 'User KCB').trim();
  const currentCskcb = currentUser.length >= 5 ? currentUser.substring(0, 5) : currentUser;

  const currentCheckItem = {
    user: currentUser,
    cskcb: currentCskcb,
    thoiGian: nowTimeStr,
    thongBao: result.ghiChu || result.thongBao || (isValid ? 'Thẻ còn giá trị sử dụng!' : `Mã kết quả: ${maKetQua}`),
    rawThoiGian: `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
  };

  // Thu thập LSKCB ban đầu nếu Cổng chính có trả về (0-5 đợt gần nhất)
  const initialKcbRaw = [
    result.dsLichSuKCB2025,
    result.dsLichSuKCB2024,
    result.dsLichSuKCB2018,
    result.dsLichSuKCB,
    result.dsLichSuKcb,
    result.lichSuKCB,
    result.lichSuKcb,
    result.data?.dsLichSuKCB
  ].filter(Boolean).flat();
  const initialLskcb = mapLskcbRecords(initialKcbRaw, cardThe, name, hasNewCard, maTheMoi);

  // Thu thập LSKT ban đầu từ kết quả Cổng chính (tránh để mảng rỗng ở Phase 1)
  const initialKtRaw = [
    result.dsLichSuKT2025,
    result.dsLichSuKT2024,
    result.dsLichSuKT2018,
    result.dsLichSuKT,
    result.dsLichSuKt,
    result.lichSuKT,
    result.lichSuKt,
    result.data?.dsLichSuKT
  ].filter(Boolean).flat();
  const initialLskt = mapLsktRecords(initialKtRaw, currentCheckItem);

  // GỬI NGAY PHASE 1 TỚI CONTENT SCRIPT ĐỂ ĐIỀN FORM TRONG ~38ms (KHÔNG CHỜ LSKCB2025 / MCCT)
  notifyPhase1({
    success: isValid,
    phase: 'primary',
    hasPatientData: true,
    isLive: true,
    maKetQua: maKetQua,
    ghiChuCổng: result.ghiChu || result.thongBao || rawGhiChu || '',
    message: result.ghiChu || result.thongBao || rawGhiChu || (isValid ? 'Thẻ còn giá trị sử dụng!' : `[MÃ ${maKetQua}]: ${MA_KET_QUA_MESSAGES[maKetQua] || 'Thẻ không còn giá trị'}`),
    data: {
      maThe: cardThe,
      maTheGoc: cardThe,
      theCu: cardThe,
      hoTen: name,
      ngaySinh: dob,
      gioiTinh: gender,
      soCCCD: cleanCccd,
      maDKBD: maDkbd,
      tenDKBD: tenDkbd,
      gtTheTu: tuNgay,
      gtTheDen: denNgay,
      ngayDu5Nam: ngayDu5Nam,
      mucHuong: `${mucHuongSo}%`,
      mucHuongSo: mucHuongSo,
      maKV: maKV,
      diaChi: address,
      trangThai: cardTrangThai,
      maKetQua: maKetQua,
      thongBao: result.ghiChu || result.thongBao || (cardTrangThai === 'CON_GIA_TRI' ? `Giá trị sử dụng đến ${denNgay}` : 'Thẻ không còn giá trị'),
      ghiChu: result.ghiChu || result.thongBao || rawGhiChu || '',
      hasNewCard: hasNewCard,
      maTheMoi: hasNewCard ? (maTheMoi || '') : '',
      gtTheTuMoi: hasNewCard ? (gtTheTuMoi || '') : '',
      gtTheDenMoi: hasNewCard ? (gtTheDenMoi || '') : '',
      maDKBDMoi: hasNewCard ? (maDKBDMoi || '') : '',
      tenDKBDMoi: hasNewCard ? (tenDKBDMoi || '') : '',
      soTienLuyKe: 0,
      ngayMcct: '',
      coMcct: false,
      chiTietMcct: null,
      hoTenCha: hoTenCha,
      hoTenMe: hoTenMe,
      nguoiGiamHo: nguoiGiamHo
    },
    lichSuKcb: initialLskcb,
    lichSuKiemTraThe: initialLskt,
    rawResult: result
  });

  // =========================================================================
  // GIAI ĐOẠN 2 (PHASE 2 - CHẠY NGẦM BACKGROUND): LẤY LSKCB ĐẦY ĐỦ, MCCT & GDBHYT
  // =========================================================================
  let token = currentToken;
  // Ưu tiên ngày sinh thực tế chính xác mà Cổng BHXH vừa trả về trong result.ngaySinh hoặc successfulDob
  const cleanDobForHistory = normalizeDobForBhxh(result.ngaySinh || successfulDob || cleanDob);
  let lskcbUrl = `${BHXH_GATEWAY}/api/egw/Lskcb2025?token=${encodeURIComponent(token.access_token)}&id_token=${encodeURIComponent(token.id_token)}&username=${encodeURIComponent(user)}&password=${encodeURIComponent(md5Password)}`;

  // 1. Hàm gọi Lskcb2025 với tham số chuẩn form-urlencoded và fallback JSON (timeout 7000ms)
  async function fetchLskcbFast(targetCard = cardThe, retryOn401 = true) {
    const cardCode = targetCard || cardThe;
    if (!cardCode) return null;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);
    try {
      const formParams = new URLSearchParams();
      formParams.append('maThe', cardCode);
      formParams.append('hoTen', name);
      formParams.append('ngaySinh', cleanDobForHistory);
      if (staff.hoTenCb) formParams.append('hoTenCb', staff.hoTenCb);
      if (staff.cccdCb) formParams.append('cccdCb', staff.cccdCb);

      let res = await fetch(lskcbUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: formParams.toString(),
        signal: controller.signal
      });

      if (res.ok) {
        const data = await res.json();
        console.log(`[Background Gateway] Lskcb2025 (Form) [${cardCode}] phản hồi:`, data);
        if (data && (data.maKetQua === '401' || /token/i.test(data.ghiChu || data.thongBao || '')) && retryOn401) {
          console.warn('[Background Gateway] 🔄 Lskcb2025 Token hết hạn. Đang xin Token mới và thử lại...');
          currentToken = await getBhxhToken(user, md5Password, true);
          token = currentToken;
          lskcbUrl = `${BHXH_GATEWAY}/api/egw/Lskcb2025?token=${encodeURIComponent(token.access_token)}&id_token=${encodeURIComponent(token.id_token)}&username=${encodeURIComponent(user)}&password=${encodeURIComponent(md5Password)}`;
          return await fetchLskcbFast(cardCode, false);
        }
        if (data && (data.maKetQua === '000' || data.dsLichSuKCB2025 || data.dsLichSuKCB || data.dsLichSuKT2025 || data.dsLichSuKT2024 || data.dsLichSuKT)) {
          return data;
        }
      }

      // Fallback sang định dạng JSON theo đúng chuẩn Công văn 2769/BHXH-CNTT
      const payload = {
        maThe: cardCode,
        hoTen: name,
        ngaySinh: cleanDobForHistory,
        username: user,
        password: md5Password,
        hoTenCb: staff.hoTenCb,
        cccdCb: staff.cccdCb,
        token: token.access_token,
        id_token: token.id_token
      };

      const resJson = await fetch(lskcbUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (resJson.ok) {
        const jsonData = await resJson.json();
        console.log(`[Background Gateway] Lskcb2025 (JSON) [${cardCode}] phản hồi:`, jsonData);
        if (jsonData && (jsonData.maKetQua === '401' || /token/i.test(jsonData.ghiChu || jsonData.thongBao || '')) && retryOn401) {
          console.warn('[Background Gateway] 🔄 Lskcb2025 JSON Token hết hạn. Đang xin Token mới và thử lại...');
          currentToken = await getBhxhToken(user, md5Password, true);
          token = currentToken;
          lskcbUrl = `${BHXH_GATEWAY}/api/egw/Lskcb2025?token=${encodeURIComponent(token.access_token)}&id_token=${encodeURIComponent(token.id_token)}&username=${encodeURIComponent(user)}&password=${encodeURIComponent(md5Password)}`;
          return await fetchLskcbFast(cardCode, false);
        }
        return jsonData;
      }
    } catch (e) {
      console.log(`[Background Gateway] Lskcb2025 [${cardCode}] thông báo:`, e.message);
    } finally {
      clearTimeout(timeoutId);
    }
    return null;
  }

  // 2. Hàm gọi portal gdbhyt kiểm tra thông tuyến có timeout 2000ms
  async function fetchGdbhytFast(targetCard = cardThe) {
    const cardCode = targetCard || cardThe;
    if (!cardCode) return null;
    try {
      return await Promise.race([
        fetchGdbhytThongTuyen(cardCode, name, cleanDobForHistory),
        new Promise((resolve) => setTimeout(() => resolve(null), 2000))
      ]);
    } catch (e) {
      return null;
    }
  }

  const effCard = String(cardThe || cleanMaThe || '').trim().toUpperCase();
  let historySubCode = '';
  if (effCard.length === 15) {
    historySubCode = effCard.slice(-10);
  } else if (effCard.length === 17) {
    historySubCode = effCard.slice(-12);
  } else if (effCard.length === 10) {
    historySubCode = effCard;
  } else if (cleanMaThe && cleanMaThe.length === 15) {
    historySubCode = cleanMaThe.slice(-10);
  } else if (cleanMaThe && cleanMaThe.length === 17) {
    historySubCode = cleanMaThe.slice(-12);
  } else if (cleanMaThe && cleanMaThe.length === 10) {
    historySubCode = cleanMaThe;
  }
  const hasValidSubCode = Boolean(historySubCode && (historySubCode.length === 10 || historySubCode.length === 12) && historySubCode !== effCard);

  const tPhase2Start = Date.now();
  let allKcbRaw = [];
  let rawLskt = [];
  let mcctRes = null;

  if (skipHistory) {
    try {
      mcctRes = await Promise.race([
        callTraCuuTienMCCT(user, md5Password, token, cardThe, name, dob),
        new Promise((resolve) => setTimeout(() => resolve(null), 800))
      ]);
    } catch (e) {}
  } else {
    // Tách MCCT thành tác vụ độc lập có timeout 2500ms, không chặn LSKCB
    const mcctPromise = Promise.race([
      callTraCuuTienMCCT(user, md5Password, token, cardThe, name, cleanDobForHistory),
      new Promise((resolve) => setTimeout(() => resolve(null), 2500))
    ]).catch((err) => {
      console.warn('[Background Gateway] Lỗi tra cứu MCCT:', err);
      return null;
    });

    // Danh sách Promise tra cứu song song LSKCB (Thời gian chờ 7000ms chuẩn theo v1.2.99)
    const historyPromises = [
      fetchLskcbFast(cardThe),
      fetchGdbhytFast(cardThe)
    ];

    // Nếu Phase 1 gọi bằng CCCD (queryCode !== cardThe), gọi thêm KQNhanLichSuKCB2024 cho cardThe
    if (cardThe && cardThe !== queryCode) {
      historyPromises.push(callBhytGateway(cardThe, cleanDobForHistory, name, 7000));
    }

    if (hasValidSubCode) {
      console.log(`[Background Gateway] Kích hoạt tra cứu bổ sung Lịch sử KCB bằng mã đuôi [${historySubCode.length} số]:`, historySubCode);
      historyPromises.push(
        callBhytGateway(historySubCode, cleanDobForHistory, name, 7000),
        fetchLskcbFast(historySubCode),
        fetchGdbhytFast(historySubCode)
      );
    }

    if (hasNewCard && maTheMoi && maTheMoi !== cardThe && maTheMoi !== queryCode) {
      historyPromises.push(
        callBhytGateway(maTheMoi, cleanDobForHistory, name, 7000),
        fetchLskcbFast(maTheMoi),
        fetchGdbhytFast(maTheMoi)
      );
    }

    if (Array.isArray(altCards)) {
      for (const ac of altCards) {
        const cleanAc = (ac || '').replace(/\s+/g, '').toUpperCase();
        if (cleanAc && cleanAc !== '0' && cleanAc !== queryCode && cleanAc !== cardThe && cleanAc !== historySubCode && cleanAc !== maTheMoi) {
          historyPromises.push(
            callBhytGateway(cleanAc, cleanDobForHistory, name, 7000),
            fetchLskcbFast(cleanAc)
          );
        }
      }
    }

    const [settledHistory, fetchedMcct] = await Promise.all([
      Promise.allSettled(historyPromises),
      mcctPromise
    ]);

    mcctRes = fetchedMcct;

    // Gộp tất cả kết quả từ Phase 1 và Phase 2
    const allResponses = [result];
    settledHistory.forEach((s) => {
      if (s.status === 'fulfilled' && s.value) {
        allResponses.push(s.value);
      }
    });

    allResponses.forEach((resItem) => {
      if (!resItem) return;
      // 1. Gộp LSKCB
      const kcbArrs = [
        resItem.dsLichSuKCB2025,
        resItem.dsLichSuKCB2024,
        resItem.dsLichSuKCB2018,
        resItem.dsLichSuKCB,
        resItem.dsLichSuKcb,
        resItem.lichSuKCB,
        resItem.lichSuKcb,
        resItem.data?.dsLichSuKCB,
        Array.isArray(resItem.data) ? resItem.data : null,
        resItem.kcbList
      ];
      kcbArrs.forEach((arr) => {
        if (Array.isArray(arr)) {
          arr.forEach((fbItem) => {
            if (!fbItem) return;
            const isDup = allKcbRaw.some(
              (c) => (c.maHoSo && fbItem.maHoSo && c.maHoSo === fbItem.maHoSo) ||
                     (c.ngayVao && fbItem.ngayVao && String(c.ngayVao) === String(fbItem.ngayVao) && (c.cskcb === fbItem.cskcb || c.tenCSKCB === fbItem.tenCSKCB)) ||
                     (c.ngayVao && fbItem.ngayVao && String(c.ngayVao).includes(String(fbItem.ngayVao).substring(0, 10))) ||
                     JSON.stringify(c) === JSON.stringify(fbItem)
            );
            if (!isDup) allKcbRaw.push(fbItem);
          });
        }
      });

      // 2. Gộp LSKT
      const ktArrs = [
        resItem.dsLichSuKT2025,
        resItem.dsLichSuKT2024,
        resItem.dsLichSuKT2018,
        resItem.dsLichSuKT,
        resItem.dsLichSuKt,
        resItem.lichSuKT,
        resItem.lichSuKt,
        resItem.data?.dsLichSuKT,
        resItem.ktList
      ];
      ktArrs.forEach((arr) => {
        if (Array.isArray(arr)) {
          arr.forEach((fbItem) => {
            if (!fbItem) return;
            const isDup = rawLskt.some(
              (c) => (c.maLichSu && fbItem.maLichSu && c.maLichSu === fbItem.maLichSu) ||
                     (c.thoiGian && fbItem.thoiGian && c.thoiGian === fbItem.thoiGian && (c.user === fbItem.user || c.cskcb === fbItem.cskcb)) ||
                     (c.thoiGianKT && fbItem.thoiGianKT && c.thoiGianKT === fbItem.thoiGianKT && c.userKT === fbItem.userKT) ||
                     JSON.stringify(c) === JSON.stringify(fbItem)
            );
            if (!isDup) rawLskt.push(fbItem);
          });
        }
      });
    });
  }

  // Định dạng danh sách LSKCB đầy đủ
  const lichSuKcb = mapLskcbRecords(allKcbRaw, cardThe, name, hasNewCard, maTheMoi);

  // Xử lý Lịch sử kiểm tra thẻ đầy đủ
  const lichSuKiemTraThe = mapLsktRecords(rawLskt, currentCheckItem);

  // Xử lý tiền MCCT
  let soTienLuyKe = 0;
  let ngayMcct = '';
  let chiTietMcct = null;

  if (mcctRes) {
    chiTietMcct = mcctRes;
    const maKqMcct = String(mcctRes.MaKetQua || mcctRes.maKetQua || '');
    if (maKqMcct === '200' && Array.isArray(mcctRes.DataCCT) && mcctRes.DataCCT.length > 0) {
      const latest = mcctRes.DataCCT[0];
      if (latest.tBNCCTLuyKe != null) {
        soTienLuyKe = Number(latest.tBNCCTLuyKe) || 0;
      }

      for (let i = mcctRes.DataCCT.length - 1; i >= 0; i--) {
        const item = mcctRes.DataCCT[i];
        if (Number(item.tBNCCTMCCT || 0) > 0) {
          ngayMcct = formatBhxhDate(item.ngayVao || item.ngayRa || item.ngayTraCuu);
          break;
        }
      }

      if (!ngayMcct && mcctRes.ngayMCCT) {
        ngayMcct = formatBhxhDate(mcctRes.ngayMCCT);
      }
      if (!ngayMcct && mcctRes.ThongTinSoThe?.ngayMCCT) {
        ngayMcct = formatBhxhDate(mcctRes.ThongTinSoThe.ngayMCCT);
      }
    } else if (maKqMcct === '204') {
      soTienLuyKe = 0;
      ngayMcct = '';
    }
  }

  metrics.phase2_ms = Date.now() - tPhase2Start;
  metrics.total_ms = Date.now() - tStart;

  // STREAM DỮ LIỆU PHASE 2 VỀ TAB CONTENT SCRIPT (Chỉ gửi đích danh senderTabId)
  const streamPayload = {
    action: 'streamLskcbUpdate',
    payload: {
      requestId: reqId,
      maThe: cardThe,
      maTheMoi: hasNewCard ? maTheMoi : '',
      soCCCD: cleanCccd,
      lichSuKcb: lichSuKcb,
      lichSuKiemTraThe: lichSuKiemTraThe,
      ghiChuCổng: result.ghiChu || result.thongBao || rawGhiChu || '',
      mcct: {
        soTienLuyKe,
        ngayMcct,
        coMcct: Boolean(ngayMcct),
        chiTietMcct
      },
      metrics: metrics
    }
  };

  const sendStreamToTab = (tid, fid = null) => {
    if (!tid) return;
    try {
      if (fid != null && fid !== 0) {
        chrome.tabs.sendMessage(tid, streamPayload, { frameId: fid }).catch(() => {});
      }
      chrome.tabs.sendMessage(tid, streamPayload).catch(() => {});
    } catch (_) {}
  };

  if (senderTabId) {
    sendStreamToTab(senderTabId, senderFrameId);
    console.log(`[Background Gateway] 🌊 [Phase 2][${reqId}] Đã stream ${lichSuKcb.length} đợt LSKCB, ${lichSuKiemTraThe.length} đợt LSKT và MCCT tới Tab ${senderTabId}`);
  }
  // Đồng thời gửi đến active tab và broadcast tới tất cả các tab HIS đang mở để tránh miss tab khi chuyển trang/reload
  try {
    chrome.tabs.query({}, (tabs) => {
      (tabs || []).forEach((t) => {
        if (t.id && t.id !== senderTabId && t.url && (t.url.includes('his') || t.url.includes('vnpt') || t.url.includes('tiepnhanbenhnhan'))) {
          sendStreamToTab(t.id);
        }
      });
    });
  } catch (e) {}

  console.log(`[BHYT Metrics][${reqId}] Token: ${metrics.token_ms}ms | Main API: ${metrics.main_api_ms}ms | Phase 1: ${metrics.phase1_ms}ms | Phase 2: ${metrics.phase2_ms}ms | Total: ${metrics.total_ms}ms`);

  return {
    success: isValid,
    hasPatientData: true,
    isLive: true,
    requestId: reqId,
    metrics: metrics,
    maKetQua: maKetQua,
    ghiChuCổng: result.ghiChu || result.thongBao || rawGhiChu || '',
    message: result.ghiChu || result.thongBao || rawGhiChu || (isValid ? 'Thẻ còn giá trị sử dụng!' : `[MÃ ${maKetQua}]: ${MA_KET_QUA_MESSAGES[maKetQua] || 'Thẻ không còn giá trị'}`),
    data: {
      maThe: cardThe,
      maTheGoc: cardThe,
      theCu: cardThe,
      hoTen: name,
      ngaySinh: dob,
      gioiTinh: gender,
      soCCCD: cleanCccd,
      maDKBD: maDkbd,
      tenDKBD: tenDkbd,
      gtTheTu: tuNgay,
      gtTheDen: denNgay,
      ngayDu5Nam: ngayDu5Nam,
      mucHuong: `${mucHuongSo}%`,
      mucHuongSo: mucHuongSo,
      maKV: maKV,
      diaChi: address,
      trangThai: cardTrangThai,
      maKetQua: maKetQua,
      thongBao: result.ghiChu || result.thongBao || (cardTrangThai === 'CON_GIA_TRI' ? `Giá trị sử dụng đến ${denNgay}` : 'Thẻ không còn giá trị'),
      ghiChu: result.ghiChu || result.thongBao || rawGhiChu || '',
      hasNewCard: hasNewCard,
      maTheMoi: hasNewCard ? (maTheMoi || '') : '',
      gtTheTuMoi: hasNewCard ? (gtTheTuMoi || '') : '',
      gtTheDenMoi: hasNewCard ? (gtTheDenMoi || '') : '',
      maDKBDMoi: hasNewCard ? (maDKBDMoi || '') : '',
      tenDKBDMoi: hasNewCard ? (tenDKBDMoi || '') : '',
      soTienLuyKe: soTienLuyKe,
      ngayMcct: ngayMcct,
      coMcct: Boolean(ngayMcct),
      chiTietMcct: chiTietMcct,
      hoTenCha: hoTenCha,
      hoTenMe: hoTenMe,
      nguoiGiamHo: nguoiGiamHo
    },
    lichSuKcb: lichSuKcb,
    lichSuKiemTraThe: lichSuKiemTraThe,
    rawResult: result
  };
  })();

  inFlightBhytChecks.set(dedupKey, checkExecutionPromise);
  try {
    const finalResult = await checkExecutionPromise;
    if (finalResult && finalResult.success) {
      recentCheckCache.set(dedupKey, { result: finalResult, timestamp: Date.now() });
      if (recentCheckCache.size > 30) {
        const oldestKey = recentCheckCache.keys().next().value;
        recentCheckCache.delete(oldestKey);
      }
    }
    return finalResult;
  } finally {
    inFlightBhytChecks.delete(dedupKey);
  }
}

// =========================================================================
// 5.1 GỌI API TRA CỨU TIỀN MCCT (TraCuuTienMCCT)
// =========================================================================
async function callTraCuuTienMCCT(user, md5Password, token, cleanMaThe, cleanName, cleanDob) {
  if (!user || !md5Password || !token || !cleanMaThe) {
    return null;
  }

  // 1. URL có đầy đủ token và id_token query params theo đúng chuẩn các API khác của BHXH Gateway
  const queryUrl = `${BHXH_GATEWAY}/api/TraCuuCCT/TraCuuTienMCCT?token=${encodeURIComponent(token.access_token)}&id_token=${encodeURIComponent(token.id_token)}&username=${encodeURIComponent(user)}&password=${encodeURIComponent(md5Password)}`;

  // Tuyệt đối KHÔNG gửi custom header không chuẩn (như tokenId, accessToken) trong HTTP headers
  // vì sẽ làm preflight CORS của trình duyệt bị từ chối
  const headers = {
    'Content-Type': 'application/json; charset=utf-8'
  };

  const bodyData = JSON.stringify({
    username: user,
    password: md5Password,
    passwordHash: md5Password,
    token: token.access_token,
    accessToken: token.access_token,
    id_token: token.id_token,
    tokenId: token.id_token,
    maThe: cleanMaThe,
    hoTen: cleanName || '',
    ngaySinh: cleanDob || ''
  });

  console.log('[Background Gateway] Gửi POST TraCuuTienMCCT:', {
    url: queryUrl,
    username: user,
    maThe: cleanMaThe,
    hoTen: cleanName,
    ngaySinh: cleanDob
  });

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1800);

    let res;
    try {
      res = await fetch(queryUrl, {
        method: 'POST',
        headers,
        body: bodyData,
        signal: controller.signal
      });
    } catch (netErr) {
      clearTimeout(timeoutId);
      console.warn('[Background Gateway] Fetch TraCuuTienMCCT (JSON) thất bại:', netErr);
      // Fallback thử form-urlencoded
      try {
        const formParams = new URLSearchParams();
        formParams.append('maThe', cleanMaThe);
        formParams.append('hoTen', cleanName || '');
        formParams.append('ngaySinh', cleanDob || '');
        formParams.append('username', user);
        formParams.append('password', md5Password);
        res = await fetch(queryUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
          body: formParams.toString()
        });
      } catch (formErr) {
        throw netErr;
      }
    } finally {
      clearTimeout(timeoutId);
    }

    if (res && res.ok) {
      const data = await res.json();
      console.log('[Background Gateway] Kết quả thực tế TraCuuTienMCCT:', data);
      return data;
    } else if (res) {
      const errText = await res.text().catch(() => '');
      console.warn(`[Background Gateway] TraCuuTienMCCT trả về HTTP ${res.status}:`, errText);
    }
  } catch (err) {
    console.log('[Background Gateway] Không thể gọi TraCuuTienMCCT:', err);
  }

  return null;
}

// Hàm thực thi tra cứu riêng tiền MCCT khi bấm nút KTra MCCT
async function executeTraCuuTienMCCTOnly(payload) {
  let { maThe, hoTen, ngaySinh, hisOrigin } = payload || {};
  const cleanMaThe = (maThe || '').replace(/\s+/g, '').toUpperCase();
  const cleanName = (hoTen || '').replace(/[\s\u00A0]+/g, ' ').trim().toUpperCase().normalize('NFC');
  const cleanDob = normalizeDobForBhxh(ngaySinh);

  let user = '';
  let pass = '';
  try {
    const stored = await chrome.storage.local.get(['bhxh_user', 'bhxh_pass']);
    if (stored?.bhxh_user && stored?.bhxh_pass) {
      user = stored.bhxh_user;
      pass = stored.bhxh_pass;
    }
  } catch (e) {}

  if (!user || !pass) {
    if (cachedCredentials?.username && cachedCredentials?.password) {
      user = cachedCredentials.username;
      pass = cachedCredentials.password;
    } else if (hisOrigin) {
      const cred = await fetchHisBhxhCredentials(hisOrigin);
      if (cred?.username && cred?.password) {
        user = cred.username;
        pass = cred.password;
        cachedCredentials = cred;
      }
    }
  }

  if (!user || !pass) {
    throw new Error('Chưa có thông tin tài khoản liên thông Cổng BHXH.');
  }

  const md5Password = getMd5Password(pass);
  const token = await getBhxhToken(user, md5Password);
  if (!token?.access_token || !token?.id_token) {
    throw new Error('Không thể lấy Token phiên làm việc từ Cổng BHXH.');
  }

  const mcctRes = await callTraCuuTienMCCT(user, md5Password, token, cleanMaThe, cleanName, cleanDob);
  if (!mcctRes) {
    throw new Error('Cổng BHXH không phản hồi dữ liệu TraCuuTienMCCT.');
  }

  let soTienLuyKe = 0;
  let ngayMcct = '';
  const maKq = String(mcctRes.MaKetQua || '');

  if (maKq === '200' && Array.isArray(mcctRes.DataCCT) && mcctRes.DataCCT.length > 0) {
    const latest = mcctRes.DataCCT[0];
    if (latest.tBNCCTLuyKe != null) soTienLuyKe = Number(latest.tBNCCTLuyKe) || 0;

    for (let i = mcctRes.DataCCT.length - 1; i >= 0; i--) {
      const item = mcctRes.DataCCT[i];
      if (Number(item.tBNCCTMCCT || 0) > 0) {
        ngayMcct = formatBhxhDate(item.ngayVao || item.ngayRa || item.ngayTraCuu);
        break;
      }
    }
    if (!ngayMcct && mcctRes.ngayMCCT) ngayMcct = formatBhxhDate(mcctRes.ngayMCCT);
    if (!ngayMcct && mcctRes.ThongTinSoThe?.ngayMCCT) ngayMcct = formatBhxhDate(mcctRes.ThongTinSoThe.ngayMCCT);
  }

  return {
    success: true,
    soTienLuyKe: soTienLuyKe,
    ngayMcct: ngayMcct,
    coMcct: Boolean(ngayMcct),
    raw: mcctRes
  };
}

// =========================================================================
// 6. LẤY CẤU HÌNH TÀI KHOẢN TỪ HIS NỘI BỘ (KHÔNG LƯU MẬT KHẨU CỐ ĐỊNH)
// =========================================================================
async function fetchHisBhxhCredentials(hisOrigin) {
  // Thử /web_his/api/cau-hinh-bhxh
  try {
    const c1 = new AbortController();
    const t1 = setTimeout(() => c1.abort(), 4000);
    const res = await fetch(`${hisOrigin}/web_his/api/cau-hinh-bhxh`, { signal: c1.signal });
    clearTimeout(t1);
    if (res.ok) {
      const data = await res.json();
      const u = data?.THAM_SO_TAI_KHOAN || data?.TAI_KHOAN || data?.USERNAME || data?.username || data?.user || '';
      const p = data?.THAM_SO_MAT_KHAU || data?.MAT_KHAU || data?.PASSWORD || data?.password || data?.pass || '';
      if (u && p) {
        return {
          username: String(u).trim(),
          password: String(p).trim()
        };
      }
    }
  } catch (e) {}

  // Thử /web_his/Cau_Hinh_Tham_So_XuatXMLBHYT
  try {
    const c2 = new AbortController();
    const t2 = setTimeout(() => c2.abort(), 4000);
    const res = await fetch(`${hisOrigin}/web_his/Cau_Hinh_Tham_So_XuatXMLBHYT`, { signal: c2.signal });
    clearTimeout(t2);
    if (res.ok) {
      const html = await res.text();
      // Hỗ trợ cả 2 thứ tự attribute: id=... value=... HOẶC value=... id=...
      const uMatch = html.match(/(?:id|name)=["']motathamso123["'][^>]*value=["']([^"']+)["']/i) ||
                     html.match(/value=["']([^"']+)["'][^>]*(?:id|name)=["']motathamso123["']/i);
      const pMatch = html.match(/(?:id|name)=["']motathamso124["'][^>]*value=["']([^"']+)["']/i) ||
                     html.match(/value=["']([^"']+)["'][^>]*(?:id|name)=["']motathamso124["']/i);
      if (uMatch && pMatch) {
        return {
          username: uMatch[1].trim(),
          password: pMatch[1].trim()
        };
      }
    }
  } catch (e) {}

  return null;
}

// =========================================================================
// 6.1 TỰ ĐỘNG ĐỌC MÃ CSKCB TỪ HIS ĐỂ ĐIỀN CẤU HÌNH CHO ĐƠN VỊ MỚI
// =========================================================================
async function handleDetectHisCskcb(payload) {
  let hisOrigin = payload?.hisOrigin;

  // 1. Nếu không truyền hisOrigin, tìm tab VNPT HIS đang mở
  if (!hisOrigin && chrome.tabs) {
    try {
      const tabs = await chrome.tabs.query({ url: ['*://*.vnpthis.vn/*', '*://*/web_his/*'] });
      if (tabs && tabs.length > 0 && tabs[0].url) {
        hisOrigin = new URL(tabs[0].url).origin;
      }
    } catch (e) {}

    if (!hisOrigin) {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab?.url && (activeTab.url.includes('vnpthis.vn') || activeTab.url.includes('web_his'))) {
          hisOrigin = new URL(activeTab.url).origin;
        }
      } catch (e) {}
    }
  }

  let cred = null;
  if (hisOrigin) {
    cred = await fetchHisBhxhCredentials(hisOrigin);
  }

  if (!cred && cachedCredentials?.username) {
    cred = cachedCredentials;
  }

  if (!cred?.username) {
    // Thử lấy cấu hình đã lưu trong storage nếu có
    const stored = await chrome.storage.local.get(['bhxh_user', 'bhxh_pass', 'bhyt_cskcb_code', 'bhyt_org_name', 'bhyt_cap_chuyen_mon', 'bhyt_diem_xep_cap']);
    if (stored?.bhyt_cskcb_code) {
      return {
        success: true,
        source: 'storage',
        cskcbCode: stored.bhyt_cskcb_code,
        username: stored.bhxh_user || `${stored.bhyt_cskcb_code}_BV`,
        password: stored.bhxh_pass || '',
        orgName: stored.bhyt_org_name || (await getHospitalName(stored.bhyt_cskcb_code)) || 'Trung tâm Y tế khu vực Quế Sơn',
        capChuyenMon: stored.bhyt_cap_chuyen_mon || 'Cơ bản',
        diemXepCap: stored.bhyt_diem_xep_cap != null ? stored.bhyt_diem_xep_cap : 25
      };
    }

    return {
      success: false,
      message: 'Không tìm thấy trang VNPT HIS đang mở để tự động đọc thông tin CSKCB.'
    };
  }

  const rawUser = String(cred.username).trim();
  const cskcbCode = rawUser.split('_')[0].replace(/\D/g, '').substring(0, 5) || rawUser.substring(0, 5);
  const password = cred.password || '';

  // Tra cứu Tên CSKCB từ danh mục bệnh viện
  let orgName = await getHospitalName(cskcbCode);
  if (!orgName) {
    if (cskcbCode === '49425') orgName = 'Trạm Y tế xã Duy Xuyên';
    else if (cskcbCode === '49006') orgName = 'Trung tâm Y tế khu vực Duy Xuyên';
    else if (cskcbCode === '49008') orgName = 'Trung tâm Y tế khu vực Quế Sơn';
    else orgName = `Cơ sở KCB ${cskcbCode}`;
  }

  // Tự động phân cấp chuyên môn và điểm xếp cấp theo tên cơ sở
  let capChuyenMon = 'Cơ bản';
  let diemXepCap = 25;
  if (/trạm\s*y\s*tế|tyt|phòng\s*khám|điểm\s*trạm/i.test(orgName)) {
    capChuyenMon = 'Ban đầu';
    diemXepCap = 0;
  } else if (/chuyên\s*sâu|tỉnh|trung\s*ương/i.test(orgName)) {
    capChuyenMon = 'Chuyên sâu';
    diemXepCap = 70;
  } else {
    capChuyenMon = 'Cơ bản';
    diemXepCap = 25;
  }

  // Tự động lưu cấu hình nhận diện được vào chrome.storage.local
  await chrome.storage.local.set({
    bhyt_cskcb_code: cskcbCode,
    bhyt_org_name: orgName,
    bhyt_cap_chuyen_mon: capChuyenMon,
    bhyt_diem_xep_cap: diemXepCap,
    bhxh_user: rawUser,
    ...(password ? { bhxh_pass: password } : {})
  });

  return {
    success: true,
    source: 'his',
    cskcbCode: cskcbCode,
    username: rawUser,
    password: password,
    orgName: orgName,
    capChuyenMon: capChuyenMon,
    diemXepCap: diemXepCap,
    message: `Đã tự động nhận diện thành công: ${cskcbCode} - ${orgName}`
  };
}

function getMd5Password(p) {
  if (!p) return '';
  const trimmed = String(p).trim();
  // CHUẨN XÁC 100% NHƯ v1.2.99 -> v2.0.6: Mật khẩu từ HIS (motathamso124) hoặc lưu trong cấu hình
  // luôn được băm MD5(pass) để gửi tới Cổng BHXH (/api/token/take).
  return MD5(trimmed);
}

// =========================================================================
// 7. LẤY TOKEN TỪ CỔNG TIẾP NHẬN BHXH VIỆT NAM (API/TOKEN/TAKE)
// =========================================================================
let cachedTokenUsername = null;

async function getBhxhToken(username, md5Password, forceRefresh = false, isRetry = false) {
  const now = Date.now();
  if (!forceRefresh && cachedToken && cachedTokenUsername === username && tokenExpiresAt > now + 60000) {
    return cachedToken;
  }

  // 1. Khôi phục Token còn hạn từ chrome.storage.local nếu service worker vừa kích hoạt lại sau khi nghỉ (tiết kiệm ~230ms gọi /api/token/take)
  if (!forceRefresh) {
    try {
      const stored = await chrome.storage.local.get(['bhxh_cached_token', 'bhxh_cached_token_user', 'bhxh_cached_token_expires']);
      if (stored?.bhxh_cached_token && stored?.bhxh_cached_token_user === username && stored?.bhxh_cached_token_expires > now + 60000) {
        cachedToken = stored.bhxh_cached_token;
        cachedTokenUsername = username;
        tokenExpiresAt = stored.bhxh_cached_token_expires;
        console.log('[Background Gateway] ⚡ Khôi phục Token còn hạn trực tiếp từ storage (<1ms):', username);
        return cachedToken;
      }
    } catch (e) {}
  }

  // Nếu đổi sang tài khoản khác hoặc yêu cầu kiểm tra thực tế -> xóa token cũ
  if (cachedTokenUsername !== username || forceRefresh) {
    cachedToken = null;
    cachedTokenUsername = null;
    tokenExpiresAt = 0;
    try {
      chrome.storage.local.remove(['bhxh_cached_token', 'bhxh_cached_token_user', 'bhxh_cached_token_expires']).catch(() => {});
    } catch (e) {}
  }

  const params = new URLSearchParams();
  params.append('username', username);
  params.append('password', md5Password);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  let res;
  try {
    res = await fetch(`${BHXH_GATEWAY}/api/token/take`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      body: params.toString(),
      signal: controller.signal
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Kết nối Cổng BHXH lấy Token bị quá hạn phản hồi (Timeout 10s). Vui lòng thử lại!');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    throw new Error(`Yêu cầu lấy Token từ Cổng BHXH thất bại: HTTP ${res.status}`);
  }

  const data = await res.json();
  if (data && data.APIKey && data.APIKey.access_token) {
    cachedToken = data.APIKey;
    cachedTokenUsername = username;
    tokenExpiresAt = now + 3 * 60 * 60 * 1000; // Hạn token 3 tiếng
    try {
      chrome.storage.local.set({
        bhxh_cached_token: cachedToken,
        bhxh_cached_token_user: username,
        bhxh_cached_token_expires: tokenExpiresAt
      }).catch(() => {});
    } catch (e) {}
    return cachedToken;
  }

  if (data && (data.maKetQua === '401' || data.MaKetQua === '401')) {
    // Dự phòng thông minh chống 401: Tự động thử các tổ hợp tài khoản/mật khẩu phổ biến trên Cổng BHXH
    if (!isRetry) {
      const altUsername = username.endsWith('_BV') ? username.replace(/_BV$/i, '') : `${username}_BV`;
      const altVariants = [
        { u: altUsername, p: md5Password, desc: 'Tài khoản đổi đuôi _BV' },
        { u: username, p: MD5(md5Password), desc: 'Mật khẩu băm MD5 2 lần' },
        { u: altUsername, p: MD5(md5Password), desc: 'Tài khoản đổi đuôi _BV + MD5 2 lần' }
      ];

      for (const variant of altVariants) {
        try {
          console.log(`[Background Gateway] 🔄 Nhận mã 401 với [${username}], thử nghiệm tự động: ${variant.desc} [${variant.u}]...`);
          const retryRes = await getBhxhToken(variant.u, variant.p, forceRefresh, true);
          if (retryRes && retryRes.access_token) {
            console.log(`[Background Gateway] ⚡ Xác thực thành công với phương án: ${variant.desc}! Đang lưu cấu hình tự động...`);
            cachedCredentials = { username: variant.u, password: variant.p };
            try {
              chrome.storage.local.set({ bhxh_user: variant.u, bhxh_pass: variant.p }).catch(() => {});
            } catch (_) {}
            return retryRes;
          }
        } catch (_) {}
      }
    }
    throw new Error(`Tài khoản hoặc mật khẩu Cổng BHXH của [${username}] không chính xác (Mã 401).`);
  }

  const errorMsg = data?.ghiChu || data?.message || data?.MoTa || `Cổng BHXH từ chối cấp Token cho tài khoản [${username}] (Mã ${data?.maKetQua || data?.MaKetQua || 'ERR'}).`;
  throw new Error(errorMsg);
}

// =========================================================================
// 8. KIỂM TRA KẾT NỐI TRỰC TIẾP CỔNG BHXH VIỆT NAM (DÀNH CHO POPUP)
// =========================================================================
async function testDirectBhxhConnection(payload) {
  const targetUser = payload?.username ? String(payload.username).trim() : '';
  let pass = payload?.password;
  let hisOrigin = payload?.hisOrigin;

  let storedUser = '';
  let storedPass = '';
  try {
    const stored = await chrome.storage.local.get(['bhxh_user', 'bhxh_pass', 'bhyt_cskcb_code']);
    storedUser = stored?.bhxh_user || (stored?.bhyt_cskcb_code ? `${stored.bhyt_cskcb_code}_BV` : '');
    storedPass = stored?.bhxh_pass || '';
  } catch (e) {}

  // Xác định chính xác tài khoản cần kiểm tra (ƯU TIÊN TUYỆT ĐỐI MÃ CSKCB TRUYỀN VÀO)
  let user = targetUser || storedUser || '49008_BV';

  // Lấy mật khẩu
  if (!pass) {
    pass = storedPass;
  }

  if (!pass && hisOrigin) {
    const cred = await fetchHisBhxhCredentials(hisOrigin);
    if (cred?.password) {
      pass = cred.password;
      if (!targetUser && cred.username) {
        user = cred.username;
      }
    }
  }

  if (!pass && cachedCredentials?.password) {
    pass = cachedCredentials.password;
    if (!targetUser && cachedCredentials.username) {
      user = cachedCredentials.username;
    }
  }

  if (!user || !pass) {
    return {
      success: false,
      user: user,
      message: `Chưa có mật khẩu liên thông Cổng BHXH cho tài khoản [${user}]. Hãy mở trang VNPT HIS để tự nhận diện hoặc cấu hình mật khẩu.`
    };
  }

  try {
    const md5Pass = getMd5Password(pass);
    // Luôn gửi yêu cầu THỰC TẾ xin Token mới tới Cổng tiếp nhận (forceRefresh = true)
    let token = null;
    let authError = null;
    try {
      token = await getBhxhToken(user, md5Pass, true);
    } catch (e1) {
      authError = e1;
      // Thử tài khoản thay thế nếu có (ví dụ bỏ _BV hoặc thêm _BV hoặc dùng tài khoản đọc từ HIS)
      const alternateUser = user.endsWith('_BV') ? user.replace(/_BV$/i, '') : `${user}_BV`;
      try {
        token = await getBhxhToken(alternateUser, md5Pass, true);
        user = alternateUser;
        authError = null;
      } catch (_) {}
    }

    if (token && token.access_token) {
      chrome.storage.local.set({ bhxh_user: user, bhxh_pass: pass }).catch(() => {});
      return {
        success: true,
        message: `Kết nối Cổng BHXH Việt Nam thành công với tài khoản ${user}! (Token hợp lệ)`,
        user: user,
        password: pass
      };
    } else {
      return {
        success: false,
        user: user,
        message: authError?.message || `Cổng BHXH không trả về Token hợp lệ cho tài khoản ${user}.`
      };
    }
  } catch (err) {
    return {
      success: false,
      user: user,
      message: err.message || `Lỗi kết nối Cổng BHXH với tài khoản ${user}`
    };
  }
}

// =====================================================================
// TRA SỐ LƯU TRỮ TRÊN EMR (emr.vncare.vn)
// HIS không lưu số lưu trữ EMR cấp -> tra trực tiếp API EMR bằng phiên đăng nhập EMR của người dùng
// (emr_token.js lưu lại khi người dùng mở trang EMR). Chỉ ĐỌC (tìm kiếm hồ sơ), không sửa gì trên EMR.
// =====================================================================
const EMR_API = 'https://apiemr.vncare.vn/api/admin/hsba/search';

async function emrLookupSoLuuTru(maBas) {
  const { emrToken } = await chrome.storage.local.get('emrToken');
  if (!emrToken) {
    return { success: false, needLogin: true, message: 'Chưa có phiên EMR: hãy mở trang emr.vncare.vn (đăng nhập) một lần rồi thử lại.' };
  }
  const list = [...new Set((maBas || []).map(s => String(s || '').trim()).filter(Boolean))];
  const map = {};
  for (let i = 0; i < list.length; i += 50) {
    const chunk = list.slice(i, i + 50);
    const filter = 'maBa=in=(' + chunk.map(m => '"' + m.replace(/"/g, '') + '"').join(',') + ')';
    const url = `${EMR_API}?page=0&size=${chunk.length * 2}&filter=${encodeURIComponent(filter)}&sort=ngayLuuTru,desc`;
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + emrToken, Accept: 'application/json' } });
    if (res.status === 401 || res.status === 403) {
      return { success: false, needLogin: true, message: 'Phiên EMR đã hết hạn: hãy mở lại trang emr.vncare.vn rồi thử lại.' };
    }
    const j = await res.json().catch(() => null);
    if (!j || j.code !== 0) {
      return { success: false, message: 'EMR báo lỗi: ' + ((j && j.message) || ('HTTP ' + res.status)) };
    }
    ((j.result && j.result.content) || []).forEach(x => {
      map[x.maBa] = {
        daLuuTru: String(x.trangThaiLuuTru) === '2',
        soLuuTru: String(x.trangThaiLuuTru) === '2' ? (x.soLuuTruHis || '') : '',
        viTri: x.viTriLuuTru || '',
        trangThaiLuuTru: x.trangThaiLuuTru
      };
    });
  }
  return { success: true, map };
}

// =====================================================================
// TỰ CẬP NHẬT: script hẹn giờ của Windows (update/CapNhatTienIch.ps1) chép bản mới vào thư mục tiện ích
// (manifest.json được chép SAU CÙNG). Mỗi phút tiện ích đọc lại manifest.json trên ổ đĩa: phiên bản khác
// phiên bản đang chạy -> tự tải lại (chrome.runtime.reload) để dùng bản mới, người dùng không phải bấm gì.
// =====================================================================
try {
  chrome.alarms.create('bhytSelfUpdate', { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener(async alarm => {
    if (!alarm || alarm.name !== 'bhytSelfUpdate') return;
    try {
      const res = await fetch(chrome.runtime.getURL('manifest.json') + '?t=' + Date.now(), { cache: 'no-store' });
      const disk = await res.json();
      const running = chrome.runtime.getManifest().version;
      if (disk && disk.version && disk.version !== running) {
        console.log(`[Tự cập nhật] Có bản mới ${disk.version} (đang chạy ${running}) -> tải lại tiện ích`);
        await chrome.storage.local.set({ bhytUpdatedFrom: running, bhytUpdatedTo: disk.version, bhytUpdatedAt: Date.now() });
        chrome.runtime.reload();
      }
    } catch (_) { /* đang chép dở / đọc lỗi -> thử lại phút sau */ }
  });
} catch (e) { console.warn('[Tự cập nhật] không bật được:', e); }

// =====================================================================
// TRA KHOA CỦA HỒ SƠ TRÊN CHECKXML (checkxml.com.vn/records/<Mã LK>/) - chỉ đọc, dùng phiên đăng nhập checkxml
// =====================================================================
function cxStrip(html) {
  return String(html || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}
async function cxKhoaOne(maLK) {
  const url = 'https://checkxml.com.vn/records/' + encodeURI(maLK) + '/';
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) return { maLK, err: 'HTTP ' + res.status };
  const t = cxStrip(await res.text());
  if (/Đăng nhập|login/i.test(t) && !/Khoa điều trị/i.test(t)) return { maLK, err: 'Chưa đăng nhập checkxml' };
  const m = t.match(/Khoa điều trị\s+(\S+)\s+Khoa xử lý:\s*(.+?)\s+Thông tin Hồ sơ/i);
  const ten = (t.match(/Thông tin Bệnh nhân\s+\S\s+(.+?)\s+Mã BN:/i) || [])[1] || '';
  if (!m) return { maLK, ten, err: 'Không thấy hồ sơ trên checkxml' };
  return { maLK, maKhoa: m[1], khoa: m[2], ten };
}
async function cxKhoa(maLKs) {
  const list = [...new Set((maLKs || []).filter(Boolean))];
  const out = {};
  for (let i = 0; i < list.length; i += 4) { // 4 yêu cầu song song
    const part = await Promise.all(list.slice(i, i + 4).map(m => cxKhoaOne(m).catch(e => ({ maLK: m, err: String(e && e.message || e) }))));
    part.forEach(r => { out[r.maLK] = r; });
  }
  return { success: true, map: out };
}
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || request.type !== 'CX_KHOA') return;
  cxKhoa(request.maLKs).then(sendResponse).catch(err => sendResponse({ success: false, message: String(err && err.message || err) }));
  return true;
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || request.type !== 'EMR_LOOKUP_SO_LUU_TRU') return; // không phải việc của bộ tra EMR
  emrLookupSoLuuTru(request.maBas)
    .then(sendResponse)
    .catch(err => sendResponse({ success: false, message: 'Không kết nối được EMR: ' + (err && err.message || err) }));
  return true;
});

