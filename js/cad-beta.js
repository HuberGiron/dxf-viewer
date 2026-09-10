const TAU = Math.PI * 2;
const EPS = 1e-8;
const SOLVE_TOL = 1e-4;

function clone(v){ return JSON.parse(JSON.stringify(v)); }
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function rad(d){ return d*Math.PI/180; }
function deg(r){ return r*180/Math.PI; }
function dist(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
function round2(v){ return Math.round((Number(v)+Number.EPSILON)*100)/100; }
function fmt(v){ return Number.isFinite(Number(v)) ? Number(v).toFixed(2) : "0.00"; }
function uid(prefix="E"){ return prefix + Math.random().toString(36).slice(2,8).toUpperCase(); }
function normalizeAngle(a){ let v=((a%360)+360)%360; return Math.abs(v-360)<EPS?0:v; }
function angleDelta(a,b){ let d=normalizeAngle(a-b); return Math.min(d,360-d); }
function lineLength(e){ return Math.hypot(e.x2-e.x1,e.y2-e.y1); }
function lineAngle(e){ return normalizeAngle(deg(Math.atan2(e.y2-e.y1,e.x2-e.x1))); }
function signedAngleBetweenVectors(a,b){
  return deg(Math.atan2(a.x*b.y-a.y*b.x,a.x*b.x+a.y*b.y));
}
function pointOnCircle(e,t){ return {x:e.cx+e.r*Math.cos(t),y:e.cy+e.r*Math.sin(t)}; }

function segmentNearestPoint(p,a,b){
  const vx=b.x-a.x,vy=b.y-a.y,d=vx*vx+vy*vy||1;
  const t=clamp(((p.x-a.x)*vx+(p.y-a.y)*vy)/d,0,1);
  return {x:a.x+vx*t,y:a.y+vy*t,t};
}
function distanceToSegment(p,a,b){ return dist(p,segmentNearestPoint(p,a,b)); }
function projectPointToInfiniteLine(p,a,b){
  const vx=b.x-a.x,vy=b.y-a.y,d=vx*vx+vy*vy;
  if(d<EPS)return{x:a.x,y:a.y,t:0};
  const t=((p.x-a.x)*vx+(p.y-a.y)*vy)/d;
  return{x:a.x+vx*t,y:a.y+vy*t,t};
}
function lineUnitNormal(e){
  const dx=e.x2-e.x1,dy=e.y2-e.y1,L=Math.hypot(dx,dy);
  if(L<EPS)return{x:0,y:1};
  return{x:-dy/L,y:dx/L};
}
function lineMidpoint(e){return{x:(e.x1+e.x2)/2,y:(e.y1+e.y2)/2};}
function signedPointLineDistance(p,e){
  const n=lineUnitNormal(e),a={x:e.x1,y:e.y1};
  return(p.x-a.x)*n.x+(p.y-a.y)*n.y;
}
function lineIntersection(a,b,c,d){
  const r={x:b.x-a.x,y:b.y-a.y},s={x:d.x-c.x,y:d.y-c.y};
  const den=r.x*s.y-r.y*s.x;
  if(Math.abs(den)<EPS)return null;
  const q={x:c.x-a.x,y:c.y-a.y};
  const t=(q.x*s.y-q.y*s.x)/den,u=(q.x*r.y-q.y*r.x)/den;
  if(t<-EPS||t>1+EPS||u<-EPS||u>1+EPS)return null;
  return {x:a.x+t*r.x,y:a.y+t*r.y,t,u};
}
function segmentCircleIntersections(a,b,c,r){
  const dx=b.x-a.x,dy=b.y-a.y,fx=a.x-c.x,fy=a.y-c.y;
  const A=dx*dx+dy*dy,B=2*(fx*dx+fy*dy),C=fx*fx+fy*fy-r*r,disc=B*B-4*A*C;
  if(disc<-EPS||A<EPS)return [];
  const s=Math.sqrt(Math.max(0,disc)),out=[];
  for(const t of [(-B-s)/(2*A),(-B+s)/(2*A)]){
    if(t>=-EPS&&t<=1+EPS)out.push({x:a.x+t*dx,y:a.y+t*dy,t});
  }
  return out;
}
function circleCircleIntersections(a,b){
  const dx=b.cx-a.cx,dy=b.cy-a.cy,d=Math.hypot(dx,dy);
  if(d<EPS||d>a.r+b.r+EPS||d<Math.abs(a.r-b.r)-EPS)return [];
  const x=(a.r*a.r-b.r*b.r+d*d)/(2*d),h2=a.r*a.r-x*x;
  if(h2<-EPS)return [];
  const h=Math.sqrt(Math.max(0,h2)),ux=dx/d,uy=dy/d,px=a.cx+x*ux,py=a.cy+x*uy;
  return [{x:px-h*uy,y:py+h*ux},{x:px+h*uy,y:py-h*ux}];
}
function angleOnArc(a,start,end){
  let x=normalizeAngle(a),s=normalizeAngle(start),e=normalizeAngle(end);
  if(e<s)e+=360;if(x<s)x+=360;
  return x>=s-EPS&&x<=e+EPS;
}

export function createCadEditor(opts={}){
  const canvas=opts.canvas,ctx=canvas.getContext("2d");
  const state={
    format:"ibero-cad",version:9,units:"mm",precision:2,origin:{x:0,y:0},
    entities:[],dimensions:[],constraints:[],selected:[],
    tool:"select",draft:null,hover:null,snap:null,activeDimension:null,selectedRef:null,pickSelection:[],drag:null,hoverHandle:null,
    view:{scale:4,panX:0,panY:0},panning:false,panStart:null,
    history:[],future:[],runtimeConflicts:new Set(),entityStates:new Map(),nextRuleOrder:1,rulesDirty:true,rulesDirtyFrom:1,
    projectionPreferredAxes:new Set(),
    grid:{baseStep:0.1},
    defaultViewInitialized:false,
    dimensionOption:null,
    dimensionPlacement:null,
    lastPointerWorld:{x:0,y:0},
    selectionBox:null,
    selectedRule:null,
  };
  // Rendimiento: los snaps arrancan desactivados. El usuario puede habilitar
  // sólo los que necesite desde el panel lateral.
  for(const control of Object.values(opts.snapControls||{})){
    if(control)control.checked=false;
  }

  const toolButtons=()=>[...document.querySelectorAll(".cad-tool, .cad-primary-tool")];
  const snapEnabled=name=>!!opts.snapControls?.[name]?.checked;
  const anySnapEnabled=()=>["endpoint","midpoint","center","intersection","grid"].some(snapEnabled);

  // Índice O(1) por id. Se reconstruye sólo si cambia el arreglo o su tamaño.
  let entityIndexSource=null,entityIndexSize=-1,entityIndex=new Map();
  function entity(id){
    if(entityIndexSource!==state.entities||entityIndexSize!==state.entities.length){
      entityIndexSource=state.entities;
      entityIndexSize=state.entities.length;
      entityIndex=new Map(state.entities.map(e=>[e.id,e]));
    }
    return entityIndex.get(id)||null;
  }
  function snapshot(){
    return clone({
      format:"ibero-cad",version:9,units:"mm",precision:2,origin:state.origin,
      entities:state.entities,dimensions:state.dimensions,constraints:state.constraints
    });
  }
  function restore(doc){
    const migrated=migrateDocument(doc);
    state.version=9;state.origin=migrated.origin||{x:0,y:0};
    state.entities=migrated.entities||[];state.dimensions=migrated.dimensions||[];state.constraints=migrated.constraints||[];
    normalizeRuleMetadata();state.rulesDirty=true;state.rulesDirtyFrom=1;
    state.selected=[];state.selectedRef=null;state.pickSelection=[];state.draft=null;state.activeDimension=null;state.drag=null;
    state.selectionBox=null;state.selectedRule=null;
    solveAndRefresh();
  }
  function commit(){
    state.history.push(snapshot());if(state.history.length>100)state.history.shift();state.future=[];
  }
  function mutate(fn,{solve=true,dirtyFrom=1}={}){
    commit();
    fn();
    if(solve){
      // Si fn() ya marcó una prioridad concreta, conservarla. Sólo usamos P1
      // como fallback para mutaciones geométricas que no identifican una regla.
      if(!state.rulesDirty)markRulesDirty(dirtyFrom);
      solveAndRefresh();
    }else refreshAll();
  }

  function setStatus(text){ if(opts.statusEl)opts.statusEl.textContent=text; }
  function setCursor(p){ if(opts.cursorEl)opts.cursorEl.textContent=`X ${fmt(p.x-state.origin.x)} · Y ${fmt(p.y-state.origin.y)}`; }

  function setDefault200View(){
    const r=canvas.getBoundingClientRect();
    const usable=Math.max(80,Math.min(r.width,r.height)-36);
    state.view.scale=clamp(usable/200,0.02,500);
    state.view.panX=0;state.view.panY=0;
    state.defaultViewInitialized=true;
  }
  function resize(){
    const r=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
    const w=Math.max(1,Math.round(r.width*dpr)),h=Math.max(1,Math.round(r.height*dpr));
    const changed=canvas.width!==w||canvas.height!==h;
    if(changed){canvas.width=w;canvas.height=h;}
    if(!state.defaultViewInitialized&&r.width>40&&r.height>40)setDefault200View();
    draw();
  }
  function screenToWorld(sx,sy){
    const dpr=window.devicePixelRatio||1,w=canvas.width/dpr,h=canvas.height/dpr;
    return {x:(sx-w/2-state.view.panX)/state.view.scale+state.origin.x,y:-(sy-h/2-state.view.panY)/state.view.scale+state.origin.y};
  }
  function worldToScreen(p){
    const dpr=window.devicePixelRatio||1,w=canvas.width/dpr,h=canvas.height/dpr;
    return {x:w/2+state.view.panX+(p.x-state.origin.x)*state.view.scale,y:h/2+state.view.panY-(p.y-state.origin.y)*state.view.scale};
  }
  function eventPoint(ev){const r=canvas.getBoundingClientRect();return{x:ev.clientX-r.left,y:ev.clientY-r.top};}
  function gridStep(){
    // Resolución lógica fija del croquis.
    return state.grid.baseStep;
  }
  function visibleGridStep(){
    // No intentar dibujar líneas a menos de ~8 px entre sí.
    // Se conservan siempre múltiplos exactos de la rejilla base 0.1 mm.
    const base=gridStep(),minPx=8;
    let step=base;
    const multipliers=[1,2,5,10];
    let decade=1;
    while(step*state.view.scale<minPx){
      let found=false;
      for(const m of multipliers){
        const candidate=base*m*decade;
        if(candidate*state.view.scale>=minPx){step=candidate;found=true;break;}
      }
      if(found)break;
      decade*=10;
      step=base*decade;
      if(decade>1e8)break;
    }
    return step;
  }

  function makeEndpointRef(entityId,point){return{kind:"endpoint",entity:entityId,point};}
  function makeCenterRef(entityId){return{kind:"center",entity:entityId};}
  function makePointRef(entityId){return{kind:"point",entity:entityId};}
  function makeLineRef(entityId){return{kind:"line",entity:entityId};}
  function isPointRef(ref){return !!ref&&["endpoint","point","center","origin"].includes(ref.kind);}
  function selectionItemKey(item){
    if(!item)return"";
    if(item.kind==="entity")return`entity:${item.entity}`;
    return refKey(item);
  }
  function selectionItemEntityId(item){return item?.entity||null;}
  function refKey(ref){
    if(!ref)return"";
    if(ref.kind==="endpoint")return`endpoint:${ref.entity}:${ref.point}`;
    if(ref.kind==="line")return`line:${ref.entity}`;
    return`${ref.kind}:${ref.entity||""}`;
  }
  // El grafo de anclajes depende de las reglas activas y de si una línea es
  // horizontal/vertical. Construirlo en cada consulta era uno de los puntos
  // más costosos del solver.
  let anchorGraphVersion=1;
  const anchorGraphCache={x:null,y:null};

  function lineAxisClass(e){
    if(!e||e.type!=="line")return"";
    const dx=e.x2-e.x1,dy=e.y2-e.y1;
    return`${Math.abs(dx)<1e-7?"V":""}${Math.abs(dy)<1e-7?"H":""}`;
  }
  function invalidateAnchorGraph(){
    anchorGraphVersion++;
    anchorGraphCache.x=null;
    anchorGraphCache.y=null;
  }
  function buildAxisAnchorGraph(axis){
    const graph=new Map(),refs=new Map();
    const addNode=r=>{
      if(!r)return;
      const k=refKey(r);
      if(!graph.has(k))graph.set(k,[]);
      if(!refs.has(k))refs.set(k,r);
    };
    const edge=(a,b,ruleId)=>{
      if(!a||!b)return;
      addNode(a);addNode(b);
      graph.get(refKey(a)).push({key:refKey(b),ruleId});
      graph.get(refKey(b)).push({key:refKey(a),ruleId});
    };

    addNode({kind:"origin"});

    for(const c of state.constraints){
      if(c.conflict||c.temporaryInactive)continue;
      if(c.type==="coincident"&&c.mode!=="point-line"){
        edge(c.a,c.b,c.id);
      }else if(c.type==="coincident"&&c.mode==="point-line"){
        const line=entity(c.line?.entity);
        if(line?.type==="line"){
          const cls=lineAxisClass(line);
          const vertical=cls.includes("V"),horizontal=cls.includes("H");
          if((axis==="x"&&vertical)||(axis==="y"&&horizontal)){
            edge(c.point,makeEndpointRef(line.id,"start"),c.id);
            edge(c.point,makeEndpointRef(line.id,"end"),c.id);
          }
        }
      }else if(c.type==="horizontal"&&axis==="y"){
        const e=entity(c.entities?.[0]);
        if(e)edge(makeEndpointRef(e.id,"start"),makeEndpointRef(e.id,"end"),c.id);
      }else if(c.type==="vertical"&&axis==="x"){
        const e=entity(c.entities?.[0]);
        if(e)edge(makeEndpointRef(e.id,"start"),makeEndpointRef(e.id,"end"),c.id);
      }
    }

    for(const d of state.dimensions){
      if(d.conflict||d.temporaryInactive||d.rejected||d.type!=="length")continue;
      const e=entity(d.entity);if(!e||e.type!=="line")continue;
      const cls=lineAxisClass(e);
      const horizontal=cls.includes("H"),vertical=cls.includes("V");
      if((axis==="x"&&horizontal)||(axis==="y"&&vertical)){
        edge(makeEndpointRef(e.id,"start"),makeEndpointRef(e.id,"end"),d.id);
      }
    }

    return{version:anchorGraphVersion,graph,refs};
  }
  function axisAnchorGraph(axis){
    const cached=anchorGraphCache[axis];
    if(cached&&cached.version===anchorGraphVersion)return cached;
    const built=buildAxisAnchorGraph(axis);
    anchorGraphCache[axis]=built;
    return built;
  }

  function preferredAxisKey(ref,axis){return`${refKey(ref)}|${axis}`;}
  function markPreferredAxis(ref,axis){
    if(ref&&axis)state.projectionPreferredAxes.add(preferredAxisKey(ref,axis));
  }
  function axisPreferred(ref,axis){
    return !!ref&&state.projectionPreferredAxes.has(preferredAxisKey(ref,axis));
  }
  function directAxisAnchor(ref,axis){
    if(!ref)return false;
    if(ref.kind==="origin")return true;
    const e=entity(ref.entity);if(!e)return false;
    if(state.constraints.some(c=>!c.conflict&&!c.temporaryInactive&&c.type==="fixed"&&refKey(c.ref)===refKey(ref)))return true;
    if(ref.kind==="endpoint")return !!drivingDimBy(e.id,axis==="x"?"endpointX":"endpointY",ref.point);
    if(ref.kind==="center")return !!drivingDimBy(e.id,axis==="x"?"centerX":"centerY");
    if(ref.kind==="point")return !!drivingDimBy(e.id,axis==="x"?"pointX":"pointY");
    return false;
  }
  function axisConstraintAnchorScore(ref,axis,excludeRuleId=null){
    if(!ref)return 0;
    const start=refKey(ref);
    const {graph,refs}=axisAnchorGraph(axis);
    const queue=[[start,0]],seen=new Set([start]);

    while(queue.length){
      const [k,depth]=queue.shift();
      // La referencia consultada puede no formar parte de ninguna arista.
      const r=k===start?ref:refs.get(k);
      if(r&&directAxisAnchor(r,axis))return Math.max(1,100-depth);

      for(const edge of graph.get(k)||[]){
        if(edge.ruleId===excludeRuleId)continue;
        if(!seen.has(edge.key)){
          seen.add(edge.key);
          queue.push([edge.key,depth+1]);
        }
      }
    }
    return 0;
  }
  function chooseCoincidentAxisMaster(a,b,axis,c){
    const as=axisConstraintAnchorScore(a,axis,c?.id),bs=axisConstraintAnchorScore(b,axis,c?.id);
    if(as>bs)return"a";
    if(bs>as)return"b";

    const ap=axisPreferred(a,axis),bp=axisPreferred(b,axis);
    if(ap&&!bp)return"a";
    if(bp&&!ap)return"b";

    return c?.master==="b"?"b":"a";
  }
  function propagateAxis(from,to,axis){
    const p=getRefPoint(from),q=getRefPoint(to);if(!p||!q)return;
    setRefPoint(to,{...q,[axis]:p[axis]},axis);
    if(axisPreferred(from,axis)||axisConstraintAnchorScore(from,axis)>0)markPreferredAxis(to,axis);
  }

  function getRefPoint(ref){
    if(!ref)return null;
    if(ref.kind==="origin")return{x:state.origin.x,y:state.origin.y};
    const e=entity(ref.entity);if(!e)return null;
    if(ref.kind==="endpoint"&&e.type==="line")return ref.point==="start"?{x:e.x1,y:e.y1}:{x:e.x2,y:e.y2};
    if(ref.kind==="center"&&(e.type==="circle"||e.type==="arc"))return{x:e.cx,y:e.cy};
    if(ref.kind==="point"&&e.type==="point")return{x:e.x,y:e.y};
    return null;
  }
  function setRefPoint(ref,p,axis=null){
    const e=entity(ref?.entity);if(!e)return;
    const beforeClass=e.type==="line"?lineAxisClass(e):null;
    if(ref.kind==="endpoint"&&e.type==="line"){
      const xk=ref.point==="start"?"x1":"x2",yk=ref.point==="start"?"y1":"y2";
      if(axis===null||axis==="x")e[xk]=p.x;if(axis===null||axis==="y")e[yk]=p.y;
    }else if(ref.kind==="center"&&(e.type==="circle"||e.type==="arc")){
      if(axis===null||axis==="x")e.cx=p.x;if(axis===null||axis==="y")e.cy=p.y;
    }else if(ref.kind==="point"&&e.type==="point"){
      if(axis===null||axis==="x")e.x=p.x;if(axis===null||axis==="y")e.y=p.y;
    }
    if(beforeClass!==null&&beforeClass!==lineAxisClass(e))invalidateAnchorGraph();
  }
  function lineRefs(e){return[makeEndpointRef(e.id,"start"),makeEndpointRef(e.id,"end")];}
  function connectedLineJoint(a,b){
    if(!a||!b||a.type!=="line"||b.type!=="line")return null;
    const ar=lineRefs(a),br=lineRefs(b);
    let best=null,bd=Infinity;
    for(const ra of ar)for(const rb of br){
      const pa=getRefPoint(ra),pb=getRefPoint(rb);
      const d=pa&&pb?dist(pa,pb):Infinity;
      const linked=state.constraints.some(c=>!c.conflict&&c.type==="coincident"&&(
        (refKey(c.a)===refKey(ra)&&refKey(c.b)===refKey(rb))||
        (refKey(c.a)===refKey(rb)&&refKey(c.b)===refKey(ra))
      ));
      if((linked||d<1e-4)&&d<bd){best={aRef:ra,bRef:rb,p:pa||pb};bd=d;}
    }
    return best;
  }
  function otherEndpoint(e,ref){
    return getRefPoint(makeEndpointRef(e.id,ref.point==="start"?"end":"start"));
  }
  function angleBetweenConnectedLines(a,b){
    const j=connectedLineJoint(a,b);if(!j)return null;
    const joint=getRefPoint(j.aRef)||getRefPoint(j.bRef);
    const oa=otherEndpoint(a,j.aRef),ob=otherEndpoint(b,j.bRef);
    if(!joint||!oa||!ob)return null;
    const va={x:oa.x-joint.x,y:oa.y-joint.y},vb={x:ob.x-joint.x,y:ob.y-joint.y};
    let signed=signedAngleBetweenVectors(va,vb);
    let value=Math.abs(signed);
    if(value>180)value=360-value;
    return {joint,aRef:j.aRef,bRef:j.bRef,sign:signed<0?-1:1,value};
  }
  function setAngleBetweenDimension(d){
    const a=entity(d.entities?.[0]),b=entity(d.entities?.[1]);
    if(!a||!b||a.type!=="line"||b.type!=="line")return;
    const info=angleBetweenConnectedLines(a,b);if(!info)return;
    const joint=getRefPoint(info.aRef)||getRefPoint(info.bRef);
    const oa=otherEndpoint(a,info.aRef);
    if(!joint||!oa)return;
    const base=Math.atan2(oa.y-joint.y,oa.x-joint.x);
    const target=base+rad((d.sign||1)*Number(d.value||0));
    const L=lineLength(b), otherRef=makeEndpointRef(b.id,info.bRef.point==="start"?"end":"start");
    const p={x:joint.x+L*Math.cos(target),y:joint.y+L*Math.sin(target)};
    setRefPoint(info.bRef,joint);
    setRefPoint(otherRef,p);
  }

  function entityBBox(e){
    if(e.type==="line")return{minX:Math.min(e.x1,e.x2),minY:Math.min(e.y1,e.y2),maxX:Math.max(e.x1,e.x2),maxY:Math.max(e.y1,e.y2)};
    if(e.type==="circle")return{minX:e.cx-e.r,minY:e.cy-e.r,maxX:e.cx+e.r,maxY:e.cy+e.r};
    if(e.type==="arc"){
      const pts=[pointOnCircle(e,rad(e.start)),pointOnCircle(e,rad(e.end))];
      for(const a of[0,90,180,270])if(angleOnArc(a,e.start,e.end))pts.push(pointOnCircle(e,rad(a)));
      return{minX:Math.min(...pts.map(p=>p.x)),minY:Math.min(...pts.map(p=>p.y)),maxX:Math.max(...pts.map(p=>p.x)),maxY:Math.max(...pts.map(p=>p.y))};
    }
    if(e.type==="point")return{minX:e.x,minY:e.y,maxX:e.x,maxY:e.y};
    return null;
  }
  function entitySegments(e){
    if(e.type==="line")return[[{x:e.x1,y:e.y1},{x:e.x2,y:e.y2}]];
    return[];
  }

  function allRulesOrdered(){
    return [
      ...state.constraints.map(rule=>({kind:"constraint",rule})),
      ...state.dimensions.map(rule=>({kind:"dimension",rule}))
    ].sort((a,b)=>(Number(a.rule.order)||Number.MAX_SAFE_INTEGER)-(Number(b.rule.order)||Number.MAX_SAFE_INTEGER));
  }
  function normalizeRuleMetadata(){
    let max=0;
    const existing=[...state.constraints,...state.dimensions];
    for(const r of existing){
      const n=Number(r.order);
      if(Number.isFinite(n)&&n>0)max=Math.max(max,n);
      // Mantener el valor sólo como información serializada hasta que solve()
      // lo recalcule; nunca usarlo para impedir una nueva evaluación.
      if(r.rejected===undefined)r.rejected=!!r.conflict;
      r.temporaryInactive=false;
    }
    // En archivos anteriores no existía un orden global. Se conserva el orden de almacenamiento
    // de forma determinista y, desde v4, todo nuevo elemento recibe un orden global persistente.
    for(const r of existing){
      if(!Number.isFinite(Number(r.order))||Number(r.order)<=0)r.order=++max;
    }
    state.nextRuleOrder=max+1;
  }
  function stampRule(rule){
    if(!Number.isFinite(Number(rule.order))||Number(rule.order)<=0)rule.order=state.nextRuleOrder++;
    if(rule.rejected===undefined)rule.rejected=!!rule.conflict;
    rule.conflict=!!rule.rejected;
    return rule;
  }
  function markRulesDirty(order=1){
    const n=Number(order);
    const from=Number.isFinite(n)&&n>0?n:1;
    if(!state.rulesDirty)state.rulesDirtyFrom=from;
    else state.rulesDirtyFrom=Math.min(Number(state.rulesDirtyFrom)||from,from);
    state.rulesDirty=true;
  }
  function addDimensionObject(d){
    d.id=d.id||uid("D");stampRule(d);state.dimensions.push(d);markRulesDirty(d.order);return d;
  }

  function dimensionsForEntity(id){return state.dimensions.filter(d=>d.entity===id||(d.entities||[]).includes(id)||d.a?.entity===id||d.b?.entity===id||d.point?.entity===id||d.line?.entity===id||d.lineA===id||d.lineB===id);}
  function constraintsForEntity(id){return state.constraints.filter(c=>(c.entities||[]).includes(id)||c.ref?.entity===id||c.a?.entity===id||c.b?.entity===id||c.point?.entity===id||c.line?.entity===id);}
  function dimBy(entityId,type,point=null){
    return state.dimensions.find(d=>d.entity===entityId&&d.type===type&&(point===null||d.point===point))||null;
  }
  function drivingDimBy(entityId,type,point=null){
    const d=dimBy(entityId,type,point);
    return d && !d.conflict ? d : null;
  }
  function constraintBy(type,entityId){
    return state.constraints.find(c=>!c.conflict&&c.type===type&&(c.entities||[]).includes(entityId))||null;
  }
  function isRefAxisDriven(ref,axis){
    const e=entity(ref?.entity);if(!e)return false;
    if(state.constraints.some(c=>!c.conflict&&c.type==="fixed"&&refKey(c.ref)===refKey(ref)))return true;
    if(ref.kind==="endpoint"){
      return !!drivingDimBy(e.id,axis==="x"?"endpointX":"endpointY",ref.point);
    }
    if(ref.kind==="center"){
      return !!drivingDimBy(e.id,axis==="x"?"centerX":"centerY");
    }
    if(ref.kind==="point"){
      return !!drivingDimBy(e.id,axis==="x"?"pointX":"pointY");
    }
    return false;
  }
  function refLockScore(ref){return Number(isRefAxisDriven(ref,"x"))+Number(isRefAxisDriven(ref,"y"));}
  function chooseMovableRef(a,b,axis=null,excludeRuleId=null){
    const score=r=>{
      if(axis)return axisConstraintAnchorScore(r,axis,excludeRuleId);
      return axisConstraintAnchorScore(r,"x",excludeRuleId)+axisConstraintAnchorScore(r,"y",excludeRuleId);
    };
    const sa=score(a),sb=score(b);
    if(sa!==sb)return sa<sb?a:b;
    const da=refLockScore(a),db=refLockScore(b);
    return da<=db?a:b;
  }

  function setLineLength(e,value,driverRuleId=null){
    const beforeClass=lineAxisClass(e);
    const refs=lineRefs(e),angDeg=lineAngle(e);
    const horiz=Math.min(angleDelta(angDeg,0),angleDelta(angDeg,180))<1e-3;
    const vert=Math.min(angleDelta(angDeg,90),angleDelta(angDeg,270))<1e-3;
    const axis=horiz?"x":vert?"y":null;
    const move=chooseMovableRef(refs[1],refs[0],axis,driverRuleId),before=getRefPoint(move);
    const L=Math.max(0,Number(value)||0),ang=rad(angDeg);
    if(move.point==="end"){e.x2=e.x1+L*Math.cos(ang);e.y2=e.y1+L*Math.sin(ang);}
    else{e.x1=e.x2-L*Math.cos(ang);e.y1=e.y2-L*Math.sin(ang);}
    if(beforeClass!==lineAxisClass(e))invalidateAnchorGraph();
    const after=getRefPoint(move);
    if(before&&after){
      if(Math.abs(after.x-before.x)>EPS)markPreferredAxis(move,"x");
      if(Math.abs(after.y-before.y)>EPS)markPreferredAxis(move,"y");
    }
  }
  function setLineAngle(e,value){
    const beforeClass=lineAxisClass(e);
    const refs=lineRefs(e),move=chooseMovableRef(refs[1],refs[0]),before=getRefPoint(move),L=lineLength(e),a=rad(Number(value)||0);
    if(move.point==="end"){e.x2=e.x1+L*Math.cos(a);e.y2=e.y1+L*Math.sin(a);}
    else{e.x1=e.x2-L*Math.cos(a);e.y1=e.y2-L*Math.sin(a);}
    if(beforeClass!==lineAxisClass(e))invalidateAnchorGraph();
    const after=getRefPoint(move);
    if(before&&after){
      if(Math.abs(after.x-before.x)>EPS)markPreferredAxis(move,"x");
      if(Math.abs(after.y-before.y)>EPS)markPreferredAxis(move,"y");
    }
  }

  function applyAbsoluteDrivers(){
    for(const d of state.dimensions){
      if(d.conflict)continue;
      const e=entity(d.entity);if(!e)continue;
      if(e.type==="line"){
        if(d.type==="endpointX"){const ref=makeEndpointRef(e.id,d.point);setRefPoint(ref,{...getRefPoint(ref),x:Number(d.value)}, "x");markPreferredAxis(ref,"x");}
        else if(d.type==="endpointY"){const ref=makeEndpointRef(e.id,d.point);setRefPoint(ref,{...getRefPoint(ref),y:Number(d.value)}, "y");markPreferredAxis(ref,"y");}
      }else if(e.type==="circle"){
        if(d.type==="centerX"){e.cx=Number(d.value);markPreferredAxis(makeCenterRef(e.id),"x");}
        else if(d.type==="centerY"){e.cy=Number(d.value);markPreferredAxis(makeCenterRef(e.id),"y");}
        else if(d.type==="diameter")e.r=Math.max(0,Number(d.value)/2);
      }else if(e.type==="point"){
        if(d.type==="pointX"){e.x=Number(d.value);markPreferredAxis(makePointRef(e.id),"x");}
        else if(d.type==="pointY"){e.y=Number(d.value);markPreferredAxis(makePointRef(e.id),"y");}
      }
    }
    for(const c of state.constraints){
      if(c.conflict||c.type!=="fixed")continue;
      setRefPoint(c.ref,{x:Number(c.x),y:Number(c.y)});
      markPreferredAxis(c.ref,"x");markPreferredAxis(c.ref,"y");
    }
  }
  function pointLineNormalAxis(line){
    if(!line||line.type!=="line")return null;
    const dx=line.x2-line.x1,dy=line.y2-line.y1;
    if(Math.abs(dx)<1e-7)return"x";
    if(Math.abs(dy)<1e-7)return"y";
    return null;
  }
  function lineAxisAnchorScore(line,axis,excludeConstraintId=null){
    if(!line||line.type!=="line"||!axis)return 0;
    return Math.max(
      axisConstraintAnchorScore(makeEndpointRef(line.id,"start"),axis,excludeConstraintId),
      axisConstraintAnchorScore(makeEndpointRef(line.id,"end"),axis,excludeConstraintId)
    );
  }

  function applyCoincident(){
    for(const c of state.constraints){
      if(c.conflict||c.type!=="coincident")continue;
      if(c.mode==="point-line"){
        const pref=c.point,line=entity(c.line?.entity);
        const p=getRefPoint(pref);
        if(!p||!line||line.type!=="line")continue;
        const a={x:line.x1,y:line.y1},b={x:line.x2,y:line.y2};
        const q=segmentNearestPoint(p,a,b);
        const normalAxis=pointLineNormalAxis(line);

        if(normalAxis){
          const pointScore=axisConstraintAnchorScore(pref,normalAxis,c.id);
          const targetScore=lineAxisAnchorScore(line,normalAxis,c.id);

          if(pointScore>targetScore&&entityState(line.id)!=="full"){
            // El punto está más anclado: desplazar la línea en su eje normal.
            const delta=p[normalAxis]-q[normalAxis];
            if(normalAxis==="x")translateLine(line,delta,0);
            else translateLine(line,0,delta);
          }else{
            // La línea está más anclada: sólo corregir el eje normal del punto.
            const target={...p,[normalAxis]:q[normalAxis]};
            setRefPoint(pref,target,normalAxis);
            if(targetScore>0)markPreferredAxis(pref,normalAxis);
          }
        }else{
          // Caso general inclinado: conservar el comportamiento geométrico anterior.
          const lockedX=isRefAxisDriven(pref,"x"),lockedY=isRefAxisDriven(pref,"y");
          if(lockedX&&lockedY){
            const dx=p.x-q.x,dy=p.y-q.y;
            if(entityState(line.id)!=="full")translateLine(line,dx,dy);
          }else{
            const target={x:lockedX?p.x:q.x,y:lockedY?p.y:q.y};
            setRefPoint(pref,target);
          }
        }
        continue;
      }
      const a=c.a,b=c.b;
      if(!getRefPoint(a)||!getRefPoint(b))continue;
      for(const axis of["x","y"]){
        const chosen=chooseCoincidentAxisMaster(a,b,axis,c);
        const master=chosen==="a"?a:b,slave=chosen==="a"?b:a;
        const masterScore=axisConstraintAnchorScore(master,axis,c.id);
        const slaveScore=axisConstraintAnchorScore(slave,axis,c.id);
        if(slaveScore>masterScore)continue;
        propagateAxis(master,slave,axis);
      }
    }
  }

  function distancePPValue(d){
    const a=getRefPoint(d.a),b=getRefPoint(d.b);
    return a&&b?dist(a,b):Infinity;
  }
  function distancePLValue(d){
    const p=getRefPoint(d.point),line=entity(d.line?.entity);
    if(!p||!line||line.type!=="line")return Infinity;
    return Math.abs(signedPointLineDistance(p,line));
  }
  function distanceLLValue(d){
    const a=entity(d.lineA),b=entity(d.lineB);
    if(!a||!b||a.type!=="line"||b.type!=="line")return Infinity;
    return Math.abs(signedPointLineDistance(lineMidpoint(b),a));
  }
  function computeKnownAxesExcludingDimension(excludeDimensionId=null){
    const known=new Map();
    const key=ref=>refKey(ref);
    const ensure=ref=>{
      const k=key(ref);
      if(!known.has(k))known.set(k,new Set());
      return known.get(k);
    };
    const mark=(ref,axis)=>{
      if(!ref)return false;
      const set=ensure(ref),before=set.size;
      set.add(axis);
      return set.size!==before;
    };
    const has=(ref,axis)=>!!ref&&known.get(key(ref))?.has(axis);
    const fullRef=ref=>has(ref,"x")&&has(ref,"y");

    mark({kind:"origin"},"x");mark({kind:"origin"},"y");

    const activeConstraints=state.constraints.filter(c=>!c.conflict&&!c.rejected&&!c.temporaryInactive&&!state.runtimeConflicts.has(c.id));
    const activeDimensions=state.dimensions.filter(d=>d.id!==excludeDimensionId&&!d.conflict&&!d.rejected&&!d.temporaryInactive&&!state.runtimeConflicts.has(d.id));

    for(const c of activeConstraints){
      if(c.type==="fixed"){mark(c.ref,"x");mark(c.ref,"y");}
    }
    for(const d of activeDimensions){
      const e=entity(d.entity);
      if(e?.type==="line"){
        const ref=makeEndpointRef(e.id,d.point);
        if(d.type==="endpointX")mark(ref,"x");
        if(d.type==="endpointY")mark(ref,"y");
      }else if(e?.type==="circle"){
        const ref=makeCenterRef(e.id);
        if(d.type==="centerX")mark(ref,"x");
        if(d.type==="centerY")mark(ref,"y");
      }else if(e?.type==="point"){
        const ref=makePointRef(e.id);
        if(d.type==="pointX")mark(ref,"x");
        if(d.type==="pointY")mark(ref,"y");
      }
    }

    const lineConstraint=(id,type)=>activeConstraints.some(c=>c.type===type&&c.entities?.[0]===id);
    const lineLengthDim=id=>activeDimensions.find(d=>d.type==="length"&&d.entity===id);
    const lineAngleDim=id=>activeDimensions.find(d=>d.type==="angle"&&d.entity===id);

    let changed=true,guard=0;
    while(changed&&guard++<100){
      changed=false;

      for(const c of activeConstraints){
        if(c.type!=="coincident"||c.mode==="point-line")continue;
        const a=c.a,b=c.b;if(!a||!b)continue;
        for(const axis of["x","y"]){
          if(has(a,axis))changed=mark(b,axis)||changed;
          if(has(b,axis))changed=mark(a,axis)||changed;
        }
      }

      for(const e of state.entities){
        if(e.type!=="line")continue;
        const a=makeEndpointRef(e.id,"start"),b=makeEndpointRef(e.id,"end");
        if(lineConstraint(e.id,"horizontal")){
          if(has(a,"y"))changed=mark(b,"y")||changed;
          if(has(b,"y"))changed=mark(a,"y")||changed;
        }
        if(lineConstraint(e.id,"vertical")){
          if(has(a,"x"))changed=mark(b,"x")||changed;
          if(has(b,"x"))changed=mark(a,"x")||changed;
        }
      }

      for(const e of state.entities){
        if(e.type!=="line"||!lineLengthDim(e.id))continue;
        const a=makeEndpointRef(e.id,"start"),b=makeEndpointRef(e.id,"end");
        if(lineConstraint(e.id,"horizontal")){
          if(has(a,"x"))changed=mark(b,"x")||changed;
          if(has(b,"x"))changed=mark(a,"x")||changed;
        }else if(lineConstraint(e.id,"vertical")){
          if(has(a,"y"))changed=mark(b,"y")||changed;
          if(has(b,"y"))changed=mark(a,"y")||changed;
        }else if(lineAngleDim(e.id)){
          if(fullRef(a)){changed=mark(b,"x")||changed;changed=mark(b,"y")||changed;}
          if(fullRef(b)){changed=mark(a,"x")||changed;changed=mark(a,"y")||changed;}
        }
      }

      for(const c of activeConstraints){
        if(c.type!=="coincident"||c.mode!=="point-line")continue;
        const p=c.point,line=entity(c.line?.entity);
        if(!p||!line||line.type!=="line")continue;
        const a=makeEndpointRef(line.id,"start"),b=makeEndpointRef(line.id,"end");
        if(lineConstraint(line.id,"vertical")&&has(a,"x")&&has(b,"x"))changed=mark(p,"x")||changed;
        if(lineConstraint(line.id,"horizontal")&&has(a,"y")&&has(b,"y"))changed=mark(p,"y")||changed;
      }

      for(const d of activeDimensions){
        if(d.type==="distanceLL"){
          const la=entity(d.lineA),lb=entity(d.lineB);
          if(!la||!lb||la.type!=="line"||lb.type!=="line")continue;
          const a1=makeEndpointRef(la.id,"start"),a2=makeEndpointRef(la.id,"end");
          const b1=makeEndpointRef(lb.id,"start"),b2=makeEndpointRef(lb.id,"end");
          if(lineConstraint(la.id,"horizontal")&&lineConstraint(lb.id,"horizontal")){
            const ak=has(a1,"y")&&has(a2,"y"),bk=has(b1,"y")&&has(b2,"y");
            if(ak){changed=mark(b1,"y")||changed;changed=mark(b2,"y")||changed;}
            if(bk){changed=mark(a1,"y")||changed;changed=mark(a2,"y")||changed;}
          }
          if(lineConstraint(la.id,"vertical")&&lineConstraint(lb.id,"vertical")){
            const ak=has(a1,"x")&&has(a2,"x"),bk=has(b1,"x")&&has(b2,"x");
            if(ak){changed=mark(b1,"x")||changed;changed=mark(b2,"x")||changed;}
            if(bk){changed=mark(a1,"x")||changed;changed=mark(a2,"x")||changed;}
          }
        }else if(d.type==="distancePL"){
          const pref=d.point,line=entity(d.line?.entity);
          if(!pref||!line||line.type!=="line")continue;
          const a=makeEndpointRef(line.id,"start"),b=makeEndpointRef(line.id,"end");
          if(lineConstraint(line.id,"horizontal")){
            if(has(a,"y")&&has(b,"y"))changed=mark(pref,"y")||changed;
            if(has(pref,"y")){changed=mark(a,"y")||changed;changed=mark(b,"y")||changed;}
          }
          if(lineConstraint(line.id,"vertical")){
            if(has(a,"x")&&has(b,"x"))changed=mark(pref,"x")||changed;
            if(has(pref,"x")){changed=mark(a,"x")||changed;changed=mark(b,"x")||changed;}
          }
        }else if(d.type==="distancePP"){
          const a=d.a,b=d.b;if(!a||!b)continue;
          if(fullRef(a)){
            if(has(b,"x")&&!has(b,"y"))changed=mark(b,"y")||changed;
            if(has(b,"y")&&!has(b,"x"))changed=mark(b,"x")||changed;
          }
          if(fullRef(b)){
            if(has(a,"x")&&!has(a,"y"))changed=mark(a,"y")||changed;
            if(has(a,"y")&&!has(a,"x"))changed=mark(a,"x")||changed;
          }
        }
      }
    }
    return{has,fullRef};
  }
  function lineAxisKnownByOlderRules(e,axis,excludeDimensionId){
    if(!e||e.type!=="line")return false;
    const k=computeKnownAxesExcludingDimension(excludeDimensionId);
    return k.has(makeEndpointRef(e.id,"start"),axis)&&k.has(makeEndpointRef(e.id,"end"),axis);
  }
  function lineNormalAxis(e){
    if(!e||e.type!=="line")return null;
    const dx=e.x2-e.x1,dy=e.y2-e.y1;
    if(Math.abs(dy)<1e-7)return"y";
    if(Math.abs(dx)<1e-7)return"x";
    return null;
  }

  function lineMoveScore(e){
    if(!e||e.type!=="line")return 99;
    return refLockScore(makeEndpointRef(e.id,"start"))+refLockScore(makeEndpointRef(e.id,"end"))+(entityState(e.id)==="full"?10:0);
  }
  function translateLine(e,dx,dy){
    e.x1+=dx;e.y1+=dy;e.x2+=dx;e.y2+=dy;
    const a=makeEndpointRef(e.id,"start"),b=makeEndpointRef(e.id,"end");
    if(Math.abs(dx)>EPS){markPreferredAxis(a,"x");markPreferredAxis(b,"x");}
    if(Math.abs(dy)>EPS){markPreferredAxis(a,"y");markPreferredAxis(b,"y");}
  }
  function applyDistanceDrivers(){
    for(const d of state.dimensions){
      if(d.conflict)continue;
      const target=Math.max(0,Number(d.value)||0);
      if(d.type==="distancePP"){
        const a=getRefPoint(d.a),b=getRefPoint(d.b);if(!a||!b)continue;
        let vx=b.x-a.x,vy=b.y-a.y,L=Math.hypot(vx,vy);
        if(L<EPS){vx=1;vy=0;L=1;}
        const ux=vx/L,uy=vy/L;
        const move=chooseMovableRef(d.b,d.a);
        if(refKey(move)===refKey(d.b)){
          setRefPoint(d.b,{x:a.x+ux*target,y:a.y+uy*target});
          markPreferredAxis(d.b,"x");markPreferredAxis(d.b,"y");
        }else{
          setRefPoint(d.a,{x:b.x-ux*target,y:b.y-uy*target});
          markPreferredAxis(d.a,"x");markPreferredAxis(d.a,"y");
        }
      }else if(d.type==="distancePL"){
        const p=getRefPoint(d.point),line=entity(d.line?.entity);if(!p||!line||line.type!=="line")continue;
        const n=lineUnitNormal(line),signed=signedPointLineDistance(p,line),want=(d.sign||1)*target;
        const axis=lineNormalAxis(line);

        if(axis){
          const known=computeKnownAxesExcludingDimension(d.id);
          const pointKnown=known.has(d.point,axis);
          const lineKnown=known.has(makeEndpointRef(line.id,"start"),axis)&&known.has(makeEndpointRef(line.id,"end"),axis);

          if(lineKnown&&!pointKnown){
            const delta=want-signed;
            setRefPoint(d.point,{x:p.x+n.x*delta,y:p.y+n.y*delta});
            markPreferredAxis(d.point,axis);
          }else if(pointKnown&&!lineKnown){
            const delta=signed-want;
            translateLine(line,n.x*delta,n.y*delta);
          }else if(!pointKnown&&!lineKnown){
            const delta=want-signed;
            setRefPoint(d.point,{x:p.x+n.x*delta,y:p.y+n.y*delta});
            markPreferredAxis(d.point,axis);
          }
        }else{
          const pointLocked=refLockScore(d.point)>=2;
          if(!pointLocked){
            const delta=want-signed;
            setRefPoint(d.point,{x:p.x+n.x*delta,y:p.y+n.y*delta});
            markPreferredAxis(d.point,"x");markPreferredAxis(d.point,"y");
          }else{
            const delta=signed-want;
            translateLine(line,n.x*delta,n.y*delta);
          }
        }
      }else if(d.type==="distanceLL"){
        const a=entity(d.lineA),b=entity(d.lineB);if(!a||!b||a.type!=="line"||b.type!=="line")continue;
        const n=lineUnitNormal(a),signed=signedPointLineDistance(lineMidpoint(b),a),want=(d.sign||1)*target;
        const axis=lineNormalAxis(a);

        if(axis){
          // Decidir movilidad usando ÚNICAMENTE las reglas anteriores a esta cota.
          // Nunca usar entityState(), porque ese estado ya incluye a la propia
          // distanceLL y produciría el ciclo "la cota me fija -> entonces no me muevo".
          const aKnown=lineAxisKnownByOlderRules(a,axis,d.id);
          const bKnown=lineAxisKnownByOlderRules(b,axis,d.id);

          if(bKnown&&!aKnown){
            const delta=signed-want;
            translateLine(a,n.x*delta,n.y*delta);
          }else if(aKnown&&!bKnown){
            const delta=want-signed;
            translateLine(b,n.x*delta,n.y*delta);
          }else if(!aKnown&&!bKnown){
            // Ninguna referencia está anclada por reglas anteriores:
            // mantener el criterio de menor anclaje, pero sin bloquear por "full".
            if(lineMoveScore(b)<=lineMoveScore(a)){
              const delta=want-signed;translateLine(b,n.x*delta,n.y*delta);
            }else{
              const delta=signed-want;translateLine(a,n.x*delta,n.y*delta);
            }
          }
          // Si ambas están determinadas por reglas anteriores, no se mueve ninguna;
          // ruleResidual() decidirá correctamente si existe un conflicto real.
        }else{
          // Líneas inclinadas: fallback geométrico actual.
          if(lineMoveScore(b)<=lineMoveScore(a)){
            const delta=want-signed;translateLine(b,n.x*delta,n.y*delta);
          }else{
            const delta=signed-want;translateLine(a,n.x*delta,n.y*delta);
          }
        }
      }
    }
  }

  function applyOrientationConstraints(){
    for(const c of state.constraints){
      if(c.conflict)continue;
      if(c.type==="horizontal"||c.type==="vertical"){
        const e=entity(c.entities?.[0]);if(!e||e.type!=="line")continue;
        const a=makeEndpointRef(e.id,"start"),b=makeEndpointRef(e.id,"end");
        const axis=c.type==="horizontal"?"y":"x";
        const as=axisConstraintAnchorScore(a,axis,c.id),bs=axisConstraintAnchorScore(b,axis,c.id);
        const ap=axisPreferred(a,axis),bp=axisPreferred(b,axis);

        let master=a,slave=b;
        if(bs>as){master=b;slave=a;}
        else if(as===bs&&bp&&!ap){master=b;slave=a;}
        else if(as===bs&&!ap&&!bp){
          const move=chooseMovableRef(b,a,axis);
          master=move.point==="end"?a:b;
          slave=move.point==="end"?b:a;
        }

        const masterScore=axisConstraintAnchorScore(master,axis,c.id);
        const slaveScore=axisConstraintAnchorScore(slave,axis,c.id);
        if(slaveScore<=masterScore)propagateAxis(master,slave,axis);
      }else if(c.type==="parallel"||c.type==="perpendicular"){
        const master=entity(c.entities?.[0]),slave=entity(c.entities?.[1]);
        if(!master||!slave||master.type!=="line"||slave.type!=="line")continue;
        const target=lineAngle(master)+(c.type==="perpendicular"?90:0);
        if(!drivingDimBy(slave.id,"angle"))setLineAngle(slave,target);
      }
    }
  }
  function applyEqualLengths(){
    for(const c of state.constraints){
      if(c.conflict||c.type!=="equalLength")continue;
      const master=entity(c.entities?.[0]),slave=entity(c.entities?.[1]);
      if(!master||!slave||master.type!=="line"||slave.type!=="line")continue;
      if(!drivingDimBy(slave.id,"length"))setLineLength(slave,lineLength(master));
    }
  }
  function applySizeDrivers(){
    for(const d of state.dimensions){
      if(d.conflict)continue;
      if(d.type==="angleBetween"){setAngleBetweenDimension(d);continue;}
      const e=entity(d.entity);if(!e)continue;
      if(e.type==="line"){
        if(d.type==="angle")setLineAngle(e,Number(d.value)); // compatibilidad JSON anterior
        if(d.type==="length")setLineLength(e,Number(d.value),d.id);
      }
    }
  }

  function constraintResidual(c){
    if(c.conflict)return Infinity;
    if(c.type==="fixed"){
      const p=getRefPoint(c.ref);return p?dist(p,{x:c.x,y:c.y}):Infinity;
    }
    if(c.type==="coincident"){
      if(c.mode==="point-line"){
        const p=getRefPoint(c.point),line=entity(c.line?.entity);
        if(!p||!line||line.type!=="line")return Infinity;
        return distanceToSegment(p,{x:line.x1,y:line.y1},{x:line.x2,y:line.y2});
      }
      const a=getRefPoint(c.a),b=getRefPoint(c.b);return a&&b?dist(a,b):Infinity;
    }
    if(c.type==="horizontal"){
      const e=entity(c.entities?.[0]);return e?Math.abs(e.y2-e.y1):Infinity;
    }
    if(c.type==="vertical"){
      const e=entity(c.entities?.[0]);return e?Math.abs(e.x2-e.x1):Infinity;
    }
    if(c.type==="parallel"||c.type==="perpendicular"){
      const a=entity(c.entities?.[0]),b=entity(c.entities?.[1]);if(!a||!b)return Infinity;
      const target=lineAngle(a)+(c.type==="perpendicular"?90:0);return angleDelta(lineAngle(b),target);
    }
    if(c.type==="equalLength"){
      const a=entity(c.entities?.[0]),b=entity(c.entities?.[1]);return a&&b?Math.abs(lineLength(a)-lineLength(b)):Infinity;
    }
    return 0;
  }
  function dimensionResidual(d){
    if(d.type==="distancePP")return Math.abs(distancePPValue(d)-Number(d.value));
    if(d.type==="distancePL")return Math.abs(distancePLValue(d)-Number(d.value));
    if(d.type==="distanceLL")return Math.abs(distanceLLValue(d)-Number(d.value));
    if(d.type==="angleBetween"){
      const a=entity(d.entities?.[0]),b=entity(d.entities?.[1]);
      const info=angleBetweenConnectedLines(a,b);
      return info?Math.abs(info.value-Number(d.value)):Infinity;
    }
    const e=entity(d.entity);if(!e)return Infinity;
    if(e.type==="line"){
      if(d.type==="length")return Math.abs(lineLength(e)-Number(d.value));
      if(d.type==="angle")return angleDelta(lineAngle(e),Number(d.value));
      const ref=makeEndpointRef(e.id,d.point),p=getRefPoint(ref);
      if(d.type==="endpointX")return Math.abs(p.x-Number(d.value));
      if(d.type==="endpointY")return Math.abs(p.y-Number(d.value));
    }
    if(e.type==="circle"){
      if(d.type==="diameter")return Math.abs(e.r*2-Number(d.value));
      if(d.type==="centerX")return Math.abs(e.cx-Number(d.value));
      if(d.type==="centerY")return Math.abs(e.cy-Number(d.value));
    }
    if(e.type==="point"){
      if(d.type==="pointX")return Math.abs(e.x-Number(d.value));
      if(d.type==="pointY")return Math.abs(e.y-Number(d.value));
    }
    return 0;
  }

  function projectActiveRules(iterations=20){
    state.runtimeConflicts=new Set();
    state.projectionPreferredAxes=new Set();
    computeEntityStates();
    for(let i=0;i<iterations;i++){
      // Primero actúan las cotas/drivers; después sus cambios se propagan
      // por las relaciones geométricas, sin depender del sentido de creación.
      applyAbsoluteDrivers();
      applySizeDrivers();
      applyDistanceDrivers();
      applyCoincident();
      applyOrientationConstraints();
      applyEqualLengths();
      applyCoincident();
      computeEntityStates();
    }
  }
  function ruleResidual(entry){
    return entry.kind==="constraint"?constraintResidual(entry.rule):dimensionResidual(entry.rule);
  }
  function ruleTolerance(entry){
    const t=entry.rule.type;
    if(t==="angle"||t==="angleBetween"||t==="parallel"||t==="perpendicular")return 0.02;
    return 0.005;
  }
  function ruleDescription(entry){
    const r=entry.rule;
    if(entry.kind==="dimension")return activeDimensionTitle(r)||"cota";
    return relationLabel(r)||"restricción";
  }
  function ruleById(id){
    return state.dimensions.find(r=>r.id===id)||state.constraints.find(r=>r.id===id)||null;
  }
  function ruleKindById(id){
    if(state.dimensions.some(r=>r.id===id))return"dimension";
    if(state.constraints.some(r=>r.id===id))return"constraint";
    return null;
  }
  function ruleOrderById(id){return Number(ruleById(id)?.order)||0;}
  function ruleDiagnosticBad(r){
    return !!r&&(!!r.rejected||!!r.diagnosticConflict||state.runtimeConflicts.has(r.id));
  }
  function clearConflictDiagnostics(){
    for(const entry of allRulesOrdered()){
      const r=entry.rule;
      r.diagnosticConflict=false;
      r.conflictWith=[];
      r.blockedBy=[];
    }
  }
  function linkConflictPair(newRule,olderRule){
    if(!newRule||!olderRule)return;
    newRule.conflictWith=[...new Set([...(newRule.conflictWith||[]),olderRule.id])];
    olderRule.blockedBy=[...new Set([...(olderRule.blockedBy||[]),newRule.id])];
    olderRule.diagnosticConflict=true;
  }
  function diagnosticPeerText(r){
    if(!r)return"";
    const ids=r.rejected?(r.conflictWith||[]):((r.blockedBy||[]));
    const orders=ids.map(ruleOrderById).filter(Boolean).sort((a,b)=>a-b);
    if(!orders.length)return"";
    return r.rejected
      ? ` · conflicto con ${orders.map(n=>"P"+n).join(", ")}`
      : ` · bloquea ${orders.map(n=>"P"+n).join(", ")}`;
  }

  function setOnlyRulesActive(activeIds){
    for(const entry of allRulesOrdered()){
      const active=activeIds.has(entry.rule.id)&&!entry.rule.rejected;
      entry.rule.temporaryInactive=!active;
      entry.rule.conflict=!active;
    }
    invalidateAnchorGraph();
  }
  function geometrySnapshot(){return clone(state.entities);}
  function restoreGeometry(entities){state.entities=clone(entities);invalidateAnchorGraph();}
  function validateRulesByPriority(fromOrder=1){
    normalizeRuleMetadata();
    const ordered=allRulesOrdered();
    const requested=Math.max(1,Number(fromOrder)||1);

    // Si ya había un conflicto/rechazo anterior, no congelarlo dentro del prefijo:
    // volver desde el primer problema conocido.
    const previousRuntimeConflicts=new Set(state.runtimeConflicts);
    const earliestProblem=ordered.reduce((min,entry)=>{
      if(!entry.rule.rejected&&!previousRuntimeConflicts.has(entry.rule.id))return min;
      const n=Number(entry.rule.order);
      return Number.isFinite(n)&&n>0?Math.min(min,n):min;
    },Infinity);
    const startOrder=Number.isFinite(earliestProblem)
      ? Math.min(requested,earliestProblem)
      : requested;

    const accepted=[],acceptedIds=new Set(),pending=[];
    state.runtimeConflicts=new Set();
    clearConflictDiagnostics();

    // P1..P(startOrder-1) ya fue validado en la resolución anterior.
    // Se usa como base y se proyecta UNA vez, en lugar de volver a probar:
    // P1, P1-P2, P1-P2-P3... de nuevo.
    for(const entry of ordered){
      const r=entry.rule;
      const order=Number(r.order)||Number.MAX_SAFE_INTEGER;
      if(order<startOrder){
        r.rejected=false;
        r.conflict=false;
        r.temporaryInactive=false;
        r.reason=undefined;
        accepted.push(entry);
        acceptedIds.add(r.id);
      }else{
        r.rejected=false;
        r.conflict=false;
        r.temporaryInactive=false;
        r.reason=undefined;
        pending.push(entry);
      }
    }

    setOnlyRulesActive(acceptedIds);
    if(accepted.length)projectActiveRules(16);

    // Sólo la regla modificada/nueva y las posteriores se vuelven a validar
    // por orden de prioridad.
    for(const entry of pending){
      const r=entry.rule;
      const before=geometrySnapshot();
      const trialIds=new Set(acceptedIds);trialIds.add(r.id);
      setOnlyRulesActive(trialIds);
      projectActiveRules(24);

      const violatedOlder=[];
      for(const oldEntry of accepted){
        const res=ruleResidual(oldEntry);
        if(!Number.isFinite(res)||res>ruleTolerance(oldEntry))violatedOlder.push(oldEntry);
      }
      const ownResidual=ruleResidual(entry);
      const ownBad=!Number.isFinite(ownResidual)||ownResidual>ruleTolerance(entry);

      if(violatedOlder.length||ownBad){
        restoreGeometry(before);
        r.rejected=true;r.conflict=true;

        if(violatedOlder.length){
          for(const oldEntry of violatedOlder)linkConflictPair(r,oldEntry.rule);
          const first=violatedOlder[0];
          r.reason=`Sobrerrestricción: P${r.order} se ignora para conservar P${first.rule.order} (${ruleDescription(first)}).`;
        }else{
          r.reason=`Sobrerrestricción: P${r.order} no puede satisfacerse sin modificar relaciones anteriores y queda ignorada.`;
        }
        setOnlyRulesActive(acceptedIds);
        projectActiveRules(16);
      }else{
        r.rejected=false;r.conflict=false;r.reason=undefined;
        accepted.push(entry);acceptedIds.add(r.id);
      }
    }

    setOnlyRulesActive(acceptedIds);
    projectActiveRules(pending.length?24:12);

    state.runtimeConflicts=new Set();
    for(const entry of accepted){
      const res=ruleResidual(entry);
      if(!Number.isFinite(res)||res>ruleTolerance(entry))state.runtimeConflicts.add(entry.rule.id);
    }
    for(const entry of ordered)if(entry.rule.rejected)entry.rule.conflict=true;

    state.rulesDirty=false;
    state.rulesDirtyFrom=null;
  }
  function updateRuntimeResiduals(entries){
    state.runtimeConflicts=new Set();
    for(const entry of entries){
      const res=ruleResidual(entry);
      if(!Number.isFinite(res)||res>ruleTolerance(entry))state.runtimeConflicts.add(entry.rule.id);
    }
  }
  function solveFast(iterations=8,{states=false}={}){
    normalizeRuleMetadata();
    const active=allRulesOrdered().filter(e=>!e.rule.rejected);
    const activeIds=new Set(active.map(e=>e.rule.id));
    setOnlyRulesActive(activeIds);
    projectActiveRules(iterations);
    if(states){
      updateRuntimeResiduals(active);
      computeEntityStates();
    }
  }
  function solve(){
    normalizeRuleMetadata();
    if(state.rulesDirty){
      validateRulesByPriority(state.rulesDirtyFrom||1);
    }else{
      solveFast(10,{states:true});
    }
    computeEntityStates();
  }

  function lengthFixedSet(){
    const fixed=new Set(state.dimensions.filter(d=>!d.conflict&&!state.runtimeConflicts.has(d.id)&&d.type==="length").map(d=>d.entity));
    let changed=true;
    while(changed){
      changed=false;
      for(const c of state.constraints){
        if(c.conflict||state.runtimeConflicts.has(c.id)||c.type!=="equalLength")continue;
        const[a,b]=c.entities||[];
        if(fixed.has(a)&&!fixed.has(b)){fixed.add(b);changed=true;}
        if(fixed.has(b)&&!fixed.has(a)){fixed.add(a);changed=true;}
      }
    }
    return fixed;
  }
  function orientationFixedSet(){
    const fixed=new Set();
    for(const d of state.dimensions){
      if(d.conflict||state.runtimeConflicts.has(d.id))continue;
      if(d.type==="angle")fixed.add(d.entity);
      if(d.type==="angleBetween"&&d.entities?.[1])fixed.add(d.entities[1]);
    }
    for(const c of state.constraints){
      if(c.conflict||state.runtimeConflicts.has(c.id))continue;
      if(c.type==="horizontal"||c.type==="vertical")fixed.add(c.entities?.[0]);
    }
    let changed=true;
    while(changed){
      changed=false;
      for(const c of state.constraints){
        if(c.conflict||state.runtimeConflicts.has(c.id)||!["parallel","perpendicular"].includes(c.type))continue;
        const[a,b]=c.entities||[];
        if(fixed.has(a)&&!fixed.has(b)){fixed.add(b);changed=true;}
        if(fixed.has(b)&&!fixed.has(a)){fixed.add(a);changed=true;}
      }
    }
    return fixed;
  }
  function computeEntityStates(){
    const conflicted=new Set();
    for(const c of state.constraints){
      if(c.rejected||state.runtimeConflicts.has(c.id)){
        for(const id of c.entities||[])conflicted.add(id);
        if(c.ref?.entity)conflicted.add(c.ref.entity);
        if(c.a?.entity)conflicted.add(c.a.entity);
        if(c.b?.entity)conflicted.add(c.b.entity);
        if(c.point?.entity)conflicted.add(c.point.entity);
        if(c.line?.entity)conflicted.add(c.line.entity);
      }
    }
    for(const d of state.dimensions){
      if(!(d.rejected||state.runtimeConflicts.has(d.id)))continue;
      if(d.entity)conflicted.add(d.entity);
      for(const id of d.entities||[])conflicted.add(id);
      if(d.a?.entity)conflicted.add(d.a.entity);
      if(d.b?.entity)conflicted.add(d.b.entity);
      if(d.point?.entity)conflicted.add(d.point.entity);
      if(d.line?.entity)conflicted.add(d.line.entity);
      if(d.lineA)conflicted.add(d.lineA);
      if(d.lineB)conflicted.add(d.lineB);
    }

    // Conocer un punto completo no es suficiente para un croquis paramétrico:
    // necesitamos saber por separado si X y Y están determinados.
    const known=new Map();
    const key=ref=>refKey(ref);
    const ensure=ref=>{
      const k=key(ref);
      if(!known.has(k))known.set(k,new Set());
      return known.get(k);
    };
    const mark=(ref,axis)=>{
      if(!ref)return false;
      const set=ensure(ref);
      const before=set.size;
      set.add(axis);
      return set.size!==before;
    };
    const has=(ref,axis)=>!!ref&&known.get(key(ref))?.has(axis);
    const fullRef=ref=>has(ref,"x")&&has(ref,"y");

    // El origen es una referencia absoluta.
    const originRef={kind:"origin"};
    mark(originRef,"x");mark(originRef,"y");

    // Fijaciones y cotas absolutas.
    for(const c of state.constraints){
      if(c.conflict||c.rejected||state.runtimeConflicts.has(c.id))continue;
      if(c.type==="fixed"){
        mark(c.ref,"x");mark(c.ref,"y");
      }
    }
    for(const d of state.dimensions){
      if(d.conflict||d.rejected||state.runtimeConflicts.has(d.id))continue;
      const e=entity(d.entity);
      if(e?.type==="line"){
        const ref=makeEndpointRef(e.id,d.point);
        if(d.type==="endpointX")mark(ref,"x");
        if(d.type==="endpointY")mark(ref,"y");
      }else if(e?.type==="circle"){
        const ref=makeCenterRef(e.id);
        if(d.type==="centerX")mark(ref,"x");
        if(d.type==="centerY")mark(ref,"y");
      }else if(e?.type==="point"){
        const ref=makePointRef(e.id);
        if(d.type==="pointX")mark(ref,"x");
        if(d.type==="pointY")mark(ref,"y");
      }
    }

    const activeConstraints=state.constraints.filter(c=>!c.conflict&&!c.rejected&&!state.runtimeConflicts.has(c.id));
    const activeDimensions=state.dimensions.filter(d=>!d.conflict&&!d.rejected&&!state.runtimeConflicts.has(d.id));

    const lineConstraint=(id,type)=>activeConstraints.some(c=>c.type===type&&c.entities?.[0]===id);
    const lineLengthDim=id=>activeDimensions.find(d=>d.type==="length"&&d.entity===id);
    const lineAngleDim=id=>activeDimensions.find(d=>d.type==="angle"&&d.entity===id);

    // Propagar conocimiento de coordenadas hasta converger.
    let changed=true,guard=0;
    while(changed&&guard++<100){
      changed=false;

      // Coincidencia punto-punto/origen: comparten X y Y en ambos sentidos.
      for(const c of activeConstraints){
        if(c.type!=="coincident"||c.mode==="point-line")continue;
        const a=c.a,b=c.b;
        if(!a||!b)continue;
        for(const axis of["x","y"]){
          if(has(a,axis))changed=mark(b,axis)||changed;
          if(has(b,axis))changed=mark(a,axis)||changed;
        }
      }

      // H/V comparten una coordenada entre los dos endpoints.
      for(const e of state.entities){
        if(e.type!=="line")continue;
        const a=makeEndpointRef(e.id,"start"),b=makeEndpointRef(e.id,"end");
        if(lineConstraint(e.id,"horizontal")){
          if(has(a,"y"))changed=mark(b,"y")||changed;
          if(has(b,"y"))changed=mark(a,"y")||changed;
        }
        if(lineConstraint(e.id,"vertical")){
          if(has(a,"x"))changed=mark(b,"x")||changed;
          if(has(b,"x"))changed=mark(a,"x")||changed;
        }
      }

      // Una longitud en una línea H/V determina la coordenada restante
      // del otro endpoint cuando uno de los extremos ya está referenciado.
      for(const e of state.entities){
        if(e.type!=="line"||!lineLengthDim(e.id))continue;
        const a=makeEndpointRef(e.id,"start"),b=makeEndpointRef(e.id,"end");
        const horizontal=lineConstraint(e.id,"horizontal");
        const vertical=lineConstraint(e.id,"vertical");

        if(horizontal){
          if(has(a,"x"))changed=mark(b,"x")||changed;
          if(has(b,"x"))changed=mark(a,"x")||changed;
        }else if(vertical){
          if(has(a,"y"))changed=mark(b,"y")||changed;
          if(has(b,"y"))changed=mark(a,"y")||changed;
        }else if(lineAngleDim(e.id)){
          // Longitud + ángulo + un endpoint completo determinan el otro.
          if(fullRef(a)){changed=mark(b,"x")||changed;changed=mark(b,"y")||changed;}
          if(fullRef(b)){changed=mark(a,"x")||changed;changed=mark(a,"y")||changed;}
        }
      }

      // Punto coincidente sobre una línea totalmente determinada:
      // si además su posición paramétrica está fijada por otra relación,
      // podrá quedar completamente determinada. Por ahora sólo propagamos
      // cuando el punto ya tiene un eje fijado y la geometría de la línea
      // fija inequívocamente el otro eje (H/V).
      for(const c of activeConstraints){
        if(c.type!=="coincident"||c.mode!=="point-line")continue;
        const p=c.point,line=entity(c.line?.entity);
        if(!p||!line||line.type!=="line")continue;
        const a=makeEndpointRef(line.id,"start"),b=makeEndpointRef(line.id,"end");
        if(lineConstraint(line.id,"vertical")&&has(a,"x")&&has(b,"x")){
          changed=mark(p,"x")||changed;
        }
        if(lineConstraint(line.id,"horizontal")&&has(a,"y")&&has(b,"y")){
          changed=mark(p,"y")||changed;
        }
      }


      // Las cotas de distancia también eliminan grados de libertad.
      for(const d of activeDimensions){
        if(d.type==="distanceLL"){
          const la=entity(d.lineA),lb=entity(d.lineB);
          if(!la||!lb||la.type!=="line"||lb.type!=="line")continue;
          const a1=makeEndpointRef(la.id,"start"),a2=makeEndpointRef(la.id,"end");
          const b1=makeEndpointRef(lb.id,"start"),b2=makeEndpointRef(lb.id,"end");

          const ah=lineConstraint(la.id,"horizontal"),bh=lineConstraint(lb.id,"horizontal");
          const av=lineConstraint(la.id,"vertical"),bv=lineConstraint(lb.id,"vertical");

          // Distancia entre dos horizontales: si Y de una está determinada,
          // la distancia fija la Y de la otra.
          if(ah&&bh){
            const aKnown=has(a1,"y")&&has(a2,"y");
            const bKnown=has(b1,"y")&&has(b2,"y");
            if(aKnown){changed=mark(b1,"y")||changed;changed=mark(b2,"y")||changed;}
            if(bKnown){changed=mark(a1,"y")||changed;changed=mark(a2,"y")||changed;}
          }

          // Distancia entre dos verticales: equivalente para X.
          if(av&&bv){
            const aKnown=has(a1,"x")&&has(a2,"x");
            const bKnown=has(b1,"x")&&has(b2,"x");
            if(aKnown){changed=mark(b1,"x")||changed;changed=mark(b2,"x")||changed;}
            if(bKnown){changed=mark(a1,"x")||changed;changed=mark(a2,"x")||changed;}
          }
        }else if(d.type==="distancePL"){
          const pref=d.point,line=entity(d.line?.entity);
          if(!pref||!line||line.type!=="line")continue;
          const a=makeEndpointRef(line.id,"start"),b=makeEndpointRef(line.id,"end");

          if(lineConstraint(line.id,"horizontal")){
            const lineKnown=has(a,"y")&&has(b,"y");
            if(lineKnown)changed=mark(pref,"y")||changed;
            if(has(pref,"y")){changed=mark(a,"y")||changed;changed=mark(b,"y")||changed;}
          }
          if(lineConstraint(line.id,"vertical")){
            const lineKnown=has(a,"x")&&has(b,"x");
            if(lineKnown)changed=mark(pref,"x")||changed;
            if(has(pref,"x")){changed=mark(a,"x")||changed;changed=mark(b,"x")||changed;}
          }
        }else if(d.type==="distancePP"){
          const a=d.a,b=d.b;if(!a||!b)continue;

          // Con una referencia completa y un eje conocido en la otra,
          // la distancia fija localmente el eje restante (la rama/signo
          // queda definida por la geometría actual).
          if(fullRef(a)){
            if(has(b,"x")&&!has(b,"y"))changed=mark(b,"y")||changed;
            if(has(b,"y")&&!has(b,"x"))changed=mark(b,"x")||changed;
          }
          if(fullRef(b)){
            if(has(a,"x")&&!has(a,"y"))changed=mark(a,"y")||changed;
            if(has(a,"y")&&!has(a,"x"))changed=mark(a,"x")||changed;
          }
        }
      }
    }

    state.entityStates=new Map();
    for(const e of state.entities){
      if(conflicted.has(e.id)){
        state.entityStates.set(e.id,"conflict");
        continue;
      }

      let full=false;
      if(e.type==="line"){
        const a=makeEndpointRef(e.id,"start"),b=makeEndpointRef(e.id,"end");
        full=fullRef(a)&&fullRef(b);
      }else if(e.type==="circle"){
        const center=makeCenterRef(e.id);
        const diameter=activeDimensions.some(d=>d.type==="diameter"&&d.entity===e.id);
        full=fullRef(center)&&diameter;
      }else if(e.type==="point"){
        full=fullRef(makePointRef(e.id));
      }else if(e.type==="arc"){
        // Los arcos creados por Trim aún no tienen un modelo paramétrico completo.
        full=false;
      }

      state.entityStates.set(e.id,full?"full":"under");
    }
  }
  function solveAndRefresh(){solve();refreshAll();}

  function entityState(id){return state.entityStates.get(id)||"under";}
  function entityColor(e,selected=false,hover=false){
    const st=entityState(e.id);
    if(st==="conflict")return"#f04438";
    if(selected)return"#2563eb";
    if(hover)return"#175cd3";
    if(st==="full")return"#00d084";
    return"#344054";
  }

  function drawGrid(){
    const dpr=window.devicePixelRatio||1,w=canvas.width/dpr,h=canvas.height/dpr;
    const base=gridStep(),step=visibleGridStep(),o=worldToScreen(state.origin),gap=step*state.view.scale;

    const drawSpacing=(spacing,color,width=1)=>{
      const px=spacing*state.view.scale;
      if(px<5)return;
      const origin=worldToScreen(state.origin);
      const sx=((origin.x%px)+px)%px,sy=((origin.y%px)+px)%px;
      ctx.strokeStyle=color;ctx.lineWidth=width;ctx.beginPath();
      for(let x=sx;x<w;x+=px){ctx.moveTo(x,0);ctx.lineTo(x,h);}
      for(let y=sy;y<h;y+=px){ctx.moveTo(0,y);ctx.lineTo(w,y);}
      ctx.stroke();
    };

    // Rejilla visible: fina, media y principal. La base real permanece en 0.1 mm.
    drawSpacing(step,"#f2f4f7",1);
    const medium=Math.max(1,step*5);
    const major=Math.max(10,step*10);
    if(medium>step)drawSpacing(medium,"#eaecf0",1);
    if(major>medium)drawSpacing(major,"#dfe3e8",1);

    // Ejes del origen.
    ctx.strokeStyle="#c7cdd6";ctx.lineWidth=1.2;ctx.beginPath();
    ctx.moveTo(0,o.y);ctx.lineTo(w,o.y);ctx.moveTo(o.x,0);ctx.lineTo(o.x,h);ctx.stroke();

    ctx.fillStyle="#98a2b3";ctx.font="10px ui-monospace,monospace";
    const visibleText=Math.abs(step-base)<1e-9
      ? `rejilla 0.10 mm`
      : `rejilla base 0.10 mm · visible ${fmt(step)} mm`;
    ctx.fillText(visibleText,8,h-8);
  }
  function drawEntity(e,selected=false,hover=false){
    const color=entityColor(e,selected,hover);ctx.save();ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=selected?2.5:entityState(e.id)==="full"?1.8:1.4;
    if(entityState(e.id)==="conflict"){ctx.shadowColor="rgba(240,68,56,.35)";ctx.shadowBlur=5;}
    if(e.type==="line"){
      const a=worldToScreen({x:e.x1,y:e.y1}),b=worldToScreen({x:e.x2,y:e.y2});ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    }else if(e.type==="circle"){
      const c=worldToScreen({x:e.cx,y:e.cy});ctx.beginPath();ctx.arc(c.x,c.y,e.r*state.view.scale,0,TAU);ctx.stroke();ctx.beginPath();ctx.arc(c.x,c.y,2.5,0,TAU);ctx.fill();
    }else if(e.type==="arc"){
      const c=worldToScreen({x:e.cx,y:e.cy});ctx.beginPath();ctx.arc(c.x,c.y,e.r*state.view.scale,-rad(e.start),-rad(e.end),true);ctx.stroke();
    }else if(e.type==="point"){
      const p=worldToScreen(e);ctx.beginPath();ctx.arc(p.x,p.y,3.2,0,TAU);ctx.fill();ctx.beginPath();ctx.moveTo(p.x-6,p.y);ctx.lineTo(p.x+6,p.y);ctx.moveTo(p.x,p.y-6);ctx.lineTo(p.x,p.y+6);ctx.stroke();
    }ctx.restore();
  }
  function selectedForDraw(e){
    return state.selected.includes(e.id)||state.pickSelection.some(item=>item.kind==="entity"&&item.entity===e.id);
  }
  function refIsSelected(ref){
    return (state.selectedRef&&refKey(state.selectedRef)===refKey(ref))||state.pickSelection.some(item=>item.kind!=="entity"&&refKey(item)===refKey(ref));
  }
  function drawHandles(){
    ctx.save();
    for(const e of state.entities){
      if(e.type==="line"){
        for(const ref of lineRefs(e)){
          const p=worldToScreen(getRefPoint(ref)),sel=refIsSelected(ref);
          ctx.fillStyle=sel?"#2563eb":"#ffffff";
          ctx.strokeStyle=entityState(e.id)==="full"?"#00a86b":"#667085";
          ctx.lineWidth=sel?1.8:1;
          ctx.fillRect(p.x-3.5,p.y-3.5,7,7);ctx.strokeRect(p.x-3.5,p.y-3.5,7,7);
        }
        if(selectedForDraw(e)||state.hover===e.id){
          const m=worldToScreen(lineMidpoint(e));
          ctx.fillStyle="#ffffff";ctx.strokeStyle="#98a2b3";ctx.lineWidth=1;
          ctx.beginPath();ctx.moveTo(m.x,m.y-4);ctx.lineTo(m.x+4,m.y);ctx.lineTo(m.x,m.y+4);ctx.lineTo(m.x-4,m.y);ctx.closePath();ctx.fill();ctx.stroke();
        }
      }else if(e.type==="circle"&&(selectedForDraw(e)||state.hover===e.id||state.tool==="dimension"||state.tool==="constraint")){
        const ref=makeCenterRef(e.id),p=worldToScreen(getRefPoint(ref)),sel=refIsSelected(ref);
        ctx.fillStyle=sel?"#2563eb":"#ffffff";ctx.strokeStyle="#667085";ctx.lineWidth=1;
        ctx.beginPath();ctx.arc(p.x,p.y,4,0,TAU);ctx.fill();ctx.stroke();
      }
    }
    ctx.restore();
  }
  function markerTextForLine(e){
    const items=[];
    for(const c of constraintsForEntity(e.id)){
      if(c.conflict||state.runtimeConflicts.has(c.id))continue;
      if(c.type==="horizontal")items.push("H");
      if(c.type==="vertical")items.push("V");
      if(c.type==="parallel"&&c.entities?.[1]===e.id)items.push("∥");
      if(c.type==="perpendicular"&&c.entities?.[1]===e.id)items.push("⊥");
    }
    return items.slice(0,3).join(" ");
  }
  function drawRelationMarkers(){
    ctx.save();ctx.font="10px ui-sans-serif";ctx.fillStyle="#667085";
    for(const e of state.entities){
      if(e.type==="line"){
        const t=markerTextForLine(e);if(!t)continue;
        const m=worldToScreen(lineMidpoint(e));
        const diagnostic=constraintsForEntity(e.id).some(c=>c.diagnosticConflict&&!c.rejected);
        ctx.fillStyle=diagnostic?"#d92d20":"#667085";
        ctx.fillText(t,m.x+6,m.y-6);
      }
    }
    for(const c of state.constraints){
      if(c.type!=="coincident"||c.rejected||state.runtimeConflicts.has(c.id))continue;
      let p=null;
      if(c.mode==="point-line")p=getRefPoint(c.point);
      else p=getRefPoint(c.a);
      if(!p)continue;
      const ss=worldToScreen(p);
      ctx.strokeStyle=c.diagnosticConflict?"#d92d20":"#667085";
      ctx.lineWidth=c.diagnosticConflict?1.8:1;
      ctx.strokeRect(ss.x-2.5,ss.y-2.5,5,5);
    }
    ctx.restore();
  }
  function dimensionGeometry(d){
    if(d.type==="distancePP"){
      const a=getRefPoint(d.a),b=getRefPoint(d.b);if(!a||!b)return null;
      return{a,b,p:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},text:`${fmt(d.value)} mm`};
    }
    if(d.type==="distancePL"){
      const point=getRefPoint(d.point),line=entity(d.line?.entity);if(!point||!line||line.type!=="line")return null;
      const foot=projectPointToInfiniteLine(point,{x:line.x1,y:line.y1},{x:line.x2,y:line.y2});
      return{a:point,b:foot,p:{x:(point.x+foot.x)/2,y:(point.y+foot.y)/2},text:`${fmt(d.value)} mm`};
    }
    if(d.type==="distanceLL"){
      const aLine=entity(d.lineA),bLine=entity(d.lineB);if(!aLine||!bLine)return null;
      const b=lineMidpoint(bLine),a=projectPointToInfiniteLine(b,{x:aLine.x1,y:aLine.y1},{x:aLine.x2,y:aLine.y2});
      return{a,b,p:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},text:`${fmt(d.value)} mm`};
    }
    if(d.type==="angleBetween"){
      const a=entity(d.entities?.[0]),b=entity(d.entities?.[1]),info=angleBetweenConnectedLines(a,b);
      if(!a||!b||!info)return null;
      const joint=info.joint,oa=otherEndpoint(a,info.aRef),ob=otherEndpoint(b,info.bRef);
      if(!joint||!oa||!ob)return null;
      return{p:{x:(joint.x+oa.x+ob.x)/3,y:(joint.y+oa.y+ob.y)/3},text:`${fmt(d.value)}°`};
    }
    const e=entity(d.entity);if(!e)return null;
    if(e.type==="line"){
      const a={x:e.x1,y:e.y1},b={x:e.x2,y:e.y2},m=lineMidpoint(e);
      if(d.type==="length")return{a,b,p:m,text:`${fmt(d.value)} mm`,noWitness:true};
      if(d.type==="angle")return{p:m,text:`${fmt(d.value)}°`};
      const pp=d.point==="start"?a:b;
      if(d.type==="endpointX")return{p:pp,text:`X ${fmt(d.value)}`};
      if(d.type==="endpointY")return{p:pp,text:`Y ${fmt(d.value)}`};
    }else if(e.type==="circle"){
      const pp={x:e.cx,y:e.cy};
      if(d.type==="diameter")return{p:pp,text:`Ø ${fmt(d.value)} mm`};
      if(d.type==="centerX")return{p:pp,text:`X ${fmt(d.value)}`};
      if(d.type==="centerY")return{p:pp,text:`Y ${fmt(d.value)}`};
    }else if(e.type==="point"){
      const pp={x:e.x,y:e.y};
      if(d.type==="pointX")return{p:pp,text:`X ${fmt(d.value)}`};
      if(d.type==="pointY")return{p:pp,text:`Y ${fmt(d.value)}`};
    }
    return null;
  }
  function dimensionLabel(d){return dimensionGeometry(d);}
  function dimensionLabelPoint(d,g=null){
    const geom=g||dimensionGeometry(d);if(!geom)return null;
    const off=d.labelOffset||{x:0,y:0};
    return{x:geom.p.x+(Number(off.x)||0),y:geom.p.y+(Number(off.y)||0)};
  }
  function dimensionScreenInfo(d){
    const lbl=dimensionGeometry(d);if(!lbl)return null;
    const labelPoint=dimensionLabelPoint(d,lbl),p=worldToScreen(labelPoint),text=lbl.text;
    ctx.save();ctx.font="11px ui-monospace,monospace";
    const w=Math.max(28,ctx.measureText(text).width);ctx.restore();
    return{x:p.x+7,y:p.y-18,w:w+8,h:16,text,p,labelPoint,anchor:worldToScreen(lbl.p)};
  }
  function dimensionHitTest(screen){
    for(let i=state.dimensions.length-1;i>=0;i--){
      const d=state.dimensions[i],b=dimensionScreenInfo(d);if(!b)continue;
      if(screen.x>=b.x-4&&screen.x<=b.x+b.w+4&&screen.y>=b.y-4&&screen.y<=b.y+b.h+4)return d;
    }
    return null;
  }
  function drawDimensions(){
    ctx.save();ctx.font="11px ui-monospace,monospace";
    for(const d of state.dimensions){
      const g=dimensionGeometry(d);if(!g)continue;
      const bad=ruleDiagnosticBad(d),active=d.id===state.activeDimension;
      const color=bad?"#d92d20":active?"#4b2bbd":"#6941c6";
      if(g.a&&g.b&&!g.noWitness){
        const a=worldToScreen(g.a),b=worldToScreen(g.b);
        ctx.strokeStyle=color;ctx.lineWidth=1;ctx.setLineDash([3,3]);
        ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
        const dx=b.x-a.x,dy=b.y-a.y,L=Math.hypot(dx,dy)||1,nx=-dy/L,ny=dx/L;
        ctx.beginPath();ctx.moveTo(a.x-4*nx,a.y-4*ny);ctx.lineTo(a.x+4*nx,a.y+4*ny);ctx.moveTo(b.x-4*nx,b.y-4*ny);ctx.lineTo(b.x+4*nx,b.y+4*ny);ctx.stroke();
      }
      const labelPoint=dimensionLabelPoint(d,g),ss=worldToScreen(labelPoint),anchor=worldToScreen(g.p);
      if(Math.hypot(ss.x-anchor.x,ss.y-anchor.y)>12){
        ctx.strokeStyle=active?"#7f56d9":"#b692f6";ctx.lineWidth=1;ctx.setLineDash([2,3]);
        ctx.beginPath();ctx.moveTo(anchor.x,anchor.y);ctx.lineTo(ss.x,ss.y);ctx.stroke();ctx.setLineDash([]);
      }
      if(active){
        const box=dimensionScreenInfo(d);
        if(box){ctx.fillStyle="rgba(105,65,198,.10)";ctx.fillRect(box.x-3,box.y-2,box.w+6,box.h+4);}
      }
      ctx.fillStyle=color;ctx.fillText(g.text,ss.x+7,ss.y-7);
    }ctx.restore();
  }
  function drawDimensionPreview(){
    const d=state.dimensionPlacement?.candidate;if(!d)return;
    const g=dimensionGeometry(d);if(!g)return;

    ctx.save();
    ctx.font="11px ui-monospace,monospace";
    ctx.strokeStyle="#7f56d9";ctx.fillStyle="#6941c6";ctx.lineWidth=1.2;

    if(g.a&&g.b&&!g.noWitness){
      const a=worldToScreen(g.a),b=worldToScreen(g.b);
      ctx.setLineDash([4,3]);
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
      ctx.setLineDash([]);
      const dx=b.x-a.x,dy=b.y-a.y,L=Math.hypot(dx,dy)||1,nx=-dy/L,ny=dx/L;
      ctx.beginPath();
      ctx.moveTo(a.x-4*nx,a.y-4*ny);ctx.lineTo(a.x+4*nx,a.y+4*ny);
      ctx.moveTo(b.x-4*nx,b.y-4*ny);ctx.lineTo(b.x+4*nx,b.y+4*ny);
      ctx.stroke();
    }

    const lp=dimensionLabelPoint(d,g),ss=worldToScreen(lp),anchor=worldToScreen(g.p);
    ctx.setLineDash([2,3]);ctx.beginPath();ctx.moveTo(anchor.x,anchor.y);ctx.lineTo(ss.x,ss.y);ctx.stroke();ctx.setLineDash([]);

    const text=g.text,tw=ctx.measureText(text).width;
    ctx.fillStyle="rgba(255,255,255,.95)";
    ctx.strokeStyle="#b692f6";
    ctx.beginPath();ctx.roundRect(ss.x+2,ss.y-18,tw+12,22,6);ctx.fill();ctx.stroke();
    ctx.fillStyle="#6941c6";ctx.fillText(text,ss.x+8,ss.y-3);
    ctx.restore();
  }

  function drawDraft(){
    if(!state.draft)return;ctx.save();ctx.strokeStyle="#2563eb";ctx.fillStyle="#2563eb";ctx.lineWidth=1.3;ctx.setLineDash([6,4]);
    if(state.draft.type==="line"){
      const a=worldToScreen({x:state.draft.x1,y:state.draft.y1}),b=worldToScreen({x:state.draft.x2,y:state.draft.y2});
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    }else if(state.draft.type==="rect"){
      const{x,y,w,h}=state.draft,pts=[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}].map(worldToScreen);
      ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i].x,pts[i].y);ctx.closePath();ctx.stroke();

      // Lectura temporal de construcción: NO es una cota y no se guarda.
      const corner=pts[2],label=`${fmt(Math.abs(w))} × ${fmt(Math.abs(h))} mm`;
      ctx.setLineDash([]);
      ctx.font="12px ui-monospace,monospace";
      const tw=ctx.measureText(label).width;
      let lx=corner.x+12,ly=corner.y-12;
      const dpr=window.devicePixelRatio||1,cw=canvas.width/dpr,ch=canvas.height/dpr;
      if(lx+tw+14>cw)lx=corner.x-tw-18;
      if(ly<20)ly=corner.y+24;
      ctx.fillStyle="rgba(255,255,255,.94)";
      ctx.strokeStyle="#b692f6";ctx.lineWidth=1;
      ctx.beginPath();ctx.roundRect(lx-6,ly-14,tw+12,22,6);ctx.fill();ctx.stroke();
      ctx.fillStyle="#6941c6";ctx.fillText(label,lx,ly+1);
    }else if(state.draft.type==="circle"){
      const c=worldToScreen({x:state.draft.cx,y:state.draft.cy});ctx.beginPath();ctx.arc(c.x,c.y,state.draft.r*state.view.scale,0,TAU);ctx.stroke();
    }ctx.restore();
  }
  function drawOriginHandle(){
    const p=worldToScreen(state.origin),sel=refIsSelected({kind:"origin"});
    ctx.save();
    ctx.lineWidth=sel?2:1.2;
    ctx.strokeStyle=sel?"#2563eb":"#98a2b3";
    ctx.fillStyle=sel?"rgba(37,99,235,.12)":"#ffffff";
    ctx.beginPath();ctx.arc(p.x,p.y,5,0,TAU);ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.moveTo(p.x-8,p.y);ctx.lineTo(p.x+8,p.y);ctx.moveTo(p.x,p.y-8);ctx.lineTo(p.x,p.y+8);ctx.stroke();
    ctx.font="10px ui-sans-serif";ctx.fillStyle=sel?"#2563eb":"#667085";ctx.fillText("0,0",p.x+7,p.y+13);
    ctx.restore();
  }
  function drawSelectionBox(){
    const b=state.selectionBox;if(!b||!b.moved)return;
    const x=Math.min(b.startScreen.x,b.endScreen.x),y=Math.min(b.startScreen.y,b.endScreen.y);
    const w=Math.abs(b.endScreen.x-b.startScreen.x),h=Math.abs(b.endScreen.y-b.startScreen.y);
    const crossing=b.endScreen.x<b.startScreen.x;
    ctx.save();
    ctx.fillStyle=crossing?"rgba(2,122,72,.08)":"rgba(37,99,235,.08)";
    ctx.strokeStyle=crossing?"#027a48":"#2563eb";
    ctx.lineWidth=1;
    if(crossing)ctx.setLineDash([6,4]);
    ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);
    ctx.setLineDash([]);
    ctx.font="10px ui-sans-serif";ctx.fillStyle=crossing?"#027a48":"#2563eb";
    ctx.fillText(crossing?"Cruce":"Ventana",x+6,y+14);
    ctx.restore();
  }

  function drawSnap(){
    if(!state.snap)return;const p=worldToScreen(state.snap);ctx.save();ctx.strokeStyle="#027a48";ctx.fillStyle="#027a48";ctx.lineWidth=1.5;
    if(state.snap.kind==="endpoint"||state.snap.kind==="origin")ctx.strokeRect(p.x-4,p.y-4,8,8);
    else if(state.snap.kind==="midpoint"){ctx.beginPath();ctx.moveTo(p.x,p.y-5);ctx.lineTo(p.x+5,p.y+4);ctx.lineTo(p.x-5,p.y+4);ctx.closePath();ctx.stroke();}
    else if(state.snap.kind==="center"){ctx.beginPath();ctx.arc(p.x,p.y,5,0,TAU);ctx.stroke();}
    else{ctx.beginPath();ctx.moveTo(p.x-5,p.y);ctx.lineTo(p.x+5,p.y);ctx.moveTo(p.x,p.y-5);ctx.lineTo(p.x,p.y+5);ctx.stroke();}
    const snapName=state.snap.kind==="origin"?"origen":state.snap.kind==="on-line"?"sobre línea":state.snap.kind;
    ctx.font="10px ui-sans-serif";ctx.fillText(snapName,p.x+7,p.y-7);ctx.restore();
  }
  function draw(){
    const dpr=window.devicePixelRatio||1;ctx.setTransform(dpr,0,0,dpr,0,0);const w=canvas.width/dpr,h=canvas.height/dpr;
    ctx.clearRect(0,0,w,h);ctx.fillStyle="#fff";ctx.fillRect(0,0,w,h);drawGrid();drawOriginHandle();
    for(const e of state.entities){
      const endpointHover=state.hoverHandle?.type==="ref"&&state.hoverHandle?.entity===e.id;
      drawEntity(e,selectedForDraw(e),state.hover===e.id&&!endpointHover);
    }
    drawRelationMarkers();drawDimensions();drawDimensionPreview();drawHandles();drawDraft();drawSelectionBox();drawSnap();
  }

  function snapCandidates(excludeEntity=null){
    const out=[{x:state.origin.x,y:state.origin.y,kind:"origin",ref:{kind:"origin"}}];
    for(const e of state.entities){
      if(e.id===excludeEntity)continue;
      if(e.type==="line"){
        if(snapEnabled("endpoint")){
          out.push({x:e.x1,y:e.y1,kind:"endpoint",ref:makeEndpointRef(e.id,"start")});
          out.push({x:e.x2,y:e.y2,kind:"endpoint",ref:makeEndpointRef(e.id,"end")});
        }
        if(snapEnabled("midpoint"))out.push({x:(e.x1+e.x2)/2,y:(e.y1+e.y2)/2,kind:"midpoint",ref:makeLineRef(e.id)});
      }else if((e.type==="circle"||e.type==="arc")&&snapEnabled("center")){
        out.push({x:e.cx,y:e.cy,kind:"center",ref:makeCenterRef(e.id)});
      }else if(e.type==="point"){
        out.push({x:e.x,y:e.y,kind:"point",ref:makePointRef(e.id)});
      }
    }
    if(snapEnabled("intersection")){
      for(let i=0;i<state.entities.length;i++)for(let j=i+1;j<state.entities.length;j++){
        const a=state.entities[i],b=state.entities[j];
        if(a.id===excludeEntity||b.id===excludeEntity)continue;
        if(a.type==="line"&&b.type==="line"){
          const p=lineIntersection({x:a.x1,y:a.y1},{x:a.x2,y:a.y2},{x:b.x1,y:b.y1},{x:b.x2,y:b.y2});
          if(p)out.push({...p,kind:"intersection"});
        }else if(a.type==="line"&&b.type==="circle"){
          for(const p of segmentCircleIntersections({x:a.x1,y:a.y1},{x:a.x2,y:a.y2},{x:b.cx,y:b.cy},b.r))out.push({...p,kind:"intersection"});
        }else if(b.type==="line"&&a.type==="circle"){
          for(const p of segmentCircleIntersections({x:b.x1,y:b.y1},{x:b.x2,y:b.y2},{x:a.cx,y:a.cy},a.r))out.push({...p,kind:"intersection"});
        }else if(a.type==="circle"&&b.type==="circle"){
          for(const p of circleCircleIntersections(a,b))out.push({...p,kind:"intersection"});
        }
      }
    }
    return out;
  }
  function getSnap(p,{excludeEntity=null}={}){
    // Con todos los snaps apagados no recorrer geometría ni calcular intersecciones.
    if(!anySnapEnabled())return null;
    const tol=10/state.view.scale;let best=null,bd=Infinity;
    for(const c of snapCandidates(excludeEntity)){
      const d=dist(p,c);
      if(d<tol&&d<bd){best=c;bd=d;}
    }
    // Si no ganó un snap puntual, el propio segmento de una línea es un objetivo Coincidente.
    if(!best){
      for(const e of state.entities){
        if(e.id===excludeEntity||e.type!=="line")continue;
        const q=segmentNearestPoint(p,{x:e.x1,y:e.y1},{x:e.x2,y:e.y2}),d=dist(p,q);
        if(d<tol&&d<bd){best={x:q.x,y:q.y,kind:"on-line",ref:makeLineRef(e.id),t:q.t};bd=d;}
      }
    }
    if(!best&&snapEnabled("grid")){
      const ss=gridStep(),g={x:Math.round((p.x-state.origin.x)/ss)*ss+state.origin.x,y:Math.round((p.y-state.origin.y)/ss)*ss+state.origin.y,kind:"grid"};
      if(dist(p,g)<tol)best=g;
    }
    return best;
  }
  function handleHitTest(p,{includeLineCenter=false}={}){
    const tol=9/state.view.scale;let best=null,bd=Infinity;
    for(const e of state.entities){
      if(e.type==="line"){
        for(const ref of lineRefs(e)){
          const q=getRefPoint(ref),dd=dist(p,q);
          if(dd<tol&&dd<bd){best={type:"ref",ref,entity:e.id};bd=dd;}
        }
        if(includeLineCenter){
          const q=lineMidpoint(e),dd=dist(p,q);
          if(dd<tol&&dd<bd){best={type:"lineCenter",entity:e.id};bd=dd;}
        }
      }else if(e.type==="point"){
        const ref=makePointRef(e.id),q=getRefPoint(ref),dd=dist(p,q);
        if(dd<tol&&dd<bd){best={type:"ref",ref,entity:e.id};bd=dd;}
      }else if(e.type==="circle"){
        const ref=makeCenterRef(e.id),q=getRefPoint(ref),dd=dist(p,q);
        if(dd<tol&&dd<bd){best={type:"ref",ref,entity:e.id};bd=dd;}
      }
    }
    return best;
  }
  function pickTargetAt(p){
    const tol=10/state.view.scale;
    if(dist(p,state.origin)<tol)return{kind:"origin"};
    const h=handleHitTest(p,{includeLineCenter:false});
    if(h?.type==="ref")return clone(h.ref);
    const hit=hitTest(p);
    return hit?{kind:"entity",entity:hit.id}:null;
  }
  function entityDistance(e,p){
    if(e.type==="line")return distanceToSegment(p,{x:e.x1,y:e.y1},{x:e.x2,y:e.y2});
    if(e.type==="circle")return Math.abs(dist(p,{x:e.cx,y:e.cy})-e.r);
    if(e.type==="arc"){
      const a=normalizeAngle(deg(Math.atan2(p.y-e.cy,p.x-e.cx)));return angleOnArc(a,e.start,e.end)?Math.abs(dist(p,{x:e.cx,y:e.cy})-e.r):Infinity;
    }
    if(e.type==="point")return dist(p,e);
    return Infinity;
  }
  function hitTest(p){
    const tol=8/state.view.scale;let best=null,bd=Infinity;
    for(const e of state.entities){const d=entityDistance(e,p);if(d<tol&&d<bd){best=e;bd=d;}}
    return best;
  }

  function addConstraintObject(c){
    c.id=c.id||uid("K");c.source=c.source||"manual";stampRule(c);state.constraints.push(c);markRulesDirty(c.order);return c;
  }
  function addFixedRef(ref,source="manual"){
    const p=getRefPoint(ref);if(!p)return null;
    return addConstraintObject({type:"fixed",ref:clone(ref),x:p.x,y:p.y,entities:ref.entity?[ref.entity]:[],source});
  }
  function autoAttachSnap(newRef,snap){
    if(!snap?.ref)return;
    if(snap.kind==="origin"){
      addConstraintObject({type:"coincident",a:{kind:"origin"},b:clone(newRef),master:"a",entities:[newRef.entity],source:"auto"});
    }else if(["on-line","midpoint"].includes(snap.kind)&&snap.ref.kind==="line"&&snap.ref.entity!==newRef.entity){
      addConstraintObject({type:"coincident",mode:"point-line",point:clone(newRef),line:clone(snap.ref),entities:[newRef.entity,snap.ref.entity],source:"auto"});
    }else if(["endpoint","center","point"].includes(snap.kind)&&snap.ref.entity!==newRef.entity){
      addConstraintObject({type:"coincident",a:clone(snap.ref),b:clone(newRef),master:"a",entities:[snap.ref.entity,newRef.entity],source:"auto"});
    }
  }
  function inferLineOrientation(start,p,hasHardSnap){
    const dx=p.x-start.x,dy=p.y-start.y;if(Math.hypot(dx,dy)<EPS)return null;
    const a=lineAngle({x1:start.x,y1:start.y,x2:p.x,y2:p.y});
    const h=Math.min(angleDelta(a,0),angleDelta(a,180)),v=Math.min(angleDelta(a,90),angleDelta(a,270));
    if(hasHardSnap)return h<0.15?"horizontal":v<0.15?"vertical":null;
    if(h<4)return"horizontal";if(v<4)return"vertical";return null;
  }

  function addLineFromPoints(a,b,startSnap=null,endSnap=null,inference=null,source="draw"){
    const e={id:uid("L"),type:"line",x1:round2(a.x),y1:round2(a.y),x2:round2(b.x),y2:round2(b.y)};
    state.entities.push(e);
    // La única restricción automática de construcción es Coincidente.
    autoAttachSnap(makeEndpointRef(e.id,"start"),startSnap);
    autoAttachSnap(makeEndpointRef(e.id,"end"),endSnap);
    return e;
  }
  function createRectangle(a,b,startSnap=null,endSnap=null){
    const x1=round2(a.x),y1=round2(a.y),x2=round2(b.x),y2=round2(b.y);
    const top={id:uid("L"),type:"line",x1,y1,x2,y2:y1};
    const right={id:uid("L"),type:"line",x1:x2,y1,x2,y2};
    const bottom={id:uid("L"),type:"line",x1:x2,y1:y2,x2:x1,y2};
    const left={id:uid("L"),type:"line",x1,y1:y2,x2:x1,y2:y1};
    state.entities.push(top,right,bottom,left);
    autoAttachSnap(makeEndpointRef(top.id,"start"),startSnap);
    autoAttachSnap(makeEndpointRef(right.id,"end"),endSnap);
    const pairs=[
      [makeEndpointRef(top.id,"end"),makeEndpointRef(right.id,"start")],
      [makeEndpointRef(right.id,"end"),makeEndpointRef(bottom.id,"start")],
      [makeEndpointRef(bottom.id,"end"),makeEndpointRef(left.id,"start")],
      [makeEndpointRef(left.id,"end"),makeEndpointRef(top.id,"start")]
    ];
    for(const[aRef,bRef]of pairs)addConstraintObject({
      type:"coincident",a:aRef,b:bRef,master:"a",
      entities:[aRef.entity,bRef.entity],source:"auto"
    });

    // Restricciones estructurales precargadas del rectángulo.
    // No fijan posición ni tamaño: sólo mantienen la geometría ortogonal.
    addConstraintObject({type:"horizontal",entities:[top.id],source:"auto"});
    addConstraintObject({type:"vertical",entities:[right.id],source:"auto"});
    addConstraintObject({type:"horizontal",entities:[bottom.id],source:"auto"});
    addConstraintObject({type:"vertical",entities:[left.id],source:"auto"});

    return[top,right,bottom,left];
  }

  function currentSelectionItems(){
    if(state.pickSelection.length)return clone(state.pickSelection);
    if(state.selectedRef)return[clone(state.selectedRef)];
    if(state.selected.length)return state.selected.map(id=>({kind:"entity",entity:id}));
    return[];
  }
  function syncLegacySelectionFromPicks(){
    state.selected=state.pickSelection.filter(item=>item.kind==="entity").map(item=>item.entity);
    state.selectedRef=state.pickSelection.length===1&&state.pickSelection[0].kind!=="entity"&&state.pickSelection[0].kind!=="origin"?clone(state.pickSelection[0]):null;
  }
  function setTool(tool){
    const carried=currentSelectionItems();
    state.tool=tool;state.draft=null;state.snap=null;state.activeDimension=null;state.drag=null;state.hoverHandle=null;
    state.dimensionPlacement=null;
    if(tool!=="dimension")state.dimensionOption=null;
    if(["dimension","constraint"].includes(tool)){
      state.pickSelection=carried;state.selected=[];state.selectedRef=null;
    }else if(tool==="select"){
      state.pickSelection=carried;syncLegacySelectionFromPicks();
    }else{
      state.pickSelection=[];state.selected=[];state.selectedRef=null;
    }
    toolButtons().forEach(b=>b.classList.toggle("active",b.dataset.tool===tool));
    const labels={
      select:"Seleccionar · arrastra un endpoint para deformar o el centro de una línea para moverla",
      line:"Línea · endpoints independientes · Coincidente automático sobre puntos o líneas",
      rect:"Rectángulo · se crea como 4 líneas con esquinas coincidentes",
      circle:"Círculo · centro y radio; agrega diámetro con Cota",
      point:"Punto · clic para colocar",
      dimension:"Cota · línea = longitud · dos puntos/líneas = distancia · líneas conectadas = ángulo",
      constraint:"Restricción · selecciona puntos, endpoints o líneas y elige la relación",
      trim:"Trim · clic sobre el tramo entre intersecciones",
      pan:"Mano · arrastra la vista",
      delete:"Eliminar · clic sobre una entidad"
    };
    setStatus(labels[tool]||tool);updateContextBar();updateProperties();draw();
  }

  function ruleEntityIds(rule){
    if(!rule)return[];
    const ids=new Set();
    if(rule.entity)ids.add(rule.entity);
    for(const id of rule.entities||[])if(id)ids.add(id);
    if(rule.a?.entity)ids.add(rule.a.entity);
    if(rule.b?.entity)ids.add(rule.b.entity);
    if(rule.point?.entity)ids.add(rule.point.entity);
    if(rule.line?.entity)ids.add(rule.line.entity);
    if(rule.lineA)ids.add(rule.lineA);
    if(rule.lineB)ids.add(rule.lineB);
    if(rule.ref?.entity)ids.add(rule.ref.entity);
    return [...ids].filter(id=>entity(id));
  }
  function focusRule(rule,kind){
    if(!rule)return;
    state.selectedRule={kind,id:rule.id};
    state.activeDimension=kind==="dimension"?rule.id:null;
    const ids=ruleEntityIds(rule);
    state.selected=[];
    state.selectedRef=null;
    state.pickSelection=ids.length?[{kind:"entity",entity:ids[0]}]:[];
    updateProperties();updateContextBar();draw();
    if(kind==="dimension")focusActiveDimensionInput();
    setStatus(`P${rule.order||"?"} seleccionada · Supr/Delete elimina esta ${kind==="dimension"?"cota":"restricción"}.`);
  }
  function deleteSelectedRule(){
    const sel=state.selectedRule;if(!sel)return false;
    const rule=ruleById(sel.id);
    if(!rule){state.selectedRule=null;return false;}
    removeRelation(sel.kind,sel.id);
    state.selectedRule=null;
    state.activeDimension=null;
    updateProperties();updateContextBar();draw();
    return true;
  }

  function pointInWorldRect(p,r){
    return !!p&&p.x>=r.minX-EPS&&p.x<=r.maxX+EPS&&p.y>=r.minY-EPS&&p.y<=r.maxY+EPS;
  }
  function segmentIntersectsWorldRect(a,b,r){
    if(pointInWorldRect(a,r)||pointInWorldRect(b,r))return true;
    const c1={x:r.minX,y:r.minY},c2={x:r.maxX,y:r.minY},c3={x:r.maxX,y:r.maxY},c4={x:r.minX,y:r.maxY};
    return !!(lineIntersection(a,b,c1,c2)||lineIntersection(a,b,c2,c3)||lineIntersection(a,b,c3,c4)||lineIntersection(a,b,c4,c1));
  }
  function entityFullyInsideRect(e,r){
    if(e.type==="line")return pointInWorldRect({x:e.x1,y:e.y1},r)&&pointInWorldRect({x:e.x2,y:e.y2},r);
    if(e.type==="point")return pointInWorldRect(e,r);
    if(e.type==="circle")return e.cx-e.r>=r.minX&&e.cx+e.r<=r.maxX&&e.cy-e.r>=r.minY&&e.cy+e.r<=r.maxY;
    const b=entityBBox(e);return b&&b.minX>=r.minX&&b.maxX<=r.maxX&&b.minY>=r.minY&&b.maxY<=r.maxY;
  }
  function entityCrossesRect(e,r){
    if(entityFullyInsideRect(e,r))return true;
    if(e.type==="line")return segmentIntersectsWorldRect({x:e.x1,y:e.y1},{x:e.x2,y:e.y2},r);
    if(e.type==="point")return pointInWorldRect(e,r);
    const b=entityBBox(e);return !!b&&!(b.maxX<r.minX||b.minX>r.maxX||b.maxY<r.minY||b.minY>r.maxY);
  }
  function beginSelectionBox(screen,ev){
    state.selectionBox={
      startScreen:{x:screen.x,y:screen.y},
      endScreen:{x:screen.x,y:screen.y},
      additive:!!(ev.ctrlKey||ev.metaKey||ev.shiftKey),
      moved:false,
      pointerId:ev.pointerId
    };
    canvas.setPointerCapture(ev.pointerId);
    return true;
  }
  function updateSelectionBox(screen){
    const b=state.selectionBox;if(!b)return false;
    b.endScreen={x:screen.x,y:screen.y};
    b.moved=Math.hypot(b.endScreen.x-b.startScreen.x,b.endScreen.y-b.startScreen.y)>=3;
    draw();return true;
  }
  function finishSelectionBox(){
    const b=state.selectionBox;if(!b)return;
    state.selectionBox=null;
    if(!b.moved){
      if(!b.additive){
        state.pickSelection=[];state.selected=[];state.selectedRef=null;state.activeDimension=null;state.selectedRule=null;
        updateProperties();updateContextBar();draw();
      }
      return;
    }
    const w1=screenToWorld(b.startScreen.x,b.startScreen.y),w2=screenToWorld(b.endScreen.x,b.endScreen.y);
    const r={minX:Math.min(w1.x,w2.x),maxX:Math.max(w1.x,w2.x),minY:Math.min(w1.y,w2.y),maxY:Math.max(w1.y,w2.y)};
    const crossing=b.endScreen.x<b.startScreen.x;
    const found=[];

    for(const e of state.entities){
      if(e.type==="line"){
        const sr=makeEndpointRef(e.id,"start"),er=makeEndpointRef(e.id,"end");
        const sp=getRefPoint(sr),ep=getRefPoint(er);
        const sIn=pointInWorldRect(sp,r),eIn=pointInWorldRect(ep,r);
        if(sIn)found.push(sr);
        if(eIn)found.push(er);
        if(!sIn&&!eIn){
          const hit=crossing?entityCrossesRect(e,r):entityFullyInsideRect(e,r);
          if(hit)found.push({kind:"entity",entity:e.id});
        }
      }else if(e.type==="point"){
        if(pointInWorldRect(e,r))found.push(makePointRef(e.id));
      }else if(e.type==="circle"){
        const center=makeCenterRef(e.id);
        if(pointInWorldRect(getRefPoint(center),r))found.push(center);
        else if(crossing?entityCrossesRect(e,r):entityFullyInsideRect(e,r))found.push({kind:"entity",entity:e.id});
      }else{
        const hit=crossing?entityCrossesRect(e,r):entityFullyInsideRect(e,r);
        if(hit)found.push({kind:"entity",entity:e.id});
      }
    }

    const base=b.additive?state.pickSelection.slice():[];
    const byKey=new Map(base.map(x=>[selectionItemKey(x),x]));
    for(const item of found)byKey.set(selectionItemKey(item),item);
    state.pickSelection=[...byKey.values()];
    syncLegacySelectionFromPicks();
    state.activeDimension=null;state.selectedRule=null;
    updateProperties();updateContextBar();draw();
    setStatus(`${state.pickSelection.length} elemento${state.pickSelection.length===1?"":"s"} seleccionado${state.pickSelection.length===1?"":"s"} por ventana.`);
  }

  function normalSelectionClick(p,ev){
    const multi=!!(ev.ctrlKey||ev.metaKey||ev.shiftKey);
    const tol=10/state.view.scale;
    let item=null;
    if(dist(p,state.origin)<tol)item={kind:"origin"};
    if(!item){
      const h=handleHitTest(p,{includeLineCenter:true});
      if(h?.type==="ref")item=clone(h.ref);
      else if(h?.type==="lineCenter")item={kind:"entity",entity:h.entity};
    }
    if(!item){
      const hit=hitTest(p);
      if(hit)item={kind:"entity",entity:hit.id};
    }

    if(!item){
      if(!multi)state.pickSelection=[];
    }else{
      const key=selectionItemKey(item),idx=state.pickSelection.findIndex(x=>selectionItemKey(x)===key);
      if(multi){
        if(idx>=0)state.pickSelection.splice(idx,1);
        else state.pickSelection.push(item);
      }else{
        state.pickSelection=[item];
      }
    }
    syncLegacySelectionFromPicks();
    state.activeDimension=null;
    state.selectedRule=null;
    state.dimensionPlacement=null;
    state.dimensionOption=null;
    updateProperties();updateContextBar();draw();
  }

  function pickSelectionClick(p){
    const item=pickTargetAt(p);
    if(!item){state.pickSelection=[];state.activeDimension=null;updateProperties();updateContextBar();draw();return;}
    const key=selectionItemKey(item),idx=state.pickSelection.findIndex(x=>selectionItemKey(x)===key);
    if(idx>=0)state.pickSelection.splice(idx,1);
    else{
      if(state.pickSelection.length>=2)state.pickSelection=[];
      state.pickSelection.push(item);
    }
    state.activeDimension=null;
    state.dimensionPlacement=null;
    state.dimensionOption=null;
    updateProperties();updateContextBar();draw();
  }
  function pickedEntities(){return state.pickSelection.filter(x=>x.kind==="entity").map(x=>entity(x.entity)).filter(Boolean);}
  function pickedPointRefs(){return state.pickSelection.filter(x=>x.kind!=="entity"&&isPointRef(x));}
  function constraintAvailability(){
    const ents=pickedEntities(),pts=pickedPointRefs();
    return{
      horizontal:ents.length===1&&pts.length===0&&ents[0].type==="line",
      vertical:ents.length===1&&pts.length===0&&ents[0].type==="line",
      fixed:pts.length===1&&ents.length===0,
      coincident:(pts.length===2&&ents.length===0)||(pts.length===1&&ents.length===1&&ents[0].type==="line"),
      parallel:pts.length===0&&ents.length===2&&ents.every(e=>e.type==="line"),
      perpendicular:pts.length===0&&ents.length===2&&ents.every(e=>e.type==="line"),
    };
  }
  function updateConstraintToolbar(){
    const availability=constraintAvailability();
    document.querySelectorAll(".cad-constraint-action[data-constraint]").forEach(btn=>{
      const kind=btn.dataset.constraint;
      btn.disabled=!availability[kind];
    });
  }
  function pickIncludesEntity(id){return state.pickSelection.some(x=>x.entity===id);}

  function handleCreateClick(p,snap){
    if(state.tool==="point"){
      mutate(()=>{const e={id:uid("P"),type:"point",x:round2(p.x),y:round2(p.y)};state.entities.push(e);autoAttachSnap(makePointRef(e.id),snap);},{dirtyFrom:state.nextRuleOrder});
      return;
    }
    if(state.tool==="line"){
      if(!state.draft){
        state.draft={type:"line",x1:p.x,y1:p.y,x2:p.x,y2:p.y,startSnap:snap?clone(snap):null,inference:null};
      }else{
        const d=state.draft,end={x:p.x,y:p.y},endSnap=snap?clone(snap):null,inference=d.inference;
        mutate(()=>addLineFromPoints({x:d.x1,y:d.y1},end,d.startSnap,endSnap,inference),{dirtyFrom:state.nextRuleOrder});
        state.draft=null;
      }updateContextBar();draw();return;
    }
    if(state.tool==="rect"){
      if(!state.draft)state.draft={type:"rect",x:p.x,y:p.y,w:0,h:0,startSnap:snap?clone(snap):null};
      else{
        const d=state.draft;mutate(()=>createRectangle({x:d.x,y:d.y},p,d.startSnap,snap?clone(snap):null),{dirtyFrom:state.nextRuleOrder});state.draft=null;
      }draw();return;
    }
    if(state.tool==="circle"){
      if(!state.draft)state.draft={type:"circle",cx:p.x,cy:p.y,r:0,centerSnap:snap?clone(snap):null};
      else{
        const d=state.draft;mutate(()=>{
          const e={id:uid("C"),type:"circle",cx:round2(d.cx),cy:round2(d.cy),r:round2(dist({x:d.cx,y:d.cy},p))};state.entities.push(e);
          autoAttachSnap(makeCenterRef(e.id),d.centerSnap);
        },{dirtyFrom:state.nextRuleOrder});state.draft=null;
      }draw();
    }
  }

  function focusActiveDimensionInput(){
    requestAnimationFrame(()=>{
      const inp=opts.contextFieldsEl?.querySelector("#activeDimInput");
      if(inp){inp.focus();inp.select();}
    });
  }
  function activateDimensionOnly(d){
    if(!d)return;
    state.activeDimension=d.id;
    state.selected=[];
    state.selectedRef=null;
    state.pickSelection=[];
    refreshAll();
    if(d.rejected)setStatus(`P${d.order}: sobrerrestricción. Esta cota se ignora para conservar las relaciones anteriores.`);
    else setStatus(`P${d.order}: cota activa.`);
    updateContextBar();
    focusActiveDimensionInput();
  }

  function addOrSelectDimension(type,e,point=null){
    let d=dimBy(e.id,type,point);
    if(!d){
      const wasFull=entityState(e.id)==="full";
      let value=0;
      if(type==="length")value=lineLength(e);
      else if(type==="angle")value=lineAngle(e);
      else if(type==="diameter")value=e.r*2;
      d={id:uid("D"),type,entity:e.id,point:point||undefined,value:round2(value),conflict:wasFull,reason:wasFull?"Sobrerrestricción: la entidad ya estaba totalmente definida.":undefined};
      addDimensionObject(d);
    }
    activateDimensionOnly(d);
  }
  function addOrSelectPointCoordinate(ref,axis){
    if(!ref||ref.kind==="origin")return;
    const e=entity(ref.entity);if(!e)return;
    let type=null,point=null;
    if(ref.kind==="endpoint"){type=axis==="x"?"endpointX":"endpointY";point=ref.point;}
    else if(ref.kind==="point")type=axis==="x"?"pointX":"pointY";
    else if(ref.kind==="center")type=axis==="x"?"centerX":"centerY";
    if(!type)return;
    let d=dimBy(e.id,type,point);
    if(!d){
      const p=getRefPoint(ref),wasFull=entityState(e.id)==="full";
      d={id:uid("D"),type,entity:e.id,point:point||undefined,value:round2(axis==="x"?p.x:p.y),conflict:wasFull,reason:wasFull?"Sobrerrestricción: el punto ya estaba totalmente definido.":undefined};
      addDimensionObject(d);
    }
    activateDimensionOnly(d);
  }
  function editDimension(id,value){
    const d=state.dimensions.find(x=>x.id===id);if(!d)return;
    const parsed=Number(value);if(!Number.isFinite(parsed))return;
    mutate(()=>{d.value=round2(parsed);markRulesDirty(d.order);});
    state.activeDimension=id;
    state.selected=[];state.selectedRef=null;state.pickSelection=[];
    if(d.rejected)setStatus(`P${d.order}: el nuevo valor entra en conflicto después de recalcular P1…P${d.order}.`);
    else setStatus(`P${d.order}: valor actualizado y croquis recalculado.`);
    updateContextBar();
    focusActiveDimensionInput();
  }
  function addOrSelectAngleBetween(a,b){
    const info=angleBetweenConnectedLines(a,b);
    if(!info){setStatus("Para acotar un ángulo, las dos líneas deben compartir un punto coincidente.");return;}
    let d=state.dimensions.find(x=>x.type==="angleBetween"&&x.entities?.includes(a.id)&&x.entities?.includes(b.id));
    if(!d){
      const wasFull=entityState(a.id)==="full"&&entityState(b.id)==="full";
      d={id:uid("D"),type:"angleBetween",entities:[a.id,b.id],value:round2(info.value),sign:info.sign,conflict:wasFull,reason:wasFull?"Sobrerrestricción: ambas líneas ya estaban totalmente definidas.":undefined};
      addDimensionObject(d);
    }
    activateDimensionOnly(d);
  }
  function addOrSelectDistancePP(a,b){
    const ka=refKey(a),kb=refKey(b);
    let d=state.dimensions.find(x=>x.type==="distancePP"&&(
      (refKey(x.a)===ka&&refKey(x.b)===kb)||(refKey(x.a)===kb&&refKey(x.b)===ka)
    ));
    if(!d){
      const pa=getRefPoint(a),pb=getRefPoint(b);if(!pa||!pb)return;
      const full=[a.entity,b.entity].filter(Boolean).every(id=>entityState(id)==="full");
      d={id:uid("D"),type:"distancePP",a:clone(a),b:clone(b),value:round2(dist(pa,pb)),conflict:full,reason:full?"Sobrerrestricción: ambos puntos ya están definidos.":undefined};
      addDimensionObject(d);
    }
    activateDimensionOnly(d);
  }
  function addOrSelectDistancePL(point,lineId){
    const k=refKey(point);
    let d=state.dimensions.find(x=>x.type==="distancePL"&&refKey(x.point)===k&&x.line?.entity===lineId);
    const line=entity(lineId),p=getRefPoint(point);if(!line||!p)return;
    if(!d){
      const signed=signedPointLineDistance(p,line),full=entityState(point.entity)==="full"&&entityState(line.id)==="full";
      d={id:uid("D"),type:"distancePL",point:clone(point),line:makeLineRef(lineId),value:round2(Math.abs(signed)),sign:signed<0?-1:1,conflict:full,reason:full?"Sobrerrestricción: el punto y la línea ya están definidos.":undefined};
      addDimensionObject(d);
    }
    activateDimensionOnly(d);
  }
  function addOrSelectDistanceLL(a,b){
    let d=state.dimensions.find(x=>x.type==="distanceLL"&&(
      (x.lineA===a.id&&x.lineB===b.id)||(x.lineA===b.id&&x.lineB===a.id)
    ));
    if(!d){
      const signed=signedPointLineDistance(lineMidpoint(b),a),full=entityState(a.id)==="full"&&entityState(b.id)==="full";
      d={id:uid("D"),type:"distanceLL",lineA:a.id,lineB:b.id,value:round2(Math.abs(signed)),sign:signed<0?-1:1,conflict:full,reason:full?"Sobrerrestricción: ambas líneas ya están definidas.":undefined};
      addDimensionObject(d);
    }
    activateDimensionOnly(d);
  }
  function addDistanceFromCurrentPicks(){
    const pts=pickedPointRefs(),ents=pickedEntities();
    if(pts.length===2&&ents.length===0){addOrSelectDistancePP(pts[0],pts[1]);return;}
    if(pts.length===1&&ents.length===1&&ents[0].type==="line"){addOrSelectDistancePL(pts[0],ents[0].id);return;}
    if(pts.length===0&&ents.length===2&&ents.every(e=>e.type==="line")){addOrSelectDistanceLL(ents[0],ents[1]);return;}
    setStatus("Selecciona punto+punto, punto+línea o línea+línea.");
  }

  function logicalConstraintConflict(kind,sel){
    if(sel.every(e=>entityState(e.id)==="full"))return"Las entidades seleccionadas ya están totalmente restringidas.";
    if(kind==="horizontal"&&sel[0]&&constraintBy("vertical",sel[0].id)&&lineLength(sel[0])>SOLVE_TOL)return"Una línea no puede ser horizontal y vertical al mismo tiempo.";
    if(kind==="vertical"&&sel[0]&&constraintBy("horizontal",sel[0].id)&&lineLength(sel[0])>SOLVE_TOL)return"Una línea no puede ser vertical y horizontal al mismo tiempo.";
    if(["parallel","perpendicular"].includes(kind)&&sel.length===2){
      const pair=state.constraints.find(c=>!c.conflict&&["parallel","perpendicular"].includes(c.type)&&new Set(c.entities).size===2&&c.entities.includes(sel[0].id)&&c.entities.includes(sel[1].id));
      if(pair&&pair.type!==kind)return`Ya existe una restricción ${pair.type==="parallel"?"paralela":"perpendicular"} entre estas líneas.`;
    }
    return null;
  }
  function addManualConstraint(kind){
    const ents=pickedEntities(),pts=pickedPointRefs();
    const involved=[...new Set(state.pickSelection.map(selectionItemEntityId).filter(Boolean))].map(entity).filter(Boolean);
    const reason=involved.length&&involved.every(e=>entityState(e.id)==="full")?"Las entidades seleccionadas ya están totalmente restringidas.":null;
    let c=null;
    if(kind==="horizontal"||kind==="vertical"){
      if(ents.length!==1||pts.length!==0||ents[0].type!=="line"){setStatus("Selecciona una línea.");return;}
      const e=ents[0];
      if(state.constraints.some(x=>!x.conflict&&x.type===kind&&x.entities?.[0]===e.id)){setStatus("Esa restricción ya existe.");return;}
      const opposite=kind==="horizontal"?"vertical":"horizontal";
      const conflict=constraintBy(opposite,e.id)&&lineLength(e)>SOLVE_TOL;
      c={type:kind,entities:[e.id],source:"manual",conflict:!!conflict,reason:conflict?`Una línea no puede ser ${kind==="horizontal"?"horizontal":"vertical"} y ${opposite} al mismo tiempo.`:undefined};
    }else if(kind==="fixed"){
      if(pts.length!==1||ents.length!==0){setStatus("Selecciona un endpoint, punto o centro.");return;}
      const p=getRefPoint(pts[0]);if(!p)return;
      c={type:"fixed",ref:clone(pts[0]),x:p.x,y:p.y,entities:pts[0].entity?[pts[0].entity]:[],source:"manual"};
    }else if(kind==="coincident"){
      if(pts.length===2&&ents.length===0){
        c={type:"coincident",a:clone(pts[0]),b:clone(pts[1]),master:"a",entities:[pts[0].entity,pts[1].entity].filter(Boolean),source:"manual"};
      }else if(pts.length===1&&ents.length===1&&ents[0].type==="line"){
        c={type:"coincident",mode:"point-line",point:clone(pts[0]),line:makeLineRef(ents[0].id),entities:[pts[0].entity,ents[0].id].filter(Boolean),source:"manual"};
      }else{setStatus("Para Coincidente selecciona punto+punto o punto+línea.");return;}
    }else if(kind==="parallel"||kind==="perpendicular"){
      if(ents.length!==2||pts.length!==0||ents.some(e=>e.type!=="line")){setStatus("Selecciona dos líneas.");return;}
      const pair=state.constraints.find(x=>!x.conflict&&["parallel","perpendicular"].includes(x.type)&&x.entities?.includes(ents[0].id)&&x.entities?.includes(ents[1].id));
      if(pair&&pair.type!==kind)c={type:kind,entities:[ents[0].id,ents[1].id],source:"manual",conflict:true,reason:`Ya existe una restricción ${pair.type==="parallel"?"paralela":"perpendicular"} entre estas líneas.`};
      else c={type:kind,entities:[ents[0].id,ents[1].id],source:"manual"};
    }
    if(!c)return;
    if(reason&&!c.conflict){c.conflict=true;c.reason="Sobrerrestricción: "+reason;}
    mutate(()=>addConstraintObject(c));
    if(c.rejected)setStatus(`P${c.order}: sobrerrestricción. La nueva restricción se ignora y se conservan las anteriores.`);
    else setStatus(`P${c.order}: restricción aplicada.`);
    updateContextBar();
  }

  function relationLabel(r){
    if(r.type==="horizontal")return"Horizontal";
    if(r.type==="vertical")return"Vertical";
    if(r.type==="coincident")return r.mode==="point-line"?"Coincidente · punto sobre línea":"Coincidente";
    if(r.type==="parallel")return"Paralelo";
    if(r.type==="perpendicular")return"Perpendicular";
    if(r.type==="equalLength")return"Igual longitud";
    if(r.type==="fixed")return"Fijo";
    return r.type;
  }
  function dimensionLabelText(d){
    if(d.type==="distancePP")return`Distancia punto-punto ${fmt(d.value)} mm`;
    if(d.type==="distancePL")return`Distancia punto-línea ${fmt(d.value)} mm`;
    if(d.type==="distanceLL")return`Distancia línea-línea ${fmt(d.value)} mm`;
    if(d.type==="length")return`Longitud ${fmt(d.value)} mm`;
    if(d.type==="angleBetween")return`Ángulo ${fmt(d.value)}°`;
    if(d.type==="angle")return`Ángulo ${fmt(d.value)}°`;
    if(d.type==="endpointX")return`X ${d.point==="start"?"inicio":"fin"} ${fmt(d.value)}`;
    if(d.type==="endpointY")return`Y ${d.point==="start"?"inicio":"fin"} ${fmt(d.value)}`;
    if(d.type==="diameter")return`Diámetro ${fmt(d.value)} mm`;
    if(d.type==="centerX")return`Centro X ${fmt(d.value)}`;
    if(d.type==="centerY")return`Centro Y ${fmt(d.value)}`;
    if(d.type==="pointX")return`X ${fmt(d.value)}`;
    if(d.type==="pointY")return`Y ${fmt(d.value)}`;
    return d.type;
  }
  function removeRelation(kind,id){
    const removed=(kind==="constraint"?state.constraints:state.dimensions).find(x=>x.id===id);
    mutate(()=>{
      if(kind==="constraint")state.constraints=state.constraints.filter(x=>x.id!==id);
      else state.dimensions=state.dimensions.filter(x=>x.id!==id);
      if(state.activeDimension===id)state.activeDimension=null;
      if(state.selectedRule?.id===id)state.selectedRule=null;
      markRulesDirty(removed?.order||1);
    });
    if(removed)setStatus(`P${removed.order||"?"} eliminada · se recalcularon todas las cotas y restricciones restantes.`);
    updateContextBar();
  }

  function updateProperties(){
    const el=opts.propertiesEl;if(!el)return;
    const ids=state.selected.length?[...state.selected]:[...new Set(state.pickSelection.map(selectionItemEntityId).filter(Boolean))];
    if(!ids.length&&state.pickSelection.length===0){el.innerHTML='<div class="cad-props-empty">Selecciona una línea, endpoint, punto, origen o cota.</div>';return;}
    if(state.pickSelection.length>1){
      const parts=state.pickSelection.map(item=>{
        if(item.kind==="entity")return entity(item.entity)?.type==="line"?"Línea":"Entidad";
        if(item.kind==="endpoint")return`Endpoint ${item.point==="start"?"inicio":"fin"}`;
        if(item.kind==="point")return"Punto";
        if(item.kind==="center")return"Centro";
        if(item.kind==="origin")return"Origen";
        return item.kind;
      });
      el.innerHTML=`<div class="selection-head"><span class="selection-title">${state.pickSelection.length} elementos seleccionados</span></div><div class="cad-props-empty">${parts.join(" + ")}</div>`;
      return;
    }
    if(state.pickSelection.length===1&&state.pickSelection[0].kind==="origin"){
      el.innerHTML='<div class="selection-head"><span class="selection-title">ORIGEN 0,0</span></div><div class="cad-props-empty">El origen puede participar en restricciones Coincidente y cotas de distancia.</div>';
      return;
    }
    const e=entity(ids[0]);if(!e)return;
    const st=entityState(e.id),stText=st==="full"?"Restringido":st==="conflict"?"Conflicto":"Libre";
    const pointSel=state.selectedRef||(state.pickSelection.length===1&&state.pickSelection[0].kind!=="entity"?state.pickSelection[0]:null);
    let title=e.type.toUpperCase();
    if(pointSel?.kind==="endpoint")title=`ENDPOINT ${pointSel.point==="start"?"INICIO":"FIN"}`;
    else if(pointSel?.kind==="point")title="PUNTO";
    else if(pointSel?.kind==="center")title="CENTRO";
    const cons=constraintsForEntity(e.id),dims=dimensionsForEntity(e.id);
    const rows=(items,kind,labelFn)=>items.map(r=>{
      const bad=ruleDiagnosticBad(r);
      const peer=diagnosticPeerText(r);
      let titleAttr="";
      if(r.rejected)titleAttr=r.reason||"Esta relación no puede satisfacerse.";
      else if(r.diagnosticConflict)titleAttr=`Esta relación anterior está involucrada en un conflicto con ${peer.replace(" · bloquea ","")}.`;
      else if(state.runtimeConflicts.has(r.id))titleAttr="Esta relación no converge en la solución actual.";
      const active=kind==="dimension"&&state.activeDimension===r.id;
      const priority=`P${r.order||"?"}`,ignored=r.rejected?" · ignorada":"";
      const ruleSelected=state.selectedRule?.id===r.id;
      return `<div class="relation-row ${bad?"conflict":""} ${active?"active":""} ${ruleSelected?"rule-selected":""}" title="${titleAttr.replaceAll('"','&quot;')}"><button class="relation-select" data-select-rule="${r.id}" data-rule-kind="${kind}"><strong>${priority}</strong> · ${labelFn(r)}${r.source==="auto"?" · auto":""}${ignored}${peer}</button><button class="relation-remove" data-remove-kind="${kind}" data-remove-id="${r.id}" title="Eliminar">×</button></div>`;
    }).join("");

    // Si una relación del elemento seleccionado tiene conflicto, mostrar también
    // la contraparte aunque pertenezca a otra línea. Así puede resolverse sin
    // navegar manualmente a la otra entidad.
    const localRules=[...dims,...cons];
    const peerIds=new Set();
    for(const r of localRules){
      for(const id of r.conflictWith||[])peerIds.add(id);
      for(const id of r.blockedBy||[])peerIds.add(id);
    }
    const conflictPeers=[...peerIds].map(ruleById).filter(Boolean).filter(r=>!localRules.some(x=>x.id===r.id));
    const conflictTree=conflictPeers.length
      ? `<div class="relation-section conflict-tree"><div class="relation-title">Conflicto relacionado</div><div class="relation-list">${conflictPeers.map(r=>rows([r],ruleKindById(r.id),ruleKindById(r.id)==="dimension"?dimensionLabelText:relationLabel)).join("")}</div></div>`
      : "";

    el.innerHTML=`
      <div class="selection-head"><div><div class="selection-title">${title}</div><div class="selection-meta">${e.id}</div></div><span class="state-pill ${st}">${stText}</span></div>
      ${pointSel?`<div class="cad-props-empty">Este punto puede seleccionarse y arrastrarse de forma independiente mientras conserve grados de libertad.</div>`:""}
      ${conflictTree}
      <div class="relation-section"><div class="relation-title">Cotas</div><div class="relation-list">${dims.length?rows(dims,"dimension",dimensionLabelText):'<span class="cad-props-empty">Sin cotas</span>'}</div></div>
      <div class="relation-section"><div class="relation-title">Restricciones</div><div class="relation-list">${cons.length?rows(cons,"constraint",relationLabel):'<span class="cad-props-empty">Sin restricciones</span>'}</div></div>`;
    el.querySelectorAll("[data-remove-id]").forEach(btn=>btn.addEventListener("click",()=>removeRelation(btn.dataset.removeKind,btn.dataset.removeId)));
    el.querySelectorAll("[data-select-rule]").forEach(btn=>btn.addEventListener("click",()=>{
      const id=btn.dataset.selectRule,kind=btn.dataset.ruleKind;
      const rule=ruleById(id);if(!rule)return;
      focusRule(rule,kind);
    }));
  }

  function contextButton(label,action,cls=""){return`<button class="context-action ${cls}" data-context-action="${action}">${label}</button>`;}
  function activeDimensionTitle(d){
    if(!d)return"Cota";
    if(["distancePP","distancePL","distanceLL"].includes(d.type))return"Distancia";
    if(d.type==="angleBetween"||d.type==="angle")return"Ángulo";
    if(d.type==="diameter")return"Diámetro";
    if(d.type==="length")return"Longitud";
    if(["endpointX","pointX","centerX"].includes(d.type))return"X";
    if(["endpointY","pointY","centerY"].includes(d.type))return"Y";
    return"Cota";
  }
  function availableDimensionActions(){
    const ents=pickedEntities(),pts=pickedPointRefs(),out=[];
    if(state.pickSelection.length===1){
      if(ents.length===1&&ents[0].type==="line")out.push("dim-length");
      else if(ents.length===1&&ents[0].type==="circle")out.push("dim-diameter");
      else if(pts.length===1&&pts[0].kind!=="origin")out.push("dim-point-x","dim-point-y");
    }else if(state.pickSelection.length===2){
      if(pts.length===2&&ents.length===0)out.push("dim-distance");
      else if(pts.length===1&&ents.length===1&&ents[0].type==="line")out.push("dim-distance");
      else if(pts.length===0&&ents.length===2&&ents.every(e=>e.type==="line")){
        if(connectedLineJoint(ents[0],ents[1]))out.push("dim-angle-between","dim-distance");
        else out.push("dim-distance");
      }
    }
    return out;
  }
  function defaultDimensionAction(){
    const available=availableDimensionActions();
    if(!available.length)return null;
    if(state.dimensionOption&&available.includes(state.dimensionOption))return state.dimensionOption;
    state.dimensionOption=available[0];
    return state.dimensionOption;
  }
  function executeContextAction(a){
    if(String(a).startsWith("dim-")){
      const available=availableDimensionActions();
      if(!available.includes(a))return;
      state.dimensionOption=a;
      state.dimensionPlacement=null;
      setStatus(`${dimensionActionTitle(a)} seleccionada · clic para medir.`);
      updateContextBar();draw();
      return;
    }
    if(a==="con-horizontal")addManualConstraint("horizontal");
    else if(a==="con-vertical")addManualConstraint("vertical");
    else if(a==="con-fixed")addManualConstraint("fixed");
    else if(a==="con-coincident")addManualConstraint("coincident");
    else if(a==="con-parallel")addManualConstraint("parallel");
    else if(a==="con-perpendicular")addManualConstraint("perpendicular");
  }
  function dimensionActionTitle(a){
    if(a==="dim-length")return"Longitud";
    if(a==="dim-diameter")return"Diámetro";
    if(a==="dim-point-x")return"X";
    if(a==="dim-point-y")return"Y";
    if(a==="dim-angle-between")return"Ángulo";
    if(a==="dim-distance")return"Distancia";
    return"Cota";
  }
  function findExistingDimensionForAction(action){
    const ents=pickedEntities(),pts=pickedPointRefs();
    if(action==="dim-length"&&ents[0])return dimBy(ents[0].id,"length");
    if(action==="dim-diameter"&&ents[0])return dimBy(ents[0].id,"diameter");
    if((action==="dim-point-x"||action==="dim-point-y")&&pts[0]&&pts[0].kind!=="origin"){
      const ref=pts[0],e=entity(ref.entity);if(!e)return null;
      let type=null,point=null;
      if(ref.kind==="endpoint"){type=action==="dim-point-x"?"endpointX":"endpointY";point=ref.point;}
      else if(ref.kind==="point")type=action==="dim-point-x"?"pointX":"pointY";
      else if(ref.kind==="center")type=action==="dim-point-x"?"centerX":"centerY";
      return type?dimBy(e.id,type,point):null;
    }
    if(action==="dim-angle-between"&&ents.length===2){
      return state.dimensions.find(x=>x.type==="angleBetween"&&x.entities?.includes(ents[0].id)&&x.entities?.includes(ents[1].id))||null;
    }
    if(action==="dim-distance"){
      if(pts.length===2&&ents.length===0){
        const ka=refKey(pts[0]),kb=refKey(pts[1]);
        return state.dimensions.find(x=>x.type==="distancePP"&&(
          (refKey(x.a)===ka&&refKey(x.b)===kb)||(refKey(x.a)===kb&&refKey(x.b)===ka)
        ))||null;
      }
      if(pts.length===1&&ents.length===1){
        return state.dimensions.find(x=>x.type==="distancePL"&&refKey(x.point)===refKey(pts[0])&&x.line?.entity===ents[0].id)||null;
      }
      if(pts.length===0&&ents.length===2){
        return state.dimensions.find(x=>x.type==="distanceLL"&&(
          (x.lineA===ents[0].id&&x.lineB===ents[1].id)||(x.lineA===ents[1].id&&x.lineB===ents[0].id)
        ))||null;
      }
    }
    return null;
  }
  function buildDimensionCandidate(action){
    const ents=pickedEntities(),pts=pickedPointRefs();

    if(action==="dim-length"&&ents.length===1&&ents[0].type==="line"){
      return{id:uid("D"),type:"length",entity:ents[0].id,value:round2(lineLength(ents[0]))};
    }
    if(action==="dim-diameter"&&ents.length===1&&ents[0].type==="circle"){
      return{id:uid("D"),type:"diameter",entity:ents[0].id,value:round2(ents[0].r*2)};
    }
    if((action==="dim-point-x"||action==="dim-point-y")&&pts.length===1&&pts[0].kind!=="origin"){
      const ref=pts[0],e=entity(ref.entity),p=getRefPoint(ref);if(!e||!p)return null;
      let type=null,point=null;
      if(ref.kind==="endpoint"){type=action==="dim-point-x"?"endpointX":"endpointY";point=ref.point;}
      else if(ref.kind==="point")type=action==="dim-point-x"?"pointX":"pointY";
      else if(ref.kind==="center")type=action==="dim-point-x"?"centerX":"centerY";
      if(!type)return null;
      return{id:uid("D"),type,entity:e.id,point:point||undefined,value:round2(action==="dim-point-x"?p.x:p.y)};
    }
    if(action==="dim-angle-between"&&ents.length===2&&ents.every(e=>e.type==="line")){
      const info=angleBetweenConnectedLines(ents[0],ents[1]);if(!info)return null;
      return{id:uid("D"),type:"angleBetween",entities:[ents[0].id,ents[1].id],value:round2(info.value),sign:info.sign};
    }
    if(action==="dim-distance"){
      if(pts.length===2&&ents.length===0){
        const a=getRefPoint(pts[0]),b=getRefPoint(pts[1]);if(!a||!b)return null;
        return{id:uid("D"),type:"distancePP",a:clone(pts[0]),b:clone(pts[1]),value:round2(dist(a,b))};
      }
      if(pts.length===1&&ents.length===1&&ents[0].type==="line"){
        const p=getRefPoint(pts[0]),line=ents[0];if(!p)return null;
        const signed=signedPointLineDistance(p,line);
        return{id:uid("D"),type:"distancePL",point:clone(pts[0]),line:makeLineRef(line.id),value:round2(Math.abs(signed)),sign:signed<0?-1:1};
      }
      if(pts.length===0&&ents.length===2&&ents.every(e=>e.type==="line")){
        const signed=signedPointLineDistance(lineMidpoint(ents[1]),ents[0]);
        return{id:uid("D"),type:"distanceLL",lineA:ents[0].id,lineB:ents[1].id,value:round2(Math.abs(signed)),sign:signed<0?-1:1};
      }
    }
    return null;
  }
  function updateDimensionPreviewPosition(world){
    const placement=state.dimensionPlacement;if(!placement?.candidate)return false;
    const g=dimensionGeometry(placement.candidate);if(!g)return false;
    placement.candidate.labelOffset={x:world.x-g.p.x,y:world.y-g.p.y};
    placement.cursor={x:world.x,y:world.y};
    return true;
  }
  function startDimensionPlacement(action,world){
    const available=availableDimensionActions();
    if(!action||!available.includes(action))return false;

    const existing=findExistingDimensionForAction(action);
    if(existing){
      activateDimensionOnly(existing);
      setStatus(`P${existing.order}: esta cota ya existe.`);
      return true;
    }

    const candidate=buildDimensionCandidate(action);
    if(!candidate)return false;
    state.dimensionOption=action;
    state.dimensionPlacement={action,candidate};
    updateDimensionPreviewPosition(world||state.lastPointerWorld);
    setStatus(`${dimensionActionTitle(action)} ${fmt(candidate.value)}${candidate.type==="angleBetween"?"°":" mm"} · mueve el cursor y haz clic para colocar.`);
    updateContextBar();draw();
    return true;
  }
  function commitDimensionPlacement(world){
    const placement=state.dimensionPlacement;if(!placement?.candidate)return false;
    updateDimensionPreviewPosition(world||placement.cursor||state.lastPointerWorld);
    const d=clone(placement.candidate);
    state.dimensionPlacement=null;
    mutate(()=>addDimensionObject(d));
    state.activeDimension=d.id;
    state.selected=[];state.selectedRef=null;state.pickSelection=[];
    state.dimensionOption=null;
    if(d.rejected)setStatus(`P${d.order}: cota colocada pero entra en conflicto.`);
    else setStatus(`P${d.order}: cota colocada.`);
    updateProperties();updateContextBar();draw();focusActiveDimensionInput();
    return true;
  }
  function confirmDefaultDimension(){
    if(state.tool!=="dimension"||state.activeDimension)return false;
    if(state.dimensionPlacement)return false;
    const action=defaultDimensionAction();
    if(!action)return false;
    return startDimensionPlacement(action,state.lastPointerWorld);
  }

  function updateContextBar(){
    updateConstraintToolbar();
    const el=opts.contextFieldsEl;if(!el)return;
    let html="";
    const active=state.dimensions.find(d=>d.id===state.activeDimension);
    const placement=state.dimensionPlacement;
    const ents=pickedEntities(),pts=pickedPointRefs();

    if(placement?.candidate&&state.tool==="dimension"){
      const d=placement.candidate;
      html=`<span class="context-title">Cota</span><span class="context-badge warn">Vista previa</span><span class="context-hint">${dimensionActionTitle(placement.action)} ${fmt(d.value)}${d.type==="angleBetween"?"°":" mm"} · clic para colocar</span>`;
    }else if(active&&["select","dimension"].includes(state.tool)){
      const badge=active.rejected
        ? `<span class="context-badge error">P${active.order} conflicto</span>`
        : `<span class="context-badge">P${active.order}</span>`;
      html=`<span class="context-title">Cota</span>${badge}<label class="context-input">${activeDimensionTitle(active)} <input id="activeDimInput" type="number" step="0.01" value="${fmt(active.value)}"></label>`;
    }else if(state.tool==="select"){
      const n=state.pickSelection.length;
      html=`<span class="context-hint">${n?`${n} seleccionado${n===1?"":"s"}`:"Seleccionar"}</span>`;
    }else if(state.tool==="line"){
      html='<span class="context-hint">Línea · inicio → fin</span>';
    }else if(state.tool==="rect"){
      html='<span class="context-hint">Rectángulo · dos esquinas</span>';
    }else if(state.tool==="circle"){
      html='<span class="context-hint">Círculo · centro → radio</span>';
    }else if(state.tool==="point"){
      html='<span class="context-hint">Punto · colocar</span>';
    }else if(state.tool==="dimension"){
      html='<span class="context-title">Cota</span>';
      const selected=defaultDimensionAction();
      const btn=(label,action)=>contextButton(label,action,selected===action?"primary selected":"");
      if(state.pickSelection.length===0){
        html+='<span class="context-hint">Selecciona geometría</span>';
      }else if(state.pickSelection.length===1){
        if(ents.length===1&&ents[0].type==="line")html+=btn("Longitud","dim-length");
        else if(ents.length===1&&ents[0].type==="circle")html+=btn("Diámetro","dim-diameter");
        else if(pts.length===1&&pts[0].kind!=="origin")html+=btn("X","dim-point-x")+btn("Y","dim-point-y");
        else html+='<span class="context-hint">Sin cota disponible</span>';
      }else if(state.pickSelection.length===2){
        if(pts.length===2&&ents.length===0)html+=btn("Distancia","dim-distance");
        else if(pts.length===1&&ents.length===1&&ents[0].type==="line")html+=btn("Distancia","dim-distance");
        else if(pts.length===0&&ents.length===2&&ents.every(e=>e.type==="line")){
          if(connectedLineJoint(ents[0],ents[1]))html+=btn("Ángulo","dim-angle-between")+btn("Distancia","dim-distance");
          else html+=btn("Distancia","dim-distance");
        }else html+='<span class="context-hint">Selección no compatible</span>';
      }
    }else if(state.tool==="constraint"){
      html='<span class="context-hint">Restricciones</span>';
    }else if(state.tool==="trim"){
      html='<span class="context-hint">Trim · selecciona tramo</span>';
    }else if(state.tool==="origin"){
      html='<span class="context-hint">Origen · colocar 0,0</span>';
    }else if(state.tool==="pan"){
      html='<span class="context-hint">Mano · arrastrar vista</span>';
    }else if(state.tool==="delete"){
      html='<span class="context-hint">Eliminar · seleccionar elemento</span>';
    }

    el.innerHTML=html;
    el.querySelectorAll("[data-context-action]").forEach(btn=>btn.addEventListener("click",()=>executeContextAction(btn.dataset.contextAction)));
    const inp=el.querySelector("#activeDimInput");
    if(inp){
      inp.addEventListener("change",()=>editDimension(state.activeDimension,inp.value));
      inp.addEventListener("keydown",ev=>{
        if(ev.key==="Enter"){
          ev.preventDefault();ev.stopPropagation();
          editDimension(state.activeDimension,inp.value);
        }
      });
    }
  }

  function refMatchesOldEndpoint(ref,oldId,point){
    return !!ref&&ref.kind==="endpoint"&&ref.entity===oldId&&ref.point===point;
  }
  function mapOldEndpointRef(ref,oldId,startMap,endMap){
    if(!ref||ref.kind!=="endpoint"||ref.entity!==oldId)return ref?clone(ref):ref;
    if(ref.point==="start")return startMap?clone(startMap):null;
    if(ref.point==="end")return endMap?clone(endMap):null;
    return null;
  }
  function lineDirectionUnit(e){
    if(!e||e.type!=="line")return null;
    const dx=e.x2-e.x1,dy=e.y2-e.y1,L=Math.hypot(dx,dy);
    if(L<EPS)return null;
    return{x:dx/L,y:dy/L};
  }
  function pointInfiniteLineDistance(p,e){
    const u=lineDirectionUnit(e);if(!u||!p)return Infinity;
    const vx=p.x-e.x1,vy=p.y-e.y1;
    return Math.abs(vx*u.y-vy*u.x);
  }
  function linesCollinear(a,b,tol=1e-4){
    const ua=lineDirectionUnit(a),ub=lineDirectionUnit(b);
    if(!ua||!ub)return false;
    const cross=Math.abs(ua.x*ub.y-ua.y*ub.x);
    if(cross>1e-5)return false;
    return pointInfiniteLineDistance({x:b.x1,y:b.y1},a)<=tol &&
           pointInfiniteLineDistance({x:b.x2,y:b.y2},a)<=tol;
  }
  function lineOverlapLength(a,b){
    const u=lineDirectionUnit(a);if(!u)return 0;
    const proj=p=>(p.x-a.x1)*u.x+(p.y-a.y1)*u.y;
    const a0=0,a1=lineLength(a);
    const b0=proj({x:b.x1,y:b.y1}),b1=proj({x:b.x2,y:b.y2});
    const lo=Math.max(Math.min(a0,a1),Math.min(b0,b1));
    const hi=Math.min(Math.max(a0,a1),Math.max(b0,b1));
    return Math.max(0,hi-lo);
  }
  function findOverlappingSupportLine(oldLine,p,{replacements=[],excludeIds=[]}={}){
    if(!oldLine||!p)return null;
    const excluded=new Set([oldLine.id,...excludeIds]);
    const candidates=[
      ...replacements,
      ...state.entities.filter(e=>e.type==="line"&&!excluded.has(e.id))
    ];
    let best=null,bestScore=-Infinity;
    for(const line of candidates){
      if(!line||line.id===oldLine.id||excluded.has(line.id))continue;
      if(!linesCollinear(oldLine,line,1e-4))continue;
      const d=distanceToSegment(p,{x:line.x1,y:line.y1},{x:line.x2,y:line.y2});
      if(d>1e-4)continue;
      const overlap=lineOverlapLength(oldLine,line);
      const score=overlap*1000-lineLength(line)*1e-6;
      if(score>bestScore){best=line;bestScore=score;}
    }
    return best;
  }
  function supportRefAtPoint(line,p,tol=1e-4){
    if(!line||line.type!=="line"||!p)return null;
    const a={x:line.x1,y:line.y1},b={x:line.x2,y:line.y2};
    if(dist(p,a)<=tol)return makeEndpointRef(line.id,"start");
    if(dist(p,b)<=tol)return makeEndpointRef(line.id,"end");
    if(distanceToSegment(p,a,b)<=tol)return makeLineRef(line.id);
    return null;
  }
  function resetTransferredRuleState(r){
    if(!r)return r;
    r.rejected=false;
    r.conflict=false;
    r.temporaryInactive=false;
    r.diagnosticConflict=false;
    r.conflictWith=[];
    r.blockedBy=[];
    r.reason=undefined;
    r.source=r.source==="manual"?"manual":"trim-repair";
    return r;
  }
  function rewriteCoincidenceToSupport(rule,externalRef,supportLine,p){
    if(!rule||!externalRef||!supportLine)return null;
    const target=supportRefAtPoint(supportLine,p);
    if(!target)return null;

    const c=resetTransferredRuleState(clone(rule));
    if(target.kind==="endpoint"){
      c.type="coincident";
      delete c.mode;delete c.point;delete c.line;
      c.a=clone(target);
      c.b=clone(externalRef);
      c.master="a";
      c.entities=[target.entity,externalRef.entity].filter(Boolean);
    }else{
      c.type="coincident";
      c.mode="point-line";
      c.point=clone(externalRef);
      c.line=makeLineRef(supportLine.id);
      delete c.a;delete c.b;delete c.master;
      c.entities=[externalRef.entity,supportLine.id].filter(Boolean);
    }
    return c;
  }
  function pointGroupKey(p,tol=1e-5){
    if(!p)return"";
    return`${Math.round(p.x/tol)}:${Math.round(p.y/tol)}`;
  }

  function replacementLineContainingPoint(replacements,p,tol=1e-5){
    if(!p)return null;
    let best=null,bd=Infinity;
    for(const r of replacements){
      const d=distanceToSegment(p,{x:r.x1,y:r.y1},{x:r.x2,y:r.y2});
      if(d<tol&&d<bd){best=r;bd=d;}
    }
    return best;
  }
  function transferTrimEndpointRelations(oldLine,replacements,startMap,endMap){
    const oldId=oldLine.id;
    const oldConstraints=state.constraints.filter(c=>
      (c.entities||[]).includes(oldId)||c.ref?.entity===oldId||c.a?.entity===oldId||c.b?.entity===oldId||c.point?.entity===oldId||c.line?.entity===oldId
    ).map(clone);
    const oldDimensions=state.dimensions.filter(d=>
      d.entity===oldId||(d.entities||[]).includes(oldId)||d.a?.entity===oldId||d.b?.entity===oldId||d.point?.entity===oldId||d.line?.entity===oldId||d.lineA===oldId||d.lineB===oldId
    ).map(clone);

    state.constraints=state.constraints.filter(c=>!oldConstraints.some(o=>o.id===c.id));
    state.dimensions=state.dimensions.filter(d=>!oldDimensions.some(o=>o.id===d.id));

    let repairCount=0;
    const dangling=[];

    const rememberDangling=(rule,externalRef,p,kind)=>{
      if(!externalRef||!p)return;
      dangling.push({rule:clone(rule),externalRef:clone(externalRef),p:{x:p.x,y:p.y},kind});
    };

    for(const original of oldConstraints){
      const c=clone(original);
      let keep=false;

      if(c.type==="coincident"&&c.mode!=="point-line"){
        const aWasOld=c.a?.entity===oldId;
        const bWasOld=c.b?.entity===oldId;
        const oldA=aWasOld?getRefPoint(c.a):null;
        const oldB=bWasOld?getRefPoint(c.b):null;
        const a=mapOldEndpointRef(c.a,oldId,startMap,endMap);
        const b=mapOldEndpointRef(c.b,oldId,startMap,endMap);

        const lostA=aWasOld&&!a;
        const lostB=bWasOld&&!b;

        if(!lostA&&!lostB&&a&&b){
          c.a=a;c.b=b;
          c.entities=[a.entity,b.entity].filter(Boolean);
          resetTransferredRuleState(c);
          keep=true;
        }else if(lostA&&!lostB&&b){
          rememberDangling(c,b,oldA,"endpoint");
        }else if(lostB&&!lostA&&a){
          rememberDangling(c,a,oldB,"endpoint");
        }
      }else if(c.type==="fixed"){
        const wasOld=c.ref?.entity===oldId;
        const oldP=wasOld?getRefPoint(c.ref):null;
        const ref=mapOldEndpointRef(c.ref,oldId,startMap,endMap);
        if(!wasOld||ref){
          if(ref)c.ref=ref;
          c.entities=c.ref?.entity?[c.ref.entity]:[];
          resetTransferredRuleState(c);
          keep=true;
        }
        // Una fijación del endpoint eliminado no se transfiere a geometría externa.
      }else if(c.type==="coincident"&&c.mode==="point-line"){
        const pointWasOld=c.point?.entity===oldId;
        const lineWasOld=c.line?.entity===oldId;
        const oldPointWorld=pointWasOld?getRefPoint(c.point):null;
        let pointRef=mapOldEndpointRef(c.point,oldId,startMap,endMap);

        if(pointWasOld&&!pointRef){
          // El punto pertenecía al segmento eliminado: no queda referencia que conservar.
          continue;
        }

        let lineRef=c.line?clone(c.line):null;
        if(lineWasOld){
          const pWorld=getRefPoint(pointRef||c.point);
          let target=replacementLineContainingPoint(replacements,pWorld,1e-4);
          if(!target)target=findOverlappingSupportLine(oldLine,pWorld,{
            replacements,
            excludeIds:[pointRef?.entity].filter(Boolean)
          });

          if(target){
            const rewritten=rewriteCoincidenceToSupport(c,pointRef||c.point,target,pWorld);
            if(rewritten){
              state.constraints.push(rewritten);
              repairCount++;
            }
            continue;
          }

          rememberDangling(c,pointRef||c.point,pWorld,"body");
          continue;
        }

        c.point=pointRef||clone(c.point);
        c.line=lineRef;
        c.entities=[c.point?.entity,c.line?.entity].filter(Boolean);
        resetTransferredRuleState(c);
        keep=!!c.point&&!!c.line;
      }

      // H/V, paralelo, longitud, etc. de la línea completa no se copian
      // automáticamente a otra entidad porque su significado cambió tras Trim.
      if(keep)state.constraints.push(c);
    }

    // Reintentar conexiones cuyo soporte era precisamente la línea eliminada.
    const groups=new Map();
    for(const item of dangling){
      const support=findOverlappingSupportLine(oldLine,item.p,{
        replacements,
        excludeIds:[item.externalRef?.entity].filter(Boolean)
      });

      if(support){
        const rewritten=rewriteCoincidenceToSupport(item.rule,item.externalRef,support,item.p);
        if(rewritten){
          state.constraints.push(rewritten);
          repairCount++;
          continue;
        }
      }

      const k=pointGroupKey(item.p);
      if(!groups.has(k))groups.set(k,[]);
      groups.get(k).push(item);
    }

    // Si varios elementos externos dependían del mismo punto desaparecido,
    // mantenerlos coincidentes entre sí aunque ya no exista una línea soporte.
    for(const items of groups.values()){
      if(items.length<2)continue;
      const anchor=items[0].externalRef;
      for(let i=1;i<items.length;i++){
        const item=items[i];
        if(refKey(anchor)===refKey(item.externalRef))continue;
        const c=resetTransferredRuleState(clone(item.rule));
        c.type="coincident";
        delete c.mode;delete c.point;delete c.line;
        c.a=clone(anchor);c.b=clone(item.externalRef);c.master="a";
        c.entities=[anchor.entity,item.externalRef.entity].filter(Boolean);
        state.constraints.push(c);
        repairCount++;
      }
    }

    for(const d0 of oldDimensions){
      const d=clone(d0);
      let keep=false;
      if(["endpointX","endpointY"].includes(d.type)&&d.entity===oldId){
        const mapped=d.point==="start"?startMap:endMap;
        if(mapped){
          d.entity=mapped.entity;
          d.point=mapped.point;
          resetTransferredRuleState(d);
          keep=true;
        }
      }
      if(keep)state.dimensions.push(d);
    }

    markRulesDirty();
    return repairCount;
  }
  function addTrimIntersectionConstraint(ref,otherId){
    if(!ref||!otherId||ref.entity===otherId)return;
    const other=entity(otherId);if(!other)return;
    if(other.type==="line"){
      const exists=state.constraints.some(c=>!c.rejected&&c.type==="coincident"&&c.mode==="point-line"&&
        refKey(c.point)===refKey(ref)&&c.line?.entity===otherId);
      if(!exists)addConstraintObject({
        type:"coincident",mode:"point-line",point:clone(ref),line:makeLineRef(otherId),
        entities:[ref.entity,otherId],source:"auto"
      });
    }
  }

  function trimLine(e,p){
    const a={x:e.x1,y:e.y1},b={x:e.x2,y:e.y2},cuts=[
      {...a,t:0,otherId:null},{...b,t:1,otherId:null}
    ];

    for(const other of state.entities){
      if(other.id===e.id)continue;
      if(other.type==="line"){
        const x=lineIntersection(a,b,{x:other.x1,y:other.y1},{x:other.x2,y:other.y2});
        if(x)cuts.push({...x,otherId:other.id});
      }else if(other.type==="circle"){
        for(const x of segmentCircleIntersections(a,b,{x:other.cx,y:other.cy},other.r)){
          cuts.push({...x,otherId:other.id});
        }
      }
    }

    cuts.sort((x,y)=>x.t-y.t);
    const uniq=[];
    for(const c of cuts){
      const prev=uniq[uniq.length-1];
      if(!prev||Math.abs(c.t-prev.t)>1e-6)uniq.push(c);
      else if(!prev.otherId&&c.otherId)prev.otherId=c.otherId;
    }

    // Nueva regla: una línea sin intersecciones internas se elimina completa.
    if(uniq.length<=2){
      const repaired=transferTrimEndpointRelations(e,[],null,null);
      state.entities=state.entities.filter(x=>x.id!==e.id);
      state.selected=state.selected.filter(x=>x!==e.id);
      state.pickSelection=state.pickSelection.filter(x=>x.entity!==e.id);
      if(state.selectedRef?.entity===e.id)state.selectedRef=null;
      markRulesDirty();
      setStatus(`Trim: línea completa eliminada${repaired?` · ${repaired} conexión${repaired===1?"":"es"} reparada${repaired===1?"":"s"}`:""}.`);
      return true;
    }

    const t=segmentNearestPoint(p,a,b).t;let idx=-1;
    for(let i=0;i<uniq.length-1;i++){
      if(t>=uniq[i].t-EPS&&t<=uniq[i+1].t+EPS){idx=i;break;}
    }
    if(idx<0)return false;

    const replacements=[];
    let left=null,right=null;

    if(idx>0){
      left={id:uid("L"),type:"line",x1:a.x,y1:a.y,x2:uniq[idx].x,y2:uniq[idx].y};
      replacements.push(left);
    }
    if(idx<uniq.length-2){
      right={id:uid("L"),type:"line",x1:uniq[idx+1].x,y1:uniq[idx+1].y,x2:b.x,y2:b.y};
      replacements.push(right);
    }

    const startMap=left?makeEndpointRef(left.id,"start"):null;
    const endMap=right?makeEndpointRef(right.id,"end"):null;
    const repaired=transferTrimEndpointRelations(e,replacements,startMap,endMap);

    state.entities=state.entities.filter(x=>x.id!==e.id);
    state.entities.push(...replacements);
    state.selected=state.selected.filter(x=>x!==e.id);
    state.pickSelection=state.pickSelection.filter(x=>x.entity!==e.id);
    if(state.selectedRef?.entity===e.id)state.selectedRef=null;

    if(left&&uniq[idx]?.otherId)addTrimIntersectionConstraint(makeEndpointRef(left.id,"end"),uniq[idx].otherId);
    if(right&&uniq[idx+1]?.otherId)addTrimIntersectionConstraint(makeEndpointRef(right.id,"start"),uniq[idx+1].otherId);

    markRulesDirty();
    setStatus(`Trim aplicado${repaired?` · ${repaired} conexión${repaired===1?"":"es"} reparada${repaired===1?"":"s"}`:""}.`);
    return true;
  }
  function trimCircle(e,p){
    const angles=[];
    for(const other of state.entities){
      if(other.id===e.id)continue;let ints=[];
      if(other.type==="line")ints.push(...segmentCircleIntersections({x:other.x1,y:other.y1},{x:other.x2,y:other.y2},{x:e.cx,y:e.cy},e.r));
      else if(other.type==="circle")ints.push(...circleCircleIntersections(e,other));
      for(const x of ints)angles.push(normalizeAngle(deg(Math.atan2(x.y-e.cy,x.x-e.cx))));
    }
    angles.sort((a,b)=>a-b);const uniq=angles.filter((a,i)=>i===0||Math.abs(a-angles[i-1])>1e-5);if(uniq.length<2)return false;
    const click=normalizeAngle(deg(Math.atan2(p.y-e.cy,p.x-e.cx))),ext=[...uniq,uniq[0]+360];let rm=-1;
    for(let i=0;i<uniq.length;i++){let c=click;if(c<ext[i])c+=360;if(c>=ext[i]&&c<=ext[i+1]){rm=i;break;}}
    if(rm<0)return false;
    const start=ext[(rm+1)%uniq.length],end=ext[rm]+(rm===uniq.length-1?0:360);
    removeEntityRelations(e.id);state.entities=state.entities.filter(x=>x.id!==e.id);
    state.entities.push({id:uid("A"),type:"arc",cx:e.cx,cy:e.cy,r:e.r,start:normalizeAngle(start),end:normalizeAngle(end)});return true;
  }
  function removeEntityRelations(id){
    state.dimensions=state.dimensions.filter(d=>d.entity!==id&&!(d.entities||[]).includes(id)&&d.a?.entity!==id&&d.b?.entity!==id&&d.point?.entity!==id&&d.line?.entity!==id&&d.lineA!==id&&d.lineB!==id);
    state.constraints=state.constraints.filter(c=>!(c.entities||[]).includes(id)&&c.ref?.entity!==id&&c.a?.entity!==id&&c.b?.entity!==id&&c.point?.entity!==id&&c.line?.entity!==id);
    state.selected=state.selected.filter(x=>x!==id);
    if(state.selectedRef?.entity===id)state.selectedRef=null;
    state.pickSelection=state.pickSelection.filter(x=>x.entity!==id);
    if(state.activeDimension&&!state.dimensions.some(d=>d.id===state.activeDimension))state.activeDimension=null;
    markRulesDirty();
  }
  function trimAt(p){
    const hit=hitTest(p);if(!hit){setStatus("Trim: no se encontró entidad.");return;}
    mutate(()=>{
      let ok=false;
      if(hit.type==="line")ok=trimLine(hit,p);
      else if(hit.type==="circle")ok=trimCircle(hit,p);
      else if(hit.type==="arc"){
        removeEntityRelations(hit.id);
        state.entities=state.entities.filter(e=>e.id!==hit.id);
        ok=true;
        setStatus("Trim: arco eliminado.");
      }
      if(!ok)setStatus("Trim: no se pudo determinar el tramo a eliminar.");
    });
  }
  function deleteAt(p){
    const hit=hitTest(p);if(!hit)return;mutate(()=>{removeEntityRelations(hit.id);state.entities=state.entities.filter(e=>e.id!==hit.id);});
  }

  function refreshAll(){
    if(opts.entityCountEl)opts.entityCountEl.textContent=String(state.entities.length);
    if(opts.dimensionCountEl)opts.dimensionCountEl.textContent=String(state.dimensions.length);
    if(opts.constraintCountEl)opts.constraintCountEl.textContent=String(state.constraints.length);
    if(opts.originInfoEl)opts.originInfoEl.textContent=`${fmt(state.origin.x)}, ${fmt(state.origin.y)}`;
    const counts={under:0,full:0,conflict:0};for(const e of state.entities)counts[entityState(e.id)]++;
    if(opts.underCountEl)opts.underCountEl.textContent=String(counts.under);
    if(opts.fullCountEl)opts.fullCountEl.textContent=String(counts.full);
    if(opts.conflictCountEl)opts.conflictCountEl.textContent=String(counts.conflict);
    if(opts.sketchSummaryEl){
      const parts=[];
      if(counts.under)parts.push(`${counts.under} libre${counts.under===1?"":"s"}`);
      if(counts.full)parts.push(`${counts.full} restringido${counts.full===1?"":"s"}`);
      if(counts.conflict)parts.push(`${counts.conflict} conflicto${counts.conflict===1?"":"s"}`);
      opts.sketchSummaryEl.textContent=parts.join(" · ")||"Vacío";
    }
    updateProperties();updateContextBar();draw();
  }

  function fitView(){
    if(!state.entities.length&&!state.dimensions.length){setDefault200View();draw();return;}

    const points=[];
    const addPoint=p=>{
      if(p&&Number.isFinite(p.x)&&Number.isFinite(p.y))points.push({x:Number(p.x),y:Number(p.y)});
    };
    const addBox=b=>{
      if(!b)return;
      addPoint({x:b.minX,y:b.minY});addPoint({x:b.maxX,y:b.maxY});
    };

    // Geometría.
    for(const e of state.entities)addBox(entityBBox(e));

    // Cotas: referencia, testigos y posición personalizada del letrero.
    for(const d of state.dimensions){
      const g=dimensionGeometry(d);if(!g)continue;
      addPoint(g.a);addPoint(g.b);addPoint(g.p);
      const lp=dimensionLabelPoint(d,g);
      if(lp){
        // Reserva aproximada en mm para el texto; evita cortar el letrero.
        const text=String(g.text||"");
        const halfW=Math.max(4,text.length*0.75);
        const halfH=2.5;
        addPoint({x:lp.x-halfW,y:lp.y-halfH});
        addPoint({x:lp.x+halfW,y:lp.y+halfH});
      }
    }

    if(!points.length){setDefault200View();draw();return;}

    let minX=Math.min(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y));
    let maxX=Math.max(...points.map(p=>p.x)),maxY=Math.max(...points.map(p=>p.y));

    // Margen geométrico adicional.
    const span0=Math.max(maxX-minX,maxY-minY,10);
    const pad=Math.max(4,span0*0.04);
    minX-=pad;minY-=pad;maxX+=pad;maxY+=pad;

    const r=canvas.getBoundingClientRect();
    const sx=Math.max(maxX-minX,10),sy=Math.max(maxY-minY,10);
    state.view.scale=clamp(Math.min((r.width-70)/sx,(r.height-70)/sy),0.05,200);

    const c={x:(minX+maxX)/2,y:(minY+maxY)/2};
    state.view.panX=-(c.x-state.origin.x)*state.view.scale;
    state.view.panY=(c.y-state.origin.y)*state.view.scale;
    state.defaultViewInitialized=true;
    draw();
  }
  function zoomBy(factor,center=null){
    const old=state.view.scale,next=clamp(old*factor,0.02,500);
    if(center){const before=screenToWorld(center.x,center.y);state.view.scale=next;const after=worldToScreen(before);state.view.panX+=center.x-after.x;state.view.panY+=center.y-after.y;}
    else state.view.scale=next;draw();
  }

  function dimensionSelectionItems(d){
    if(!d)return[];
    if(d.type==="distancePP")return[clone(d.a),clone(d.b)];
    if(d.type==="distancePL")return[clone(d.point),{kind:"entity",entity:d.line?.entity}].filter(x=>x.entity||x.kind==="origin");
    if(d.type==="distanceLL")return[{kind:"entity",entity:d.lineA},{kind:"entity",entity:d.lineB}];
    if(d.type==="angleBetween")return(d.entities||[]).map(id=>({kind:"entity",entity:id}));
    if(["endpointX","endpointY"].includes(d.type))return[makeEndpointRef(d.entity,d.point)];
    if(["pointX","pointY"].includes(d.type))return[makePointRef(d.entity)];
    if(["centerX","centerY"].includes(d.type))return[makeCenterRef(d.entity)];
    if(d.entity)return[{kind:"entity",entity:d.entity}];
    return[];
  }
  function activateDimensionAtScreen(screen){
    const d=dimensionHitTest(screen);if(!d)return false;
    focusRule(d,"dimension");
    return true;
  }
  function prepareCoincidentMasterForRef(ref){
    for(const c of state.constraints){
      if(c.conflict||c.type!=="coincident"||c.mode==="point-line")continue;
      const ka=refKey(c.a),kb=refKey(c.b),kr=refKey(ref);
      if(kr!==ka&&kr!==kb)continue;
      const other=kr===ka?c.b:c.a;
      if(refLockScore(other)>=2&&refLockScore(ref)<2)c.master=kr===ka?"b":"a";
      else c.master=kr===ka?"a":"b";
    }
  }
  function prepareLineDragMasters(e){
    for(const ref of lineRefs(e))prepareCoincidentMasterForRef(ref);
  }
  function autoConstraintExists(ref,snap){
    const kr=refKey(ref);
    return state.constraints.some(c=>{
      if(c.type!=="coincident"||c.conflict)return false;
      if(["on-line","midpoint"].includes(snap?.kind)&&c.mode==="point-line"){
        return refKey(c.point)===kr&&c.line?.entity===snap.ref?.entity;
      }
      if(snap?.kind==="origin"&&c.mode!=="point-line"){
        return (refKey(c.a)===refKey({kind:"origin"})&&refKey(c.b)===kr)||(refKey(c.b)===refKey({kind:"origin"})&&refKey(c.a)===kr);
      }
      if(c.mode==="point-line")return false;
      const ks=refKey(snap?.ref);
      return (refKey(c.a)===kr&&refKey(c.b)===ks)||(refKey(c.b)===kr&&refKey(c.a)===ks);
    });
  }
  function beginDimensionLabelDrag(d,screen,ev){
    state.activeDimension=d.id;state.selected=[];state.selectedRef=null;state.pickSelection=[];
    state.drag={
      type:"dimensionLabel",dimension:d.id,screenStart:{x:screen.x,y:screen.y},
      originalOffset:clone(d.labelOffset||{x:0,y:0}),moved:false,committed:false,pointerId:ev.pointerId
    };
    updateProperties();updateContextBar();draw();
    canvas.setPointerCapture(ev.pointerId);
    return true;
  }

  function beginSelectDrag(p,screen,ev){
    if(ev.ctrlKey||ev.metaKey||ev.shiftKey)return false;
    const h=handleHitTest(p,{includeLineCenter:true});if(!h)return false;
    const e=entity(h.entity);if(!e)return false;
    state.activeDimension=null;
    if(h.type==="ref"){
      state.pickSelection=[clone(h.ref)];state.selected=[];state.selectedRef=clone(h.ref);
    }else{
      state.pickSelection=[{kind:"entity",entity:e.id}];state.selected=[e.id];state.selectedRef=null;
    }
    updateProperties();updateContextBar();draw();
    if(entityState(e.id)==="full"){
      setStatus("Esta geometría está totalmente restringida; elimina o modifica una cota/restricción para moverla.");
      return true;
    }
    state.drag={
      type:h.type==="lineCenter"?"lineMove":"ref",
      entity:e.id,
      ref:h.type==="ref"?clone(h.ref):null,
      screenStart:{x:screen.x,y:screen.y},
      startWorld:{x:p.x,y:p.y},
      original:clone(e),
      moved:false,committed:false,lastSnap:null,pointerId:ev.pointerId
    };
    canvas.setPointerCapture(ev.pointerId);
    return true;
  }
  function updateSelectDrag(screen){
    const d=state.drag;if(!d)return false;
    const px=Math.hypot(screen.x-d.screenStart.x,screen.y-d.screenStart.y);
    if(!d.moved&&px<2)return true;
    if(d.type==="dimensionLabel"){
      if(!d.committed){commit();d.committed=true;d.moved=true;}
      const dim=state.dimensions.find(x=>x.id===d.dimension);if(!dim)return true;
      dim.labelOffset={
        x:(Number(d.originalOffset.x)||0)+(screen.x-d.screenStart.x)/state.view.scale,
        y:(Number(d.originalOffset.y)||0)-(screen.y-d.screenStart.y)/state.view.scale
      };
      // Sólo cambia la posición visual del texto: no reconstruir paneles DOM.
      draw();return true;
    }
    if(!d.committed){commit();d.committed=true;d.moved=true;if(d.type==="ref")prepareCoincidentMasterForRef(d.ref);else prepareLineDragMasters(entity(d.entity));}
    const raw=screenToWorld(screen.x,screen.y);
    if(d.type==="ref"){
      const sn=getSnap(raw,{excludeEntity:d.entity});d.lastSnap=sn;state.snap=sn;
      const p=sn?{x:sn.x,y:sn.y}:raw;
      setRefPoint(d.ref,p);
    }else if(d.type==="lineMove"){
      const e=entity(d.entity);if(e&&e.type==="line"){
        const dx=raw.x-d.startWorld.x,dy=raw.y-d.startWorld.y;
        e.x1=d.original.x1+dx;e.y1=d.original.y1+dy;e.x2=d.original.x2+dx;e.y2=d.original.y2+dy;
      }
      d.lastSnap=null;state.snap=null;
    }
    solveFast(6,{states:false});
    draw();
    return true;
  }
  function finishSelectDrag(){
    const d=state.drag;if(!d)return;
    const wasDimension=d.type==="dimensionLabel";
    let addedConstraint=false;

    if(d.moved&&d.type==="ref"&&d.lastSnap&&!autoConstraintExists(d.ref,d.lastSnap)){
      autoAttachSnap(d.ref,d.lastSnap);
      addedConstraint=true;
    }

    state.drag=null;state.snap=null;

    if(d.moved&&!wasDimension){
      markRulesDirty();
      solveAndRefresh();
    }else{
      refreshAll();
    }

    if(addedConstraint)setStatus("Coincidencia agregada y croquis recalculado.");
    if(wasDimension)focusActiveDimensionInput();
  }

  function setDimensionPickSelection(items){
    state.pickSelection=items.map(clone);
    state.selected=[];
    state.selectedRef=null;
    state.activeDimension=null;
    state.dimensionPlacement=null;
    state.dimensionOption=null;
    updateProperties();updateContextBar();draw();
  }

  function dimensionClickSelectOrMeasure(world){
    const target=pickTargetAt(world);
    const current=clone(state.pickSelection);

    // Sin selección: el clic sobre geometría sólo selecciona el primer elemento.
    if(!current.length){
      if(target){
        setDimensionPickSelection([target]);
        setStatus("Cota: selecciona un segundo elemento o haz clic en vacío para medir la opción predeterminada.");
        return true;
      }
      return false;
    }

    // Clic en una geometría distinta: intentar formar una pareja de medición.
    if(target){
      const tkey=selectionItemKey(target);
      const already=current.some(x=>selectionItemKey(x)===tkey);

      if(!already){
        const pair=current.length===1?[current[0],target]:[target];
        setDimensionPickSelection(pair);

        if(pair.length===2){
          const action=defaultDimensionAction();
          if(action){
            // Este mismo clic actúa como el primer clic de medición:
            // captura la medida y entra a la vista previa del letrero.
            startDimensionPlacement(action,world);
            return true;
          }
        }
        return true;
      }
    }

    // Clic en vacío (o sobre el mismo elemento): medir la selección actual.
    const action=defaultDimensionAction();
    if(action)return startDimensionPlacement(action,world);
    return false;
  }

  function escapeToSelect(){
    if(state.drag){
      try{if(state.drag.pointerId!=null)canvas.releasePointerCapture(state.drag.pointerId);}catch{}
    }
    state.draft=null;state.selected=[];state.selectedRef=null;state.pickSelection=[];
    state.activeDimension=null;state.drag=null;state.snap=null;state.hoverHandle=null;
    state.dimensionPlacement=null;state.dimensionOption=null;
    state.selectionBox=null;state.selectedRule=null;
    setTool("select");
    updateProperties();updateContextBar();draw();
    try{canvas.focus({preventScroll:true});}catch{}
  }

  canvas.addEventListener("pointermove",ev=>{
    const ss=eventPoint(ev);
    if(state.panning&&state.panStart){state.view.panX+=ss.x-state.panStart.x;state.view.panY+=ss.y-state.panStart.y;state.panStart=ss;draw();return;}
    if(state.drag&&updateSelectDrag(ss))return;
    if(state.selectionBox&&updateSelectionBox(ss))return;
    let p=screenToWorld(ss.x,ss.y);
    state.lastPointerWorld={x:p.x,y:p.y};
    if(state.tool==="dimension"&&state.dimensionPlacement)updateDimensionPreviewPosition(state.lastPointerWorld);
    let sn=getSnap(p);state.snap=sn;if(sn)p={x:sn.x,y:sn.y};setCursor(p);
    state.hover=hitTest(p)?.id||null;
    state.hoverHandle=handleHitTest(p,{includeLineCenter:state.tool==="select"});
    const hoverDim=state.tool==="select"?dimensionHitTest(ss):null;
    if(hoverDim)canvas.style.cursor="move";
    else if(state.tool==="select"&&state.hoverHandle){
      const e=entity(state.hoverHandle.entity);canvas.style.cursor=entityState(e?.id)==="full"?"not-allowed":"grab";
    }else canvas.style.cursor=state.tool==="pan"?"grab":"crosshair";
    if(state.draft){
      if(state.tool==="line"){
        state.draft.inference=null;state.draft.x2=p.x;state.draft.y2=p.y;
      }else if(state.tool==="rect"){state.draft.w=p.x-state.draft.x;state.draft.h=p.y-state.draft.y;}
      else if(state.tool==="circle")state.draft.r=dist({x:state.draft.cx,y:state.draft.cy},p);
      updateContextBar();
    }draw();
  });

  canvas.addEventListener("pointerdown",ev=>{
    const ss=eventPoint(ev);
    if(state.tool==="pan"||ev.button===1){state.panning=true;state.panStart=ss;canvas.setPointerCapture(ev.pointerId);return;}
    if(state.tool==="select"){
      const dim=dimensionHitTest(ss);
      if(dim){beginDimensionLabelDrag(dim,ss,ev);return;}
    }
    let raw=screenToWorld(ss.x,ss.y);
    state.lastPointerWorld={x:raw.x,y:raw.y};

    if(state.tool==="dimension"){
      if(state.dimensionPlacement){commitDimensionPlacement(raw);return;}
      if(activateDimensionAtScreen(ss))return;
      if(dimensionClickSelectOrMeasure(raw))return;
    }
    if(state.tool==="select"){
      if(beginSelectDrag(raw,ss,ev))return;
      const h=handleHitTest(raw,{includeLineCenter:true});
      const hit=hitTest(raw);
      const nearOrigin=dist(raw,state.origin)<10/state.view.scale;
      if(!h&&!hit&&!nearOrigin){beginSelectionBox(ss,ev);return;}
      normalSelectionClick(raw,ev);return;
    }
    let sn=getSnap(raw),p=sn?{x:sn.x,y:sn.y}:raw;
    if(state.tool==="constraint")pickSelectionClick(p);
    else if(["line","rect","circle","point"].includes(state.tool)){
      if(state.tool==="line"&&state.draft)p={x:state.draft.x2,y:state.draft.y2};
      handleCreateClick(p,sn);
    }else if(state.tool==="trim")trimAt(p);
    else if(state.tool==="delete")deleteAt(p);
  });
  canvas.addEventListener("pointerup",ev=>{
    if(state.drag)finishSelectDrag();
    if(state.selectionBox)finishSelectionBox();
    state.panning=false;state.panStart=null;
    try{canvas.releasePointerCapture(ev.pointerId)}catch{}
  });
  canvas.addEventListener("pointercancel",ev=>{
    if(state.drag)finishSelectDrag();
    if(state.selectionBox)finishSelectionBox();
    state.panning=false;state.panStart=null;
  });
  canvas.addEventListener("pointerleave",()=>{state.snap=null;state.hover=null;state.hoverHandle=null;if(!state.panning&&!state.drag)draw();});
  canvas.addEventListener("wheel",ev=>{ev.preventDefault();zoomBy(ev.deltaY<0?1.15:0.87,eventPoint(ev));},{passive:false});
  canvas.addEventListener("keydown",ev=>{
    if(ev.key==="Escape"){
      escapeToSelect();ev.preventDefault();return;
    }
    if(ev.key==="Enter"&&confirmDefaultDimension()){
      ev.preventDefault();ev.stopPropagation();return;
    }
    if(ev.key==="Delete"||ev.key==="Backspace"){
      if(deleteSelectedRule()){ev.preventDefault();return;}
      const entityIds=[...new Set([
        ...state.selected,
        ...state.pickSelection.filter(x=>x.kind==="entity").map(x=>x.entity)
      ])];
      if(entityIds.length){
        mutate(()=>{for(const id of entityIds){removeEntityRelations(id);state.entities=state.entities.filter(e=>e.id!==id);}});
        ev.preventDefault();return;
      }
    }
  });
  window.addEventListener("keydown",ev=>{
    if(ev.key==="Escape"){escapeToSelect();ev.preventDefault();return;}
    const tag=document.activeElement?.tagName?.toLowerCase();if(["input","select","textarea"].includes(tag))return;
    if(ev.key==="Enter"&&confirmDefaultDimension()){ev.preventDefault();return;}
    if((ev.key==="Delete"||ev.key==="Backspace")&&deleteSelectedRule()){ev.preventDefault();return;}
    if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==="z"){undo();ev.preventDefault();return;}
    if((ev.ctrlKey||ev.metaKey)&&ev.key.toLowerCase()==="y"){redo();ev.preventDefault();return;}
    const map={s:"select",l:"line",r:"rect",c:"circle",d:"dimension",k:"constraint",t:"trim",h:"pan"};
    if(map[ev.key.toLowerCase()])setTool(map[ev.key.toLowerCase()]);
  });

  function undo(){if(!state.history.length)return;state.future.push(snapshot());restore(state.history.pop());}
  function redo(){if(!state.future.length)return;state.history.push(snapshot());restore(state.future.pop());}
  function newDocument(){
    if(state.entities.length&&!confirm("¿Crear un dibujo nuevo? Se perderán los cambios no descargados."))return;
    state.history=[];state.future=[];
    if(opts.fileNameEl)opts.fileNameEl.value="dibujo-cad";
    restore({format:"ibero-cad",version:9,origin:{x:0,y:0},entities:[],dimensions:[],constraints:[]});
    state.defaultViewInitialized=false;
    setDefault200View();
    setTool("select");
  }

  function toDocument(){return{format:"ibero-cad",version:9,units:"mm",precision:2,origin:clone(state.origin),entities:clone(state.entities),dimensions:clone(state.dimensions),constraints:clone(state.constraints),meta:{createdWith:"dxf-viewer CAD Beta v26",constraintPolicy:"creation-order-priority"}};}
  function svgEntity(e){
    const sx=x=>x-state.origin.x,sy=y=>-(y-state.origin.y);
    if(e.type==="line")return`<line x1="${sx(e.x1)}" y1="${sy(e.y1)}" x2="${sx(e.x2)}" y2="${sy(e.y2)}"/>`;
    if(e.type==="circle")return`<circle cx="${sx(e.cx)}" cy="${sy(e.cy)}" r="${e.r}"/>`;
    if(e.type==="point")return`<circle cx="${sx(e.x)}" cy="${sy(e.y)}" r="0.2"/>`;
    if(e.type==="arc"){
      const a=pointOnCircle(e,rad(e.start)),b=pointOnCircle(e,rad(e.end));let span=normalizeAngle(e.end-e.start);if(span===0)span=360;
      return`<path d="M ${sx(a.x)} ${sy(a.y)} A ${e.r} ${e.r} 0 ${span>180?1:0} 0 ${sx(b.x)} ${sy(b.y)}"/>`;
    }return"";
  }
  function svgText(){
    const boxes=state.entities.map(entityBBox).filter(Boolean);let minX=0,minY=0,maxX=100,maxY=100;
    if(boxes.length){minX=Math.min(...boxes.map(b=>b.minX))-state.origin.x;maxX=Math.max(...boxes.map(b=>b.maxX))-state.origin.x;minY=-(Math.max(...boxes.map(b=>b.maxY))-state.origin.y);maxY=-(Math.min(...boxes.map(b=>b.minY))-state.origin.y);}
    const w=Math.max(1,maxX-minX),h=Math.max(1,maxY-minY);
    return`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}mm" height="${h}mm" viewBox="${minX} ${minY} ${w} ${h}">
  <g fill="none" stroke="#000" stroke-width="0.1" vector-effect="non-scaling-stroke">
    ${state.entities.map(svgEntity).join("\n    ")}
  </g>
</svg>`;
  }
  function dxfEntity(e){
    const ox=state.origin.x,oy=state.origin.y,xy=(x,y)=>[x-ox,y-oy];
    if(e.type==="line"){const[x1,y1]=xy(e.x1,e.y1),[x2,y2]=xy(e.x2,e.y2);return`0\nLINE\n8\n0\n10\n${x1}\n20\n${y1}\n30\n0\n11\n${x2}\n21\n${y2}\n31\n0\n`;}
    if(e.type==="circle"){const[x,y]=xy(e.cx,e.cy);return`0\nCIRCLE\n8\n0\n10\n${x}\n20\n${y}\n30\n0\n40\n${e.r}\n`;}
    if(e.type==="arc"){const[x,y]=xy(e.cx,e.cy);return`0\nARC\n8\n0\n10\n${x}\n20\n${y}\n30\n0\n40\n${e.r}\n50\n${normalizeAngle(e.start)}\n51\n${normalizeAngle(e.end)}\n`;}
    if(e.type==="point"){const[x,y]=xy(e.x,e.y);return`0\nPOINT\n8\n0\n10\n${x}\n20\n${y}\n30\n0\n`;}return"";
  }
  function dxfText(){return`0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${state.entities.map(dxfEntity).join("")}0\nENDSEC\n0\nEOF\n`;}
  function cadBaseFileName(){
    const raw=String(opts.fileNameEl?.value||"dibujo-cad").trim()
      .replace(/\.(json|svg|dxf)$/i,"")
      .replace(/[\\/:*?"<>|]+/g,"_")
      .replace(/^\.+|\.+$/g,"")
      .trim();
    const name=raw||"dibujo-cad";
    if(opts.fileNameEl&&opts.fileNameEl.value!==name)opts.fileNameEl.value=name;
    return name;
  }
  function exportDocument(format){
    const base=cadBaseFileName();
    if(format==="json")opts.onDownload?.({data:JSON.stringify(toDocument(),null,2),name:`${base}.json`,mime:"application/json"});
    else if(format==="svg")opts.onDownload?.({data:svgText(),name:`${base}.svg`,mime:"image/svg+xml"});
    else if(format==="dxf")opts.onDownload?.({data:dxfText(),name:`${base}.dxf`,mime:"application/dxf"});
  }

  function addImportedPath(points,closed=false){
    if(points.length<2)return;
    const lines=[];
    for(let i=0;i<points.length-1;i++)lines.push(addLineFromPoints(points[i],points[i+1],null,null,null,"import"));
    if(closed)lines.push(addLineFromPoints(points[points.length-1],points[0],null,null,null,"import"));
    for(let i=0;i<lines.length-1;i++){
      addConstraintObject({type:"coincident",a:makeEndpointRef(lines[i].id,"end"),b:makeEndpointRef(lines[i+1].id,"start"),master:"a",entities:[lines[i].id,lines[i+1].id],source:"import"});
    }
    if(closed&&lines.length>1)addConstraintObject({type:"coincident",a:makeEndpointRef(lines[lines.length-1].id,"end"),b:makeEndpointRef(lines[0].id,"start"),master:"a",entities:[lines[lines.length-1].id,lines[0].id],source:"import"});
  }
  function importSvg(text){
    state.entities=[];state.dimensions=[];state.constraints=[];state.origin={x:0,y:0};
    const doc=new DOMParser().parseFromString(text,"image/svg+xml"),num=(v,d=0)=>Number.parseFloat(v??d)||0;
    for(const el of doc.querySelectorAll("line,circle,rect,polyline,polygon")){
      const tag=el.tagName.toLowerCase();
      if(tag==="line")addLineFromPoints({x:num(el.getAttribute("x1")),y:-num(el.getAttribute("y1"))},{x:num(el.getAttribute("x2")),y:-num(el.getAttribute("y2"))});
      else if(tag==="circle")state.entities.push({id:uid("C"),type:"circle",cx:num(el.getAttribute("cx")),cy:-num(el.getAttribute("cy")),r:num(el.getAttribute("r"))});
      else if(tag==="rect"){
        const x=num(el.getAttribute("x")),y=-num(el.getAttribute("y"))-num(el.getAttribute("height")),w=num(el.getAttribute("width")),h=num(el.getAttribute("height"));
        createRectangle({x,y},{x:x+w,y:y+h});
      }else{
        const pts=(el.getAttribute("points")||"").trim().split(/\s+/).map(s=>s.split(",").map(Number)).filter(p=>p.length>=2&&p.every(Number.isFinite)).map(([x,y])=>({x,y:-y}));
        addImportedPath(pts,tag==="polygon");
      }
    }state.history=[];state.future=[];solveAndRefresh();fitView();setStatus("SVG importado. La geometría se puede acotar y restringir nuevamente.");
  }
  function importDxf(text){
    if(!window.DxfParser)throw new Error("No se encontró dxf-parser.");
    state.entities=[];state.dimensions=[];state.constraints=[];state.origin={x:0,y:0};
    const dxf=new window.DxfParser().parseSync(text);
    for(const e of dxf.entities||[]){
      if(e.type==="LINE"){
        const a=e.vertices?.[0]||e.start||{x:e.x1,y:e.y1},b=e.vertices?.[1]||e.end||{x:e.x2,y:e.y2};if(a&&b)addLineFromPoints({x:Number(a.x)||0,y:Number(a.y)||0},{x:Number(b.x)||0,y:Number(b.y)||0});
      }else if(e.type==="CIRCLE")state.entities.push({id:uid("C"),type:"circle",cx:Number(e.center?.x)||0,cy:Number(e.center?.y)||0,r:Number(e.radius)||0});
      else if(e.type==="ARC")state.entities.push({id:uid("A"),type:"arc",cx:Number(e.center?.x)||0,cy:Number(e.center?.y)||0,r:Number(e.radius)||0,start:Number(e.startAngle)||0,end:Number(e.endAngle)||0});
      else if(e.type==="LWPOLYLINE"||e.type==="POLYLINE"){
        const pts=(e.vertices||[]).map(v=>({x:Number(v.x)||0,y:Number(v.y)||0}));addImportedPath(pts,!!((e.shape||e.closed)||((e.flags||0)&1)));
      }
    }state.history=[];state.future=[];solveAndRefresh();fitView();setStatus("DXF importado. La geometría se conserva; cotas y restricciones paramétricas se vuelven a definir.");
  }
  function migrateDocument(doc){
    if(doc?.format!=="ibero-cad")throw new Error("El JSON no es un archivo ibero-cad.");
    if(Number(doc.version)>=2){const out=clone(doc);out.version=9;return out;}
    const migrated={format:"ibero-cad",version:9,units:"mm",precision:2,origin:doc.origin||{x:0,y:0},entities:[],dimensions:[],constraints:[]};
    const idMap=new Map();
    for(const e of doc.entities||[]){
      if(e.type==="line"||e.type==="circle"||e.type==="arc"||e.type==="point"){migrated.entities.push(clone(e));idMap.set(e.id,[e.id]);}
      else if(e.type==="rect"){
        const x=e.x,y=e.y,w=e.w,h=e.h,ids=[uid("L"),uid("L"),uid("L"),uid("L")];
        migrated.entities.push({id:ids[0],type:"line",x1:x,y1:y,x2:x+w,y2:y},{id:ids[1],type:"line",x1:x+w,y1:y,x2:x+w,y2:y+h},{id:ids[2],type:"line",x1:x+w,y1:y+h,x2:x,y2:y+h},{id:ids[3],type:"line",x1:x,y1:y+h,x2:x,y2:y});
        idMap.set(e.id,ids);
      }else if(e.type==="polyline"){
        const ids=[];for(let i=0;i<(e.points||[]).length-1;i++){const id=uid("L"),a=e.points[i],b=e.points[i+1];ids.push(id);migrated.entities.push({id,type:"line",x1:a.x,y1:a.y,x2:b.x,y2:b.y});}idMap.set(e.id,ids);
      }
    }
    for(const d of doc.dimensions||[]){
      if(idMap.get(d.entity)?.length===1)migrated.dimensions.push(clone(d));
    }
    for(const c of doc.constraints||[]){
      const ids=(c.entities||[]).flatMap(id=>idMap.get(id)||[]);
      if(ids.length===c.entities?.length)migrated.constraints.push({...clone(c),entities:ids});
    }
    return migrated;
  }
  async function importFile(file){
    try{
      if(opts.fileNameEl)opts.fileNameEl.value=file.name.replace(/\.[^.]+$/,"")||"dibujo-cad";
      const text=await file.text(),ext=(file.name.split(".").pop()||"").toLowerCase();
      if(ext==="json"){state.history=[];state.future=[];restore(JSON.parse(text));fitView();setStatus("JSON cargado con cotas y restricciones vivas.");}
      else if(ext==="svg")importSvg(text);else if(ext==="dxf")importDxf(text);else throw new Error("Formato no soportado. Usa JSON, SVG o DXF.");
    }catch(err){console.error(err);setStatus(err.message||String(err));}
  }

  setTool("select");solveAndRefresh();requestAnimationFrame(resize);
  return{
    resize,setTool,newDocument,undo,redo,fitView,zoomBy,exportDocument,importFile,getDocument:toDocument,
    applyConstraint:addManualConstraint,
    getConstraintAvailability:constraintAvailability,
  };
}
