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
