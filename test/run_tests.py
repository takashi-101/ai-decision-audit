"""テストをコマンドから走らせる。

公開フォルダをローカルで配信し、Google Chrome（または Microsoft Edge）を画面なしで起動して
test/index.html を開き、結果（PASS/FAIL）を表示する。本物のAPIには接続しない。

    python test/run_tests.py            テストを走らせる
    python test/run_tests.py --shots    画面写真も撮る（375px と 1280px、ライト／ダーク）
"""
import functools
import http.server
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHOT_DIR = ROOT / "test" / "screenshots"
DOC_IMG_DIR = ROOT / "docs" / "images"

BROWSER_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
]


def find_browser():
    for name in ("google-chrome", "chromium", "chrome", "msedge"):
        p = shutil.which(name)
        if p:
            return p
    for p in BROWSER_CANDIDATES:
        if os.path.exists(p):
            return p
    sys.exit("Chrome または Edge が見つかりません。")


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def start_server():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"


def headless(browser, args, profile):
    cmd = [browser, "--headless=new", "--disable-gpu", "--no-first-run",
           "--hide-scrollbars", f"--user-data-dir={profile}"] + args
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)


def run_tests(browser, base, profile):
    r = headless(browser, ["--virtual-time-budget=30000", "--window-size=1280,900",
                           "--dump-dom", f"{base}/test/index.html"], profile)
    dom = r.stdout
    m = re.search(r"<title>(.*?)</title>", dom)
    title = m.group(1) if m else "(結果を読めませんでした)"
    print("結果:", title)
    for li in re.findall(r'<li class="(pass|fail)">(.*?)(?:<pre>(.*?)</pre>)?</li>', dom, re.S):
        mark = "  OK " if li[0] == "pass" else "  NG "
        print(mark + re.sub(r"<[^>]+>", "", li[1]))
        if li[2]:
            print("       " + li[2].strip().splitlines()[0])
    return title.startswith("PASS")


def take_shots(browser, base, profile):
    SHOT_DIR.mkdir(parents=True, exist_ok=True)
    DOC_IMG_DIR.mkdir(parents=True, exist_ok=True)
    shots = [
        # (ファイル名, 幅, 高さ, 問い合わせ, ダーク)
        ("pc-1280-top.png", 1280, 1100, "", False),
        ("pc-1280-result.png", 1280, 1300, "example=counter&to=result&decide=1", False),
        ("pc-1280-result-dark.png", 1280, 1300, "example=meeting&to=result&decide=1", True),
        ("sp-375-top.png", 375, 1400, "", False),
        ("sp-375-result.png", 375, 1600, "example=course&to=result", False),
        ("sp-375-list.png", 375, 1600, "example=course&to=list&decide=1", False),
        ("sp-375-list-dark.png", 375, 1600, "example=course&to=list&decide=1", True),
    ]
    for name, width, height, query, dark in shots:
        out = SHOT_DIR / name
        args = ["--virtual-time-budget=5000", f"--window-size={width},{height}",
                f"--screenshot={out}"]
        if dark:
            args.append("--force-dark-mode")
            args.append("--blink-settings=preferredColorScheme=0")
        headless(browser, args + [f"{base}/test/shot.html?{query}"], profile)
        print(("  撮影 " if out.exists() else "  失敗 ") + str(out.relative_to(ROOT)))
    # README 用の2枚
    for src, dst in (("pc-1280-result.png", "screen-pc.png"), ("sp-375-list.png", "screen-sp.png")):
        if (SHOT_DIR / src).exists():
            shutil.copyfile(SHOT_DIR / src, DOC_IMG_DIR / dst)


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    browser = find_browser()
    httpd, base = start_server()
    profile = tempfile.mkdtemp(prefix="audit-test-")
    try:
        passed = run_tests(browser, base, profile)
        if "--shots" in sys.argv:
            take_shots(browser, base, profile)
    finally:
        httpd.shutdown()
        shutil.rmtree(profile, ignore_errors=True)
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
