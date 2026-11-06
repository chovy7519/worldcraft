"""Optional Chromium integration test using standalone HTML injection.
The execution environment may block localhost; inline content avoids network access.
Requires: pip install playwright and an installed Chromium binary.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
HTML = (ROOT / "worldcraft.html").read_text(encoding="utf-8")
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path="/usr/bin/chromium", headless=True,
                                args=["--no-sandbox", "--disable-dev-shm-usage"])
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors=[]
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.set_content(HTML, wait_until="domcontentloaded")
    page.locator('[data-dock="roads"]').click()
    page.locator('#road-enable').click()
    assert "EDITABLE" in page.locator('#road-editor-badge').inner_text()
    page.locator('path[data-road-edge]').first.click(force=True)
    assert page.locator('#road-bend-input').count()==1
    page.locator('#road-bend-input').fill('8')
    page.locator('#road-bend-input').dispatch_event('change')
    assert page.locator('path[data-road-edge][d*=" Q "]').count()>0
    assert not errors, errors
    print('BROWSER_V06_PASS: node graph editing, curve input, SVG path update, no JS pageerror')
    browser.close()
