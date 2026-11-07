/* Experimental 2D overhead arm-motion cue, not ball contact, spike quality or grading. */
(function (root) {
  'use strict';
  const Presence=typeof module !== 'undefined' && module.exports ? require('./pose-presence.js') : root.PosePresence;
  const RULE_VERSION='volleyball-overhead-cue-v1',TYPE='volleyball-overhead-cue';
  const LEVELS=Object.freeze({low:Object.freeze({readyAngle:125,extendAngle:165,travel:.5}),normal:Object.freeze({readyAngle:140,extendAngle:155,travel:.35}),high:Object.freeze({readyAngle:150,extendAngle:150,travel:.25})});
  function settings(v) { if (!v || !['left','right'].includes(v.side) || !Object.hasOwn(LEVELS,v.sensitivity)) throw new TypeError('Invalid volleyball settings'); return {side:v.side,sensitivity:v.sensitivity}; }
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  function angle(a,b,c) { const den=distance(a,b)*distance(c,b); return den<1e-8 ? null : Math.acos(Math.max(-1,Math.min(1,((a.x-b.x)*(c.x-b.x)+(a.y-b.y)*(c.y-b.y))/den)))*180/Math.PI; }
  class Detector {
    constructor(options={side:'right',sensitivity:'normal'}) { this.options=settings(options); this.reset(); }
    snapshot(reason=null,extra={}) { return {state:this.state,angle:null,event:false,type:TYPE,ruleVersion:RULE_VERSION,reason,...extra}; }
    reset(reason='reset') { this.state='waiting';this.phase=null;this.lastTime=null;this.body=null;this.readyWrist=null;return this.snapshot(reason); }
    configure(options) { this.options=settings(options);return this.reset('settings'); }
    update({landmarks,timestamp,width,height}={}) {
      if (![timestamp,width,height].every(Number.isFinite) || width<=0 || height<=0) return this.reset('invalid-frame');
      const gate=Presence.analyze(landmarks);if(!gate.usable)return this.reset(gate.reason);
      if(this.lastTime!==null && (timestamp<=this.lastTime || timestamp-this.lastTime>1000)) this.reset('gap');
      const p=i=>({x:landmarks[i].x*width/height,y:landmarks[i].y});
      const ls=p(11),rs=p(12),lh=p(23),rh=p(24),center={x:(ls.x+rs.x+lh.x+rh.x)/4,y:(ls.y+rs.y+lh.y+rh.y)/4};
      const torso=distance({x:(ls.x+rs.x)/2,y:(ls.y+rs.y)/2},{x:(lh.x+rh.x)/2,y:(lh.y+rh.y)/2}),direction=Math.sign(rs.x-ls.x);
      if(torso<.05 || !direction)return this.reset('body-geometry');
      if(this.body && (direction!==this.body.direction || distance(center,this.body.center)>Math.min(torso,this.body.torso)))this.reset('tracking-change');
      this.lastTime=timestamp;this.body={center,torso,direction};
      const left=this.options.side==='left',ear=p(left?7:8),shoulder=p(left?11:12),elbow=p(left?13:14),wrist=p(left?15:16),a=angle(shoulder,elbow,wrist),level=LEVELS[this.options.sensitivity];
      if(a===null)return this.reset('arm-geometry');
      const above=(shoulder.y-wrist.y)/torso;
      let candidate=null;
      if(this.state==='waiting') { if(wrist.y<=ear.y+.08 && elbow.y<shoulder.y && a<=level.readyAngle)candidate='ready'; }
      else if(this.state==='ready') {
        const outward=(wrist.x-this.readyWrist.x)*(left?-1:1)/torso,down=(wrist.y-this.readyWrist.y)/torso;
        if(a>=level.extendAngle && outward>=level.travel && down>=level.travel && above>=-.25)candidate='swing';
        else if(above<-.35){this.state='waiting';this.phase=null;this.readyWrist=null;}
      } else if(above<=-.35)candidate='lower';
      let event=false;
      if(!candidate)this.phase=null;
      else if(this.phase?.kind!==candidate)this.phase={kind:candidate,start:timestamp,frames:1};
      else if(++this.phase.frames>=2 && timestamp-this.phase.start>=250){
        if(candidate==='ready'){this.state='ready';this.readyWrist={...wrist};}
        else if(candidate==='swing'){this.state='swing';event=true;}
        else {this.state='waiting';this.readyWrist=null;}
        this.phase=null;
      }
      return this.snapshot(null,{angle:a,event,...(event?{side:this.options.side,sensitivity:this.options.sensitivity}:{} )});
    }
  }
  const api=Object.freeze({Detector,LEVELS,RULE_VERSION});
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.VolleyballCue=api;
})(globalThis);
