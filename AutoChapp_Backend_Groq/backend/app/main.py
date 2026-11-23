"""AutoChapp API. WhatsApp bridge is internal; access controlled by ownership."""
import os, uuid, re, datetime, functools
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
    mode=db.Column(db.String(12),nullable=False,default='manual')
    instructions=db.Column(db.Text,default='')
    hybrid_rule=db.Column(db.String(30),default='keywords')
    keywords=db.Column(db.Text,default='')
    business_hours=db.Column(db.String(50),default='09:00-18:00')
    cooldown_seconds=db.Column(db.Integer,default=60)
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

def serialize_account(a): return dict(id=a.id,label=a.label,phone=a.phone,status=a.status)
def serialize_conversation(c): return dict(id=c.id,account_id=c.account_id,jid=c.jid,title=c.title,mode=c.mode,instructions=c.instructions or '',hybrid_rule=c.hybrid_rule,keywords=c.keywords or '',business_hours=c.business_hours,cooldown_seconds=c.cooldown_seconds)
def serialize_message(m): return dict(id=m.id,conversation_id=m.conversation_id,content=m.content,direction=m.direction,sender=m.sender,created_at=m.created_at.isoformat() if m.created_at else None)

def create_app(test_config=None):
    app=Flask(__name__)
    app.config.update(SQLALCHEMY_DATABASE_URI=os.getenv('DATABASE_URL','sqlite:////tmp/autochapp.db'),SQLALCHEMY_TRACK_MODIFICATIONS=False,JWT_SECRET=os.getenv('JWT_SECRET',''),BRIDGE_URL=os.getenv('BRIDGE_URL','http://bridge:3100'),BRIDGE_SECRET=os.getenv('BRIDGE_SECRET',''),AI_BASE_URL=os.getenv('AI_BASE_URL','https://api.groq.com/openai/v1'),AI_API_KEY=os.getenv('AI_API_KEY',''),AI_MODEL=os.getenv('AI_MODEL','openai/gpt-oss-20b'),GOOGLE_CLIENT_ID=os.getenv('GOOGLE_CLIENT_ID',''))
    if test_config: app.config.update(test_config)
    if not app.config['JWT_SECRET']: raise RuntimeError('JWT_SECRET must be configured')
    db.init_app(app)
    CORS(app,resources={r'/api/*':{'origins':os.getenv('CORS_ORIGINS','http://localhost:8188').split(',')}})
    with app.app_context(): db.create_all() # production: migrate schema instead of relying on create_all
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
    def owned_account(account_id): return Account.query.filter_by(id=account_id,user_id=g.user.id).first()
    def owned_conversation(conv_id):
        return db.session.query(Conversation).join(Account).filter(Conversation.id==conv_id,Account.user_id==g.user.id).first()
    def bridge_call(method,path,payload=None):
        try:
            r=requests.request(method,app.config['BRIDGE_URL']+path,json=payload,headers={'X-Bridge-Secret':app.config['BRIDGE_SECRET']},timeout=12)
            return r.json(),r.status_code
        except (requests.RequestException,ValueError): return {'error':'Connecteur WhatsApp indisponible'},503
    def jwt_user(u): return jwt.encode({'sub':u.id,'exp':now()+datetime.timedelta(days=1)},app.config['JWT_SECRET'],algorithm='HS256')
    def user_json(u): return {'id':u.id,'name':u.name,'email':u.email}
    @app.get('/health')
    def health(): return jsonify(status='ok')
    @app.post('/api/auth/register')
    def register():
        d=request.get_json(silent=True) or {}; email=str(d.get('email','')).strip().lower(); password=str(d.get('password','')); name=str(d.get('name','')).strip()
        if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+',email) or len(password)<8 or not name: return jsonify(error='Nom, e-mail valide et mot de passe de 8 caractères minimum requis'),400
        if User.query.filter_by(email=email).first(): return jsonify(error='E-mail déjà utilisé'),409
        u=User(name=name,email=email,password_hash=generate_password_hash(password)); db.session.add(u); db.session.commit()
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
        if not u: u=User(name=payload.get('name',email.split('@')[0]),email=email); db.session.add(u); db.session.commit()
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
        bridge_call('DELETE',f'/sessions/{account_id}')
        for c in Conversation.query.filter_by(account_id=a.id).all():
            Message.query.filter_by(conversation_id=c.id).delete();db.session.delete(c)
        db.session.delete(a);db.session.commit();return jsonify(ok=True)
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
                return not(start<=hm<end)  # timezone UTC; set local policy to UTC or extend per-account TZ
            except Exception:return False
        return False
    def ai_response(c):
        if not app.config['AI_API_KEY']:return None
        history=Message.query.filter_by(conversation_id=c.id).order_by(Message.created_at.desc()).limit(12).all()
        msgs=[{'role':'system','content':'Tu es un assistant WhatsApp répondant au nom du propriétaire. Ne fabrique pas des informations. Instructions du propriétaire : '+(c.instructions or 'Sois clair et poli.')}]
        msgs.extend({'role':'assistant' if m.direction=='out' else 'user','content':m.content} for m in reversed(history))
        try:
            r=requests.post(app.config['AI_BASE_URL'].rstrip('/')+'/chat/completions',headers={'Authorization':'Bearer '+app.config['AI_API_KEY']},json={'model':app.config['AI_MODEL'],'messages':msgs,'temperature':0.5,'max_tokens':350},timeout=20)
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
        m=Message(conversation_id=c.id,external_id=ext or None,content=str(d['text'])[:10000],direction='in',sender='contact');db.session.add(m);db.session.commit()
        should_reply=c.mode=='ai' or(c.mode=='hybrid' and hybrid_enabled(c,m.content))
        if should_reply and (not c.last_auto_at or (now()-c.last_auto_at.replace(tzinfo=datetime.timezone.utc) if c.last_auto_at.tzinfo is None else now()-c.last_auto_at).total_seconds()>=c.cooldown_seconds):
            reply=ai_response(c)
            if reply:
                data,status=bridge_call('POST',f'/sessions/{aid}/send',{'jid':jid,'text':reply})
                if status==200:
                    db.session.add(Message(conversation_id=c.id,content=reply,direction='out',sender='ai',external_id=data.get('messageId') or identifier()));c.last_auto_at=now();db.session.commit()
        return jsonify(ok=True,conversation_id=c.id)
    return app
