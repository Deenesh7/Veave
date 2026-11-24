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
function sectionOf(el){return blk().of(el)||el;}
function find(item){var el=null;
if(item.domId)el=document.getElementById(item.domId);
if(!el&&item.name){var lbl=norm(item.name);var c=document.querySelectorAll('h1,h2,h3,h4,section,[id],[aria-label]');
for(var pass=0;pass<2&&!el;pass++){for(var i=0;i<c.length&&!el;i++){var n=norm(/^H[1-4]$/.test(c[i].tagName)?c[i].textContent:(c[i].getAttribute('aria-label')||c[i].id));
if(n&&(pass===0?n===lbl:(n.length>2&&(n.indexOf(lbl)>-1||lbl.indexOf(n)>-1))))el=c[i];}}}
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
if(d&&d.type==='studio-focus-sections'){current=Array.isArray(d.sections)?d.sections:[];apply();}});
new MutationObserver(function(){if(current.length){clearTimeout(window.__studioFocusT);window.__studioFocusT=setTimeout(apply,120);}}).observe(document.documentElement,{childList:true,subtree:true});
})();</script>`;
