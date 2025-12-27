(function(){
  'use strict';

  function boot(){
    const VERSION = 'v0.2.0';
    console.log('[Saboclock]', VERSION);

    // ---------------- Config ----------------
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const DESIGN_W = 1920;
    const DESIGN_H = 1080;
    const N = 1650;
    const HN = 770, MN = 770, SN = 0;
    const CN = 110; // colon allocation

    // Base motion
    const IDLE_JITTER = 0.35;
    const SEEK_STRENGTH = 0.085;
    const DAMP = 0.78;

    // Detection
    const DETECT_EVERY_N_FRAMES = 6;
    const SEEN_DEBOUNCE_MS = 1200;

    // Subtle life wobble when digits are displayed
    const SEEN_WOBBLE = 8.32;         // px amplitude
    const WOBBLE_BASE_HZ = 0.10;      // cycles / sec
    const WOBBLE_JITTER_HZ = 16.24;   // per-particle freq variation

    // ---------------- ENTER patterns ----------------
    const ENTER_DURATION_MS = 2100;
    const ENTER_GATHER_RADIUS_BASE = 140;      // @1080p-ish
    const ENTER_AIR_DAMP = 0.985;
    const ENTER_BOUNCE_RESTITUTION = 0.82;     // bounce energy kept
    const ENTER_WALL_RESTITUTION = 0.60;       // minor walls
    const ENTER_SEEK_MULT = 1.25;              // end seek strength multiplier

    const ENTER_VERTICAL_BOUNCE   = 'ENTER_VERTICAL_BOUNCE';
    const ENTER_HORIZONTAL_BOUNCE = 'ENTER_HORIZONTAL_BOUNCE';
    const ENTER_RANDOM_BOUNCE     = 'ENTER_RANDOM_BOUNCE';

    // (placeholders: keep 5 slots in case you add more later)
    const ENTER_PATTERNS = [
      ENTER_VERTICAL_BOUNCE,
      ENTER_HORIZONTAL_BOUNCE,
      ENTER_RANDOM_BOUNCE,
      ENTER_VERTICAL_BOUNCE,
      ENTER_RANDOM_BOUNCE,
    ];

    // ---------------- EXIT patterns ----------------
    const EXIT_STABLE_TRIGGER_MS = 3000; // after digits are stable
    const EXIT_COOLDOWN_MS = 1800;       // ignore "seen" for a moment after an exit

    const EXIT_RED_EXPLODE = 'EXIT_RED_EXPLODE';
    const EXIT_FADE_OUT = 'EXIT_FADE_OUT';
    const EXIT_ZOOM_OUT_TRACKING = 'EXIT_ZOOM_OUT_TRACKING';

    const EXIT_PATTERNS = [EXIT_RED_EXPLODE, EXIT_FADE_OUT, EXIT_ZOOM_OUT_TRACKING];

    // Exit 1: red + colon fast -> explode
    const EXIT_RED_RAMP_MS = 1700;
    const EXIT_RED_HOLD_MS = 450;
    const EXIT_EXPLOSION_MS = 2400;
    const EXIT_HEAT_EASE = 0.15;
    const EXIT_PULSE_HZ = 8.0;
    const EXIT_PULSE_AMP = 0.18;
    const EXIT_SCALE_EXTRA = 0.35;

    const EXPLOSION_SPEED_MIN = 20.0;
    const EXPLOSION_SPEED_MAX = 40.0;
    const EXPLOSION_DAMP = 0.992;
    const EXPLOSION_JITTER_GAIN = 0.35;

    // Exit 2: fade out
    const EXIT_FADE_MS = 1400;

    // Exit 3: zoom-out tracking
    const EXIT_ZOOM_TOTAL_MS = 2600;
    const EXIT_ZOOM_KICK_MS = 160;
    const EXIT_ZOOM_KICK_SCALE = 0.38;
    const EXIT_ZOOM_FINAL_SCALE = 0.12;
    const EXIT_ZOOM_OFFSET_MAX_BASE = 520; // px @1080p-ish

    // ---------------- SLIME renderer params (guided) ----------------
    const MAX_BLOB_PIXELS = 1800000;

    // Base (design @ 1920x1080, blobScale≈2)
    const DISC_RADIUS_BASE = 11.5;
    const BLUR_BASE = 2.5;
    const THRESH_BASE = 0.70;

    // Keep visual look stable across seen/unseen (smoothed)
    const SEEN_VIS_THICK_MULT = 1.18;
    const UNSEEN_VIS_THICK_MULT = SEEN_VIS_THICK_MULT;
    const UNSEEN_THR_BIAS = -0.12;
    const BASE_ALPHA_SEEN = 26;
    const BASE_ALPHA_UNSEEN = 38;

    // Guide dots (debug-ish). Keep very faint.
    const USE_GUIDE = true;
    const GUIDE_ALPHA = 8;

    // Font
    const USE_FONT = true;
    const FONT_FAMILY_PRIMARY = 'Inter';
    const FONT_FAMILY_LOCAL   = 'ClockFontLocal';
    let FONT_WEIGHT = 100;
    const LETTER_SPACING = 0.02;
    let fontSize = 280;

    // Small helpers
    function clamp01(t){ return t<0?0:(t>1?1:t); }
    function lerp(a,b,t){ return a + (b-a)*t; }
    function easeOutQuint(t){ t = clamp01(t); return 1 - Math.pow(1 - t, 5); }
    function smoothstep01(t){ t = clamp01(t); return t*t*(3 - 2*t); }

    // HM string only (targets do not depend on seconds)
    function clockStringHM(){
      const d = new Date();
      const pad = (n)=>String(n).padStart(2,'0');
      return pad(d.getHours()) + pad(d.getMinutes());
    }

    let sketch = (p)=>{
      // --------------- Particles ---------------
      let pts = new Array(N).fill(0).map(()=>({x:0,y:0,vx:0,vy:0,tx:0,ty:0,group:0}));

      // --------------- State machine ---------------
      const MODE_IDLE = 'IDLE';
      const MODE_ENTER = 'ENTER';
      const MODE_DISPLAY = 'DISPLAY';
      const MODE_EXIT = 'EXIT';

      let mode = MODE_IDLE;
      let enterState = null; // {type, start}
      let exitState = null;  // {type, start, phase, exploded}
      let displayStart = 0;
      let cooldownUntil = 0;

      // Target caching
      let lastHMStr = '';
      let guides = [];

      // Layout + slime buffers
      const holder = document.getElementById('canvas-holder');
      let gBlob = null, blobScale = 4;
      let layoutScale = 1;
      let DIGIT_SCALE = 1;

      // Clock anchor (for transforms)
      let clockCenter = {x:0, y:0};

      // Visual state (color / alpha / transform)
      let clockTransform = { scale:1, offsetX:0, offsetY:0, alpha:1, heat01:0, colonSpeed:1 };

      // Visual smoothing to avoid "pakki" jumps
      let seenVis01 = 0.0; // 1=digits look, 0=idle look
      const SEEN_VIS_LERP_IN = 0.25;
      const SEEN_VIS_LERP_OUT = 0.07;

      // --------------- Camera state ---------------
      const cam = {
        enabled:false,
        preview:false,
        video: document.getElementById('cam'),
        wrap: document.getElementById('camWrap'),
        stream:null,
        detector:null,
        api:'none',
        lastSeenAt: 0,
        face: { xN:0.5, yN:0.5, has:false, updatedAt:0 },
        motion: { prev:null, w:160, h:90, tmp:null, tctx:null }
      };

      // --------------- UI ---------------
      const fakeSeen = document.getElementById('fakeSeen');
      const btnCam = document.getElementById('btnCam');
      const btnSim = document.getElementById('btnSim');
      const togglePreview = document.getElementById('togglePreview');
      const btnSettings = document.getElementById('btnSettings');
      const settingsPanel = document.getElementById('settings-panel');

      // (debug-ish) mouse as "face" when no camera
      let simFace = {xN:0.5, yN:0.5};
      window.addEventListener('mousemove', (e)=>{
        const W = window.innerWidth || 1;
        const H = window.innerHeight || 1;
        simFace.xN = clamp01(e.clientX / W);
        simFace.yN = clamp01(e.clientY / H);
      }, {passive:true});

      function updateDiag(text){
        try { console.log(text); } catch(e){}
      }

      // Settings panel toggle
      if (btnSettings && settingsPanel){
        btnSettings.addEventListener('click', ()=>{
          const visible = settingsPanel.style.display === 'block';
          settingsPanel.style.display = visible ? 'none' : 'block';
        });
      }

      // Sim toggle
      let simSeen = true;
      if (fakeSeen){
        fakeSeen.addEventListener('change', ()=>{ simSeen = fakeSeen.checked; });
        simSeen = fakeSeen.checked;
      }

      if (btnSim){
        btnSim.addEventListener('click', ()=>{
          cam.enabled = false;
          if (cam.wrap) cam.wrap.style.display = 'none';
          simSeen = true;
          if (fakeSeen) fakeSeen.checked = true;
          updateDiag('診断: シミュレーション ON');
        });
      }

      if (togglePreview){
        togglePreview.checked = false;
        cam.preview = false;
        togglePreview.addEventListener('change', ()=>{
          cam.preview = togglePreview.checked;
          if (cam.wrap){
            cam.wrap.style.display = (cam.preview && cam.enabled) ? 'block' : 'none';
          }
        });
      }

      if (btnCam){
        btnCam.addEventListener('click', startCamera);
      }

      // --------------- Responsive slime params ---------------
      let DISC_RADIUS = DISC_RADIUS_BASE;
      let BLUR_AMOUNT = BLUR_BASE;
      let THRESH_LEVEL = THRESH_BASE;
      let GUIDE_RADIUS = Math.floor(DISC_RADIUS_BASE * 0.75);

      function updateSlimeParams(){
        // digits visual scale: layout scale × overlap avoid scale × runtime transform
        const runtimeScale = Math.max(0.08, clockTransform.scale || 1);
        const s = Math.max(0.35, (layoutScale || 1) * (DIGIT_SCALE || 1) * runtimeScale);
        const bs = Math.max(1, blobScale || 2);

        const baseVisR = DISC_RADIUS_BASE * 2;
        const visMult = (SEEN_VIS_THICK_MULT * seenVis01) + (UNSEEN_VIS_THICK_MULT * (1.0 - seenVis01));
        const desiredVisR = baseVisR * s * visMult;

        let r = desiredVisR / bs;
        r = Math.max(4.5, Math.min(18.0, r));
        DISC_RADIUS = r;

        let blur = r * 0.22;
        blur = Math.max(1.1, Math.min(4.2, blur));
        BLUR_AMOUNT = blur;

        let thr = THRESH_BASE - (s - 1) * 0.06;
        thr += UNSEEN_THR_BIAS * (1.0 - seenVis01);
        thr = Math.max(0.52, Math.min(0.76, thr));
        THRESH_LEVEL = thr;

        GUIDE_RADIUS = Math.max(2, Math.floor(r * 0.55));
      }

      function resize(){
        const vw = window.innerWidth || DESIGN_W;
        const vh = window.innerHeight || DESIGN_H;
        p.resizeCanvas(vw, vh);

        const base = Math.min(vw, vh);
        layoutScale = base / DESIGN_H;

        const area = vw * vh;
        blobScale = Math.max(2, Math.ceil(Math.sqrt(area / MAX_BLOB_PIXELS)));
        const bw = Math.max(64, Math.floor(vw / blobScale));
        const bh = Math.max(64, Math.floor(vh / blobScale));
        gBlob = p.createGraphics(bw, bh);
        gBlob.pixelDensity(DPR);

        layoutInitial();
        rebuildTargets();
        updateSlimeParams();
      }

      function applyFitScale(){
        const c = holder.querySelector('canvas');
        if (c){
          c.style.position = 'absolute';
          c.style.left = '50%';
          c.style.top = '50%';
          c.style.transform = 'translate(-50%, -50%)';
          c.style.transformOrigin = 'center center';
        }
      }

      p.setup = function(){
        const c = p.createCanvas(16, 9);
        c.parent(holder);
        p.pixelDensity(DPR);
        p.frameRate(60);

        resize();
        applyFitScale();

        const waitFonts = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
        waitFonts.then(()=>{ rebuildTargets(); setTimeout(rebuildTargets, 0); });

        updateDiag('診断: OK / ENTER bounce + EXIT patterns v0.2.0');
      };

      function layoutInitial(){
        for (let i=0;i<N;i++){
          const g = (i<HN)?0:(i<HN+MN?1:2); // 0: H, 1: M, 2: colon
          pts[i].x = Math.random()*p.width;
          pts[i].y = Math.random()*p.height;
          pts[i].vx = 0;
          pts[i].vy = 0;
          pts[i].group = g;
        }
      }

      // ----- Font-based digits (fill) -----
      function drawFontDigits(g, text, size, cx, cy){
        const ctx = g.drawingContext;
        ctx.save();
        const fam = `'${FONT_FAMILY_LOCAL}', '${FONT_FAMILY_PRIMARY}', sans-serif`;
        ctx.font = `${FONT_WEIGHT} ${size}px ${fam}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        let total = 0;
        for (const ch of text){
          const w = ctx.measureText(ch).width;
          total += w * (1 + LETTER_SPACING);
        }
        let x = cx - total/2;
        for (const ch of text){
          const w = ctx.measureText(ch).width * (1 + LETTER_SPACING);
          ctx.fillText(ch, x, cy);
          x += w;
        }
        ctx.restore();
      }

      function drawVectorDigits(g, text, size, cx, cy){
        g.push(); g.translate(cx, cy);
        g.stroke(255); g.strokeWeight(Math.max(2, size*0.065)); g.noFill();
        if (g.drawingContext){ g.drawingContext.lineJoin='round'; g.drawingContext.lineCap='round'; }
        const w=size*0.62, gap=size*0.18, halfH=size*0.52, halfW=w*0.5;
        function b(){g.beginShape();} function v(x,y){g.vertex(x,y);} function e(){g.endShape();}
        function digitPath(d, ox){
          const hw=halfW, hh=halfH, r=size*0.2; g.push(); g.translate(ox,0);
          switch(d){
            case '0': g.rectMode(g.CENTER); g.rect(0,0,w,size*1.04,r); break;
            case '1': b(); v(-hw*0.2,-hh); v(0,-hh); v(0,hh); e(); break;
            case '2': b(); v(-hw,-hh+2); v(hw,-hh+2); v(hw,0); v(-hw,0); v(-hw,hh); v(hw,hh); e(); break;
            case '3': b(); v(-hw,-hh+2); v(hw,-hh+2); v(hw,0); v(-hw*0.1,0); e(); b(); v(-hw*0.1,0); v(hw,0); v(hw,hh-2); v(-hw,hh-2); e(); break;
            case '4': b(); v(-hw,-hh); v(-hw,0); v(hw,0); e(); b(); v(hw,-hh); v(hw,hh); e(); break;
            case '5': b(); v(hw,-hh+2); v(-hw,-hh+2); v(-hw,0); v(hw,0); v(hw,hh-2); v(-hw,hh-2); e(); break;
            case '6': g.ellipseMode(g.CENTER); g.ellipse(-hw*0.05, hh*0.25, w*1.0, size*0.9); b(); v(hw*0.7,-hh+2); v(-hw,-hh+2); v(-hw,0); v(hw,0); e(); break;
            case '7': b(); v(-hw,-hh+2); v(hw,-hh+2); v(0,hh); e(); break;
            case '8': g.ellipseMode(g.CENTER); g.ellipse(0,-hh*0.38,w*0.9,size*0.70); g.ellipse(0,hh*0.42,w*0.98,size*0.80); break;
            case '9': g.ellipseMode(g.CENTER); g.ellipse(hw*0.05,-hh*0.25,w*1.0,size*0.9); b(); v(-hw,0); v(hw,0); v(hw,hh-2); v(-hw,hh-2); e(); break;
            case ':': g.noStroke(); g.fill(255); g.circle(0,-hh*0.35,size*0.10); g.circle(0,hh*0.35,size*0.10); g.noFill(); g.stroke(255); break;
          }
          g.pop();
        }
        const digW=size*0.62; const totalW = text.length*(digW+gap)-gap;
        let x=-totalW/2+digW*0.5;
        for (const ch of text){ digitPath(ch,x); x+=digW+gap; }
        g.pop();
      }

      function buildTargetsFor(text, maxCount, xCenter, yCenter){
        const g = p.createGraphics(Math.max(10, Math.floor(p.width*0.32)), p.height);
        g.pixelDensity(1);
        g.clear();
        g.background(0,0);
        (USE_FONT ? drawFontDigits : drawVectorDigits)(g, text, fontSize, g.width/2, yCenter);
        g.loadPixels();
        const d=g.pixelDensity(), W=g.width*d, H=g.height*d;
        let step=Math.max(2, Math.floor(Math.min(p.width,p.height)*0.0035)*d);
        const arr=[];
        for (let y=0;y<H;y+=step){
          for (let x=0;x<W;x+=step){
            const a=g.pixels[4*(y*W+x)+3];
            if (a>128){ arr.push({x: x/d + (xCenter - g.width/2), y: y/d}); }
          }
        }
        if (arr.length>maxCount){
          const stride=Math.max(1, Math.ceil(arr.length/maxCount));
          const thin=[]; for (let i=0;i<arr.length;i+=stride) thin.push(arr[i]);
          return thin;
        }
        return arr;
      }

      function rebuildTargets(){
        const W = p.width || DESIGN_W;
        const H = p.height || DESIGN_H;

        const base = Math.min(W, H);
        layoutScale = base / DESIGN_H;

        const H_SIZE_BASE = 480 * layoutScale;
        const M_SIZE_BASE = 480 * layoutScale;
        const COLON_SIZE_BASE = 200 * layoutScale;

        const H_POS = { x: W * 0.2916667, y: H * 0.5370370 };
        const M_POS = { x: W * 0.7083333, y: H * 0.5370370 };
        const COLON_POS = { x: W * 0.5,      y: H * 0.4907407 };

        // clock center for transforms (roughly around the digits)
        clockCenter = {
          x: (H_POS.x + M_POS.x + COLON_POS.x) / 3,
          y: (H_POS.y + M_POS.y + COLON_POS.y) / 3,
        };

        // overlap-avoid scale
        const dHC = Math.abs(COLON_POS.x - H_POS.x);
        const dCM = Math.abs(M_POS.x - COLON_POS.x);

        const DIGIT_ASPECT = 0.62;
        const COLON_ASPECT = 0.50;

        const H_total_half = DIGIT_ASPECT * H_SIZE_BASE;
        const M_total_half = DIGIT_ASPECT * M_SIZE_BASE;
        const C_total_half = 0.5 * (COLON_ASPECT * COLON_SIZE_BASE);

        const needHC = H_total_half + C_total_half;
        const needCM = M_total_half + C_total_half;

        let scaleHC = dHC / needHC;
        let scaleCM = dCM / needCM;
        if (!isFinite(scaleHC) || scaleHC <= 0) scaleHC = 1;
        if (!isFinite(scaleCM) || scaleCM <= 0) scaleCM = 1;
        DIGIT_SCALE = Math.min(1, scaleHC, scaleCM);

        const H_SIZE = H_SIZE_BASE * DIGIT_SCALE;
        const M_SIZE = M_SIZE_BASE * DIGIT_SCALE;
        const COLON_SIZE = COLON_SIZE_BASE * DIGIT_SCALE;

        const WEIGHT_HM = 700;
        const WEIGHT_COLON = 100;

        const hm = clockStringHM();
        lastHMStr = hm;
        const HH = hm.slice(0,2);
        const MM = hm.slice(2,4);

        let txH = [], txM = [], txColon = [];
        FONT_WEIGHT = WEIGHT_HM;    fontSize = H_SIZE;     txH = buildTargetsFor(HH, HN, H_POS.x, H_POS.y);
        FONT_WEIGHT = WEIGHT_HM;    fontSize = M_SIZE;     txM = buildTargetsFor(MM, MN, M_POS.x, M_POS.y);
        FONT_WEIGHT = WEIGHT_COLON; fontSize = COLON_SIZE; txColon = buildTargetsFor(':', CN, COLON_POS.x, COLON_POS.y);

        function assign(start, count, targets){
          for (let i = 0; i < count; i++){
            const idx = start + i;
            const t = targets[i % targets.length];
            pts[idx].tx = t.x;
            pts[idx].ty = t.y;
          }
        }
        assign(0, HN, txH);
        assign(HN, MN, txM);
        assign(HN + MN, CN, txColon);

        guides = txH.concat(txM, txColon);
        updateSlimeParams();
      }

      // ---------- Detection ----------
      async function startCamera(){
        try{
          const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'}, audio:false});
          cam.stream = stream;
          cam.video.srcObject = stream;
          await cam.video.play();

          cam.enabled = true;
          cam.wrap.style.display = (cam.preview || (togglePreview && togglePreview.checked)) ? 'block' : 'none';

          if ('FaceDetector' in window){
            cam.detector = new window.FaceDetector({fastMode:true, maxDetectedFaces:1});
            cam.api = 'FaceDetector';
            updateDiag('診断: FaceDetector');
          } else {
            cam.motion.tmp = document.createElement('canvas');
            cam.motion.tmp.width = cam.motion.w;
            cam.motion.tmp.height = cam.motion.h;
            cam.motion.tctx = cam.motion.tmp.getContext('2d', {willReadFrequently:true});
            cam.api = 'Motion';
            updateDiag('診断: Motion Fallback');
          }

          if (fakeSeen) fakeSeen.checked = false;
        } catch(e){
          console.error(e);
          updateDiag('診断: カメラ不可（権限/環境）');
        }
      }

      function runDetection(now){
        if (!cam.enabled) return;

        if (cam.api === 'FaceDetector' && cam.detector){
          cam.detector.detect(cam.video).then((faces)=>{
            if (faces && faces.length > 0){
              cam.lastSeenAt = now;
              const bb = faces[0].boundingBox;
              const vw = cam.video.videoWidth || cam.video.width || 1;
              const vh = cam.video.videoHeight || cam.video.height || 1;
              const cx = (bb.x + bb.width*0.5) / vw;
              const cy = (bb.y + bb.height*0.5) / vh;
              // Preview is mirrored (scaleX(-1)), so mirror x to match user's feel
              cam.face.xN = clamp01(1 - cx);
              cam.face.yN = clamp01(cy);
              cam.face.has = true;
              cam.face.updatedAt = now;
            } else {
              cam.face.has = false;
            }
          }).catch(()=>{});
        } else if (cam.api === 'Motion'){
          const {w,h,tctx} = cam.motion;
          if (!tctx) return;
          tctx.drawImage(cam.video, 0, 0, w, h);
          const frame = tctx.getImageData(0,0,w,h);
          if (!cam.motion.prev){
            cam.motion.prev = frame;
          } else {
            const prev = cam.motion.prev;
            let sum = 0;
            const n = frame.data.length;
            for (let i=0;i<n;i+=4){
              sum += Math.abs(frame.data[i]-prev.data[i]) +
                     Math.abs(frame.data[i+1]-prev.data[i+1]) +
                     Math.abs(frame.data[i+2]-prev.data[i+2]);
            }
            const avg = sum/(w*h)/3;
            if (avg > 20) cam.lastSeenAt = now;
            cam.motion.prev = frame;
          }
          // Motion fallback cannot estimate face position reliably
          cam.face.has = false;
        }
      }

      function getFaceNorm(now){
        if (cam.enabled && cam.face.has && (now - cam.face.updatedAt) < 900){
          return {xN: cam.face.xN, yN: cam.face.yN, reliable:true};
        }
        // no camera (or not reliable): use mouse
        return {xN: simFace.xN, yN: simFace.yN, reliable:false};
      }

      // ---------- Target transform ----------
      function transformTarget(x, y){
        const cx = clockCenter.x;
        const cy = clockCenter.y;
        const s = clockTransform.scale || 1;
        return {
          x: cx + (x - cx) * s + (clockTransform.offsetX || 0),
          y: cy + (y - cy) * s + (clockTransform.offsetY || 0),
        };
      }

      // ---------- Enter / Exit transitions ----------
      function goIdle(now){
        mode = MODE_IDLE;
        enterState = null;
        exitState = null;
        displayStart = 0;
        clockTransform.scale = 1;
        clockTransform.offsetX = 0;
        clockTransform.offsetY = 0;
        clockTransform.alpha = 1;
        clockTransform.heat01 = 0;
        clockTransform.colonSpeed = 1;

        // give a small drift impulse so it immediately looks "slacky"
        for (let i=0;i<N;i++){
          const a = pts[i];
          a.vx += (Math.random()-0.5) * 2.5;
          a.vy += (Math.random()-0.5) * 2.5;
        }

        // smooth visuals back
        // (seenVis01 will lerp down automatically)
        if (typeof now === 'number'){
          // nothing
        }
      }

      function startEnter(now){
        // build the current HM targets once
        rebuildTargets();

        // pick pattern
        const type = ENTER_PATTERNS[Math.floor(Math.random() * ENTER_PATTERNS.length)];
        enterState = { type, start: now };
        mode = MODE_ENTER;
        exitState = null;

        // instant gather
        const r = ENTER_GATHER_RADIUS_BASE * layoutScale;
        const cx = clockCenter.x;
        const cy = clockCenter.y;

        for (let i=0;i<N;i++){
          const a = pts[i];
          const ang = Math.random() * Math.PI * 2;
          const rr = Math.sqrt(Math.random()) * r;
          a.x = cx + Math.cos(ang) * rr;
          a.y = cy + Math.sin(ang) * rr;

          // set initial bounce velocity
          const speedBase = (12 + Math.random() * 18) * layoutScale;
          if (type === ENTER_VERTICAL_BOUNCE){
            a.vx = (Math.random()-0.5) * 2.2 * layoutScale;
            a.vy = (Math.random() < 0.5 ? -1 : 1) * speedBase;
          } else if (type === ENTER_HORIZONTAL_BOUNCE){
            a.vx = (Math.random() < 0.5 ? -1 : 1) * speedBase;
            a.vy = (Math.random()-0.5) * 2.2 * layoutScale;
          } else { // RANDOM
            const ang2 = Math.random() * Math.PI * 2;
            a.vx = Math.cos(ang2) * speedBase;
            a.vy = Math.sin(ang2) * speedBase;
          }
        }

        // reset transform
        clockTransform.scale = 1;
        clockTransform.offsetX = 0;
        clockTransform.offsetY = 0;
        clockTransform.alpha = 1;
        clockTransform.heat01 = 0;
        clockTransform.colonSpeed = 1;
      }

      function startExit(now){
        const type = EXIT_PATTERNS[Math.floor(Math.random() * EXIT_PATTERNS.length)];
        exitState = { type, start: now, phase: 'start', exploded:false };
        mode = MODE_EXIT;
        enterState = null;

        // reset (will be animated)
        clockTransform.offsetX = 0;
        clockTransform.offsetY = 0;
        clockTransform.alpha = 1;
        clockTransform.colonSpeed = 1;
        // heat is eased in update loop
      }

      // ---------- Explosion impulse ----------
      function triggerExplosion(){
        const cx = clockCenter.x;
        const cy = clockCenter.y;
        for (let i=0;i<N;i++){
          const a = pts[i];
          const dx = a.x - cx;
          const dy = a.y - cy;
          const dist = Math.sqrt(dx*dx + dy*dy) || 1;
          const nx = dx / dist;
          const ny = dy / dist;
          const speed = EXPLOSION_SPEED_MIN + Math.random() * (EXPLOSION_SPEED_MAX - EXPLOSION_SPEED_MIN);
          a.vx = nx * speed;
          a.vy = ny * speed;
        }
      }

      // ---------- Draw slime ----------
      function drawSlime(now){
        if (!gBlob) return;

        updateSlimeParams();

        gBlob.push();
        gBlob.blendMode(gBlob.BLEND);
        gBlob.background(0);
        gBlob.blendMode(gBlob.ADD);
        gBlob.noStroke();

        const r = DISC_RADIUS;
        const BASE_ALPHA = (BASE_ALPHA_SEEN * seenVis01) + (BASE_ALPHA_UNSEEN * (1.0 - seenVis01));

        // Colon second-tick (speed can be boosted in EXIT_RED_EXPLODE)
        const tSec = (now || performance.now()) * 0.001;
        const colonSpeed = Math.max(1.0, clockTransform.colonSpeed || 1);
        const tt = tSec * colonSpeed;
        const sec = Math.floor(tt) % 60;
        const u = tt - Math.floor(tt); // 0..1

        const COLON_THIN_SCALE = 0.28;
        const digitsVisible = (mode !== MODE_IDLE);

        let colonScale;
        if (!digitsVisible){
          colonScale = 1.0;
        } else {
          const easeOut = 1 - Math.pow(1 - u, 5);
          if (sec % 2 === 0){
            colonScale = COLON_THIN_SCALE + (1 - COLON_THIN_SCALE) * easeOut;
          } else {
            colonScale = 1 - (1 - COLON_THIN_SCALE) * easeOut;
          }
        }

        const colonR = r * colonScale;

        // Density control for smaller screens
        const BASE_AREA = DESIGN_W * DESIGN_H;
        const area = Math.max(1, p.width * p.height);
        let densityScale = 1.0;
        if (area < BASE_AREA){
          const tArea = BASE_AREA / area;
          densityScale = Math.min(3.0, Math.pow(tArea, 0.7));
        }
        const B_H = 1400 * densityScale;
        const B_M = 1400 * densityScale;
        const B_S = 120 * densityScale;
        const B_C = 90 * densityScale;

        const sH = Math.max(1, Math.floor(HN / B_H));
        const sM = Math.max(1, Math.floor(MN / B_M));
        const sS = Math.max(1, Math.floor(Math.max(1,SN) / B_S));
        const sC = Math.max(1, Math.floor(CN / B_C));

        for (let i=0;i<HN;i+=sH){ const a=pts[i]; gBlob.fill(255, BASE_ALPHA); gBlob.circle(a.x/blobScale, a.y/blobScale, r*2); }
        for (let i=HN;i<HN+MN;i+=sM){ const a=pts[i]; gBlob.fill(255, BASE_ALPHA); gBlob.circle(a.x/blobScale, a.y/blobScale, r*2); }
        for (let i=HN+MN;i<HN+MN+SN;i+=sS){ const a=pts[i]; gBlob.fill(255, BASE_ALPHA); gBlob.circle(a.x/blobScale, a.y/blobScale, r*2); }
        for (let i=HN+MN+SN;i<N;i+=sC){ const a=pts[i]; gBlob.fill(255, BASE_ALPHA); gBlob.circle(a.x/blobScale, a.y/blobScale, colonR*2); }

        // Faint outline pass for H & M
        const OUTLINE_SCALE = 1.55;
        const sEff = Math.max(0.35, (layoutScale || 1) * (DIGIT_SCALE || 1) * Math.max(0.08, clockTransform.scale || 1));
        const OUTLINE_ALPHA = BASE_ALPHA * 0.40 * Math.min(1.0, Math.max(0.65, sEff));
        for (let i=0;i<HN;i+=sH){ const a=pts[i]; gBlob.fill(255, OUTLINE_ALPHA); gBlob.circle(a.x/blobScale, a.y/blobScale, r*OUTLINE_SCALE*2); }
        for (let i=HN;i<HN+MN;i+=sM){ const a=pts[i]; gBlob.fill(255, OUTLINE_ALPHA); gBlob.circle(a.x/blobScale, a.y/blobScale, r*OUTLINE_SCALE*2); }

        // guides
        if (USE_GUIDE && digitsVisible && guides && guides.length > 0){
          const gr = Math.max(2, Math.floor(GUIDE_RADIUS));
          gBlob.fill(255, GUIDE_ALPHA);
          for (let gi=0; gi<guides.length; gi+=4){
            const tg = transformTarget(guides[gi].x, guides[gi].y);
            gBlob.circle(tg.x/blobScale, tg.y/blobScale, gr*2);
          }
        }

        gBlob.pop();
        try { gBlob.filter(p.BLUR, BLUR_AMOUNT); } catch(e){}
        try { gBlob.filter(p.THRESHOLD, THRESH_LEVEL); } catch(e){ gBlob.filter(p.THRESHOLD); }

        // Tint by heat (white -> red) and alpha (fade out)
        const heat = clamp01(clockTransform.heat01 || 0);
        const alpha01 = clamp01(clockTransform.alpha || 1);
        const g = Math.round(255 * (1 - heat));
        const b = Math.round(255 * (1 - heat));

        p.push();
        p.tint(255, g, b, Math.round(255 * alpha01));
        p.image(gBlob, 0, 0, p.width, p.height);
        p.noTint();
        p.pop();
      }

      // ---------- Physics helpers ----------
      function bounceAllWalls(a){
        if (a.x < 0){ a.x = 0; a.vx *= -ENTER_BOUNCE_RESTITUTION; }
        if (a.x > p.width){ a.x = p.width; a.vx *= -ENTER_BOUNCE_RESTITUTION; }
        if (a.y < 0){ a.y = 0; a.vy *= -ENTER_BOUNCE_RESTITUTION; }
        if (a.y > p.height){ a.y = p.height; a.vy *= -ENTER_BOUNCE_RESTITUTION; }
      }
      function bounceVerticalWalls(a){
        // floor + ceiling: main bounce
        if (a.y < 0){ a.y = 0; a.vy *= -ENTER_BOUNCE_RESTITUTION; }
        if (a.y > p.height){ a.y = p.height; a.vy *= -ENTER_BOUNCE_RESTITUTION; }
        // side walls: weak
        if (a.x < 0){ a.x = 0; a.vx *= -ENTER_WALL_RESTITUTION; }
        if (a.x > p.width){ a.x = p.width; a.vx *= -ENTER_WALL_RESTITUTION; }
      }
      function bounceHorizontalWalls(a){
        if (a.x < 0){ a.x = 0; a.vx *= -ENTER_BOUNCE_RESTITUTION; }
        if (a.x > p.width){ a.x = p.width; a.vx *= -ENTER_BOUNCE_RESTITUTION; }
        if (a.y < 0){ a.y = 0; a.vy *= -ENTER_WALL_RESTITUTION; }
        if (a.y > p.height){ a.y = p.height; a.vy *= -ENTER_WALL_RESTITUTION; }
      }

      // ---------- Main loop ----------
      p.draw = function(){
        const now = performance.now();

        // Detection polling
        if (cam.enabled && (p.frameCount % DETECT_EVERY_N_FRAMES === 0)){
          runDetection(now);
        }

        const camSeen = cam.enabled ? (now - cam.lastSeenAt <= SEEN_DEBOUNCE_MS) : false;
        const rawSeen = cam.enabled ? camSeen : simSeen;
        const effectiveSeen = rawSeen && (now >= cooldownUntil);

        // Visual smoothing target: digits look when not idle
        {
          const target = (mode === MODE_IDLE) ? 0.0 : 1.0;
          const k = (target > seenVis01) ? SEEN_VIS_LERP_IN : SEEN_VIS_LERP_OUT;
          seenVis01 += (target - seenVis01) * k;
          if (seenVis01 < 0) seenVis01 = 0; else if (seenVis01 > 1) seenVis01 = 1;
        }

        // State transitions
        if (mode === MODE_IDLE){
          if (effectiveSeen){
            startEnter(now);
          }
        } else {
          // if we lose "seen", immediately slack
          if (!rawSeen){
            goIdle(now);
          }
        }

        // Background
        p.background(0);

        // Keep HM targets up-to-date only in DISPLAY (stable)
        if (mode === MODE_DISPLAY){
          const hm = clockStringHM();
          if (hm !== lastHMStr){
            rebuildTargets();
            lastHMStr = hm;
          }
        }

        // Mode updates
        if (mode === MODE_ENTER && enterState){
          const t = clamp01((now - enterState.start) / ENTER_DURATION_MS);
          const seek01 = smoothstep01((t - 0.08) / 0.92);
          const seek = SEEK_STRENGTH * ENTER_SEEK_MULT * seek01;

          // keep transform neutral during enter
          clockTransform.scale = 1;
          clockTransform.offsetX = 0;
          clockTransform.offsetY = 0;
          clockTransform.alpha = 1;
          clockTransform.heat01 = 0;
          clockTransform.colonSpeed = 1;

          for (let i=0;i<N;i++){
            const a = pts[i];
            const tp = transformTarget(a.tx, a.ty);

            // base air damping + tiny jitter
            a.vx = a.vx * ENTER_AIR_DAMP + (Math.random()-0.5) * IDLE_JITTER * 0.06;
            a.vy = a.vy * ENTER_AIR_DAMP + (Math.random()-0.5) * IDLE_JITTER * 0.06;

            // gradually start seeking to digit targets
            const dx = tp.x - a.x;
            const dy = tp.y - a.y;
            a.vx = (a.vx + dx * seek) * lerp(0.86, DAMP, seek01);
            a.vy = (a.vy + dy * seek) * lerp(0.86, DAMP, seek01);

            // integrate
            a.x += a.vx;
            a.y += a.vy;

            // bounce style
            if (enterState.type === ENTER_VERTICAL_BOUNCE) bounceVerticalWalls(a);
            else if (enterState.type === ENTER_HORIZONTAL_BOUNCE) bounceHorizontalWalls(a);
            else bounceAllWalls(a);
          }

          if (t >= 1){
            mode = MODE_DISPLAY;
            enterState = null;
            displayStart = now;
            // start stable with neutral visuals
            clockTransform.scale = 1;
            clockTransform.offsetX = 0;
            clockTransform.offsetY = 0;
            clockTransform.alpha = 1;
            clockTransform.heat01 = 0;
            clockTransform.colonSpeed = 1;
          }
        }

        if (mode === MODE_DISPLAY){
          // After stable for 3s: trigger a random EXIT pattern
          if (rawSeen && displayStart && (now - displayStart >= EXIT_STABLE_TRIGGER_MS)){
            startExit(now);
          }

          const tSec = now * 0.001;
          for (let i=0;i<N;i++){
            const a = pts[i];
            const tp = transformTarget(a.tx, a.ty);

            const phase = i * 0.37;
            const h = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
            const frac = h - Math.floor(h);
            const j = (frac - 0.5) * 2.0;
            const freqX = WOBBLE_BASE_HZ + j * WOBBLE_JITTER_HZ * 0.15;
            const freqY = WOBBLE_BASE_HZ * 1.3 + j * WOBBLE_JITTER_HZ * 0.11;
            const wobbleX = Math.sin(tSec * freqX + phase) * SEEN_WOBBLE;
            const wobbleY = Math.cos(tSec * freqY + phase * 1.7) * SEEN_WOBBLE;

            const dx = (tp.x + wobbleX) - a.x;
            const dy = (tp.y + wobbleY) - a.y;

            a.vx = (a.vx + dx * SEEK_STRENGTH) * DAMP;
            a.vy = (a.vy + dy * SEEK_STRENGTH) * DAMP;

            a.x += a.vx;
            a.y += a.vy;

            // keep within bounds
            if (a.x < 0){ a.x = 0; a.vx *= -0.5; }
            if (a.x > p.width){ a.x = p.width; a.vx *= -0.5; }
            if (a.y < 0){ a.y = 0; a.vy *= -0.5; }
            if (a.y > p.height){ a.y = p.height; a.vy *= -0.5; }
          }
        }

        if (mode === MODE_EXIT && exitState){
          const face = getFaceNorm(now);

          if (exitState.type === EXIT_RED_EXPLODE){
            const dt = now - exitState.start;
            const ramp01 = clamp01(dt / EXIT_RED_RAMP_MS);
            const hold01 = clamp01((dt - EXIT_RED_RAMP_MS) / EXIT_RED_HOLD_MS);

            const heatTarget = (dt < EXIT_RED_RAMP_MS) ? ramp01 : 1.0;
            clockTransform.heat01 += (heatTarget - clockTransform.heat01) * EXIT_HEAT_EASE;
            clockTransform.heat01 = clamp01(clockTransform.heat01);
            clockTransform.alpha = 1.0;

            // colon speeds up as it gets red
            clockTransform.colonSpeed = 1.0 + 9.0 * clockTransform.heat01;

            // scale + jitter while charging
            const pulse = Math.sin((now * 0.001) * (Math.PI * 2) * EXIT_PULSE_HZ) * EXIT_PULSE_AMP;
            const charge01 = (dt < EXIT_RED_RAMP_MS) ? ramp01 : clamp01(hold01);
            const scaleExtra = EXIT_SCALE_EXTRA * clockTransform.heat01;
            clockTransform.scale = 1.0 + scaleExtra * (0.55 + 0.45 * (1 + pulse) * 0.5);

            const jitterAmp = 2.0 * layoutScale * clockTransform.heat01;
            clockTransform.offsetX = (Math.random()-0.5) * jitterAmp;
            clockTransform.offsetY = (Math.random()-0.5) * jitterAmp;

            const explodeAt = EXIT_RED_RAMP_MS + EXIT_RED_HOLD_MS;
            if (dt >= explodeAt && !exitState.exploded){
              exitState.exploded = true;
              triggerExplosion();
              exitState.explodeStart = now;
            }

            if (exitState.exploded){
              // explosion phase
              clockTransform.heat01 = 1.0;
              clockTransform.colonSpeed = 10.0;
              clockTransform.scale = 1.0;
              clockTransform.offsetX = 0;
              clockTransform.offsetY = 0;

              for (let i=0;i<N;i++){
                const a = pts[i];
                a.vx = a.vx * EXPLOSION_DAMP + (Math.random()-0.5) * IDLE_JITTER * EXPLOSION_JITTER_GAIN;
                a.vy = a.vy * EXPLOSION_DAMP + (Math.random()-0.5) * IDLE_JITTER * EXPLOSION_JITTER_GAIN;
                a.x += a.vx;
                a.y += a.vy;
                // bounce lightly
                if (a.x < 0){ a.x = 0; a.vx *= -0.6; }
                if (a.x > p.width){ a.x = p.width; a.vx *= -0.6; }
                if (a.y < 0){ a.y = 0; a.vy *= -0.6; }
                if (a.y > p.height){ a.y = p.height; a.vy *= -0.6; }
              }

              const expDt = now - (exitState.explodeStart || now);
              if (expDt >= EXIT_EXPLOSION_MS){
                cooldownUntil = now + EXIT_COOLDOWN_MS;
                goIdle(now);
              }
            } else {
              // pre-explosion: still try to hold digits shape while shaking
              const tSec = now * 0.001;
              for (let i=0;i<N;i++){
                const a = pts[i];
                const tp0 = transformTarget(a.tx, a.ty);

                const phase = i * 0.37;
                const wobbleX = Math.sin(tSec * (WOBBLE_BASE_HZ + 0.2) + phase) * (SEEN_WOBBLE * 0.6);
                const wobbleY = Math.cos(tSec * (WOBBLE_BASE_HZ + 0.25) + phase * 1.7) * (SEEN_WOBBLE * 0.6);

                const dx = (tp0.x + wobbleX) - a.x;
                const dy = (tp0.y + wobbleY) - a.y;

                a.vx = (a.vx + dx * SEEK_STRENGTH) * DAMP;
                a.vy = (a.vy + dy * SEEK_STRENGTH) * DAMP;
                a.x += a.vx;
                a.y += a.vy;

                if (a.x < 0){ a.x = 0; a.vx *= -0.5; }
                if (a.x > p.width){ a.x = p.width; a.vx *= -0.5; }
                if (a.y < 0){ a.y = 0; a.vy *= -0.5; }
                if (a.y > p.height){ a.y = p.height; a.vy *= -0.5; }
              }
            }
          }

          else if (exitState.type === EXIT_FADE_OUT){
            const dt = now - exitState.start;
            const t = clamp01(dt / EXIT_FADE_MS);
            const e = easeOutQuint(t);

            clockTransform.heat01 = 0;
            clockTransform.colonSpeed = 1;
            clockTransform.scale = 1;
            clockTransform.offsetX = 0;
            clockTransform.offsetY = 0;
            clockTransform.alpha = 1 - e;

            const tSec = now * 0.001;
            for (let i=0;i<N;i++){
              const a = pts[i];
              const tp = transformTarget(a.tx, a.ty);
              const phase = i * 0.37;
              const wobbleX = Math.sin(tSec * WOBBLE_BASE_HZ + phase) * (SEEN_WOBBLE * 0.35);
              const wobbleY = Math.cos(tSec * WOBBLE_BASE_HZ * 1.3 + phase * 1.7) * (SEEN_WOBBLE * 0.35);
              const dx = (tp.x + wobbleX) - a.x;
              const dy = (tp.y + wobbleY) - a.y;
              a.vx = (a.vx + dx * SEEK_STRENGTH) * DAMP;
              a.vy = (a.vy + dy * SEEK_STRENGTH) * DAMP;
              a.x += a.vx;
              a.y += a.vy;
            }

            if (t >= 1){
              cooldownUntil = now + EXIT_COOLDOWN_MS;
              goIdle(now);
            }
          }

          else { // EXIT_ZOOM_OUT_TRACKING
            const dt = now - exitState.start;
            const t = clamp01(dt / EXIT_ZOOM_TOTAL_MS);

            // scale: quick kick, then keep retreating
            let sc;
            if (dt <= EXIT_ZOOM_KICK_MS){
              const k = easeOutQuint(dt / EXIT_ZOOM_KICK_MS);
              sc = lerp(1.0, EXIT_ZOOM_KICK_SCALE, k);
            } else {
              const tt = clamp01((dt - EXIT_ZOOM_KICK_MS) / (EXIT_ZOOM_TOTAL_MS - EXIT_ZOOM_KICK_MS));
              sc = lerp(EXIT_ZOOM_KICK_SCALE, EXIT_ZOOM_FINAL_SCALE, smoothstep01(tt));
            }

            // offset grows as it retreats
            const depth01 = clamp01(1 - (sc / 1.0));
            const offsetMax = EXIT_ZOOM_OFFSET_MAX_BASE * layoutScale * lerp(0.65, 1.0, depth01);
            const dxN = (face.xN - 0.5) * 2; // -1..1
            const dyN = (face.yN - 0.5) * 2;

            // opposite direction = run away
            const ox = (-dxN) * offsetMax;
            const oy = (-dyN) * offsetMax;

            clockTransform.scale = sc;
            clockTransform.offsetX = ox;
            clockTransform.offsetY = oy;
            clockTransform.alpha = 1;
            clockTransform.heat01 = 0;
            clockTransform.colonSpeed = 1;

            // seek to transformed (scaled+offset) targets
            const tSec = now * 0.001;
            const wobbleAmp = SEEN_WOBBLE * lerp(0.25, 0.05, depth01);
            for (let i=0;i<N;i++){
              const a = pts[i];
              const tp = transformTarget(a.tx, a.ty);
              const phase = i * 0.37;
              const wobbleX = Math.sin(tSec * (WOBBLE_BASE_HZ + 0.08) + phase) * wobbleAmp;
              const wobbleY = Math.cos(tSec * (WOBBLE_BASE_HZ + 0.10) + phase * 1.7) * wobbleAmp;
              const dx = (tp.x + wobbleX) - a.x;
              const dy = (tp.y + wobbleY) - a.y;
              a.vx = (a.vx + dx * SEEK_STRENGTH) * DAMP;
              a.vy = (a.vy + dy * SEEK_STRENGTH) * DAMP;
              a.x += a.vx;
              a.y += a.vy;

              if (a.x < 0){ a.x = 0; a.vx *= -0.5; }
              if (a.x > p.width){ a.x = p.width; a.vx *= -0.5; }
              if (a.y < 0){ a.y = 0; a.vy *= -0.5; }
              if (a.y > p.height){ a.y = p.height; a.vy *= -0.5; }
            }

            if (t >= 1){
              cooldownUntil = now + EXIT_COOLDOWN_MS;
              goIdle(now);
            }
          }
        }

        if (mode === MODE_IDLE){
          // slack drift
          for (let i=0;i<N;i++){
            const a = pts[i];
            a.vx = (a.vx + (Math.random()-0.5) * IDLE_JITTER) * 0.98;
            a.vy = (a.vy + (Math.random()-0.5) * IDLE_JITTER) * 0.98;
            a.x += a.vx;
            a.y += a.vy;
            if (a.x < 0){ a.x = 0; a.vx *= -0.5; }
            if (a.x > p.width){ a.x = p.width; a.vx *= -0.5; }
            if (a.y < 0){ a.y = 0; a.vy *= -0.5; }
            if (a.y > p.height){ a.y = p.height; a.vy *= -0.5; }
          }
          // keep visuals neutral
          clockTransform.scale = 1;
          clockTransform.offsetX = 0;
          clockTransform.offsetY = 0;
          clockTransform.alpha = 1;
          clockTransform.heat01 = 0;
          clockTransform.colonSpeed = 1;
        }

        // Render
        drawSlime(now);
      };

      window.addEventListener('resize', ()=>{ resize(); applyFitScale(); });
    };

    new p5(sketch);
  }

  if (document.readyState === 'loading'){
    window.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
