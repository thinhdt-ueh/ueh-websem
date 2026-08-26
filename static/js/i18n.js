/* Frontend VI/EN translation catalog + helpers. Independent from the backend
 * catalog (i18n.py) — this one translates DOM text in the browser on language
 * switch; the backend one translates error messages and exported report
 * labels at request time. Loaded before diagram.js/app.js. */

const LANG_STORAGE_KEY = "plssem_lang";

const I18N = {
  vi: {
    // --- header / nav ---
    nav_step1: "1. Dữ liệu",
    nav_step2: "2. Mô hình",
    nav_step3: "3. Kết quả",
    nav_sample: "Dùng dữ liệu mẫu",
    nav_sample_moderation: "Dữ liệu mẫu (Mediator + Moderator)",
    nav_guide: "📖 Hướng dẫn sử dụng",

    // --- step 1: upload ---
    s1_title: "Tải lên dữ liệu khảo sát",
    s1_hint: "Hỗ trợ CSV hoặc Excel (.xlsx). Mỗi cột là một biến quan sát (item), mỗi dòng là một quan sát. Tối đa 5000 dòng.",
    s1_dropzone_text: "Kéo thả file vào đây hoặc",
    s1_browse: "chọn file",
    s1_preview_title: "Xem trước dữ liệu ({rows} dòng, {cols} cột)",
    s1_continue: "Tiếp tục: Xây dựng mô hình →",
    s1_selected_file: "Đã chọn: {name}",
    msg_upload_failed: "Upload thất bại.",
    msg_sample_failed: "Không tải được dữ liệu mẫu.",

    // --- step 2: model builder toolbar ---
    s2_add_construct: "+ Construct",
    s2_draw_path: "↗ Vẽ đường dẫn (Path)",
    s2_delete_selected: "🗑 Xoá mục chọn",
    s2_export_model: "⬇ Xuất mô hình",
    s2_import_model: "⬆ Nhập mô hình",
    s2_toolbar_hint_default: 'Nhấp đúp vào canvas hoặc bấm "+ Construct" để thêm biến tiềm ẩn.',
    s2_toolbar_hint_path_mode: "Nhấp vào construct nguồn rồi construct đích để tạo đường dẫn cấu trúc.",

    // --- step 2: side panel ---
    s2_method_title: "Phương pháp ước lượng",
    s2_method_pls: "PLS-SEM (Partial Least Squares)",
    s2_method_cbsem: "CB-SEM (Maximum Likelihood / Covariance-Based)",
    s2_method_hint_pls: "Composite-based, phù hợp dữ liệu không chuẩn/cỡ mẫu nhỏ, hỗ trợ construct formative.",
    s2_method_hint_cbsem: "Covariance-based (Maximum Likelihood): cho các chỉ số fit mô hình (CFI, RMSEA, SRMR...) và kiểm định ý nghĩa thống kê trực tiếp, nhưng chỉ hỗ trợ construct reflective.",
    s2_construct_props: "Thuộc tính Construct",
    s2_no_selection: "Chọn một construct trên canvas để chỉnh sửa.",
    s2_construct_name: "Tên construct",
    s2_measurement_type: "Loại đo lường",
    s2_mode_reflective: "Reflective (Mode A)",
    s2_mode_formative: "Formative (Mode B)",
    s2_mode_interaction: "Biến tương tác / điều tiết (Interaction, A × B)",
    s2_indicators_label: "Biến quan sát (indicators)",
    s2_interaction_sources_label: "Nguồn của biến tương tác (chọn 2 construct)",
    s2_interaction_source_a: "Construct A",
    s2_interaction_source_b: "Construct B",
    s2_interaction_not_enough: "Cần ít nhất 2 construct khác (không phải biến tương tác) đã tồn tại để tạo biến tương tác.",
    s2_interaction_same_source: "Hai construct nguồn phải khác nhau.",
    s2_calc_method_label: "Phương pháp tính (Calculation Method)",
    s2_calc_method_product_indicator: "Product Indicator",
    s2_calc_method_two_stage: "Two Stage",
    s2_calc_method_orthogonalization: "Orthogonalization",
    s2_calc_method_cbsem_note: "Lưu ý: CB-SEM luôn dùng Two Stage, bất kể lựa chọn ở đây (Product Indicator/Orthogonalization chỉ áp dụng cho PLS-SEM).",
    s2_product_term_label: "Sinh Product Term (Advanced Settings)",
    s2_product_term_unstandardized: "Unstandardized",
    s2_product_term_mean_centered: "Mean Centered",
    s2_product_term_standardized: "Standardized",
    s2_product_term_two_stage_note: "Two Stage luôn nhân hai factor score giai đoạn 1 — vốn đã chuẩn hóa (standardized) sẵn theo định nghĩa (Henseler & Chin, 2010), nên không có lựa chọn nào khác ở đây để chọn thêm.",
    s2_model_overview: "Tổng quan mô hình",
    s2_bootstrapping: "Bootstrapping",
    s2_bootstrap_enable: "Kiểm định ý nghĩa thống kê (t-values, p-values)",
    s2_bootstrap_reps_label: "Số lần lặp lại mẫu (resamples)",
    s2_bootstrap_100: "100 (nhanh)",
    s2_bootstrap_500: "500 (khuyến nghị)",
    s2_bootstrap_1000: "1000",
    s2_bootstrap_2000: "2000",
    s2_bootstrap_5000: "5000 (chậm, ~30-60s)",
    s2_bootstrap_hint: "Bootstrapping tạo nhiều mẫu lặp lại (resample) từ dữ liệu gốc để ước lượng độ lệch chuẩn, t-value và p-value cho từng path coefficient — cần thiết để báo cáo mức ý nghĩa thống kê (p < 0.05) trong nghiên cứu.",
    s2_cbsem_note: "CB-SEM tính sẵn SE/z-value/p-value bằng Maximum Likelihood — không cần bootstrapping.",
    s2_run_pls: "▶ Chạy PLS Algorithm",
    s2_run_cbsem: "▶ Chạy CB-SEM (ML)",

    // --- construct summary line ---
    s2_summary_reflective: "Reflective",
    s2_summary_formative: "Formative",
    s2_summary_interaction: "Biến tương tác",
    s2_summary_item_suffix: "item",
    s2_summary_paths_suffix: "đường dẫn cấu trúc (paths)",
    s2_summary_toggle_aria: "Hiện/ẩn biến quan sát",
    s2_path_rejected: "Không thể tạo path này (trùng, ngược chiều, hoặc tạo vòng lặp).",

    // --- add construct modal ---
    modal_title: "Thêm Construct mới",
    modal_name_label: "Tên construct",
    modal_name_placeholder: "VD: Sự hài lòng",
    modal_mode_label: "Loại đo lường",
    modal_cancel: "Huỷ",
    modal_add: "Thêm",

    // --- model import/export ---
    s2_import_missing_arrays: "File JSON thiếu mảng 'constructs' hoặc 'paths'.",
    s2_import_missing_fields: "Một construct trong file thiếu id/name/mode/indicators.",
    s2_import_failed: "Không nhập được mô hình: {msg}",

    // --- step 3: results (shared header) ---
    s3_path_diagram_title: "Sơ đồ đường dẫn kết quả (Path Diagram)",
    s3_path_diagram_title_cbsem: "Sơ đồ đường dẫn kết quả (Path Diagram) — CB-SEM",
    s3_dashed_hint: "Đường nét đứt = path không có ý nghĩa thống kê (p ≥ 0.05) theo kết quả Bootstrapping.",
    s3_dashed_hint_cbsem: "Hệ số hiển thị là standardized (β); đường nét đứt = không có ý nghĩa thống kê (p ≥ 0.05).",
    s3_export_excel: "📊 Xuất Excel",
    s3_export_word: "📄 Xuất Word",
    s3_sensitivity_btn: "📉 Phân tích độ nhạy cỡ mẫu",
    s3_power_btn: "⚡ Power Analysis",
    s3_plspredict_btn: "🔮 PLSpredict",
    s3_plspredict_running: "Đang chạy k-fold…",
    s3_plspredict_title: "PLSpredict — Đánh giá khả năng dự báo ngoài mẫu",
    s3_plspredict_hint: "So sánh sai số dự báo (k-fold cross-validation) của mô hình PLS với một hồi quy tuyến tính đơn giản (LM) trên cùng dữ liệu — nếu PLS không thắng được LM, mô hình có thể thiếu giá trị dự báo thực tế dù R² trong mẫu cao (Shmueli et al., 2016).",
    s3_plspredict_verdict_label: "Đánh giá",
    s3_plspredict_verdict_detail: "k={k}, n={n} quan sát, PLS thắng {wins}/{total} biến quan sát so với hồi quy LM.",
    lbl_plspredict_high: "Khả năng dự báo cao",
    lbl_plspredict_medium: "Khả năng dự báo trung bình",
    lbl_plspredict_low: "Khả năng dự báo thấp",
    lbl_plspredict_none: "Không có biến để đánh giá",
    lbl_plspredict_pls_wins: "PLS thắng",
    lbl_plspredict_lm_wins: "LM thắng",
    th_plspredict_pls_rmse: "PLS RMSE",
    th_plspredict_pls_mae: "PLS MAE",
    th_plspredict_lm_rmse: "LM RMSE",
    th_plspredict_lm_mae: "LM MAE",
    th_plspredict_result: "Kết quả",
    s3_ipma_btn: "🎯 IPMA",
    s3_ipma_hint: "Trục ngang: Importance (tổng hiệu ứng chuẩn hoá lên biến mục tiêu). Trục dọc: Performance (điểm trung bình quy về thang 0–100 theo dữ liệu quan sát). Đường chấm: giá trị trung bình — chia thành 4 vùng để xác định construct nào đáng ưu tiên cải thiện.",
    s3_ipma_target_label: "Chọn construct mục tiêu",
    s3_ipma_title: "IPMA — Mục tiêu: {target}",
    th_ipma_importance: "Importance (tổng hiệu ứng)",
    th_ipma_performance: "Performance (0–100)",
    s3_back_to_model: "← Quay lại chỉnh sửa mô hình",
    s3_generating_file: "Đang tạo file…",
    sens_modal_title: "Phân tích độ nhạy theo cỡ mẫu",
    sens_modal_hint: "Chạy lại mô hình nhiều lần, mỗi lần bỏ ngẫu nhiên thêm N quan sát so với lần trước, đến khi số quan sát còn khoảng 20 — giúp đánh giá cỡ mẫu tối thiểu và độ ổn định của kết quả. Dữ liệu hiện có {n} quan sát.",
    sens_modal_step_label: "N — số quan sát giảm thêm mỗi bước",
    sens_modal_run: "Chạy phân tích",
    sens_modal_invalid_step: "N phải là số nguyên dương.",

    // --- sensitivity.html (opens in a new tab) ---
    sens_page_title: "Phân tích độ nhạy theo cỡ mẫu",
    sens_close_tab: "✕ Đóng tab này",
    sens_loading: "Đang chạy lại mô hình với các cỡ mẫu khác nhau…",
    sens_no_job: "Không tìm thấy yêu cầu phân tích — hãy mở trang này từ nút \"Phân tích độ nhạy cỡ mẫu\" ở trang kết quả.",
    sens_failed: "Phân tích độ nhạy thất bại.",
    sens_summary_title: "Tổng quan",
    sens_summary_text: "Phương pháp: {method} · Dữ liệu gốc: {n0} quan sát · Giảm N={step} quan sát mỗi bước · {count} bước đã chạy (n từ {minN} đến {n0}) · {conv}/{count} bước hội tụ.",
    sens_r2_chart_title: "R² theo cỡ mẫu (biến nội sinh)",
    sens_chart_hint: "Di chuột vào biểu đồ để xem giá trị chính xác tại từng cỡ mẫu. Điểm viền đỏ = mô hình không hội tụ ở cỡ mẫu đó.",
    sens_path_chart_title: "Hệ số đường dẫn (Path Coefficients) theo cỡ mẫu",
    sens_table_title: "Bảng số liệu chi tiết",
    sens_th_n: "n (quan sát)",
    sens_th_converged: "Hội tụ",
    sens_yes: "Có",
    sens_no: "Không",
    sens_axis_n: "n",
    sens_axis_coef: "Hệ số",
    sens_not_converged_short: "không hội tụ",
    sens_guide_section_title: "Hướng dẫn đọc & Ý nghĩa các chỉ số",
    sens_guide_what_summary: "Sample Size Sensitivity là gì?",
    sens_guide_what_body:
      "<p>Kiểm tra độ ổn định của các ước lượng (R², path coefficient) khi cỡ mẫu <strong>thật</strong> giảm dần — bằng cách lấy ngẫu nhiên bớt quan sát từ chính dữ liệu bạn đã upload rồi chạy lại mô hình nhiều lần. Trả lời câu hỏi: <strong>\"Nếu tôi có ít dữ liệu hơn, kết quả có còn ổn định/hội tụ không?\"</strong></p>" +
      "<p>Công cụ này hữu ích để đánh giá độ nhạy của kết quả hiện tại với cỡ mẫu — <strong>không phải</strong> để tính xác suất phát hiện hiệu ứng hay xác định cỡ mẫu cần thu thập trước khi khảo sát (đó là việc của <em>Power Analysis</em>, một công cụ mô phỏng dữ liệu hoàn toàn mới từ mô hình quần thể giả định, khác về bản chất với việc bớt dần dữ liệu thật ở đây).</p>",
    sens_guide_read_summary: "Cách đọc biểu đồ & bảng số liệu",
    sens_guide_read_body:
      "<ul>" +
      "<li><strong>Trục hoành (n):</strong> cỡ mẫu tại mỗi bước, giảm dần từ tổng số quan sát ban đầu.</li>" +
      "<li><strong>Biểu đồ R²:</strong> R² của từng biến nội sinh thay đổi thế nào khi cỡ mẫu giảm.</li>" +
      "<li><strong>Biểu đồ Path Coefficients:</strong> từng hệ số đường dẫn thay đổi ra sao khi cỡ mẫu giảm.</li>" +
      "<li><strong>Điểm viền đỏ:</strong> mô hình không hội tụ ở cỡ mẫu đó — dấu hiệu cỡ mẫu đã quá nhỏ để ước lượng ổn định.</li>" +
      "<li><strong>Bảng chi tiết:</strong> liệt kê từng cỡ mẫu đã chạy, có hội tụ hay không, cùng R² và path coefficient tương ứng tại điểm đó.</li>" +
      "</ul>",
    sens_guide_limits_summary: "Giới hạn",
    sens_guide_limits_body:
      "<ul>" +
      "<li>Mỗi cỡ mẫu chỉ được lấy mẫu con <strong>một lần</strong> (không lặp lại nhiều lần như mô phỏng Monte Carlo), nên một phần dao động giữa các điểm liền kề đến từ nhiễu ngẫu nhiên của riêng lần lấy mẫu đó, không hẳn phản ánh một xu hướng thật đang diễn ra.</li>" +
      "<li>Đây là phân tích trên dữ liệu đã có sẵn — không cho biết cỡ mẫu bạn <strong>nên</strong> thu thập nếu chưa khảo sát; muốn trả lời câu hỏi đó, dùng Power Analysis ở trang kết quả.</li>" +
      "</ul>",

    // --- power_analysis.html (opens in a new tab) ---
    power_page_title: "Phân tích lũy thừa thống kê (Power Analysis)",
    power_loading: "Đang mô phỏng Monte Carlo — có thể mất một lúc…",
    power_no_job: "Không tìm thấy yêu cầu phân tích — hãy mở trang này từ nút \"Power Analysis\" ở trang kết quả.",
    power_failed: "Power Analysis thất bại.",
    power_summary_title: "Tổng quan",
    power_method_hint: "Mỗi điểm mô phỏng: sinh dữ liệu tổng hợp từ mô hình quần thể đã khai báo (path coefficient & loading kỳ vọng), chạy PLS-SEM + Bootstrap, rồi tính tỉ lệ số lần path có ý nghĩa thống kê (p < 0.05) trên tổng số lần lặp hội tụ. Giả định các construct ngoại sinh độc lập nhau (Aguirre-Urreta & Rönkkö, 2015).",
    power_summary_text: "{nPaths} đường dẫn · {nSizes} cỡ mẫu được kiểm tra · {nMc} lần lặp Monte Carlo/cỡ mẫu · {nBoot} lần bootstrap/lần lặp · Cỡ mẫu tối thiểu đạt lũy thừa 80%: {minN}.",
    power_chart_title: "Đường cong lũy thừa (Power) theo cỡ mẫu",
    power_chart_hint: "Di chuột vào biểu đồ để xem giá trị chính xác. Đường nét đứt ngang = ngưỡng 80% (quy ước thông thường). Bấm vào chú thích để ẩn/hiện từng đường.",
    power_table_title: "Bảng số liệu chi tiết",
    power_not_reached: "chưa đạt",
    power_axis_n: "n",
    power_axis_power: "Power (%)",
    power_th_n: "n (quan sát)",
    power_th_path: "Đường dẫn",
    power_th_power: "Power",
    power_th_converged: "Hội tụ / Tổng lần lặp",
    power_th_mean_estimate: "Hệ số ước lượng TB",
    power_modal_title: "Cấu hình Power Analysis",
    power_modal_hint: "Khai báo path coefficient và loading kỳ vọng (mô hình quần thể), rồi chọn khoảng cỡ mẫu cần kiểm tra. Mặc định lấy từ kết quả phân tích gần nhất (có thể chỉnh sửa).",
    power_modal_paths_title: "Path coefficient kỳ vọng",
    power_modal_loadings_title: "Loading kỳ vọng (trung bình mỗi construct)",
    power_modal_range_title: "Khoảng cỡ mẫu",
    power_modal_from: "Từ",
    power_modal_to: "Đến",
    power_modal_step: "Bước nhảy",
    power_modal_advanced: "Tùy chọn nâng cao",
    power_modal_n_mc: "Số lần lặp Monte Carlo / cỡ mẫu",
    power_modal_n_boot: "Số lần bootstrap / lần lặp",
    power_modal_n_mc_hint: "Cao hơn = đường cong mượt hơn nhưng chạy lâu hơn.",
    power_modal_estimate: "Ước tính thời gian chạy: ~{sec} giây ({points} cỡ mẫu × {mc} lần lặp).",
    power_modal_run: "Chạy mô phỏng",
    power_modal_invalid: "Vui lòng kiểm tra lại các giá trị đã nhập (số dương, khoảng cỡ mẫu hợp lệ).",
    power_btn_disabled_hint: "Power Analysis chỉ hỗ trợ mô hình reflective (Mode A), không có biến điều tiết.",
    power_guide_section_title: "Hướng dẫn đọc & Ý nghĩa các chỉ số",
    power_guide_what_summary: "Power Analysis là gì và khi nào nên dùng?",
    power_guide_what_body:
      "<p>Power Analysis (dưới giả thuyết H₁) trả lời câu hỏi: <strong>\"Nếu hiệu ứng thật trong quần thể đúng bằng giá trị tôi kỳ vọng, thì với cỡ mẫu n, xác suất tôi phát hiện được hiệu ứng đó là bao nhiêu?\"</strong> Đây là công cụ dùng <strong>trước khi</strong> thu thập dữ liệu, để ước tính cỡ mẫu tối thiểu cần khảo sát — khác với hầu hết phân tích PLS-SEM khác vốn chỉ áp dụng sau khi đã có dữ liệu thật.</p>" +
      "<p>Vì PLS-SEM không có công thức power dạng đóng (closed-form), công cụ này dùng mô phỏng Monte Carlo: sinh nhiều bộ dữ liệu giả lập từ mô hình quần thể bạn khai báo, chạy PLS-SEM + Bootstrap thật trên từng bộ, rồi đếm tỉ lệ phát hiện được hiệu ứng.</p>" +
      "<p><strong>Khác với Sample Size Sensitivity:</strong> Sensitivity lấy lại dữ liệu thật đã thu thập và bỏ bớt quan sát dần — trả lời \"kết quả hiện tại ổn định đến đâu nếu tôi có ít dữ liệu hơn\". Power Analysis mô phỏng dữ liệu hoàn toàn mới từ một mô hình quần thể giả định — trả lời \"tôi cần thu thập bao nhiêu mẫu\". Hai công cụ bổ trợ nhau, không thay thế nhau.</p>",
    power_guide_read_summary: "Cách đọc biểu đồ & bảng số liệu",
    power_guide_read_body:
      "<ul>" +
      "<li><strong>Trục hoành (n):</strong> cỡ mẫu được kiểm tra.</li>" +
      "<li><strong>Trục tung (Power %):</strong> tỉ lệ % số lần mô phỏng mà path đó có ý nghĩa thống kê (p &lt; 0.05), trên tổng số lần PLS hội tụ ở cỡ mẫu đó.</li>" +
      "<li><strong>Đường nét đứt ngang ở 80%:</strong> ngưỡng quy ước (Cohen, 1988) coi là \"đủ mạnh\" — cỡ mẫu nơi đường cong của một path vượt qua ngưỡng này là gợi ý cỡ mẫu tối thiểu nên thu thập cho path đó.</li>" +
      "<li>Mỗi đường trong biểu đồ ứng với 1 đường dẫn cấu trúc — bấm vào chú thích (legend) để ẩn/hiện từng đường.</li>" +
      "<li><strong>Cột \"Hội tụ / Tổng lần lặp\":</strong> số lần PLS hội tụ trên tổng số lần mô phỏng ở cỡ mẫu đó. Tỉ lệ hội tụ thấp bất thường (thường ở n rất nhỏ) nghĩa là power ước lượng tại điểm đó kém tin cậy hơn.</li>" +
      "<li><strong>Cột \"Hệ số ước lượng TB\":</strong> trung bình path coefficient ước lượng được qua các lần mô phỏng hội tụ — nên gần với giá trị bạn khai báo làm quần thể; nếu lệch đáng kể, có thể do PLS có xu hướng làm suy giảm (attenuate) hệ số path khi số indicator/block ít.</li>" +
      "</ul>",
    power_guide_limits_summary: "Giả định & giới hạn",
    power_guide_limits_body:
      "<ul>" +
      "<li>Chỉ hỗ trợ construct reflective (Mode A); chưa hỗ trợ formative (Mode B) hoặc mô hình có biến điều tiết (moderation/interaction).</li>" +
      "<li>Giả định các construct ngoại sinh độc lập với nhau (Aguirre-Urreta & Rönkkö, 2015) — nếu quần thể thật có tương quan mạnh giữa các biến ngoại sinh, kết quả có thể lệch.</li>" +
      "<li>Mỗi construct dùng một giá trị loading trung bình áp cho tất cả indicator của nó, thay vì khai báo riêng từng indicator.</li>" +
      "<li>Kết quả phụ thuộc hoàn toàn vào giá trị path coefficient/loading kỳ vọng bạn khai báo — đây là mô phỏng dựa trên giả định của bạn, không phải \"sự thật\". Nên thử vài kịch bản khác nhau (lạc quan/thận trọng) để có bức tranh đầy đủ hơn.</li>" +
      "<li>Số lần lặp Monte Carlo càng thấp, đường cong càng nhiễu (dao động ngẫu nhiên do lấy mẫu) — tăng lên nếu cần đường cong mượt hơn, đổi lại thời gian chạy lâu hơn.</li>" +
      "</ul>",
    s3_export_failed: "Xuất báo cáo thất bại.",
    s3_loading_pls_boot: "Đang ước lượng mô hình và chạy Bootstrapping ({n} lần lặp — có thể mất vài chục giây)…",
    s3_loading_pls: "Đang ước lượng mô hình…",
    s3_loading_cbsem: "Đang ước lượng CB-SEM (Maximum Likelihood)…",
    s3_analyze_failed: "Phân tích thất bại.",

    // --- step 3: PLS result cards ---
    s3_reliability_title: "Độ tin cậy & giá trị hội tụ (Reflective)",
    s3_loadings_title: "Hệ số tải ngoài (Outer Loadings)",
    s3_cross_loadings_title: "Cross Loadings",
    s3_cross_loadings_hint: "Mỗi indicator nên tải cao nhất lên construct của chính nó.",
    s3_fl_title: "Giá trị phân biệt — Fornell-Larcker",
    s3_htmt_title: "Giá trị phân biệt — HTMT",
    s3_path_title: "Mô hình cấu trúc — Path Coefficients & f²",
    s3_total_effects_title: "Total & Indirect Effects (Kiểm định Mediation)",
    s3_total_effects_hint: "Hiệu ứng gián tiếp = tổng tích các hệ số path dọc theo mọi đường đi qua biến trung gian (mediator); hiệu ứng tổng = trực tiếp + gián tiếp.",
    s3_specific_indirect_title: "Hiệu ứng gián tiếp cụ thể (Specific Indirect Effects)",
    s3_specific_indirect_hint: "Mỗi dòng là một đường đi trung gian cụ thể — khác với bảng Total & Indirect Effects vốn cộng gộp tất cả đường đi giữa một cặp construct. Nếu đã bootstrap, ý nghĩa thống kê được kiểm định trực tiếp trên tích của đúng lần lấy mẫu lại đó.",
    s3_r2q2_title: "R² & Q² của biến nội sinh (Predictive Relevance)",
    s3_vif_title: "Đa cộng tuyến (VIF)",
    s3_cmb_title: "Common Method Bias — Full Collinearity Test",
    s3_cmb_hint: "Mỗi construct hồi quy trên TẤT CẢ construct còn lại (không chỉ predictor trực tiếp) — kỹ thuật WarpPLS (Kock, 2015). Mọi VIF ≤ {threshold} nghĩa là mô hình không có dấu hiệu CMB.",
    s3_bootstrap_dist_title: "Phân phối Bootstrap theo Path Coefficient",
    s3_bootstrap_dist_hint: "Phân phối của {n} mẫu bootstrap hợp lệ cho từng hệ số đường dẫn. Vạch xanh liền = giá trị ước lượng gốc; vạch đỏ đứt = khoảng tin cậy 95%.",
    lbl_bootstrap_hist_stats: "Gốc: {orig} · KTC 95%: [{lo}, {hi}]",
    s3_slopes_title: "Biểu đồ độ dốc đơn giản (Simple Slopes)",
    s3_slopes_hint: "Quan hệ giữa biến độc lập và biến kết quả tại ba mức của biến điều tiết (−1SD, Trung bình, +1SD), tính từ các hệ số path chuẩn hoá của chính lần chạy này (Aiken & West, 1991). Bấm \"⇄\" để đổi trục.",
    s3_slopes_swap: "Đổi trục",
    s3_slopes_low: "{name} tại −1 SD",
    s3_slopes_mean: "{name} tại Trung bình",
    s3_slopes_high: "{name} tại +1 SD",

    // --- step 3: CB-SEM result cards ---
    cbsem_fit_title: "Model Fit",
    cbsem_reliability_title: "Độ tin cậy & giá trị hội tụ",
    cbsem_loadings_title: "Factor Loadings",
    cbsem_path_title: "Mô hình cấu trúc — Path Coefficients",
    cbsem_r2_title: "R² của biến nội sinh",
    cbsem_r2_hint: "Đã hiệu chỉnh sai lệch đo lường — thường cao hơn R² của PLS-SEM trên cùng dữ liệu.",

    // --- convergence info ---
    conv_converged: "Đã hội tụ",
    conv_not_converged: "CHƯA hội tụ",
    conv_after_iterations: "sau {n} vòng lặp",
    conv_n_obs: "n = {n} quan sát hợp lệ.",
    conv_bootstrap: "Bootstrapping: {valid}/{requested} mẫu hợp lệ.",
    conv_cbsem_after: "({msg}) sau {n} vòng lặp",

    // --- table headers (shared) ---
    th_construct: "Construct",
    th_endogenous_construct: "Construct nội sinh",
    th_indicator: "Indicator",
    th_outer_loading: "Outer Loading",
    th_outer_weight: "Outer Weight",
    th_stdev: "STDEV",
    th_t_stat: "T Statistics",
    th_p_value: "P Values",
    th_significance: "Ý nghĩa (95%)",
    th_note: "Ghi chú",
    th_path: "Đường dẫn",
    th_path_coefficient: "Path Coefficient (β)",
    th_direct_effect: "Hiệu ứng trực tiếp",
    th_indirect_effect: "Hiệu ứng gián tiếp",
    th_total_effect: "Hiệu ứng tổng",
    th_f_squared: "f²",
    th_f2_effect: "Mức ảnh hưởng f²",
    th_r2: "R²",
    th_r2_adj: "R² hiệu chỉnh",
    th_r2_assessment: "Đánh giá R²",
    th_q2: "Q² (blindfolding, D={d})",
    th_q2_assessment: "Đánh giá Q²",
    th_pair: "Cặp",
    th_vif: "VIF",
    th_assessment: "Đánh giá",
    th_cronbachs_alpha: "Cronbach's α",
    th_rho_a: "rho_A",
    th_composite_reliability: "Composite Reliability",
    th_ave: "AVE",
    th_unstd: "Unstd.",
    th_std_lambda: "Std. (λ)",
    th_std_beta: "Std. (β)",
    th_unstd_b: "Unstd. (B)",
    th_se: "SE",
    th_z: "z",
    th_p: "p",
    th_fit_index: "Chỉ số",
    th_value: "Giá trị",

    // --- labels / verdicts ---
    lbl_dash: "—",
    lbl_r2_weak: "Yếu",
    lbl_r2_moderate: "Trung bình",
    lbl_r2_substantial: "Khá mạnh",
    lbl_r2_strong: "Mạnh",
    lbl_f2_none: "Không đáng kể",
    lbl_f2_small: "Nhỏ",
    lbl_f2_medium: "Trung bình",
    lbl_f2_large: "Lớn",
    lbl_moderation_badge: "Điều tiết",
    lbl_htmt_good: "< {v} — đạt giá trị phân biệt",
    lbl_htmt_warn: "{a}–{b} — ranh giới, cần xem xét",
    lbl_htmt_critical: "≥ {v} — có thể vi phạm giá trị phân biệt",

    // --- computation transparency section ---
    src_transparency_title: "Minh bạch tính toán (Computation Transparency)",
    src_transparency_hint: "Mã nguồn Python thật sự đã chạy để tính ra các kết quả ở trên, lấy trực tiếp từ mã đang chạy trên server (không phải bản sao chép tay).",
    src_section_core_algorithm: "Thuật toán ước lượng cốt lõi",
    src_section_measurement_metrics: "Độ tin cậy & giá trị hội tụ/phân biệt (rho_A, CR, AVE, HTMT, f²)",
    src_section_cmb: "Common Method Bias (Full Collinearity VIF)",
    src_section_mediation: "Hiệu ứng trung gian (Total & Indirect Effects)",
    src_section_moderation: "Biến điều tiết (Moderation)",
    src_section_bootstrap: "Bootstrapping (kiểm định ý nghĩa thống kê)",
    src_section_blindfolding: "Blindfolding (Q² — predictive relevance)",

    // --- results reading guide (bottom of PLS-SEM / CB-SEM results pages) ---
    results_guide_section_title: "Hướng dẫn đọc & Ý nghĩa các chỉ số",
    results_guide_measurement_summary: "Mô hình đo lường (Outer Model)",
    results_guide_measurement_body:
      "<ul>" +
      "<li><strong>Outer Loadings:</strong> tương quan giữa mỗi indicator và construct chứa nó. Với construct reflective, nên ≥0.7; 0.4–0.7 có thể cân nhắc loại bỏ nếu việc loại không làm giảm AVE/độ tin cậy. <strong>Cross Loadings</strong> cho thấy mỗi indicator nên tải cao nhất lên đúng construct của chính nó, không phải construct khác.</li>" +
      "<li><strong>Cronbach's Alpha, rho_A, Composite Reliability (CR):</strong> đo độ tin cậy nhất quán nội bộ — thường xem ≥0.7 là chấp nhận được (0.6–0.7 có thể chấp nhận ở nghiên cứu khám phá).</li>" +
      "<li><strong>AVE (Average Variance Extracted):</strong> đo giá trị hội tụ — nên ≥0.5 (construct giải thích được ít nhất 50% phương sai của các indicator của nó).</li>" +
      "</ul>",
    results_guide_discriminant_summary: "Giá trị phân biệt (Discriminant Validity)",
    results_guide_discriminant_body:
      "<ul>" +
      "<li><strong>Fornell-Larcker:</strong> căn bậc hai AVE trên đường chéo nên lớn hơn tương quan giữa construct đó với bất kỳ construct nào khác.</li>" +
      "<li><strong>HTMT (Heterotrait-Monotrait Ratio):</strong> nên &lt;0.85 (khắt khe) hoặc &lt;0.90 (khi các construct gần nhau về khái niệm) theo Henseler et al. (2015); ≥0.90 là dấu hiệu vi phạm giá trị phân biệt.</li>" +
      "</ul>",
    results_guide_structural_summary: "Mô hình cấu trúc — Path Coefficients",
    results_guide_structural_body:
      "<ul>" +
      "<li><strong>Path coefficient (β chuẩn hoá):</strong> dấu (+/−) và độ lớn thể hiện chiều và cường độ quan hệ giữa hai construct.</li>" +
      "<li>Nếu đã bật <strong>Bootstrapping</strong>: các cột STDEV / T-Statistics / P-Values / Ý nghĩa cho biết path có ý nghĩa thống kê khi p &lt; 0.05 (tương đương |T| &gt; 1.96 với kiểm định 2 đuôi).</li>" +
      "<li><strong>f² (effect size):</strong> &lt;0.02 không đáng kể, 0.02–0.15 nhỏ, 0.15–0.35 vừa, ≥0.35 lớn (Cohen, 1988). Riêng path từ biến điều tiết (interaction) dùng ngưỡng nhỏ hơn nhiều: 0.005/0.01/0.025 (Kenny 2018; Aguinis et al. 2005).</li>" +
      "</ul>",
    results_guide_mediation_summary: "Hiệu ứng trung gian (Mediation)",
    results_guide_mediation_body:
      "<ul>" +
      "<li><strong>Total &amp; Indirect Effects:</strong> hiệu ứng gián tiếp = tổng tích các path coefficient dọc theo <em>mọi</em> đường đi qua biến trung gian, giữa một cặp construct; hiệu ứng tổng = trực tiếp + gián tiếp.</li>" +
      "<li><strong>Specific Indirect Effects:</strong> tách riêng <em>từng</em> đường đi trung gian cụ thể (thay vì cộng gộp như bảng trên) — nếu đã bootstrap, mỗi đường đi cũng được kiểm định ý nghĩa thống kê riêng, dựa trên đúng tích số của các hệ số trong cùng một lần lấy mẫu lại.</li>" +
      "</ul>",
    results_guide_predictive_summary: "R², Q² & Đa cộng tuyến (VIF)",
    results_guide_predictive_body:
      "<ul>" +
      "<li><strong>R²:</strong> 0.19 yếu, 0.33 trung bình, 0.67 mạnh (Chin, 1998) — chỉ là ngưỡng tham khảo, tùy lĩnh vực nghiên cứu.</li>" +
      "<li><strong>Q² (Predictive Relevance, từ Blindfolding):</strong> &gt;0 nghĩa là mô hình có khả năng dự báo ngoài mẫu cho construct đó; ≤0 nghĩa là không.</li>" +
      "<li><strong>VIF (Inner/Outer):</strong> nên &lt;3.3 (hoặc &lt;5 nếu nới lỏng hơn) để tránh đa cộng tuyến làm méo các hệ số ước lượng.</li>" +
      "</ul>",
    results_guide_cmb_summary: "Common Method Bias",
    results_guide_cmb_body:
      "<p>Full collinearity VIF (Kock, 2015): mỗi construct được hồi quy trên <strong>tất cả</strong> construct còn lại trong mô hình, không chỉ predictor trực tiếp của nó. VIF ≤ ngưỡng (mặc định 3.3) nghĩa là không có dấu hiệu common method bias đáng kể.</p>",
    results_guide_slopes_summary: "Simple Slopes (khi có biến điều tiết)",
    results_guide_slopes_body:
      "<p>Ba đường tại −1SD / Trung bình / +1SD của biến điều tiết cho thấy quan hệ giữa biến độc lập và biến kết quả thay đổi ra sao theo mức độ của biến điều tiết (Aiken &amp; West, 1991). Ba đường càng tách xa nhau (không song song) → tương tác càng mạnh; ba đường gần như song song → tương tác yếu, dù hệ số path của interaction có ý nghĩa thống kê hay không.</p>",
    results_guide_bootstrap_dist_summary: "Phân phối Bootstrap (khi đã bật Bootstrapping)",
    results_guide_bootstrap_dist_body:
      "<p>Mỗi biểu đồ là phân phối của một hệ số path qua toàn bộ số lần lấy mẫu lại (resample). Vạch xanh liền = giá trị ước lượng gốc; vạch đỏ đứt = khoảng tin cậy 95% (percentile). Nếu khoảng tin cậy 95% không chứa 0, path đó có ý nghĩa thống kê.</p>",
    cbsem_guide_fit_summary: "Model Fit",
    cbsem_guide_fit_body:
      "<ul>" +
      "<li><strong>Chi-square / df:</strong> càng nhỏ càng tốt — thường χ²/df &lt; 3 được xem là chấp nhận được.</li>" +
      "<li><strong>CFI, TLI:</strong> ≥0.90 chấp nhận được, ≥0.95 tốt.</li>" +
      "<li><strong>RMSEA:</strong> ≤0.08 chấp nhận được, ≤0.05 tốt.</li>" +
      "<li><strong>SRMR:</strong> ≤0.08 chấp nhận được.</li>" +
      "<li>Đây chỉ là ngưỡng tham khảo — nên xem xét nhiều chỉ số cùng lúc, không dựa hoàn toàn vào một chỉ số riêng lẻ.</li>" +
      "</ul>",
    cbsem_guide_measurement_body:
      "<ul>" +
      "<li><strong>Cronbach's Alpha, Composite Reliability (CR), AVE:</strong> ngưỡng tham khảo giống PLS-SEM — CR ≥0.7, AVE ≥0.5.</li>" +
      "<li><strong>Factor Loadings:</strong> cột Unstd./Std./SE/z/p — ý nghĩa thống kê dựa trên kiểm định z (Wald test) từ ước lượng Maximum Likelihood, khác với PLS-SEM (vốn luôn cần Bootstrap vì không có công thức sai số chuẩn dạng đóng).</li>" +
      "</ul>",
    cbsem_guide_structural_body:
      "<ul>" +
      "<li><strong>Unstd. (B):</strong> hệ số hồi quy chưa chuẩn hoá, theo đơn vị gốc của thang đo. <strong>Std. (β):</strong> hệ số đã chuẩn hoá, so sánh được giữa các path.</li>" +
      "<li><strong>SE, z, p:</strong> ý nghĩa thống kê được kiểm định bằng z-test (Wald test) trực tiếp từ ma trận hiệp phương sai ước lượng của Maximum Likelihood — không cần chạy Bootstrap như PLS-SEM. Path có ý nghĩa khi p &lt; 0.05.</li>" +
      "</ul>",
    cbsem_guide_mediation_body:
      "<ul>" +
      "<li><strong>Total &amp; Indirect Effects:</strong> hiệu ứng gián tiếp = tổng tích các path coefficient dọc theo <em>mọi</em> đường đi qua biến trung gian, giữa một cặp construct; hiệu ứng tổng = trực tiếp + gián tiếp.</li>" +
      "<li><strong>Specific Indirect Effects:</strong> tách riêng <em>từng</em> đường đi trung gian cụ thể — ở CB-SEM đây chỉ là điểm ước lượng (point estimate), <strong>chưa</strong> có kiểm định ý nghĩa thống kê riêng cho từng đường đi (cần một phương pháp riêng, ví dụ delta method/Sobel test, để suy ra sai số chuẩn của một tích số).</li>" +
      "</ul>",
    cbsem_guide_r2cmb_summary: "R² & Common Method Bias",
    cbsem_guide_r2cmb_body:
      "<ul>" +
      "<li><strong>R²:</strong> 0.19 yếu, 0.33 trung bình, 0.67 mạnh (Chin, 1998) — R² của CB-SEM thường cao hơn PLS-SEM trên cùng dữ liệu vì đã hiệu chỉnh sai lệch đo lường.</li>" +
      "<li><strong>Common Method Bias (Full collinearity VIF, Kock 2015):</strong> mỗi construct được hồi quy trên tất cả construct còn lại; VIF ≤ ngưỡng (mặc định 3.3) nghĩa là không có dấu hiệu common method bias đáng kể.</li>" +
      "</ul>",

    lbl_q2_none: "Không có ý nghĩa dự báo",
    lbl_significant: "p < 0.05",
    lbl_not_significant: "Không ý nghĩa",
    lbl_reference_indicator: "Biến tham chiếu",
    lbl_formative_note: "Formative (Mode B) — không áp dụng chỉ số độ tin cậy nội bộ",
    lbl_no_vif_pairs: "Không có construct nào có ≥2 tiền tố / biến formative để kiểm tra đa cộng tuyến.",
    lbl_vif_high: "Cao (>5)",
    lbl_vif_acceptable: "Chấp nhận được",
    lbl_cmb_ok: "Không có dấu hiệu CMB",
    lbl_cmb_warn: "Có khả năng bị CMB",
    lbl_fit_good: "Tốt",
    lbl_fit_acceptable: "Chấp nhận được",
    lbl_fit_poor: "Chưa đạt",
    suffix_structural: " (cấu trúc)",
    suffix_formative_measurement: " (đo lường formative)",

    // --- CB-SEM fit index labels ---
    fit_chi_square: "Chi-square (χ²)",
    fit_df: "Degrees of Freedom (df)",
    fit_chi2_p: "χ² p-value",
    fit_cfi: "CFI",
    fit_tli: "TLI",
    fit_rmsea: "RMSEA",
    fit_srmr: "SRMR",
    fit_gfi: "GFI",
    fit_agfi: "AGFI",
    fit_nfi: "NFI",
    fit_aic: "AIC",
    fit_bic: "BIC",

    // --- diagram.js ---
    diagram_reflective: "Reflective",
    diagram_formative: "Formative",
  },

  en: {
    nav_step1: "1. Data",
    nav_step2: "2. Model",
    nav_step3: "3. Results",
    nav_sample: "Use sample data",
    nav_sample_moderation: "Sample data (Mediator + Moderator)",
    nav_guide: "📖 User Guide",

    s1_title: "Upload survey data",
    s1_hint: "Supports CSV or Excel (.xlsx). Each column is one indicator (item), each row is one observation. Maximum 5000 rows.",
    s1_dropzone_text: "Drag and drop a file here or",
    s1_browse: "choose a file",
    s1_preview_title: "Data preview ({rows} rows, {cols} columns)",
    s1_continue: "Continue: Build the model →",
    s1_selected_file: "Selected: {name}",
    msg_upload_failed: "Upload failed.",
    msg_sample_failed: "Could not load sample data.",

    s2_add_construct: "+ Construct",
    s2_draw_path: "↗ Draw path",
    s2_delete_selected: "🗑 Delete selection",
    s2_export_model: "⬇ Export model",
    s2_import_model: "⬆ Import model",
    s2_toolbar_hint_default: 'Double-click the canvas or click "+ Construct" to add a latent variable.',
    s2_toolbar_hint_path_mode: "Click the source construct then the target construct to draw a structural path.",

    s2_method_title: "Estimation method",
    s2_method_pls: "PLS-SEM (Partial Least Squares)",
    s2_method_cbsem: "CB-SEM (Maximum Likelihood / Covariance-Based)",
    s2_method_hint_pls: "Composite-based, suits non-normal data/small samples, supports formative constructs.",
    s2_method_hint_cbsem: "Covariance-based (Maximum Likelihood): provides model fit indices (CFI, RMSEA, SRMR...) and significance testing directly, but only supports reflective constructs.",
    s2_construct_props: "Construct Properties",
    s2_no_selection: "Select a construct on the canvas to edit it.",
    s2_construct_name: "Construct name",
    s2_measurement_type: "Measurement type",
    s2_mode_reflective: "Reflective (Mode A)",
    s2_mode_formative: "Formative (Mode B)",
    s2_mode_interaction: "Interaction / moderation term (A × B)",
    s2_indicators_label: "Indicators",
    s2_interaction_sources_label: "Interaction term sources (pick 2 constructs)",
    s2_interaction_source_a: "Construct A",
    s2_interaction_source_b: "Construct B",
    s2_interaction_not_enough: "Need at least 2 other constructs (not themselves interaction terms) to create an interaction term.",
    s2_interaction_same_source: "The two source constructs must be different.",
    s2_calc_method_label: "Calculation Method",
    s2_calc_method_product_indicator: "Product Indicator",
    s2_calc_method_two_stage: "Two Stage",
    s2_calc_method_orthogonalization: "Orthogonalization",
    s2_calc_method_cbsem_note: "Note: CB-SEM always uses Two Stage regardless of this setting (Product Indicator/Orthogonalization only apply to PLS-SEM).",
    s2_product_term_label: "Product Term Generation (Advanced Settings)",
    s2_product_term_unstandardized: "Unstandardized",
    s2_product_term_mean_centered: "Mean Centered",
    s2_product_term_standardized: "Standardized",
    s2_product_term_two_stage_note: "Two Stage always multiplies two stage-1 factor scores — which are already standardized by definition (Henseler & Chin, 2010) — so there's no other choice to make here.",
    s2_model_overview: "Model Overview",
    s2_bootstrapping: "Bootstrapping",
    s2_bootstrap_enable: "Significance testing (t-values, p-values)",
    s2_bootstrap_reps_label: "Number of resamples",
    s2_bootstrap_100: "100 (fast)",
    s2_bootstrap_500: "500 (recommended)",
    s2_bootstrap_1000: "1000",
    s2_bootstrap_2000: "2000",
    s2_bootstrap_5000: "5000 (slow, ~30-60s)",
    s2_bootstrap_hint: "Bootstrapping draws many resamples from the original data to estimate the standard deviation, t-value and p-value for each path coefficient — needed to report statistical significance (p < 0.05) in research.",
    s2_cbsem_note: "CB-SEM already computes SE/z-value/p-value via Maximum Likelihood — bootstrapping is not needed.",
    s2_run_pls: "▶ Run PLS Algorithm",
    s2_run_cbsem: "▶ Run CB-SEM (ML)",

    s2_summary_reflective: "Reflective",
    s2_summary_formative: "Formative",
    s2_summary_interaction: "Interaction term",
    s2_summary_item_suffix: "item(s)",
    s2_summary_paths_suffix: "structural path(s)",
    s2_summary_toggle_aria: "Show/hide indicators",
    s2_path_rejected: "This path can't be created (duplicate, reverse of an existing one, or would create a cycle).",

    modal_title: "Add New Construct",
    modal_name_label: "Construct name",
    modal_name_placeholder: "e.g. Satisfaction",
    modal_mode_label: "Measurement type",
    modal_cancel: "Cancel",
    modal_add: "Add",

    s2_import_missing_arrays: "The JSON file is missing the 'constructs' or 'paths' array.",
    s2_import_missing_fields: "A construct in the file is missing id/name/mode/indicators.",
    s2_import_failed: "Could not import the model: {msg}",

    s3_path_diagram_title: "Result Path Diagram",
    s3_path_diagram_title_cbsem: "Result Path Diagram — CB-SEM",
    s3_dashed_hint: "Dashed line = path not statistically significant (p ≥ 0.05) per the Bootstrapping result.",
    s3_dashed_hint_cbsem: "Coefficients shown are standardized (β); dashed line = not statistically significant (p ≥ 0.05).",
    s3_export_excel: "📊 Export Excel",
    s3_export_word: "📄 Export Word",
    s3_sensitivity_btn: "📉 Sample Size Sensitivity",
    s3_power_btn: "⚡ Power Analysis",
    s3_plspredict_btn: "🔮 PLSpredict",
    s3_plspredict_running: "Running k-fold…",
    s3_plspredict_title: "PLSpredict — Out-of-Sample Predictive Validity",
    s3_plspredict_hint: "Compares the PLS model's k-fold cross-validated prediction error against a simple linear regression (LM) benchmark on the same data — if PLS can't beat LM, the model may lack real predictive value even with a high in-sample R² (Shmueli et al., 2016).",
    s3_plspredict_verdict_label: "Verdict",
    s3_plspredict_verdict_detail: "k={k}, n={n} observations, PLS beats the LM benchmark on {wins}/{total} indicators.",
    lbl_plspredict_high: "High predictive power",
    lbl_plspredict_medium: "Medium predictive power",
    lbl_plspredict_low: "Low predictive power",
    lbl_plspredict_none: "No indicators to assess",
    lbl_plspredict_pls_wins: "PLS wins",
    lbl_plspredict_lm_wins: "LM wins",
    th_plspredict_pls_rmse: "PLS RMSE",
    th_plspredict_pls_mae: "PLS MAE",
    th_plspredict_lm_rmse: "LM RMSE",
    th_plspredict_lm_mae: "LM MAE",
    th_plspredict_result: "Result",
    s3_ipma_btn: "🎯 IPMA",
    s3_ipma_hint: "X-axis: Importance (standardized total effect on the target). Y-axis: Performance (average score rescaled to 0–100 from the observed data). Dotted lines: the mean of each — dividing the chart into 4 zones to spot which constructs are worth prioritizing.",
    s3_ipma_target_label: "Choose the target construct",
    s3_ipma_title: "IPMA — Target: {target}",
    th_ipma_importance: "Importance (total effect)",
    th_ipma_performance: "Performance (0–100)",
    s3_back_to_model: "← Back to model editing",
    s3_generating_file: "Generating file…",
    sens_modal_title: "Sample Size Sensitivity Analysis",
    sens_modal_hint: "Re-runs the model repeatedly, each time randomly dropping N more observations than the last, until about 20 remain — helps gauge the minimum viable sample size and how stable the results are. The data currently has {n} observations.",
    sens_modal_step_label: "N — observations dropped per additional step",
    sens_modal_run: "Run analysis",
    sens_modal_invalid_step: "N must be a positive integer.",

    // --- sensitivity.html (opens in a new tab) ---
    sens_page_title: "Sample Size Sensitivity Analysis",
    sens_close_tab: "✕ Close this tab",
    sens_loading: "Re-running the model at different sample sizes…",
    sens_no_job: "No analysis request found — open this page from the \"Sample Size Sensitivity\" button on the results page.",
    sens_failed: "Sensitivity analysis failed.",
    sens_summary_title: "Overview",
    sens_summary_text: "Method: {method} · Original data: {n0} observations · Drops N={step} more observations per step · {count} steps ran (n from {minN} to {n0}) · {conv}/{count} steps converged.",
    sens_r2_chart_title: "R² by sample size (endogenous constructs)",
    sens_chart_hint: "Hover the chart to see the exact value at each sample size. Red-ringed points = the model did not converge at that sample size.",
    sens_path_chart_title: "Path coefficients by sample size",
    sens_table_title: "Detailed data table",
    sens_th_n: "n (observations)",
    sens_th_converged: "Converged",
    sens_yes: "Yes",
    sens_no: "No",
    sens_axis_n: "n",
    sens_axis_coef: "Coefficient",
    sens_not_converged_short: "not converged",
    sens_guide_section_title: "Reading Guide & What the Numbers Mean",
    sens_guide_what_summary: "What is Sample Size Sensitivity?",
    sens_guide_what_body:
      "<p>Checks how stable the estimates (R², path coefficients) are as the <strong>real</strong> sample size shrinks — by randomly dropping observations from the data you actually uploaded and re-running the model repeatedly. It answers: <strong>\"If I had less data, would my results still be stable / would the model still converge?\"</strong></p>" +
      "<p>This tool is useful for gauging how sensitive your current results are to sample size — <strong>not</strong> for computing the probability of detecting an effect or determining how much data to collect before surveying (that's what <em>Power Analysis</em> is for — it simulates entirely new data from a hypothesized population model, fundamentally different from progressively dropping real data here).</p>",
    sens_guide_read_summary: "How to read the chart & table",
    sens_guide_read_body:
      "<ul>" +
      "<li><strong>X-axis (n):</strong> the sample size at each step, decreasing from the original total observation count.</li>" +
      "<li><strong>R² chart:</strong> how each endogenous construct's R² changes as sample size shrinks.</li>" +
      "<li><strong>Path Coefficients chart:</strong> how each structural path coefficient changes as sample size shrinks.</li>" +
      "<li><strong>Red-ringed points:</strong> the model didn't converge at that sample size — a sign the sample has become too small for stable estimation.</li>" +
      "<li><strong>Detailed table:</strong> every sample size tested, whether it converged, and the corresponding R² and path coefficients at that point.</li>" +
      "</ul>",
    sens_guide_limits_summary: "Limitations",
    sens_guide_limits_body:
      "<ul>" +
      "<li>Each sample size is subsampled just <strong>once</strong> (not repeated many times like a Monte Carlo simulation), so some of the fluctuation between neighboring points comes from that single draw's own sampling noise rather than a genuine trend.</li>" +
      "<li>This analyzes data you already have — it doesn't tell you how much data you <strong>should</strong> collect before surveying; for that, use Power Analysis on the results page.</li>" +
      "</ul>",

    // --- power_analysis.html (opens in a new tab) ---
    power_page_title: "Statistical Power Analysis",
    power_loading: "Running the Monte Carlo simulation — this may take a while…",
    power_no_job: "No analysis request found — open this page from the \"Power Analysis\" button on the results page.",
    power_failed: "Power analysis failed.",
    power_summary_title: "Overview",
    power_method_hint: "Each simulated point: generate a synthetic dataset from the declared population model (expected path coefficients & loadings), fit PLS-SEM + Bootstrap, then compute the fraction of converged replicates where the path came out significant (p < 0.05). Assumes exogenous constructs are mutually independent (Aguirre-Urreta & Rönkkö, 2015).",
    power_summary_text: "{nPaths} paths · {nSizes} sample sizes tested · {nMc} Monte Carlo replicates/size · {nBoot} bootstrap resamples/replicate · Minimum n reaching 80% power: {minN}.",
    power_chart_title: "Power curve by sample size",
    power_chart_hint: "Hover the chart for exact values. The dashed horizontal line marks the conventional 80% threshold. Click a legend entry to show/hide that line.",
    power_table_title: "Detailed data table",
    power_not_reached: "not reached",
    power_axis_n: "n",
    power_axis_power: "Power (%)",
    power_th_n: "n (observations)",
    power_th_path: "Path",
    power_th_power: "Power",
    power_th_converged: "Converged / Total replicates",
    power_th_mean_estimate: "Mean estimated coefficient",
    power_modal_title: "Configure Power Analysis",
    power_modal_hint: "Declare the expected path coefficients and loadings (the population model), then choose the sample-size range to test. Defaults are prefilled from your last analysis (editable).",
    power_modal_paths_title: "Expected path coefficients",
    power_modal_loadings_title: "Expected loadings (average per construct)",
    power_modal_range_title: "Sample-size range",
    power_modal_from: "From",
    power_modal_to: "To",
    power_modal_step: "Step",
    power_modal_advanced: "Advanced options",
    power_modal_n_mc: "Monte Carlo replicates / sample size",
    power_modal_n_boot: "Bootstrap resamples / replicate",
    power_modal_n_mc_hint: "Higher = a smoother curve, but slower.",
    power_modal_estimate: "Estimated runtime: ~{sec}s ({points} sample sizes × {mc} replicates).",
    power_modal_run: "Run simulation",
    power_modal_invalid: "Please check the values entered (positive numbers, a valid sample-size range).",
    power_btn_disabled_hint: "Power Analysis only supports reflective (Mode A) models with no moderation/interaction construct.",
    power_guide_section_title: "Reading Guide & What the Numbers Mean",
    power_guide_what_summary: "What is Power Analysis, and when should I use it?",
    power_guide_what_body:
      "<p>Power Analysis (under H₁) answers: <strong>\"If the true population effect equals what I expect, what's the probability that a sample of size n would let me detect it?\"</strong> It's meant to be used <strong>before</strong> collecting data, to estimate the minimum sample size worth surveying — unlike most other PLS-SEM analyses, which only apply once you already have real data.</p>" +
      "<p>Because PLS-SEM has no closed-form power formula, this tool uses Monte Carlo simulation: it generates many synthetic datasets from the population model you declare, runs a real PLS-SEM + Bootstrap fit on each one, and counts how often the effect comes out detected.</p>" +
      "<p><strong>How this differs from Sample Size Sensitivity:</strong> Sensitivity takes your real, already-collected data and progressively drops observations — answering \"how stable are my current results if I'd had less data?\" Power Analysis simulates entirely new data from a hypothesized population model — answering \"how much data do I need to collect?\" The two tools complement each other rather than replace one another.</p>",
    power_guide_read_summary: "How to read the chart & table",
    power_guide_read_body:
      "<ul>" +
      "<li><strong>X-axis (n):</strong> the sample size being tested.</li>" +
      "<li><strong>Y-axis (Power %):</strong> the percentage of simulation replicates in which that path came out statistically significant (p &lt; 0.05), out of every replicate where PLS converged at that sample size.</li>" +
      "<li><strong>The dashed horizontal line at 80%:</strong> the conventional \"adequately powered\" threshold (Cohen, 1988) — the sample size where a path's curve crosses this line is a reasonable minimum to collect for that path.</li>" +
      "<li>Each line in the chart is one structural path — click a legend entry to show/hide it.</li>" +
      "<li><strong>\"Converged / Total replicates\":</strong> how many replicates converged out of the total simulated at that sample size. An unusually low convergence rate (typically at very small n) means the power estimate at that point is less reliable.</li>" +
      "<li><strong>\"Mean estimated coefficient\":</strong> the average estimated path coefficient across converged replicates — it should sit close to the population value you declared; a large gap can reflect PLS's known tendency to attenuate path coefficients with few indicators per block.</li>" +
      "</ul>",
    power_guide_limits_summary: "Assumptions & limitations",
    power_guide_limits_body:
      "<ul>" +
      "<li>Only supports reflective (Mode A) constructs; formative (Mode B) constructs and models with a moderation/interaction construct aren't supported yet.</li>" +
      "<li>Assumes exogenous constructs are mutually independent (Aguirre-Urreta & Rönkkö, 2015) — if the real population has strongly correlated exogenous variables, results can be biased.</li>" +
      "<li>Each construct uses a single average loading applied to all of its indicators, rather than a value per indicator.</li>" +
      "<li>Results depend entirely on the expected path coefficients/loadings you declare — this is a simulation under your assumptions, not \"the truth\". Try a few scenarios (optimistic/conservative) for a fuller picture.</li>" +
      "<li>Fewer Monte Carlo replicates means a noisier curve (more random sampling fluctuation) — raise the count for a smoother curve at the cost of a longer run.</li>" +
      "</ul>",
    s3_export_failed: "Failed to export the report.",
    s3_loading_pls_boot: "Estimating the model and running Bootstrapping ({n} resamples — may take up to a minute)…",
    s3_loading_pls: "Estimating the model…",
    s3_loading_cbsem: "Estimating CB-SEM (Maximum Likelihood)…",
    s3_analyze_failed: "Analysis failed.",

    s3_reliability_title: "Reliability & Convergent Validity (Reflective)",
    s3_loadings_title: "Outer Loadings",
    s3_cross_loadings_title: "Cross Loadings",
    s3_cross_loadings_hint: "Each indicator should load highest on its own construct.",
    s3_fl_title: "Discriminant Validity — Fornell-Larcker",
    s3_htmt_title: "Discriminant Validity — HTMT",
    s3_path_title: "Structural Model — Path Coefficients & f²",
    s3_total_effects_title: "Total & Indirect Effects (Mediation Testing)",
    s3_total_effects_hint: "Indirect effect = sum of the products of path coefficients along every route through a mediator construct; total effect = direct + indirect.",
    s3_specific_indirect_title: "Specific Indirect Effects",
    s3_specific_indirect_hint: "Each row is one specific mediated route — unlike the Total & Indirect Effects table, which sums every route between a construct pair. When bootstrapping was run, significance is tested directly on that same per-resample product.",
    s3_r2q2_title: "R² & Q² of Endogenous Constructs (Predictive Relevance)",
    s3_vif_title: "Collinearity (VIF)",
    s3_cmb_title: "Common Method Bias — Full Collinearity Test",
    s3_cmb_hint: "Each construct is regressed on ALL other constructs (not just direct predictors) — the WarpPLS technique (Kock, 2015). Every VIF <= {threshold} means the model shows no sign of CMB.",
    s3_bootstrap_dist_title: "Bootstrap Distributions by Path Coefficient",
    s3_bootstrap_dist_hint: "Distribution of {n} valid bootstrap samples for each path coefficient. Solid blue line = original estimate; dashed red lines = 95% confidence interval.",
    lbl_bootstrap_hist_stats: "Original: {orig} · 95% CI: [{lo}, {hi}]",
    s3_slopes_title: "Simple Slopes Chart",
    s3_slopes_hint: "The relationship between the independent variable and the outcome at three levels of the moderator (−1SD, Mean, +1SD), computed from this run's own standardized path coefficients (Aiken & West, 1991). Click \"⇄\" to swap axes.",
    s3_slopes_swap: "Swap axes",
    s3_slopes_low: "{name} at −1 SD",
    s3_slopes_mean: "{name} at Mean",
    s3_slopes_high: "{name} at +1 SD",

    cbsem_fit_title: "Model Fit",
    cbsem_reliability_title: "Reliability & Convergent Validity",
    cbsem_loadings_title: "Factor Loadings",
    cbsem_path_title: "Structural Model — Path Coefficients",
    cbsem_r2_title: "R² of Endogenous Constructs",
    cbsem_r2_hint: "Corrected for measurement error — typically higher than PLS-SEM's R² on the same data.",

    conv_converged: "Converged",
    conv_not_converged: "NOT converged",
    conv_after_iterations: "after {n} iterations",
    conv_n_obs: "n = {n} valid observations.",
    conv_bootstrap: "Bootstrapping: {valid}/{requested} valid samples.",
    conv_cbsem_after: "({msg}) after {n} iterations",

    th_construct: "Construct",
    th_endogenous_construct: "Endogenous Construct",
    th_indicator: "Indicator",
    th_outer_loading: "Outer Loading",
    th_outer_weight: "Outer Weight",
    th_stdev: "STDEV",
    th_t_stat: "T Statistics",
    th_p_value: "P Values",
    th_significance: "Significance (95%)",
    th_note: "Note",
    th_path: "Path",
    th_path_coefficient: "Path Coefficient (β)",
    th_direct_effect: "Direct Effect",
    th_indirect_effect: "Indirect Effect",
    th_total_effect: "Total Effect",
    th_f_squared: "f²",
    th_f2_effect: "f² Effect Size",
    th_r2: "R²",
    th_r2_adj: "Adjusted R²",
    th_r2_assessment: "R² Assessment",
    th_q2: "Q² (blindfolding, D={d})",
    th_q2_assessment: "Q² Assessment",
    th_pair: "Pair",
    th_vif: "VIF",
    th_assessment: "Assessment",
    th_cronbachs_alpha: "Cronbach's α",
    th_rho_a: "rho_A",
    th_composite_reliability: "Composite Reliability",
    th_ave: "AVE",
    th_unstd: "Unstd.",
    th_std_lambda: "Std. (λ)",
    th_std_beta: "Std. (β)",
    th_unstd_b: "Unstd. (B)",
    th_se: "SE",
    th_z: "z",
    th_p: "p",
    th_fit_index: "Index",
    th_value: "Value",

    lbl_dash: "—",
    lbl_r2_weak: "Weak",
    lbl_r2_moderate: "Moderate",
    lbl_r2_substantial: "Substantial",
    lbl_r2_strong: "Strong",
    lbl_f2_none: "Negligible",
    lbl_f2_small: "Small",
    lbl_f2_medium: "Medium",
    lbl_f2_large: "Large",
    lbl_moderation_badge: "Moderation",
    lbl_htmt_good: "< {v} — discriminant validity holds",
    lbl_htmt_warn: "{a}–{b} — borderline, worth a closer look",
    lbl_htmt_critical: "≥ {v} — may violate discriminant validity",

    // --- computation transparency section ---
    src_transparency_title: "Computation Transparency",
    src_transparency_hint: "The actual Python source that ran to produce the results above, pulled straight from the code currently running on the server (not a hand-copied version).",
    src_section_core_algorithm: "Core estimation algorithm",
    src_section_measurement_metrics: "Reliability & convergent/discriminant validity (rho_A, CR, AVE, HTMT, f²)",
    src_section_cmb: "Common Method Bias (Full Collinearity VIF)",
    src_section_mediation: "Mediation (Total & Indirect Effects)",
    src_section_moderation: "Moderation",
    src_section_bootstrap: "Bootstrapping (significance testing)",
    src_section_blindfolding: "Blindfolding (Q² — predictive relevance)",

    // --- results reading guide (bottom of PLS-SEM / CB-SEM results pages) ---
    results_guide_section_title: "Reading Guide & What the Numbers Mean",
    results_guide_measurement_summary: "Measurement Model (Outer Model)",
    results_guide_measurement_body:
      "<ul>" +
      "<li><strong>Outer Loadings:</strong> the correlation between each indicator and the construct it belongs to. For reflective constructs, aim for ≥0.7; 0.4–0.7 can be considered for removal if dropping it doesn't hurt AVE/reliability. <strong>Cross Loadings</strong> should show each indicator loading highest on its own construct, not another one.</li>" +
      "<li><strong>Cronbach's Alpha, rho_A, Composite Reliability (CR):</strong> internal consistency reliability — ≥0.7 is generally considered acceptable (0.6–0.7 can be acceptable in exploratory research).</li>" +
      "<li><strong>AVE (Average Variance Extracted):</strong> convergent validity — should be ≥0.5 (the construct explains at least 50% of the variance of its own indicators).</li>" +
      "</ul>",
    results_guide_discriminant_summary: "Discriminant Validity",
    results_guide_discriminant_body:
      "<ul>" +
      "<li><strong>Fornell-Larcker:</strong> the square root of AVE on the diagonal should exceed that construct's correlation with any other construct.</li>" +
      "<li><strong>HTMT (Heterotrait-Monotrait Ratio):</strong> should be &lt;0.85 (stricter) or &lt;0.90 (when constructs are conceptually close), per Henseler et al. (2015); ≥0.90 signals a discriminant validity violation.</li>" +
      "</ul>",
    results_guide_structural_summary: "Structural Model — Path Coefficients",
    results_guide_structural_body:
      "<ul>" +
      "<li><strong>Path coefficient (standardized β):</strong> its sign (+/−) and magnitude show the direction and strength of the relationship between two constructs.</li>" +
      "<li>If <strong>Bootstrapping</strong> was enabled: the STDEV / T-Statistics / P-Values / Significance columns show a path is statistically significant when p &lt; 0.05 (equivalent to |T| &gt; 1.96 for a two-tailed test).</li>" +
      "<li><strong>f² (effect size):</strong> &lt;0.02 negligible, 0.02–0.15 small, 0.15–0.35 medium, ≥0.35 large (Cohen, 1988). A path from a moderation (interaction) construct uses much smaller thresholds instead: 0.005/0.01/0.025 (Kenny 2018; Aguinis et al. 2005).</li>" +
      "</ul>",
    results_guide_mediation_summary: "Mediation Effects",
    results_guide_mediation_body:
      "<ul>" +
      "<li><strong>Total &amp; Indirect Effects:</strong> the indirect effect is the sum of the products of path coefficients along <em>every</em> route through a mediator between a pair of constructs; the total effect is direct + indirect.</li>" +
      "<li><strong>Specific Indirect Effects:</strong> breaks out <em>each individual</em> mediated route (instead of summing them as in the table above) — when bootstrapped, each route also gets its own significance test, based on that route's product within the same resample.</li>" +
      "</ul>",
    results_guide_predictive_summary: "R², Q² & Collinearity (VIF)",
    results_guide_predictive_body:
      "<ul>" +
      "<li><strong>R²:</strong> 0.19 weak, 0.33 moderate, 0.67 substantial (Chin, 1998) — reference thresholds only, field-dependent.</li>" +
      "<li><strong>Q² (Predictive Relevance, from Blindfolding):</strong> &gt;0 means the model has out-of-sample predictive power for that construct; ≤0 means it doesn't.</li>" +
      "<li><strong>VIF (Inner/Outer):</strong> should be &lt;3.3 (or &lt;5 under a more lenient rule) to avoid collinearity distorting the estimated coefficients.</li>" +
      "</ul>",
    results_guide_cmb_summary: "Common Method Bias",
    results_guide_cmb_body:
      "<p>Full collinearity VIF (Kock, 2015): each construct is regressed on <strong>every</strong> other construct in the model, not just its direct predictors. VIF ≤ threshold (default 3.3) means no meaningful sign of common method bias.</p>",
    results_guide_slopes_summary: "Simple Slopes (when a moderator is present)",
    results_guide_slopes_body:
      "<p>Three lines at −1SD / Mean / +1SD of the moderator show how the relationship between the independent variable and the outcome changes across levels of the moderator (Aiken &amp; West, 1991). The more the three lines fan apart (non-parallel), the stronger the interaction; near-parallel lines mean a weak interaction, regardless of whether the interaction path itself is statistically significant.</p>",
    results_guide_bootstrap_dist_summary: "Bootstrap Distributions (when Bootstrapping was enabled)",
    results_guide_bootstrap_dist_body:
      "<p>Each chart is the distribution of one path coefficient across every bootstrap resample. The solid blue line is the original estimate; the dashed red lines mark the 95% (percentile) confidence interval. If the 95% CI doesn't contain 0, that path is statistically significant.</p>",
    cbsem_guide_fit_summary: "Model Fit",
    cbsem_guide_fit_body:
      "<ul>" +
      "<li><strong>Chi-square / df:</strong> lower is better — χ²/df &lt; 3 is generally considered acceptable.</li>" +
      "<li><strong>CFI, TLI:</strong> ≥0.90 acceptable, ≥0.95 good.</li>" +
      "<li><strong>RMSEA:</strong> ≤0.08 acceptable, ≤0.05 good.</li>" +
      "<li><strong>SRMR:</strong> ≤0.08 acceptable.</li>" +
      "<li>These are reference thresholds only — consider several indices together rather than relying on any single one.</li>" +
      "</ul>",
    cbsem_guide_measurement_body:
      "<ul>" +
      "<li><strong>Cronbach's Alpha, Composite Reliability (CR), AVE:</strong> same reference thresholds as PLS-SEM — CR ≥0.7, AVE ≥0.5.</li>" +
      "<li><strong>Factor Loadings:</strong> the Unstd./Std./SE/z/p columns — significance is tested via a z-test (Wald test) from the Maximum Likelihood estimate, unlike PLS-SEM (which always needs Bootstrap since it has no closed-form standard error).</li>" +
      "</ul>",
    cbsem_guide_structural_body:
      "<ul>" +
      "<li><strong>Unstd. (B):</strong> the unstandardized regression coefficient, in the original scale of the measure. <strong>Std. (β):</strong> the standardized coefficient, comparable across paths.</li>" +
      "<li><strong>SE, z, p:</strong> significance is tested via a z-test (Wald test) directly from the Maximum Likelihood estimated covariance matrix — no Bootstrap needed, unlike PLS-SEM. A path is significant when p &lt; 0.05.</li>" +
      "</ul>",
    cbsem_guide_mediation_body:
      "<ul>" +
      "<li><strong>Total &amp; Indirect Effects:</strong> the indirect effect is the sum of the products of path coefficients along <em>every</em> route through a mediator between a pair of constructs; the total effect is direct + indirect.</li>" +
      "<li><strong>Specific Indirect Effects:</strong> breaks out <em>each individual</em> mediated route — for CB-SEM this is a point estimate only, <strong>without</strong> its own significance test yet (that needs a dedicated method, e.g. the delta method/Sobel test, to derive a product's standard error).</li>" +
      "</ul>",
    cbsem_guide_r2cmb_summary: "R² & Common Method Bias",
    cbsem_guide_r2cmb_body:
      "<ul>" +
      "<li><strong>R²:</strong> 0.19 weak, 0.33 moderate, 0.67 substantial (Chin, 1998) — CB-SEM's R² is usually higher than PLS-SEM's on the same data, since it corrects for measurement error.</li>" +
      "<li><strong>Common Method Bias (Full collinearity VIF, Kock 2015):</strong> each construct is regressed on every other construct; VIF ≤ threshold (default 3.3) means no meaningful sign of common method bias.</li>" +
      "</ul>",

    lbl_q2_none: "No predictive relevance",
    lbl_significant: "p < 0.05",
    lbl_not_significant: "Not significant",
    lbl_reference_indicator: "Reference indicator",
    lbl_formative_note: "Formative (Mode B) — internal reliability metrics not applicable",
    lbl_no_vif_pairs: "No construct has ≥2 predecessors / formative indicators to check collinearity.",
    lbl_vif_high: "High (>5)",
    lbl_vif_acceptable: "Acceptable",
    lbl_cmb_ok: "No CMB concern",
    lbl_cmb_warn: "Possible CMB concern",
    lbl_fit_good: "Good",
    lbl_fit_acceptable: "Acceptable",
    lbl_fit_poor: "Poor",
    suffix_structural: " (structural)",
    suffix_formative_measurement: " (formative measurement)",

    fit_chi_square: "Chi-square (χ²)",
    fit_df: "Degrees of Freedom (df)",
    fit_chi2_p: "χ² p-value",
    fit_cfi: "CFI",
    fit_tli: "TLI",
    fit_rmsea: "RMSEA",
    fit_srmr: "SRMR",
    fit_gfi: "GFI",
    fit_agfi: "AGFI",
    fit_nfi: "NFI",
    fit_aic: "AIC",
    fit_bic: "BIC",

    diagram_reflective: "Reflective",
    diagram_formative: "Formative",
  },
};

let currentLang = localStorage.getItem(LANG_STORAGE_KEY) || "en";
if (!I18N[currentLang]) currentLang = "en";

function t(key, params) {
  const dict = I18N[currentLang] || I18N.vi;
  let template = dict[key] !== undefined ? dict[key] : (I18N.vi[key] !== undefined ? I18N.vi[key] : key);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      template = template.split(`{${k}}`).join(v);
    }
  }
  return template;
}

function getLang() {
  return currentLang;
}

function applyStaticTranslations() {
  document.documentElement.lang = currentLang === "vi" ? "vi" : "en";
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
  });
  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    el.innerHTML = t(el.getAttribute("data-i18n-html"));
  });
}

function setLang(lang) {
  if (!I18N[lang]) return;
  currentLang = lang;
  localStorage.setItem(LANG_STORAGE_KEY, lang);
  applyStaticTranslations();
  document.dispatchEvent(new CustomEvent("langchange", { detail: { lang } }));
}
