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
