import React,{useEffect,useState} from 'react';
import {StatusBar} from 'expo-status-bar';
import {View,Text,TextInput,TouchableOpacity,ScrollView,SafeAreaView,ActivityIndicator,Alert,StyleSheet,Switch} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

const C={bg:'#0c1925',card:'#142535',cardBorder:'#22394e',green:'#10b981',softGreen:'#064e3b',text:'#f1f5f9',muted:'#94a3b8',red:'#ef4444',softRed:'#451a1a',white:'#fff'};
const fallback=process.env.EXPO_PUBLIC_API_URL||Constants?.expoConfig?.extra?.apiUrl||'http://37.60.250.220:5888';

function Btn({children,onPress,secondary=false,danger=false,disabled=false,style}){
  return (
    <TouchableOpacity disabled={disabled} onPress={onPress} style={[styles.btn,secondary&&styles.btnSec,danger&&styles.btnDan,disabled&&{opacity:.5},style]}>
      <Text style={[styles.btnText,secondary&&{color:C.text}]}>{children}</Text>
    </TouchableOpacity>
  );
}

function Field({value,onChangeText,placeholder,secureTextEntry=false,multiline=false,keyboardType}){
  return <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor="#64748b" secureTextEntry={secureTextEntry} multiline={multiline} keyboardType={keyboardType} autoCapitalize="none" style={[styles.input,multiline&&{height:80,textAlignVertical:'top'}]}/>;
}

export default function App(){
  const [url,setUrl]=useState(fallback);
  const [token,setToken]=useState('');
  const [admin,setAdmin]=useState(null);
  const [tab,setTab]=useState('stats'); // 'stats' | 'users' | 'models' | 'settings' | 'user_activity'
  const [busy,setBusy]=useState(false);
  const [ready,setReady]=useState(false);
  const [loginForm,setLoginForm]=useState({email:'',password:''});
  const [apiUrlDraft,setApiUrlDraft]=useState(fallback);

  // Admin data
  const [stats,setStats]=useState(null);
  const [users,setUsers]=useState([]);
  const [models,setModels]=useState([]);
  const [selectedUser,setSelectedUser]=useState(null);
  const [userActivity,setUserActivity]=useState([]);

  // Model creation form
  const [showAddModel,setShowAddModel]=useState(false);
  const [modelForm,setModelForm]=useState({name:'',model_id:'',base_url:'https://api.groq.com/openai/v1',api_key:'',is_default:false});

  useEffect(()=>{
    (async()=>{
      try{
        const t=await AsyncStorage.getItem('admin_token');
        const u=await AsyncStorage.getItem('admin_user');
        const x=await AsyncStorage.getItem('admin_api_url');
        if(x){setUrl(x);setApiUrlDraft(x);}
        if(t&&u){
          const parsed=JSON.parse(u);
          if(parsed.role==='admin'){
            setToken(t);
            setAdmin(parsed);
          }
        }
      }finally{setReady(true);}
    })();
  },[]);

  async function req(path,opts={}){
    const base=url.replace(/\/$/,'');
    let r;
    try{
      r=await fetch(base+path,{...opts,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})}});
    }catch{
      throw new Error('Serveur API inaccessible.');
    }
    let d={};
    try{d=await r.json();}catch{}
    if(!r.ok)throw Error(d.error||`Erreur HTTP ${r.status}`);
    return d;
  }

  function fail(e){Alert.alert('AutoChapp Admin',e.message||String(e));}

  async function login(){
    if(!loginForm.email.trim()||!loginForm.password.trim())return;
    setBusy(true);
    try{
      const d=await req('/api/auth/login',{method:'POST',body:JSON.stringify(loginForm)});
      if(d.user?.role!=='admin'){
        throw new Error('Accès réservé aux administrateurs. Votre compte n\'a pas les privilèges requis.');
      }
      setToken(d.token);
      setAdmin(d.user);
      await AsyncStorage.multiSet([['admin_token',d.token],['admin_user',JSON.stringify(d.user)]]);
      setTab('stats');
    }catch(e){fail(e);}finally{setBusy(false);}
  }

  async function loadData(){
    if(!token)return;
    try{
      const [s,u,m]=await Promise.all([
        req('/api/admin/stats'),
        req('/api/admin/users'),
        req('/api/admin/models')
      ]);
      setStats(s);
      setUsers(u.users||[]);
      setModels(m.models||[]);
    }catch(e){console.log('Admin load:',e.message);}
  }

  useEffect(()=>{
    if(token){
      loadData();
      const interval=setInterval(loadData,8000);
      return()=>clearInterval(interval);
    }
  },[token,url]);

  async function viewUser(u){
    setSelectedUser(u);
    setBusy(true);
    try{
      const res=await req(`/api/admin/users/${u.id}/activity`);
      setUserActivity(res.accounts||[]);
      setTab('user_activity');
    }catch(e){fail(e);}finally{setBusy(false);}
  }

  function deleteUser(u){
    Alert.alert('Supprimer utilisateur',`Confirmez-vous la suppression de ${u.name} (${u.email}) et de toutes ses données WhatsApp ?`,[
      {text:'Annuler',style:'cancel'},
      {text:'Supprimer',style:'destructive',onPress:async()=>{
        try{
          await req(`/api/admin/users/${u.id}`,{method:'DELETE'});
          Alert.alert('Succès','Utilisateur supprimé');
          loadData();
        }catch(e){fail(e);}
      }}
    ]);
  }

  function toggleRole(u){
    const nextRole=u.role==='admin'?'user':'admin';
    Alert.alert('Modifier rôle',`Changer le rôle de ${u.name} vers "${nextRole}" ?`,[
      {text:'Annuler',style:'cancel'},
      {text:'Modifier',onPress:async()=>{
        try{
          await req(`/api/admin/users/${u.id}/role`,{method:'PATCH',body:JSON.stringify({role:nextRole})});
          loadData();
        }catch(e){fail(e);}
      }}
    ]);
  }

  async function addModel(){
    if(!modelForm.name.trim()||!modelForm.model_id.trim()||!modelForm.base_url.trim()||!modelForm.api_key.trim()){
      Alert.alert('Erreur','Tous les champs sont requis.');
      return;
    }
    setBusy(true);
    try{
      await req('/api/admin/models',{method:'POST',body:JSON.stringify(modelForm)});
      setShowAddModel(false);
      setModelForm({name:'',model_id:'',base_url:'https://api.groq.com/openai/v1',api_key:'',is_default:false});
      Alert.alert('Succès','Modèle IA ajouté');
      loadData();
    }catch(e){fail(e);}finally{setBusy(false);}
  }

  async function toggleModel(m){
    try{
      await req(`/api/admin/models/${m.id}`,{method:'PATCH',body:JSON.stringify({enabled:!m.enabled})});
      loadData();
    }catch(e){fail(e);}
  }

  function deleteModel(m){
    Alert.alert('Supprimer modèle',`Supprimer le modèle ${m.name} ?`,[
      {text:'Annuler',style:'cancel'},
      {text:'Supprimer',style:'destructive',onPress:async()=>{
        try{
          await req(`/api/admin/models/${m.id}`,{method:'DELETE'});
          loadData();
        }catch(e){fail(e);}
      }}
    ]);
  }

  async function logout(){
    setToken('');setAdmin(null);
    await AsyncStorage.multiRemove(['admin_token','admin_user']);
  }

  if(!ready)return <View style={styles.center}><ActivityIndicator color={C.green}/></View>;

  // LOGIN SCREEN
  if(!token)return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light"/>
      <ScrollView contentContainerStyle={{padding:24,flexGrow:1,justifyContent:'center'}} keyboardShouldPersistTaps="handled">
        <View style={styles.logoWrap}>
          <Text style={styles.logoIcon}>🛡️</Text>
          <Text style={styles.logoTitle}>AutoChapp <Text style={{color:C.green}}>Admin</Text></Text>
          <Text style={styles.logoSub}>Panneau d'administration mobile</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Connexion Administrateur</Text>
          <Text style={styles.muted}>Authentifiez-vous avec vos identifiants admin.</Text>

          <Field value={loginForm.email} onChangeText={v=>setLoginForm({...loginForm,email:v})} placeholder="E-mail administrateur" keyboardType="email-address"/>
          <Field value={loginForm.password} onChangeText={v=>setLoginForm({...loginForm,password:v})} placeholder="Mot de passe" secureTextEntry/>

          <Btn onPress={login} disabled={busy}>{busy?'Connexion en cours…':'Se connecter au panneau admin'} →</Btn>
        </View>

        <View style={[styles.card,{marginTop:16}]}>
          <Text style={[styles.cardTitle,{fontSize:15}]}>⚙ Serveur API</Text>
          <Field value={apiUrlDraft} onChangeText={setApiUrlDraft} placeholder="http://37.60.250.220:5888"/>
          <Btn secondary onPress={async()=>{const cleaned=apiUrlDraft.trim().replace(/\/$/,'');setUrl(cleaned);await AsyncStorage.setItem('admin_api_url',cleaned);Alert.alert('Serveur','Adresse mise à jour');}}>
            Enregistrer l'adresse
          </Btn>
        </View>
      </ScrollView>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light"/>

      {/* HEADER */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerSub}>PANNEAU ADMINISTRATEUR</Text>
          <Text style={styles.headerTitle}>AutoChapp ⚡</Text>
        </View>
        <TouchableOpacity onPress={loadData} style={styles.refreshBtn}>
          <Text style={{color:C.green,fontSize:18}}>↻</Text>
        </TouchableOpacity>
      </View>

      {/* STATS VIEW */}
      {tab==='stats'&&<ScrollView contentContainerStyle={{padding:16,paddingBottom:100}}>
        <View style={styles.grid}>
          <View style={styles.statBox}>
            <Text style={styles.statNum}>{stats?.users||0}</Text>
            <Text style={styles.statLabel}>Utilisateurs</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statNum}>{stats?.accounts||0}</Text>
            <Text style={styles.statLabel}>Comptes WhatsApp</Text>
            <Text style={[styles.muted,{fontSize:10,marginTop:2}]}>{stats?.connected_accounts||0} connectés</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statNum}>{stats?.conversations||0}</Text>
            <Text style={styles.statLabel}>Conversations</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statNum}>{stats?.messages||0}</Text>
            <Text style={styles.statLabel}>Messages totaux</Text>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Statut du Système</Text>
          <View style={styles.statusRow}>
            <Text style={{color:C.text}}>Connecteur WhatsApp (Baileys)</Text>
            <Text style={{color:C.green,fontWeight:'700'}}>Opérationnel (Typing active)</Text>
          </View>
          <View style={styles.statusRow}>
            <Text style={{color:C.text}}>Modèles d'IA configurés</Text>
            <Text style={{color:C.green,fontWeight:'700'}}>{models.length} modèle(s)</Text>
          </View>
        </View>
      </ScrollView>}

      {/* USERS VIEW */}
      {tab==='users'&&<ScrollView contentContainerStyle={{padding:16,paddingBottom:100}}>
        <Text style={[styles.sectionTitle,{marginBottom:12}]}>Utilisateurs inscrits ({users.length})</Text>
        {users.map(u=>(
          <View key={u.id} style={styles.userCard}>
            <View style={{flex:1}}>
              <View style={{flexDirection:'row',alignItems:'center',gap:8}}>
                <Text style={styles.userName}>{u.name}</Text>
                <View style={[styles.badge,u.role==='admin'?styles.badgeAdmin:styles.badgeUser]}>
                  <Text style={[styles.badgeText,u.role==='admin'&&{color:C.green}]}>{u.role}</Text>
                </View>
              </View>
              <Text style={styles.muted}>{u.email}</Text>
              <Text style={[styles.muted,{fontSize:11,marginTop:4}]}>
                {u.accounts_count} compte(s) WhatsApp • {u.conversations_count} conversation(s)
              </Text>
            </View>
            <View style={styles.actionCol}>
              <TouchableOpacity onPress={()=>viewUser(u)} style={styles.actionBtn}>
                <Text style={{color:C.green,fontWeight:'700',fontSize:12}}>Activité</Text>
              </TouchableOpacity>
              {u.id!==admin?.id&&<TouchableOpacity onPress={()=>toggleRole(u)} style={styles.actionBtn}>
                <Text style={{color:'#f59e0b',fontWeight:'700',fontSize:11}}>{u.role==='admin'?'Rétrograder':'Admin'}</Text>
              </TouchableOpacity>}
              {u.id!==admin?.id&&<TouchableOpacity onPress={()=>deleteUser(u)} style={styles.actionBtn}>
                <Text style={{color:C.red,fontWeight:'700',fontSize:11}}>Supprimer</Text>
              </TouchableOpacity>}
            </View>
          </View>
        ))}
      </ScrollView>}

      {/* USER ACTIVITY DETAIL VIEW */}
      {tab==='user_activity'&&selectedUser&&<ScrollView contentContainerStyle={{padding:16,paddingBottom:100}}>
        <TouchableOpacity onPress={()=>setTab('users')} style={{marginBottom:14}}>
          <Text style={{color:C.green,fontWeight:'700'}}>‹ Retour aux utilisateurs</Text>
        </TouchableOpacity>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{selectedUser.name}</Text>
          <Text style={styles.muted}>{selectedUser.email}</Text>
        </View>
        <Text style={[styles.sectionTitle,{marginVertical:12}]}>Comptes WhatsApp ({userActivity.length})</Text>
        {!userActivity.length&&<Text style={styles.muted}>Aucun compte WhatsApp associé.</Text>}
        {userActivity.map(a=>(
          <View key={a.id} style={styles.card}>
            <View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:8}}>
              <Text style={styles.userName}>{a.label}</Text>
              <Text style={{color:a.status==='connected'?C.green:C.muted,fontWeight:'700',fontSize:12}}>{a.status}</Text>
            </View>
            <Text style={[styles.muted,{fontSize:12}]}>{a.phone||'Non lié'}</Text>
            <View style={{marginTop:12}}>
              <Text style={[styles.muted,{fontWeight:'700',marginBottom:6}]}>Conversations ({a.conversations?.length||0}) :</Text>
              {(a.conversations||[]).map(c=>(
                <View key={c.id} style={styles.convRow}>
                  <Text style={{color:C.text,fontSize:13}}>{c.title}</Text>
                  <Text style={{color:C.muted,fontSize:11}}>{c.mode} • {c.messages_count} msgs</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>}

      {/* AI MODELS VIEW */}
      {tab==='models'&&<ScrollView contentContainerStyle={{padding:16,paddingBottom:100}}>
        <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
          <Text style={styles.sectionTitle}>Fournisseurs & Modèles IA</Text>
          <TouchableOpacity onPress={()=>setShowAddModel(!showAddModel)} style={styles.smallAddBtn}>
            <Text style={{color:C.green,fontWeight:'800'}}>+ Ajouter</Text>
          </TouchableOpacity>
        </View>

        {showAddModel&&<View style={styles.card}>
          <Text style={styles.cardTitle}>Nouveau Modèle IA</Text>
          <Field value={modelForm.name} onChangeText={v=>setModelForm({...modelForm,name:v})} placeholder="Nom (ex. Groq Llama 3.3)"/>
          <Field value={modelForm.model_id} onChangeText={v=>setModelForm({...modelForm,model_id:v})} placeholder="Model ID (ex. llama-3.3-70b-versatile)"/>
          <Field value={modelForm.base_url} onChangeText={v=>setModelForm({...modelForm,base_url:v})} placeholder="Base URL (ex. https://api.groq.com/openai/v1)"/>
          <Field value={modelForm.api_key} onChangeText={v=>setModelForm({...modelForm,api_key:v})} placeholder="Clé API" secureTextEntry/>
          <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginVertical:10}}>
            <Text style={{color:C.text,fontSize:13}}>Définir comme modèle par défaut</Text>
            <Switch value={modelForm.is_default} onValueChange={v=>setModelForm({...modelForm,is_default:v})}/>
          </View>
          <Btn onPress={addModel} disabled={busy}>Enregistrer le modèle</Btn>
          <Btn secondary style={{marginTop:8}} onPress={()=>setShowAddModel(false)}>Annuler</Btn>
        </View>}

        {models.map(m=>(
          <View key={m.id} style={styles.modelCard}>
            <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start'}}>
              <View style={{flex:1}}>
                <Text style={styles.modelName}>{m.name} {m.is_default?'⭐ (Défaut)':''}</Text>
                <Text style={styles.modelCode}>{m.model_id}</Text>
              </View>
              <Switch value={m.enabled} onValueChange={()=>toggleModel(m)}/>
            </View>
            <Text style={[styles.muted,{fontSize:11,marginTop:8}]}>Base URL: {m.base_url}</Text>
            {!m.is_default&&<TouchableOpacity onPress={()=>deleteModel(m)} style={{alignSelf:'flex-end',marginTop:8}}>
              <Text style={{color:C.red,fontWeight:'700',fontSize:12}}>Supprimer</Text>
            </TouchableOpacity>}
          </View>
        ))}
      </ScrollView>}

      {/* SETTINGS VIEW */}
      {tab==='settings'&&<ScrollView contentContainerStyle={{padding:16}}>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Administrateur connecté</Text>
          <Text style={styles.userName}>{admin?.name}</Text>
          <Text style={styles.muted}>{admin?.email}</Text>
          <View style={[styles.badge,styles.badgeAdmin,{alignSelf:'flex-start',marginTop:8}]}>
            <Text style={{color:C.green,fontWeight:'800',fontSize:11}}>SUPER ADMIN</Text>
          </View>
        </View>

        <View style={[styles.card,{marginTop:16}]}>
          <Text style={styles.cardTitle}>Configuration Serveur</Text>
          <Field value={apiUrlDraft} onChangeText={setApiUrlDraft} placeholder="http://37.60.250.220:5888"/>
          <Btn onPress={async()=>{const cleaned=apiUrlDraft.trim().replace(/\/$/,'');setUrl(cleaned);await AsyncStorage.setItem('admin_api_url',cleaned);Alert.alert('Succès','Adresse API mise à jour');}}>
            Enregistrer l'adresse API
          </Btn>
        </View>

        <Btn danger style={{marginTop:20}} onPress={logout}>Se déconnecter</Btn>
      </ScrollView>}

      {/* BOTTOM NAV */}
      <View style={styles.nav}>
        {[
          ['stats','📊','Stats'],
          ['users','👥','Utilisateurs'],
          ['models','🤖','Modèles IA'],
          ['settings','⚙','Réglages']
        ].map(([v,ico,l])=>(
          <TouchableOpacity key={v} style={styles.navItem} onPress={()=>setTab(v)}>
            <Text style={{fontSize:20}}>{ico}</Text>
            <Text style={[styles.navLabel,tab===v&&{color:C.green}]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles=StyleSheet.create({
  container:{flex:1,backgroundColor:C.bg},
  center:{flex:1,justifyContent:'center',alignItems:'center',backgroundColor:C.bg},
  logoWrap:{alignItems:'center',marginBottom:30},
  logoIcon:{fontSize:44,marginBottom:8},
  logoTitle:{fontSize:28,fontWeight:'900',color:C.text,letterSpacing:-1},
  logoSub:{color:C.muted,fontSize:13,marginTop:4},
  card:{backgroundColor:C.card,borderRadius:16,borderColor:C.cardBorder,borderWidth:1,padding:20,marginBottom:12},
  cardTitle:{fontSize:18,fontWeight:'800',color:C.text,marginBottom:8},
  muted:{color:C.muted,fontSize:13},
  input:{backgroundColor:'#0c1925',borderColor:C.cardBorder,borderWidth:1,borderRadius:10,color:C.text,paddingHorizontal:14,paddingVertical:12,marginTop:12,fontSize:13},
  btn:{backgroundColor:C.green,borderRadius:10,padding:14,alignItems:'center',marginTop:14},
  btnSec:{backgroundColor:'#1e384f'},
  btnDan:{backgroundColor:C.red},
  btnText:{color:'#fff',fontWeight:'800',fontSize:13},
  header:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingHorizontal:20,paddingVertical:16,borderBottomWidth:1,borderColor:C.cardBorder,backgroundColor:C.card},
  headerSub:{color:C.green,fontSize:10,fontWeight:'900',letterSpacing:1.5},
  headerTitle:{color:C.text,fontSize:22,fontWeight:'800'},
  refreshBtn:{width:36,height:36,borderRadius:10,backgroundColor:'#1a3449',justifyContent:'center',alignItems:'center'},
  grid:{flexDirection:'row',flexWrap:'wrap',gap:12,marginBottom:16},
  statBox:{flex:1,minWidth:'45%',backgroundColor:C.card,borderColor:C.cardBorder,borderWidth:1,borderRadius:14,padding:16},
  statNum:{fontSize:28,fontWeight:'900',color:C.text},
  statLabel:{color:C.green,fontSize:11,fontWeight:'800',textTransform:'uppercase',marginTop:4},
  statusRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingVertical:10,borderTopWidth:1,borderColor:C.cardBorder},
  sectionTitle:{color:C.text,fontSize:18,fontWeight:'800'},
  userCard:{backgroundColor:C.card,borderColor:C.cardBorder,borderWidth:1,borderRadius:14,padding:16,marginBottom:10,flexDirection:'row',alignItems:'center'},
  userName:{color:C.text,fontWeight:'800',fontSize:15},
  badge:{paddingHorizontal:8,paddingVertical:2,borderRadius:6},
  badgeAdmin:{backgroundColor:C.softGreen},
  badgeUser:{backgroundColor:'#1e293b'},
  badgeText:{color:C.muted,fontSize:10,fontWeight:'800',textTransform:'uppercase'},
  actionCol:{alignItems:'flex-end',gap:6},
  actionBtn:{paddingHorizontal:10,paddingVertical:5,borderRadius:6,backgroundColor:'#162c3e'},
  convRow:{flexDirection:'row',justifyContent:'space-between',paddingVertical:6,borderTopWidth:1,borderColor:'#1a2d3d'},
  smallAddBtn:{backgroundColor:C.softGreen,paddingHorizontal:12,paddingVertical:6,borderRadius:8},
  modelCard:{backgroundColor:C.card,borderColor:C.cardBorder,borderWidth:1,borderRadius:14,padding:16,marginBottom:10},
  modelName:{color:C.text,fontSize:15,fontWeight:'800'},
  modelCode:{color:C.green,fontSize:11,backgroundColor:'#09382f',paddingHorizontal:6,paddingVertical:2,borderRadius:4,alignSelf:'flex-start',marginTop:4},
  nav:{height:64,backgroundColor:C.card,borderTopWidth:1,borderColor:C.cardBorder,flexDirection:'row',justifyContent:'space-around'},
  navItem:{justifyContent:'center',alignItems:'center',flex:1},
  navLabel:{color:C.muted,fontSize:10,fontWeight:'700',marginTop:3}
});
