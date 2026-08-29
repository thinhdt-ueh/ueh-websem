# UEH-WebSEM

Ứng dụng web (Flask + Python) chạy phân tích **SEM** (Structural Equation
Modeling) theo cả hai trường phái phổ biến nhất — **PLS-SEM** (Partial Least
Squares, cùng phương pháp SmartPLS dùng) và **CB-SEM** (Covariance-Based,
Maximum Likelihood, cùng phương pháp AMOS/lavaan/Mplus dùng) — với một giao
diện kéo-thả duy nhất để xây mô hình cấu trúc, chạy trực tiếp trên trình duyệt.

Cùng một mô hình (construct, biến quan sát, đường dẫn) có thể chạy bằng cả
hai phương pháp để so sánh — chỉ cần đổi lựa chọn "Phương pháp ước lượng" ở
Bước 2 rồi bấm chạy lại.

## Tính năng phiên bản hiện tại

### PLS-SEM

- Upload dữ liệu khảo sát (CSV/XLSX), xem trước dữ liệu.
- Xây dựng mô hình trực quan: thêm construct (reflective/formative), gán biến
  quan sát, vẽ đường dẫn cấu trúc (path) bằng canvas kéo-thả.
- Thuật toán PLS gốc (path weighting scheme, Mode A & Mode B) cài đặt bằng NumPy/Pandas.
- Chỉ số đo lường: outer loadings, outer weights, cross loadings.
- Độ tin cậy & giá trị hội tụ: Cronbach's Alpha, rho_A (Dijkstra-Henseler),
  Composite Reliability (rho_c), AVE.
- Giá trị phân biệt: Fornell-Larcker criterion, HTMT.
- Mô hình cấu trúc: path coefficients, R², R² hiệu chỉnh, f² effect size.
- Đa cộng tuyến: VIF (inner model cho biến nội sinh, outer model cho block formative).
- **Common Method Bias (CMB) — Full Collinearity Test** (Kock, 2015; kỹ thuật
  WarpPLS dùng phổ biến nhất để kiểm tra CMB): mỗi construct hồi quy trên TẤT
  CẢ construct còn lại (không chỉ predictor trực tiếp như inner VIF), nếu mọi
  VIF ≤ 3.3 thì mô hình được xem là không có dấu hiệu CMB. Có sẵn cho cả
  PLS-SEM và CB-SEM.
- **Bootstrapping**: kiểm định ý nghĩa thống kê cho path coefficients và outer
  loadings — Sample Mean, STDEV, T Statistics, P Values, khoảng tin cậy 95%
  (percentile), có căn chỉnh dấu (sign correction) theo từng construct để
  tránh phân phối bootstrap bị lệch do PLS không xác định dấu.
- **Blindfolding & Q² (predictive relevance)**: tự động chạy cho mọi construct
  nội sinh reflective (omission distance D = 7), báo cáo cùng bảng với R²;
  Q² > 0 nghĩa là mô hình có giá trị dự báo cho construct đó.
- Sơ đồ kết quả (path diagram) có chú thích hệ số, t-value & R² ngay trên
  canvas; path không có ý nghĩa thống kê (p ≥ 0.05) hiển thị nét đứt.
- **Xuất báo cáo Excel (.xlsx) và Word (.docx)**: xuất toàn bộ kết quả (đo
  lường, độ tin cậy, giá trị phân biệt, mô hình cấu trúc, bootstrapping,
  Q²) thành file có định dạng sẵn, dùng ngay để đưa vào luận văn/báo cáo.
  Xuất tức thời — không chạy lại PLS/bootstrap, chỉ đóng gói kết quả đã có.

### CB-SEM (mới)

- Ước lượng bằng **Maximum Likelihood** trên ma trận hiệp phương sai, dùng
  engine `semopy` (thư viện SEM học thuật đã kiểm chứng) — dùng lại NGUYÊN
  giao diện xây mô hình của PLS-SEM (cùng construct/indicator/path).
- **Chỉ hỗ trợ đo lường reflective** — construct formative (Mode B) bị từ
  chối rõ ràng trước khi ước lượng vì cần mô hình MIMIC với ràng buộc riêng.
- **Model Fit**: χ², df, p-value, CFI, TLI, RMSEA, SRMR, GFI, AGFI, NFI, AIC,
  BIC — kèm đánh giá theo ngưỡng phổ biến trong tài liệu (Hu & Bentler 1999).
- Factor loadings & path coefficients có sẵn **unstandardized, standardized,
  SE, z-value, p-value trực tiếp từ Maximum Likelihood** — không cần chạy
  bootstrapping riêng như PLS-SEM.
- Độ tin cậy (Cronbach's Alpha, Composite Reliability, AVE) và giá trị phân
  biệt (Fornell-Larcker, HTMT) — dùng lại đúng công thức của PLS-SEM, chỉ
  thay bằng loadings/factor scores ước lượng theo ML.
- Xuất báo cáo Excel/Word riêng cho CB-SEM.

### Chung cho cả hai phương pháp

- **Import / Export mô hình (JSON)**: lưu mô hình đã vẽ (construct, indicator,
  path, vị trí trên canvas) ra file `.json` để lưu trữ hoặc chia sẻ, và nạp
  lại để tiếp tục chỉnh sửa mà không cần vẽ lại từ đầu — dùng chung cho cả
  PLS-SEM và CB-SEM vì cùng một định dạng mô hình.
- **Song ngữ Việt/Anh**: nút "VI / EN" ở góc trên bên phải đổi toàn bộ giao
  diện (nhãn, tiêu đề bảng, thông báo lỗi, sơ đồ) sang ngôn ngữ đã chọn ngay
  lập tức, không cần tải lại trang hay chạy lại phân tích — lựa chọn ngôn ngữ
  được nhớ lại cho lần truy cập sau (`localStorage`). **Tiếng Anh là ngôn ngữ
  mặc định** cho lần truy cập đầu tiên. **Báo cáo Excel/Word xuất ra luôn theo
  đúng ngôn ngữ đang hiển thị trên web tại thời điểm bấm xuất.**
- Giới hạn dữ liệu đầu vào **tối đa 5000 dòng** mỗi lần upload (kiểm tra ngay
  khi tải lên, báo lỗi rõ ràng nếu vượt quá).
- Ở panel "Tổng quan mô hình" (Bước 2), mỗi construct có nút **+/−** để hiện/ẩn
  danh sách tên các biến quan sát (indicators) đã gán cho construct đó.
- Logo UEH lưu local tại `static/img/logo-ueh.png` (không nhúng link ngoài,
  không phụ thuộc website ueh.edu.vn còn hoạt động hay không). Footer tách
  riêng thành `templates/footer.html`, nhúng vào `index.html` bằng
  `{% include "footer.html" %}` — muốn sửa nội dung footer chỉ cần sửa đúng
  1 file đó.
- Dữ liệu mẫu dựng sẵn (mô hình TAM: Perceived Ease of Use → Perceived
  Usefulness → Attitude → Intention) để dùng thử ngay.
- **Responsive (desktop & di động)**: header/layout/bảng kết quả tự sắp xếp
  lại theo kích thước màn hình (điện thoại, tablet, desktop), không bị tràn
  ngang trang. Canvas xây mô hình hỗ trợ **thao tác chạm thật** trên di động
  (chạm để chọn, kéo để di chuyển construct, chạm đúp để thêm construct mới)
  — không chỉ co giãn giao diện mà còn dùng được thực sự trên điện thoại/tablet.

### Chưa có trong phiên bản này (định hướng phát triển tiếp)

Importance-Performance Map Analysis (IPMA), Multi-group Analysis (MGA),
PLSpredict, Consistent PLS (PLSc), mô hình MIMIC/formative cho CB-SEM.

## Cài đặt

```bash
cd smartpls-web
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
```

## Chạy ứng dụng

```bash
python app.py
```

Mở trình duyệt tại `http://127.0.0.1:5000`.

## Chạy test

```bash
pip install -r requirements-dev.txt
pytest
```

Bộ test (`tests/`) bao phủ thuật toán PLS-SEM/CB-SEM cốt lõi, moderation (cả 3
calc method), bootstrap, các chỉ số đo lường, PLSpredict, IPMA, và các route
API chính (upload/analyze/export) — chạy tự động qua GitHub Actions
(`.github/workflows/tests.yml`) trên mỗi lần push/PR vào `main`.

## Triển khai lên internet (Render.com)

Repo đã có sẵn `Procfile` + `render.yaml` (chạy bằng `gunicorn`, tắt debug
mode) — chỉ cần đẩy code lên GitHub rồi trỏ Render vào là xong:

1. **Tạo repo trên GitHub** (repo trống, không cần README/license):
   `https://github.com/new`
2. **Đẩy code local lên** (đã có sẵn commit đầu tiên trong repo local):
   ```bash
   git remote add origin https://github.com/<username>/<repo-name>.git
   git branch -M main
   git push -u origin main
   ```
3. **Tạo dịch vụ trên Render**: đăng nhập [render.com](https://render.com) (có
   thể dùng tài khoản GitHub) → **New +** → **Blueprint** → chọn repo vừa đẩy
   lên → Render tự đọc `render.yaml` và cấu hình sẵn build/start command →
   bấm **Apply**.
   - Nếu muốn cấu hình tay thay vì Blueprint: **New +** → **Web Service** →
     chọn repo → Build Command: `pip install -r requirements.txt` → Start
     Command: `gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --timeout 2400`.
4. Sau khi build xong (vài phút), Render cấp sẵn 1 domain dạng
   `https://ueh-websem.onrender.com` kèm HTTPS miễn phí.

**Lưu ý khi chạy trên gói Free:**
- Dịch vụ sẽ "ngủ" sau 15 phút không có traffic; lượt truy cập đầu tiên sau đó
  chậm lại (~30-50 giây) trong lúc Render khởi động lại container — không phải
  lỗi, chỉ cần chờ.
- Đĩa lưu file upload (`uploads/`) là **ephemeral** — mỗi lần restart/deploy
  lại sẽ xoá sạch. Không ảnh hưởng đến việc sử dụng bình thường (mỗi phiên chỉ
  cần file tồn tại đến lúc chạy xong phân tích), chỉ cần biết để không kỳ vọng
  file cũ còn tồn tại sau khi service khởi động lại.
- `--timeout 2400` (giây) cho gunicorn đủ dư cho cả trường hợp nặng nhất hiện
  tại — Power Analysis (mô phỏng Monte Carlo) và So sánh Machine Learning với
  nhiều thuật toán/target đều có thể chạy tới vài chục phút; nếu sau này tăng
  thêm các giới hạn đó, cần tăng số này tương ứng trong `Procfile`/`render.yaml`
  (và `Dockerfile` nếu triển khai bằng Docker).
- Muốn dịch vụ luôn sẵn sàng (không bị ngủ): đổi `plan: free` thành
  `plan: starter` trong `render.yaml` (~$7/tháng).

## Sử dụng

1. **Bước 1 — Dữ liệu**: kéo-thả file CSV/XLSX (mỗi cột là 1 biến quan sát),
   hoặc bấm **"Dùng dữ liệu mẫu"** ở góc trên bên phải để thử ngay với mô hình TAM.
2. **Bước 2 — Mô hình**:
   - Bấm **"+ Construct"** hoặc nhấp đúp vào canvas để tạo biến tiềm ẩn.
   - Chọn construct, đặt tên, chọn loại đo lường (Reflective/Formative) và
     tick chọn các cột dữ liệu làm biến quan sát ở panel bên phải.
   - Bấm **"↗ Vẽ đường dẫn"**, sau đó nhấp construct nguồn rồi construct đích
     để tạo path cấu trúc. Mô hình phải không có vòng lặp (đệ quy).
3. Ở panel bên phải, mục **"Bootstrapping"** mặc định bật sẵn (500 lần lặp) để
   có t-value/p-value cho path coefficients — có thể tắt để chạy nhanh hơn,
   hoặc tăng lên 5000 lần cho báo cáo chính thức (chậm hơn, ~30-60 giây).
4. Bấm **"▶ Chạy PLS Algorithm"** để chuyển sang **Bước 3 — Kết quả**: sơ đồ có
   số liệu, cùng các bảng độ tin cậy, hệ số tải, giá trị phân biệt, path
   coefficients kèm ý nghĩa thống kê, R² & Q², VIF. Blindfolding (Q²) luôn
   chạy tự động, không cần bật riêng — chỉ mất dưới 1 giây với D=7 vòng lặp.
5. Ở góc trên bảng kết quả, bấm **"📊 Xuất Excel"** hoặc **"📄 Xuất Word"** để
   tải toàn bộ báo cáo về máy.
6. Ở **Bước 2**, dùng **"⬇ Xuất mô hình"** / **"⬆ Nhập mô hình"** để lưu lại
   hoặc nạp lại cấu trúc mô hình đã vẽ (file `.json`) cho những lần phân tích sau.
7. Muốn chạy **CB-SEM** thay vì PLS-SEM: ở đầu panel bên phải (Bước 2), đổi
   **"Phương pháp ước lượng"** thành *CB-SEM*. Mục Bootstrapping sẽ ẩn đi (CB-SEM
   không cần) và nút chạy đổi thành **"▶ Chạy CB-SEM (ML)"**. Lưu ý: tất cả
   construct trong mô hình phải là Reflective (Mode A).
8. Bấm **"VI" / "EN"** ở góc trên bên phải bất kỳ lúc nào để đổi ngôn ngữ giao
   diện — kể cả khi đang xem kết quả (bảng sẽ dựng lại ngay bằng dữ liệu đã
   có, không cần chạy lại phân tích). Khi xuất Excel/Word, báo cáo sẽ theo
   đúng ngôn ngữ đang chọn lúc đó.

## Cấu trúc dự án

```
smartpls-web/
├── app.py                  # Flask app factory
├── i18n.py                  # Từ điển dịch dùng chung ở backend (thông báo lỗi + nhãn báo cáo), VI/EN
├── pls/
│   ├── model.py             # Định nghĩa & validate mô hình (construct, path) — DÙNG CHUNG cho CB-SEM
│   ├── algorithm.py         # Thuật toán PLS (path weighting scheme), thuần NumPy
│   ├── metrics.py           # Reliability/validity/collinearity metrics — DÙNG CHUNG cho CB-SEM
│   ├── bootstrap.py         # Bootstrapping: resample + sign correction + t/p-values
│   ├── blindfolding.py      # Blindfolding: omission distance + Q² (predictive relevance)
│   └── report.py            # Xuất báo cáo Excel (.xlsx) & Word (.docx) cho PLS-SEM
├── cbsem/
│   ├── estimator.py         # Build lavaan syntax từ Model, fit ML qua semopy, fit indices, SRMR, R²
│   ├── metrics.py           # Gọi lại pls/metrics.py với loadings/factor scores theo ML
│   └── report.py            # Xuất báo cáo Excel (.xlsx) & Word (.docx) cho CB-SEM
├── routes/
│   ├── api.py                # REST API PLS-SEM: /api/upload, /api/analyze, /api/sample,
│   │                          #   /api/export/excel, /api/export/word
│   └── cbsem_api.py          # REST API CB-SEM: /api/analyze_cbsem,
│                              #   /api/export_cbsem/excel, /api/export_cbsem/word
├── static/
│   ├── {css,js}/            # i18n.js (từ điển dịch giao diện), diagram.js (canvas editor),
│   │                        #   app.js (orchestration) — dùng chung cả 2 phương pháp
│   └── img/logo-ueh.png     # Logo UEH lưu local (không nhúng link ngoài)
├── templates/
│   ├── index.html
│   └── footer.html          # Nội dung footer — sửa file này để đổi footer, không cần đụng index.html
├── sample_data/tam_sample.csv
└── scripts/                 # Script tạo dữ liệu mẫu & smoke test thuật toán (PLS lẫn CB-SEM)
```

## Ghi chú kỹ thuật

- Thuật toán ước lượng theo đúng quy trình PLS cổ điển (Lohmöller/Wold): outer
  approximation → inner approximation (path weighting scheme) → cập nhật outer
  weights (Mode A = hồi quy đơn/tương quan, Mode B = hồi quy bội) → lặp đến hội tụ.
- Dữ liệu được chuẩn hoá (mean 0, population std) trước khi ước lượng, giống quy ước của SmartPLS.
- Bootstrapping resample có hoàn lại (with replacement) từ chính mẫu dữ liệu đã
  làm sạch, chạy lại toàn bộ thuật toán PLS trên mỗi mẫu; t-value = |hệ số gốc|
  / độ lệch chuẩn bootstrap, p-value tính theo phân phối t với bậc tự do =
  (số mẫu hợp lệ − 1). Vòng lặp này là phần tốn thời gian nhất nên được viết
  thuần NumPy (không dùng pandas trong vòng lặp) để đủ nhanh cho một request web.
- **Full Collinearity VIF (CMB)**: khác với `inner_vif` (chỉ xét đa cộng tuyến
  giữa các predictor trực tiếp của một target trong mô hình cấu trúc),
  `full_collinearity_vif()` hồi quy MỖI construct trên TẤT CẢ construct còn
  lại bất kể có path cấu trúc hay không — đúng phương pháp "full collinearity
  test" của Kock (2015) mà phần mềm WarpPLS phổ biến hoá để phát hiện common
  method bias (một yếu tố phương pháp chung gây phồng phương sai sẽ làm đa
  cộng tuyến tăng đồng loạt ở mọi construct). Ngưỡng 3.3 đã đối chiếu qua
  nhiều nguồn độc lập trước khi cài đặt. Dùng chung được cho cả PLS-SEM
  (LV scores) và CB-SEM (factor scores) vì chỉ cần ma trận điểm số construct,
  không phụ thuộc thuật toán ước lượng.
- Blindfolding lần lượt loại bỏ từng 1/D dữ liệu (D=7) của MỖI construct nội
  sinh reflective theo hàng (row-wise, giống thuật toán `dlines=TRUE` của gói
  semPLS/SmartPLS), thay bằng giá trị trung bình của phần dữ liệu còn lại, rồi
  chạy lại toàn bộ PLS algorithm để dự báo phần bị loại bỏ thông qua path
  coefficients của các construct tiền tố (predecessor) — KHÔNG dùng chính dữ
  liệu của construct đó để tránh rò rỉ thông tin (data leakage). Điểm khác
  biệt so với hành vi mặc định của SmartPLS: bản này luôn thay giá trị bị loại
  bằng trung bình (mean replacement) thay vì ước lượng "pairwise" trên dữ liệu
  khuyết — cách làm đơn giản hơn nhưng vẫn là một phương án chính thống được
  tài liệu hoá trong gói semPLS gốc, nên kết quả Q² có thể chênh lệch nhẹ so
  với SmartPLS.
- File mô hình xuất ra (`pls_model.json`) lưu id/tên/loại đo lường/biến quan
  sát/vị trí canvas của từng construct và danh sách path — không lưu kèm dữ
  liệu khảo sát. Khi nhập lại, tên biến quan sát (indicator) cần khớp với tên
  cột trong file dữ liệu đang dùng ở Bước 1 thì mới chạy phân tích được; nếu
  không khớp, ứng dụng vẫn nạp được mô hình nhưng sẽ báo lỗi khi bấm "Chạy PLS
  Algorithm".
- Báo cáo Excel/Word được dựng lại hoàn toàn từ JSON kết quả mà trình duyệt đã
  nhận (không gọi lại PLS/bootstrap/blindfolding), nên xuất file gần như tức
  thời kể cả sau khi chạy bootstrapping 5000 lần lặp.
- **CB-SEM** dùng `semopy` (thư viện Python SEM đã công bố học thuật) làm engine
  ước lượng thay vì tự viết bộ tối ưu hoá ML — tối ưu số học + ma trận thông
  tin Fisher cho sai số chuẩn là phần rất dễ sai tinh vi nếu tự cài đặt, nên
  chọn cách dùng lại một engine đã được kiểm chứng thay vì tự làm, khác với
  PLS-SEM (thuật toán đơn giản, tự viết và tự kiểm chứng số liệu được).
  Mô hình được dịch tự động từ construct/indicator/path sang cú pháp kiểu
  lavaan (`construct =~ indicator1 + indicator2`, `endogenous ~ predictor`);
  covariance giữa các construct ngoại sinh được `semopy` tự do ước lượng theo
  đúng quy ước CFA/SEM chuẩn (không cần khai báo tường minh).
  R² tính từ phương sai phần dư đã chuẩn hoá của construct nội sinh
  (`1 − Var(residual chuẩn hoá)`); SRMR không có sẵn trong `semopy` nên được
  tính thủ công từ ma trận tương quan quan sát so với ma trận tương quan mô
  hình ngụ ý (công thức chuẩn theo Hu & Bentler / lavaan).
  Cronbach's Alpha và HTMT tính trực tiếp từ dữ liệu thô nên dùng chung được
  với PLS-SEM; Composite Reliability/AVE/Fornell-Larcker dùng lại đúng công
  thức PLS-SEM nhưng với standardized loadings và factor scores ước lượng
  theo Maximum Likelihood.
- Đây là công cụ hỗ trợ học tập/nghiên cứu; không thay thế phần mềm thương mại
  SmartPLS/AMOS cho các tính năng nâng cao chưa hỗ trợ (PLSpredict, IPMA,
  MGA, mô hình MIMIC/formative trong CB-SEM...).
- **Song ngữ** được cài đặt bằng hai từ điển tra cứu độc lập — `i18n.py` ở
  backend (thông báo lỗi validate/estimation + toàn bộ nhãn trong file Excel/
  Word) và `static/js/i18n.js` ở frontend (mọi chữ hiển thị trên trang, bao
  gồm cả text vẽ trực tiếp lên canvas trong `diagram.js`) — không dùng thư
  viện i18n ngoài, vì kích thước từ điển vừa đủ nhỏ để tự quản lý bằng object
  tra cứu thuần. Ngôn ngữ hiện tại được gửi kèm trong mọi request
  (`lang: "vi"|"en"`) tới `/api/analyze`, `/api/analyze_cbsem` (dịch thông báo
  lỗi) và `/api/export*` (dịch báo cáo) — độc lập với ngôn ngữ lúc PHÂN TÍCH
  được chạy, đúng như yêu cầu "xuất báo cáo theo ngôn ngữ đang chọn". Khi đổi
  ngôn ngữ lúc đang xem kết quả, các bảng được dựng lại ngay từ dữ liệu JSON
  đã nhận (không gọi lại API phân tích). Các thuật ngữ thống kê chuẩn quốc tế
  (AVE, VIF, HTMT, CFI, RMSEA, R², Cronbach's Alpha...) được giữ nguyên ở cả
  hai ngôn ngữ vì đó cũng là quy ước thông thường trong các bài báo tiếng Việt.
- Tên sheet Excel bị giới hạn cứng 31 ký tự — có một bản dịch tiếng Anh ban đầu
  ("Reliability & Convergent Validity") vượt giới hạn này và bị `openpyxl` phát
  cảnh báo; đã rút ngắn bản dịch và thêm hàm cắt phòng vệ (`_sheet_name()`)
  để lỗi tương tự không tái diễn nếu nhãn được sửa sau này.
- **Responsive**: `.builder-layout` và `.results-grid` là CSS Grid, chuyển
  sang 1 cột dưới breakpoint tương ứng (900px / 640px). Có một lỗi CSS Grid
  kinh điển đã gặp và sửa khi test trên điện thoại thật (qua Playwright, không
  chỉ suy đoán): các ô grid mặc định có `min-width: auto`, nên bảng có cột
  `white-space: nowrap` bên trong sẽ ép cả ô grid (và toàn trang) rộng ra thay
  vì cuộn ngang bên trong `.table-scroll` như mong muốn — khắc phục bằng
  `min-width: 0` trên các ô grid liên quan. Canvas xây mô hình (`diagram.js`)
  dùng chung một bộ hàm `_pointerDown/_pointerMove/_pointerUp` cho cả sự kiện
  chuột và chạm (touch), cùng bộ dò chạm-đúp (double-tap) thủ công thay cho
  `dblclick` (không có trên di động); đã kiểm chứng kéo-thả và chạm-đúp hoạt
  động thật bằng test giả lập cảm ứng, không chỉ kiểm tra layout.
