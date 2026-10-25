const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
function script(id){const match=html.match(new RegExp('<script id="'+id+'">([\\s\\S]*?)</script>'));assert.ok(match,'Missing '+id);return match[1];}
function core(){const context={window:{},URL};vm.runInNewContext(script('rick-style-core'),context);return context.window.rickStyleCore;}
const product=(extra={})=>({id:'item-1',name:'Camisa do teste',category:'camisa',url:'https://loja.example/produto',priceCents:12990,...extra});
test('BRL input parses comma decimals and grouped thousands to integer cents',()=>{
 const c=core();for(const [raw,want] of [['129,90',12990],['1.299,90',129990],['129.90',12990],['0',0],['0,01',1],['1.299',129900]])assert.equal(c.parsePrice(raw),want,raw);
 for(const raw of ['','-1','1,999','1e3','NaN','12abc','1.23,45'])assert.throws(()=>c.parsePrice(raw),undefined,raw);
});
test('products validate chosen categories, links, unique ids and integer cents',()=>{
 const c=core();assert.equal(c.validate([product()])[0].priceCents,12990);
 for(const category of ['camisa','calca','bermuda','acessorio','tenis'])assert.equal(c.validate([product({category})])[0].category,category);
 for(const bad of [product({url:'javascript:alert(1)'}),product({category:'outro'}),product({name:' '}),product({priceCents:-1}),product({priceCents:1.1})])assert.throws(()=>c.validate([bad]));
 assert.throws(()=>c.validate([product(),product()]));assert.throws(()=>c.validate({items:[]}));
});
test('style data participates in system backup validation and round trip',async()=>{
 const context={window:{},URL,TextEncoder,crypto:require('node:crypto').webcrypto};
 for(const id of ['rick-style-core','rick-system-core'])vm.runInNewContext(script(id),context);
 const c=context.window.rickSystemCore,key='rick-dev-style',data={[key]:JSON.stringify([product()])};assert.ok(c.keys.includes(key));
 const backup=await c.createBackup(data,{tabWidth:2,printWidth:100,sidebarCollapsed:false});const result=await c.validateBackup(backup);assert.equal(result.data[key],data[key]);
 assert.throws(()=>c.validateData({[key]:JSON.stringify([product({url:'data:text/html,unsafe'})])}));
});
function ui(role='admin',saved=null){
 const c=core(),nodes=new Map(),writes=[],events={},tabs=['pc','style'];
 function el(id){if(!nodes.has(id))nodes.set(id,{id,hidden:false,disabled:false,value:'',textContent:'',children:[],attrs:{},listeners:{},style:{},setAttribute(k,v){this.attrs[k]=String(v)},getAttribute(k){return this.attrs[k]??null},addEventListener(k,fn){this.listeners[k]=fn},append(...items){this.children.push(...items)},replaceChildren(...items){this.children=[...items]},focus(){this.focused=true},reset(){for(const id of ['style-name','style-url','style-price'])el(id).value='';el('style-category').value='camisa';}});return nodes.get(id);}
 let stored=saved;const context={window:{rickStyleCore:c,rickDevSystem:{role},rickDevStorage:{getItem:()=>stored,setItem:(key,value)=>{writes.push({key,value});stored=value;}},addEventListener:(name,fn)=>events[name]=fn,confirm:()=>true},document:{getElementById:el,createElement:tag=>{const n=el('generated-'+nodes.size+'-'+tag);n.tagName=tag;return n;}},localStorage:{getItem(){return null},setItem(){}},crypto:{randomUUID:()=>String(writes.length+1)},URL};
 for(const t of tabs)el('finance-tab-'+t);el('style-category').value='camisa';el('style-filter').value='all';
 vm.runInNewContext(script('rick-style-tools'),context);
 return {el,writes,events,context,stored:()=>JSON.parse(stored||'[]'),submit(){return el('style-form').listeners.submit({preventDefault(){}})}};
}
function fill(p,extra={}){for(const [id,value] of Object.entries({'style-name':'Camisa nova','style-category':'camisa','style-url':'https://loja.example/camisa','style-price':'199,90',...extra}))p.el(id).value=value;}
function descendants(node){return [node,...node.children.flatMap(descendants)];}
test('admin creates cloud-backed entry with selected category and correctly summed value',()=>{
 const p=ui();fill(p,{'style-category':'tenis'});p.submit();assert.equal(p.writes[0].key,'rick-dev-style');assert.equal(p.stored()[0].category,'tenis');assert.equal(p.stored()[0].priceCents,19990);assert.match(p.el('style-total').textContent,/199,90/);
});
test('editing updates the chosen entry and deleting preserves unrelated products',()=>{
 const p=ui('admin',JSON.stringify([product(),product({id:'item-2',name:'Outro produto',category:'tenis'})]));
 let buttons=descendants(p.el('style-list')).filter(n=>n.textContent==='EDITAR');buttons[0].listeners.click();fill(p,{'style-name':'Nome atualizado','style-price':'50,00'});p.submit();
 assert.equal(p.stored()[0].name,'Nome atualizado');assert.equal(p.stored()[1].name,'Outro produto');
 buttons=descendants(p.el('style-list')).filter(n=>n.textContent==='EXCLUIR');buttons[0].listeners.click();assert.equal(p.stored().length,1);assert.equal(p.stored()[0].id,'item-2');
});
test('guest can navigate style tab and open safe store link but cannot write',()=>{
 const p=ui('guest',JSON.stringify([product()]));p.el('finance-tab-style').listeners.click();assert.equal(p.el('finance-panel-style').hidden,false);assert.equal(p.el('finance-panel-pc').hidden,true);
 assert.equal(p.el('style-fields').disabled,true);fill(p);p.submit();assert.equal(p.writes.length,0);
 const links=descendants(p.el('style-list')).filter(n=>n.tagName==='a');assert.equal(links[0].href,'https://loja.example/produto');assert.match(links[0].rel,/noopener/);
});
test('invalid stored data stays untouched and prevents writes',()=>{
 const p=ui('admin','{broken');fill(p);p.submit();assert.equal(p.writes.length,0);assert.equal(p.el('style-fields').disabled,true);assert.match(p.el('style-message').textContent,/validar|inválid/i);
});
test('category filtering shows matching products without changing the full budget',()=>{
 const p=ui('admin',JSON.stringify([product(),product({id:'item-2',category:'tenis',name:'Tênis teste',priceCents:10000})]));p.el('style-filter').value='tenis';p.el('style-filter').listeners.change();
 assert.match(p.el('style-total').textContent,/229,90/);const text=descendants(p.el('style-list')).map(n=>n.textContent).join(' ');assert.match(text,/Tênis teste/);assert.doesNotMatch(text,/Camisa do teste/);assert.equal(p.writes.length,0);
});

test('legacy style records default to unpurchased without losing existing fields',()=>{
 const original=product();const c=core(),result=c.validate([original])[0];assert.equal(result.purchased,false);assert.equal(original.purchased,undefined);assert.equal(result.url,original.url);assert.equal(result.priceCents,original.priceCents);
 assert.equal(c.validate([product({purchased:true})])[0].purchased,true);assert.equal(c.validate([product({purchased:false})])[0].purchased,false);
 for(const purchased of [null,1,'true'])assert.throws(()=>c.validate([product({purchased})]));
});
test('style summary separates bought count and spending from total budget',()=>{
 const c=core();const summary=c.summarize(c.validate([product({purchased:true}),product({id:'2',priceCents:10000})]));
 assert.equal(summary.purchased,1);assert.equal(summary.total,2);assert.equal(summary.spentCents,12990);assert.equal(summary.budgetCents,22990);assert.equal(summary.percent,50);assert.equal(c.summarize([]).percent,0);
});
test('marking and unmarking purchased persists cloud status and updates style progress',()=>{
 const p=ui('admin',JSON.stringify([product(),product({id:'2',name:'Outro produto'})]));
 let checks=descendants(p.el('style-list')).filter(n=>n.tagName==='input'&&n.type==='checkbox');assert.equal(checks.length,2);
 checks[0].checked=true;checks[0].listeners.change();assert.equal(p.stored()[0].purchased,true);assert.equal(p.stored()[1].purchased,false);assert.equal(p.stored()[0].url,'https://loja.example/produto');
 assert.equal(p.el('style-purchased-count').textContent,'1 / 2');assert.equal(p.el('style-progress').getAttribute('aria-valuenow'),'50');assert.match(p.el('style-spent').textContent,/129,90/);
 checks=descendants(p.el('style-list')).filter(n=>n.tagName==='input'&&n.type==='checkbox');checks[0].checked=false;checks[0].listeners.change();assert.equal(p.stored()[0].purchased,false);assert.equal(p.el('style-progress').getAttribute('aria-valuenow'),'0');
});
test('edit preserves purchased status and new product can be registered as purchased',()=>{
 const p=ui('admin',JSON.stringify([product({purchased:true})]));const edit=descendants(p.el('style-list')).find(n=>n.textContent==='EDITAR');edit.listeners.click();assert.equal(p.el('style-purchased').checked,true);
 p.el('style-name').value='Nome alterado';p.submit();assert.equal(p.stored()[0].purchased,true);assert.equal(p.stored()[0].name,'Nome alterado');
 fill(p);p.el('style-purchased').checked=true;p.submit();assert.equal(p.stored()[1].purchased,true);
});
test('guests see purchase status but cannot toggle saved products',()=>{
 const p=ui('guest',JSON.stringify([product({purchased:true})]));const check=descendants(p.el('style-list')).find(n=>n.tagName==='input'&&n.type==='checkbox');assert.ok(check);assert.equal(check.disabled,true);assert.equal(check.checked,true);
 check.checked=false;check.listeners.change();assert.equal(p.writes.length,0);assert.equal(p.stored()[0].purchased,true);
});
test('purchase status survives a system backup round trip',async()=>{
 const context={window:{},URL,TextEncoder,crypto:require('node:crypto').webcrypto};for(const id of ['rick-style-core','rick-system-core'])vm.runInNewContext(script(id),context);
 const c=context.window.rickSystemCore;const data={'rick-dev-style':JSON.stringify([product({purchased:true})])};const backup=await c.createBackup(data,{tabWidth:2,printWidth:100,sidebarCollapsed:false});assert.equal(JSON.parse((await c.validateBackup(backup)).data['rick-dev-style'])[0].purchased,true);
});
test('toggling a product currently being edited does not revert its status on submit',()=>{
 const p=ui('admin',JSON.stringify([product()]));descendants(p.el('style-list')).find(n=>n.textContent==='EDITAR').listeners.click();
 const check=descendants(p.el('style-list')).find(n=>n.tagName==='input');check.checked=true;check.listeners.change();p.el('style-name').value='Novo nome';p.submit();assert.equal(p.stored()[0].purchased,true);
});
