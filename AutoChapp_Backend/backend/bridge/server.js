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
async function emit(data){try{await fetch(process.env.CALLBACK_URL,{method:'POST',headers:{'Content-Type':'application/json','X-Bridge-Secret':secret},body:JSON.stringify(data),signal:AbortSignal.timeout(45000)});}catch(e){console.error('Callback failed:',e.message)}}
function content(msg){const m=msg?.message;if(!m)return '';return m.conversation||m.extendedTextMessage?.text||m.imageMessage?.caption||m.videoMessage?.caption||m.ephemeralMessage?.message?.extendedTextMessage?.text||m.ephemeralMessage?.message?.conversation||'';}
async function connect(id){
 if(!idOk(id))throw new Error('Invalid session id');
 let current=sessions.get(id);
 if(current&&(current.status==='connected'||current.status==='connecting'||current.status==='qr'))return current;
 const stateDir=path.join(root,id);await fs.mkdir(stateDir,{recursive:true});
 const {state,saveCreds}=await useMultiFileAuthState(stateDir);
 const entry={sock:null,status:'connecting',qr:null,phone:null};sessions.set(id,entry);
 const {version}=await fetchLatestBaileysVersion().catch(()=>({version:undefined}));
 const opts={auth:state,logger:pino({level:'silent'}),browser:['AutoChapp','Chrome','1.0.0'],markOnlineOnConnect:false};if(version)opts.version=version;
 const sock=makeWASocket(opts);entry.sock=sock;
 sock.ev.on('creds.update',saveCreds);
 sock.ev.on('connection.update',async ({connection,qr,lastDisconnect})=>{
   if(sessions.get(id)!==entry)return;
   if(qr){entry.qr=await QRCode.toDataURL(qr);entry.status='qr';await emit({type:'status',account_id:id,status:'qr'})}
   if(connection==='open'){entry.status='connected';entry.qr=null;entry.phone=sock.user?.id?.split(':')[0]?.split('@')[0]||null;await emit({type:'status',account_id:id,status:'connected',phone:entry.phone})}
   if(connection==='close'){
     entry.status='disconnected';entry.qr=null;await emit({type:'status',account_id:id,status:'disconnected'});
     const code=lastDisconnect?.error?.output?.statusCode;
     if(code!==DisconnectReason.loggedOut){sessions.delete(id);setTimeout(()=>connect(id).catch(e=>console.error('Reconnect:',e.message)),3500)}
   }
 });
 sock.ev.on('messages.upsert',async ({messages,type})=>{
   if(type!=='notify')return;
   for(const msg of messages){const jid=msg.key?.remoteJid;const text=content(msg);
     if(!jid||msg.key?.fromMe||!text||jid==='status@broadcast'||jid.endsWith('@g.us'))continue;
     await emit({type:'message',account_id:id,jid,text,message_id:id+':'+msg.key.id,title:msg.pushName||jid,from_me:false});
   }
 });
 return entry;
}
app.post('/sessions/:id/connect',async(req,res)=>{try{const s=await connect(req.params.id);res.json({status:s.status,qr:s.qr,phone:s.phone})}catch(e){res.status(503).json({error:e.message})}});
app.get('/sessions/:id/status',(req,res)=>{const s=sessions.get(req.params.id);res.json({status:s?.status||'disconnected',qr:s?.qr||null,phone:s?.phone||null})});
app.post('/sessions/:id/send',async(req,res)=>{const s=sessions.get(req.params.id);let {jid,text}=req.body||{};
 if(!s||s.status!=='connected')return res.status(503).json({error:'WhatsApp non connecté'});
 if(typeof text!=='string'||!text.trim()||text.length>10000||typeof jid!=='string'||!/^\d{5,20}@s\.whatsapp\.net$/.test(jid))return res.status(400).json({error:'JID ou texte invalide'});
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
