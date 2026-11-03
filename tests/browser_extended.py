from playwright.sync_api import sync_playwright
from pathlib import Path
from tempfile import TemporaryDirectory
root=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--disable-web-security','--disable-gpu-sandbox'])
    page=browser.new_page(viewport={'width':1500,'height':960},accept_downloads=True)
    errors=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.set_content((root/'worldcraft.html').read_text(encoding='utf-8'),wait_until='load')
    page.wait_for_timeout(1000)
    # Select a building directly in the viewport via camera/world ray picking.
    canvas=page.locator('#world-canvas')
    selected=False
    for xy in [(480,420),(525,380),(570,330),(700,420),(390,440),(610,520),(740,490)]:
      canvas.click(position={'x':xy[0],'y':xy[1]},force=True)
      page.wait_for_timeout(60)
      if 'B-' in page.locator('#object-inspector').inner_text():
        selected=True
        print('selected building',page.locator('#object-inspector').inner_text().splitlines()[0]);break
    print('building selection',selected)
    # Verify camera rotation does not throw errors.
    bbox=canvas.bounding_box()
    page.mouse.move(bbox['x']+450,bbox['y']+250)
    page.mouse.down()
    page.mouse.move(bbox['x']+510,bbox['y']+310,steps=8)
    page.mouse.up()
    page.wait_for_timeout(100)
    # Export and re-import current scene.
    with page.expect_download() as download_info:
      page.locator('#export-btn').click()
    download=download_info.value
    with TemporaryDirectory() as tmp:
      filepath=Path(tmp)/download.suggested_filename
      download.save_as(filepath)
      import json
      doc=json.loads(filepath.read_text())
      print('export schema',doc['format'],doc['version'],doc['world']['seed'])
      page.locator('#command-input').fill('中央开放空间扩大20%')
      page.locator('#command-form').locator('button[type="submit"]').click()
      page.wait_for_timeout(100)
      page.locator('#import-file').set_input_files(str(filepath))
      page.wait_for_timeout(200)
      print('import plaza radius restored',page.locator('#global-rules').inner_text().find('60m')>=0)
    print('no JS errors',not errors,errors)
    mobile=browser.new_page(viewport={'width':390,'height':844},device_scale_factor=1)
    mobile.set_content((root/'worldcraft.html').read_text(encoding='utf-8'),wait_until='load')
    mobile.wait_for_timeout(600)
    mobile.screenshot(path=str(root/'preview-mobile.png'),full_page=True)
    print('mobile viewport rendered',mobile.locator('#world-canvas').evaluate('(e)=>e.width>0 && e.height>0'))
    browser.close()
