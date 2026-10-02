import eval7, time, json, sys
R='AKQJT98765432'
classes=[]
for i,a in enumerate(R):
    for j,b in enumerate(R):
        if i==j: classes.append(a+b)
        elif i<j: classes.append(a+b+'s')
        else: classes.append(b+a+'o')
def rep(c):
    if len(c)==2: return [eval7.Card(c[0]+'s'),eval7.Card(c[1]+'h')]
    if c[2]=='s': return [eval7.Card(c[0]+'s'),eval7.Card(c[1]+'s')]
    return [eval7.Card(c[0]+'s'),eval7.Card(c[1]+'h')]
it=int(sys.argv[1]) if len(sys.argv)>1 else 4000
n=len(classes); E=[[0.5]*n for _ in range(n)]
t=time.time()
rngs={c:eval7.HandRange(c) for c in classes}
for x in range(n):
    h=rep(classes[x])
    for y in range(x,n):
        e=eval7.py_hand_vs_range_monte_carlo(h,rngs[classes[y]],[],it)
        E[x][y]=e; E[y][x]=1-e if x!=y else 0.5
    if x==0: print('row0',time.time()-t,flush=True)
json.dump({'classes':classes,'eq':[[round(v,4) for v in r] for r in E]},open('coach/eq169.json','w'))
print('done',time.time()-t)
