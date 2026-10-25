const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../spotify-player.js'),'utf8');
const fullScope='user-read-playback-state user-modify-playback-state streaming user-read-email user-read-private user-read-recently-played';
const uri='spotify:track:1234567890123456789012';
const flush=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
async function setup(options={}) {
  const nodes=new Map(),storage=new Map(),requests=[],events={},sdkCalls=[],timers=new Map(),windowEvents={};let nextTimer=0;
  const el=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',hidden:false,disabled:false,value:'',style:{},attrs:{},listeners:{},classList:{toggle(){},contains(){return false;}},setAttribute(k,v){this.attrs[k]=String(v);},getAttribute(k){return this.attrs[k]??null;},removeAttribute(k){delete this.attrs[k];},addEventListener(k,v){this.listeners[k]=v;},focus(){},remove(){}});return nodes.get(id);};
  storage.set('rick-dev-spotify-client-id','client');storage.set('rick-dev-spotify-widget-minimized','false');
  storage.set('rick-dev-spotify-token',JSON.stringify({accessToken:'test-token',refreshToken:'test-refresh',expiresAt:Date.now()+3600000,scope:options.legacy?'':fullScope}));
  const sdk={addListener:(name,fn)=>events[name]=fn,connect:async()=>{sdkCalls.push('connect');if(!options.delayReady)events.ready({device_id:'browser-device'});return true;},disconnect:()=>sdkCalls.push('disconnect'),activateElement:()=>{sdkCalls.push('activate');return Promise.resolve();}};
  const session=new Map([['rick-dev-spotify-oauth-state','valid-state'],['rick-dev-spotify-code-verifier','valid-verifier']]);
  if(options.authorize)storage.delete('rick-dev-spotify-token');
  const context={URL,URLSearchParams,TextEncoder,Date,console,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)},sessionStorage:{getItem:k=>session.get(k)??null,setItem:(k,v)=>session.set(k,v),removeItem:k=>session.delete(k)},MutationObserver:class{observe(){}},document:{hidden:false,title:'Test',querySelector:s=>el(s.slice(1)),createElement:()=>el('sdk-script'),head:{appendChild(script){sdkCalls.push('script');}},addEventListener(){}},fetch:async(url,init={})=>{
    if(options.beforeFetch)await options.beforeFetch(url,init);
    if(url.includes('/api/token')){requests.push({url,method:init.method,body:String(init.body)});return {ok:true,json:async()=>({access_token:'new-token',refresh_token:'new-refresh',expires_in:3600,scope:fullScope})};}
    requests.push({url,method:init.method||'GET',body:init.body&&JSON.parse(init.body)});
    let body=null,status=204;
    if(url.endsWith('/me/player')&&(!init.method||init.method==='GET')){body=options.state||null;status=200;}
    if(url.includes('/recently-played')){body={items:options.emptyHistory?[]:[{track:{uri}}]};status=200;}
    if(options.failPlay&&url.includes('/me/player/play')){body={error:{message:'Premium required'}};status=403;}
    return {ok:status<400,status,text:async()=>JSON.stringify(body)};
  }};
  context.window={rickMusicProvider:options.provider,addEventListener:(name,fn)=>windowEvents[name]=fn,rickSoundCloudControl:{pause:()=>sdkCalls.push('soundcloud-pause')},Spotify:options.noSdk?undefined:{Player:function(){return sdk;}},location:{search:options.authorize?'?code=test-code&state=valid-state':'',href:'https://example.test/'},history:{replaceState(){}},crypto:{},setInterval:()=>0,clearInterval(){},setTimeout:(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(source,context);await flush();
  return {el,requests,events,sdkCalls,sdk,context,storage,flush,timers,windowEvents,click:async id=>{const result=el(id).listeners.click();await result;await flush();},submit:async()=>{const result=el('spotify-start-form').listeners.submit({preventDefault(){}});await result;await flush();}};
}
test('connected empty player allows first play and starts recent track on browser device',async()=>{
  const p=await setup();assert.equal(p.el('spotify-play-toggle').disabled,false);
  assert.equal(p.requests.some(r=>r.method==='PUT'),false,'no autoplay on opening');
  await p.click('spotify-play-toggle');
  const transfer=p.requests.find(r=>r.url.endsWith('/me/player')&&r.method==='PUT');assert.deepEqual(transfer.body,{device_ids:['browser-device'],play:false});
  const play=p.requests.find(r=>r.url.endsWith('/me/player/play?device_id=browser-device'));assert.deepEqual(play.body,{uris:[uri]});
  assert.ok(p.sdkCalls.includes('activate'));
});
test('legacy authorization offers reconnection without discarding token or loading SDK',async()=>{
  const p=await setup({legacy:true});assert.equal(p.el('spotify-connect').hidden,false);assert.match(p.el('spotify-connect').textContent,/RE(CONECTAR|AUTORIZAR)/);
  await p.click('spotify-play-toggle');assert.match(p.el('spotify-status').textContent,/reconect|reautoriz/i);assert.equal(p.sdkCalls.length,0);assert.ok(p.storage.has('rick-dev-spotify-token'));
});
test('playlist link starts explicit context without relying on Spotify app',async()=>{
  const p=await setup();p.el('spotify-start-source').value='https://open.spotify.com/playlist/1234567890123456789012?si=example';await p.submit();
  const play=p.requests.find(r=>r.url.includes('/me/player/play?'));assert.deepEqual(play.body,{context_uri:'spotify:playlist:1234567890123456789012'});
});
test('unsafe source link is rejected without transfer or playback',async()=>{
  const p=await setup();p.el('spotify-start-source').value='https://evil.example/track/1234567890123456789012';await p.submit();
  assert.equal(p.requests.some(r=>r.method==='PUT'),false);assert.match(p.el('spotify-status').textContent,/link.*Spotify/i);
});
test('empty history asks for link and leaves first play enabled',async()=>{
  const p=await setup({emptyHistory:true});await p.click('spotify-play-toggle');assert.match(p.el('spotify-status').textContent,/link/i);assert.equal(p.el('spotify-play-toggle').disabled,false);assert.equal(p.requests.some(r=>r.method==='PUT'),false);
});
test('remote paused song resumes on its existing device without transferring playback',async()=>{
  const p=await setup({state:{is_playing:false,device:{id:'phone'},item:{name:'Track',artists:[],duration_ms:1000},progress_ms:0}});await p.click('spotify-play-toggle');
  assert.ok(p.requests.find(r=>r.url.endsWith('/me/player/play')));assert.equal(p.requests.some(r=>r.body?.device_ids),false);
});
test('disconnect tears down SDK and stale ready event cannot restore playback',async()=>{
  const p=await setup({delayReady:true});await p.click('spotify-disconnect');p.events.ready({device_id:'stale-device'});await p.flush();
  assert.ok(p.sdkCalls.includes('disconnect'));assert.equal(p.storage.has('rick-dev-spotify-token'),false);assert.equal(p.el('spotify-play-toggle').disabled,true);assert.equal(p.requests.some(r=>r.method==='PUT'),false);
});
test('playback error restores retry and shows actionable Premium message',async()=>{
  const p=await setup({failPlay:true});await p.click('spotify-play-toggle');assert.match(p.el('spotify-status').textContent,/Premium/);assert.equal(p.el('spotify-play-toggle').disabled,false);
});
test('SDK errors leave play available for another attempt',async()=>{
  const p=await setup({delayReady:true});p.events.initialization_error({message:'DRM unavailable'});await p.flush();assert.match(p.el('spotify-status').textContent,/navegador|DRM/i);assert.equal(p.el('spotify-play-toggle').disabled,false);
});

test('explicit local play activates browser even when another device is already playing',async()=>{
  const p=await setup({state:{is_playing:true,device:{id:'phone'},item:{name:'Remote track',artists:[],duration_ms:1000},progress_ms:0}});
  p.el('spotify-start-source').value='https://open.spotify.com/track/1234567890123456789012';await p.submit();
  assert.ok(p.sdkCalls.includes('activate'));assert.ok(p.requests.find(r=>r.url.endsWith('/me/player/play?device_id=browser-device')));
});
test('SDK load failure reports error and next Play retries loading',async()=>{
  const p=await setup({noSdk:true});assert.equal(p.sdkCalls.filter(x=>x==='script').length,1);
  p.el('sdk-script').onerror();await p.flush();assert.equal(p.el('spotify-play-toggle').disabled,false);assert.match(p.el('spotify-status').textContent,/carregar|conexão/i);
  const pending=p.click('spotify-play-toggle');await p.flush();assert.equal(p.sdkCalls.filter(x=>x==='script').length,2);
  p.context.window.Spotify={Player:function(){return p.sdk;}};p.context.window.onSpotifyWebPlaybackSDKReady();await pending;
  assert.equal(p.requests.some(r=>r.method==='PUT'),false);await p.click('spotify-play-toggle');assert.ok(p.sdkCalls.includes('activate'));
  assert.ok(p.requests.find(r=>r.url.endsWith('/me/player/play?device_id=browser-device')));
});
test('browser track state updates artwork and playback buttons without waiting for polling',async()=>{
  const p=await setup();await p.click('spotify-play-toggle');
  p.events.player_state_changed({paused:false,position:5000,track_window:{current_track:{uri,name:'Browser track',duration_ms:120000,artists:[{name:'Artist'}],album:{images:[{url:'https://i.scdn.co/image/art'}]}}}});
  assert.equal(p.el('spotify-track-title').textContent,'Browser track');assert.equal(p.el('spotify-time-elapsed').textContent,'0:05');assert.equal(p.el('spotify-play-toggle').getAttribute('aria-label'),'Pausar');
});

test('successful OAuth return starts browser player and retains granted playback scopes',async()=>{
  const p=await setup({authorize:true});assert.ok(p.sdkCalls.includes('connect'));assert.match(JSON.parse(p.storage.get('rick-dev-spotify-token')).scope,/streaming/);
  assert.equal(p.el('spotify-connect').hidden,true);assert.equal(p.el('spotify-play-toggle').disabled,false);
});

test('local Play stays disabled until SDK is ready, then activates on its first click',async()=>{
  const p=await setup({noSdk:true});assert.equal(p.el('spotify-play-toggle').disabled,true);
  p.context.window.Spotify={Player:function(){return p.sdk;}};p.context.window.onSpotifyWebPlaybackSDKReady();await p.flush();
  assert.equal(p.el('spotify-play-toggle').disabled,false);await p.click('spotify-play-toggle');assert.ok(p.sdkCalls.includes('activate'));
});
test('late error from discarded SDK instance cannot invalidate replacement',async()=>{
  const p=await setup({delayReady:true});const oldError=p.events.authentication_error;
  p.events.initialization_error({message:'first failure'});await p.flush();
  p.context.window.Spotify.Player=function(){return {...p.sdk};};
  const retry=p.click('spotify-play-toggle');await p.flush();oldError({message:'stale error'});p.events.ready({device_id:'browser-device'});await retry;
  await p.click('spotify-play-toggle');assert.ok(p.requests.find(r=>r.url.includes('/me/player/play?device_id=browser-device')));
});

test('SoundCloud tab defers Spotify polling and SDK initialization',async()=>{
 const p=await setup({provider:'soundcloud'});assert.equal(p.requests.length,0);assert.equal(p.sdkCalls.includes('connect'),false);
});
test('music panel can pause Spotify before SoundCloud plays',async()=>{
 const p=await setup({state:{is_playing:true,device:{id:'phone'},item:{name:'Track',artists:[],duration_ms:1000},progress_ms:0}});
 assert.ok(p.context.window.rickSpotifyControl);await p.context.window.rickSpotifyControl.pause();assert.ok(p.requests.some(r=>r.url.endsWith('/me/player/pause')&&r.method==='PUT'));
});
test('starting Spotify pauses SoundCloud before the play command',async()=>{
 const p=await setup();await p.click('spotify-play-toggle');assert.ok(p.sdkCalls.includes('soundcloud-pause'));
});

test('SoundCloud can pause existing Spotify playback even when its tab has not polled',async()=>{
 const p=await setup({provider:'soundcloud',state:{is_playing:true,device:{id:'phone'},item:{name:'Track',artists:[],duration_ms:1000},progress_ms:0}});
 assert.equal(p.requests.length,0);await p.context.window.rickSpotifyControl.pause();assert.ok(p.requests.some(r=>r.url.endsWith('/me/player/pause')));
});

test('switching back to Spotify during the SoundCloud pause check does not issue a late pause',async()=>{
 let release;const gate=new Promise(r=>release=r);const options={provider:'soundcloud',state:{is_playing:true,item:{name:'Track',artists:[],duration_ms:1000},progress_ms:0},beforeFetch:()=>gate};
 const p=await setup(options);const pending=p.context.window.rickSpotifyControl.pause();await p.flush();p.context.window.rickMusicProvider='spotify';release();await pending;assert.equal(p.requests.some(r=>r.url.endsWith('/me/player/pause')),false);
});
