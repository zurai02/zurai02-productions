const S={scripts:[],execs:[],isBrowser:true};

function detect(){const e=['syn','krnl','fluxus','getexecutorname','getgc','getconnections','getloadedmodules','hookfunction'];S.isBrowser=!e.some(x=>typeof window[x]!=='undefined');}

function initParticles(){const c=document.getElementById('particles');for(let i=0;i<35;i++){const p=document.createElement('div');p.className='particle';p.style.left=Math.random()*100+'%';p.style.animationDelay=Math.random()*20+'s';p.style.animationDuration=(12+Math.random()*10)+'s';p.style.opacity=Math.random()*.4+.1;c.appendChild(p);}}

function openModal(){document.getElementById('modal').classList.add('active');document.getElementById('sName').focus();}
function closeModal(){document.getElementById('modal').classList.remove('active');['sName','sDesc','sCode'].forEach(x=>document.getElementById(x).value='');}
function saveScript(){const n=document.getElementById('sName').value.trim(),d=document.getElementById('sDesc').value.trim(),c=document.getElementById('sCode').value.trim();if(!n||!c){toast('Name and code required!','err');return;}const id=Date.now().toString(36)+Math.random().toString(36).slice(2);S.scripts.push({id:id,name:n,desc:d||'No description',lang:'lua',code:c,execs:0,last:null,output:'',ls:genLoadstring(id,n)});save();render();updateStats();closeModal();toast('Script saved!','ok');}
function delScript(id){if(!confirm('Delete this script?'))return;S.scripts=S.scripts.filter(s=>s.id!==id);save();render();updateStats();toast('Deleted','info');}
function editScript(id){const s=S.scripts.find(x=>x.id===id);if(!s)return;document.getElementById('sName').value=s.name;document.getElementById('sDesc').value=s.desc;document.getElementById('sCode').value=s.code;S.scripts=S.scripts.filter(x=>x.id!==id);openModal();}

function genLoadstring(id,name){
const base=window.location.origin+window.location.pathname.replace('index.html','');
return`-- Zurai02 Productions | ${name}
local _c=game:HttpGet("${base}raw.html?script=${id}",true)
local _s=_c:match("<!%-%-LUA%-%->(.-)<!%-%-/LUA%-%->")
if _s then loadstring(_s)() else warn("Zurai02: Script not found") end`;
}

function copyLoadstring(id){const s=S.scripts.find(x=>x.id===id);if(!s)return;navigator.clipboard.writeText(s.ls).then(()=>toast('Loadstring copied! Paste in executor.','ok')).catch(()=>{const ta=document.createElement('textarea');ta.value=s.ls;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);toast('Loadstring copied! Paste in executor.','ok');});}

function runScript(id){const s=S.scripts.find(x=>x.id===id);if(!s)return;if(S.isBrowser){window.open('protection.html?script='+s.id+'&name='+encodeURIComponent(s.name),'_blank');toast('Browser cannot execute scripts. Opening protection page...','err');logExec(id,false,'Browser blocked - sent to protection');return;}let output='';let success=true;try{output=execLua(s.code);}catch(e){output='Error: '+e.message;success=false;}s.execs++;s.last=new Date().toISOString();s.output=output;logExec(id,success,success?'Executed':'Error');save();updateStats();render();toast(success?'Executed! ('+s.execs+' total)':'Failed',success?'ok':'err');}

function execLua(code){const out=[];code.split('\n').forEach(l=>{const t=l.trim();if(!t)return;if(t.startsWith('--')){out.push('💬 '+t);return;}if(t.startsWith('local ')){const m=t.match(/local\s+(\w+)/);out.push('📦 local '+(m?m[1]:'var'));}else if(t.startsWith('function')){out.push('🔧 Function');}else if(t==='end'){out.push('🔚 end');}else if(t.startsWith('if ')){out.push('❓ if');}else if(t.startsWith('for ')||t.startsWith('while ')){out.push('🔄 Loop');}else if(t.startsWith('print')){const m=t.match(/print\s*\((.+)\)/);out.push('🖨️  >> '+(m?m[1].replace(/["\']/g,'').replace(/\.\./g,''):''));}else if(t.startsWith('game:')||t.startsWith('workspace')||t.startsWith('Players')){out.push('🎮 Roblox API: '+t.substring(0,45));}else{out.push('▶️ '+t.substring(0,50));}});return out.join('\n')||'[Lua trace done]';}

function logExec(sid,ok,msg){S.execs.push({sid,t:new Date().toISOString(),ok,msg,env:S.isBrowser?'browser':'executor'});save();}

function render(){const g=document.getElementById('scriptGrid'),e=document.getElementById('empty');if(!S.scripts.length){g.innerHTML='';e.style.display='block';return;}e.style.display='none';g.innerHTML=S.scripts.map(s=>{const le=s.last?new Date(s.last).toLocaleString():'Never';const out=s.output?`<div class="output active">${escHtml(s.output)}</div>`:'';const lsbox=`<div class="loadstring-box active"><label>📋 Copy this loadstring into your executor</label><div class="loadstring-text">${escHtml(s.ls)}</div></div>`;const browserBlock=S.isBrowser?`<div class="browser-block active"><h3>🛡️ This script was protected by Zurai02 Productions</h3><p>This script cannot be executed from a browser. Copy the loadstring below and paste it into your Roblox executor.</p><button class="btn btn-copy btn-sm" onclick="copyLoadstring('${s.id}')">📋 Copy Loadstring</button></div>`:'';return`<div class="card"><div class="card-head"><div class="card-name">${escHtml(s.name)}</div><div class="card-lang">Lua</div></div><div class="card-desc">${escHtml(s.desc)}</div><div class="card-meta"><span>▶️ ${s.execs} executions</span><span>🕐 ${le}</span></div><div class="card-actions"><button class="run" onclick="runScript('${s.id}')">▶️ Run</button><button class="copy-btn" onclick="copyLoadstring('${s.id}')">📋 Copy</button><button class="del" onclick="delScript('${s.id}')">🗑️</button></div>${browserBlock}${lsbox}${out}</div>`;}).join('');}

function updateStats(){const te=S.scripts.reduce((a,s)=>a+s.execs,0),tb=S.execs.filter(e=>!e.ok).length,tl=S.execs.length?new Date(S.execs[S.execs.length-1].t).toLocaleTimeString():'Never';anim('tExec',te);anim('tScript',S.scripts.length);anim('tBlock',tb);document.getElementById('tLast').textContent=tl;}
function anim(id,end){const el=document.getElementById(id),st=parseInt(el.textContent)||0;if(st===end)return;const d=800,step=Math.max(30,Math.floor(d/Math.abs(end-st)));let cv=st;const t=setInterval(()=>{cv+=st<end?1:-1;el.textContent=cv;if(cv===end)clearInterval(t);},step);}

function save(){try{localStorage.setItem('zp_scripts',JSON.stringify(S.scripts));localStorage.setItem('zp_execs',JSON.stringify(S.execs));}catch(e){}}
function load(){try{const sc=localStorage.getItem('zp_scripts'),ex=localStorage.getItem('zp_execs');if(sc)S.scripts=JSON.parse(sc);if(ex)S.execs=JSON.parse(ex);S.scripts.forEach(s=>{if(!s.ls)s.ls=genLoadstring(s.id,s.name);if(!s.lang)s.lang='lua';});render();updateStats();}catch(e){}}

function escHtml(t){const d=document.createElement('div');d.textContent=t;return d.innerHTML;}
function toast(msg,type='info'){const c=document.getElementById('toasts'),t=document.createElement('div');t.className='toast '+(type==='ok'?'ok':type==='err'?'err':'');t.innerHTML=(type==='ok'?'✅':type==='err'?'❌':'ℹ️')+' '+escHtml(msg);c.appendChild(t);setTimeout(()=>{t.style.opacity='0';t.style.transform='translateX(120%)';setTimeout(()=>t.remove(),300);},4000);}

document.addEventListener('DOMContentLoaded',()=>{detect();initParticles();load();document.getElementById('modal').addEventListener('click',e=>{if(e.target===document.getElementById('modal'))closeModal();});document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();if(e.ctrlKey&&e.key==='n'){e.preventDefault();openModal();}});document.querySelectorAll('.nav a').forEach(a=>{a.addEventListener('click',()=>{document.querySelectorAll('.nav a').forEach(x=>x.classList.remove('active'));a.classList.add('active');});});});

window.openModal=openModal;window.closeModal=closeModal;window.saveScript=saveScript;window.delScript=delScript;window.runScript=runScript;window.editScript=editScript;window.copyLoadstring=copyLoadstring;
