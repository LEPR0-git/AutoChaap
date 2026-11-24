import React,{useEffect,useState,useRef,useMemo} from 'react';
import {StatusBar} from 'expo-status-bar';
import {View,Text,TextInput,TouchableOpacity,ScrollView,SafeAreaView,ActivityIndicator,Alert,Image,KeyboardAvoidingView,Platform,StyleSheet,AppState,Animated,LayoutAnimation,Modal,PanResponder,useWindowDimensions,UIManager} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import {GoogleSignin,isSuccessResponse} from '@react-native-google-signin/google-signin';
import * as DocumentPicker from 'expo-document-picker';
import * as SecureStore from 'expo-secure-store';

const C={bg:'#f6f9f8',dark:'#10212c',green:'#0aa77e',muted:'#7c919b',white:'#fff',border:'#e5eeee',soft:'#e2f7ed',red:'#dc3545',softRed:'#fdf0f0'};
const fallback=process.env.EXPO_PUBLIC_API_URL||Constants?.expoConfig?.extra?.apiUrl||'';

function Btn({children,onPress,secondary=false,danger=false,disabled=false,style}){
  return (
    <TouchableOpacity disabled={disabled} onPress={onPress} style={[styles.btn,secondary&&styles.secondary,danger&&styles.btnDanger,disabled&&{opacity:.55},style]}>
      <Text style={[styles.btnText,secondary&&{color:C.dark},danger&&{color:'#fff'}]}>{children}</Text>
    </TouchableOpacity>
  );
}

function Field({value,onChangeText,placeholder,secureTextEntry=false,multiline=false,keyboardType}){
  return <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#99aeb5" secureTextEntry={secureTextEntry} multiline={multiline} keyboardType={keyboardType} autoCapitalize="none" style={[styles.input,multiline&&{height:100,textAlignVertical:'top'}]}/>;
}

export default function App(){
  const [url,setUrl]=useState(fallback),[token,setToken]=useState(''),[me,setMe]=useState(null),[page,setPage]=useState('inbox');
  const [authMode,setAuthMode]=useState('login'),[form,setForm]=useState({name:'',email:'',password:''});
  const [accounts,setAccounts]=useState([]),[convs,setConvs]=useState([]),[active,setActive]=useState(null),[msgs,setMsgs]=useState([]);
  const [draft,setDraft]=useState(''),[accountName,setAccountName]=useState(''),[qr,setQr]=useState(null),[edit,setEdit]=useState(null);
  const [busy,setBusy]=useState(false),[ready,setReady]=useState(false),[apiUrlDraft,setApiUrlDraft]=useState(fallback);
  const [aiModels,setAiModels]=useState([]);
  const [adminStats,setAdminStats]=useState(null),[adminUsers,setAdminUsers]=useState([]),[adminModels,setAdminModels]=useState([]);
  const scroll=useRef(null);
  const [query,setQuery]=useState(''),[filter,setFilter]=useState(null),[tabs,setTabs]=useState([]),[mini,setMini]=useState(null),[miniMsgs,setMiniMsgs]=useState([]),[miniDraft,setMiniDraft]=useState(''),[menu,setMenu]=useState(false);
  const [sources,setSources]=useState([]),[source,setSource]=useState({kind:'text',title:'',content:''}),[sourceBusy,setSourceBusy]=useState(false);
  const [typed,setTyped]=useState(''),[googlePending,setGooglePending]=useState(''),[linkPassword,setLinkPassword]=useState('');
  const foreground=useRef(AppState.currentState==='active'),current=useRef({}),refreshing=useRef(false),drafts=useRef({}),session=useRef(0);
  const {width,height}=useWindowDimensions();
  const position=useRef(new Animated.ValueXY({x:12,y:90})).current;
  const pos=useRef({x:12,y:90});
  const pan=useMemo(()=>PanResponder.create({onMoveShouldSetPanResponder:(_,g)=>Math.abs(g.dx)+Math.abs(g.dy)>5,onPanResponderGrant:()=>{position.stopAnimation(v=>{pos.current=v})},onPanResponderMove:(_,g)=>position.setValue({x:Math.max(0,Math.min(width-70,pos.current.x+g.dx)),y:Math.max(0,Math.min(height-90,pos.current.y+g.dy))}),onPanResponderRelease:(_,g)=>{pos.current={x:Math.max(0,Math.min(width-70,pos.current.x+g.dx)),y:Math.max(0,Math.min(height-90,pos.current.y+g.dy))};position.setValue(pos.current)}}),[width,height,position]);
  current.current={active,page,qr,mini,token,url};
  useEffect(()=>{const sub=AppState.addEventListener('change',s=>{foreground.current=s==='active'});return()=>sub.remove()},[]);
  useEffect(()=>{if(Platform.OS==='android')UIManager.setLayoutAnimationEnabledExperimental?.(true);const phrases=['Toutes vos conversations.','Votre assistant intelligent.','Vos clients, votre rythme.'];let i=0,j=0,back=false,timer;const tick=()=>{j+=back?-1:1;setTyped(phrases[i].slice(0,j));let delay=back?35:75;if(j===phrases[i].length){back=true;delay=1300}else if(j===0&&back){back=false;i=(i+1)%phrases.length;delay=250}timer=setTimeout(tick,delay)};tick();return()=>clearTimeout(timer)},[]);
  const visibleConvs=useMemo(()=>convs.filter(c=>(!filter||c.account_id===filter)&&((c.title||'')+' '+c.jid+' '+(c.last_message||'')).toLowerCase().includes(query.toLowerCase())).sort((a,b)=>(Date.parse(b.last_message_at)||0)-(Date.parse(a.last_message_at)||0)),[convs,filter,query]);
  const animate=()=>LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  async function markRead(id,rows){if(!foreground.current)return;const ids=rows.filter(m=>m.direction==='in').map(m=>m.id);if(ids.length){await req('/api/conversations/'+id+'/read',{method:'POST',body:JSON.stringify({message_ids:ids})});setConvs(prev=>prev.map(c=>c.id===id?{...c,unread_count:0}:c))}}
  async function fetchChat(id,miniView=false){
    const gen=session.current;const d=await req('/api/conversations/'+id+'/messages');if(gen!==session.current)return;
    if(miniView?current.current.mini?.id===id:current.current.active?.id===id&&current.current.page==='chat'){
      (miniView?setMiniMsgs:setMsgs)(d.messages);
      if(!menu)await markRead(id,d.messages);
    }
  }
  async function loadSources(id){const d=await req('/api/conversations/'+id+'/knowledge');setSources(d.sources)}
  async function addSource(){if(!source.title.trim()||!source.content.trim()||!edit)return;setSourceBusy(true);try{await req('/api/conversations/'+edit.id+'/knowledge',{method:'POST',body:JSON.stringify(source)});setSource({kind:'text',title:'',content:''});await loadSources(edit.id)}catch(e){fail(e)}finally{setSourceBusy(false)}}
  async function uploadPDF(){if(!edit)return;setSourceBusy(true);try{const result=await DocumentPicker.getDocumentAsync({type:'application/pdf',copyToCacheDirectory:true});if(result.canceled)return;const f=result.assets[0];if(f.size>5*1024*1024)throw Error('PDF : 5 Mo maximum');const body=new FormData();body.append('file',{uri:f.uri,name:f.name,type:'application/pdf'});await req('/api/conversations/'+edit.id+'/knowledge',{method:'POST',body});await loadSources(edit.id)}catch(e){fail(e)}finally{setSourceBusy(false)}}
  async function removeSource(s){try{await req('/api/conversations/'+edit.id+'/knowledge/'+s.id,{method:'DELETE'});await loadSources(edit.id)}catch(e){fail(e)}}
  function openSettings(){setEdit({...active});setSources([]);setSource({kind:'text',title:'',content:''});setPage('settings');loadSources(active.id).catch(fail)}
  function openMini(){if(!active)return;setMini(active);setMiniMsgs(msgs);setMiniDraft('')}
  async function sendMini(){if(!miniDraft.trim()||!mini)return;const text=miniDraft,id=mini.id;setMiniDraft('');try{await req('/api/conversations/'+id+'/messages',{method:'POST',body:JSON.stringify({content:text})});await fetchChat(id,true)}catch(e){setMiniDraft(text);fail(e)}}
  function closeTab(id){setTabs(prev=>prev.filter(t=>t!==id));if(active?.id===id){const next=convs.find(c=>c.id===tabs.filter(t=>t!==id).at(-1));if(next)loadConversation(next);else{setActive(null);setPage('inbox')}}}


  useEffect(()=>{(async()=>{
    try{
      const t=await SecureStore.getItemAsync('autochapp_token');
      await AsyncStorage.removeItem('token');
      const u=await AsyncStorage.getItem('user');
      const x=await AsyncStorage.getItem('api_url');
      if(x){setUrl(x);setApiUrlDraft(x)}
      if(t){setToken(t);setMe(JSON.parse(u||'null'))}
    }catch(e){console.warn('Local session restore failed')}finally{setReady(true)}
  })()},[]);

  async function req(path,opts={},overrideToken=null){
    const base=url.replace(/\/$/,'');
    if(!/^https?:\/\/[^\s/]+/i.test(base))throw Error('Configurez une adresse API valide. HTTPS recommandé.');
    let r;
    try{
      r=await fetch(base+path,{...opts,headers:{...(opts.body instanceof FormData?{}:{'Content-Type':'application/json'}),...((overrideToken||token)?{Authorization:'Bearer '+(overrideToken||token)}:{}),...(opts.headers||{})}});
    }catch{
      throw new Error('API inaccessible. Vérifiez l’adresse du serveur dans Paramètres.');
    }
    let d={};
    try{d=await r.json()}catch{}
    if(!r.ok){const e=Error(d.error||`HTTP ${r.status}`);e.code=d.code;if(r.status===401&&token&&!path.startsWith('/api/auth/'))await disconnect();throw e}
    return d;
  }

  function fail(e){Alert.alert('AutoChapp',e.message||String(e))}

  async function acceptAuth(d){
    await SecureStore.setItemAsync('autochapp_token',d.token);
    await AsyncStorage.setItem('user',JSON.stringify(d.user));
    session.current++;setToken(d.token);setMe(d.user);setPage('inbox');
  }
  async function login(){
    setBusy(true);
    try{await acceptAuth(await req('/api/auth/login',{method:'POST',body:JSON.stringify(form)}))}catch(e){fail(e)}finally{setBusy(false)}
  }
  async function googleLogin(link=false){
    setBusy(true);let credential=googlePending;
    try{
      if(!link){
        const config=await req('/api/auth/config');if(!config.google_client_id)throw Error('Google OAuth non configuré sur le serveur.');
        GoogleSignin.configure({webClientId:config.google_client_id});
        await GoogleSignin.hasPlayServices({showPlayServicesUpdateDialog:true});
        const response=await GoogleSignin.signIn();if(!isSuccessResponse(response))return;
        credential=response.data.idToken;if(!credential)throw Error('Jeton Google absent. Vérifiez le Client ID Web et le SHA-1 Android.');
      }
      const d=await req('/api/auth/google',{method:'POST',body:JSON.stringify({credential,password:link?linkPassword:''})});
      await acceptAuth(d);setGooglePending('');setLinkPassword('');
    }catch(e){if(e.code==='link_required')setGooglePending(credential);fail(e)}finally{setBusy(false)}
  }
  async function refresh(){
    if(!token||refreshing.current||!foreground.current)return;
    const gen=session.current;refreshing.current=true;
    try{
      const [a,c]=await Promise.all([req('/api/accounts'),req('/api/conversations')]);if(gen!==session.current)return;
      setAccounts(a.accounts);setConvs(c.conversations);
      const state=current.current;
      if(state.active){const found=c.conversations.find(x=>x.id===state.active.id);if(found){setActive(found);if(state.page==='chat')await fetchChat(found.id)}}
      if(state.mini)await fetchChat(state.mini.id,true);
      if(state.qr?.id){const id=state.qr.id,q=await req('/api/accounts/'+id+'/status');if(current.current.qr?.id===id){setQr(prev=>prev?.id===id?{...prev,...q}:prev);if(q.status==='connected'){setQr(null);Alert.alert('WhatsApp','Compte connecté avec succès !')}}}
      const models=await req('/api/models');if(gen===session.current)setAiModels(models.models||[]);
    }catch(e){console.log('Refresh:',e.message)}finally{refreshing.current=false}
  }
  useEffect(()=>{if(!token)return;refresh();const timer=setInterval(refresh,4000);return()=>clearInterval(timer)},[token,url,page,active?.id,qr?.id,mini?.id]);
  async function loadConversation(c){
    if(active)drafts.current[active.id]=draft;
    setDraft(drafts.current[c.id]||'');setTabs(prev=>prev.includes(c.id)?prev:[...prev,c.id]);setMsgs([]);setActive(c);setPage('chat');animate();
    current.current={...current.current,active:c,page:'chat'};
    try{await fetchChat(c.id)}catch(e){fail(e)}
  }
  async function send(){
    if(!draft.trim()||!active||busy)return;
    const x=draft,id=active.id;setDraft('');setBusy(true);
    try{await req('/api/conversations/'+id+'/messages',{method:'POST',body:JSON.stringify({content:x})});await fetchChat(id)}
    catch(e){if(current.current.active?.id===id)setDraft(x);else drafts.current[id]=x;fail(e)}finally{setBusy(false)}
  }

  async function addAccount(){
    if(!accountName.trim())return;
    setBusy(true);
    try{
      const d=await req('/api/accounts',{method:'POST',body:JSON.stringify({label:accountName.trim()})});
      setAccountName('');
      setPage('accounts');
      await beginQr(d.account);
    }catch(e){fail(e)}finally{setBusy(false)}
  }

  async function beginQr(a){
    setQr({id:a.id,label:a.label,status:'connecting'});
    try{
      const d=await req(`/api/accounts/${a.id}/qr`);
      setQr(prev=>prev?.id===a.id?{...prev,...d}:prev);
    }catch(e){fail(e)}
  }

  function confirmDeleteAccount(a){
    Alert.alert('Supprimer ce compte',`Supprimer définitivement "${a.label}" et toutes ses conversations ?`,[
      {text:'Annuler',style:'cancel'},
      {text:'Supprimer',style:'destructive',onPress:async()=>{
        try{
          await req(`/api/accounts/${a.id}`,{method:'DELETE'});
          if(qr?.id===a.id)setQr(null);
          if(active?.account_id===a.id)setActive(null);
          await refresh();
        }catch(e){fail(e)}
      }}
    ]);
  }

  async function saveSettings(){
    setBusy(true);
    try{
      const d=await req(`/api/conversations/${edit.id}/settings`,{method:'PATCH',body:JSON.stringify(edit)});
      setActive(d.conversation);
      setEdit(null);
      setPage('chat');
      await refresh();
    }catch(e){fail(e)}finally{setBusy(false)}
  }

  async function loadAdmin(){
    try{
      const [s,u,m]=await Promise.all([req('/api/admin/stats'),req('/api/admin/users'),req('/api/admin/models')]);
      setAdminStats(s);setAdminUsers(u.users||[]);setAdminModels(m.models||[]);
    }catch(e){fail(e)}
  }

  function confirmDeleteUser(u){
    Alert.alert('Supprimer utilisateur',`Supprimer ${u.name} (${u.email}) ?`,[
      {text:'Annuler',style:'cancel'},
      {text:'Supprimer',style:'destructive',onPress:async()=>{
        try{
          await req(`/api/admin/users/${u.id}`,{method:'DELETE'});
          await loadAdmin();
        }catch(e){fail(e)}
      }}
    ]);
  }

  async function disconnect(){
    session.current++;setToken('');setMe(null);setActive(null);setConvs([]);setAccounts([]);setMsgs([]);setTabs([]);setMini(null);setQr(null);setEdit(null);setDraft('');setSources([]);setMenu(false);drafts.current={};
    await SecureStore.deleteItemAsync('autochapp_token');await AsyncStorage.multiRemove(['token','user']);
    try{await GoogleSignin.signOut()}catch{}
  }

  const header=(title,subtitle)=> (
    <View style={styles.header}>
      <View>
        <Text style={styles.headerSmall}>{subtitle||'AUTOCHAPP'}</Text>
        <Text style={styles.headerTitle}>{title}</Text>
      </View>
      <TouchableOpacity accessibilityLabel="Menu" style={styles.headerBadge} onPress={()=>setMenu(true)}><Text style={{color:C.green,fontWeight:'900',fontSize:20}}>☰</Text></TouchableOpacity>
    </View>
  );

  if(!ready)return <View style={styles.center}><ActivityIndicator color={C.green}/></View>;

  // AUTH SCREEN
  if(!token)return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark"/>
      <ScrollView contentContainerStyle={{padding:25,flexGrow:1,justifyContent:'center'}} keyboardShouldPersistTaps="handled">
        <View style={styles.logo}><Text style={styles.logoText}>◉  autochapp<Text style={{color:C.green}}>.</Text></Text></View>
        <View style={styles.authHero}>
          <Text style={styles.bigTitle}>AutoChapp.{'\n'}<Text style={{color:C.green}}>{typed}▏</Text></Text>
          <Text style={styles.muted}>Gérez tous vos comptes WhatsApp et votre assistant IA au même endroit.</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{authMode==='login'?'Ravi de vous revoir':'Rejoignez AutoChapp'}</Text>
          <Text style={styles.muted}>{authMode==='login'?'Connectez-vous à votre espace.':'Créez votre espace personnel.'}</Text>
          {authMode==='login'&&<>
            <Field value={form.email} onChangeText={v=>setForm({...form,email:v})} placeholder="Adresse e-mail" keyboardType="email-address"/>
            <Field value={form.password} onChangeText={v=>setForm({...form,password:v})} placeholder="Mot de passe" secureTextEntry/>
            <Btn onPress={login} disabled={busy}>Se connecter →</Btn>
          </>}
          <Btn secondary onPress={()=>googleLogin()} disabled={busy}>G  Continuer avec Google</Btn>
          {googlePending!==''&&<><Field value={linkPassword} onChangeText={setLinkPassword} placeholder="Mot de passe de votre compte existant" secureTextEntry/><Btn disabled={busy} onPress={()=>googleLogin(true)}>Lier mon compte à Google</Btn></>}
          {busy&&<ActivityIndicator style={{marginTop:15}} color={C.green}/>}
          <TouchableOpacity style={{padding:18,alignItems:'center'}} onPress={()=>setAuthMode(authMode==='login'?'register':'login')}>
            <Text style={{color:C.green,fontWeight:'700'}}>{authMode==='login'?'Créer un compte':'J’ai déjà un compte'}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={()=>setPage(page==='api-settings'?'inbox':'api-settings')}>
          <Text style={{textAlign:'center',color:C.muted,marginTop:20}}>⚙ Configurer l'adresse du serveur</Text>
        </TouchableOpacity>
        {page==='api-settings'&&<View style={{marginTop:14}}>
          <Field value={apiUrlDraft} onChangeText={setApiUrlDraft} placeholder="http://37.60.250.220:5888"/>
          <Btn onPress={async()=>{const cleaned=apiUrlDraft.trim().replace(/\/$/,'');setUrl(cleaned);await AsyncStorage.setItem('api_url',cleaned);setPage('inbox')}}>Enregistrer l'adresse</Btn>
        </View>}
      </ScrollView>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark"/>

      {/* PAGE 1: INBOX */}
      {page==='inbox'&&<>
        {header('Conversations','BOÎTE DE RÉCEPTION')}
        <ScrollView contentContainerStyle={{padding:17,paddingBottom:105}}>
          <View style={styles.stats}>
            <Text style={{fontSize:28,fontWeight:'800',color:C.dark}}>{convs.length}</Text>
            <Text style={styles.muted}> conversations • {accounts.filter(x=>x.status==='connected').length} comptes connectés</Text>
          </View>
          {!convs.length&&<View style={styles.empty}>
            <Text style={{fontSize:42,color:C.green}}>◉</Text>
            <Text style={styles.cardTitle}>Aucun message pour le moment</Text>
            <Text style={styles.muted}>Connectez un compte WhatsApp ci-dessous pour recevoir vos messages.</Text>
            <Btn onPress={()=>setPage('accounts')}>Connecter un compte WhatsApp</Btn>
          </View>}
          <Field value={query} onChangeText={setQuery} placeholder="Rechercher un contact ou message"/>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginVertical:12}}>{[{id:null,label:'Tous'},...accounts].map(a=><TouchableOpacity key={a.id||'all'} style={[styles.tab,filter===a.id&&styles.choiceActive]} onPress={()=>setFilter(a.id)}><Text>{a.label}</Text></TouchableOpacity>)}</ScrollView>
          {visibleConvs.map(c=>(
            <TouchableOpacity key={c.id} style={styles.item} onPress={()=>loadConversation(c)}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{c.title?.[0]?.toUpperCase()}</Text></View>
              <View style={{flex:1}}>
                <Text style={styles.itemTitle}>{c.title}</Text>
                <Text numberOfLines={1} style={styles.muted}>{c.last_message||c.jid.split('@')[0]}</Text>
              </View>
              <View style={{alignItems:'flex-end',gap:5}}><Text style={styles.muted}>{c.last_message_at?new Date(c.last_message_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}):''}</Text>{c.unread_count>0?<Text style={styles.unread}>{c.unread_count}</Text>:<Text style={styles.tag}>{c.mode==='manual'?'MOI':c.mode==='ai'?'IA':'MIX'}</Text>}</View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </>}

      {/* PAGE 2: ACCOUNTS MANAGEMENT */}
      {page==='accounts'&&<>
        {header('Mes comptes WhatsApp','CONNECTIVITÉ')}
        <ScrollView contentContainerStyle={{padding:18,paddingBottom:100}}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Ajouter un compte</Text>
            <Text style={styles.muted}>Le QR code est généré dès validation du nom.</Text>
            <Field value={accountName} onChangeText={setAccountName} placeholder="Ex. WhatsApp Support"/>
            <Btn disabled={busy} onPress={addAccount}>Créer et scanner le QR +</Btn>
          </View>

          {accounts.map(a=>(
            <View key={a.id} style={styles.item}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{a.label[0]}</Text></View>
              <View style={{flex:1}}>
                <Text style={styles.itemTitle}>{a.label}</Text>
                <Text style={styles.muted}>{a.status==='connected'?'Connecté ('+(a.phone||'WhatsApp')+')':'Hors ligne'}</Text>
              </View>
              <TouchableOpacity onPress={()=>beginQr(a)} style={{marginRight:12}}>
                <Text style={{color:C.green,fontWeight:'700'}}>QR / Lier</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={()=>confirmDeleteAccount(a)}>
                <Text style={{color:C.red,fontWeight:'700'}}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}

          {qr&&<View style={[styles.card,{alignItems:'center'}]}>
            <Text style={styles.cardTitle}>{qr.label}</Text>
            <Text style={styles.muted}>Statut : {qr.status}</Text>
            {qr.qr?<Image source={{uri:qr.qr}} style={{width:230,height:230,marginVertical:18}}/>:<ActivityIndicator style={{margin:25}} color={C.green}/>}
            <Text style={[styles.muted,{textAlign:'center',marginVertical:15}]}>
              Sur WhatsApp : Appareils connectés → Connecter un appareil. Scannez ce code.
            </Text>
            <View style={{flexDirection:'row',gap:10,width:'100%'}}>
              <Btn secondary style={{flex:1}} onPress={()=>beginQr(qr)}>Actualiser</Btn>
              <Btn danger style={{flex:1}} onPress={()=>confirmDeleteAccount(qr)}>Supprimer</Btn>
            </View>
          </View>}
        </ScrollView>
      </>}

      {/* PAGE 3: CHAT VIEW */}
      {page==='chat'&&active&&<>
        <View style={{height:44,backgroundColor:'white'}}><ScrollView horizontal showsHorizontalScrollIndicator={false}>{tabs.map(id=>{const c=convs.find(x=>x.id===id);return c?<View key={id} style={[styles.tab,active.id===id&&styles.choiceActive]}><TouchableOpacity onPress={()=>loadConversation(c)}><Text numberOfLines={1} style={{maxWidth:110}}>{c.title}</Text></TouchableOpacity><TouchableOpacity onPress={()=>closeTab(id)}><Text style={{color:C.muted,fontSize:18}}>×</Text></TouchableOpacity></View>:null})}</ScrollView></View>
        <View style={styles.chatHeader}>
          <TouchableOpacity onPress={()=>{setActive(null);setPage('inbox')}}>
            <Text style={{fontSize:25,color:C.green,paddingHorizontal:5}}>‹</Text>
          </TouchableOpacity>
          <View style={{flex:1}}>
            <Text style={styles.itemTitle}>{active.title}</Text>
            <Text style={styles.muted}>{active.jid.split('@')[0]}</Text>
          </View>
          <TouchableOpacity onPress={openMini}><Text style={{color:C.green,fontSize:23}}>↗</Text></TouchableOpacity>
          <TouchableOpacity onPress={openSettings}>
            <Text style={{color:C.green,fontWeight:'700'}}>⚙ {active.mode.toUpperCase()}</Text>
          </TouchableOpacity>
        </View>
        <ScrollView ref={scroll} onContentSizeChange={()=>scroll.current?.scrollToEnd({animated:true})} style={{flex:1,padding:14}}>
          {msgs.length===0&&<Text style={{textAlign:'center',color:C.muted,margin:40}}>Aucun message</Text>}
          {msgs.map(m=>(
            <View key={m.id} style={[styles.bubble,m.direction==='out'?styles.out:styles.in]}>
              <Text style={{color:C.dark,lineHeight:20}}>{m.content}</Text>
              <Text style={{fontSize:9,color:C.muted,textAlign:'right',marginTop:7}}>
                {m.sender==='ai'?'IA • ':''}{new Date(m.created_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}
              </Text>
            </View>
          ))}
        </ScrollView>
        <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':undefined}>
          <View style={styles.composer}>
            <TextInput style={styles.composeInput} value={draft} onChangeText={setDraft} placeholder="Message (frappe humaine simulée)…" multiline/>
            <TouchableOpacity onPress={send} style={styles.send}><Text style={{color:'white',fontSize:20}}>➤</Text></TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </>}

      {/* PAGE 4: CONVERSATION SETTINGS (AI MODEL SELECTION) */}
      {page==='settings'&&edit&&<>
        {header('Mode & Modèle IA','PARAMÈTRES CONTACT')}
        <ScrollView contentContainerStyle={{padding:18,paddingBottom:100}}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{edit.title}</Text>
            <Text style={[styles.muted,{marginBottom:12}]}>Choisissez qui répond à ce contact.</Text>
            {[['manual','👤 Manuel — je réponds'],['ai','✳ IA autonome — répond à tout'],['hybrid','◈ Hybride — selon les règles']].map(([v,l])=>(
              <TouchableOpacity key={v} style={[styles.choice,edit.mode===v&&styles.choiceActive]} onPress={()=>setEdit({...edit,mode:v})}>
                <Text style={{color:edit.mode===v?C.green:C.dark,fontWeight:'700'}}>{l}</Text>
                <Text style={{color:C.green}}>{edit.mode===v?'✓':''}</Text>
              </TouchableOpacity>
            ))}

            {edit.mode!=='manual'&&<>
              {/* AI MODEL SELECTOR */}
              <Text style={styles.label}>Choix du modèle d'Intelligence Artificielle</Text>
              <TouchableOpacity style={[styles.choice,!edit.ai_model_id&&styles.choiceActive]} onPress={()=>setEdit({...edit,ai_model_id:null})}>
                <Text style={{color:!edit.ai_model_id?C.green:C.dark,fontWeight:'700'}}>Groq Llama 3.3 (Défaut)</Text>
                <Text style={{color:C.green}}>{!edit.ai_model_id?'✓':''}</Text>
              </TouchableOpacity>
              {aiModels.map(m=>(
                <TouchableOpacity key={m.id} style={[styles.choice,edit.ai_model_id===m.id&&styles.choiceActive]} onPress={()=>setEdit({...edit,ai_model_id:m.id})}>
                  <Text style={{color:edit.ai_model_id===m.id?C.green:C.dark,fontWeight:'700'}}>{m.name} ({m.model_id})</Text>
                  <Text style={{color:C.green}}>{edit.ai_model_id===m.id?'✓':''}</Text>
                </TouchableOpacity>
              ))}

              <Text style={styles.label}>Instructions de l'IA (Prompt)</Text>
              <Field multiline value={edit.instructions||''} onChangeText={v=>setEdit({...edit,instructions:v})} placeholder="Ex. Sois poli et concis, réponds en français."/>

              <Text style={styles.label}>Base de connaissances (facultative)</Text>
              <Text style={styles.muted}>PDF textuel, catalogue, liens, numéros ou descriptions d'images.</Text>
              {sources.map(s=><View key={s.id} style={styles.item}><View style={{flex:1}}><Text style={styles.itemTitle}>{s.title}</Text><Text numberOfLines={2} style={styles.muted}>{s.kind} · {s.preview}</Text></View><TouchableOpacity onPress={()=>removeSource(s)}><Text style={{color:C.red}}>×</Text></TouchableOpacity></View>)}
              <Btn secondary disabled={sourceBusy} onPress={uploadPDF}>Importer un PDF (5 Mo)</Btn>
              <View style={{flexDirection:'row',flexWrap:'wrap'}}>{[['text','Texte'],['link','Lien'],['phone','Contact'],['image','Description image']].map(([kind,label])=><TouchableOpacity key={kind} onPress={()=>setSource({...source,kind})} style={[styles.tab,source.kind===kind&&styles.choiceActive]}><Text>{label}</Text></TouchableOpacity>)}</View>
              <Field value={source.title} onChangeText={title=>setSource({...source,title})} placeholder="Titre de la source"/>
              <Field multiline value={source.content} onChangeText={content=>setSource({...source,content})} placeholder="Informations, lien, numéro ou description"/>
              <Btn secondary disabled={sourceBusy||!source.title.trim()||!source.content.trim()} onPress={addSource}>Ajouter la source</Btn>
              {edit.mode==='hybrid'&&<>
                <Text style={styles.label}>Conditions hybrides</Text>
                {[['keywords','Mots-clés dans le message'],['outside_hours','En dehors des heures (UTC)'],['always_draft','Pas de réponse automatique']].map(([v,l])=>(
                  <TouchableOpacity key={v} onPress={()=>setEdit({...edit,hybrid_rule:v})} style={styles.choice}>
                    <Text>{edit.hybrid_rule===v?'◉':'○'} {l}</Text>
                  </TouchableOpacity>
                ))}
                {edit.hybrid_rule==='keywords'&&<Field value={edit.keywords||''} onChangeText={v=>setEdit({...edit,keywords:v})} placeholder="prix, horaires, stock"/>}
                {edit.hybrid_rule==='outside_hours'&&<Field value={edit.business_hours||''} onChangeText={v=>setEdit({...edit,business_hours:v})} placeholder="09:00-18:00"/>}
              </>}

              <Text style={styles.label}>Délai minimum (secondes)</Text>
              <Field keyboardType="numeric" value={String(edit.cooldown_seconds??60)} onChangeText={v=>setEdit({...edit,cooldown_seconds:Number(v)||0})}/>
            </>}

            <Btn onPress={saveSettings} disabled={busy}>Enregistrer les réglages</Btn>
            <Btn secondary style={{marginTop:9}} onPress={()=>setPage('chat')}>Annuler</Btn>
          </View>
        </ScrollView>
      </>}

      {/* PAGE 5: ADMIN DASHBOARD (ADMIN ONLY) */}
      {page==='admin'&&me?.role==='admin'&&<>
        {header('Administration','GLOBAL')}
        <ScrollView contentContainerStyle={{padding:18,paddingBottom:100}}>
          <View style={styles.stats}>
            <Text style={{fontSize:24,fontWeight:'800',color:C.dark}}>{adminUsers.length} utilisateurs</Text>
            <Text style={styles.muted}> • {adminStats?.messages||0} messages</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Utilisateurs enregistrés</Text>
            {adminUsers.map(u=>(
              <View key={u.id} style={[styles.item,{marginVertical:6}]}>
                <View style={{flex:1}}>
                  <Text style={styles.itemTitle}>{u.name} ({u.role})</Text>
                  <Text style={styles.muted}>{u.email} • {u.accounts_count} comptes</Text>
                </View>
                {u.id!==me.id&&<TouchableOpacity onPress={()=>confirmDeleteUser(u)}>
                  <Text style={{color:C.red,fontWeight:'700'}}>Supprimer</Text>
                </TouchableOpacity>}
              </View>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Modèles d'IA disponibles ({adminModels.length})</Text>
            {adminModels.map(m=>(
              <View key={m.id} style={[styles.item,{marginVertical:5}]}>
                <View style={{flex:1}}>
                  <Text style={styles.itemTitle}>{m.name} {m.is_default?'(Défaut)':''}</Text>
                  <Text style={styles.muted}>{m.model_id}</Text>
                </View>
                <Text style={{color:m.enabled?C.green:C.muted,fontWeight:'700'}}>{m.enabled?'Actif':'Inactif'}</Text>
              </View>
            ))}
          </View>
        </ScrollView>
      </>}

      {/* PAGE 6: PROFILE & CONFIG */}
      {page==='profile'&&<>
        {header('Mon espace','PARAMÈTRES')}
        <ScrollView contentContainerStyle={{padding:18}}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{me?.name}</Text>
            <Text style={styles.muted}>{me?.email} ({me?.role==='admin'?'Administrateur':'Utilisateur'})</Text>
            <Text style={[styles.label,{marginTop:20}]}>Adresse du backend API</Text>
            <Field value={apiUrlDraft} onChangeText={setApiUrlDraft} placeholder="http://37.60.250.220:5888"/>
            <Btn onPress={async()=>{const x=apiUrlDraft.trim().replace(/\/$/,'');setUrl(x);await AsyncStorage.setItem('api_url',x);Alert.alert('API','Adresse mise à jour')}}>Enregistrer l'adresse</Btn>
            <Btn secondary style={{marginTop:13}} onPress={disconnect}>Se déconnecter</Btn>
          </View>
        </ScrollView>
      </>}

      {mini&&<Animated.View style={[styles.mini,{width:Math.min(width-16,320),transform:position.getTranslateTransform()}]}>
        <View style={styles.miniHeader} {...pan.panHandlers}><Text numberOfLines={1} style={{flex:1,color:'white',fontWeight:'700'}}>{mini.title}</Text><TouchableOpacity onPress={()=>{setMini(null);setMiniMsgs([]);setMiniDraft('')}}><Text style={{color:'white',fontSize:24,paddingHorizontal:10}}>−</Text></TouchableOpacity></View>
        <ScrollView style={{flex:1,padding:8}}>{miniMsgs.map(m=><View key={m.id} style={[styles.bubble,m.direction==='out'?styles.out:styles.in]}><Text>{m.content}</Text></View>)}</ScrollView>
        <View style={styles.composer}><TextInput style={styles.composeInput} value={miniDraft} onChangeText={setMiniDraft} placeholder="Message…"/><TouchableOpacity onPress={sendMini}><Text style={{color:C.green,fontSize:22}}>➤</Text></TouchableOpacity></View>
      </Animated.View>}
      <Modal transparent visible={menu} animationType="slide" onRequestClose={()=>setMenu(false)}><View style={{flex:1,backgroundColor:'#0006',justifyContent:'flex-start'}}><View style={[styles.card,{width:'80%',flex:1,paddingTop:45}]}><Text style={styles.cardTitle}>AutoChapp</Text>{[['inbox','Messages'],['accounts','Comptes'],...(me?.role==='admin'?[['admin','Administration']]:[]),['profile','Profil']].map(([p,label])=><Btn key={p} secondary onPress={()=>{setMenu(false);setPage(p);if(p==='admin')loadAdmin()}}>{label}</Btn>)}<Btn secondary onPress={()=>setMenu(false)}>Fermer</Btn></View></View></Modal>
      {/* BOTTOM NAVIGATION */}
      {page!=='chat'&&page!=='settings'&&<View style={styles.nav}>
        {[
          ['inbox','◉','Messages'],
          ['accounts','▣','Comptes'],
          ...(me?.role==='admin'?[['admin','⚡','Admin']]:[]),
          ['profile','⚙','Profil']
        ].map(([v,ico,l])=>(
          <TouchableOpacity key={v} style={styles.navItem} onPress={()=>{
            if(v==='admin')loadAdmin();
            setPage(v);
          }}>
            <Text style={{fontSize:22,color:page===v?C.green:C.muted}}>{ico}</Text>
            <Text style={{fontSize:10,fontWeight:'700',color:page===v?C.green:C.muted}}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>}
    </SafeAreaView>
  );
}

const styles=StyleSheet.create({
  container:{flex:1,backgroundColor:C.bg},
  center:{flex:1,justifyContent:'center'},
  logo:{marginBottom:45},
  logoText:{fontSize:29,fontWeight:'900',color:C.dark,letterSpacing:-1.3},
  authHero:{marginBottom:30},
  bigTitle:{fontSize:33,fontWeight:'800',color:C.dark,lineHeight:42},
  muted:{color:C.muted,fontSize:12,lineHeight:20},
  card:{backgroundColor:'white',padding:22,borderRadius:18,borderColor:C.border,borderWidth:1,marginBottom:15},
  cardTitle:{fontSize:20,fontWeight:'800',color:C.dark,marginBottom:7},
  input:{borderWidth:1,borderColor:C.border,borderRadius:10,paddingHorizontal:15,paddingVertical:14,marginTop:14,backgroundColor:'#fbfdfd',color:C.dark,fontSize:13},
  btn:{backgroundColor:C.green,borderRadius:10,minHeight:46,justifyContent:'center',alignItems:'center',marginTop:13,padding:10},
  secondary:{backgroundColor:'#edf2f4'},
  btnDanger:{backgroundColor:C.red},
  btnText:{color:'#fff',fontWeight:'800',fontSize:13},
  header:{backgroundColor:'white',padding:23,borderBottomWidth:1,borderColor:C.border,flexDirection:'row',justifyContent:'space-between',alignItems:'center'},
  headerSmall:{color:C.green,fontSize:10,fontWeight:'900',letterSpacing:2,marginBottom:6},
  headerTitle:{fontSize:25,fontWeight:'800',color:C.dark},
  headerBadge:{height:40,width:40,borderRadius:13,backgroundColor:C.soft,justifyContent:'center',alignItems:'center'},
  stats:{marginBottom:19,backgroundColor:C.soft,padding:17,borderRadius:13,flexDirection:'row',alignItems:'center',gap:8},
  empty:{alignItems:'center',backgroundColor:'#fff',padding:35,borderRadius:18,gap:12},
  item:{backgroundColor:'white',flexDirection:'row',alignItems:'center',gap:12,padding:16,borderRadius:12,marginBottom:9,borderColor:C.border,borderWidth:1},
  avatar:{height:43,width:43,borderRadius:14,backgroundColor:C.soft,justifyContent:'center',alignItems:'center'},
  avatarText:{color:C.green,fontWeight:'900',fontSize:19},
  itemTitle:{fontSize:13,fontWeight:'800',color:C.dark},
  tag:{fontSize:10,fontWeight:'900',backgroundColor:'#f1f4f5',padding:8,borderRadius:8,color:C.muted},
  chatHeader:{height:72,padding:15,backgroundColor:'#fff',flexDirection:'row',alignItems:'center',gap:16,borderBottomWidth:1,borderColor:C.border},
  bubble:{maxWidth:'83%',borderRadius:13,padding:13,marginVertical:6},
  in:{backgroundColor:'#fff',alignSelf:'flex-start',borderBottomLeftRadius:3},
  out:{backgroundColor:'#d9f7e8',alignSelf:'flex-end',borderBottomRightRadius:3},
  composer:{padding:12,flexDirection:'row',backgroundColor:'white',alignItems:'center',gap:10},
  composeInput:{flex:1,backgroundColor:C.bg,borderWidth:1,borderColor:C.border,borderRadius:11,minHeight:46,maxHeight:110,padding:12},
  send:{backgroundColor:C.green,padding:13,borderRadius:12},
  nav:{height:68,backgroundColor:'white',flexDirection:'row',justifyContent:'space-around',borderTopWidth:1,borderColor:C.border},
  navItem:{width:'25%',alignItems:'center',justifyContent:'center',gap:5},
  choice:{padding:14,borderWidth:1,borderColor:C.border,borderRadius:10,marginTop:8,flexDirection:'row',justifyContent:'space-between'},
  choiceActive:{borderColor:C.green,backgroundColor:C.soft},
  label:{marginTop:22,fontWeight:'800',fontSize:12,color:C.dark},
  unread:{backgroundColor:'#15803d',color:'white',fontWeight:'800',minWidth:23,textAlign:'center',padding:4,borderRadius:14},tab:{flexDirection:'row',alignItems:'center',gap:10,padding:10,borderWidth:1,borderColor:C.border,borderRadius:8,marginRight:5},mini:{position:'absolute',top:0,left:0,height:300,zIndex:20,elevation:12,borderRadius:12,overflow:'hidden',backgroundColor:C.bg,borderColor:C.border,borderWidth:1},miniHeader:{flexDirection:'row',alignItems:'center',padding:8,backgroundColor:C.green}
});
