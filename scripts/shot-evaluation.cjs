'use strict';
// Development-only synthetic landmark evaluation; never an estimate of basketball accuracy.
const { Detector } = require('../basketball-shot.js');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
function pose(phase, side = 'right', condition = 'clear') {
  const points = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: .95 }));
  const xy = { 0:[.5,.12],7:[.44,.15],8:[.56,.15],11:[.4,.34],12:[.6,.34],13:[.35,.45],14:[.65,.45],15:[.3,.55],16:[.7,.55],23:[.43,.60],24:[.57,.60],25:[.43,.72],26:[.57,.72],27:[.43,.88],28:[.57,.88],31:[.4,.94],32:[.6,.94] };
  for (const [i, [x,y]] of Object.entries(xy)) Object.assign(points[i], { x, y });
  const [elbow,wrist,shoulder,sign] = side === 'left' ? [13,15,.4,-1] : [14,16,.6,1];
  if (phase === 'ready') { Object.assign(points[elbow], { x: shoulder + sign * .06, y: .25 }); Object.assign(points[wrist], { x: shoulder, y: .17 }); }
  if (phase === 'shoot') { Object.assign(points[elbow], { x: shoulder, y: .22 }); Object.assign(points[wrist], { x: shoulder, y: .08 }); }
  if (condition === 'scaled-translated') for (const p of points) { p.x = .5 + (p.x - .5) * .8; p.y = .5 + (p.y - .5) * .8; }
  if (condition === 'occluded' && phase === 'shoot') points[wrist].visibility = .1;
  return points;
}
function fixture(id, side, direction, condition, positive = true) {
  const times = condition === 'tracking-gap' ? [100,400,1600,1900] : [100,400,500,800];
  return { id, side, direction, condition, references: positive ? [{ start: times[2], end: times[3] }] : [], frames: times.map((timestamp,i) => ({ timestamp, width:640, height:480, landmarks:pose(i < 2 ? 'ready' : 'shoot',side,condition) })) };
}
function fixtures() {
  return [fixture('right-clear','right','front-label','clear'),fixture('left-clear','left','oblique-label','clear'),fixture('scaled','right','front-label','scaled-translated'),fixture('occlusion','right','side-label','occluded'),fixture('gap','right','oblique-label','tracking-gap'),fixture('non-shot-raise','right','front-label','non-shot-arm-raise',false),{ id:'idle',side:'right',direction:'side-label',condition:'idle',references:[],frames:[100,400,700].map(timestamp => ({timestamp,width:640,height:480,landmarks:pose('lower')})) }];
}
function counts(tp,fp,fn) { return { tp,fp,fn,precision:tp+fp ? tp/(tp+fp) : null,recall:tp+fn ? tp/(tp+fn) : null }; }
function matchEvents(events, references) {
  if (!Array.isArray(events) || !Array.isArray(references) || events.some(t => !Number.isFinite(t)) || references.some(r => !Number.isFinite(r.start) || !Number.isFinite(r.end) || r.start > r.end)) throw new TypeError('Invalid events or reference windows');
  const ordered = references.map((r,index) => ({...r,index})).sort((a,b) => a.end-b.end || a.start-b.start || a.index-b.index);
  const used = new Set(), matches = [], falsePositives = [];
  for (const timestamp of [...events].sort((a,b)=>a-b)) {
    const ref = ordered.find(r => !used.has(r.index) && timestamp >= r.start && timestamp <= r.end);
    if (ref) { used.add(ref.index); matches.push({ timestamp, referenceIndex:ref.index }); } else falsePositives.push(timestamp);
  }
  return { ...counts(matches.length,falsePositives.length,references.length-used.size), matches,falsePositives,falseNegatives:references.map((_,i)=>i).filter(i=>!used.has(i)) };
}
function evaluate(clips = fixtures()) {
  const cases = clips.map(clip => {
    const detector = new Detector({side:clip.side,sensitivity:'normal'});
    const events = clip.frames.filter(frame => detector.update(frame).event).map(frame=>frame.timestamp);
    return { id:clip.id,direction:clip.direction,condition:clip.condition,observedDurationMs:clip.frames.length > 1 ? clip.frames.at(-1).timestamp-clip.frames[0].timestamp : 0,events,references:clip.references,...matchEvents(events,clip.references) };
  });
  const sum = rows => counts(...['tp','fp','fn'].map(key=>rows.reduce((n,r)=>n+r[key],0)));
  const groups = key => Object.fromEntries([...new Set(cases.map(c=>c[key]))].sort().map(value=>[value,sum(cases.filter(c=>c[key]===value))]));
  return { exposure:{ observedDurationMs:cases.reduce((n,c)=>n+c.observedDurationMs,0),negativeClipDurationMs:cases.filter(c=>!c.references.length).reduce((n,c)=>n+c.observedDurationMs,0),note:'Last minus first fixture input timestamp per clip; sparse synthetic observations, not continuous video or negative duration within positive clips' },overall:sum(cases),byDirection:groups('direction'),byCondition:groups('condition'),cases };
}
function benchmark(clips, repetitions = 1000) {
  const frames = clips.flatMap(c=>c.frames.map(frame=>({frame,side:c.side}))); const d = new Detector();
  // configure() calls reset(), isolating each clip and repetition.
  const replay = () => { for (const clip of clips) { d.configure({side:clip.side,sensitivity:'normal'}); for (const frame of clip.frames) d.update(frame); } };
  for (let i=0;i<100;i++) replay();
  const before = process.memoryUsage(), cpuStart = process.cpuUsage(), start = performance.now();
  for (let i=0;i<repetitions;i++) replay();
  const elapsedMs=performance.now()-start,cpu=process.cpuUsage(cpuStart),after=process.memoryUsage();
  return { scope:'Node rule-only landmark processing; excludes model, camera, browser, GPU, energy and temperature',repetitions,updates:frames.length*repetitions,elapsedMs,cpuUserMs:cpu.user/1000,cpuSystemMs:cpu.system/1000,beforeBytes:before,afterBytes:after,processLifetimeMaxRss: { value:process.resourceUsage().maxRSS,unit:'KiB',scope:'Node process lifetime high-water mark, includes setup and warmup; not benchmark-only peak' },rssDeltaBytes:after.rss-before.rss,heapUsedDeltaBytes:after.heapUsed-before.heapUsed,notes:'Process snapshots are not peak memory; GC/JIT and shared-host load affect measurements. No timing pass threshold.' };
}
function report() {
  const clips=fixtures();
  return { schemaVersion:1,kind:'synthetic-defined-rule-evaluation',limitations:['Coordinates are constructed from rule unit-test geometry, not captured people or model outputs.','Camera directions are scenario labels only; no real projection or direction robustness is validated.','Reference windows are declared fixture truth; non-shot arm raise intentionally has no target event despite identical geometry.','No sports accuracy, shot success, technique, Android, thermal or 40-minute claims.'],protocol:{unit:'event per isolated clip',matching:'One-to-one within inclusive reference windows (earliest ending available window first, maximizing match count); duplicate/unmatched detections FP; unmatched windows FN',referenceMeaning:'Constructed target SHOOT interval, including hold completion; not physical ball release',zeroDenominator:null,aggregation:'micro sums; no true-negative accuracy',settings:{sensitivity:'normal'},fixtureSha256:crypto.createHash('sha256').update(JSON.stringify(clips)).digest('hex')},sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(__filename)).update(fs.readFileSync(require.resolve('../basketball-shot.js'))).update(fs.readFileSync(require.resolve('../pose-presence.js'))).digest('hex'),environment:{hostname:os.hostname(),node:process.version,platform:process.platform,arch:process.arch,kernel:os.release()},evaluation:evaluate(clips),resource:benchmark(clips) };
}
if (require.main === module) { const output=JSON.stringify(report(),null,2)+'\n'; if (process.argv[2]) fs.writeFileSync(process.argv[2],output); else process.stdout.write(output); }
module.exports={pose,fixtures,matchEvents,evaluate,benchmark,report};
