import os,sys
sys.path.insert(0,os.path.dirname(os.path.dirname(__file__)))
from app.main import create_app,db,Account,Conversation,Message
import pytest
@pytest.fixture
def client():
    a=create_app({'TESTING':True,'SQLALCHEMY_DATABASE_URI':'sqlite://','JWT_SECRET':'test-long-secret','BRIDGE_SECRET':'bridge-test'})
    with a.app_context():
        yield a.test_client()
        db.session.remove();db.drop_all()
def user(client,email='test@example.org'):
    r=client.post('/api/auth/register',json={'name':'Test','email':email,'password':'longpassword'})
    return {'Authorization':'Bearer '+r.json['token']}
def test_auth(client):
    assert client.get('/api/accounts').status_code==401
    h=user(client)
    assert client.get('/api/me',headers=h).status_code==200
    assert client.post('/api/auth/login',json={'email':'test@example.org','password':'wrong'}).status_code==401
    assert client.post('/api/auth/login',json={'email':'test@example.org','password':'longpassword'}).status_code==200
def test_owner_and_settings(client):
    h=user(client); a=client.post('/api/accounts',headers=h,json={'label':'Pro'}).json['account']
    h2=user(client,'second@example.org')
    assert client.get('/api/accounts/'+a['id']+'/status',headers=h2).status_code==404
    with client.application.app_context():
        c=Conversation(account_id=a['id'],jid='237690000000@s.whatsapp.net',title='Contact');db.session.add(c);db.session.commit();cid=c.id
    assert client.patch('/api/conversations/'+cid+'/settings',headers=h2,json={'mode':'ai'}).status_code==404
    assert client.patch('/api/conversations/'+cid+'/settings',headers=h,json={'mode':'hybrid','keywords':'prix, aide'}).json['conversation']['mode']=='hybrid'
    assert client.patch('/api/conversations/'+cid+'/settings',headers=h,json={'mode':'invalid'}).status_code==400
def test_webhook_dedup(client):
    h=user(client);aid=client.post('/api/accounts',headers=h,json={'label':'Business'}).json['account']['id']
    body={'type':'message','account_id':aid,'jid':'237690000000@s.whatsapp.net','text':'Bonjour','message_id':'id-1'}
    assert client.post('/internal/events',json=body).status_code==403
    hdr={'X-Bridge-Secret':'bridge-test'}
    assert client.post('/internal/events',headers=hdr,json=body).status_code==200
    assert client.post('/internal/events',headers=hdr,json=body).json['duplicate']
    with client.application.app_context():assert Message.query.count()==1

def test_history_import(client,monkeypatch):
    h=user(client);aid=client.post('/api/accounts',headers=h,json={'label':'History'}).json['account']['id']
    other=user(client,'other-history@example.org')
    hdr={'X-Bridge-Secret':'bridge-test'}
    jid='237690000000@s.whatsapp.net'
    body={'type':'history','account_id':aid,'chats':[{'jid':jid,'title':'Alice'},{'jid':'12345@lid','title':'LID'},{'jid':'12345-12345@g.us','title':'Group'},{'jid':'status@broadcast'}],'messages':[
        {'jid':jid,'text':'ancien','message_id':aid+':in','timestamp':1700000000,'from_me':False},
        {'jid':jid,'text':'reponse','message_id':aid+':out','timestamp':1700000001,'from_me':True}]}
    assert client.post('/internal/events',json=body).status_code==403
    assert client.post('/internal/events',headers=hdr,json=body).json['messages']==2
    convs=client.get('/api/conversations',headers=h).json['conversations']
    assert len(convs)==3
    assert client.get('/api/conversations',headers=other).json['conversations']==[]
    cid=next(c['id'] for c in convs if c['jid']==jid)
    assert client.patch('/api/conversations/'+cid+'/settings',headers=h,json={'mode':'ai'}).status_code==200
    def unexpected(*args,**kwargs):raise AssertionError('History must not trigger AI or send')
    monkeypatch.setattr('app.main.requests.post',unexpected)
    assert client.post('/internal/events',headers=hdr,json=body).json['messages']==0
    body['messages'][0]['message_id']=aid+':new-history'
    assert client.post('/internal/events',headers=hdr,json=body).json['messages']==1
    msgs=client.get('/api/conversations/'+cid+'/messages',headers=h).json['messages']
    assert len(msgs)==3
    assert any(m['direction']=='out' and m['content']=='reponse' for m in msgs)

def test_unread_recent_and_knowledge(client):
    h=user(client);other=user(client,'other-workspace@example.org')
    aid=client.post('/api/accounts',headers=h,json={'label':'Pro'}).json['account']['id']
    hdr={'X-Bridge-Secret':'bridge-test'}
    def event(jid,mid,text):
        return client.post('/internal/events',headers=hdr,json={'type':'message','account_id':aid,'jid':jid,'message_id':mid,'text':text})
    assert event('12345@lid','m1','Ancien').status_code==200
    assert event('67890@lid','m2','Recent').status_code==200
    rows=client.get('/api/conversations',headers=h).json['conversations']
    assert rows[0]['jid']=='67890@lid'
    cid=rows[0]['id']
    assert rows[0]['unread_count']==1
    assert rows[0]['last_message']=='Recent'
    msgs=client.get('/api/conversations/'+cid+'/messages',headers=h).json['messages']
    assert client.post('/api/conversations/'+cid+'/read',headers=other,json={'message_ids':[msgs[0]['id']]}).status_code==404
    assert client.post('/api/conversations/'+cid+'/read',headers=h,json={'message_ids':[msgs[0]['id']]}).status_code==200
    assert client.get('/api/conversations',headers=h).json['conversations'][0]['unread_count']==0
    assert event('67890@lid','m3','Nouveau').status_code==200
    assert client.get('/api/conversations',headers=h).json['conversations'][0]['unread_count']==1
    url='/api/conversations/'+cid+'/knowledge'
    assert client.post(url,headers=h,json={'kind':'text','title':'Tarifs','content':'Service A : 5000 FCFA'}).status_code==201
    assert len(client.get(url,headers=h).json['sources'])==1
    assert client.get(url,headers=other).status_code==404

def test_google_identity(client,monkeypatch):
    client.application.config['GOOGLE_CLIENT_ID']='test-client'
    payload={'sub':'google-sub-1','email':'verified@example.org','email_verified':True,'name':'Verified'}
    monkeypatch.setattr('google.oauth2.id_token.verify_oauth2_token',lambda *a,**k:payload)
    result=client.post('/api/auth/google',json={'credential':'mock'})
    assert result.status_code==200
    assert result.json['user']['email']=='verified@example.org'
    payload['email_verified']=False
    assert client.post('/api/auth/google',json={'credential':'mock'}).status_code==401
