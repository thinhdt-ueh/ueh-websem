"""Centralized VI/EN translation catalog for backend-generated text: model
validation errors, estimation errors, and Excel/Word report labels.

Frontend UI strings live in static/js/i18n.js — a separate catalog, because
it translates a different surface (DOM text) at a different time (in the
browser, on language switch) than this one (error messages and report
generation, at request time). Keys are named similarly where they describe
the same concept, but the two are not required to stay in lockstep.

Many statistics terms (AVE, VIF, HTMT, CFI, RMSEA, R², Cronbach's Alpha...)
are conventionally left untranslated in Vietnamese academic writing too, so
they appear the same in both catalogs — that isn't a missing translation.
"""

from __future__ import annotations

DEFAULT_LANG = "en"
SUPPORTED_LANGS = ("vi", "en")


def get_lang(payload: dict | None) -> str:
    lang = (payload or {}).get("lang", DEFAULT_LANG)
    return lang if lang in SUPPORTED_LANGS else DEFAULT_LANG


def t(key: str, lang: str = DEFAULT_LANG, **kwargs) -> str:
    lang = lang if lang in SUPPORTED_LANGS else DEFAULT_LANG
    template = _CATALOG.get(lang, {}).get(key) or _CATALOG[DEFAULT_LANG].get(key) or key
    return template.format(**kwargs) if kwargs else template


_CATALOG: dict[str, dict[str, str]] = {
    "vi": {
        # --- pls/model.py validation errors ---
        "err_model_min_constructs": "Mô hình cần tối thiểu 2 biến tiềm ẩn (constructs).",
        "err_construct_missing_id_name": "Mỗi construct cần có id và tên hợp lệ.",
        "err_construct_invalid_mode": "Construct '{name}': mode phải là 'A' (reflective) hoặc 'B' (formative).",
        "err_construct_min_indicators": "Construct '{name}' cần ít nhất 1 biến quan sát (indicator).",
        "err_construct_reflective_min2": (
            "Construct phản ánh (reflective) '{name}' cần tối thiểu 2 biến quan sát "
            "để tính được độ tin cậy."
        ),
        "err_construct_duplicate_id": "Trùng id construct: '{cid}'.",
        "err_indicator_duplicate": (
            "Biến quan sát '{ind}' được gán cho nhiều hơn 1 construct ('{a}' và '{b}')."
        ),
        "err_path_unknown_construct": "Đường dẫn cấu trúc (path) tham chiếu đến construct không tồn tại.",
        "err_path_self_loop": "Không thể tạo path từ một construct đến chính nó.",
        "err_model_min_paths": "Mô hình cấu trúc cần ít nhất 1 đường dẫn (path) giữa các construct.",
        "err_model_cycle": "Mô hình cấu trúc chứa vòng lặp (cycle) — cần mô hình đệ quy (không vòng lặp).",

        # --- pls/algorithm.py & cbsem/estimator.py estimation errors ---
        "err_zero_variance_indicators": "Biến quan sát không có phương sai (giá trị không đổi): {cols}",
        "err_missing_indicator_columns": "Không tìm thấy cột dữ liệu cho biến quan sát: {cols}",
        "err_insufficient_observations": (
            "Không đủ quan sát hợp lệ để ước lượng mô hình (còn {n} dòng sau khi loại "
            "{missing} dòng thiếu dữ liệu)."
        ),
        "err_cbsem_insufficient_observations": (
            "Không đủ quan sát hợp lệ để ước lượng mô hình (còn {n} dòng)."
        ),
        "err_cbsem_formative_not_supported": (
            "CB-SEM (Maximum Likelihood) chỉ hỗ trợ đo lường reflective. Construct formative "
            "(Mode B) cần mô hình MIMIC với ràng buộc nhận dạng riêng, chưa được hỗ trợ: {names}"
        ),
        "err_cbsem_fit_failed": "semopy không ước lượng được mô hình: {exc}",
        "err_cbsem_not_identified": (
            "Mô hình không nhận dạng được (degrees of freedom = {dof} < 0): cần thêm biến "
            "quan sát hoặc ràng buộc để có đủ thông tin ước lượng."
        ),

        # --- routes/api.py & routes/cbsem_api.py request errors ---
        "err_upload_no_file": "Không tìm thấy file trong request.",
        "err_upload_empty_filename": "Tên file trống.",
        "err_upload_unsupported_format": "Định dạng file không được hỗ trợ: {ext}. Chỉ hỗ trợ CSV/XLSX.",
        "err_upload_read_error": "Không đọc được file dữ liệu: {exc}",
        "err_upload_empty_file": "File dữ liệu rỗng hoặc không có cột nào.",
        "err_upload_too_many_rows": "File có {n} dòng, vượt quá giới hạn {max} dòng cho phép.",
        "err_analyze_missing_file_id": "Thiếu file_id — hãy upload dữ liệu trước.",
        "err_analyze_file_not_found": "Không tìm thấy dữ liệu đã upload (có thể đã hết hạn), hãy upload lại.",
        "err_pls_run_error": "Lỗi khi chạy PLS Algorithm: {exc}",
        "err_bootstrap_run_error": "Lỗi khi chạy Bootstrapping: {exc}",
        "err_cbsem_run_error": "Lỗi khi ước lượng CB-SEM: {exc}",
        "err_export_missing_data": "Thiếu dữ liệu kết quả phân tích để xuất báo cáo.",
        "err_export_excel_error": "Lỗi khi tạo file Excel: {exc}",
        "err_export_word_error": "Lỗi khi tạo file Word: {exc}",

        # --- shared report labels (pls/report.py & cbsem/report.py) ---
        "rpt_title_pls": "PLS-SEM — Báo cáo phân tích",
        "rpt_title_cbsem": "Báo cáo phân tích CB-SEM (Maximum Likelihood)",
        "rpt_sheet_overview": "Tổng quan",
        "rpt_sheet_measurement": "Mô hình đo lường",
        "rpt_sheet_outer_loadings": "Outer Loadings",
        "rpt_sheet_cross_loadings": "Cross Loadings",
        "rpt_sheet_reliability": "Độ tin cậy & Hội tụ",
        "rpt_sheet_discriminant": "Giá trị phân biệt",
        "rpt_sheet_structural": "Mô hình cấu trúc",
        "rpt_model_info": "Thông tin mô hình",
        "rpt_value": "Giá trị",
        "rpt_method": "Phương pháp ước lượng",
        "rpt_n_obs": "Số quan sát hợp lệ (n)",
        "rpt_converged": "Hội tụ",
        "rpt_yes": "Có",
        "rpt_no": "Không",
        "rpt_n_iterations": "Số vòng lặp",
        "rpt_optimizer_message": "Thông báo optimizer",
        "rpt_bootstrap_requested": "Bootstrapping — số mẫu yêu cầu",
        "rpt_bootstrap_valid": "Bootstrapping — số mẫu hợp lệ",
        "rpt_export_date": "Ngày xuất báo cáo",
        "rpt_construct_list": "Danh sách Construct",
        "rpt_construct": "Construct",
        "rpt_measurement_type": "Loại đo lường",
        "rpt_reflective": "Reflective (Mode A)",
        "rpt_formative": "Formative (Mode B)",
        "rpt_indicators": "Biến quan sát",
        "rpt_endogenous": "Nội sinh",
        "rpt_indicator": "Indicator",
        "rpt_outer_loading": "Outer Loading",
        "rpt_outer_weight": "Outer Weight",
        "rpt_stdev": "STDEV",
        "rpt_t_stat": "T Statistics",
        "rpt_p_value": "P Values",
        "rpt_significance": "Ý nghĩa (95%)",
        "rpt_significant": "p < 0.05",
        "rpt_not_significant": "Không ý nghĩa",
        "rpt_cronbachs_alpha": "Cronbach's Alpha",
        "rpt_rho_a": "rho_A",
        "rpt_composite_reliability": "Composite Reliability",
        "rpt_ave": "AVE",
        "rpt_note": "Ghi chú",
        "rpt_formative_no_reliability": "Formative (Mode B) — không áp dụng chỉ số độ tin cậy nội bộ",
        "rpt_fornell_larcker": "Fornell-Larcker Criterion",
        "rpt_htmt": "HTMT",
        "rpt_path_coefficients": "Path Coefficients",
        "rpt_path": "Đường dẫn",
        "rpt_path_coefficient": "Path Coefficient (β)",
        "rpt_f_squared": "f²",
        "rpt_f2_effect": "Mức ảnh hưởng f²",
        "rpt_r2_q2_title": "R² & Q² (Predictive Relevance)",
        "rpt_endogenous_construct": "Construct nội sinh",
        "rpt_r2": "R²",
        "rpt_r2_adj": "R² hiệu chỉnh",
        "rpt_r2_assessment": "Đánh giá R²",
        "rpt_q2": "Q² (blindfolding, D={d})",
        "rpt_q2_assessment": "Đánh giá Q²",
        "rpt_vif_title": "Đa cộng tuyến (VIF)",
        "rpt_pair": "Cặp",
        "rpt_vif": "VIF",
        "rpt_structural_suffix": " (cấu trúc)",
        "rpt_formative_measurement_suffix": " (đo lường formative)",
        "lbl_r2_weak": "Yếu",
        "lbl_r2_moderate": "Trung bình",
        "lbl_r2_substantial": "Khá mạnh",
        "lbl_r2_strong": "Mạnh",
        "lbl_f2_none": "Không đáng kể",
        "lbl_f2_small": "Nhỏ",
        "lbl_f2_medium": "Trung bình",
        "lbl_f2_large": "Lớn",
        "lbl_q2_none": "Không có ý nghĩa dự báo",

        # --- CB-SEM-only report labels ---
        "rpt_fit_index": "Chỉ số phù hợp mô hình (Fit Index)",
        "rpt_fit_assessment": "Đánh giá",
        "rpt_model_fit": "Model Fit",
        "rpt_fit_chi_square": "Chi-square (χ²)",
        "rpt_fit_df": "Degrees of Freedom (df)",
        "rpt_fit_chi2_p": "χ²/df p-value",
        "rpt_fit_cfi": "CFI",
        "rpt_fit_tli": "TLI",
        "rpt_fit_rmsea": "RMSEA",
        "rpt_fit_srmr": "SRMR",
        "rpt_fit_gfi": "GFI",
        "rpt_fit_agfi": "AGFI",
        "rpt_fit_nfi": "NFI",
        "rpt_fit_aic": "AIC",
        "rpt_fit_bic": "BIC",
        "lbl_fit_good": "Tốt",
        "lbl_fit_acceptable": "Chấp nhận được",
        "lbl_fit_poor": "Chưa đạt",
        "rpt_factor_loadings": "Factor Loadings",
        "rpt_unstandardized": "Unstandardized",
        "rpt_standardized": "Standardized",
        "rpt_unstd_short": "Unstd.",
        "rpt_std_short": "Std.",
        "rpt_se": "SE",
        "rpt_z_value": "z-value",
        "rpt_z_short": "z",
        "rpt_p_short": "p",
        "rpt_reference_indicator": "Biến tham chiếu (cố định = 1)",
        "rpt_reference_short": "Ref.",
        "rpt_r2_only_title": "R² (bao gồm hiệu chỉnh sai lệch đo lường)",
        "rpt_r2_note": (
            "Ghi chú: R² trong CB-SEM đã hiệu chỉnh sai lệch do sai số đo lường (measurement error), "
            "nên thường cao hơn R² tương ứng ước lượng bằng PLS-SEM trên cùng dữ liệu."
        ),

        # --- report section headings & misc (Word) ---
        "rpt_no_vif_pairs": "Không có construct nào có ≥2 tiền tố / biến formative để kiểm tra đa cộng tuyến.",
        "rpt_bootstrap_note": (
            "Ghi chú: Bootstrapping chạy với {requested} mẫu lặp lại ({valid} mẫu hợp lệ)."
        ),
        "rpt_blindfolding_note": "Blindfolding chạy với omission distance D = {d}.",
        "rpt_section_overview": "1. Tổng quan mô hình",
        "rpt_section_measurement": "2. Mô hình đo lường (Measurement Model)",
        "rpt_section_loadings": "2.1. Outer Loadings & Weights",
        "rpt_section_reliability": "2.2. Độ tin cậy & Giá trị hội tụ",
        "rpt_section_fl": "2.3. Giá trị phân biệt — Fornell-Larcker",
        "rpt_section_htmt": "2.4. Giá trị phân biệt — HTMT",
        "rpt_section_structural": "3. Mô hình cấu trúc (Structural Model)",
        "rpt_section_path_coef": "3.1. Path Coefficients",
        "rpt_section_r2q2": "3.2. R² & Q² (Predictive Relevance)",
        "rpt_section_vif": "3.3. Đa cộng tuyến (VIF)",
        "rpt_word_converged": "Đã hội tụ",
        "rpt_word_not_converged": "CHƯA hội tụ",
        "rpt_after_iterations": "sau {it} vòng lặp",

        # --- CB-SEM Word section headings ---
        "rpt_cbsem_section_overview": "1. Tổng quan mô hình",
        "rpt_cbsem_section_fit": "2. Model Fit",
        "rpt_cbsem_section_measurement": "3. Mô hình đo lường (Measurement Model)",
        "rpt_cbsem_section_loadings": "3.1. Factor Loadings",
        "rpt_cbsem_section_reliability": "3.2. Độ tin cậy & Giá trị hội tụ",
        "rpt_cbsem_section_fl": "3.3. Giá trị phân biệt — Fornell-Larcker",
        "rpt_cbsem_section_htmt": "3.4. Giá trị phân biệt — HTMT",
        "rpt_cbsem_section_structural": "4. Mô hình cấu trúc (Structural Model)",
        "rpt_cbsem_section_r2": "R²",
    },
    "en": {
        "err_model_min_constructs": "The model needs at least 2 latent constructs.",
        "err_construct_missing_id_name": "Every construct needs a valid id and name.",
        "err_construct_invalid_mode": "Construct '{name}': mode must be 'A' (reflective) or 'B' (formative).",
        "err_construct_min_indicators": "Construct '{name}' needs at least 1 indicator.",
        "err_construct_reflective_min2": (
            "Reflective construct '{name}' needs at least 2 indicators to compute reliability."
        ),
        "err_construct_duplicate_id": "Duplicate construct id: '{cid}'.",
        "err_indicator_duplicate": (
            "Indicator '{ind}' is assigned to more than one construct ('{a}' and '{b}')."
        ),
        "err_path_unknown_construct": "A structural path references a construct that does not exist.",
        "err_path_self_loop": "A construct cannot have a path to itself.",
        "err_model_min_paths": "The structural model needs at least 1 path between constructs.",
        "err_model_cycle": "The structural model contains a cycle — a recursive (acyclic) model is required.",

        "err_zero_variance_indicators": "Indicator(s) with zero variance (constant value): {cols}",
        "err_missing_indicator_columns": "Data column(s) not found for indicator(s): {cols}",
        "err_insufficient_observations": (
            "Not enough valid observations to estimate the model ({n} rows remain after "
            "dropping {missing} row(s) with missing data)."
        ),
        "err_cbsem_insufficient_observations": (
            "Not enough valid observations to estimate the model ({n} rows remain)."
        ),
        "err_cbsem_formative_not_supported": (
            "CB-SEM (Maximum Likelihood) only supports reflective measurement. Formative constructs "
            "(Mode B) need a MIMIC specification with separate identification constraints, which is "
            "not yet supported: {names}"
        ),
        "err_cbsem_fit_failed": "semopy failed to estimate the model: {exc}",
        "err_cbsem_not_identified": (
            "The model is not identified (degrees of freedom = {dof} < 0): add more indicators "
            "or constraints to have enough information to estimate it."
        ),

        "err_upload_no_file": "No file found in the request.",
        "err_upload_empty_filename": "Empty filename.",
        "err_upload_unsupported_format": "Unsupported file format: {ext}. Only CSV/XLSX are supported.",
        "err_upload_read_error": "Could not read the data file: {exc}",
        "err_upload_empty_file": "The data file is empty or has no columns.",
        "err_upload_too_many_rows": "The file has {n} rows, exceeding the {max}-row limit.",
        "err_analyze_missing_file_id": "Missing file_id — upload data first.",
        "err_analyze_file_not_found": "Uploaded data not found (it may have expired) — please upload again.",
        "err_pls_run_error": "Error while running the PLS Algorithm: {exc}",
        "err_bootstrap_run_error": "Error while running Bootstrapping: {exc}",
        "err_cbsem_run_error": "Error while estimating CB-SEM: {exc}",
        "err_export_missing_data": "Missing analysis result data to export.",
        "err_export_excel_error": "Error while generating the Excel file: {exc}",
        "err_export_word_error": "Error while generating the Word file: {exc}",

        "rpt_title_pls": "PLS-SEM — Analysis Report",
        "rpt_title_cbsem": "CB-SEM Analysis Report (Maximum Likelihood)",
        "rpt_sheet_overview": "Overview",
        "rpt_sheet_measurement": "Measurement Model",
        "rpt_sheet_outer_loadings": "Outer Loadings",
        "rpt_sheet_cross_loadings": "Cross Loadings",
        "rpt_sheet_reliability": "Reliability & Validity",
        "rpt_sheet_discriminant": "Discriminant Validity",
        "rpt_sheet_structural": "Structural Model",
        "rpt_model_info": "Model Information",
        "rpt_value": "Value",
        "rpt_method": "Estimation Method",
        "rpt_n_obs": "Valid Observations (n)",
        "rpt_converged": "Converged",
        "rpt_yes": "Yes",
        "rpt_no": "No",
        "rpt_n_iterations": "Iterations",
        "rpt_optimizer_message": "Optimizer Message",
        "rpt_bootstrap_requested": "Bootstrapping — Samples Requested",
        "rpt_bootstrap_valid": "Bootstrapping — Valid Samples",
        "rpt_export_date": "Report Generated",
        "rpt_construct_list": "Construct List",
        "rpt_construct": "Construct",
        "rpt_measurement_type": "Measurement Type",
        "rpt_reflective": "Reflective (Mode A)",
        "rpt_formative": "Formative (Mode B)",
        "rpt_indicators": "Indicators",
        "rpt_endogenous": "Endogenous",
        "rpt_indicator": "Indicator",
        "rpt_outer_loading": "Outer Loading",
        "rpt_outer_weight": "Outer Weight",
        "rpt_stdev": "STDEV",
        "rpt_t_stat": "T Statistics",
        "rpt_p_value": "P Values",
        "rpt_significance": "Significance (95%)",
        "rpt_significant": "p < 0.05",
        "rpt_not_significant": "Not significant",
        "rpt_cronbachs_alpha": "Cronbach's Alpha",
        "rpt_rho_a": "rho_A",
        "rpt_composite_reliability": "Composite Reliability",
        "rpt_ave": "AVE",
        "rpt_note": "Note",
        "rpt_formative_no_reliability": "Formative (Mode B) — internal reliability metrics not applicable",
        "rpt_fornell_larcker": "Fornell-Larcker Criterion",
        "rpt_htmt": "HTMT",
        "rpt_path_coefficients": "Path Coefficients",
        "rpt_path": "Path",
        "rpt_path_coefficient": "Path Coefficient (β)",
        "rpt_f_squared": "f²",
        "rpt_f2_effect": "f² Effect Size",
        "rpt_r2_q2_title": "R² & Q² (Predictive Relevance)",
        "rpt_endogenous_construct": "Endogenous Construct",
        "rpt_r2": "R²",
        "rpt_r2_adj": "Adjusted R²",
        "rpt_r2_assessment": "R² Assessment",
        "rpt_q2": "Q² (blindfolding, D={d})",
        "rpt_q2_assessment": "Q² Assessment",
        "rpt_vif_title": "Collinearity (VIF)",
        "rpt_pair": "Pair",
        "rpt_vif": "VIF",
        "rpt_structural_suffix": " (structural)",
        "rpt_formative_measurement_suffix": " (formative measurement)",
        "lbl_r2_weak": "Weak",
        "lbl_r2_moderate": "Moderate",
        "lbl_r2_substantial": "Substantial",
        "lbl_r2_strong": "Strong",
        "lbl_f2_none": "Negligible",
        "lbl_f2_small": "Small",
        "lbl_f2_medium": "Medium",
        "lbl_f2_large": "Large",
        "lbl_q2_none": "No predictive relevance",

        "rpt_fit_index": "Fit Index",
        "rpt_fit_assessment": "Assessment",
        "rpt_model_fit": "Model Fit",
        "rpt_fit_chi_square": "Chi-square (χ²)",
        "rpt_fit_df": "Degrees of Freedom (df)",
        "rpt_fit_chi2_p": "χ²/df p-value",
        "rpt_fit_cfi": "CFI",
        "rpt_fit_tli": "TLI",
        "rpt_fit_rmsea": "RMSEA",
        "rpt_fit_srmr": "SRMR",
        "rpt_fit_gfi": "GFI",
        "rpt_fit_agfi": "AGFI",
        "rpt_fit_nfi": "NFI",
        "rpt_fit_aic": "AIC",
        "rpt_fit_bic": "BIC",
        "lbl_fit_good": "Good",
        "lbl_fit_acceptable": "Acceptable",
        "lbl_fit_poor": "Poor",
        "rpt_factor_loadings": "Factor Loadings",
        "rpt_unstandardized": "Unstandardized",
        "rpt_standardized": "Standardized",
        "rpt_unstd_short": "Unstd.",
        "rpt_std_short": "Std.",
        "rpt_se": "SE",
        "rpt_z_value": "z-value",
        "rpt_z_short": "z",
        "rpt_p_short": "p",
        "rpt_reference_indicator": "Reference indicator (fixed = 1)",
        "rpt_reference_short": "Ref.",
        "rpt_r2_only_title": "R² (corrected for measurement error)",
        "rpt_r2_note": (
            "Note: R² in CB-SEM is corrected for measurement error, so it is typically higher than "
            "the corresponding R² estimated by PLS-SEM on the same data."
        ),

        "rpt_no_vif_pairs": "No construct has ≥2 predecessors / formative indicators to check collinearity.",
        "rpt_bootstrap_note": (
            "Note: Bootstrapping ran with {requested} resamples ({valid} valid samples)."
        ),
        "rpt_blindfolding_note": "Blindfolding ran with omission distance D = {d}.",
        "rpt_section_overview": "1. Model Overview",
        "rpt_section_measurement": "2. Measurement Model",
        "rpt_section_loadings": "2.1. Outer Loadings & Weights",
        "rpt_section_reliability": "2.2. Reliability & Convergent Validity",
        "rpt_section_fl": "2.3. Discriminant Validity — Fornell-Larcker",
        "rpt_section_htmt": "2.4. Discriminant Validity — HTMT",
        "rpt_section_structural": "3. Structural Model",
        "rpt_section_path_coef": "3.1. Path Coefficients",
        "rpt_section_r2q2": "3.2. R² & Q² (Predictive Relevance)",
        "rpt_section_vif": "3.3. Collinearity (VIF)",
        "rpt_word_converged": "Converged",
        "rpt_word_not_converged": "NOT converged",
        "rpt_after_iterations": "after {it} iterations",

        "rpt_cbsem_section_overview": "1. Model Overview",
        "rpt_cbsem_section_fit": "2. Model Fit",
        "rpt_cbsem_section_measurement": "3. Measurement Model",
        "rpt_cbsem_section_loadings": "3.1. Factor Loadings",
        "rpt_cbsem_section_reliability": "3.2. Reliability & Convergent Validity",
        "rpt_cbsem_section_fl": "3.3. Discriminant Validity — Fornell-Larcker",
        "rpt_cbsem_section_htmt": "3.4. Discriminant Validity — HTMT",
        "rpt_cbsem_section_structural": "4. Structural Model",
        "rpt_cbsem_section_r2": "R²",
    },
}
