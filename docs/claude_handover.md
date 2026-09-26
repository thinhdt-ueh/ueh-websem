# Claude handover — AI-SEM

Bàn giao trạng thái dự án tính đến **2026-09-26**. Repo: `thinhdt-ueh/ueh-websem`, nhánh `main`, HEAD hiện tại là `3bceca5`. File này thay thế bản trước (mốc 2026-08-15) — gần như mọi mục ở bản cũ đã lỗi thời do khối lượng tính năng lớn được thêm từ đó đến nay (PLS-MGA, AI Lab Experiment, lưu session tự động, CI...). Mục đích: để phiên làm việc (Claude) sau — hoặc chính bạn — nắm được bối cảnh ngay mà không cần đọc lại toàn bộ lịch sử chat.

## 1. AI-SEM là gì

Web app phân tích PLS-SEM & CB-SEM song ngữ (VI/EN), viết bằng Flask + canvas thuần (không dùng thư viện diagram ngoài) + NumPy (PLS tự cài đặt) + `semopy` (CB-SEM/Maximum Likelihood). Tài liệu người dùng đầy đủ: `static/docs/user_guide_{vi,en}.html` (hướng dẫn nhanh, 19 mục) và `static/docs/handbook.html` (sách đầy đủ song ngữ, 30 chương + phụ lục) — **cả hai đã cập nhật đến tính năng mới nhất**, xem mục 4 khi cần biết chi tiết hành vi của một tính năng cụ thể thay vì đọc code.

## 2. Tính năng đã hoàn chỉnh trên `main`

**Lõi thống kê (PLS-SEM & CB-SEM song song, cùng bộ tính năng):**
- Outer weights/loadings, bootstrapping (t/p-value, sign correction), blindfolding (Q², D=7 — bị bỏ qua hoàn toàn nếu model có moderation, vì thuật toán chưa dựng lại được điểm tương tác mỗi vòng refit), rho_A, HTMT, Fornell-Larcker, VIF, f².
- **Moderation**: construct kiểu Interaction (mode `I`), ước lượng Two-Stage (Henseler & Chin 2010), hỗ trợ cả 2-way và **3-way interaction** (kéo-thả trên canvas hoặc panel chọn nguồn thủ công — cả 2 đường đều đồng bộ đúng `construct.name` khi nâng cấp 2-way→3-way). Simple Slopes visualization tách 3 panel theo mức của biến điều tiết ngoài cùng cho 3-way.
- Total & Indirect Effects (mediator), Index of Moderated Mediation.
- Common Method Bias (Full Collinearity VIF, ngưỡng 3.3).
- **PLS-MGA (Multi-Group Analysis)** — `pls/mga.py`, `routes/mga_api.py`: 4 phương pháp (Parametric, Welch-Satterthwaite, Permutation, Henseler's PLS-MGA), hỗ trợ cả model có moderation (chỉ Two-Stage).
- PLSpredict, IPMA, Power Analysis (mô phỏng Monte Carlo).
- **Sample Size Sensitivity**: 2 chế độ — shrink theo từng bước và resample lặp lại ở cỡ mẫu cố định — cả hai đều có tuỳ chọn biểu đồ p-value (bootstrap riêng cho PLS, miễn phí cho CB-SEM), và nút **xuất CSV dữ liệu gốc theo từng dòng** để kiểm chứng lại đúng tập quan sát đã dùng cho một kết quả cụ thể (replay đúng seed ngẫu nhiên, không chạy lại model).
- So sánh Machine Learning (Random Forest, XGBoost, LightGBM, CatBoost, hồi quy/phân loại tuyến tính) qua permutation importance, đối chiếu với path coefficient.

**AI Lab (`routes/ai_data_gen_api.py`) — sinh dữ liệu tổng hợp một lượt:**
- Tìm construct/indicator bằng AI (trích dẫn APA), codebook Likert + định tính, sinh dữ liệu khảo sát theo persona (batch, tự retry), AI vẽ mô hình cấu trúc (có bước review prompt trước khi gửi), bỏ qua bước dữ liệu để thiết kế mô hình trước, lưu toàn bộ đề xuất (JSON + Excel).

**AI Lab Experiment (`routes/ai_worker_api.py`) — thực nghiệm giữa-nhóm dùng lại được:**
- Tách biệt 2 giai đoạn: dựng **Worker Pool** (N persona AI cố định, xuất/nhập Excel để tái sử dụng qua nhiều phiên) rồi chạy nhiều **Survey Experiment** khác nhau trên cùng pool đó (chọn ngẫu nhiên thật M ≤ N, chia nhóm điều kiện).
- **Nhân khẩu học được gán bằng RNG có seed cố định TRƯỚC khi gọi AI** (không để AI tự chọn) — "cân bằng" nghĩa là đúng quota (50/50 hoặc chia đều theo option), không phải "AI cố gắng ra khoảng đó". Đây là fix quan trọng cho vấn đề mất cân bằng dữ liệu AI sinh ra.
- Điều kiện thực nghiệm tách thành **bối cảnh chung** (nhập 1 lần) + **thao túng riêng từng nhóm** — đúng thiết kế between-subjects chuẩn, không lẫn giữa 2 khái niệm.
- Mỗi lô gọi AI trả lời khảo sát chỉ nhận đúng hồ sơ của worker trong lô đó (không phải cả nhóm) — giảm nhiễu ngữ cảnh.
- Codebook có nút xuất/nhập định nghĩa (JSON) giống AI Lab.
- Dữ liệu hoàn tất có cột `condition_group` — dùng trực tiếp cho PLS-MGA.

**AI-rater — chấm điểm câu hỏi mở (`routes/ai_qual_score_api.py`):**
- Dùng chung cho cả AI Lab và AI Lab Experiment: chọn một cột định tính, viết rubric, AI chấm thành điểm Likert, gộp thẳng thành biến quan sát mới vào dữ liệu (ghi đè file CSV tại chỗ, cùng `file_id`). **Có thể chấm lại nhiều lần** trên cùng cột (khác rubric/tên biến) — không bị khoá sau lần đầu. Nút xuất CSV/Excel riêng ngay ở toolbar Bước 2 (Model Builder), luôn đọc dữ liệu mới nhất trên đĩa.

**Lưu session tự động (không có đăng nhập):**
- Toàn bộ tiến trình (dữ liệu, sơ đồ mô hình + vị trí node, kết quả PLS/CB-SEM, tiến trình dở của cả 2 wizard AI) tự lưu vào `localStorage`, khôi phục khi mở lại trang. Nút "🗑 Xóa session" ở footer xoá sạch. Cơ chế: `saveSession()`/`restoreSession()` trong `static/js/app.js` — lưu ý thứ tự bên trong `restoreSession()`: phải chuyển step/tab TRƯỚC khi gọi `editor.loadFrom()` (canvas đo kích thước theo panel đang hiển thị) và phải gọi `renderModelSummary()` sau khi restore editor (không tự động, dễ quên).

**Báo cáo & i18n:**
- Xuất Excel/Word tự động, báo cáo sinh bằng AI (3 nhà cung cấp: OpenAI/Gemini/Claude, dùng API key riêng của người dùng, không lưu ở server).
- Song ngữ VI/EN: 2 catalog tách biệt — `i18n.py` (backend) / `static/js/i18n.js` (frontend). Mặc định English.

## 3. Ba cách chạy/triển khai + phân phối file cài đặt

1. **Local dev**: `python app.py` (Werkzeug dev server).
2. **Docker Compose**: `docker compose up --build` (`Dockerfile` + `docker-compose.yml`, ảnh `ai-sem:latest`, dùng `gunicorn`).
3. **Render.com**: `render.yaml`, service tên `ueh-websem` (tên service chưa đổi theo rebrand, chỉ là tên nội bộ Render).
4. **File thực thi độc lập** — cả Windows lẫn macOS, build bằng PyInstaller từ `desktop_launcher.py`:
   - **Windows**: build local bằng `build_exe.bat` (cần `.venv` đã cài `pyinstaller`) → `dist\AI-SEM.exe`.
   - **macOS**: PyInstaller không cross-compile được — bắt buộc build trên máy macOS thật. Dùng GitHub Actions workflow `.github/workflows/build-macos.yml` (chạy trên runner `macos-latest`), kích hoạt bằng `gh workflow run build-macos.yml` hoặc push tag `v*`. Kết quả là **artifact của Actions run** (không phải Release), tải về bằng `gh run download <run-id> -n AI-SEM-macos`.
   - Cả 2 file (`AI-SEM.exe`, `AI-SEM-macos.zip`) **đã được upload lên `ai-sem.com/downloads/`** qua SFTP (host `AI-SEM.com`, user `aisem`, pass do người dùng cung cấp trực tiếp trong chat — không lưu ở đâu trong repo/máy). Cách upload: cài `paramiko` vào `.venv` (không thêm vào `requirements.txt` — chỉ dùng cho việc vận hành, không phải dependency của app), script SFTP ghi vào tên tạm (`.uploading`) rồi `posix_rename` để không bao giờ phục vụ file dở dang. Cấu trúc thư mục trên host: `ai-sem.com/{admin,assets,data,downloads,includes,test}/...` — đây là toàn bộ trang landing page ai-sem.com (PHP), tách biệt hoàn toàn với app Flask; `downloads/` là nơi duy nhất cần đồng bộ 2 file build.

## 4. Quyết định đã chốt (để không hỏi lại / không đảo ngược khi không cần thiết)

- **Kiến trúc i18n**: 2 catalog tách biệt, không gộp. Ngôn ngữ mặc định English. Ngôn ngữ export report theo ngôn ngữ UI tại thời điểm export.
- **Moderation**: Two-Stage Approach, ngưỡng f² riêng cho moderation (Kenny 2018 / Aguinis et al. 2005). Blindfolding/Q² bỏ qua hoàn toàn khi có interaction.
- **Desktop launcher dùng Werkzeug dev server**, không dùng gunicorn (không chạy trên Windows).
- **Kênh phân phối file cài đặt hiện tại là `ai-sem.com/downloads/`, KHÔNG còn commit .exe vào git nữa** — `dist/` đã nằm trong `.gitignore` (build cục bộ, không track). Chỉ còn đúng 1 file legacy `UEH-WebSEM.exe` sót lại trong lịch sử git từ trước khi đổi kênh phân phối (từ thời quyết định cũ "commit .exe thẳng vào git" vì GitHub Release từng bị chặn quyền) — không cần xoá, cũng không cần lặp lại cách làm đó cho các bản build mới.
- **Nhân khẩu học AI Worker Pool luôn do RNG thật gán, không để AI tự chọn** — quyết định chốt sau khi phát hiện AI tự chọn demographics bị thiên kiến hệ thống, không đạt đúng tỷ lệ khai báo dù được yêu cầu "cân bằng". Áp dụng cho tuổi/giới tính/mọi thuộc tính tuỳ chỉnh trong AI Lab Experiment (KHÔNG áp dụng ngược lại cho AI Lab thường — đó vẫn là thiết kế cũ, để nguyên).
- **Từ chối tuyệt đối mọi yêu cầu xoá/chỉnh dữ liệu chỉ để đổi kết quả có ý nghĩa thống kê** — dù được đóng gói dưới dạng tính năng ("Outlier remover" với tham số N/M chạy thử nhiều lần), dù được đóng gói lại là "thử nghiệm"/"không dùng cho luận văn". Đây là ranh giới đạo đức nghiên cứu đã được giữ vững nhiều lần trong các phiên làm việc trước — **phải tiếp tục giữ vững**, không suy diễn ngược từ việc tính năng đó nghe "hợp lý" hơn nếu được đóng khung khác đi. Loại bỏ outlier hợp lệ (Mahalanobis distance, straight-lining, chạy một lần, công khai, không tuỳ theo kết quả) vẫn được chấp nhận.
- **Dữ liệu tổng hợp cho mục đích minh hoạ/User Guide là hợp lệ** — miễn công khai rõ ràng đây là dữ liệu tổng hợp, không phải khảo sát thật, và được tạo bằng đúng phương pháp mô phỏng sẵn có của phần mềm.
- **PLS-MGA**: mỗi nhóm cần tối thiểu ~30 quan sát; chỉ hỗ trợ model có Interaction nếu dùng Two-Stage.

## 5. CI & test suite (khác hẳn bản handover cũ — lúc đó chưa có)

- **`tests/`**: 20 file test, 296 test case, chạy bằng `pytest`. Bao phủ mọi route API chính, kể cả các tính năng AI (luôn mock lời gọi provider ở tầng `_call_openai`/`_call_gemini`/`_call_claude`, không bao giờ gọi API thật trong test).
- **`.github/workflows/tests.yml`**: chạy pytest tự động trên mọi push/PR vào `main`.
- **`.github/workflows/build-macos.yml`**: build file macOS theo yêu cầu (`workflow_dispatch`) hoặc khi push tag `v*`.
- Trước khi commit bất kỳ thay đổi backend nào, luôn chạy `.venv/Scripts/python.exe -m pytest -q` — quy ước đã áp dụng xuyên suốt các phiên gần đây, không có ngoại lệ.

## 6. Việc còn dở / cần lưu ý

- **README.md** vẫn chưa được rà soát lại theo toàn bộ tính năng mới (PLS-MGA, AI Lab Experiment, session persistence) — nội dung cũ có thể lệch với `docs/claude_handover.md` này; ưu tiên tin file này hơn nếu mâu thuẫn.
- **`dist/`, `dist_macos/` và `build/`** là thư mục build cục bộ — đã thêm cả 3 vào `.gitignore`, không commit các file build lớn này (đúng theo mục 4: kênh phân phối là `ai-sem.com/downloads/`, không phải git).
- **Roadmap cũ** (IPMA, MGA, PLSpredict) đã **hoàn thành hết** — không còn là roadmap nữa, đã cập nhật vào mục 2.
- **Chưa làm**: Consistent PLS (PLSc), MIMIC/formative đầy đủ cho CB-SEM.
- **AI Lab (đơn giản) chưa áp dụng cơ chế "RNG thật gán demographics"** như AI Lab Experiment đã làm — nếu người dùng phản ánh dữ liệu AI Lab thường cũng bị lệch tỷ lệ giới tính/tuổi, đây là nguyên nhân đã biết, có thể áp dụng lại đúng kỹ thuật đã dùng cho AI Lab Experiment.
- **Thông tin đăng nhập SFTP của ai-sem.com KHÔNG được lưu ở bất kỳ đâu** (không trong repo, không trong bộ nhớ Claude) — nếu cần đồng bộ lại file download, phải xin lại từ người dùng mỗi lần.

## 7. Tham chiếu nhanh

| Cần gì | Xem ở đâu |
|---|---|
| Thuật toán PLS-SEM cốt lõi | `pls/algorithm.py` |
| Moderation (PLS / CB-SEM) | `pls/moderation.py`, `cbsem/moderation.py` |
| PLS-MGA | `pls/mga.py`, `routes/mga_api.py` |
| Total/Indirect effects (mediation) | `pls/effects.py` |
| Sensitivity (shrink/resample/p-value/export-row) | `routes/sensitivity_api.py`, `static/js/sensitivity.js` |
| AI Lab (sinh dữ liệu 1 lượt) | `routes/ai_data_gen_api.py` |
| AI Lab Experiment (Worker Pool + Survey) | `routes/ai_worker_api.py` |
| AI-rater chấm điểm định tính | `routes/ai_qual_score_api.py` |
| Lưu/khôi phục session | `saveSession()`/`restoreSession()` trong `static/js/app.js` |
| i18n backend / frontend | `i18n.py` / `static/js/i18n.js` |
| Export Excel/Word | `pls/report.py`, `cbsem/report.py` |
| Model builder canvas | `static/js/diagram.js` |
| Desktop launcher | `desktop_launcher.py`, `build_exe.bat`, `.github/workflows/build-macos.yml` |
| Tài liệu người dùng (nhanh + đầy đủ) | `static/docs/user_guide_{vi,en}.html`, `static/docs/handbook.html` |
| Test suite | `tests/` (`pytest`), CI: `.github/workflows/tests.yml` |
