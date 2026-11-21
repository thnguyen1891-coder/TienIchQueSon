// Trang HIS "Log đẩy dữ liệu bệnh nhân lên cổng BHXH theo công văn 130" (xemlog_congbaohiemxh_130) - MAIN world.
// Nút "Lưu log mã giao dịch": lấy log gửi XML 130 của cả 3 loại KCB (Ngoại trú / BANT / Nội trú) trong khoảng ngày
// đang chọn, lưu bảng Mã giao dịch -> Họ tên, Mã BN, Số phiếu (để trang cổng ghép tên vào danh sách hồ sơ lỗi).
(function () {
  if (window.top !== window || window.__bhytLog130) return;
  window.__bhytLog130 = true;
  const KEY = 'bhytLog130';
  let reqId = 0;
  const bridge = (op, key, value) => new Promise((resolve, reject) => {
    const id = 'lg' + (++reqId) + '_' + Date.now();
    const on = e => {
      const d = e.data;
      if (e.source !== window || !d || d.__bhytRsRes !== true || d.id !== id) return;
      window.removeEventListener('message', on); clearTimeout(t);
      d.res && d.res.error ? reject(new Error(d.res.error)) : resolve(d.res);
    };
    const t = setTimeout(() => { window.removeEventListener('message', on); reject(new Error('Không lưu được (bấm F5 rồi thử lại)')); }, 15000);
    window.addEventListener('message', on);
    window.postMessage({ __bhytRsReq: true, id, op, key, value }, '*');
  });

  function build() {
    const btn0 = document.getElementById('btnXemBaoCao');
    if (!btn0 || document.getElementById('bhyt-log130-btn') || typeof window.VienPhiCall === 'undefined') return false;
    const b = document.createElement('button');
    b.id = 'bhyt-log130-btn';
    b.type = 'button';
    b.textContent = '📥 Lưu log mã giao dịch (cả 3 loại KCB) để đối chiếu lỗi cổng';
    b.style.cssText = 'margin-left:8px;padding:5px 12px;font:bold 13px Arial;color:#fff;background:#6a1b9a;border:1px solid #4a148c;border-radius:4px;cursor:pointer';
    const st = document.createElement('span');
    st.style.cssText = 'margin-left:8px;font:bold 12px Arial;color:#6a1b9a';
    btn0.after(b, st);
    b.addEventListener('click', async () => {
      const tu = document.getElementById('tuNgay').value, den = document.getElementById('denNgay').value;
      b.disabled = true;
      try {
        const old = ((await bridge('kget', KEY)) || {}).value || {};
        const map = old.map || {};
        let n = 0;
        // 3 loại KCB x (XML 130 + Checkin XML0) - cổng báo lỗi cả mã giao dịch checkin
        for (const [kcb, ten, hs] of [['1', 'Ngoại trú', '130'], ['2', 'BANT', '130'], ['3', 'Nội trú', '130'],
          ['1', 'Ngoại trú (checkin)', '0'], ['2', 'BANT (checkin)', '0'], ['3', 'Nội trú (checkin)', '0']]) {
          st.textContent = `Đang lấy ${ten}...`;
          let d = [];
          try { d = await window.VienPhiCall.getList('GET_LOG_XML_130', [tu, den, kcb, hs, 49008]); } catch (_) { continue; }
          (d || []).forEach(x => {
            if (!x.MA_GIAO_DICH) return;
            map[String(x.MA_GIAO_DICH).trim()] = { ten: x.TEN_BENH_NHAN, maBN: String(x.MA_BENH_NHAN || ''), soPhieu: x.SO_PHIEU_THANH_TOAN, loai: ten, ngay: x.NGAY_THAO_TAC, tt: x.TRANG_THAI };
            n++;
          });
        }
        await bridge('kset', KEY, { map, at: Date.now(), tu, den });
        st.textContent = `✅ Đã lưu ${n} dòng log (${tu} - ${den}); tổng ${Object.keys(map).length} mã giao dịch. Sang cổng BHXH "Kết quả gửi hồ sơ" bấm "Quét hồ sơ lỗi".`;
      } catch (e) { st.textContent = '❌ ' + (e.message || e); }
      finally { b.disabled = false; }
    });
    return true;
  }
  let tries = 0;
  const t = setInterval(() => { if (build() || ++tries > 40) clearInterval(t); }, 500);
})();
