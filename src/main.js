/*
  Cartoon Clock / サボる時計
  v0.2.1 (制作_v8)

  - 4秒ルール（続き / 新セッション）
  - 3秒ルール（ご褒美 EXIT）
  - ENTER 5パターン / EXIT 3パターン + POST
  - デバッグUI（強制遷移・追従シミュ）

  NOTE:
  - まず「動作確認」を優先し、見た目は v0.1.17 の雰囲気を維持しつつ簡略化しています。
*/

(function(){
  'use strict';

  function boot(){
    const VERSION = 'v0.2.1';
    console.log('[Saboclock]', VERSION);

    // ---------- DOM ----------
    const holder = document.getElementById('canvas-holder');
    const btnSettings = document.getElementById('btnSettings');
    const settingsPanel = document.getElementById('settings-panel');
    const btnCam = document.getElementById('btnCam');
    const btnSim = document.getElementById('btnSim');
    const fakeSeen = document.getElementById('fakeSeen');
    const togglePreview = document.getElementById('togglePreview');
    const camWrap = document.getElementById('camWrap');
    const camVideo = document.getElementById('cam');

    const useSim = document.getElementById('useSim');
    const simHasFace = document.getElementById('simHasFace');
    const simFaceX = document.getElementById('simFaceX');
    const simFaceY = document.getElementById('simFaceY');
    const simFaceDist = document.getElementById('simFaceDist');

    const dbgGoIdle = document.getElementById('dbgGoIdle');
    const dbgGoShow = document.getElementById('dbgGoShow');
    const dbgContinue = document.getElementById('dbgContinue');
    const dbgNewSession = document.getElementById('dbgNewSession');
    const dbgEnterSel = document.getElementById('dbgEnterSel');
    const dbgEnterGo = document.getElementById('dbgEnterGo');
    const dbgExitSel = document.getElementById('dbgExitSel');
    const dbgExitGo = document.getElementById('dbgExitGo');
    const dbgReadout = document.getElementById('dbgReadout');

    if (btnSettings && settingsPanel){
      btnSettings.addEventListener('click', ()=>{
        const visible = settingsPanel.style.display === 'block';
        settingsPanel.style.display = visible ? 'none' : 'block';
      });
    }

    // ---------- Camera (optional) ----------
    const cam = {
      enabled: false,
      preview: false,
      stream: null,
      detector: null,
      api: 'none',
      lastSeenAt: 0,
      lastBox: null, // {x,y,width,height}
      motion: { prev:null, w:160, h:90, tmp:null, tctx:null },
    };

    async function startCamera(){
      if (!camVideo) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio:false });
        cam.stream = stream;
        camVideo.srcObject = stream;
        await camVideo.play();
        cam.enabled = true;
        cam.preview = !!(togglePreview && togglePreview.checked);
        if (camWrap) camWrap.style.display = cam.preview ? 'block' : 'none';

        if ('FaceDetector' in window){
          cam.detector = new window.FaceDetector({ fastMode:true, maxDetectedFaces: 1 });
          cam.api = 'FaceDetector';
        } else {
          cam.motion.tmp = document.createElement('canvas');
          cam.motion.tmp.width = cam.motion.w;
          cam.motion.tmp.height = cam.motion.h;
          cam.motion.tctx = cam.motion.tmp.getContext('2d', { willReadFrequently:true });
          cam.api = 'Motion';
        }

        if (fakeSeen) fakeSeen.checked = false;
        if (useSim) useSim.checked = false;
      } catch (e){
        console.error(e);
        alert('カメラが開始できませんでした（権限 / 環境を確認してください）');
      }
    }

    function stopCamera(){
      cam.enabled = false;
      cam.lastBox = null;
      if (cam.stream){
        for (const t of cam.stream.getTracks()) t.stop();
      }
      cam.stream = null;
      if (camWrap) camWrap.style.display = 'none';
      if (camVideo) camVideo.srcObject = null;
    }

    async function toggleCamera(){
      if (cam.enabled) stopCamera();
      else await startCamera();
    }

    function runDetection(nowMs){
      if (!cam.enabled) return;
      if (cam.api === 'FaceDetector' && cam.detector){
        cam.detector.detect(camVideo).then((faces)=>{
          if (faces && faces.length > 0){
            cam.lastSeenAt = nowMs;
            const b = faces[0].boundingBox;
            cam.lastBox = { x: b.x, y: b.y, width: b.width, height: b.height };
          }
        }).catch(()=>{});
      } else if (cam.api === 'Motion'){
        const {w,h,tctx} = cam.motion;
        if (!tctx) return;
        tctx.drawImage(camVideo, 0, 0, w, h);
        const frame = tctx.getImageData(0,0,w,h);
        if (!cam.motion.prev){
          cam.motion.prev = frame;
        } else {
          const prev = cam.motion.prev;
          let sum = 0;
          for (let i=0;i<frame.data.length;i+=4){
            sum += Math.abs(frame.data[i]-prev.data[i]);
            sum += Math.abs(frame.data[i+1]-prev.data[i+1]);
            sum += Math.abs(frame.data[i+2]-prev.data[i+2]);
          }
          const avg = sum/(w*h)/3;
          if (avg > 20) cam.lastSeenAt = nowMs;
          cam.motion.prev = frame;
        }
      }
    }

    if (togglePreview){
      togglePreview.addEventListener('change', ()=>{
        cam.preview = !!togglePreview.checked;
        if (camWrap) camWrap.style.display = (cam.enabled && cam.preview) ? 'block' : 'none';
      });
    }

    if (btnCam) btnCam.addEventListener('click', ()=>{ toggleCamera(); });
    if (btnSim) btnSim.addEventListener('click', ()=>{
      if (useSim) useSim.checked = true;
      if (simHasFace) simHasFace.checked = true;
      if (fakeSeen) fakeSeen.checked = true;
    });

    // ---------- p5 sketch ----------
    const sketch = (p)=>{
      // ---- Design / Particles ----
      const DESIGN_W = 1920;
      const DESIGN_H = 1080;

      const N = 1650;
      const HN = 770;
      const MN = 770;
      const CN = 110;

      // digits layout (design coords)
      const H_POS = { x: 660, y: 540 };
      const M_POS = { x: 1260, y: 540 };
      const COLON_POS = { x: 960, y: 515 };

      // sizes (relative to height)
      const SIZE_HM_REL = 0.325;   // ~350 @1080
      const SIZE_COLON_REL = 0.185; // ~200 @1080

      // slime
      const MAX_BLOB_PIXELS = 1800000;
      let blobScale = 2;
      let discR = 11.5;
      let blurAmt = 2.5;
      let thr = 0.70;

      // physics
      const IDLE_JITTER = 0.35;
      const SEEK_BASE = 0.085;
      const DAMP_BASE = 0.78;

      // states
      const STATE = Object.freeze({
        IDLE_SABORU: 'IDLE_SABORU',

        ENTER_QUICK_SQUASH: 'ENTER_QUICK_SQUASH',
        ENTER_VERTICAL_BOUNCE: 'ENTER_VERTICAL_BOUNCE',
        ENTER_HORIZONTAL_BOUNCE: 'ENTER_HORIZONTAL_BOUNCE',
        ENTER_RANDOM_BOUNCE: 'ENTER_RANDOM_BOUNCE',
        ENTER_EDGE_SQUASH: 'ENTER_EDGE_SQUASH',
        ENTER_SQUASH_WITH_LAG: 'ENTER_SQUASH_WITH_LAG',

        SHOW_TIME: 'SHOW_TIME',

        EXIT_RED_EXPLOSION: 'EXIT_RED_EXPLOSION',
        EXIT_FADE_OUT: 'EXIT_FADE_OUT',
        EXIT_ZOOM_OUT_TRACKING: 'EXIT_ZOOM_OUT_TRACKING',

        POST_RED_EXPLOSION: 'POST_RED_EXPLOSION',
        POST_FADE_OUT_INVISIBLE: 'POST_FADE_OUT_INVISIBLE',
        POST_ZOOM_OUT_TRACKING: 'POST_ZOOM_OUT_TRACKING',

        RECOVER_RED: 'RECOVER_RED',
        RECOVER_FADE: 'RECOVER_FADE',
        RECOVER_ZOOM: 'RECOVER_ZOOM',
      });

      let state = STATE.IDLE_SABORU;
      let stateStartedAt = performance.now();
      let lastFaceLostAt = performance.now() - 999999;
      let stateData = {};

      // face input
      let hasFace = false;
      let prevHasFace = false;
      let faceX01 = 0.5;
      let faceY01 = 0.5;
      let faceClose01 = 0.5;

      // visual controls
      let slimeHeat01 = 0.0;   // 0=white,1=red
      let slimeAlpha01 = 1.0;  // 0..1
      let colonBlinkSpeed = 1.0; // 1=normal
      let clockScale = 1.0;
      let clockOffX = 0.0;
      let clockOffY = 0.0;
      let squashX = 1.0;
      let squashY = 1.0;

      // particles
      const pts = new Array(N).fill(0).map((_,i)=>({
        x:0,y:0,vx:0,vy:0,
        tx:0,ty:0,
        group: (i < HN) ? 0 : (i < HN+MN ? 1 : 2),
        activeAt: 0,
      }));

      // buffers
      let gBlob = null;
      let gText = null;

      // time targets
      let lastHM = '';

      // ---- utils ----
      const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
      const lerp = (a,b,t)=>a+(b-a)*t;
      const easeOutQuint = (t)=>1 - Math.pow(1-t,5);
      const easeInOutCubic = (t)=> t<0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2;

      function nowMs(){ return performance.now(); }

      function setState(s, data){
        state = s;
        stateData = data || {};
        stateStartedAt = nowMs();
      }

      function clockHM(){
        const d = new Date();
        const pad = (n)=>String(n).padStart(2,'0');
        return pad(d.getHours()) + pad(d.getMinutes());
      }

      function updateBlobParams(){
        const area = Math.max(1, p.width * p.height);
        blobScale = Math.max(2, Math.ceil(Math.sqrt(area / MAX_BLOB_PIXELS)));
        const s = Math.max(0.35, Math.min(1.6, Math.min(p.width/DESIGN_W, p.height/DESIGN_H)));
        discR = 11.5 * s;
        blurAmt = clamp(2.5 * s, 1.2, 4.2);
        thr = clamp(0.70 - (s-1)*0.06, 0.52, 0.76);

        const bw = Math.max(64, Math.floor(p.width / blobScale));
        const bh = Math.max(64, Math.floor(p.height / blobScale));
        gBlob = p.createGraphics(bw, bh);
        gBlob.pixelDensity(1);
      }

      function ensureTextBuffer(){
        gText = p.createGraphics(p.width, p.height);
        gText.pixelDensity(1);
      }

      function drawFontText(g, text, sizePx, cx, cy, weight){
        const ctx = g.drawingContext;
        ctx.save();
        ctx.clearRect(0,0,g.width,g.height);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const fam = `'Inter', system-ui, -apple-system, sans-serif`;
        ctx.font = `${weight} ${Math.round(sizePx)}px ${fam}`;

        // measure with a tiny negative tracking for Inter feel
        const tracking = -0.02;
        let total = 0;
        for (const ch of text){
          const w = ctx.measureText(ch).width;
          total += w * (1 + tracking);
        }
        let x = cx - total/2;
        for (const ch of text){
          const w = ctx.measureText(ch).width * (1 + tracking);
          ctx.fillText(ch, x, cy);
          x += w;
        }
        ctx.restore();
      }

      function sampleTargetsFromBuffer(g, count){
        g.loadPixels();
        const pts = [];
        const step = 2;
        for (let y=0; y<g.height; y+=step){
          for (let x=0; x<g.width; x+=step){
            const idx = 4*(y*g.width + x) + 3;
            if (g.pixels[idx] > 0) pts.push({x,y});
          }
        }
        if (pts.length === 0){
          // fallback
          for (let i=0;i<count;i++) pts.push({x: p.width/2 + (Math.random()-0.5)*20, y: p.height/2 + (Math.random()-0.5)*20});
        }
        // pick evenly (deterministic-ish)
        const out = new Array(count);
        for (let i=0;i<count;i++){
          out[i] = pts[(i * 997) % pts.length];
        }
        return out;
      }

      function rebuildTargets(){
        if (!gText) ensureTextBuffer();

        const hm = clockHM();
        lastHM = hm;
        const HH = hm.slice(0,2);
        const MM = hm.slice(2,4);

        const s = Math.min(p.width/DESIGN_W, p.height/DESIGN_H);
        const sizeHM = p.height * SIZE_HM_REL;
        const sizeColon = p.height * SIZE_COLON_REL;

        // positions scaled like design around center
        const ox = (p.width - DESIGN_W*s)/2;
        const oy = (p.height - DESIGN_H*s)/2;
        const hx = ox + H_POS.x * s;
        const hy = oy + H_POS.y * s;
        const mx = ox + M_POS.x * s;
        const my = oy + M_POS.y * s;
        const cx = ox + COLON_POS.x * s;
        const cy = oy + COLON_POS.y * s;

        // HH
        drawFontText(gText, HH, sizeHM, hx, hy, 900);
        const tH = sampleTargetsFromBuffer(gText, HN);
        // MM
        drawFontText(gText, MM, sizeHM, mx, my, 900);
        const tM = sampleTargetsFromBuffer(gText, MN);
        // :
        drawFontText(gText, ':', sizeColon, cx, cy, 100);
        const tC = sampleTargetsFromBuffer(gText, CN);

        for (let i=0;i<HN;i++){
          pts[i].tx = tH[i].x; pts[i].ty = tH[i].y;
        }
        for (let i=0;i<MN;i++){
          const a = pts[HN+i];
          a.tx = tM[i].x; a.ty = tM[i].y;
        }
        for (let i=0;i<CN;i++){
          const a = pts[HN+MN+i];
          a.tx = tC[i].x; a.ty = tC[i].y;
        }
      }

      function instantGather(){
        const cx = p.width*0.5;
        const cy = p.height*0.5;
        const r = Math.min(p.width, p.height) * 0.04;
        for (let i=0;i<N;i++){
          const a = pts[i];
          const ang = Math.random()*Math.PI*2;
          const rr = Math.random()*r;
          a.x = cx + Math.cos(ang)*rr;
          a.y = cy + Math.sin(ang)*rr;
          a.vx = 0;
          a.vy = 0;
          a.activeAt = 0;
        }
      }

      function startIdle(){
        slimeHeat01 = 0.0;
        slimeAlpha01 = 1.0;
        colonBlinkSpeed = 1.0;
        clockScale = 1.0;
        clockOffX = 0.0;
        clockOffY = 0.0;
        squashX = squashY = 1.0;
        for (let i=0;i<N;i++){
          const a = pts[i];
          a.activeAt = 0;
        }
        setState(STATE.IDLE_SABORU, {});
      }

      function startShow(){
        rebuildTargets();
        slimeHeat01 = 0.0;
        slimeAlpha01 = 1.0;
        colonBlinkSpeed = 1.0;
        clockScale = 1.0;
        clockOffX = 0;
        clockOffY = 0;
        squashX = squashY = 1.0;
        setState(STATE.SHOW_TIME, {});
      }

      function startEnterQuickSquash(){
        instantGather();
        rebuildTargets();
        setState(STATE.ENTER_QUICK_SQUASH, { dur: 650 });
      }

      function startEnterBounce(mode){
        instantGather();
        rebuildTargets();
        const cx = p.width*0.5;
        const cy = p.height*0.5;
        const sp = Math.min(p.width, p.height) * 0.018;
        for (let i=0;i<N;i++){
          const a = pts[i];
          if (mode === 'V'){
            a.vx = (Math.random()-0.5) * sp * 0.55;
            a.vy = (Math.random()<0.5?-1:1) * (sp * (0.7 + Math.random()*0.8));
          } else if (mode === 'H'){
            a.vx = (Math.random()<0.5?-1:1) * (sp * (0.7 + Math.random()*0.8));
            a.vy = (Math.random()-0.5) * sp * 0.55;
          } else {
            const ang = Math.random()*Math.PI*2;
            const v = sp * (0.8 + Math.random()*1.1);
            a.vx = Math.cos(ang)*v;
            a.vy = Math.sin(ang)*v;
          }
          // tiny kick away from exact center
          a.x += (Math.random()-0.5)*6;
          a.y += (Math.random()-0.5)*6;
          // keep within
          a.x = clamp(a.x, 0, p.width);
          a.y = clamp(a.y, 0, p.height);
        }
        const s = (mode==='V') ? STATE.ENTER_VERTICAL_BOUNCE : (mode==='H' ? STATE.ENTER_HORIZONTAL_BOUNCE : STATE.ENTER_RANDOM_BOUNCE);
        setState(s, { dur: 1350 });
      }

      function startEnterEdgeSquash(){
        rebuildTargets();
        const edge = ['top','bottom','left','right'][Math.floor(Math.random()*4)];
        for (let i=0;i<N;i++){
          const a = pts[i];
          if (edge==='top'){
            a.x = Math.random()*p.width;
            a.y = -20 - Math.random()*30;
          } else if (edge==='bottom'){
            a.x = Math.random()*p.width;
            a.y = p.height + 20 + Math.random()*30;
          } else if (edge==='left'){
            a.x = -20 - Math.random()*30;
            a.y = Math.random()*p.height;
          } else {
            a.x = p.width + 20 + Math.random()*30;
            a.y = Math.random()*p.height;
          }
          a.vx = 0;
          a.vy = 0;
          a.activeAt = 0;
        }
        setState(STATE.ENTER_EDGE_SQUASH, { dur: 1500, edge });
      }

      function startEnterSquashWithLag(){
        instantGather();
        rebuildTargets();
        const now = nowMs();
        // choose lag particles
        const lagFrac = 0.20;
        const lagN = Math.floor(N*lagFrac);
        const chosen = new Set();
        while (chosen.size < lagN){
          chosen.add(Math.floor(Math.random()*N));
        }
        for (let i=0;i<N;i++){
          const a = pts[i];
          a.activeAt = chosen.has(i) ? (now + 480 + Math.random()*520) : now;
          // give them a 'yoroyoro'
          a.vx = (Math.random()-0.5)*1.2;
          a.vy = (Math.random()-0.5)*1.2;
        }
        setState(STATE.ENTER_SQUASH_WITH_LAG, { dur: 1550 });
      }

      function startEnterRandom5(){
        const r = Math.random();
        if (r < 0.20) startEnterBounce('V');
        else if (r < 0.40) startEnterBounce('H');
        else if (r < 0.60) startEnterBounce('R');
        else if (r < 0.80) startEnterEdgeSquash();
        else startEnterSquashWithLag();
      }

      function triggerExplosion(){
        const cx = p.width*0.5;
        const cy = p.height*0.5;
        const minSp = Math.min(p.width,p.height)*0.018;
        const maxSp = Math.min(p.width,p.height)*0.036;
        for (let i=0;i<N;i++){
          const a = pts[i];
          const dx = a.x - cx;
          const dy = a.y - cy;
          const dist = Math.sqrt(dx*dx + dy*dy) || 1;
          const nx = dx/dist;
          const ny = dy/dist;
          const speed = minSp + Math.random()*(maxSp-minSp);
          a.vx = nx * speed;
          a.vy = ny * speed;
        }
      }

      function startExitRandom3(){
        const r = Math.random();
        if (r < 0.34) startExitRedExplosion();
        else if (r < 0.67) startExitFadeOut();
        else startExitZoomOut();
      }

      function startExitRedExplosion(){
        setState(STATE.EXIT_RED_EXPLOSION, { dur: 1400 });
      }

      function startExitFadeOut(){
        setState(STATE.EXIT_FADE_OUT, { dur: 1400 });
      }

      function startExitZoomOut(){
        setState(STATE.EXIT_ZOOM_OUT_TRACKING, { dur: 360 });
      }

      function startRecover(which){
        if (which === 'RED') setState(STATE.RECOVER_RED, { dur: 1200 });
        else if (which === 'FADE') setState(STATE.RECOVER_FADE, { dur: 1400 });
        else setState(STATE.RECOVER_ZOOM, { dur: 900 });
      }

      // ---- debug UI hooks ----
      function bindDebugUIOnce(){
        if (dbgGoIdle) dbgGoIdle.addEventListener('click', ()=>{ startIdle(); });
        if (dbgGoShow) dbgGoShow.addEventListener('click', ()=>{ startShow(); });
        if (dbgContinue) dbgContinue.addEventListener('click', ()=>{ if (simHasFace) simHasFace.checked = true; if (useSim) useSim.checked = true; });
        if (dbgNewSession) dbgNewSession.addEventListener('click', ()=>{ lastFaceLostAt = nowMs() - 5000; if (simHasFace) simHasFace.checked = true; if (useSim) useSim.checked = true; });

        if (dbgEnterGo && dbgEnterSel) dbgEnterGo.addEventListener('click', ()=>{
          if (useSim) useSim.checked = true;
          if (simHasFace) simHasFace.checked = true;
          lastFaceLostAt = nowMs() - 5000;
          const v = dbgEnterSel.value;
          if (v === 'ENTER_VERTICAL_BOUNCE') startEnterBounce('V');
          else if (v === 'ENTER_HORIZONTAL_BOUNCE') startEnterBounce('H');
          else if (v === 'ENTER_RANDOM_BOUNCE') startEnterBounce('R');
          else if (v === 'ENTER_EDGE_SQUASH') startEnterEdgeSquash();
          else if (v === 'ENTER_SQUASH_WITH_LAG') startEnterSquashWithLag();
        });

        if (dbgExitGo && dbgExitSel) dbgExitGo.addEventListener('click', ()=>{
          if (useSim) useSim.checked = true;
          if (simHasFace) simHasFace.checked = true;
          const v = dbgExitSel.value;
          if (v === 'EXIT_RED_EXPLOSION') startExitRedExplosion();
          else if (v === 'EXIT_FADE_OUT') startExitFadeOut();
          else if (v === 'EXIT_ZOOM_OUT_TRACKING') startExitZoomOut();
        });
      }

      // ---- input update ----
      function updateHasFaceAndFaceParams(now){
        // 1) simulation UI
        if (useSim && useSim.checked){
          hasFace = !!(simHasFace && simHasFace.checked);
          faceX01 = simFaceX ? parseFloat(simFaceX.value) : 0.5;
          faceY01 = simFaceY ? parseFloat(simFaceY.value) : 0.5;
          faceClose01 = simFaceDist ? parseFloat(simFaceDist.value) : 0.5;
          return;
        }

        // 2) camera
        if (cam.enabled){
          const camSeen = (now - cam.lastSeenAt) <= 1200;
          hasFace = camSeen;
          if (cam.lastBox && camVideo && camVideo.videoWidth){
            const vw = camVideo.videoWidth;
            const vh = camVideo.videoHeight;
            const cx = cam.lastBox.x + cam.lastBox.width * 0.5;
            const cy = cam.lastBox.y + cam.lastBox.height * 0.5;
            // mirror correction (preview is mirrored)
            faceX01 = clamp(1.0 - (cx / vw), 0, 1);
            faceY01 = clamp(cy / vh, 0, 1);
            const area = (cam.lastBox.width * cam.lastBox.height) / Math.max(1, vw*vh);
            faceClose01 = clamp((area - 0.02) / 0.12, 0, 1);
          } else {
            faceX01 = 0.5; faceY01 = 0.5; faceClose01 = hasFace ? 0.55 : 0.35;
          }
          return;
        }

        // 3) legacy checkbox
        hasFace = !!(fakeSeen && fakeSeen.checked);
        faceX01 = 0.5;
        faceY01 = 0.5;
        faceClose01 = hasFace ? 0.55 : 0.35;
      }

      function updateTransformsForZoomGag(){
        const MAX_OFF_X = p.width * 0.18;
        const MAX_OFF_Y = p.height * 0.18;
        const offX = (0.5 - faceX01) * MAX_OFF_X; // face right -> clock left
        const offY = (0.5 - faceY01) * MAX_OFF_Y; // face up -> clock down
        const scaleFar = 1.05;
        const scaleClose = 0.36;
        const targetScale = lerp(scaleFar, scaleClose, faceClose01);

        clockOffX += (offX - clockOffX) * 0.18;
        clockOffY += (offY - clockOffY) * 0.18;
        clockScale += (targetScale - clockScale) * 0.14;
      }

      // ---- rendering ----
      function renderSlime(){
        if (!gBlob) return;
        gBlob.push();
        gBlob.background(0);
        gBlob.blendMode(gBlob.ADD);
        gBlob.noStroke();

        const baseAlpha = 28;
        const r = discR;

        // colon blink: speed-up by time warp
        const t = (Date.now() / 1000) * colonBlinkSpeed;
        const frac = t - Math.floor(t);
        const ease = easeOutQuint(frac);
        const colonThin = 0.28;
        const colonScale = lerp(colonThin, 1.0, ease);
        const colonR = r * colonScale;

        const strideHM = 1;
        const strideC = 1;

        for (let i=0;i<HN;i+=strideHM){
          const a = pts[i];
          gBlob.fill(255, baseAlpha);
          gBlob.circle(a.x/blobScale, a.y/blobScale, r*2);
        }
        for (let i=HN;i<HN+MN;i+=strideHM){
          const a = pts[i];
          gBlob.fill(255, baseAlpha);
          gBlob.circle(a.x/blobScale, a.y/blobScale, r*2);
        }
        for (let i=HN+MN;i<N;i+=strideC){
          const a = pts[i];
          gBlob.fill(255, baseAlpha);
          gBlob.circle(a.x/blobScale, a.y/blobScale, colonR*2);
        }

        gBlob.pop();
        try { gBlob.filter(p.BLUR, blurAmt); } catch(e){}
        try { gBlob.filter(p.THRESHOLD, thr); } catch(e){ try { gBlob.filter(p.THRESHOLD); } catch(e2){} }

        // tint (white -> red) + alpha
        const g = Math.round(255 * (1.0 - slimeHeat01));
        const b = g;
        const a255 = Math.round(255 * slimeAlpha01);

        p.push();
        p.tint(255, g, b, a255);
        p.image(gBlob, 0, 0, p.width, p.height);
        p.pop();
      }

      // ---- physics update ----
      function transformedTarget(a){
        const cx = p.width*0.5;
        const cy = p.height*0.5;
        const sx = clockScale * squashX;
        const sy = clockScale * squashY;
        return {
          x: cx + (a.tx - cx)*sx + clockOffX,
          y: cy + (a.ty - cy)*sy + clockOffY,
        };
      }

      function stepParticles(seekK, damp){
        const cx = p.width*0.5;
        const cy = p.height*0.5;
        const idleBoxW = Math.min(p.width, p.height) * 0.55;
        const idleBoxH = Math.min(p.width, p.height) * 0.28;

        for (let i=0;i<N;i++){
          const a = pts[i];

          if (state === STATE.IDLE_SABORU){
            // idle wander around center area
            a.vx = (a.vx + (Math.random()-0.5)*IDLE_JITTER) * 0.985;
            a.vy = (a.vy + (Math.random()-0.5)*IDLE_JITTER) * 0.985;

            // gentle pull to center box
            const tx = cx + clamp(a.x - cx, -idleBoxW/2, idleBoxW/2);
            const ty = cy + clamp(a.y - cy, -idleBoxH/2, idleBoxH/2);
            a.vx += (tx - a.x) * 0.0009;
            a.vy += (ty - a.y) * 0.0009;

          } else if (state === STATE.POST_RED_EXPLOSION){
            a.vx = a.vx * 0.992 + (Math.random()-0.5)*IDLE_JITTER*0.20;
            a.vy = a.vy * 0.992 + (Math.random()-0.5)*IDLE_JITTER*0.20;

          } else if (state === STATE.RECOVER_RED){
            a.vx = a.vx * 0.93 + (Math.random()-0.5)*IDLE_JITTER*0.10;
            a.vy = a.vy * 0.93 + (Math.random()-0.5)*IDLE_JITTER*0.10;

          } else {
            // seeking modes
            if (state === STATE.ENTER_SQUASH_WITH_LAG && nowMs() < a.activeAt){
              a.vx = a.vx*0.90 + (Math.random()-0.5)*0.60;
              a.vy = a.vy*0.90 + (Math.random()-0.5)*0.60;
            } else {
              const t = transformedTarget(a);
              const dx = t.x - a.x;
              const dy = t.y - a.y;
              a.vx = a.vx*damp + dx*seekK;
              a.vy = a.vy*damp + dy*seekK;
            }

            // bounce styles during ENTER
            if (state === STATE.ENTER_VERTICAL_BOUNCE){
              a.vy += 0.18;
              if (a.y < 0){ a.y = 0; a.vy *= -0.90; }
              if (a.y > p.height){ a.y = p.height; a.vy *= -0.90; }
            } else if (state === STATE.ENTER_HORIZONTAL_BOUNCE){
              a.vx += 0.18;
              if (a.x < 0){ a.x = 0; a.vx *= -0.90; }
              if (a.x > p.width){ a.x = p.width; a.vx *= -0.90; }
            } else if (state === STATE.ENTER_RANDOM_BOUNCE){
              if (a.x < 0){ a.x = 0; a.vx *= -0.90; }
              if (a.x > p.width){ a.x = p.width; a.vx *= -0.90; }
              if (a.y < 0){ a.y = 0; a.vy *= -0.90; }
              if (a.y > p.height){ a.y = p.height; a.vy *= -0.90; }
            }
          }

          a.x += a.vx;
          a.y += a.vy;

          // hard bounds
          if (a.x < 0){ a.x = 0; a.vx *= -0.5; }
          if (a.x > p.width){ a.x = p.width; a.vx *= -0.5; }
          if (a.y < 0){ a.y = 0; a.vy *= -0.5; }
          if (a.y > p.height){ a.y = p.height; a.vy *= -0.5; }
        }
      }

      // ---- main loop ----
      let _debugBound = false;
      p.setup = ()=>{
        const c = p.createCanvas(16, 9);
        if (holder) c.parent(holder);
        p.pixelDensity(Math.min(window.devicePixelRatio||1,2));
        p.frameRate(60);

        updateBlobParams();
        ensureTextBuffer();
        rebuildTargets();

        // init positions random
        for (let i=0;i<N;i++){
          pts[i].x = Math.random()*p.width;
          pts[i].y = Math.random()*p.height;
        }

        startIdle();

        if (!_debugBound){
          bindDebugUIOnce();
          _debugBound = true;
        }
      };

      function resizeAll(){
        p.resizeCanvas(window.innerWidth || DESIGN_W, window.innerHeight || DESIGN_H);
        updateBlobParams();
        ensureTextBuffer();
        rebuildTargets();
      }

      p.windowResized = ()=>{ resizeAll(); };

      p.draw = ()=>{
        const now = nowMs();
        if (cam.enabled && (p.frameCount % 6 === 0)) runDetection(now);

        updateHasFaceAndFaceParams(now);

        // 4秒ルール用
        if (prevHasFace && !hasFace){
          lastFaceLostAt = now;
        }

        // time change rebuild while showing/entering
        if (state !== STATE.IDLE_SABORU && state !== STATE.POST_FADE_OUT_INVISIBLE){
          const hm = clockHM();
          if (hm !== lastHM) rebuildTargets();
        }

        // ---- State machine ----
        const elapsed = now - stateStartedAt;
        const dur = stateData.dur || 1;
        const t = clamp(elapsed / dur, 0, 1);

        // default transforms
        squashX = squashY = 1.0;

        if (state === STATE.IDLE_SABORU){
          if (hasFace){
            const dt = now - lastFaceLostAt;
            if (dt < 4000){
              startEnterQuickSquash();
            } else {
              startEnterRandom5();
            }
          }
        }

        else if (
          state === STATE.ENTER_QUICK_SQUASH ||
          state === STATE.ENTER_VERTICAL_BOUNCE ||
          state === STATE.ENTER_HORIZONTAL_BOUNCE ||
          state === STATE.ENTER_RANDOM_BOUNCE ||
          state === STATE.ENTER_EDGE_SQUASH ||
          state === STATE.ENTER_SQUASH_WITH_LAG
        ){
          if (!hasFace){
            startIdle();
          } else {
            // squash on first part
            const k = easeOutQuint(clamp(elapsed/380, 0, 1));
            squashX = lerp(0.72, 1.0, k);
            squashY = lerp(1.30, 1.0, k);
            if (t >= 1) startShow();
          }
        }

        else if (state === STATE.SHOW_TIME){
          if (!hasFace){
            startIdle();
          } else {
            if (elapsed >= 3000){
              startExitRandom3();
            }
          }
        }

        else if (state === STATE.EXIT_RED_EXPLOSION){
          if (!hasFace){
            startIdle();
          } else {
            slimeHeat01 = easeInOutCubic(t);
            colonBlinkSpeed = lerp(1.0, 7.0, easeOutQuint(t));
            if (t >= 1){
              slimeHeat01 = 1.0;
              colonBlinkSpeed = 7.5;
              triggerExplosion();
              setState(STATE.POST_RED_EXPLOSION, {});
            }
          }
        }

        else if (state === STATE.POST_RED_EXPLOSION){
          slimeHeat01 = 1.0;
          colonBlinkSpeed = 7.5;
          if (!hasFace){
            startRecover('RED');
          }
        }

        else if (state === STATE.RECOVER_RED){
          const u = easeOutQuint(t);
          slimeHeat01 = lerp(1.0, 0.0, u);
          colonBlinkSpeed = lerp(7.5, 1.0, u);
          if (t >= 1) startIdle();
        }

        else if (state === STATE.EXIT_FADE_OUT){
          if (!hasFace){
            startIdle();
          } else {
            slimeAlpha01 = 1.0 - easeOutQuint(t);
            if (t >= 1){
              slimeAlpha01 = 0.0;
              setState(STATE.POST_FADE_OUT_INVISIBLE, {});
            }
          }
        }

        else if (state === STATE.POST_FADE_OUT_INVISIBLE){
          slimeAlpha01 = 0.0;
          if (!hasFace){
            startRecover('FADE');
          }
        }

        else if (state === STATE.RECOVER_FADE){
          slimeAlpha01 = easeOutQuint(t);
          if (t >= 1) startIdle();
        }

        else if (state === STATE.EXIT_ZOOM_OUT_TRACKING){
          if (!hasFace){
            startIdle();
          } else {
            const u = easeOutQuint(t);
            clockScale = lerp(1.0, 0.52, u);
            clockOffX *= 0.85;
            clockOffY *= 0.85;
            if (t >= 1){
              setState(STATE.POST_ZOOM_OUT_TRACKING, {});
            }
          }
        }

        else if (state === STATE.POST_ZOOM_OUT_TRACKING){
          if (hasFace){
            updateTransformsForZoomGag();
          } else {
            slimeAlpha01 = lerp(slimeAlpha01, 0.0, 0.10);
            if (slimeAlpha01 <= 0.02){
              slimeAlpha01 = 0.0;
              startRecover('ZOOM');
            }
          }
        }

        else if (state === STATE.RECOVER_ZOOM){
          // reset scale & offsets and bring slime back to idle
          const u = easeOutQuint(t);
          clockScale = lerp(clockScale, 1.0, 0.12);
          clockOffX *= 0.85;
          clockOffY *= 0.85;
          slimeAlpha01 = lerp(0.0, 1.0, u);
          if (t >= 1) startIdle();
        }

        // ---- physics params ----
        let seekK = SEEK_BASE;
        let damp = DAMP_BASE;
        if (state === STATE.IDLE_SABORU){
          seekK = 0.0;
          damp = 0.98;
        } else if (
          state === STATE.POST_RED_EXPLOSION ||
          state === STATE.RECOVER_RED
        ){
          seekK = 0.0;
          damp = 0.985;
        } else if (state === STATE.ENTER_VERTICAL_BOUNCE || state === STATE.ENTER_HORIZONTAL_BOUNCE || state === STATE.ENTER_RANDOM_BOUNCE || state === STATE.ENTER_EDGE_SQUASH){
          // ramp seek while bouncing
          const u = clamp((now - stateStartedAt)/stateData.dur, 0, 1);
          seekK = lerp(0.010, SEEK_BASE, u);
          damp = lerp(0.90, DAMP_BASE, u);
        }

        // ---- draw ----
        p.background(0);
        stepParticles(seekK, damp);
        renderSlime();

        // ---- readout ----
        if (dbgReadout){
          dbgReadout.textContent =
            'STATE: ' + state +
            ' | hasFace: ' + (hasFace ? 'true' : 'false') +
            ' | lastLost: ' + ((now - lastFaceLostAt)/1000).toFixed(2) + 's' +
            ' | faceX/Y: ' + faceX01.toFixed(2) + ',' + faceY01.toFixed(2) +
            ' | close: ' + faceClose01.toFixed(2);
        }

        prevHasFace = hasFace;
      };
    };

    // Font load helps target building; rebuild once fonts are ready
    const waitFonts = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    waitFonts.then(()=>{ /* p5 will build targets on its own each state; no-op */ });

    new p5(sketch);
  }

  if (document.readyState === 'loading'){
    window.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
