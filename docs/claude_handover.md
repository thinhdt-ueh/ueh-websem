# Claude handover — UEH-WebSEM

Bàn giao trạng thái dự án tính đến **2026-08-15**. Repo: `thinhdt-ueh/ueh-websem`, nhánh `main`, HEAD hiện tại là `ad8ca79`. Mục đích file này: để phiên làm việc (Claude) sau — hoặc chính bạn — nắm được ngay bối cảnh mà không phải đọc lại toàn bộ lịch sử chat.

## 1. Trạng thái hiện tại

UEH-WebSEM là web app phân tích PLS-SEM & CB-SEM song ngữ (VI/EN), viết bằng Flask + canvas thuần (không dùng thư viện diagram ngoài) + NumPy (PLS tự cài đặt) + `semopy` (CB-SEM/Maximum Likelihood).

**Tính năng đã hoàn chỉnh và đã lên `main`:**
- PLS-SEM đầy đủ: outer weights/loadings, bootstrapping (t/p-values, sign correction), blindfolding (Q², D=7), rho_A, HTMT, Fornell-Larcker, VIF, f².
- CB-SEM song song với PLS-SEM (cùng bộ tính năng, ước lượng bằng `semopy`).
- **Kiểm định biến điều tiết (moderator)**: construct kiểu "Interaction" (mode `I`) tạo được trên canvas, ước lượng 2 giai đoạn (Two-Stage Approach, Henseler & Chin 2010) cho cả PLS-SEM lẫn CB-SEM, có bootstrap riêng, ngưỡng f² riêng cho hiệu ứng điều tiết (0.005/0.01/0.025, khác ngưỡng main-effect 0.02/0.15/0.35). Xem `pls/moderation.py`, `cbsem/moderation.py`.
- **Total & Indirect Effects** (mediator): `pls/effects.py`, dùng chung cho cả hai phương pháp — tính tổng hợp direct + indirect qua mọi đường dẫn gián tiếp.
- **Common Method Bias**: Full Collinearity VIF test kiểu WarpPLS (Kock, 2015), ngưỡng 3.3.
- Song ngữ VI/EN đầy đủ: 2 catalog độc lập — `i18n.py` (backend: lỗi + báo cáo) và `static/js/i18n.js` (frontend: DOM). Xuất báo cáo Excel/Word luôn theo ngôn ngữ UI hiện tại, không phụ thuộc ngôn ngữ lúc chạy phân tích. Mặc định: **English**.
- Xuất báo cáo Excel & Word đầy đủ (bao gồm cả các bảng mới cho moderation/CMB).
- Import/export model dạng JSON.
- Tài liệu hướng dẫn sử dụng HTML song ngữ tại `static/docs/user_guide_{vi,en}.html`, link "User Guide" trên topbar (`#guideLink`), dùng số liệu thật từ bộ dữ liệu mẫu TAM.
- Responsive (desktop + mobile), có hỗ trợ touch thật trên canvas vẽ mô hình (không chỉ CSS).
- Giao diện: brand hiển thị "WebSEM" (không có tiền tố "UEH-"), logo UEH lưu local (không nhúng link ngoài), footer tách riêng `templates/footer.html` include qua Jinja.
- Giới hạn upload: tối đa 5000 dòng dữ liệu.

**3 cách chạy/triển khai đã có, đều đã test thật:**
1. **Local dev**: `python app.py` (Werkzeug dev server, `FLASK_DEBUG` gate).
2. **Render.com (PaaS)**: `Procfile` + `render.yaml`, dùng `gunicorn`. Đã deploy trước đó theo lựa chọn của user.
3. **Docker Compose**: `Dockerfile` + `docker-compose.yml` (cũng dùng `gunicorn`), volume riêng cho `uploads/`.
4. **Windows desktop .exe** (mới nhất): `desktop_launcher.py` build bằng PyInstaller (`build_exe.bat`) → double-click chạy được, tự mở trình duyệt vào `127.0.0.1:5000`, không cần cài Python. Do `gunicorn` không chạy được trên Windows nên launcher này dùng thẳng Werkzeug dev server (chấp nhận được vì chỉ bind `127.0.0.1`, single-user). File exe (~83MB) đã **commit thẳng vào git** (không dùng GitHub Release) và cũng có bản rời ở `C:\Users\thinhdt\Desktop\UEH-WebSEM.exe`.

## 2. Quyết định đã chốt (để không hỏi lại / không đảo ngược khi không cần thiết)

- **Kiến trúc i18n**: 2 catalog tách biệt (`i18n.py` backend / `static/js/i18n.js` frontend) — **không gộp**, vì dịch 2 bề mặt khác nhau ở 2 thời điểm khác nhau.
- **Ngôn ngữ mặc định**: English (đổi từ VI theo yêu cầu user).
- **Ngôn ngữ export report**: luôn theo ngôn ngữ UI *tại thời điểm export*, độc lập với ngôn ngữ lúc phân tích.
- **Phương pháp moderation**: Two-Stage Approach — không dùng product-indicator approach. Ngưỡng f² của moderation dùng bộ số riêng (Kenny 2018 / Aguinis et al. 2005), không dùng chung ngưỡng Cohen chuẩn.
- **Blindfolding/Q² bị bỏ qua hoàn toàn** khi model có biến interaction (có giải thích dịch song ngữ), vì thuật toán blindfolding hiện tại refit PLS gốc mỗi vòng, không biết dựng lại điểm số interaction.
- **Desktop launcher dùng Werkzeug dev server, không dùng gunicorn** (gunicorn không chạy trên Windows — cần `fcntl`).
- **File `.exe` được commit thẳng vào git repo** thay vì dùng GitHub Release: đã thử tạo Release qua GitHub API nhưng bị hệ thống permission chặn (cần trích xuất token credential đã cache — nằm ngoài phạm vi quyền cho phép). User đã xác nhận "đưa lên luôn nhé" nên chuyển sang commit trực tiếp (cách đã được phép sẵn, đã dùng nhiều lần trong phiên). Repo giờ nặng hơn ~83MB vĩnh viễn trong lịch sử git.
- **Không dùng Git LFS** (chưa thiết lập) — nếu về sau muốn giảm size repo, đây là hướng cân nhắc nhưng cần dọn lại lịch sử git (rewrite history), là thao tác phá hoại nên **phải hỏi user trước**.

## 3. Việc còn dở / cần lưu ý

- **README.md chưa được cập nhật** để nhắc tới 2 cách chạy mới (Docker Compose, Windows .exe) — hiện README chỉ mô tả cài đặt venv thủ công + deploy Render. Nên bổ sung khi có dịp.
- **Roadmap trong README** (`## Chưa có trong phiên bản này`) liệt kê: IPMA, Multi-group Analysis (MGA), PLSpredict, Consistent PLS (PLSc), MIMIC/formative cho CB-SEM — vẫn đúng, chưa làm cái nào.
- **Không có test suite tự động / CI** — chỉ có các script smoke-test chạy tay: `scripts/smoke_test.py`, `scripts/cbsem_smoke_test.py`, `scripts/moderation_validation.py`. Không có GitHub Actions.
- **Phân phối file .exe qua GitHub Release "sạch" hơn vẫn chưa làm được** — nếu muốn, cách khả thi: (a) user tự vào GitHub web UI → Releases → Draft a new release → kéo thả file, hoặc (b) cài `gh` CLI (`winget install GitHub.cli`) rồi tự `gh auth login` (cần thao tác trình duyệt/OAuth, Claude không tự làm được phần xác thực này), sau đó Claude có thể chạy `gh release create` giúp.
- **Local dev server không chạy liên tục** — mỗi phiên làm việc trước đó em có bật lên để test rồi tắt đi sau khi xong; port 5000 hiện **không có gì đang chạy**. Nếu bạn vào web mà không thấy phản hồi, khả năng cao là do server local chưa được khởi động (không phải lỗi code) — chạy `python app.py` hoặc double-click `UEH-WebSEM.exe`.
- **Quan sát lạ, không phải do Claude tạo ra**: trong lúc làm việc, thấy xuất hiện rồi biến mất các file zip ở gốc repo (`cbsem.zip` ~518MB, sau đó `UEH-WebSEM_src.zip`) — không đụng vào, không rõ nguồn gốc (có thể do bạn hoặc một tool khác đang thao tác song song trên thư mục này, ví dụ nén thư mục để backup). Nếu thấy các file `.zip` lạ nằm trong repo, kiểm tra kỹ trước khi git add/commit — chúng **chưa từng** được thêm vào git.
- **Build artifacts của PyInstaller** (`build/`, `dist/`, `UEH-WebSEM.spec`) đang nằm trong working tree, đã có trong `.gitignore` nên không bị commit — có thể xoá tay nếu muốn dọn ổ đĩa, không ảnh hưởng git.

## 4. Tham chiếu nhanh

| Cần gì | Xem ở đâu |
|---|---|
| Thuật toán PLS-SEM cốt lõi | `pls/algorithm.py` |
| Moderation (PLS / CB-SEM) | `pls/moderation.py`, `cbsem/moderation.py` |
| Total/Indirect effects (mediation) | `pls/effects.py` |
| CMB (Full Collinearity VIF) | `pls/metrics.py` (`CMB_VIF_THRESHOLD`) |
| i18n backend / frontend | `i18n.py` / `static/js/i18n.js` |
| Export Excel/Word | `pls/report.py`, `cbsem/report.py` |
| API routes | `routes/api.py` (PLS-SEM), `routes/cbsem_api.py` (CB-SEM) |
| Model builder canvas | `static/js/diagram.js` |
| Desktop launcher | `desktop_launcher.py`, `build_exe.bat` |
| Tài liệu hướng dẫn người dùng | `static/docs/user_guide_vi.html`, `static/docs/user_guide_en.html` |
