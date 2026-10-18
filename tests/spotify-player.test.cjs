const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../spotify-player.js'),'utf8');

async function player(state) {
  let now=100000, requests=0;
  const nodes=new Map(),intervals=new Map(),storage=new Map();let nextTimer=1;
  function element(id){
    if(!nodes.has(id))nodes.set(id,{textContent:'',hidden:false,disabled:false,value:'',attrs:{},style:{setProperty(k,v){this[k]=v;}},listeners:{},classList:{toggle(){},contains(){return false;}},setAttribute(k,v){this.attrs[k]=String(v);},getAttribute(k){return this.attrs[k]??null;},removeAttribute(k){delete this.attrs[k];},addEventListener(k,fn){this.listeners[k]=fn;},focus(){}});
    return nodes.get(id);
  }
  storage.set('rick-dev-spotify-client-id','test-client-id');
  storage.set('rick-dev-spotify-widget-minimized','false');
  storage.set('rick-dev-spotify-token',JSON.stringify({accessToken:'test-token',refreshToken:'test-refresh',expiresAt:99999999}));
  const doc={hidden:false,title:'Test',querySelector:s=>element(s.slice(1)),addEventListener(){}};
  const localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
  const context={document:doc,localStorage,sessionStorage:{removeItem(){},getItem(){return null;}},URL,URLSearchParams,TextEncoder,Date:class extends Date{static now(){return now;}},fetch:async()=>{requests++;return {status:200,ok:true,text:async()=>JSON.stringify(state)};}};
  context.window={location:{search:'',href:'https://example.test/'},setInterval:(fn,ms)=>{const id=nextTimer++;intervals.set(id,{fn,ms});return id;},clearInterval:id=>intervals.delete(id),setTimeout:()=>0,crypto:{}};
  context.MutationObserver=class{observe(){}};
  vm.runInNewContext(source,context);
  for(let i=0;i<12;i++)await Promise.resolve();
  return {el:element,requests:()=>requests,advance(ms){now+=ms;for(const item of [...intervals.values()])if(item.ms===1000)item.fn();}};
}
const track=(extra={})=>({is_playing:true,progress_ms:30000,item:{name:'Test track',duration_ms:120000,artists:[{name:'Test artist'}],album:{images:[{url:'https://i.scdn.co/image/test'}]},external_urls:{spotify:'https://open.spotify.com/track/test'}},...extra});

test('renders Spotify artwork, elapsed time and total duration from playback',async()=>{
  const p=await player(track());
  assert.equal(p.el('spotify-cover-image').getAttribute('src'),'https://i.scdn.co/image/test');
  assert.equal(p.el('spotify-time-elapsed').textContent,'0:30');
  assert.equal(p.el('spotify-time-duration').textContent,'2:00');
  assert.equal(p.el('spotify-progress-track').getAttribute('aria-valuenow'),'25');
});
test('interpolates playing time locally without extra Spotify requests and caps at duration',async()=>{
  const p=await player(track());const before=p.requests();p.advance(2000);
  assert.equal(p.el('spotify-time-elapsed').textContent,'0:32');assert.equal(p.requests(),before);
  p.advance(200000);assert.equal(p.el('spotify-time-elapsed').textContent,'2:00');
});
test('paused playback keeps its elapsed time unchanged',async()=>{
  const p=await player(track({is_playing:false}));p.advance(10000);assert.equal(p.el('spotify-time-elapsed').textContent,'0:30');
});
test('missing playback clears artwork and hides timeline',async()=>{
  const p=await player(null);assert.equal(p.el('spotify-timeline').hidden,true);assert.equal(p.el('spotify-cover-image').hidden,true);assert.equal(p.el('spotify-cover-image').getAttribute('src'),null);
});
test('missing or unsafe artwork uses fallback without breaking controls',async()=>{
  const state=track();state.item.album.images=[{url:'javascript:alert(1)'}];
  const p=await player(state);assert.equal(p.el('spotify-cover-image').hidden,true);assert.equal(p.el('spotify-art-fallback').hidden,false);assert.equal(p.el('spotify-play-toggle').disabled,false);
});
test('unknown playback position does not invent a progress value',async()=>{
  const p=await player(track({progress_ms:null}));assert.equal(p.el('spotify-timeline').hidden,true);
});
test('broken artwork restores fallback',async()=>{
  const p=await player(track());p.el('spotify-cover-image').listeners.error();assert.equal(p.el('spotify-cover-image').hidden,true);assert.equal(p.el('spotify-art-fallback').hidden,false);
});
