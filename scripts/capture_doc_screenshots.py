"""Regenerates every screenshot used by the User Guide and the Handbook
(static/docs/images/{vi,en}/<key>.webp) from the live app, in both UI
languages.

Usage (dev server must already be running):
    .venv/Scripts/python.exe app.py            # in another terminal
    .venv/Scripts/python.exe scripts/capture_doc_screenshots.py [--lang vi|en] [--only key1,key2]

Every AI-calling endpoint (construct search, data generation batches, worker
pool / survey batches, AI path drawing, AI-rater scoring, AI report) is
answered by a Playwright route mock with realistic synthetic content, so the
real UI flows run end-to-end with no API key and no cost. Everything else --
PLS/CB-SEM estimation, finalize routes, sensitivity/power/ML/MGA pages -- is
the real backend.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import random
import re

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

BASE = os.environ.get("AISEM_URL", "http://127.0.0.1:5000")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "static", "docs", "images")
SAMPLE_CSV = os.path.join(ROOT, "sample_data", "tam_sample.csv")
MAX_WIDTH = 1600
VIEWPORT = {"width": 1366, "height": 860}

# Applied to every page: no sticky header/side panel overlapping element
# crops, and each result card sized to its own table instead of squeezed into
# a 2-column grid with a horizontal scrollbar.
CAPTURE_CSS = """
.topbar, .side-panel { position: static !important; }
.results-grid { grid-template-columns: 1fr !important; justify-items: start; }
.results-grid > .panel-card { width: max-content; max-width: 100%; }
"""

MODAL_CSS = """
.modal-backdrop { position: absolute !important; min-height: 100%; align-items: flex-start !important; padding: 40px 0; }
.modal-box, .modal-box.modal-wide { max-height: none !important; overflow: visible !important; }
"""

# --------------------------------------------------------------------------
# Synthetic "AI" content
# --------------------------------------------------------------------------

TXT = {
    "vi": {
        "topic": "Ý định sử dụng ví điện tử của sinh viên đại học tại TP.HCM",
        "occupation": "Sinh viên đại học",
        "location": "TP. Hồ Chí Minh",
        "target": "Sinh viên đang dùng điện thoại thông minh, đã từng hoặc đang cân nhắc thanh toán bằng ví điện tử (MoMo, ZaloPay...).",
        "user_prompt_extra": "",
        "personas": [
            "Sinh viên năm {y} ngành {m}, dùng ví điện tử hằng ngày để trả tiền ăn và gửi xe; khá tin tưởng công nghệ.",
            "Sinh viên năm {y} ngành {m}, thận trọng với thanh toán online, chỉ dùng ví khi được giảm giá.",
            "Sinh viên năm {y} ngành {m}, làm thêm buổi tối, thích sự nhanh gọn khi quét QR ở cửa hàng tiện lợi.",
            "Sinh viên năm {y} ngành {m}, từng gặp lỗi giao dịch nên còn e ngại, vẫn dùng tiền mặt là chính.",
        ],
        "majors": ["Kinh tế", "Marketing", "Công nghệ thông tin", "Tài chính", "Luật", "Du lịch"],
        "open_answers": [
            "Ứng dụng nên tải nhanh hơn khi mạng yếu.",
            "Mình muốn có thông báo rõ ràng hơn khi giao dịch thất bại.",
            "Nên có nhiều ưu đãi cho sinh viên hơn.",
            "Giao diện hơi rối, khó tìm lịch sử giao dịch.",
            "Bảo mật tốt nhưng xác thực hơi phiền.",
            "Mình hài lòng, không cần cải thiện gì nhiều.",
        ],
        "constructs": [
            ("Nhận thức hữu ích", "PU", "Davis, F. D. (1989). Perceived usefulness, perceived ease of use, and user acceptance of information technology. MIS Quarterly, 13(3), 319–340.", "10.2307/249008",
             ["Ví điện tử giúp tôi thanh toán nhanh hơn.", "Ví điện tử giúp tôi quản lý chi tiêu hiệu quả hơn.", "Nhìn chung, ví điện tử hữu ích với tôi."]),
            ("Nhận thức dễ sử dụng", "PEOU", "Davis, F. D. (1989). Perceived usefulness, perceived ease of use, and user acceptance of information technology. MIS Quarterly, 13(3), 319–340.", "10.2307/249008",
             ["Học cách dùng ví điện tử rất dễ dàng.", "Thao tác trên ví điện tử rõ ràng, dễ hiểu.", "Tôi thấy ví điện tử dễ sử dụng."]),
            ("Thái độ", "ATT", "Ajzen, I. (1991). The theory of planned behavior. Organizational Behavior and Human Decision Processes, 50(2), 179–211.", "10.1016/0749-5978(91)90020-T",
             ["Dùng ví điện tử là một ý tưởng hay.", "Tôi thích dùng ví điện tử.", "Dùng ví điện tử mang lại cảm giác dễ chịu."]),
            ("Ý định sử dụng", "INT", "Venkatesh, V., Morris, M. G., Davis, G. B., & Davis, F. D. (2003). User acceptance of information technology: Toward a unified view. MIS Quarterly, 27(3), 425–478.", "10.2307/30036540",
             ["Tôi dự định tiếp tục dùng ví điện tử trong thời gian tới.", "Tôi sẽ dùng ví điện tử thường xuyên hơn.", "Tôi sẽ giới thiệu ví điện tử cho bạn bè."]),
        ],
        "open_q": "Bạn muốn ví điện tử cải thiện điều gì nhất?",
        "context": "Bạn là sinh viên đang cân nhắc thanh toán học phí và chi tiêu hằng ngày bằng ví điện tử. Hãy đọc tình huống dưới đây rồi trả lời bảng hỏi.",
        "manip": [
            "Ví điện tử vừa công bố chương trình hoàn tiền 10% cho mọi giao dịch của sinh viên trong 3 tháng.",
            "Không có chương trình khuyến mãi nào; phí giao dịch giữ nguyên như hiện tại.",
        ],
        "rubric": "Chấm mức độ tiêu cực của góp ý: 1 = hoàn toàn hài lòng, 5 = phàn nàn rất nghiêm trọng về trải nghiệm.",
        "rationale": "Theo TAM (Davis, 1989), nhận thức dễ sử dụng tác động đến nhận thức hữu ích và thái độ; hai yếu tố này cùng dẫn đến ý định sử dụng.",
        "report": """## 1. Tóm tắt
Mô hình TAM giải thích tốt **Ý định hành vi** (R² ≈ 0.34). Cả bốn thang đo đều đạt độ tin cậy và giá trị hội tụ.

## 2. Mô hình đo lường
- Cronbach's α và Composite Reliability của mọi construct đều > 0.80.
- AVE > 0.50 và HTMT < 0.85 — đạt giá trị phân biệt.

## 3. Mô hình cấu trúc
| Giả thuyết | β | p-value | Kết luận |
|---|---|---|---|
| PEOU → PU | 0.46 | < 0.001 | Ủng hộ |
| PU → ATT | 0.31 | < 0.001 | Ủng hộ |
| ATT → INT | 0.36 | < 0.001 | Ủng hộ |

## 4. Hàm ý
Nhà cung cấp nên ưu tiên cải thiện **tính dễ sử dụng**, vì yếu tố này tác động gián tiếp mạnh lên ý định qua nhận thức hữu ích và thái độ.
""",
    },
    "en": {
        "topic": "University students' intention to use mobile wallets",
        "occupation": "University students",
        "location": "Ho Chi Minh City",
        "target": "Students who own a smartphone and have used, or are considering, paying with a mobile wallet.",
        "user_prompt_extra": "",
        "personas": [
            "Year-{y} {m} student who uses a mobile wallet daily for food and parking; fairly confident with technology.",
            "Year-{y} {m} student, cautious about online payments, only uses the wallet when there is a discount.",
            "Year-{y} {m} student with an evening part-time job who likes the speed of QR payments at convenience stores.",
            "Year-{y} {m} student who once had a failed transaction and still mostly pays in cash.",
        ],
        "majors": ["Economics", "Marketing", "IT", "Finance", "Law", "Tourism"],
        "open_answers": [
            "The app should load faster on a weak connection.",
            "I want clearer messages when a payment fails.",
            "More student discounts would be great.",
            "The interface is cluttered; transaction history is hard to find.",
            "Security is good but the verification steps are annoying.",
            "I'm happy with it, nothing major to improve.",
        ],
        "constructs": [
            ("Perceived Usefulness", "PU", "Davis, F. D. (1989). Perceived usefulness, perceived ease of use, and user acceptance of information technology. MIS Quarterly, 13(3), 319–340.", "10.2307/249008",
             ["Using a mobile wallet makes my payments faster.", "A mobile wallet helps me manage my spending.", "Overall, a mobile wallet is useful to me."]),
            ("Perceived Ease of Use", "PEOU", "Davis, F. D. (1989). Perceived usefulness, perceived ease of use, and user acceptance of information technology. MIS Quarterly, 13(3), 319–340.", "10.2307/249008",
             ["Learning to use a mobile wallet is easy.", "Interacting with a mobile wallet is clear and understandable.", "I find a mobile wallet easy to use."]),
            ("Attitude", "ATT", "Ajzen, I. (1991). The theory of planned behavior. Organizational Behavior and Human Decision Processes, 50(2), 179–211.", "10.1016/0749-5978(91)90020-T",
             ["Using a mobile wallet is a good idea.", "I like using a mobile wallet.", "Using a mobile wallet is pleasant."]),
            ("Behavioral Intention", "INT", "Venkatesh, V., Morris, M. G., Davis, G. B., & Davis, F. D. (2003). User acceptance of information technology: Toward a unified view. MIS Quarterly, 27(3), 425–478.", "10.2307/30036540",
             ["I intend to keep using a mobile wallet.", "I will use a mobile wallet more often.", "I will recommend mobile wallets to my friends."]),
        ],
        "open_q": "What would you most like the mobile wallet to improve?",
        "context": "You are a student deciding whether to pay tuition and daily expenses with a mobile wallet. Read the scenario below, then answer the questionnaire.",
        "manip": [
            "The wallet has just announced 10% cashback on every student transaction for 3 months.",
            "There is no promotion; transaction fees stay as they are today.",
        ],
        "rubric": "Score how negative the feedback is: 1 = fully satisfied, 5 = a very serious complaint about the experience.",
        "rationale": "Following TAM (Davis, 1989), perceived ease of use drives perceived usefulness and attitude; both then lead to behavioral intention.",
        "report": """## 1. Summary
The TAM model explains **Behavioral Intention** well (R² ≈ 0.34). All four scales meet reliability and convergent validity criteria.

## 2. Measurement model
- Cronbach's α and composite reliability exceed 0.80 for every construct.
- AVE > 0.50 and HTMT < 0.85 — discriminant validity holds.

## 3. Structural model
| Hypothesis | β | p-value | Decision |
|---|---|---|---|
| PEOU → PU | 0.46 | < 0.001 | Supported |
| PU → ATT | 0.31 | < 0.001 | Supported |
| ATT → INT | 0.36 | < 0.001 | Supported |

## 4. Implications
Providers should prioritise **ease of use**, since it has a strong indirect effect on intention through usefulness and attitude.
""",
    },
}

RNG = np.random.default_rng(7)


def _construct_of(column: str) -> str:
    return re.sub(r"\d+$", "", column)


def _likert_rows(n: int, columns: list[str], lo: int, hi: int, qual: list[str], lang: str) -> list[dict]:
    """Correlated Likert answers: one latent score per construct (prefix of
    the column name), chained PEOU -> PU -> ATT -> INT so a TAM model
    estimated on the result looks like a real study."""
    latents = {}
    base = RNG.normal(size=n)
    prev = base
    for c in dict.fromkeys(_construct_of(col) for col in columns if col not in qual):
        prev = 0.55 * prev + 0.8 * RNG.normal(size=n)
        latents[c] = prev
    mid, spread = (lo + hi) / 2, (hi - lo) / 3.2
    rows = []
    for i in range(n):
        row = {}
        for col in columns:
            if col in qual:
                row[col] = random.choice(TXT[lang]["open_answers"])
            else:
                v = mid + 0.35 + spread * (0.8 * latents[_construct_of(col)][i] + 0.45 * RNG.normal())
                row[col] = int(min(hi, max(lo, round(v))))
        rows.append(row)
    return rows


def _persona(lang: str) -> str:
    t = TXT[lang]
    return random.choice(t["personas"]).format(y=random.randint(1, 4), m=random.choice(t["majors"]))


def install_ai_mocks(ctx, lang: str):
    t = TXT[lang]

    def reply(route, payload):
        route.fulfill(status=200, content_type="application/json", body=json.dumps(payload, ensure_ascii=False))

    def suggest_constructs(route):
        constructs = [
            {"name": name, "theory": {"citation_apa": cite, "doi": doi},
             "items": [{"column": f"{code}{i + 1}", "question_text": q} for i, q in enumerate(items)]}
            for name, code, cite, doi, items in t["constructs"]
        ]
        reply(route, {"constructs": constructs})

    def data_gen_batch(route):
        body = route.request.post_data_json
        n = body["end_row"] - body["start_row"] + 1
        rows = _likert_rows(n, body["columns"], body["likert_min"], body["likert_max"], body.get("qualitative_columns") or [], lang)
        lo_age = int(body.get("demo_age_min") or 18)
        hi_age = int(body.get("demo_age_max") or 24)
        for r in rows:
            r["persona_description"] = _persona(lang)
            r["resp_age"] = random.randint(lo_age, hi_age)
            r["resp_gender"] = random.choice(["male", "female"])
        reply(route, {"rows": rows, "used_system_prompt": body["system_prompt"], "used_user_prompt": body["user_prompt"]})

    def worker_batch(route):
        body = route.request.post_data_json
        n = body["end_row"] - body["start_row"] + 1
        rows = [{"persona_description": _persona(lang), "resp_age": random.randint(18, 24),
                 "resp_gender": random.choice(["male", "female"])} for _ in range(n)]
        reply(route, {"rows": rows, "used_system_prompt": body["system_prompt"], "used_user_prompt": body["user_prompt"]})

    def survey_batch(route):
        body = route.request.post_data_json
        rows = _likert_rows(len(body["worker_ids"]), body["columns"], body["likert_min"], body["likert_max"],
                            body.get("qualitative_columns") or [], lang)
        for wid, r in zip(body["worker_ids"], rows):
            r["worker_id"] = wid
        reply(route, {"rows": rows, "used_system_prompt": body["system_prompt"], "used_user_prompt": body["user_prompt"]})

    def suggest_paths(route):
        body = route.request.post_data_json
        ids = {}
        for c in body["constructs"]:
            ids[_construct_of(c["indicators"][0]) if c.get("indicators") else c["name"]] = c["id"]
        pairs = [("PEOU", "PU"), ("PEOU", "ATT"), ("PU", "ATT"), ("PU", "INT"), ("ATT", "INT")]
        paths = [{"source": ids[a], "target": ids[b]} for a, b in pairs if a in ids and b in ids]
        reply(route, {"paths": paths, "rationale": t["rationale"], "moderator_suggestions": []})

    def ai_report(route):
        reply(route, {"report": t["report"]})

    ctx.route("**/api/ai_data_gen/suggest_constructs", suggest_constructs)
    ctx.route("**/api/ai_data_gen/batch", data_gen_batch)
    ctx.route("**/api/ai_worker/batch", worker_batch)
    ctx.route("**/api/ai_worker/survey_batch", survey_batch)
    ctx.route("**/api/ai_data_gen/suggest_paths", suggest_paths)
    ctx.route("**/api/ai_report", ai_report)


# --------------------------------------------------------------------------
# Capture helpers
# --------------------------------------------------------------------------

class Shooter:
    def __init__(self, lang: str, only: set[str] | None):
        self.lang = lang
        self.only = only
        self.dir = os.path.join(OUT_DIR, lang)
        os.makedirs(self.dir, exist_ok=True)
        self.saved = []

    def want(self, key: str) -> bool:
        return not self.only or key in self.only

    def _save(self, key: str, png: bytes):
        im = Image.open(io.BytesIO(png)).convert("RGB")
        if im.width > MAX_WIDTH:
            im = im.resize((MAX_WIDTH, round(im.height * MAX_WIDTH / im.width)), Image.LANCZOS)
        path = os.path.join(self.dir, f"{key}.webp")
        im.save(path, "WEBP", quality=82, method=6)
        self.saved.append(key)
        print(f"  [{self.lang}] {key}  {im.width}x{im.height}  {os.path.getsize(path) // 1024} KB")

    def element(self, key, locator, pad=0):
        if not self.want(key):
            return
        locator.scroll_into_view_if_needed()
        locator.page.wait_for_timeout(250)
        if pad:
            box = locator.bounding_box()
            png = locator.page.screenshot(full_page=True, clip={
                "x": max(0, box["x"] - pad), "y": max(0, box["y"] - pad + locator.page.evaluate("scrollY")),
                "width": box["width"] + 2 * pad, "height": box["height"] + 2 * pad})
        else:
            png = locator.screenshot()
        self._save(key, png)

    def union(self, key, page, selectors, pad=12):
        if not self.want(key):
            return
        boxes = [page.locator(s).first.bounding_box() for s in selectors]
        sy = page.evaluate("scrollY")
        x0 = min(b["x"] for b in boxes) - pad
        y0 = min(b["y"] for b in boxes) - pad + sy
        x1 = max(b["x"] + b["width"] for b in boxes) + pad
        y1 = max(b["y"] + b["height"] for b in boxes) + pad + sy
        self._save(key, page.screenshot(full_page=True, clip={"x": max(0, x0), "y": max(0, y0), "width": x1 - x0, "height": y1 - y0}))

    def viewport(self, key, page):
        if self.want(key):
            self._save(key, page.screenshot())

    def full(self, key, page):
        if self.want(key):
            self._save(key, page.screenshot(full_page=True))

    def modal(self, key, page):
        if not self.want(key):
            return
        page.add_style_tag(content=MODAL_CSS)
        page.wait_for_timeout(200)
        self._save(key, page.locator("#modalRoot .modal-box").first.screenshot())


def card(page, table_id):
    return page.locator(f"#{table_id}").locator("xpath=ancestor::div[contains(@class,'panel-card')][1]")


def new_context(browser, lang):
    ctx = browser.new_context(viewport=VIEWPORT, device_scale_factor=1.5)
    ctx.add_init_script(
        f"try {{ localStorage.setItem('plssem_lang', '{lang}'); localStorage.removeItem('websem_session_v1'); }} catch (e) {{}}"
    )
    ctx.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = "
        + json.dumps(CAPTURE_CSS) + "; document.head.appendChild(st); });"
    )
    install_ai_mocks(ctx, lang)
    return ctx


def open_popup(ctx, page, click_selector, wait_selector, timeout=180000):
    with ctx.expect_page() as info:
        page.click(click_selector)
    pg = info.value
    pg.set_viewport_size(VIEWPORT)
    pg.wait_for_load_state()
    pg.wait_for_selector(wait_selector, timeout=timeout)
    pg.wait_for_timeout(1200)
    return pg


def load_tam(page):
    page.goto(BASE + "/")
    page.wait_for_timeout(400)
    page.click("#sampleBtn")
    page.wait_for_selector("#panel-2.active")
    page.wait_for_timeout(700)


def run_analysis(page, results_sel="#resultsContent:not(.hidden)"):
    page.click("#runAnalysisBtn")
    page.wait_for_selector(results_sel, timeout=180000)
    page.wait_for_timeout(1500)


# --------------------------------------------------------------------------
# Scenes
# --------------------------------------------------------------------------

def scene_home_and_model(browser, s: Shooter):
    ctx = new_context(browser, s.lang)
    page = ctx.new_page()
    page.goto(BASE + "/")
    page.wait_for_timeout(600)
    s.viewport("01_home_upload", page)

    load_tam(page)
    page.evaluate("goToStep(1)")
    page.wait_for_timeout(300)
    page.locator("#dataPreviewWrap").scroll_into_view_if_needed()
    s.union("02_preview_table", page, ["#dataSourceTabs", "#dataPreviewWrap"])

    page.evaluate("goToStep(2)")
    page.wait_for_timeout(500)
    s.element("03_model_canvas", page.locator("#panel-2 .canvas-area"))

    page.evaluate("() => editor.setSelected({type:'node', id: editor.constructs[1].id})")
    page.wait_for_timeout(300)
    s.element("04_construct_panel", page.locator("#constructPanel"))
    page.evaluate("() => editor.setSelected(null)")
    page.wait_for_timeout(200)
    s.union("05_bootstrap_section", page, ["#constructPanel h3[data-i18n='s2_method_title']", "#bootstrapSection"])

    # --- Moderation (interaction term) walkthrough ---
    page.click("#addConstructBtn")
    page.fill("#modalCName", "PU × ATT")
    page.select_option("#modalCMode", "I")
    page.wait_for_timeout(200)
    s.modal("35_add_construct_modal", page)
    names = page.evaluate("editor.constructs.map(c => [c.id, c.name])")
    pu = next(i for i, n in names if "PU" in n or "hữu ích" in n.lower() or "Usefulness" in n)
    att = next(i for i, n in names if n in ("Attitude", "Thái độ") or "Attitude" in n)
    page.select_option("#modalSourceA", pu)
    page.select_option("#modalSourceB", att)
    s.modal("37_interaction_sources_picked", page)
    page.click("#modalOk")
    page.wait_for_timeout(300)
    page.evaluate("() => { const c = editor.constructs[editor.constructs.length - 1]; c.x = 330; c.y = 470; editor.render(); }")
    s.element("38_canvas_with_interaction_node", page.locator("#panel-2 .canvas-area"))
    page.evaluate("""() => {
        const inter = editor.constructs[editor.constructs.length - 1];
        const target = editor.constructs.find(c => c.indicators && c.indicators.some(i => i.startsWith('INT')));
        editor.addPath(inter.id, target.id); renderModelSummary();
    }""")
    page.wait_for_timeout(300)
    s.element("39_canvas_with_moderation_path", page.locator("#panel-2 .canvas-area"))

    run_analysis(page)
    if s.want("14b_simple_slopes"):
        page.locator("#simpleSlopesSection").scroll_into_view_if_needed()
        s.element("14b_simple_slopes", page.locator("#simpleSlopesSection"))
    ctx.close()


def scene_pls_results(browser, s: Shooter):
    ctx = new_context(browser, s.lang)
    page = ctx.new_page()
    load_tam(page)
    run_analysis(page)
    s.element("06_path_diagram_pls", page.locator("#resultsContent > .panel-card").first)
    for key, tid in [("07_reliability_table", "reliabilityTable"), ("08_outer_loadings", "loadingsTable"),
                     ("09_cross_loadings", "crossLoadingsTable"), ("10_fornell_larcker", "flTable"),
                     ("11_htmt_table", "htmtTable"), ("12_path_coefficients", "pathTable"),
                     ("13_total_indirect_effects", "totalEffectsTable"), ("13b_specific_indirect_effects", "specificIndirectTable"),
                     ("15_r2_q2", "r2Table"), ("16_vif_table", "vifTable"), ("17_cmb_table", "cmbTable")]:
        s.element(key, card(page, tid))
    s.element("18_bootstrap_distribution", page.locator("#bootstrapHistSection"))

    page.click("#plspredictBtn")
    page.wait_for_selector("#plspredictSection:not(.hidden) #plspredictTable tr", timeout=120000)
    page.wait_for_timeout(600)
    s.element("19_plspredict", page.locator("#plspredictSection"))

    page.click("#ipmaBtn")
    page.wait_for_selector("#ipmaModalOk")
    page.click("#ipmaModalOk")
    page.wait_for_selector("#ipmaSection:not(.hidden) #ipmaTable tr", timeout=120000)
    page.wait_for_timeout(800)
    s.element("20_ipma", page.locator("#ipmaSection"))

    # --- AI report ---
    page.click("#aiReportBtn")
    page.wait_for_selector("#aiModalOk")
    s.modal("21_ai_report_modal", page)
    page.fill("#aiApiKey", "sk-demo-••••••••••••••••")
    page.evaluate("() => { const r = document.getElementById('aiTemperature'); r.value = 0.4; r.dispatchEvent(new Event('input')); }")
    s.modal("22_ai_report_modal_filled", page)
    pg = open_popup(ctx, page, "#aiModalOk", "#aiContent:not(.hidden)")
    s.full("23_ai_report_output", pg)
    pg.close()

    # --- Sensitivity / power / ML ---
    page.click("#sensitivityBtn")
    page.wait_for_selector("#sensModalOk")
    s.modal("28_sensitivity_modal", page)
    pg = open_popup(ctx, page, "#sensModalOk", "#sensContent:not(.hidden)")
    s.full("29_sensitivity_page", pg)
    pg.close()

    page.click("#powerAnalysisBtn")
    page.wait_for_selector("#powerModalOk")
    s.modal("30_power_modal", page)
    pg = open_popup(ctx, page, "#powerModalOk", "#powerContent:not(.hidden)", timeout=400000)
    s.full("31_power_analysis_page", pg)
    pg.close()

    page.click("#mlCompareBtn")
    page.wait_for_selector("#mlModalOk")
    s.modal("32_ml_comparison_modal", page)
    pg = open_popup(ctx, page, "#mlModalOk", "#mlContent:not(.hidden)", timeout=400000)
    s.full("33_ml_comparison_page", pg)
    pg.close()
    ctx.close()


def scene_cbsem(browser, s: Shooter):
    ctx = new_context(browser, s.lang)
    page = ctx.new_page()
    load_tam(page)
    page.select_option("#estimationMethod", "cbsem")
    run_analysis(page, "#cbsemResultsContent:not(.hidden)")
    s.element("24_cbsem_fit_indices", card(page, "cbsemFitTable"))
    s.element("25_cbsem_reliability", card(page, "cbsemReliabilityTable"))
    s.element("26_cbsem_loadings", card(page, "cbsemLoadingsTable"))
    s.element("27_cbsem_path", card(page, "cbsemPathTable"))
    ctx.close()


def _upload_df(ctx, page, df, lang):
    resp = ctx.request.post(BASE + "/api/upload", multipart={
        "file": {"name": "survey.csv", "mimeType": "text/csv", "buffer": df.to_csv(index=False).encode()}, "lang": lang})
    page.evaluate("(d) => applyUploadResult(d)", resp.json())


def scene_mga_and_dummy(browser, s: Shooter):
    import pandas as pd

    df = pd.read_csv(SAMPLE_CSV)
    rng = np.random.default_rng(3)
    df["Gender"] = np.where(rng.random(len(df)) < 0.5, "Male", "Female")
    df["Education"] = rng.choice(["HighSchool", "Bachelor", "Master"], size=len(df), p=[0.25, 0.5, 0.25])

    ctx = new_context(browser, s.lang)
    page = ctx.new_page()
    load_tam(page)
    model = page.evaluate("() => ({constructs: editor.constructs, paths: editor.paths})")
    _upload_df(ctx, page, df, s.lang)
    page.evaluate("(m) => { goToStep(2); editor.loadFrom(m.constructs, m.paths); renderModelSummary(); }", model)
    page.wait_for_timeout(400)

    # --- Dummy variables ---
    page.click("#dummyBtn")
    page.wait_for_selector("#dummyCreate")
    page.select_option("#dummyColumn", "Education")
    page.click('input[name="dummyRef"][value="HighSchool"]')
    s.modal("40_dummy_modal", page)
    page.click("#dummyCreate")
    page.wait_for_timeout(600)
    page.evaluate("""() => {
        const target = editor.constructs.find(c => c.indicators.some(i => i.startsWith('INT')));
        editor.constructs.filter(c => c.name.startsWith('Education_')).forEach(c => editor.addPath(c.id, target.id));
        renderModelSummary();
    }""")
    page.wait_for_timeout(300)
    s.element("41_dummy_canvas", page.locator("#panel-2 .canvas-area"))

    # --- PLS-MGA ---
    page.evaluate("""() => { editor.constructs.filter(c => c.name.startsWith('Education_')).forEach(c => editor.removeConstruct(c.id)); renderModelSummary(); }""")
    run_analysis(page)
    page.click("#mgaBtn")
    page.wait_for_selector("#mgaModalOk")
    page.select_option("#mgaColumn", "Gender")
    page.wait_for_timeout(300)
    page.evaluate("""() => {
      const a = document.querySelector('#mgaGroupAValues input[data-value="Male"]'); if (a) a.checked = true;
      const b = document.querySelector('#mgaGroupBValues input[data-value="Female"]'); if (b) b.checked = true;
    }""")
    s.modal("42_mga_modal", page)
    pg = open_popup(ctx, page, "#mgaModalOk", "#mgaContent:not(.hidden)", timeout=400000)
    s.full("43_mga_page", pg)
    pg.close()
    ctx.close()


def _fill_codebook(page, lang, tbody, with_open=True):
    t = TXT[lang]
    page.evaluate(f"document.getElementById('{tbody}').innerHTML = ''")
    for name, code, _cite, _doi, items in t["constructs"]:
        for i, q in enumerate(items):
            page.evaluate("([c, q, n, tb]) => codebookAddRow(c, q, n, 'likert', tb)", [f"{code}{i + 1}", q, name, tbody])
    if with_open:
        page.evaluate("([q, tb]) => codebookAddRow('OPEN1', q, '', 'qualitative', tb)", [t["open_q"], tbody])


def scene_ai_lab(browser, s: Shooter):
    t = TXT[s.lang]
    ctx = new_context(browser, s.lang)
    page = ctx.new_page()
    page.goto(BASE + "/")
    page.wait_for_timeout(500)
    page.click('button.ai-provider-tab[data-source="ai_gen"]')
    page.wait_for_timeout(300)
    page.fill("#aiGenApiKey", "sk-demo-key")
    s.element("44_ai_lab_overview", page.locator("#panel-1 .panel-card").first)

    page.click("#constructSearchToggleBtn")
    page.fill("#constructSearchTopic", t["topic"])
    page.fill("#constructSearchCount", "4")
    page.click("#constructSearchRunBtn")
    page.wait_for_selector("#constructSearchResults:not(.hidden)")
    page.wait_for_timeout(400)
    s.element("45_ai_lab_construct_search", page.locator(".ai-gen-construct-search"), pad=16)
    page.click("#constructSearchAddBtn")
    page.wait_for_timeout(300)
    page.evaluate("([q]) => codebookAddRow('OPEN1', q, '', 'qualitative', 'codebookTableBody')", [t["open_q"]])
    s.element("46_ai_lab_codebook", page.locator("#aiGenStep1"), pad=16)

    page.click("#codebookNextBtn")
    page.wait_for_timeout(300)
    page.fill("#demoAgeMin", "18")
    page.fill("#demoAgeMax", "24")
    page.select_option("#demoGenderMix", "balanced")
    page.fill("#demoOccupation", t["occupation"])
    page.fill("#demoLocation", t["location"])
    page.fill("#demoTargetPopulation", t["target"])
    s.element("47_ai_lab_respondents", page.locator("#aiGenStep2"), pad=16)

    page.click("#demoNextBtn")
    page.wait_for_timeout(300)
    page.fill("#aiGenNRows", "150")
    page.dispatch_event("#aiGenNRows", "change")
    page.wait_for_timeout(1200)
    s.element("48_ai_lab_config", page.locator("#aiGenStep3"), pad=16)

    page.click("#aiGenStartBtn")
    page.wait_for_selector("#aiGenResultExtra:not(.hidden)", timeout=120000)
    page.wait_for_timeout(1000)
    s.union("49_ai_lab_result", page, ["#dataPreviewWrap", "#aiGenResultExtra"])

    # Step 2: model seeded from the codebook, AI path drawing, AI-rater.
    page.click("#toStep2Btn")
    page.wait_for_timeout(700)
    page.click("#aiDrawPathsBtn")
    page.wait_for_selector("#aiPathsRun")
    page.fill("#aiPathsApiKey", "sk-demo-key")
    page.click("#aiPathsRun")
    page.wait_for_selector("#aiPathsPromptSend")
    page.wait_for_timeout(300)
    page.click("#aiPathsPromptSend")
    page.wait_for_selector("#aiPathsApply")
    page.wait_for_timeout(400)
    s.modal("50_ai_draw_model", page)
    page.click("#aiPathsApply")
    page.wait_for_timeout(500)

    page.wait_for_selector("#qualScoreBtn:not(.hidden)")
    page.click("#qualScoreBtn")
    page.wait_for_selector("#qualScoreRun")
    page.fill("#qualScoreRubric", t["rubric"])
    page.fill("#qualScoreApiKey", "sk-demo-key")
    s.modal("51_qual_score_modal", page)
    page.evaluate("document.getElementById('modalRoot').innerHTML = ''")
    s.element("52_ai_lab_model", page.locator("#panel-2 .canvas-area"))
    ctx.close()


def scene_experiment(browser, s: Shooter):
    t = TXT[s.lang]
    ctx = new_context(browser, s.lang)
    page = ctx.new_page()
    page.goto(BASE + "/")
    page.wait_for_timeout(500)
    page.click('button.ai-provider-tab[data-source="ai_experiment"]')
    page.wait_for_timeout(300)
    page.fill("#expApiKey", "sk-demo-key")
    for sel, val in [("#expDemoAgeMin", "18"), ("#expDemoAgeMax", "24"), ("#expDemoOccupation", t["occupation"]),
                     ("#expDemoLocation", t["location"]), ("#expDemoTargetPopulation", t["target"])]:
        if page.locator(sel).count():
            page.fill(sel, val)
    if page.locator("#expNWorkers").count():
        page.fill("#expNWorkers", "120")
        page.dispatch_event("#expNWorkers", "change")
    page.wait_for_timeout(1000)
    s.element("53_exp_pool_definition", page.locator("#expStep1"), pad=16)

    page.click("#expGenerateBtn")
    page.wait_for_selector("#expStep2.active", timeout=120000)
    page.wait_for_timeout(800)
    s.element("54_exp_pool_ready", page.locator("#expStep2"), pad=16)

    page.click("#expPoolNextBtn")
    page.wait_for_timeout(300)
    page.fill("#expSharedContext", t["context"])
    page.evaluate("document.getElementById('expGroupsTableBody').innerHTML = ''")
    page.evaluate("([a, b]) => { expGroupAddRow(a, 50); expGroupAddRow(b, 50); }", t["manip"])
    page.fill("#expM", "100")
    page.click("#expSelectBtn")
    page.wait_for_timeout(800)
    _fill_codebook(page, s.lang, "expCodebookTableBody")
    s.element("55_exp_design", page.locator("#expStep3"), pad=16)

    page.click("#expSurveyPreviewBtn")
    page.wait_for_timeout(1200)
    s.element("56_exp_survey_prompt", page.locator("#expStep3"), pad=16)
    page.click("#expSurveyStartBtn")
    page.wait_for_selector("#aiGenResultExtra:not(.hidden)", timeout=180000)
    page.wait_for_timeout(1000)
    s.union("57_exp_result", page, ["#dataPreviewWrap", "#aiGenResultExtra"])
    ctx.close()


SCENES = [scene_home_and_model, scene_pls_results, scene_cbsem, scene_mga_and_dummy, scene_ai_lab, scene_experiment]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", choices=["vi", "en"], action="append")
    ap.add_argument("--only", help="comma-separated image keys")
    ap.add_argument("--scene", help="comma-separated scene function names")
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()
    only = set(args.only.split(",")) if args.only else None
    scenes = [f for f in SCENES if not args.scene or f.__name__ in args.scene.split(",")]
    random.seed(11)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not args.headed)
        for lang in args.lang or ["vi", "en"]:
            shooter = Shooter(lang, only)
            for scene in scenes:
                print(f"== {lang}: {scene.__name__}")
                try:
                    scene(browser, shooter)
                except Exception as exc:  # noqa: BLE001 -- keep going, report at the end
                    print(f"  !! {scene.__name__} failed: {str(exc)[:300]}")
        browser.close()


if __name__ == "__main__":
    main()
