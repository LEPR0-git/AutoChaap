import React,{useEffect,useState,useRef} from 'react';
import {StatusBar} from 'expo-status-bar';
import {View,Text,TextInput,TouchableOpacity,ScrollView,SafeAreaView,ActivityIndicator,Alert,Image,KeyboardAvoidingView,Platform,StyleSheet} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const C={bg:'#f6f9f8',dark:'#10212c',green:'#0aa77e',muted:'#7c919b',white:'#fff',border:'#e5eeee',soft:'#e2f7ed',red:'#dc3545',softRed:'#fdf0f0'};
const fallback=process.env.EXPO_PUBLIC_API_URL||Constants?.expoConfig?.extra?.apiUrl||'http://37.60.250.220:5888';

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

  useEffect(()=>{(async()=>{
    try{
      const t=await AsyncStorage.getItem('token');
      const u=await AsyncStorage.getItem('user');
      const x=await AsyncStorage.getItem('api_url');
      if(x){setUrl(x);setApiUrlDraft(x)}
      if(t){setToken(t);setMe(JSON.parse(u||'null'))}
    }finally{setReady(true)}
  })()},[]);

  async function req(path,opts={},overrideToken=null){
    const base=url.replace(/\/$/,'');
    let r;
    try{
      r=await fetch(base+path,{...opts,headers:{'Content-Type':'application/json',...((overrideToken||token)?{Authorization:'Bearer '+(overrideToken||token)}:{})}});
    }catch{
      throw new Error('API inaccessible. Vérifiez l’adresse du serveur dans Paramètres.');
    }
    let d={};
    try{d=await r.json()}catch{}
    if(!r.ok)throw Error(d.error||`HTTP ${r.status}`);
    return d;
  }

  function fail(e){Alert.alert('AutoChapp',e.message||String(e))}

  async function login(){
    setBusy(true);
    try{
      const d=await req('/api/auth/'+(authMode==='login'?'login':'register'),{method:'POST',body:JSON.stringify(form)});
      setToken(d.token);setMe(d.user);
      await AsyncStorage.multiSet([['token',d.token],['user',JSON.stringify(d.user)]]);
      setPage('inbox');
    }catch(e){fail(e)}finally{setBusy(false)}
  }

  async function refresh(){
    if(!token)return;
    try{
      const [a,c]=await Promise.all([req('/api/accounts'),req('/api/conversations')]);
      setAccounts(a.accounts);
      setConvs(c.conversations);
      if(active){
        const found=c.conversations.find(x=>x.id===active.id);
        if(found){
          setActive(found);
          const m=await req(`/api/conversations/${active.id}/messages`);
          setMsgs(m.messages);
        }
      }
      if(qr?.id){
        const q=await req(`/api/accounts/${qr.id}/status`);
        setQr(prev=>prev?{...prev,...q}:null);
        if(q.status==='connected'){
          setQr(null);
          Alert.alert('WhatsApp','Compte connecté avec succès !');
        }
      }
      try{
        const m=await req('/api/models');
        setAiModels(m.models||[]);
      }catch{}
    }catch(e){console.log('Refresh:',e.message)}
  }

  useEffect(()=>{
    if(!token)return;
    refresh();
    const timer=setInterval(refresh,5000);
    return()=>clearInterval(timer);
  },[token,url,active?.id,qr?.id]);

  async function loadConversation(c){
    setActive(c);setPage('chat');
    try{setMsgs((await req(`/api/conversations/${c.id}/messages`)).messages)}
    catch(e){fail(e)}
  }

  async function send(){
    if(!draft.trim()||!active)return;
    const x=draft;setDraft('');
    try{
      await req(`/api/conversations/${active.id}/messages`,{method:'POST',body:JSON.stringify({content:x})});
      setMsgs((await req(`/api/conversations/${active.id}/messages`)).messages);
    }catch(e){setDraft(x);fail(e)}
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
      setQr(prev=>({...prev,...d}));
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
    setToken('');setMe(null);setActive(null);setConvs([]);setAccounts([]);
    await AsyncStorage.multiRemove(['token','user']);
  }

  const header=(title,subtitle)=> (
    <View style={styles.header}>
      <View>
        <Text style={styles.headerSmall}>{subtitle||'AUTOCHAPP'}</Text>
        <Text style={styles.headerTitle}>{title}</Text>
      </View>
      <View style={styles.headerBadge}><Text style={{color:C.green,fontWeight:'900',fontSize:20}}>✳</Text></View>
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
          <Text style={styles.bigTitle}>Votre messagerie,{'\n'}<Text style={{color:C.green}}>plus intelligente.</Text></Text>
          <Text style={styles.muted}>Gérez tous vos comptes WhatsApp et votre assistant IA au même endroit.</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{authMode==='login'?'Ravi de vous revoir':'Rejoignez AutoChapp'}</Text>
          <Text style={styles.muted}>{authMode==='login'?'Connectez-vous à votre espace.':'Créez votre espace personnel.'}</Text>
          {authMode==='register'&&<Field value={form.name} onChangeText={v=>setForm({...form,name:v})} placeholder="Nom complet"/>}
          <Field value={form.email} onChangeText={v=>setForm({...form,email:v})} placeholder="Adresse e-mail" keyboardType="email-address"/>
          <Field value={form.password} onChangeText={v=>setForm({...form,password:v})} placeholder="Mot de passe (8 caractères minimum)" secureTextEntry/>
          <Btn onPress={login} disabled={busy}>{busy?'Chargement…':authMode==='login'?'Se connecter':'Créer mon compte'} →</Btn>
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
          {convs.map(c=>(
            <TouchableOpacity key={c.id} style={styles.item} onPress={()=>loadConversation(c)}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{c.title?.[0]?.toUpperCase()}</Text></View>
              <View style={{flex:1}}>
                <Text style={styles.itemTitle}>{c.title}</Text>
                <Text style={styles.muted}>{c.jid.split('@')[0]}</Text>
              </View>
              <Text style={[styles.tag,c.mode!=='manual'&&{color:C.green,backgroundColor:C.soft}]}>
                {c.mode==='manual'?'MOI':c.mode==='ai'?'IA':'MIX'}
              </Text>
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
        <View style={styles.chatHeader}>
          <TouchableOpacity onPress={()=>{setActive(null);setPage('inbox')}}>
            <Text style={{fontSize:25,color:C.green,paddingHorizontal:5}}>‹</Text>
          </TouchableOpacity>
          <View style={{flex:1}}>
            <Text style={styles.itemTitle}>{active.title}</Text>
            <Text style={styles.muted}>{active.jid.split('@')[0]}</Text>
          </View>
          <TouchableOpacity onPress={()=>{setEdit({...active});setPage('settings')}}>
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
  label:{marginTop:22,fontWeight:'800',fontSize:12,color:C.dark}
});
