const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
function setup(pc,style){const match=html.match(/<script id="rick-finance-progress">([\s\S]*?)<\/script>/);assert.ok(match,'Finance progress renderer missing');
 const nodes=new Map(),events={},observers=[];let refreshes=0;
 const el=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',attrs:{},style:{setProperty(k,v){this[k]=v}},setAttribute(k,v){this.attrs[k]=String(v)},getAttribute(k){return this.attrs[k]??null}});return nodes.get(id)};
 el('pc-purchased-count').textContent=pc;el('style-purchased-count').textContent=style;
 const context={document:{getElementById:el},window:{addEventListener:(name,fn)=>events[name]=fn,dispatchEvent:()=>refreshes++},CustomEvent:class{constructor(type){this.type=type}},MutationObserver:class{constructor(fn){this.fn=fn;observers.push(this)}observe(){}}};vm.runInNewContext(match[1],context);
 return {el,events,refreshes:()=>refreshes,update(){for(const o of observers)o.fn()}};
}
test('Finance and Home aggregate PC and style bought counts and percentages',()=>{const p=setup('2 / 4','1 / 2');assert.equal(p.el('finance-purchased-count').textContent,'3 / 6');assert.equal(p.el('finance-progress').getAttribute('aria-valuenow'),'50');assert.equal(p.el('home-pc-percent').textContent,'50%');assert.match(p.el('home-pc-progress').textContent,/3.*6/);assert.ok(p.refreshes()>0);});
test('changes in either shopping tab refresh the combined progress including unmarking',()=>{const p=setup('0 / 2','0 / 2');p.el('style-purchased-count').textContent='1 / 2';p.update();assert.equal(p.el('finance-progress').getAttribute('aria-valuenow'),'25');p.el('pc-purchased-count').textContent='2 / 2';p.update();assert.equal(p.el('home-pc-percent').textContent,'75%');p.el('style-purchased-count').textContent='0 / 2';p.update();assert.equal(p.el('home-pc-percent').textContent,'50%');});
test('empty lists and fully purchased lists remain finite within 0 to 100',()=>{const p=setup('0 / 0','0 / 0');assert.equal(p.el('finance-progress').getAttribute('aria-valuenow'),'0');p.el('style-purchased-count').textContent='3 / 3';p.update();assert.equal(p.el('finance-progress').getAttribute('aria-valuenow'),'100');});
