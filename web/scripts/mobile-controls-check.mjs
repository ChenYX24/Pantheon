// Synthetic mobile -> browser -> upload/WebSocket -> real PTY acceptance.
// No real Agent, production data, user credentials or live-session resize.
import { chromium } from 'playwright'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import { rows } from './lib/screen.mjs'
const binary=resolve(process.argv[2]), evidence=resolve(process.argv[3]), baseline=process.argv.includes('--baseline')
const data=mkdtempSync(join(tmpdir(),'vp-mobile-controls-')), projectDir=join(data,'project'), fakeHome=join(data,'home')
mkdirSync(projectDir);mkdirSync(fakeHome)
const socket=`vp-mobile-${process.pid}`
const port=await new Promise(yes=>{const s=createServer().listen(0,'127.0.0.1',()=>{const n=s.address().port;s.close(()=>yes(n))})})
const base=`http://127.0.0.1:${port}`, sleep=ms=>new Promise(r=>setTimeout(r,ms))
const fixture=join(data,'fixture.py'), statePath=join(data,'input.json')
writeFileSync(fixture,String.raw`import os,sys,tty,termios,json,signal
old=termios.tcgetattr(0);tty.setraw(0);buf=b''
def draw(*_):
 cols,rows=os.get_terminal_size(0)
 sys.stdout.write('\x1b[H\x1b[2J'+'SYNTHETIC_GRID_%dx%d'%(cols,rows)+'\r\n'+' | '.join(['content']*max(1,cols//10))+'\r\nREADY_FOR_KEYS_AND_PHOTO');sys.stdout.flush()
def save():
 with open(sys.argv[1]+'.new','w') as f:json.dump({'hex':buf.hex(),'cols':os.get_terminal_size(0).columns},f)
 os.replace(sys.argv[1]+'.new',sys.argv[1])
signal.signal(signal.SIGWINCH,draw)
try:
 draw();save()
 while True:
  buf+=os.read(0,4096);save()
finally:termios.tcsetattr(0,termios.TCSANOW,old)
`)
const server=spawn(binary,['serve','--addr',`127.0.0.1:${port}`,'--data-dir',data,'--tmux-socket',socket,'--tls','off','--isolation','off'],{env:{HOME:fakeHome,PATH:'/usr/bin:/bin',TERM:'xterm-256color'},stdio:['ignore','pipe','pipe']})
let log='',cookie='',browser;server.stdout.on('data',x=>log+=x);server.stderr.on('data',x=>log+=x)
const until=async(fn,msg)=>{for(let i=0;i<60;i++){if(await fn())return;await sleep(100)}throw Error(msg)}
const api=async(path,body,method)=>{const res=await fetch(base+path,{method:method??(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json',Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)});if(!res.ok)throw Error(path+': '+res.status);if(path==='/api/auth/setup')cookie=res.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');return res.status===204?null:res.json()}
const checks=[],failures=[],metrics=[],uploaded=[]
const check=(ok,label)=>{(ok?checks:failures).push(label)}
try{
 await until(async()=>{try{return(await fetch(base+'/api/health')).ok}catch{return false}},'fixture not ready')
 const token=/one-time setup token:\s*\n\s*\n\s*(\S+)/.exec(log)?.[1];if(!token)throw Error('fixture setup not ready; log withheld')
 await api('/api/auth/setup',{token,username:'fixture',password:'synthetic-mobile-only-password'})
 await api('/api/settings/tour',{})
 await api('/api/update/settings',{autoCheck:false},'PUT')
 const project=await api('/api/projects',{name:'Mobile fixture',path:projectDir})
 const session=await api('/api/sessions',{projectId:project.id,title:'Mobile fixture',cols:123,rows:35,command:['/usr/bin/python3',fixture,statePath]})
 browser=await chromium.launch({headless:true,args:['--no-proxy-server']})
 for(const width of [320,360,390]){
  const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2})
  await context.addInitScript(()=>localStorage.setItem('vibepanel.renderer','dom'))
  const page=await context.newPage();await page.goto(base+'/?session='+session.id)
  await page.locator('[data-testid="auth-username"]').fill('fixture');await page.locator('[data-testid="auth-password"]').fill('synthetic-mobile-only-password');await page.locator('[data-testid="auth-submit"]').click()
  await page.locator('[data-testid="compose-input"]').waitFor();await page.waitForTimeout(350)
  const m=await page.evaluate(()=>{const ids=['compose-input','compose-attach','compose-attach-file','compose-send','key-backspace','key-delete','key-up','key-down','key-left','key-right'];return Object.fromEntries(ids.map(id=>{const e=document.querySelector(`[data-testid="${id}"]`);if(!e)return[id,null];const r=e.getBoundingClientRect();return[id,{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,visible:r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight}]}))})
  metrics.push({width,controls:m})
  check(!!m['key-backspace']?.visible,`backspace visible at ${width}px`)
  check(!!m['key-delete']?.visible,`forward delete visible at ${width}px`)
  check(!!m['compose-attach']?.visible,`photo chooser visible at ${width}px`)
  check(!!m['compose-send']?.visible,`send control visible at ${width}px`)
  if(!baseline){
   check(!!m['compose-attach-file']?.visible,`general file chooser remains visible at ${width}px`)
   check(['up','down','left','right'].every(k=>m['key-'+k]?.visible),`arrows remain reachable without scrolling at ${width}px`)
   check(await page.locator('[data-testid="compose-photo-file"]').getAttribute('accept')==='image/*',`dedicated photo filter at ${width}px`)
  }
  await page.locator('[data-testid="compose-input"]').fill('KEEP_DRAFT')
  if(m['key-backspace']&&m['key-delete']){
   const before=JSON.parse(readFileSync(statePath)).hex
   await page.locator('[data-testid="key-backspace"]').tap();await page.locator('[data-testid="key-delete"]').tap()
   await until(()=>JSON.parse(readFileSync(statePath)).hex.length>before.length,'editing keys did not arrive')
   const delta=Buffer.from(JSON.parse(readFileSync(statePath)).hex.slice(before.length),'hex')
   check(delta.equals(Buffer.from('\x7f\x1b[3~')),`editing bytes exact and not submitted at ${width}px`)
   check(await page.locator('[data-testid="compose-input"]').inputValue()==='KEEP_DRAFT',`terminal edit keys preserve local draft at ${width}px`)
  }
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')
  if(m['compose-attach']?.visible){
   for(let n=0;n<2;n++){
    const before=JSON.parse(readFileSync(statePath)).hex
    const pending=page.waitForEvent('filechooser',{timeout:3000});await page.locator('[data-testid="compose-attach"]').tap();const chooser=await pending
    const res=page.waitForResponse(r=>r.url().includes('/upload')&&r.request().method()==='POST',{timeout:5000})
    await chooser.setFiles({name:`photo-${width}.png`,mimeType:'image/png',buffer:png});const response=await res
    check(response.status()===200,`photo upload ${n+1} succeeds at ${width}px`)
    if(response.ok()){
     const {paths}=await response.json();uploaded.push(...paths)
     check(paths.length===1&&readFileSync(paths[0]).equals(png),`uploaded photo bytes intact at ${width}px, selection ${n+1}`)
     await until(()=>JSON.parse(readFileSync(statePath)).hex.length>before.length,'photo path not sent')
     const delta=Buffer.from(JSON.parse(readFileSync(statePath)).hex.slice(before.length),'hex').toString()
     check(delta.includes(paths[0])&&!/[\r\n]/.test(delta),`photo path inserted once without submit at ${width}px, selection ${n+1}`)
    }
   }
   check(await page.locator('[data-testid="compose-input"]').inputValue()==='KEEP_DRAFT',`photo upload preserves local draft at ${width}px`)
   if(!baseline){
    let requests=0;const count=r=>{if(r.url().includes('/upload')&&r.method()==='POST')requests++};page.on('request',count)
    const before=JSON.parse(readFileSync(statePath)).hex
    const pending=page.waitForEvent('filechooser');await page.locator('[data-testid="compose-attach"]').tap();await (await pending).setFiles([]);await sleep(150)
    check(requests===0&&JSON.parse(readFileSync(statePath)).hex===before,`cancelled photo choice sends nothing at ${width}px`)
    page.off('request',count)
    const filePending=page.waitForEvent('filechooser');await page.locator('[data-testid="compose-attach-file"]').tap();const fileChooser=await filePending
    const fileResponse=page.waitForResponse(r=>r.url().includes('/upload')&&r.request().method()==='POST')
    await fileChooser.setFiles({name:`note-${width}.txt`,mimeType:'text/plain',buffer:Buffer.from('synthetic attachment')})
    check((await fileResponse).ok(),`general file upload still works at ${width}px`)
   }
  }
  await page.screenshot({path:join(evidence,`${baseline?'baseline':'fixed'}-mobile-${width}.png`)})
  await context.close()
 }
 if(!baseline){
  const desktop=await browser.newContext({viewport:{width:1440,height:980}})
  const phone=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true})
  const enter=async(context)=>{
   await context.addInitScript(()=>localStorage.setItem('vibepanel.renderer','dom'))
   const p=await context.newPage();await p.goto(base+'/?session='+session.id)
   await p.locator('[data-testid="auth-username"]').fill('fixture');await p.locator('[data-testid="auth-password"]').fill('synthetic-mobile-only-password');await p.locator('[data-testid="auth-submit"]').click()
   await p.locator('[data-testid="main-terminal"]:visible .xterm-screen').waitFor();await sleep(300);return p
  }
  const wide=await enter(desktop)
  if(await wide.locator('[data-testid="take-control"]:visible').count())await wide.locator('[data-testid="take-control"]:visible').click()
  const getGrid=()=>execFileSync('/usr/bin/tmux',['-N','-L',socket,'display-message','-p','-t','='+session.tmuxName+':','#{pane_width} #{pane_height}'],{encoding:'utf8'}).trim()
  await until(()=>Number(getGrid().split(' ')[0])>80,'desktop grid not established')
  const wideGrid=getGrid(), narrow=await enter(phone)
  check(getGrid()===wideGrid,'opening a phone does not silently resize the desktop session')
  const fit=narrow.locator('[data-testid="take-control"]:visible');await fit.waitFor()
  check((await fit.innerText()).includes('Fit to phone'),'phone grid action describes the result')
  const r=await fit.boundingBox();check(r.x>=0&&r.x+r.width<=390&&r.y+r.height<=844,'phone grid action is reachable')
  const before=JSON.parse(readFileSync(statePath)).hex;await fit.tap()
  await until(()=>Number(getGrid().split(' ')[0])<60,'phone cannot explicitly claim a fitting width')
  await until(async()=>(await rows(narrow)).join('\n').includes('SYNTHETIC_GRID_'),'resized terminal did not redraw')
  check(JSON.parse(readFileSync(statePath)).hex===before,'fitting phone width sends no terminal command or prompt')
  checks.push('explicit phone fitting redraws the existing PTY without restarting it')
  await narrow.screenshot({path:join(evidence,'fixed-phone-grid.png')})
  await phone.close();await desktop.close()
  // The shared chooser must also fit the tablet header without opening keys.
  const tablet=await browser.newContext({viewport:{width:820,height:1180},hasTouch:true,isMobile:true})
  const pad=await enter(tablet)
  const reachable=()=>pad.evaluate(()=>Object.fromEntries(['touch-keys','touch-attach','touch-attach-file'].map(id=>{const e=document.querySelector(`[data-testid="${id}"]`);const r=e?.getBoundingClientRect();return[id,!!r&&r.width>0&&r.x>=0&&r.right<=innerWidth&&e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))]})))
  const expanded=await reachable()
  // At 820px the existing three-column layout can put the header under the
  // right panel, including the original attachment button. Keep that evidence;
  // test this slice with the existing panel toggle, not forced pointer clicks.
  if(Object.values(expanded).some(x=>!x))await pad.locator('[data-testid="right-show"]').tap()
  const pm=await reachable()
  writeFileSync(join(evidence,'tablet-controls.json'),JSON.stringify({at:new Date().toISOString(),expanded,with_right_panel_collapsed:pm,limitation:'Existing 820px three-column header obstruction; panel toggle used, not repaired in this mobile slice.'},null,2)+'\n')
  await pad.screenshot({path:join(evidence,'tablet-collapsed.png')})
  for(const id of Object.keys(pm))check(pm[id],`${id} reachable in tablet header`)
  check(!await pad.locator('[data-testid="touchkeys"]').count(),'tablet keys stay closed by default')
  for(const id of ['touch-attach','touch-attach-file']){
   if(!pm[id])continue
   const [chooser]=await Promise.all([pad.waitForEvent('filechooser',{timeout:3000}),pad.locator(`[data-testid="${id}"]`).tap({timeout:3000})]);await chooser.setFiles([])
   check(true,`${id} opens from tablet tap`)
  }
  await pad.locator('[data-testid="touch-keys"]').tap()
  check(await pad.locator('[data-testid="key-backspace"]').isVisible()&&await pad.locator('[data-testid="key-delete"]').isVisible(),'tablet toggle exposes editing keys')
  await pad.screenshot({path:join(evidence,'fixed-tablet.png')});await tablet.close()
 }
 check(new Set(uploaded).size===uploaded.length,'repeated photo choices get distinct server paths')
 const result={result:failures.length?'failed':'passed',at:new Date().toISOString(),binary,baseline,checks,failures,metrics,fixture_data:data,uploaded_files:uploaded.length,real_models:0}
 writeFileSync(join(evidence,baseline?'mobile-baseline.json':'mobile-check.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));if(failures.length)process.exitCode=1
}catch(e){console.error(String(e));writeFileSync(join(evidence,baseline?'mobile-baseline-error.json':'mobile-check-error.json'),JSON.stringify({error:String(e),checks,failures,metrics,fixture_data:data},null,2)+'\n');process.exitCode=1}
finally{await browser?.close();server.kill('SIGTERM');await sleep(250);try{execFileSync('tmux',['-N','-L',socket,'kill-server'],{stdio:'ignore'})}catch{/* owned fixture already exited */}}
