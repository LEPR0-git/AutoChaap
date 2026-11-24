import math,re,unicodedata
from collections import Counter
from flask import Flask,request,jsonify
app=Flask(__name__)
app.config['MAX_CONTENT_LENGTH']=12*1024*1024
def tokens(text):
    normalized=unicodedata.normalize('NFKD',text.lower())
    return re.findall(r'\w+', ''.join(c for c in normalized if not unicodedata.combining(c)))
def retrieve(query,documents):
    chunks=[]
    for doc in documents[:30]:
        text=doc['text'][:120000]; title=doc['title'][:200]
        for i in range(0,len(text),800):
            part=text[i:i+1000]
            if part.strip():chunks.append((title,part,Counter(tokens(title+' '+part))))
    q=Counter(tokens(query)); n=len(chunks)
    if not n or not q:return []
    df=Counter(t for _,_,counts in chunks for t in q if t in counts)
    avg=sum(sum(c.values()) for _,_,c in chunks)/n or 1
    ranked=[]
    for title,part,c in chunks:
        length=sum(c.values());score=0
        for t in q:
            f=c[t]
            if f:score+=math.log(1+(n-df[t]+.5)/(df[t]+.5))*f*2.2/(f+1.2*(.25+.75*length/avg))
        if score>0:ranked.append((score,title,part))
    ranked.sort(key=lambda x:x[0],reverse=True)
    return [title+': '+part for _,title,part in ranked[:5]]
@app.post('/retrieve')
def search():
    d=request.get_json(silent=True) or {}
    query=d.get('query');docs=d.get('documents')
    if not isinstance(query,str) or not isinstance(docs,list) or any(not isinstance(x,dict) or not isinstance(x.get('title'),str) or not isinstance(x.get('text'),str) for x in docs):
        return jsonify(error='Invalid input'),400
    return jsonify(chunks=retrieve(query[:10000],docs))
@app.get('/health')
def health():return jsonify(status='ok')
