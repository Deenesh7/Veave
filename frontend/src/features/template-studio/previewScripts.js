// Scripts the studio puts into the previewed page. They are text that runs INSIDE the page, so they are written with String.raw: in an
// ordinary template literal "\s" silently becomes "s", and a whitespace regex such as /\s+/g then turned every "s" of the clicked text into
// a space ("purpose" -> "purpo e").
// Lets the page take theme CSS from the studio while the theme panel is open (the same listener the template preview uses).
export const THEME_LISTENER = String.raw`<style id="veave-theme"></style><script>window.addEventListener('message',function(e){var d=e.data;if(d&&d.type==='veave-theme'){document.getElementById('veave-theme').textContent=d.css||'';}});</script>`;

// Click-to-edit text inside the page. A click on text selects it and tells the studio; the studio sends new text back as it is typed.
export const TEXT_EDIT_SCRIPT = String.raw`<script>(function(){
var on=true,sel=null,hov=null,map={},n=0;
var st=document.createElement('style');st.textContent='[data-studio-hover]{outline:1px dashed #5E7B5F!important;outline-offset:2px;cursor:text!important}[data-studio-sel]{outline:2px solid #5E7B5F!important;outline-offset:2px;background-color:rgba(94,123,95,.08)}';document.head.appendChild(st);
var st2=document.createElement('style');st2.textContent='[data-studio-soft]{opacity:.55!important;filter:blur(4px) grayscale(.35)!important;transition:opacity .25s ease,filter .25s ease}';document.head.appendChild(st2);
function blk(){return window.__studioBlocks||{all:function(){return document.querySelectorAll('section');},of:function(n){return n&&n.closest?n.closest('section'):null;}};}
function soft(el){clearSoft();if(!el)return;var s=blk().of(el);if(!s)return;var all=blk().all();for(var i=0;i<all.length;i++){var o=all[i];if(o!==s&&!o.contains(s)&&!s.contains(o))o.setAttribute('data-studio-soft','');}}
function clearSoft(){var d=document.querySelectorAll('[data-studio-soft]');for(var i=0;i<d.length;i++)d[i].removeAttribute('data-studio-soft');}
function own(el){var t='';for(var c=el.firstChild;c;c=c.nextSibling){if(c.nodeType===3)t+=c.nodeValue;}return t;}
function norm(t){return t.replace(/\s+/g,' ').trim();}
function skip(el){return !el||/^(SCRIPT|STYLE|SVG|PATH|INPUT|TEXTAREA|SELECT|OPTION|HTML|BODY)$/i.test(el.tagName)||el.id==='root';}
function at(x,y,target){var node=null;try{if(document.caretRangeFromPoint){var r=document.caretRangeFromPoint(x,y);node=r&&r.startContainer;}else if(document.caretPositionFromPoint){var p=document.caretPositionFromPoint(x,y);node=p&&p.offsetNode;}}catch(e){}
if(node&&node.nodeType===3&&norm(node.nodeValue)){var rg=document.createRange();rg.selectNodeContents(node);var b=rg.getBoundingClientRect();if(x>=b.left-4&&x<=b.right+4&&y>=b.top-4&&y<=b.bottom+4){var el=node.parentNode;if(!skip(el)&&norm(own(el)))return el;}}
if(target&&target.nodeType===1&&!skip(target)&&norm(own(target)))return target;return null;}
function mark(el,attr,val){if(el)el.removeAttribute(attr);if(val)val.setAttribute(attr,'');}
document.addEventListener('pointerdown',function(e){if(e.target&&e.target.closest&&e.target.closest('#studio-pen'))return;window.parent.postMessage({type:'studio-preview-touch'},'*');},true);
document.addEventListener('mousemove',function(e){if(!on)return;var el=at(e.clientX,e.clientY,e.target);if(el===hov)return;if(hov)hov.removeAttribute('data-studio-hover');hov=el;if(el&&el!==sel)el.setAttribute('data-studio-hover','');},true);
var LIVE='button,a,summary,select,input,textarea,[role="tab"],[role="button"],[role="switch"],label';
document.addEventListener('click',function(e){if(!on)return;if(e.ctrlKey||e.metaKey)return;if(e.target&&e.target.closest&&e.target.closest(LIVE))return;var el=at(e.clientX,e.clientY,e.target);if(!el){if(sel){sel.removeAttribute('data-studio-sel');sel=null;window.parent.postMessage({type:'studio-text-deselected'},'*');}var here=blk().of(e.target);if(here)soft(here);else clearSoft();return;}e.preventDefault();e.stopImmediatePropagation();
if(sel)sel.removeAttribute('data-studio-sel');sel=el;el.removeAttribute('data-studio-hover');el.setAttribute('data-studio-sel','');
soft(el);if(!el.__sid){el.__sid='s'+(++n);map[el.__sid]=el;}
window.parent.postMessage({type:'studio-text-selected',id:el.__sid,text:norm(own(el)),tag:el.tagName.toLowerCase()},'*');},true);
window.addEventListener('message',function(e){var d=e.data;if(!d)return;
if(d.type==='studio-text-mode'){on=!!d.enabled;if(!on){clearSoft();if(sel)sel.removeAttribute('data-studio-sel');if(hov)hov.removeAttribute('data-studio-hover');sel=hov=null;}}
if(d.type==='studio-text-clear'){clearSoft();if(sel)sel.removeAttribute('data-studio-sel');sel=null;}
if(d.type==='studio-text-set'){var el=map[d.id];if(!el)return;var nodes=[];for(var c=el.firstChild;c;c=c.nextSibling){if(c.nodeType===3)nodes.push(c);}
var first=null;for(var i=0;i<nodes.length;i++){if(nodes[i].nodeValue.trim()){first=nodes[i];break;}}if(!first)return;
var all=nodes.map(function(x){return x.nodeValue;}).join('');var lead=(all.match(/^\s*/)||[''])[0],trail=(all.match(/\s*$/)||[''])[0];
nodes.forEach(function(x){if(x!==first)x.nodeValue='';});first.nodeValue=lead+d.text+trail;}
});
})();</script>`;

// When sections are ticked in the Content column, every other section of the page is dimmed so the chosen ones stand out.
export const FOCUS_SCRIPT = String.raw`<script>(function(){
var st=document.createElement('style');st.textContent='[data-studio-dim]{opacity:.55!important;filter:blur(4px) grayscale(.35)!important;pointer-events:none!important;user-select:none!important;transition:opacity .25s ease,filter .25s ease}[data-studio-focus]{transition:opacity .25s ease}';document.head.appendChild(st);
var current=[];
var lastY=0,sT=null;window.addEventListener('scroll',function(){lastY=window.scrollY;clearTimeout(sT);sT=setTimeout(function(){window.parent.postMessage({type:'studio-scroll',y:lastY},'*');},120);},{passive:true});
function norm(s){return String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function blk(){return window.__studioBlocks||{all:function(){return document.querySelectorAll('section');},of:function(n){return n&&n.closest?n.closest('section'):null;}};}
document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[href*="#"]');if(!a)return;var h=a.getAttribute('href')||'';var i=h.indexOf('#');var id=i>=0?decodeURIComponent(h.slice(i+1)):'';if(!id)return;var el=document.getElementById(id);window.parent.postMessage({type:'studio-nav-section',domId:id,name:a.textContent||'',label:el&&el.id?el.id:''},'*');},true);
function sectionOf(el){return blk().of(el)||el;}
function find(item){var el=null;
if(item.domId)el=document.getElementById(item.domId);
if(!el&&item.name){var lbl0=norm(item.name);var c0=document.querySelectorAll('h1,h2,h3,h4,section,[id],[aria-label]');
for(var i0=0;i0<c0.length&&!el;i0++){var n0=norm(/^H[1-4]$/.test(c0[i0].tagName)?c0[i0].textContent:(c0[i0].getAttribute('aria-label')||c0[i0].id));if(n0&&n0===lbl0)el=c0[i0];}}
if(!el&&typeof item.index==='number'&&item.index>=0){var bl=blk().all();if(bl.length&&bl.length===item.total)el=bl[item.index];}
if(!el&&item.name){var lbl=norm(item.name);var c=document.querySelectorAll('h1,h2,h3,h4,section,[id],[aria-label]');
for(var pass=1;pass<2&&!el;pass++){for(var i=0;i<c.length&&!el;i++){var n=norm(/^H[1-4]$/.test(c[i].tagName)?c[i].textContent:(c[i].getAttribute('aria-label')||c[i].id));
if(n&&(pass===0?n===lbl:(n.length>2&&(n.indexOf(lbl)>-1||lbl.indexOf(n)>-1))))el=c[i];}}}
if(!el&&item.name){var lb=norm(item.name);
if(/^(page header|header|hero|page hero|navigation)$/.test(lb)){var first=blk().all()[0];if(first)el=first;}
if(!el&&lb.length>2){var all2=document.body.querySelectorAll('*');var starts=null;
for(var q=0;q<all2.length&&!el;q++){var e2=all2[q];if(/^(SCRIPT|STYLE|SVG|PATH|NOSCRIPT)$/i.test(e2.tagName)||e2.id==='studio-pen'||e2.children.length>3)continue;var tx=norm(e2.textContent);if(!tx||tx.length>90)continue;if(tx===lb)el=e2;else if(!starts&&tx.indexOf(lb)===0)starts=e2;}
if(!el)el=starts;}}
return el?sectionOf(el):null;}
function clear(){var d=document.querySelectorAll('[data-studio-dim]');for(var i=0;i<d.length;i++)d[i].removeAttribute('data-studio-dim');}
function apply(){clear();if(!current.length)return;var targets=[];
for(var i=0;i<current.length;i++){var t=find(current[i]);if(t&&targets.indexOf(t)<0)targets.push(t);}
if(!targets.length)return;
var all=blk().all();
for(var j=0;j<all.length;j++){var sec=all[j],keep=false;
for(var k=0;k<targets.length;k++){if(sec===targets[k]||sec.contains(targets[k])||targets[k].contains(sec)){keep=true;break;}}
if(!keep)sec.setAttribute('data-studio-dim','');}}
window.addEventListener('message',function(e){var d=e.data;if(d&&d.type==='studio-restore-scroll'){var y=Number(d.y)||0;[300,900,1800,3200].forEach(function(ms){setTimeout(function(){if(Math.abs(window.scrollY-y)>4)window.scrollTo(0,y);},ms);});}
if(d&&d.type==='studio-scroll-to'&&d.section){var tg=find(d.section);if(tg){tg.scrollIntoView({behavior:'smooth',block:'start'});var oo=tg.style.outline,of=tg.style.outlineOffset;tg.style.outline='2px solid #5E7B5F';tg.style.outlineOffset='-2px';setTimeout(function(){tg.style.outline=oo;tg.style.outlineOffset=of;},1400);}}
if(d&&d.type==='studio-focus-sections'){current=Array.isArray(d.sections)?d.sections:[];apply();}});
new MutationObserver(function(){if(current.length){clearTimeout(window.__studioFocusT);window.__studioFocusT=setTimeout(apply,120);}}).observe(document.documentElement,{childList:true,subtree:true});
})();</script>`;


// A small image button at the top right of the picture under the pointer. Clicking it tells the studio which picture to change.
export const IMAGE_BUTTON_SCRIPT = String.raw`<script>(function(){
var btn=document.createElement('button');btn.id='studio-img-btn';btn.type='button';btn.title='Change this image';btn.setAttribute('aria-label','Change this image');
btn.style.cssText='position:fixed;z-index:2147483001;display:none;width:36px;height:36px;border-radius:999px;border:2px solid #fff;background:#2B2823;color:#fff;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.35);align-items:center;justify-content:center;padding:0;margin:0';
btn.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>';
document.body.appendChild(btn);
var cur=null,over=false;
function urlOf(el){if(el.tagName==='IMG')return el.currentSrc||el.src||'';var m=/url\(["']?([^"')]+)["']?\)/.exec(window.getComputedStyle(el).backgroundImage||'');return m?m[1]:'';}
function pick(x,y){var st=document.elementsFromPoint(x,y);for(var i=0;i<st.length;i++){var el=st[i];if(el===btn||el.id==='studio-pen'||el===document.body||el===document.documentElement)continue;var r=el.getBoundingClientRect();var u=urlOf(el);if(!u||/^data:/.test(u)||/gradient/.test(u))continue;if(el.tagName==='IMG'?(r.width>=48&&r.height>=48):(r.width>=80&&r.height>=80))return el;}return null;}
function place(){if(!cur||!document.body.contains(cur)){btn.style.display='none';return;}var r=cur.getBoundingClientRect();var top=Math.max(r.top,0),right=Math.min(r.right,window.innerWidth);if(r.bottom<60||r.top>window.innerHeight-50||right<60){btn.style.display='none';return;}
var left=right-46,t=top+10;var pen=document.getElementById('studio-pen');if(pen&&pen.style.display!=='none'){var pr=pen.getBoundingClientRect();if(!(left+36<pr.left||left>pr.right||t+36<pr.top||t>pr.bottom))left=pr.left-44;}
btn.style.display='flex';btn.style.left=Math.max(left,8)+'px';btn.style.top=t+'px';}
var hideT=null;function later(){clearTimeout(hideT);hideT=setTimeout(function(){if(!over){cur=null;place();}},600);}
document.addEventListener('mousemove',function(e){if(over)return;var el=pick(e.clientX,e.clientY);if(el){clearTimeout(hideT);if(el!==cur){cur=el;place();}}else if(cur)later();},true);
document.addEventListener('mouseleave',later);
window.addEventListener('scroll',place,{passive:true});window.addEventListener('resize',place);
btn.addEventListener('mouseenter',function(){over=true;clearTimeout(hideT);});btn.addEventListener('mouseleave',function(){over=false;later();});
btn.addEventListener('click',function(e){e.preventDefault();e.stopPropagation();if(!cur)return;var r=cur.getBoundingClientRect();var sec=null;try{var bl=window.__studioBlocks;var s=bl&&bl.of(cur);if(s){var h=s.querySelector('h1,h2,h3,h4');sec={name:String(s.getAttribute('aria-label')||(h&&h.textContent)||s.id||'').replace(/\s+/g,' ').trim().slice(0,120),domId:s.id||'',index:Array.prototype.indexOf.call(bl.all(),s)};}}catch(x){}
window.parent.postMessage({type:'studio-image-edit',src:urlOf(cur),alt:cur.getAttribute('alt')||'',width:Math.round(r.width),height:Math.round(r.height),section:sec},'*');},true);
})();</script>`;
