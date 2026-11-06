"""Browser-level PCG Graph smoke test: python tests/browser_graph.py (requires Playwright)."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-angle=swiftshader','--disable-gpu-sandbox'])
    page=browser.new_page(viewport={'width':1550,'height':980},accept_downloads=True)
    errors=[]
    page.on('pageerror',lambda error: errors.append(str(error)))
    page.set_content((ROOT/'worldcraft.html').read_text(encoding='utf-8'),wait_until='load')
    page.wait_for_timeout(450)
    assert page.locator('.graph-node').count()==7
    assert '7 个节点' in page.locator('#graph-status').inner_text()
    original=page.locator('#metric-strip').inner_text()
    page.locator('[data-port="out"][data-node-id="grid"]').click()
    page.locator('[data-port="in"][data-node-id="density"]').click()
    assert '5 个节点' in page.locator('#graph-status').inner_text()
    assert '0 m²' in page.locator('#metric-strip').inner_text()
    page.locator('#undo-btn').click()
    assert page.locator('#metric-strip').inner_text()==original
    page.locator('#redo-btn').click()
    assert '5 个节点' in page.locator('#graph-status').inner_text()
    page.locator('[data-node="density"] .graph-node-head').click()
    density=page.locator('[data-graph-param="eastDensity"]')
    density.fill('0.25');density.press('Tab')
    assert page.locator('[data-graph-param="eastDensity"]').input_value()=='0.25'
    page.locator('[data-dock="command"]').click()
    page.locator('#command-input').fill('禁用高度梯度')
    page.locator('#send-btn').click()
    assert '4 个节点' in page.locator('#graph-status').inner_text()
    with page.expect_download() as pending:
        page.locator('#export-btn').click()
    path=ROOT/'test-export-v0.2.json'
    pending.value.save_as(str(path))
    data=json.loads(path.read_text(encoding='utf-8'))
    assert data['graph']['version']==1 and len(data['graph']['nodes'])==7
    page.locator('[data-dock="graph"]').click()
    page.locator('#graph-reset-btn').click()
    assert '7 个节点' in page.locator('#graph-status').inner_text()
    page.locator('#import-file').set_input_files(str(path))
    page.wait_for_function('document.querySelector("#graph-status").textContent.includes("4 个节点")')
    assert '4 个节点' in page.locator('#graph-status').inner_text()
    path.unlink(missing_ok=True)
    assert not errors,errors
    print('PASS: graph wire editing, computed scene effect, undo/redo, parameters, NL toggle, JSON export/import')
    browser.close()
