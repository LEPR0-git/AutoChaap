import express from 'express';
import makeWASocket, {useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import fs from 'node:fs/promises';
import path from 'node:path';
const app=express();app.use(express.json({limit:'128kb'}));
const secret=process.env.BRIDGE_SECRET;
if(!secret)throw new Error('BRIDGE_SECRET required');
const root=path.resolve('/srv/sessions');
const sessions=new Map();
app.use((req,res,next)=>req.get('X-Bridge-Secret')===secret?next():res.status(403).json({error:'Forbidden'}));
const idOk=(id)=>/^[0-9a-f-]{36}$/i.test(id);
async function emit(data, retry=false){
 const attempts=retry?3:1;
 for(let i=0;i<attempts;i++){
   try{
     const r=await fetch(process.env.CALLBACK_URL,{method:'POST',headers:{'Content-Type':'application/json','X-Bridge-Secret':secret},body:JSON.stringify(data),signal:AbortSignal.timeout(45000)});
     if(r.ok)return true;
     console.error('Callback HTTP',r.status,'event',data.type,'account',data.account_id);
     if(r.status<500 && r.status!==429)return false;
   }catch(e){console.error('Callback failed:',e.message,'event',data.type)}
   if(i+1<attempts)await new Promise(resolve=>setTimeout(resolve,1000*(i+1)));
 }
 return false;
}
const validJid=jid=>typeof jid==='string' && /^(?:\d{1,30}@(s\.whatsapp\.net|lid)|\d+(?:-\d+)?@g\.us)$/.test(jid);
const normalizeJid=jid=>typeof jid==='string'?jid.replace(/:\d+(?=@)/,''):'';
async function canonicalJid(sock,jid,alt){
 jid=normalizeJid(jid);alt=normalizeJid(alt);
 if(!validJid(jid))return null;
 if(jid.endsWith('@lid')){
   if(validJid(alt)&&alt.endsWith('@s.whatsapp.net'))return alt;
   try{const pn=normalizeJid(await sock.signalRepository?.lidMapping?.getPNForLID(jid));if(validJid(pn)&&pn.endsWith('@s.whatsapp.net'))return pn}catch{}
 }
 return jid;
}
async function messageEvent(sock,id,msg,titles){
 const jid=await canonicalJid(sock,msg.key?.remoteJid,msg.key?.remoteJidAlt);
 if(!jid||!msg.key?.id)return null;
 const text=content(msg);if(!text)return null;
 const ts=Number(msg.messageTimestamp);
 return {jid,text:text.slice(0,10000),message_id:id+':'+msg.key.id,title:(titles.get(jid)!==jid?titles.get(jid):null)||(!msg.key.fromMe&&!jid.endsWith('@g.us')?msg.pushName:null)||jid,from_me:!!msg.key.fromMe,timestamp:Number.isFinite(ts)&&ts>0?ts:null};
}
async function syncBatch(id,kind,items){
 let imported=0;
 const step=kind==='messages'?10:40;
 for(let i=0;i<items.length;i+=step){
   const batch=items.slice(i,i+step);
   if(await emit({type:'history',account_id:id,[kind]:batch},true))imported+=batch.length;
 }
 console.log('History callback',kind,imported,'/',items.length,'account',id);
}
function content(msg){const m=msg?.message;if(!m)return '';return m.conversation||m.extendedTextMessage?.text||m.imageMessage?.caption||m.videoMessage?.caption||m.ephemeralMessage?.message?.extendedTextMessage?.text||m.ephemeralMessage?.message?.conversation||'';}
async function connect(id){
 if(!idOk(id))throw new Error('Invalid session id');
 let current=sessions.get(id);
 if(current&&(current.status==='connected'||current.status==='connecting'||current.status==='qr'))return current;
 const stateDir=path.join(root,id);await fs.mkdir(stateDir,{recursive:true});
 const {state,saveCreds}=await useMultiFileAuthState(stateDir);
 const entry={sock:null,status:'connecting',qr:null,phone:null};sessions.set(id,entry);
 const {version}=await fetchLatestBaileysVersion().catch(()=>({version:undefined}));
 const opts={auth:state,logger:pino({level:'silent'}),browser:['AutoChapp','Chrome','1.0.0'],syncFullHistory:true,shouldSyncHistoryMessage:()=>true,markOnlineOnConnect:false};if(version)opts.version=version;
 let sock;
 try{sock=makeWASocket(opts);entry.sock=sock;}catch(e){sessions.delete(id);console.error('Socket initialization failed:',e.message,'account',id);throw e;}
 console.log('WhatsApp connecting (Chrome)','account',id);
 sock.ev.on('creds.update',saveCreds);
 sock.ev.on('connection.update',async ({connection,qr,lastDisconnect})=>{
   if(sessions.get(id)!==entry)return;
   if(qr){entry.qr=await QRCode.toDataURL(qr);entry.status='qr';console.log('WhatsApp QR ready','account',id);await emit({type:'status',account_id:id,status:'qr'})}
   if(connection==='open'){console.log('WhatsApp connected','account',id);entry.status='connected';entry.qr=null;entry.phone=sock.user?.id?.split(':')[0]?.split('@')[0]||null;await emit({type:'status',account_id:id,status:'connected',phone:entry.phone})}
   if(connection==='close'){
     entry.status='disconnected';entry.qr=null;await emit({type:'status',account_id:id,status:'disconnected'});
     const code=lastDisconnect?.error?.output?.statusCode;
     console.warn('WhatsApp connection closed','code',code||'unknown','account',id);
     if(code!==DisconnectReason.loggedOut){sessions.delete(id);setTimeout(()=>{if(!sessions.has(id))connect(id).catch(e=>console.error('Reconnect:',e.message))},3500)}
   }
 });
 const titles=new Map();let queue=Promise.resolve();
 const enqueue=task=>{queue=queue.then(async()=>{if(sessions.get(id)===entry)await task()}).catch(e=>console.error('Sync event failed:',e.message,'account',id));};
 async function importChats(chats){
   const rows=[];
   for(const chat of chats||[]){
     const jid=await canonicalJid(sock,chat.id);if(!jid)continue;
     const title=chat.name||chat.displayName||titles.get(jid)||jid;
     titles.set(jid,title);rows.push({jid,title});
   }
   if(rows.length)await syncBatch(id,'chats',rows);
 }
 sock.ev.on('messaging-history.set',({chats=[],contacts=[],messages=[],isLatest})=>enqueue(async()=>{
   console.log('History received',chats.length,'chats',messages.length,'messages; latest:',!!isLatest,'account',id);
   for(const c of contacts){const jid=await canonicalJid(sock,c.id,c.phoneNumber);if(jid)titles.set(jid,c.name||c.notify||c.verifiedName||jid);}
   await importChats(chats);
   const rows=[];for(const msg of messages){const row=await messageEvent(sock,id,msg,titles);if(row)rows.push(row);}
   if(rows.length)await syncBatch(id,'messages',rows);
 }));
 async function updateContacts(contacts){
   const rows=[];
   for(const contact of contacts||[]){
     const jid=await canonicalJid(sock,contact.id,contact.phoneNumber);
     const title=contact.name||contact.notify||contact.verifiedName;
     if(jid&&title){titles.set(jid,title);rows.push({jid,title});}
   }
   if(rows.length)await syncBatch(id,'contacts',rows);
 }
 sock.ev.on('contacts.upsert',contacts=>enqueue(()=>updateContacts(contacts)));
 sock.ev.on('contacts.update',contacts=>enqueue(()=>updateContacts(contacts)));
 sock.ev.on('chats.upsert',chats=>enqueue(()=>importChats(chats)));
 sock.ev.on('messages.upsert',({messages,type})=>enqueue(async()=>{
   if(type!=='notify'&&type!=='append')return;
   const history=[];
   for(const msg of messages){
     const row=await messageEvent(sock,id,msg,titles);if(!row)continue;
     if(type==='append'||row.from_me){history.push(row);continue;}
     await emit({type:'message',account_id:id,...row});
   }
   if(history.length)await syncBatch(id,'messages',history);
 }));
 return entry;
}
app.post('/sessions/:id/connect',async(req,res)=>{try{const s=await connect(req.params.id);res.json({status:s.status,qr:s.qr,phone:s.phone})}catch(e){console.error('Connect request failed:',e.message,'account',req.params.id);res.status(503).json({error:e.message})}});
app.get('/sessions/:id/status',(req,res)=>{const s=sessions.get(req.params.id);res.json({status:s?.status||'disconnected',qr:s?.qr||null,phone:s?.phone||null})});
app.post('/sessions/:id/send',async(req,res)=>{const s=sessions.get(req.params.id);let {jid,text}=req.body||{};
 if(!s||s.status!=='connected')return res.status(503).json({error:'WhatsApp non connecté'});
 if(typeof text!=='string'||!text.trim()||text.length>10000||typeof jid!=='string'||!validJid(jid))return res.status(400).json({error:'JID ou texte invalide'});
 try{
   try{
     await s.sock.presenceSubscribe(jid);
     await s.sock.sendPresenceUpdate('composing',jid);
     const charDelay=35+Math.floor(Math.random()*25);
     const typingTime=Math.min(Math.max(text.length*charDelay,800),7000);
     await new Promise(r=>setTimeout(r,typingTime));
     await s.sock.sendPresenceUpdate('paused',jid);
   }catch(err){console.warn('Presence update warning:',err.message)}
   const msg=await s.sock.sendMessage(jid,{text});
   res.json({ok:true,messageId:req.params.id+':'+msg.key.id});
 }catch(e){res.status(502).json({error:'Échec envoi WhatsApp'})}
});
app.delete('/sessions/:id',async(req,res)=>{const s=sessions.get(req.params.id);sessions.delete(req.params.id);try{if(s?.sock)await s.sock.logout()}catch{}if(idOk(req.params.id))await fs.rm(path.join(root,req.params.id),{recursive:true,force:true});res.json({ok:true})});
await fs.mkdir(root,{recursive:true});
for(const name of await fs.readdir(root)){if(idOk(name))connect(name).catch(e=>console.error('Restore:',e.message))}
app.listen(Number(process.env.PORT||3100),'0.0.0.0',()=>console.log('AutoChapp bridge ready'));
