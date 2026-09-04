#!/usr/bin/env python3
"""Build docs/demo-transcribe-cmd-guide.pdf"""
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import Paragraph, Preformatted, SimpleDocTemplate, Spacer, Table, TableStyle

FONT = "MSung-Light"
OUT = "/workspace/docs/demo-transcribe-cmd-guide.pdf"

pdfmetrics.registerFont(UnicodeCIDFont(FONT))


def S(name, **kw):
    base = {"fontName": FONT, "fontSize": 10, "leading": 15}
    base.update(kw)
    return ParagraphStyle(name, **base)


TITLE = S("title", fontSize=20, leading=26, textColor=colors.HexColor("#0d3b66"), spaceAfter=6)
SUB = S("sub", fontSize=11, textColor=colors.HexColor("#555555"), spaceAfter=10)
H2 = S("h2", fontSize=13, leading=18, textColor=colors.HexColor("#0d3b66"), spaceBefore=14, spaceAfter=6)
BODY = S("body", spaceAfter=4)
CODE = S("code", fontSize=8, leading=11, backColor=colors.HexColor("#1e2a38"), textColor=colors.white, leftIndent=8, rightIndent=8, spaceAfter=8)
WARN = S("warn", backColor=colors.HexColor("#fff8e6"), borderPadding=8, spaceAfter=8)


def pre(text: str):
    return Preformatted(text.strip(), CODE)


def build():
    doc = SimpleDocTemplate(
        OUT,
        pagesize=A4,
        leftMargin=16 * mm,
        rightMargin=16 * mm,
        topMargin=14 * mm,
        bottomMargin=14 * mm,
        title="DEMO 轉錄 CMD 操作手冊",
    )
    s = []

    s.append(Paragraph("DEMO 錄影轉逐字稿", TITLE))
    s.append(Paragraph("CMD 命令提示字元操作手冊", SUB))
    s.append(Paragraph("全程本機處理，音檔不上傳雲端｜適用 1～2 小時 DEMO 錄影", SUB))

    s.append(Paragraph("一、整體流程", H2))
    s.append(
        Paragraph(
            "DEMO 錄影 MP4 → 放入 input 資料夾 → CMD 執行轉錄 → 等待 1.5～3 小時（接電源）"
            " → output 取 .srt → 上傳 Sales Call Coach 分析",
            BODY,
        )
    )

    s.append(Paragraph("二、資料夾結構", H2))
    s.append(
        pre(
            r"""C:\Users\你的帳號\demo-workspace\
├── .env              ← Token（勿分享）
├── .venv\Scripts\whisperx.exe  ← ★ 轉錄用這個
├── input\            ← ★ MP4 放這裡
└── output\           ← ★ SRT 在這裡"""
        )
    )
    s.append(
        Paragraph(
            "<b>⚠ 常見錯誤：</b>路徑要寫 <font color='#c0392b'>.venv\\Scripts\\whisperx.exe</font>，"
            "不是 Scripts\\whisperx.exe（少了 .venv\\ 會找不到檔案）。",
            WARN,
        )
    )

    s.append(Paragraph("三、如何開啟 CMD", H2))
    s.append(Paragraph("1. 開啟 demo-workspace 資料夾", BODY))
    s.append(Paragraph("2. 點上方網址列，輸入 cmd，按 Enter", BODY))
    s.append(Paragraph("3. 出現黑底白字視窗即為 CMD（轉錄中勿關閉）", BODY))

    s.append(Paragraph("四、第一次使用（只需一次）", H2))
    s.append(Paragraph("4-1 安裝 Python：https://www.python.org/downloads/（勾選 Add to PATH）", BODY))
    s.append(Paragraph("4-2 安裝 ffmpeg：winget install Gyan.FFmpeg", BODY))
    s.append(Paragraph("4-3 安裝 WhisperX：", BODY))
    s.append(
        pre(
            r"""cd /d C:\Users\你的帳號\demo-workspace
python -m venv .venv
.venv\Scripts\python.exe -m pip install -U pip wheel
.venv\Scripts\python.exe -m pip install whisperx"""
        )
    )
    s.append(Paragraph("4-4 .env 填入 HF_TOKEN=hf_你的token，並到 Hugging Face 同意三個 pyannote 模型", BODY))

    s.append(Paragraph("五、每次轉 DEMO（重點）", H2))
    s.append(Paragraph("步驟 1：MP4 放入 input\\（建議檔名 demo.mp4，避免 demo.mp4.mp4 雙副檔名）", BODY))
    s.append(Paragraph("步驟 2～6：在 CMD 依序執行以下指令（把「你的帳號」改成實際名稱，例如經銷業務）", BODY))
    s.append(
        pre(
            r"""cd /d C:\Users\你的帳號\demo-workspace
set HF_HOME=%CD%\models
set HUGGINGFACE_HUB_CACHE=%CD%\models\hub
for /f "usebackq tokens=1,* delims==" %a in (".env") do if /i "%a"=="HF_TOKEN" set HF_TOKEN=%b
ffmpeg -y -i input\demo.mp4 -vn -ac 1 -ar 16000 -c:a pcm_s16le input\demo.wav
.venv\Scripts\whisperx.exe input\demo.wav --model medium --language zh --device cpu --compute_type int8 --threads 8 --batch_size 4 --diarize --hf_token %HF_TOKEN% --min_speakers 2 --max_speakers 2 --output_format srt --output_dir output
dir output\*.srt"""
        )
    )
    s.append(Paragraph("2 小時 DEMO 在 Intel 內顯 CPU 筆電約需 1.5～3 小時，請接電源。", WARN))

    s.append(Paragraph("六、上傳 Call Coach", H2))
    s.append(Paragraph("網址：https://minoru1017.github.io/For-company-business-use/", BODY))
    s.append(Paragraph("上傳 output\\ 的 .srt → 確認 SPEAKER_00＝顧問 → 對調則「全部互換」→ 開始分析", BODY))

    s.append(Paragraph("七、常見問題", H2))
    data = [
        ["錯誤", "解法"],
        ["系統找不到路徑", "確認 .venv\\Scripts\\whisperx.exe（有 .venv\\）"],
        ["找不到 demo.mp4", "MP4 放 input\\，檢查雙副檔名 demo.mp4.mp4"],
        ["gated repo", "檢查 .env 的 HF_TOKEN，同意三個 pyannote 模型"],
        [".bat 無法執行", "用本手冊 CMD 指令，不用 .bat"],
    ]
    t = Table(data, colWidths=[45 * mm, 120 * mm])
    t.setStyle(
        TableStyle(
            [
                ("FONT", (0, 0), (-1, -1), FONT, 9),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0d3b66")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f7f9fb")]),
            ]
        )
    )
    s.append(t)
    s.append(Spacer(1, 8))
    s.append(
        Paragraph(
            "隱私：DEMO 錄影與逐字稿存公司受控位置；勿分享 .env；Gemini 分析前先去識別化。",
            BODY,
        )
    )

    doc.build(s)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    build()
