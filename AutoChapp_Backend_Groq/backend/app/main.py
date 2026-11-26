"""AutoChapp API. WhatsApp bridge is internal; access controlled by ownership."""
import os, uuid, re, datetime, functools
from urllib.parse import quote_plus
from flask import Flask, jsonify, request, g
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
import jwt, requests
from sqlalchemy import UniqueConstraint

db=SQLAlchemy()
def now(): return datetime.datetime.now(datetime.timezone.utc)
def identifier(): return str(uuid.uuid4())

class User(db.Model):
    id=db.Column(db.String(36),primary_key=True,default=identifier)
    name=db.Column(db.String(100),nullable=False)
    email=db.Column(db.String(255),unique=True,nullable=False,index=True)
    password_hash=db.Column(db.String(300),nullable=True)
    role=db.Column(db.String(20),default='user')
    created_at=db.Column(db.DateTime(timezone=True),default=now)

class AIModel(db.Model):
    id=db.Column(db.String(36),primary_key=True,default=identifier)
    name=db.Column(db.String(100),nullable=False)
    model_id=db.Column(db.String(200),nullable=False)
    base_url=db.Column(db.String(500),nullable=False)
    api_key=db.Column(db.String(500),nullable=False)
    is_default=db.Column(db.Boolean,default=False)
    enabled=db.Column(db.Boolean,default=True)
    created_at=db.Column(db.DateTime(timezone=True),default=now)

class Account(db.Model):
    id=db.Column(db.String(36),primary_key=True,default=identifier)
    user_id=db.Column(db.String(36),db.ForeignKey('user.id'),nullable=False,index=True)
    label=db.Column(db.String(120),nullable=False)
    phone=db.Column(db.String(50))
    status=db.Column(db.String(30),default='disconnected')
    created_at=db.Column(db.DateTime(timezone=True),default=now)

class Conversation(db.Model):
    id=db.Column(db.String(36),primary_key=True,default=identifier)
    account_id=db.Column(db.String(36),db.ForeignKey('account.id'),nullable=False,index=True)
    jid=db.Column(db.String(150),nullable=False)
    title=db.Column(db.String(150),nullable=False)
    avatar_url=db.Column(db.String(1000),nullable=True)
    mode=db.Column(db.String(12),nullable=False,default='manual')
    instructions=db.Column(db.Text,default='')
    hybrid_rule=db.Column(db.String(30),default='keywords')
    keywords=db.Column(db.Text,default='')
    business_hours=db.Column(db.String(50),default='09:00-18:00')
    cooldown_seconds=db.Column(db.Integer,default=60)
    ai_model_id=db.Column(db.String(36),db.ForeignKey('ai_model.id'),nullable=True)
    last_auto_at=db.Column(db.DateTime(timezone=True))
    __table_args__=(UniqueConstraint('account_id','jid',name='uq_conversation_account_jid'),)

class Message(db.Model):
    id=db.Column(db.String(36),primary_key=True,default=identifier)
    conversation_id=db.Column(db.String(36),db.ForeignKey('conversation.id'),nullable=False,index=True)
    external_id=db.Column(db.String(200),unique=True,nullable=True)
    content=db.Column(db.Text,nullable=False)
    direction=db.Column(db.String(12),nullable=False)
    sender=db.Column(db.String(12),nullable=False,default='contact')
    created_at=db.Column(db.DateTime(timezone=True),default=now,index=True)

def serialize_account(a): return dict(id=a.id,label=a.label,phone=a.phone,status=a.status,created_at=a.created_at.isoformat() if a.created_at else None)
def serialize_conversation(c): return dict(id=c.id,account_id=c.account_id,jid=c.jid,title=c.title,avatar_url=c.avatar_url,mode=c.mode,instructions=c.instructions or '',hybrid_rule=c.hybrid_rule,keywords=c.keywords or '',business_hours=c.business_hours,cooldown_seconds=c.cooldown_seconds,ai_model_id=c.ai_model_id)
def serialize_message(m): return dict(id=m.id,conversation_id=m.conversation_id,content=m.content,direction=m.direction,sender=m.sender,created_at=m.created_at.isoformat() if m.created_at else None)
def serialize_ai_model(m,admin=False):
    d=dict(id=m.id,name=m.name,model_id=m.model_id,is_default=m.is_default,enabled=m.enabled)
    if admin: d.update(base_url=m.base_url,api_key=m.api_key)
    return d

def get_db_uri():
    raw = os.getenv('DATABASE_URL', '').strip()
    if raw.startswith('postgresql') and raw.count('@') > 1:
        try:
            proto, rest = raw.split('://', 1)
            creds, host_part = rest.rsplit('@', 1)
            if ':' in creds:
                user, pwd = creds.split(':', 1)
                return f"{proto}://{user}:{quote_plus(pwd)}@{host_part}"
        except Exception:
            pass
    if not raw and os.getenv('POSTGRES_PASSWORD'):
        u = os.getenv('POSTGRES_USER', 'autochapp')
        p = quote_plus(os.getenv('POSTGRES_PASSWORD', ''))
        h = os.getenv('POSTGRES_HOST', 'db')
        port = os.getenv('POSTGRES_PORT', '5432')
        d = os.getenv('POSTGRES_DB', 'autochapp')
        return f"postgresql+psycopg2://{u}:{p}@{h}:{port}/{d}"
    return raw or 'sqlite:////tmp/autochapp.db'

def create_app(test_config=None):
    app=Flask(__name__)
    app.config.update(SQLALCHEMY_DATABASE_URI=get_db_uri(),SQLALCHEMY_TRACK_MODIFICATIONS=False,JWT_SECRET=os.getenv('JWT_SECRET',''),BRIDGE_URL=os.getenv('BRIDGE_URL','http://bridge:3100'),BRIDGE_SECRET=os.getenv('BRIDGE_SECRET',''),AI_BASE_URL=os.getenv('AI_BASE_URL','https://api.groq.com/openai/v1'),AI_API_KEY=os.getenv('AI_API_KEY',''),AI_MODEL=os.getenv('AI_MODEL','openai/gpt-oss-20b'),GOOGLE_CLIENT_ID=os.getenv('GOOGLE_CLIENT_ID',''))
    if test_config: app.config.update(test_config)
    if not app.config['JWT_SECRET']: raise RuntimeError('JWT_SECRET must be configured')
    db.init_app(app)
    cors_env = os.getenv('CORS_ORIGINS', '*').strip()
    if cors_env == '*' or not cors_env:
        CORS(app, resources={r'/api/*': {'origins': '*'}})
    else:
        CORS(app, resources={r'/api/*': {'origins': [o.strip() for o in cors_env.split(',') if o.strip()]}})
    with app.app_context():
        try:
            db.create_all()
        except Exception:
            pass
        try:
            db.session.execute(db.text('ALTER TABLE "user" ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT \'user\';'))
            db.session.execute(db.text('ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS ai_model_id VARCHAR(36);'))
            db.session.execute(db.text('ALTER TABLE "conversation" ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(1000);'))
            db.session.commit()
        except Exception:
            db.session.rollback()
        try:
            if not AIModel.query.first():
                default_model = AIModel(
                    name='Groq Llama 3.3 (défaut)' if 'groq' in app.config['AI_BASE_URL'].lower() else 'OpenAI (défaut)',
                    model_id=app.config['AI_MODEL'],
                    base_url=app.config['AI_BASE_URL'],
                    api_key=app.config['AI_API_KEY'] or 'not-set',
                    is_default=True,
                    enabled=True
                )
                db.session.add(default_model)
                db.session.commit()
            admin_email = os.getenv('ADMIN_EMAIL','').strip().lower()
            if admin_email:
                u = User.query.filter_by(email=admin_email).first()
                if u and u.role != 'admin':
                    u.role = 'admin'
                    db.session.commit()
        except Exception:
            db.session.rollback()
    @app.errorhandler(400)
    def bad_request(e): return jsonify(error='Requête invalide'),400
    @app.errorhandler(404)
    def not_found(e): return jsonify(error='Introuvable'),404
    @app.errorhandler(500)
    def error(e): db.session.rollback(); return jsonify(error='Erreur serveur'),500
    def auth(f):
        @functools.wraps(f)
        def wrapped(*args,**kwargs):
            token=request.headers.get('Authorization','').removeprefix('Bearer ').strip()
            try:
                data=jwt.decode(token,app.config['JWT_SECRET'],algorithms=['HS256'])
                g.user=db.session.get(User,data['sub'])
                if not g.user: raise ValueError()
            except Exception: return jsonify(error='Authentification requise'),401
            return f(*args,**kwargs)
        return wrapped
    def admin_required(f):
        @functools.wraps(f)
        def wrapped(*args,**kwargs):
            token=request.headers.get('Authorization','').removeprefix('Bearer ').strip()
            try:
                data=jwt.decode(token,app.config['JWT_SECRET'],algorithms=['HS256'])
                g.user=db.session.get(User,data['sub'])
                if not g.user or (g.user.role or 'user')!='admin': raise ValueError()
            except Exception: return jsonify(error='Accès administrateur requis'),403
            return f(*args,**kwargs)
        return wrapped
    def owned_account(account_id): return Account.query.filter_by(id=account_id,user_id=g.user.id).first()
    def owned_conversation(conv_id):
        return db.session.query(Conversation).join(Account).filter(Conversation.id==conv_id,Account.user_id==g.user.id).first()
    def bridge_call(method,path,payload=None):
        try:
            r=requests.request(method,app.config['BRIDGE_URL']+path,json=payload,headers={'X-Bridge-Secret':app.config['BRIDGE_SECRET']},timeout=12)
            return r.json(),r.status_code
        except (requests.RequestException,ValueError): return {'error':'Connecteur WhatsApp indisponible'},503
    def jwt_user(u): return jwt.encode({'sub':u.id,'exp':now()+datetime.timedelta(days=1)},app.config['JWT_SECRET'],algorithm='HS256')
    def user_json(u): return {'id':u.id,'name':u.name,'email':u.email,'role':u.role or 'user'}
    @app.get('/health')
    def health(): return jsonify(status='ok')
    @app.post('/api/auth/register')
    def register():
        d=request.get_json(silent=True) or {}; email=str(d.get('email','')).strip().lower(); password=str(d.get('password','')); name=str(d.get('name','')).strip()
        if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+',email) or len(password)<8 or not name: return jsonify(error='Nom, e-mail valide et mot de passe de 8 caractères minimum requis'),400
        if User.query.filter_by(email=email).first(): return jsonify(error='E-mail déjà utilisé'),409
        role = 'admin' if (os.getenv('ADMIN_EMAIL') and email == os.getenv('ADMIN_EMAIL').strip().lower()) else 'user'
        u=User(name=name,email=email,password_hash=generate_password_hash(password),role=role); db.session.add(u); db.session.commit()
        return jsonify(token=jwt_user(u),user=user_json(u)),201
    @app.post('/api/auth/login')
    def login():
        d=request.get_json(silent=True) or {}; u=User.query.filter_by(email=str(d.get('email','')).strip().lower()).first()
        if not u or not u.password_hash or not check_password_hash(u.password_hash,str(d.get('password',''))): return jsonify(error='Identifiants incorrects'),401
        return jsonify(token=jwt_user(u),user=user_json(u))
    @app.post('/api/auth/google')
    def google_login():
        from google.oauth2 import id_token
        from google.auth.transport import requests as grequests
        d=request.get_json(silent=True) or {}
        if not app.config['GOOGLE_CLIENT_ID']: return jsonify(error='Google OAuth non configuré'),503
        try:
            payload=id_token.verify_oauth2_token(d.get('credential',''),grequests.Request(),app.config['GOOGLE_CLIENT_ID'])
            if not payload.get('email_verified'): raise ValueError('Unverified email')
        except Exception: return jsonify(error='Token Google invalide'),401
        email=payload['email'].lower(); u=User.query.filter_by(email=email).first()
        if not u:
            role = 'admin' if (os.getenv('ADMIN_EMAIL') and email == os.getenv('ADMIN_EMAIL').strip().lower()) else 'user'
            u=User(name=payload.get('name',email.split('@')[0]),email=email,role=role); db.session.add(u); db.session.commit()
        return jsonify(token=jwt_user(u),user=user_json(u))
    @app.get('/api/me')
    @auth
    def me(): return jsonify(user=user_json(g.user))
    @app.route('/api/accounts',methods=['GET','POST'])
    @auth
    def accounts():
        if request.method=='GET': return jsonify(accounts=[serialize_account(a) for a in Account.query.filter_by(user_id=g.user.id).order_by(Account.created_at.desc()).all()])
        d=request.get_json(silent=True) or {}; label=str(d.get('label','')).strip()[:120]
        if not label: return jsonify(error='Nom du compte requis'),400
        if Account.query.filter_by(user_id=g.user.id,label=label).first():
            return jsonify(error='Un compte avec ce nom existe déjà'),409
        a=Account(user_id=g.user.id,label=label); db.session.add(a); db.session.commit(); return jsonify(account=serialize_account(a)),201
    @app.get('/api/accounts/<account_id>/qr')
    @auth
    def qr(account_id):
        a=owned_account(account_id)
        if not a: return jsonify(error='Compte introuvable'),404
        data,status=bridge_call('POST',f'/sessions/{account_id}/connect',{'owner':g.user.id})
        return jsonify(data),status
    @app.get('/api/accounts/<account_id>/status')
    @auth
    def account_status(account_id):
        a=owned_account(account_id)
        if not a:return jsonify(error='Compte introuvable'),404
        data,status=bridge_call('GET',f'/sessions/{account_id}/status')
        if status==200 and data.get('status'):
            a.status=data['status'];a.phone=data.get('phone') or a.phone;db.session.commit()
        return jsonify(data),status
    @app.delete('/api/accounts/<account_id>')
    @auth
    def delete_account(account_id):
        a=owned_account(account_id)
        if not a:return jsonify(error='Compte introuvable'),404
        _,bridge_status=bridge_call('DELETE',f'/sessions/{account_id}')
        for c in Conversation.query.filter_by(account_id=a.id).all():
            Message.query.filter_by(conversation_id=c.id).delete();db.session.delete(c)
        db.session.delete(a);db.session.commit()
        response={'ok':True}
        if bridge_status!=200:
            response['warning']='Compte retiré d’AutoChapp, mais nettoyage de la session WhatsApp à vérifier lorsque le connecteur sera disponible.'
        return jsonify(response)
    @app.get('/api/conversations')
    @auth
    def conversations():
        aid=request.args.get('account_id'); q=db.session.query(Conversation).join(Account).filter(Account.user_id==g.user.id)
        if aid:q=q.filter(Account.id==aid)
        return jsonify(conversations=[serialize_conversation(c) for c in q.order_by(Conversation.title).all()])
    @app.patch('/api/conversations/<cid>/settings')
    @auth
    def settings(cid):
        c=owned_conversation(cid)
        if not c:return jsonify(error='Conversation introuvable'),404
        d=request.get_json(silent=True) or {}; mode=d.get('mode',c.mode)
        if mode not in ('manual','ai','hybrid'): return jsonify(error='Mode invalide'),400
        rule=d.get('hybrid_rule',c.hybrid_rule)
        if rule not in ('keywords','outside_hours','always_draft'):return jsonify(error='Règle hybride invalide'),400
        c.mode=mode;c.hybrid_rule=rule;c.instructions=str(d.get('instructions',c.instructions))[:4000];c.keywords=str(d.get('keywords',c.keywords))[:500];c.business_hours=str(d.get('business_hours',c.business_hours))[:50]
        try:c.cooldown_seconds=max(0,min(86400,int(d.get('cooldown_seconds',c.cooldown_seconds))))
        except (TypeError,ValueError):return jsonify(error='Délai invalide'),400
        if 'ai_model_id' in d:
            mid=d.get('ai_model_id')
            if not mid:
                c.ai_model_id=None
            else:
                m_obj=AIModel.query.filter_by(id=str(mid),enabled=True).first()
                if m_obj: c.ai_model_id=m_obj.id
        db.session.commit();return jsonify(conversation=serialize_conversation(c))
    @app.get('/api/conversations/<cid>/messages')
    @auth
    def messages(cid):
        c=owned_conversation(cid)
        if not c:return jsonify(error='Conversation introuvable'),404
        rows=Message.query.filter_by(conversation_id=cid).order_by(Message.created_at.desc()).limit(100).all()
        return jsonify(messages=[serialize_message(m) for m in reversed(rows)])
    def push_message(c,content,sender):
        data,status=bridge_call('POST',f'/sessions/{c.account_id}/send',{'jid':c.jid,'text':content})
        if status!=200:return jsonify(data),status
        m=Message(conversation_id=c.id,content=content,direction='out',sender=sender,external_id=(data.get('messageId') or identifier()))
        db.session.add(m);db.session.commit();return jsonify(message=serialize_message(m)),201
    @app.post('/api/conversations/<cid>/messages')
    @auth
    def send(cid):
        c=owned_conversation(cid)
        if not c:return jsonify(error='Conversation introuvable'),404
        text=str((request.get_json(silent=True) or {}).get('content','')).strip()
        if not text or len(text)>10000:return jsonify(error='Message invalide'),400
        return push_message(c,text,'human')
    def hybrid_enabled(c,text):
        if c.hybrid_rule=='always_draft':return False
        if c.hybrid_rule=='keywords': return any(k.strip().lower() in text.lower() for k in c.keywords.split(',') if k.strip())
        if c.hybrid_rule=='outside_hours':
            try:
                start,end=c.business_hours.split('-'); hm=now().strftime('%H:%M')
                return not(start<=hm<end)
            except Exception:return False
        return False
    def ai_response(c):
        ai_model = None
        if c.ai_model_id:
            ai_model = db.session.get(AIModel, c.ai_model_id)
        if not ai_model or not ai_model.enabled:
            ai_model = AIModel.query.filter_by(is_default=True, enabled=True).first()
        if ai_model and ai_model.api_key and ai_model.api_key != 'not-set':
            base_url = ai_model.base_url
            api_key = ai_model.api_key
            model_id = ai_model.model_id
        else:
            base_url = app.config['AI_BASE_URL']
            api_key = app.config['AI_API_KEY']
            model_id = app.config['AI_MODEL']
        if not api_key or api_key == 'not-set': return None
        history=Message.query.filter_by(conversation_id=c.id).order_by(Message.created_at.desc()).limit(12).all()
        msgs=[{'role':'system','content':'Tu es un assistant WhatsApp répondant au nom du propriétaire. Ne fabrique pas des informations. Instructions du propriétaire : '+(c.instructions or 'Sois clair et poli.')}]
        msgs.extend({'role':'assistant' if m.direction=='out' else 'user','content':m.content} for m in reversed(history))
        try:
            r=requests.post(base_url.rstrip('/')+'/chat/completions',headers={'Authorization':'Bearer '+api_key},json={'model':model_id,'messages':msgs,'temperature':0.5,'max_tokens':350},timeout=20)
            r.raise_for_status();return r.json()['choices'][0]['message']['content'].strip()[:5000]
        except (requests.RequestException,KeyError,IndexError,TypeError):app.logger.exception('AI provider unavailable');return None
    @app.post('/internal/events')
    def events():
        if not app.config['BRIDGE_SECRET'] or request.headers.get('X-Bridge-Secret')!=app.config['BRIDGE_SECRET']:return jsonify(error='Interdit'),403
        d=request.get_json(silent=True) or {};aid=d.get('account_id');a=db.session.get(Account,aid) if aid else None
        if not a:return jsonify(error='Compte inconnu'),404
        if d.get('type')=='status':
            a.status=str(d.get('status','disconnected'))[:30];a.phone=str(d.get('phone') or '')[:50] or a.phone;db.session.commit();return jsonify(ok=True)
        if d.get('type')!='message' or d.get('from_me') or not d.get('jid') or not d.get('text'):return jsonify(ignored=True)
        ext=str(d.get('message_id') or '')
        if ext and Message.query.filter_by(external_id=ext).first():return jsonify(duplicate=True)
        jid=str(d['jid'])[:150];c=Conversation.query.filter_by(account_id=aid,jid=jid).first()
        if not c:c=Conversation(account_id=aid,jid=jid,title=str(d.get('title') or jid)[:150]);db.session.add(c);db.session.flush()
        title=str(d.get('title') or '').strip()
        if title and title != jid and not re.fullmatch(r'\+?\d[\d\s().-]*', title) and (not c.title or c.title == c.jid):
            c.title=title[:150]
        avatar_url=str(d.get('avatar_url') or '')
        if avatar_url.startswith('https://') and len(avatar_url)<=1000:
            c.avatar_url=avatar_url
        m=Message(conversation_id=c.id,external_id=ext or None,content=str(d['text'])[:10000],direction='in',sender='contact');db.session.add(m);db.session.commit()
        should_reply=c.mode=='ai' or(c.mode=='hybrid' and hybrid_enabled(c,m.content))
        if should_reply and (not c.last_auto_at or (now()-c.last_auto_at.replace(tzinfo=datetime.timezone.utc) if c.last_auto_at.tzinfo is None else now()-c.last_auto_at).total_seconds()>=c.cooldown_seconds):
            reply=ai_response(c)
            if reply:
                data,status=bridge_call('POST',f'/sessions/{aid}/send',{'jid':jid,'text':reply})
                if status==200:
                    db.session.add(Message(conversation_id=c.id,content=reply,direction='out',sender='ai',external_id=data.get('messageId') or identifier()));c.last_auto_at=now();db.session.commit()
        return jsonify(ok=True,conversation_id=c.id)

    # ---- USER AI MODELS ----
    @app.get('/api/models')
    @auth
    def user_list_models():
        models = AIModel.query.filter_by(enabled=True).order_by(AIModel.name).all()
        return jsonify(models=[serialize_ai_model(m, admin=False) for m in models])

    # ---- ADMIN ROUTES ----
    @app.get('/api/admin/stats')
    @admin_required
    def admin_stats():
        return jsonify(
            users=User.query.count(),
            accounts=Account.query.count(),
            connected_accounts=Account.query.filter_by(status='connected').count(),
            conversations=Conversation.query.count(),
            messages=Message.query.count()
        )

    @app.get('/api/admin/users')
    @admin_required
    def admin_users():
        users = User.query.order_by(User.created_at.desc()).all()
        res = []
        for u in users:
            acct_count = Account.query.filter_by(user_id=u.id).count()
            conv_count = db.session.query(Conversation).join(Account).filter(Account.user_id==u.id).count()
            res.append(dict(
                id=u.id,
                name=u.name,
                email=u.email,
                role=u.role or 'user',
                created_at=u.created_at.isoformat() if u.created_at else None,
                accounts_count=acct_count,
                conversations_count=conv_count
            ))
        return jsonify(users=res)

    @app.delete('/api/admin/users/<uid>')
    @admin_required
    def admin_delete_user(uid):
        u = db.session.get(User, uid)
        if not u: return jsonify(error='Utilisateur introuvable'), 404
        if u.id == g.user.id: return jsonify(error='Impossible de supprimer votre propre compte admin'), 400
        for a in Account.query.filter_by(user_id=u.id).all():
            try: bridge_call('DELETE', f'/sessions/{a.id}')
            except Exception: pass
            for c in Conversation.query.filter_by(account_id=a.id).all():
                Message.query.filter_by(conversation_id=c.id).delete()
                db.session.delete(c)
            db.session.delete(a)
        db.session.delete(u)
        db.session.commit()
        return jsonify(ok=True)

    @app.patch('/api/admin/users/<uid>/role')
    @admin_required
    def admin_toggle_role(uid):
        u = db.session.get(User, uid)
        if not u: return jsonify(error='Utilisateur introuvable'), 404
        d = request.get_json(silent=True) or {}
        new_role = d.get('role')
        if new_role not in ('admin', 'user'): return jsonify(error='Rôle invalide'), 400
        if u.id == g.user.id and new_role != 'admin':
            return jsonify(error='Impossible de révoquer vos propres droits admin'), 400
        u.role = new_role
        db.session.commit()
        return jsonify(user=user_json(u))

    @app.get('/api/admin/users/<uid>/activity')
    @admin_required
    def admin_user_activity(uid):
        u = db.session.get(User, uid)
        if not u: return jsonify(error='Utilisateur introuvable'), 404
        accts = Account.query.filter_by(user_id=u.id).order_by(Account.created_at.desc()).all()
        acct_list = []
        for a in accts:
            convs = Conversation.query.filter_by(account_id=a.id).all()
            conv_list = []
            for c in convs:
                msg_count = Message.query.filter_by(conversation_id=c.id).count()
                conv_list.append(dict(id=c.id, jid=c.jid, title=c.title, mode=c.mode, messages_count=msg_count))
            acct_list.append(dict(id=a.id, label=a.label, phone=a.phone, status=a.status, conversations=conv_list))
        return jsonify(user=user_json(u), accounts=acct_list)

    @app.get('/api/admin/models')
    @admin_required
    def admin_list_models():
        models = AIModel.query.order_by(AIModel.created_at.asc()).all()
        return jsonify(models=[serialize_ai_model(m, admin=True) for m in models])

    @app.post('/api/admin/models')
    @admin_required
    def admin_add_model():
        d = request.get_json(silent=True) or {}
        name = str(d.get('name', '')).strip()
        model_id = str(d.get('model_id', '')).strip()
        base_url = str(d.get('base_url', '')).strip()
        api_key = str(d.get('api_key', '')).strip()
        is_default = bool(d.get('is_default', False))
        if not name or not model_id or not base_url or not api_key:
            return jsonify(error='Nom, ID du modèle, Base URL et Clé API requis'), 400
        if is_default:
            AIModel.query.update({AIModel.is_default: False})
        m = AIModel(name=name, model_id=model_id, base_url=base_url, api_key=api_key, is_default=is_default, enabled=True)
        db.session.add(m)
        db.session.commit()
        return jsonify(model=serialize_ai_model(m, admin=True)), 201

    @app.patch('/api/admin/models/<mid>')
    @admin_required
    def admin_update_model(mid):
        m = db.session.get(AIModel, mid)
        if not m: return jsonify(error='Modèle introuvable'), 404
        d = request.get_json(silent=True) or {}
        if 'name' in d and str(d['name']).strip(): m.name = str(d['name']).strip()[:100]
        if 'model_id' in d and str(d['model_id']).strip(): m.model_id = str(d['model_id']).strip()[:200]
        if 'base_url' in d and str(d['base_url']).strip(): m.base_url = str(d['base_url']).strip()[:500]
        if 'api_key' in d and str(d['api_key']).strip(): m.api_key = str(d['api_key']).strip()[:500]
        if 'enabled' in d: m.enabled = bool(d['enabled'])
        if d.get('is_default'):
            AIModel.query.filter(AIModel.id != m.id).update({AIModel.is_default: False})
            m.is_default = True
        db.session.commit()
        return jsonify(model=serialize_ai_model(m, admin=True))

    @app.delete('/api/admin/models/<mid>')
    @admin_required
    def admin_delete_model(mid):
        m = db.session.get(AIModel, mid)
        if not m: return jsonify(error='Modèle introuvable'), 404
        if m.is_default: return jsonify(error='Impossible de supprimer le modèle par défaut'), 400
        Conversation.query.filter_by(ai_model_id=m.id).update({Conversation.ai_model_id: None})
        db.session.delete(m)
        db.session.commit()
        return jsonify(ok=True)

    return app