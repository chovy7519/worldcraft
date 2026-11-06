"""Browser acceptance: PCG geometry, UI-driven parameter editing, persistence and graph routing."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-angle=swiftshader','--disable-gpu-sandbox'])
    page=browser.new_page(viewport={'width':1660,'height':1020},accept_downloads=True)
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.set_content((ROOT/'worldcraft.html').read_text(encoding='utf-8'),wait_until='load')
    page.wait_for_timeout(450)
    assert page.locator('.graph-node').count()==12, f"node count {page.locator('.graph-node').count()}"
    assert '12 个模块' in page.locator('#graph-status').inner_text()
    metrics=page.locator('#metric-strip').inner_text()
    assert all(v in metrics for v in ['BUILDINGS','ROADS','PARKS','TREES','PARCELS','PARK AREA']),metrics
    assert '道路网络' in page.locator('#scene-tree').inner_text()
    page.screenshot(path=str(ROOT/'preview-spatial-v0.3.png'),full_page=True)
    # Modify road spacing through a typed spatial graph parameter
    page.locator('[data-node="roads"] .graph-node-head').click()
    page.locator('[data-graph-param="roadSpacing"]').fill('80')
    page.locator('[data-graph-param="roadSpacing"]').press('Tab')
    assert page.locator('[data-graph-param="roadSpacing"]').input_value()=='80'
    modified=page.locator('#metric-strip').inner_text()
    assert modified!=metrics,(metrics,modified)
    assert '已执行' in page.locator('#command-feedback').inner_text()
    page.locator('#undo-btn').click()
    assert page.locator('#metric-strip').inner_text()==metrics
    page.locator('#redo-btn').click()
    assert page.locator('#metric-strip').inner_text()==modified
    # Natural language updates park proportion and real generated land use
    page.locator('[data-dock="command"]').click()
    page.locator('#command-input').fill('公园比例设为 35%')
    page.locator('#send-btn').click()
    assert '已执行' in page.locator('#command-feedback').inner_text()
    page.locator('[data-dock="graph"]').click()
    page.locator('[data-node="landuse"] .graph-node-head').click()
    assert page.locator('[data-graph-param="parkShare"]').input_value()=='0.35'
    # Graph optional feature toggling with always-on spatial stages
    page.locator('[data-node="plaza"] .graph-node-head').click()
    page.locator('[data-graph-toggle="plaza"]').click()
    assert '11 个模块' in page.locator('#graph-status').inner_text()
    page.locator('#undo-btn').click()
    assert '12 个模块' in page.locator('#graph-status').inner_text()
    # Scene file contains both schema and graph version
    with page.expect_download() as pending: page.locator('#export-btn').click()
    filepath=ROOT/'test-export-v0.3.json'
    pending.value.save_as(str(filepath))
    data=json.loads(filepath.read_text(encoding='utf-8'))
    assert data['world']['schemaVersion']==2 and data['graph']['version']==2
    page.locator('#graph-reset-btn').click()
    page.locator('#import-file').set_input_files(str(filepath))
    page.wait_for_timeout(150)
    assert not errors,errors
    filepath.unlink(missing_ok=True)
    print('PASS: 12-stage graph, road/parcel/park/tree metrics, node param updates, undo/redo, NL park edit, optional routing, JSON export/import')
    browser.close()
