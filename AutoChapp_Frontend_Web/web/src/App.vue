<script setup>
import {ref,computed,onMounted,onUnmounted,nextTick} from 'vue';
import {MessageCircle,LayoutDashboard,Plus,Search,LogOut,Send,Settings2,Smartphone,ShieldCheck,Bot,UserRound,Blend,ChevronDown,RefreshCw,Trash2,X,Menu,CheckCircle2,AlertCircle,Lock,Mail,ArrowRight,Sparkles,Radio,Wifi,Clock,MoreHorizontal,Users,Cpu,Key,Check,ArrowLeft,Shield,AlertTriangle} from 'lucide-vue-next';

const rawApi = (import.meta.env.VITE_API_URL || '').trim();
const API = (rawApi && rawApi !== 'http://localhost:5888') ? rawApi : '';
const token=ref(localStorage.getItem('autochapp_token')||'');
const currentUser=ref(JSON.parse(localStorage.getItem('autochapp_user')||'null'));
const authMode=ref('login'),form=ref({name:'',email:'',password:''}),busy=ref(false),error=ref(''),notice=ref('');
const accounts=ref([]),conversations=ref([]),messages=ref([]),activeAccount=ref(null),activeConversation=ref(null),section=ref('inbox'),query=ref(''),draft=ref(''),showAdd=ref(false),newAccountName=ref(''),qrData=ref(null),showSettings=ref(false),settings=ref({}),sidebarMobile=ref(false),bottom=ref(null);
const aiModels=ref([]);
const adminTab=ref('stats'),adminStats=ref(null),adminUsers=ref([]),adminModels=ref([]),adminActivityUser=ref(null),adminActivityData=ref([]),showModelModal=ref(false),modelForm=ref({id:null,name:'',model_id:'',base_url:'',api_key:'',is_default:false});
let poll=null;

const filtered= computed(()=>conversations.value.filter(x=>(!activeAccount.value||x.account_id===activeAccount.value.id)&&`${x.title} ${x.jid}`.toLowerCase().includes(query.value.toLowerCase())));
const statusLabel=s=>({connected:'Connecté',connecting:'Connexion...',qr:'Scanner le QR',disconnected:'Hors ligne'})[s]||s;
const modeLabel=s=>({manual:'Manuel',ai:'IA autonome',hybrid:'Hybride'})[s]||s;

async function api(path,opts={}){
  const r=await fetch(API+path,{...opts,headers:{'Content-Type':'application/json',...(token.value?{'Authorization':'Bearer '+token.value}:{}),...(opts.headers||{})}});
  let d={};
  try{d=await r.json()}catch{}
  if(!r.ok)throw Error(d.error||`Erreur HTTP ${r.status}`);
  return d;
}

function notify(e){
  error.value=e.message||String(e);
  setTimeout(()=>{error.value=''},5500);
}
function notifySuccess(msg){
  notice.value=msg;
  setTimeout(()=>{notice.value=''},4000);
}

async function authenticate(){
  busy.value=true;error.value='';
  try{
    const path=authMode.value==='login'?'/api/auth/login':'/api/auth/register';
    const data=await api(path,{method:'POST',body:JSON.stringify(form.value)});
    setAuth(data);
  }catch(e){notify(e)}finally{busy.value=false}
}

function setAuth(data){
  token.value=data.token;
  currentUser.value=data.user;
  localStorage.setItem('autochapp_token',data.token);
  localStorage.setItem('autochapp_user',JSON.stringify(data.user));
  load();
}

async function googleCredential(response){
  try{setAuth(await api('/api/auth/google',{method:'POST',body:JSON.stringify({credential:response.credential})}))}
  catch(e){notify(e)}
}

const GOOGLE_ID=import.meta.env.VITE_GOOGLE_CLIENT_ID||'';
onMounted(()=>{
  if(token.value)load();
  if(GOOGLE_ID){
    const s=document.createElement('script');
    s.src='https://accounts.google.com/gsi/client';
    s.async=true;
    s.onload=()=>{
      window.google.accounts.id.initialize({client_id:GOOGLE_ID,callback:googleCredential});
      window.google.accounts.id.renderButton(document.querySelector('#google-signin'),{theme:'outline',size:'large',width:320});
    };
    document.head.appendChild(s);
  }
});
onUnmounted(()=>clearInterval(poll));

function logout(){
  token.value='';currentUser.value=null;accounts.value=[];conversations.value=[];messages.value=[];
  activeAccount.value=null;activeConversation.value=null;
  localStorage.removeItem('autochapp_token');localStorage.removeItem('autochapp_user');
  clearInterval(poll);
}

async function load(){
  try{
    const [a,c]=await Promise.all([api('/api/accounts'),api('/api/conversations')]);
    accounts.value=a.accounts;
    conversations.value=c.conversations;
    if(!activeAccount.value&&accounts.value.length)activeAccount.value=accounts.value[0];
    if(activeAccount.value)activeAccount.value=accounts.value.find(x=>x.id===activeAccount.value.id)||accounts.value[0]||null;
    if(activeConversation.value){
      activeConversation.value=conversations.value.find(c=>c.id===activeConversation.value.id)||null;
      if(activeConversation.value)await loadMessages();
    }
    loadModels();
    clearInterval(poll);
    poll=setInterval(refresh,4500);
  }catch(e){notify(e)}
}

async function loadModels(){
  try{
    const m=await api('/api/models');
    aiModels.value=m.models;
  }catch{}
}

async function refresh(){
  if(!token.value)return;
  try{
    const [a,c]=await Promise.all([api('/api/accounts'),api('/api/conversations')]);
    accounts.value=a.accounts;
    conversations.value=c.conversations;
    if(activeAccount.value)activeAccount.value=accounts.value.find(x=>x.id===activeAccount.value.id)||null;
    if(activeConversation.value){
      activeConversation.value=conversations.value.find(x=>x.id===activeConversation.value.id)||null;
      if(activeConversation.value)await loadMessages();
    }
    if(qrData.value&&qrData.value.id){
      const s=await api(`/api/accounts/${qrData.value.id}/status`);
      qrData.value={...qrData.value,...s};
      if(s.status==='connected'){
        notifySuccess(`Compte ${qrData.value.label} connecté avec succès !`);
        qrData.value=null;
        await load();
      }
    }
  }catch{}
}

async function addAccount(){
  if(!newAccountName.value.trim())return;
  busy.value=true;
  try{
    const data=await api('/api/accounts',{method:'POST',body:JSON.stringify({label:newAccountName.value.trim()})});
    showAdd.value=false;
    newAccountName.value='';
    await load();
    await connect(data.account);
  }catch(e){notify(e)}finally{busy.value=false}
}

async function connect(account){
  try{
    qrData.value={id:account.id,label:account.label,status:'connecting',qr:null};
    const d=await api(`/api/accounts/${account.id}/qr`);
    qrData.value={...qrData.value,...d};
  }catch(e){notify(e)}
}

async function removeAccount(a){
  if(!confirm(`Supprimer le compte "${a.label}" et toutes ses conversations ?`))return;
  busy.value=true;
  try{
    await api(`/api/accounts/${a.id}`,{method:'DELETE'});
    if(activeAccount.value?.id===a.id)activeAccount.value=null;
    if(activeConversation.value?.account_id===a.id)activeConversation.value=null;
    if(qrData.value?.id===a.id)qrData.value=null;
    notifySuccess(`Compte "${a.label}" supprimé`);
    await load();
  }catch(e){notify(e)}finally{busy.value=false}
}

async function selectConversation(c){
  activeConversation.value=c;
  section.value='inbox';
  sidebarMobile.value=false;
  showSettings.value=false;
  await loadMessages();
}

async function loadMessages(){
  if(!activeConversation.value)return;
  try{
    const data=await api(`/api/conversations/${activeConversation.value.id}/messages`);
    const had=messages.value.length;
    messages.value=data.messages;
    if(messages.value.length!==had)nextTick(()=>bottom.value?.scrollIntoView({behavior:'smooth'}));
  }catch{}
}

async function send(){
  if(!draft.value.trim()||!activeConversation.value||busy.value)return;
  const content=draft.value;
  draft.value='';
  busy.value=true;
  try{
    await api(`/api/conversations/${activeConversation.value.id}/messages`,{method:'POST',body:JSON.stringify({content})});
    await loadMessages();
  }catch(e){draft.value=content;notify(e)}finally{busy.value=false}
}

function openSettings(){
  settings.value={...activeConversation.value};
  loadModels();
  showSettings.value=true;
}

async function saveSettings(){
  busy.value=true;
  try{
    const d=await api(`/api/conversations/${activeConversation.value.id}/settings`,{method:'PATCH',body:JSON.stringify(settings.value)});
    activeConversation.value=d.conversation;
    showSettings.value=false;
    notifySuccess('Paramètres de l\'assistant enregistrés');
    await load();
  }catch(e){notify(e)}finally{busy.value=false}
}

// ---- ADMIN FUNCTIONS ----
async function openAdmin(tab='stats'){
  section.value='admin';
  adminTab.value=tab;
  sidebarMobile.value=false;
  await loadAdminData();
}

async function loadAdminData(){
  busy.value=true;
  try{
    const [s,u,m]=await Promise.all([
      api('/api/admin/stats'),
      api('/api/admin/users'),
      api('/api/admin/models')
    ]);
    adminStats.value=s;
    adminUsers.value=u.users;
    adminModels.value=m.models;
  }catch(e){notify(e)}finally{busy.value=false}
}

async function deleteUser(u){
  if(!confirm(`Supprimer l'utilisateur ${u.name} (${u.email}) et toutes ses données ?`))return;
  busy.value=true;
  try{
    await api(`/api/admin/users/${u.id}`,{method:'DELETE'});
    notifySuccess(`Utilisateur ${u.name} supprimé`);
    await loadAdminData();
  }catch(e){notify(e)}finally{busy.value=false}
}

async function toggleUserRole(u){
  const nextRole=u.role==='admin'?'user':'admin';
  if(!confirm(`Changer le rôle de ${u.name} vers "${nextRole}" ?`))return;
  busy.value=true;
  try{
    await api(`/api/admin/users/${u.id}/role`,{method:'PATCH',body:JSON.stringify({role:nextRole})});
    notifySuccess(`Rôle de ${u.name} mis à jour (${nextRole})`);
    await loadAdminData();
  }catch(e){notify(e)}finally{busy.value=false}
}

async function viewUserActivity(u){
  busy.value=true;
  try{
    const res=await api(`/api/admin/users/${u.id}/activity`);
    adminActivityUser.value=res.user;
    adminActivityData.value=res.accounts;
    adminTab.value='activity';
  }catch(e){notify(e)}finally{busy.value=false}
}

function openNewModelModal(){
  modelForm.value={id:null,name:'',model_id:'',base_url:'https://api.groq.com/openai/v1',api_key:'',is_default:false};
  showModelModal.value=true;
}

function editModel(m){
  modelForm.value={id:m.id,name:m.name,model_id:m.model_id,base_url:m.base_url,api_key:m.api_key,is_default:m.is_default};
  showModelModal.value=true;
}

async function saveModel(){
  if(!modelForm.value.name.trim()||!modelForm.value.model_id.trim()||!modelForm.value.base_url.trim()||!modelForm.value.api_key.trim()){
    notify('Veuillez remplir tous les champs obligatoires.');
    return;
  }
  busy.value=true;
  try{
    if(modelForm.value.id){
      await api(`/api/admin/models/${modelForm.value.id}`,{method:'PATCH',body:JSON.stringify(modelForm.value)});
      notifySuccess('Modèle IA mis à jour avec succès');
    }else{
      await api('/api/admin/models',{method:'POST',body:JSON.stringify(modelForm.value)});
      notifySuccess('Nouveau modèle IA ajouté avec succès');
    }
    showModelModal.value=false;
    await loadAdminData();
    await loadModels();
  }catch(e){notify(e)}finally{busy.value=false}
}

async function toggleModelEnabled(m){
  try{
    await api(`/api/admin/models/${m.id}`,{method:'PATCH',body:JSON.stringify({enabled:!m.enabled})});
    await loadAdminData();
    await loadModels();
  }catch(e){notify(e)}
}

async function deleteModel(m){
  if(!confirm(`Supprimer le modèle IA "${m.name}" ?`))return;
  busy.value=true;
  try{
    await api(`/api/admin/models/${m.id}`,{method:'DELETE'});
    notifySuccess(`Modèle ${m.name} supprimé`);
    await loadAdminData();
    await loadModels();
  }catch(e){notify(e)}finally{busy.value=false}
}
</script>

<template>
  <!-- AUTHENTICATION PAGE -->
  <div v-if="!token" class="auth-page">
    <div class="auth-ambient one"></div>
    <div class="auth-ambient two"></div>
    <div class="auth-wrap">
      <div class="auth-left">
        <div class="brand brand-auth">
          <span class="brand-icon"><MessageCircle :size="22" stroke-width="2.5"/></span> auto<span>chapp</span><span class="brand-dot">.</span>
        </div>
        <div class="eyebrow"><Sparkles :size="15"/> LA MESSAGERIE RÉINVENTÉE</div>
        <h1>Une seule interface.<br><span>Toutes vos conversations.</span></h1>
        <p>Unifiez vos comptes WhatsApp et laissez votre assistant IA prendre le relais, quand vous le décidez.</p>
        <div class="auth-features">
          <div><span><MessageCircle :size="17"/></span> Tous vos messages au même endroit</div>
          <div><span><Bot :size="17"/></span> Des réponses intelligentes et personnalisées (Groq & modèles personnalisés)</div>
          <div><span><ShieldCheck :size="17"/></span> Simulation de saisie humaine anti-détection</div>
        </div>
        <div class="auth-caption">Votre équipe, vos clients, votre rythme.</div>
      </div>
      <div class="auth-card">
        <div class="mini-logo"><span class="brand-icon"><MessageCircle :size="17"/></span> autochapp</div>
        <h2>{{authMode==='login'?'Bon retour parmi nous':'Créez votre espace'}}</h2>
        <p class="muted">{{authMode==='login'?'Connectez-vous pour retrouver vos conversations.':'Commencez à gérer vos messages plus intelligemment.'}}</p>
        <form @submit.prevent="authenticate">
          <label v-if="authMode==='register'">Votre nom<input v-model="form.name" required placeholder="Ex. Didier Sofo" autocomplete="name"/></label>
          <label>Adresse e-mail<input v-model="form.email" required type="email" placeholder="vous@entreprise.com" autocomplete="email"/></label>
          <label>Mot de passe<input v-model="form.password" required type="password" minlength="8" placeholder="••••••••" :autocomplete="authMode==='login'?'current-password':'new-password'"/></label>
          <button class="btn primary auth-button" :disabled="busy">{{busy?'Chargement…':authMode==='login'?'Se connecter':'Créer mon compte'}} <ArrowRight :size="17"/></button>
        </form>
        <div class="divider-word"><span>OU CONTINUER AVEC</span></div>
        <div v-if="GOOGLE_ID" id="google-signin" class="google-container"></div>
        <p v-else class="oauth-hint">Connexion Google disponible après configuration OAuth.</p>
        <p class="switch-auth">{{authMode==='login'?'Vous êtes nouveau ?':'Déjà un compte ?'}} <button @click="authMode=authMode==='login'?'register':'login'">{{authMode==='login'?'Créer un compte':'Se connecter'}}</button></p>
        <div class="fineprint"><Lock :size="13"/> Authentification sécurisée</div>
      </div>
    </div>
  </div>

  <!-- MAIN APP LAYOUT -->
  <div v-else class="app-layout">
    <!-- SIDEBAR -->
    <aside class="sidebar" :class="{'mobile-open':sidebarMobile}">
      <div class="side-brand">
        <span class="brand-icon"><MessageCircle :size="21"/></span> auto<span>chapp</span><span class="brand-dot">.</span>
        <button class="close-mobile" @click="sidebarMobile=false"><X :size="20"/></button>
      </div>

      <div class="workspace-label">ESPACE DE TRAVAIL</div>
      <button class="nav-btn" :class="{selected:section==='overview'}" @click="section='overview';sidebarMobile=false">
        <LayoutDashboard :size="19"/> Vue d'ensemble
      </button>
      <button class="nav-btn" :class="{selected:section==='inbox'}" @click="section='inbox';sidebarMobile=false">
        <MessageCircle :size="19"/> Boîte de réception <span class="nav-count">{{conversations.length}}</span>
      </button>

      <!-- ADMIN TAB (VISIBLE ONLY FOR ADMIN ROLE) -->
      <button v-if="currentUser?.role==='admin'" class="nav-btn admin-nav-btn" :class="{selected:section==='admin'}" @click="openAdmin('stats')">
        <ShieldCheck :size="19"/> Administration <span class="admin-badge">Admin</span>
      </button>

      <div class="side-section-heading">
        <span>VOS COMPTES ({{accounts.length}})</span>
        <button title="Ajouter un compte" @click="showAdd=true"><Plus :size="18"/></button>
      </div>

      <div class="account-list">
        <button class="account-btn" :class="{picked:!activeAccount&&section==='inbox'}" @click="activeAccount=null;section='inbox'">
          <span class="account-avatar all"><MessageCircle :size="17"/></span>
          <span>Tous les comptes</span>
        </button>
        <div v-for="a in accounts" :key="a.id" class="account-item-wrapper" :class="{picked:activeAccount?.id===a.id&&section==='inbox'}">
          <button class="account-btn" @click="activeAccount=a;section='inbox'">
            <span class="account-avatar">{{a.label[0].toUpperCase()}}</span>
            <span class="account-name">{{a.label}}</span>
            <span class="status-dot" :class="a.status" :title="statusLabel(a.status)"></span>
          </button>
          <button class="side-del-btn" title="Supprimer ce compte" @click.stop="removeAccount(a)">
            <Trash2 :size="14"/>
          </button>
        </div>
      </div>

      <button class="add-account-link" @click="showAdd=true"><Plus :size="16"/> Connecter un compte</button>

      <div class="side-bottom">
        <div class="user-chip">
          <div class="user-avatar">{{currentUser?.name?.[0]?.toUpperCase()}}</div>
          <div>
            <strong>{{currentUser?.name}}</strong>
            <small>{{currentUser?.role==='admin'?'Administrateur':'Utilisateur'}}</small>
          </div>
          <button title="Déconnexion" @click="logout"><LogOut :size="18"/></button>
        </div>
      </div>
    </aside>

    <div v-if="sidebarMobile" class="mobile-mask" @click="sidebarMobile=false"></div>

    <main class="workspace">
      <!-- TOP BAR -->
      <header class="topbar">
        <button class="mobile-menu" @click="sidebarMobile=true"><Menu :size="22"/></button>
        <div class="breadcrumb">
          Espace de travail <span>/</span> 
          <strong>{{section==='overview'?'Vue d’ensemble':section==='admin'?'Administration':'Messages'}}</strong>
        </div>
        <div class="header-right">
          <span v-if="currentUser?.role==='admin'" class="role-chip"><Shield :size="13"/> Administrateur</span>
          <span class="live-chip"><span></span> En ligne</span>
          <div class="header-avatar">{{currentUser?.name?.[0]?.toUpperCase()}}</div>
        </div>
      </header>

      <!-- OVERVIEW SECTION -->
      <section v-if="section==='overview'" class="overview">
        <div class="page-kicker">VOTRE CENTRE DE COMMANDE</div>
        <h1>Bonjour, {{currentUser?.name?.split(' ')[0]}} <span class="wave">✳</span></h1>
        <p class="muted">Votre activité WhatsApp, en un seul regard.</p>

        <div class="stat-grid">
          <div class="stat-card">
            <div class="stat-label">Comptes connectés <Smartphone :size="18"/></div>
            <div class="stat-number">{{accounts.filter(a=>a.status==='connected').length}} <span>/ {{accounts.length}}</span></div>
            <div class="stat-footer">Comptes WhatsApp actifs</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Conversations <MessageCircle :size="18"/></div>
            <div class="stat-number">{{conversations.length}}</div>
            <div class="stat-footer">Tous les échanges</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Assistées par l'IA <Bot :size="18"/></div>
            <div class="stat-number">{{conversations.filter(c=>c.mode!=='manual').length}}</div>
            <div class="stat-footer">Modes IA et hybride</div>
          </div>
        </div>

        <div class="overview-panels">
          <div class="overview-panel">
            <div class="panel-title">
              Vos comptes WhatsApp
              <button class="text-action" @click="showAdd=true"><Plus :size="15"/> Nouveau compte</button>
            </div>
            <div v-if="!accounts.length" class="empty-inline">
              Vous n'avez pas encore connecté de compte WhatsApp.<br>
              <button class="btn primary" style="margin-top:14px" @click="showAdd=true">Connecter un premier compte</button>
            </div>
            <div v-for="a in accounts" :key="a.id" class="overview-account">
              <span class="account-avatar">{{a.label[0]}}</span>
              <div class="flex-grow">
                <strong>{{a.label}}</strong>
                <small>{{a.phone||'Scannez le QR code pour lier votre numéro'}}</small>
              </div>
              <span class="status-tag" :class="a.status">{{statusLabel(a.status)}}</span>
              <button class="btn-icon" @click="connect(a)" title="Afficher le QR code / Reconnecter"><RefreshCw :size="16"/></button>
              <button class="btn-icon danger" @click="removeAccount(a)" title="Supprimer ce compte"><Trash2 :size="16"/></button>
            </div>
          </div>

          <div class="overview-panel accent-panel">
            <span class="chip"><Sparkles :size="14"/> ASSISTANT & MODÈLES IA</span>
            <h2>L’IA répond.<br>Vous décidez.</h2>
            <p>Pour chaque contact, choisissez entre contrôle manuel, réponses autonomes avec Groq ou vos propres modèles IA personnalisés.</p>
            <button class="btn light" @click="section='inbox'">Ouvrir mes messages <ArrowRight :size="17"/></button>
          </div>
        </div>
      </section>

      <!-- ADMIN SECTION -->
      <section v-else-if="section==='admin'" class="overview admin-view">
        <div class="admin-header-row">
          <div>
            <div class="page-kicker">PANNEAU DE CONTRÔLE GLOBAL</div>
            <h1>Administration de la plateforme</h1>
            <p class="muted">Gérez les utilisateurs, surveillez l'activité des conversations et configurez les modèles IA disponibles.</p>
          </div>
          <button class="btn secondary" @click="loadAdminData"><RefreshCw :size="16"/> Actualiser</button>
        </div>

        <!-- Admin Tabs -->
        <div class="admin-tabs">
          <button :class="{active:adminTab==='stats'}" @click="adminTab='stats'"><LayoutDashboard :size="16"/> Vue d'ensemble</button>
          <button :class="{active:adminTab==='users'||adminTab==='activity'}" @click="adminTab='users'"><Users :size="16"/> Utilisateurs & Activité</button>
          <button :class="{active:adminTab==='models'}" @click="adminTab='models'"><Cpu :size="16"/> Modèles IA & Clés API</button>
        </div>

        <!-- TAB 1: ADMIN STATS -->
        <div v-if="adminTab==='stats'" class="admin-tab-content">
          <div class="admin-stat-grid">
            <div class="admin-stat-card">
              <div class="stat-top"><Users :size="20"/> Utilisateurs inscrits</div>
              <div class="stat-num">{{adminStats?.users||0}}</div>
              <small>Comptes sur la plateforme</small>
            </div>
            <div class="admin-stat-card">
              <div class="stat-top"><Smartphone :size="20"/> Comptes WhatsApp</div>
              <div class="stat-num">{{adminStats?.accounts||0}}</div>
              <small>{{adminStats?.connected_accounts||0}} actuellement connectés</small>
            </div>
            <div class="admin-stat-card">
              <div class="stat-top"><MessageCircle :size="20"/> Conversations</div>
              <div class="stat-num">{{adminStats?.conversations||0}}</div>
              <small>Fils de discussion suivis</small>
            </div>
            <div class="admin-stat-card">
              <div class="stat-top"><Bot :size="20"/> Messages totaux</div>
              <div class="stat-num">{{adminStats?.messages||0}}</div>
              <small>Envoyés, reçus et auto-IA</small>
            </div>
          </div>
        </div>

        <!-- TAB 2: USERS LIST -->
        <div v-else-if="adminTab==='users'" class="admin-tab-content">
          <div class="table-container card">
            <div class="card-header-bar">
              <h2>Utilisateurs enregistrés ({{adminUsers.length}})</h2>
            </div>
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Nom & E-mail</th>
                  <th>Rôle</th>
                  <th>Comptes WhatsApp</th>
                  <th>Conversations</th>
                  <th>Inscrit le</th>
                  <th style="text-align:right">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="u in adminUsers" :key="u.id">
                  <td>
                    <strong>{{u.name}}</strong><br>
                    <small class="muted">{{u.email}}</small>
                  </td>
                  <td>
                    <span class="role-badge" :class="u.role">{{u.role==='admin'?'Admin':'Utilisateur'}}</span>
                  </td>
                  <td><span class="num-chip">{{u.accounts_count}}</span></td>
                  <td><span class="num-chip">{{u.conversations_count}}</span></td>
                  <td><small class="muted">{{u.created_at?new Date(u.created_at).toLocaleDateString('fr-FR'):'—'}}</small></td>
                  <td style="text-align:right">
                    <button class="btn-xs secondary" @click="viewUserActivity(u)" title="Voir l'activité"><Smartphone :size="13"/> Activité</button>
                    <button v-if="u.id!==currentUser?.id" class="btn-xs warning" @click="toggleUserRole(u)">
                      {{u.role==='admin'?'Rétrograder':'Promouvoir Admin'}}
                    </button>
                    <button v-if="u.id!==currentUser?.id" class="btn-xs danger" @click="deleteUser(u)" title="Supprimer l'utilisateur"><Trash2 :size="13"/></button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- TAB 2 BIS: USER ACTIVITY DETAIL -->
        <div v-else-if="adminTab==='activity'" class="admin-tab-content">
          <button class="activity-back-btn" @click="adminTab='users'"><ArrowLeft :size="16"/> Retour à la liste des utilisateurs</button>
          <div class="card" style="margin-bottom:20px">
            <h2>Activité de {{adminActivityUser?.name}} ({{adminActivityUser?.email}})</h2>
            <p class="muted">Comptes WhatsApp et conversations associées :</p>
          </div>
          <div v-if="!adminActivityData.length" class="empty-inline">Aucun compte WhatsApp pour cet utilisateur.</div>
          <div v-for="acct in adminActivityData" :key="acct.id" class="card user-activity-card">
            <div class="acct-header">
              <div class="acct-info">
                <h3>{{acct.label}}</h3>
                <small class="muted">{{acct.phone||'Numéro non lié'}}</small>
              </div>
              <span class="status-tag" :class="acct.status">{{statusLabel(acct.status)}}</span>
            </div>
            <div class="acct-conversations">
              <div class="conv-heading">Conversations ({{acct.conversations.length}}) :</div>
              <div v-if="!acct.conversations.length" class="muted small">Aucune conversation encore reçue sur ce compte.</div>
              <div v-for="cv in acct.conversations" :key="cv.id" class="activity-conv-row">
                <div>
                  <strong>{{cv.title}}</strong> <small class="muted">({{cv.jid.split('@')[0]}})</small>
                </div>
                <div class="conv-meta">
                  <span class="mode-mini" :class="cv.mode">{{cv.mode==='manual'?'MOI':cv.mode==='ai'?'IA':'MIX'}}</span>
                  <span class="badge">{{cv.messages_count}} messages</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- TAB 3: AI MODELS MANAGEMENT -->
        <div v-else-if="adminTab==='models'" class="admin-tab-content">
          <div class="model-top-bar">
            <div>
              <h2>Modèles d'intelligence artificielle</h2>
              <p class="muted">Configurez les modèles et clés API utilisables par les utilisateurs pour leurs réponses automatiques.</p>
            </div>
            <button class="btn primary" @click="openNewModelModal"><Plus :size="17"/> Ajouter un modèle IA</button>
          </div>

          <div class="models-grid">
            <div v-for="m in adminModels" :key="m.id" class="model-item-card" :class="{disabled:!m.enabled}">
              <div class="model-card-top">
                <div class="model-title-wrap">
                  <span class="model-icon"><Bot :size="20"/></span>
                  <div>
                    <h3>{{m.name}}</h3>
                    <code class="model-id-code">{{m.model_id}}</code>
                  </div>
                </div>
                <span v-if="m.is_default" class="default-badge"><Check :size="12"/> Modèle par défaut</span>
              </div>
              <div class="model-details">
                <div><strong>Base URL :</strong> <code>{{m.base_url}}</code></div>
                <div><strong>Clé API :</strong> <code>••••••••••••••••</code></div>
              </div>
              <div class="model-actions-bar">
                <button class="btn-xs" :class="m.enabled?'success':'secondary'" @click="toggleModelEnabled(m)">
                  {{m.enabled?'Activé':'Désactivé'}}
                </button>
                <button class="btn-xs secondary" @click="editModel(m)"><Settings2 :size="13"/> Modifier</button>
                <button v-if="!m.is_default" class="btn-xs danger" @click="deleteModel(m)"><Trash2 :size="13"/> Supprimer</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- INBOX SECTION -->
      <section v-else class="inbox">
        <div class="chat-list-panel">
          <div class="list-heading">
            <div>
              <small>MESSAGERIE UNIFIÉE</small>
              <h2>Conversations <span>{{filtered.length}}</span></h2>
            </div>
            <button class="icon-circle" title="Actualiser" @click="refresh"><RefreshCw :size="17"/></button>
          </div>
          <div class="search-box">
            <Search :size="17"/>
            <input v-model="query" placeholder="Rechercher un contact…"/>
          </div>
          <div class="account-filter">
            <span>{{activeAccount?.label||'Tous les comptes'}}</span>
            <ChevronDown :size="15"/>
          </div>
          <div class="conversation-scroll">
            <button v-for="c in filtered" :key="c.id" class="conversation-item" :class="{active:c.id===activeConversation?.id}" @click="selectConversation(c)">
              <span class="contact-avatar">{{c.title[0]?.toUpperCase()||'?'}}</span>
              <span class="conv-info">
                <strong>{{c.title}}</strong>
                <small>{{c.jid.split('@')[0]}}</small>
              </span>
              <span class="mode-mini" :class="c.mode">{{c.mode==='manual'?'MOI':c.mode==='ai'?'IA':'MIX'}}</span>
            </button>
            <div v-if="!filtered.length" class="list-empty">
              <MessageCircle :size="33"/>
              <strong>Aucune conversation</strong>
              <span>Connectez un compte WhatsApp ci-dessous pour recevoir vos premiers messages.</span>
            </div>
          </div>
          <button class="connect-banner" @click="showAdd=true"><Plus :size="17"/> Connecter un compte WhatsApp</button>
        </div>

        <!-- CHAT CONVERSATION VIEW -->
        <div class="chat-main" v-if="activeConversation">
          <div class="chat-header">
            <span class="contact-avatar chat-contact">{{activeConversation.title[0]?.toUpperCase()}}</span>
            <div class="chat-header-info">
              <strong>{{activeConversation.title}}</strong>
              <small>{{activeConversation.jid.split('@')[0]}}</small>
            </div>
            <span class="mode-pill" :class="activeConversation.mode">
              <Bot v-if="activeConversation.mode==='ai'" :size="15"/>
              <Blend v-else-if="activeConversation.mode==='hybrid'" :size="15"/>
              <UserRound v-else :size="15"/>
              {{modeLabel(activeConversation.mode)}}
            </span>
            <button class="icon-circle" title="Paramètres de l'assistant pour ce contact" @click="openSettings"><Settings2 :size="19"/></button>
          </div>

          <div class="chat-messages">
            <div class="day-divider"><span>Conversation WhatsApp (Simulation de frappe active)</span></div>
            <div v-for="m in messages" :key="m.id" class="message-row" :class="m.direction">
              <div class="bubble">
                <div>{{m.content}}</div>
                <div class="bubble-meta">
                  <Bot v-if="m.sender==='ai'" :size="12"/>
                  {{m.sender==='ai'?'Assisté IA · ':''}}
                  {{new Date(m.created_at).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}}
                </div>
              </div>
            </div>
            <div v-if="!messages.length" class="messages-placeholder">Les messages échangés apparaîtront ici.</div>
            <div ref="bottom"></div>
          </div>

          <div class="composer">
            <div class="composer-hint">
              <span class="composer-indicator"></span> 
              {{activeConversation.mode==='manual'?'Mode manuel : vos réponses sont envoyées avec simulation de frappe humaine':activeConversation.mode==='ai'?'Mode IA autonome actif : les messages reçus déclenchent une réponse automatique':'Mode hybride : l\'IA intervient selon vos règles'}}
            </div>
            <form class="composer-box" @submit.prevent="send">
              <input v-model="draft" placeholder="Écrivez votre message…"/>
              <button :disabled="!draft.trim()||busy" title="Envoyer"><Send :size="18"/></button>
            </form>
            <div class="composer-footnote">Les messages sont transmis directement via WhatsApp Web (Baileys) avec présence "en train d'écrire...".</div>
          </div>
        </div>

        <div v-else class="chat-blank">
          <div class="blank-icon"><MessageCircle :size="44"/></div>
          <h2>Vos conversations, sans limites.</h2>
          <p>Sélectionnez une conversation dans la liste ou connectez un nouveau compte WhatsApp.</p>
          <button class="btn primary" @click="showAdd=true"><Plus :size="17"/> Connecter WhatsApp</button>
        </div>
      </section>
    </main>
  </div>

  <!-- MODAL: ADD ACCOUNT -->
  <div v-if="showAdd" class="modal-overlay" @click.self="showAdd=false">
    <div class="modal small-modal">
      <div class="modal-top">
        <div>
          <small>NOUVEAU COMPTE</small>
          <h2>Connecter WhatsApp</h2>
        </div>
        <button @click="showAdd=false"><X :size="20"/></button>
      </div>
      <p class="muted">Donnez un nom unique à ce compte WhatsApp pour le distinguer (ex. "WhatsApp Support", "Personnel").</p>
      <form @submit.prevent="addAccount">
        <label>
          Nom du compte
          <input v-model="newAccountName" required autofocus placeholder="Ex. WhatsApp Support"/>
        </label>
        <button class="btn primary full" :disabled="busy">
          Continuer et générer le QR Code <ArrowRight :size="17"/>
        </button>
      </form>
    </div>
  </div>

  <!-- MODAL: QR CODE SCANNING -->
  <div v-if="qrData" class="modal-overlay" @click.self="qrData=null">
    <div class="modal qr-modal">
      <div class="modal-top">
        <div>
          <small>CONNEXION SÉCURISÉE</small>
          <h2>{{qrData.label}}</h2>
        </div>
        <button @click="qrData=null"><X :size="20"/></button>
      </div>
      <div v-if="qrData.status==='connected'" class="qr-success">
        <CheckCircle2 :size="56"/>
        <h3>Compte connecté avec succès !</h3>
        <p>Numéro associé : <strong>{{qrData.phone||'WhatsApp'}}</strong></p>
        <p class="muted">Vos messages entrants apparaîtront automatiquement dans votre espace.</p>
        <button class="btn primary" style="margin-top:15px" @click="qrData=null">Terminer</button>
      </div>
      <template v-else>
        <div class="qr-frame">
          <img v-if="qrData.qr" :src="qrData.qr" alt="Code QR WhatsApp à scanner"/>
          <div v-else class="qr-loading">
            <RefreshCw :size="36" class="spin"/>
            <span>Génération du code QR WhatsApp…</span>
          </div>
        </div>
        <p class="qr-instructions">
          Sur votre téléphone : ouvrez <strong>WhatsApp → Appareils connectés → Connecter un appareil</strong>, puis scannez ce code.
        </p>
        <div class="qr-actions">
          <button class="btn secondary full" @click="connect({id:qrData.id,label:qrData.label})">
            <RefreshCw :size="16"/> Régénérer le QR
          </button>
          <button class="btn-text danger" @click="removeAccount(qrData)">
            <Trash2 :size="15"/> Annuler et supprimer ce compte
          </button>
        </div>
      </template>
    </div>
  </div>

  <!-- MODAL: CONVERSATION SETTINGS (AI & RULES) -->
  <div v-if="showSettings" class="modal-overlay" @click.self="showSettings=false">
    <div class="modal settings-modal">
      <div class="modal-top">
        <div>
          <small>CONFIGURATION PAR CONTACT</small>
          <h2>Paramètres de l'assistant IA</h2>
          <p class="muted">{{activeConversation?.title}} ({{activeConversation?.jid}})</p>
        </div>
        <button @click="showSettings=false"><X :size="20"/></button>
      </div>

      <div class="settings-body">
        <label class="field-heading">Mode de conversation</label>
        <div class="mode-options">
          <button v-for="mode in [{key:'manual',label:'Manuel',description:'Vous répondez seul',icon:UserRound},{key:'ai',label:'IA Autonome',description:'L\'IA répond à tout',icon:Bot},{key:'hybrid',label:'Hybride',description:'Selon vos règles',icon:Blend}]" :key="mode.key" class="mode-option" :class="{chosen:settings.mode===mode.key}" @click="settings.mode=mode.key">
            <component :is="mode.icon" :size="21"/>
            <strong>{{mode.label}}</strong>
            <small>{{mode.description}}</small>
          </button>
        </div>

        <template v-if="settings.mode!=='manual'">
          <!-- AI MODEL SELECTION DROPDOWN -->
          <label>
            Choix du modèle d'Intelligence Artificielle
            <select v-model="settings.ai_model_id">
              <option :value="null">Modèle par défaut (Groq Llama 3.3)</option>
              <option v-for="m in aiModels" :key="m.id" :value="m.id">
                {{m.name}} ({{m.model_id}}){{m.is_default?' — [Défaut]':''}}
              </option>
            </select>
          </label>

          <label>
            Consignes spécifiques pour l'IA (Instructions prompt)
            <textarea v-model="settings.instructions" rows="4" placeholder="Ex. Réponds poliment en français. Sois concis. Donne les informations de tarif pour nos services. Ne prends aucun engagement sans confirmation."></textarea>
          </label>

          <template v-if="settings.mode==='hybrid'">
            <label>
              Déclencheur de réponse automatique
              <select v-model="settings.hybrid_rule">
                <option value="keywords">Si le message contient certains mots-clés</option>
                <option value="outside_hours">En dehors des horaires d'ouverture (UTC)</option>
                <option value="always_draft">Brouillon uniquement (pas d'envoi auto)</option>
              </select>
            </label>

            <label v-if="settings.hybrid_rule==='keywords'">
              Mots-clés déclencheurs (séparés par des virgules)
              <input v-model="settings.keywords" placeholder="prix, tarif, bonjour, devis, disponibilite"/>
            </label>

            <label v-if="settings.hybrid_rule==='outside_hours'">
              Horaires de présence (UTC)
              <input v-model="settings.business_hours" placeholder="09:00-18:00"/>
            </label>
          </template>

          <label>
            Délai minimal entre deux réponses automatiques (secondes)
            <input type="number" min="0" max="86400" v-model.number="settings.cooldown_seconds"/>
          </label>
        </template>

        <div class="info-note">
          <ShieldCheck :size="17"/> Les réponses automatiques simulent la frappe humaine (typing compose) avant l'envoi afin de prévenir les blocages WhatsApp.
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn secondary" @click="showSettings=false">Annuler</button>
        <button class="btn primary" :disabled="busy" @click="saveSettings">Enregistrer les préférences</button>
      </div>
    </div>
  </div>

  <!-- MODAL: ADD / EDIT AI MODEL (ADMIN) -->
  <div v-if="showModelModal" class="modal-overlay" @click.self="showModelModal=false">
    <div class="modal model-form-modal">
      <div class="modal-top">
        <div>
          <small>GESTION DES FOURNISSEURS IA</small>
          <h2>{{modelForm.id?'Modifier le modèle IA':'Nouveau modèle IA'}}</h2>
        </div>
        <button @click="showModelModal=false"><X :size="20"/></button>
      </div>

      <form @submit.prevent="saveModel">
        <label>
          Nom d'affichage
          <input v-model="modelForm.name" required placeholder="Ex. Groq Llama 3.3 70B, GPT-4o mini, DeepSeek V3"/>
        </label>
        <label>
          Identifiant du modèle (model id)
          <input v-model="modelForm.model_id" required placeholder="Ex. llama-3.3-70b-versatile, openai/gpt-oss-20b, gpt-4o-mini"/>
        </label>
        <label>
          URL de base de l'API (OpenAI-compatible Base URL)
          <input v-model="modelForm.base_url" required placeholder="Ex. https://api.groq.com/openai/v1 ou https://api.openai.com/v1"/>
        </label>
        <label>
          Clé API secrète (API Key)
          <input v-model="modelForm.api_key" required type="password" placeholder="gsk_... ou sk-..."/>
        </label>
        <label class="checkbox-label">
          <input type="checkbox" v-model="modelForm.is_default"/>
          <span>Définir comme modèle d'IA par défaut de la plateforme</span>
        </label>

        <div class="modal-footer">
          <button type="button" class="btn secondary" @click="showModelModal=false">Annuler</button>
          <button type="submit" class="btn primary" :disabled="busy">{{busy?'Enregistrement...':'Enregistrer le modèle'}}</button>
        </div>
      </form>
    </div>
  </div>

  <!-- TOAST NOTIFICATIONS -->
  <div v-if="error" class="toast error">
    <AlertCircle :size="19"/> {{error}} 
    <button @click="error=''">×</button>
  </div>
  <div v-if="notice" class="toast notice">
    <CheckCircle2 :size="19"/> {{notice}} 
    <button @click="notice=''">×</button>
  </div>
</template>