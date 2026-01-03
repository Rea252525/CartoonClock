
(function(){
  'use strict';

  function boot(){
    const VERSION = 'v0.2.6';
    console.log('[Saboclock]', VERSION);

    // ---------------- Config ----------------
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const DESIGN_W = 1920;
    const DESIGN_H = 1080;
    const N = 1650;
    const HN = 770, MN = 770, SN = 0;
    const CN = 110;

    // Particle feel (base)
    const IDLE_JITTER = 0.35;
    const SEEK_STRENGTH = 0.085;
    const DAMP = 0.78;

    // Entrance feels a bit stronger so it "snaps" into place
    const ENTRANCE_SEEK_MULT = 1.18;

    // Entrance ①-a (スクアッシュ&ストレッチ) を“なめらか”にするためのm低域フィルタ
    // 0で無効（そのままのキレ）
    const ENT1A_SMOOTH_TAU_MS = 70;

    // Face detection
    const DETECT_EVERY_N_FRAMES = 6;
    const SEEN_DEBOUNCE_MS = 1200;

    // Subtle life wobble when digits are shown
    const SEEN_WOBBLE = 8.32;     // px amplitude
    const WOBBLE_BASE_HZ = 0.10;  // Hz
        const WOBBLE_JITTER_HZ = 16.24;

    // ---- Legacy (v0.0.0) "seen after 10s+" catch-up / overshoot (Tier3) ----
    // These parameters are copied from v0.0.0 so ①-a / ②-a behave exactly the same.
    const CATCHUP_MS = 320;
    const CATCHUP_GAIN = 1.85;

    // Time band borders (sec). We FORCE Tier3 for ①-a / ②-a, but we keep params as-is.
    const EASING_TIER1_MAX_SEC = 4.9;
    const EASING_TIER2_MAX_SEC = 9.9;

    const TIER1_GAIN = 1.0;
    const TIER2_GAIN = 1.0;
    const TIER3_GAIN = 1.0;

    const TIER1_EXPO_STEEPNESS = 10.0;
    const TIER1_TIME_POWER = 1.0;

    const TIER2_TIME_POWER = 1.0;
    const TIER3_TIME_POWER = 1.0;

    const TIER2_BACK_OVERSHOOT = 0.5;
    const TIER3_BACK_OVERSHOOT = 1.0;

    const TIER2_PEAK_FRAC = 0.7;
    const TIER3_PEAK_FRAC = 0.4;

    const TIER2_OUT_EXPO_STEEPNESS = 10.0;
    const TIER3_OUT_EXPO_STEEPNESS = 40.0;

    const TIER2_IN_EXPO_STEEPNESS = 10.0;
    const TIER3_IN_EXPO_STEEPNESS = 40.0;

    // --- SLIME renderer params (guided) ---
    // NOTE:
    // 画面が小さいと「太りすぎて潰れる」/ 画面が大きいと「途切れ途切れになる」問題は、
    // DISC_RADIUS / BLUR / THRESH が“固定値”だったのが主因。
    // ここでは「数字(レイアウト)スケール」と「slimeバッファ解像度(blobScale)」に合わせて
    // 毎フレーム自動で最適化するように変更しています（v0.1.13）。
    const MAX_BLOB_PIXELS = 1800000;       // slimeバッファの上限（小さすぎると荒れる / 大きすぎると重い）
    const MAX_SAMPLE_PARTICLES = 1600;     // (未使用だが互換のため残す)

    // --- Base (design @ 1920x1080, blobScale≈2) ---
    const DISC_RADIUS_BASE = 11.5;         // gBlob上の半径（基準）
    const BLUR_BASE = 2.5;
    const THRESH_BASE = 0.70;

    // --- Appearance tuning (v0.1.17) ---
    // Make GitHub Pages and local rendering closer.
    const SEEN_VIS_THICK_MULT = 1.18;      // thickness multiplier when seen
    const UNSEEN_VIS_THICK_MULT = SEEN_VIS_THICK_MULT; // keep same to avoid thickness jump    // thickness multiplier when unseen
    const UNSEEN_THR_BIAS = -0.12;         // lower threshold when unseen (helps blobs survive)         // lower threshold when unseen

    const BASE_ALPHA_SEEN = 26;            // ink amount when seen
    const BASE_ALPHA_UNSEEN = 38;          // ink amount when unseen          // ink amount when unseen

    // --- Responsive runtime params (updated in updateSlimeParams) ---
    let DISC_RADIUS = DISC_RADIUS_BASE;
    let BLUR_AMOUNT = BLUR_BASE;
    let THRESH_LEVEL = THRESH_BASE;
    let GUIDE_RADIUS = Math.floor(DISC_RADIUS_BASE * 0.75);

    const USE_GUIDE = true;               // draw faint target guides when seen
    const GUIDE_ALPHA = 6;                // 0..255 faint
    const GUIDE_STRIDE = 2;               // use every n-th target

    // Font
    const USE_FONT = true;
    const FONT_FAMILY_PRIMARY = 'Inter';
    const FONT_FAMILY_LOCAL   = 'ClockFontLocal';
    let FONT_WEIGHT = 100;
    const LETTER_SPACING = 0.02;
    let fontSize = 280;

    // -------------- Easings (from https://easings.net/ja) --------------
    const clamp01 = (t)=> (t<0?0:(t>1?1:t));

    function easeOutExpo(t){
      t = clamp01(t);
      return (t===1) ? 1 : 1 - Math.pow(2, -10*t);
    }
    function easeInExpo(t){
      t = clamp01(t);
      return (t===0) ? 0 : Math.pow(2, 10*(t-1));
    }
    function easeInOutExpo(t){
      t = clamp01(t);
      if (t===0) return 0;
      if (t===1) return 1;
      return (t<0.5)
        ? Math.pow(2, 20*t-10)/2
        : (2 - Math.pow(2, -20*t+10))/2;
    }
    function easeOutCirc(t){
      t = clamp01(t);
      return Math.sqrt(1 - Math.pow(t-1,2));
    }
    function easeInOutQuad(t){
      t = clamp01(t);
      return (t < 0.5) ? 2*t*t : 1 - Math.pow(-2*t+2,2)/2;
    }

    
    function easeOutQuad(t){
      t = clamp01(t);
      return 1 - (1 - t) * (1 - t);
    }


    // ---- Legacy (v0.0.0) param easings ----
    function easeOutExpoParam(t, steep, timePower){
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      const u = Math.pow(t, timePower);
      return 1 - Math.pow(2, -steep * u);
    }

    function easeInExpoParam(t, steep, timePower){
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      const u = Math.pow(t, timePower);
      return Math.pow(2, steep * (u - 1));
    }

    // 0→peak→1.0, using OutExpo / InExpo with tunable peak timing.
    function expoOvershootBlendParam(t, overshootAmount, peakFrac, timePower, outSteep, inSteep){
      if (t <= 0) return 0;
      if (t >= 1) return 1;

      const tt = Math.pow(t, timePower);
      const peak = 1 + overshootAmount;

      if (tt <= peakFrac){
        const u = tt / peakFrac;
        const e = easeOutExpoParam(u, outSteep, 1.0);
        return peak * e;
      } else {
        const u = (tt - peakFrac) / (1 - peakFrac);
        const e = easeInExpoParam(u, inSteep, 1.0);
        return peak + (1 - peak) * e;
      }
    }
// ---------------- Entrance Specs ----------------
    const RECENT_SEEN_MS = 4000;

    // ①-a timeline (ms)
    const ENT1A_T1 = 100;
    const ENT1A_T2 = 100;
    const ENT1A_T3 = 800;
    const ENT1A_TOTAL = ENT1A_T1 + ENT1A_T2 + ENT1A_T3;

    // ②-a delayed subset
    const ENT2A_DELAY_MS = 500;
    const ENT2A_CATCH_MS = 700;
    const ENT2A_TOTAL = Math.max(ENT1A_TOTAL, ENT2A_DELAY_MS + ENT2A_CATCH_MS);

    // ②-b/c/d bounce timeline (seconds)
    const BOUNCE_DURS = [0.1,0.1,0.1, 0.2,0.2,0.2, 0.3,0.3,0.3, 0.3, 0.5]; // total ~2.6s
    const BOUNCE_TOTAL = BOUNCE_DURS.reduce((a,b)=>a+b,0);

    // ---------------- Sketch ----------------
    let sketch = (p)=>{
      // --------------- State ---------------
      let pts = new Array(N).fill(0).map(()=>({
        x:0,y:0,vx:0,vy:0,tx:0,ty:0,group:0,
        sx:0,sy:0, // entrance start positions
      }));

      // Visual smoothing: avoid thickness jump on seen/unseen
      // `seen` is the effective seen state used by the simulation.
      // `simSeen` reflects the UI checkbox state (when camera is not enabled).
      let simSeen = true;
      let seen = true, prevSeen = true;

      // Manual test override: allow entrance test buttons to run even when
      // "見られている（シミュレーション）" is OFF and no face is detected.
      // When active, we treat the system as "seen" until this timestamp.
      let manualSeenUntil = 0;
      let seenVis01 = 1.0;
      const SEEN_VIS_LERP_IN = 0.25;
      const SEEN_VIS_LERP_OUT = 0.07;

      // Phase: 'slack' | 'entrance' | 'display'
      let phase = 'display';

      // time (HHMM) cache
      let lastHM = '';

      // last time we lost the face
      let lastLostAt = performance.now() - 999999;

      // Entrance controller
      const ent = {
        active:false,
        mode:'1a',
        startMs:0,
        durationMs:0,
        // for ②-a
        subsetMask:null, // Uint8Array(N) with 0/1
        // for bounce
        offx:null, offy:null, // Float32Array(N)
        // center motion
        centerX:0, centerY:0,
        prevCX:0, prevCY:0,
        vX:0, vY:0,
        mix01:0,
        impact01:0,
        // m smoothing (for ①-a / ②-a non-delayed part)
        mFrame:0,
        _mSmooth:0,
        _mInit:false,
        _mLastMs:0,
      };

      // Camera state
      const cam = {
        enabled:false,
        preview:false,
        video: document.getElementById('cam'),
        wrap: document.getElementById('camWrap'),
        stream:null,
        detector:null,
        api:'none',
        lastSeenAt: 0,
        motion: {prev:null, w:160, h:90, tmp:null, tctx:null}
      };

      // UI
      const holder = document.getElementById('canvas-holder');
      const fakeSeen = document.getElementById('fakeSeen');
      const btnCam = document.getElementById('btnCam');
      const btnSim = document.getElementById('btnSim');
      const togglePreview = document.getElementById('togglePreview');
      const btnSettings = document.getElementById('btnSettings');
      const settingsPanel = document.getElementById('settings-panel');

      const btnEnt1a = document.getElementById('btnEnt1a');
      const btnEnt2a = document.getElementById('btnEnt2a');
      const btnEnt2b = document.getElementById('btnEnt2b');
      const btnEnt2c = document.getElementById('btnEnt2c');
      const btnEnt2d = document.getElementById('btnEnt2d');
      const btnEntAuto = document.getElementById('btnEntAuto');
      const btnToSlack = document.getElementById('btnToSlack');

      // settings panel toggle
      if (btnSettings && settingsPanel){
        btnSettings.addEventListener('click', ()=>{
          const visible = settingsPanel.style.display === 'block';
          settingsPanel.style.display = visible ? 'none' : 'block';
        });
      }

      if (fakeSeen){
        fakeSeen.addEventListener('change', ()=>{ simSeen = !!fakeSeen.checked; });
        simSeen = !!fakeSeen.checked;
      }

      if (btnSim){
        btnSim.addEventListener('click', ()=>{
          cam.enabled = false;
          if (cam.wrap) cam.wrap.style.display = 'none';
          simSeen = true;
          seen = true;
          prevSeen = true;
          manualSeenUntil = 0;
          if (fakeSeen) fakeSeen.checked = true;
          logDiag('診断: シミュレーション ON');
        });
      }

      if (togglePreview){
        togglePreview.checked = false;
        cam.preview = false;
        togglePreview.addEventListener('change', ()=>{
          cam.preview = !!togglePreview.checked;
          if (cam.wrap){
            cam.wrap.style.display = (cam.preview && cam.enabled) ? 'block' : 'none';
          }
        });
      }

      if (btnCam){
        btnCam.addEventListener('click', startCamera);
      }

      // --- Test buttons ---
      function entranceDurationMsFor(mode){
        if (mode === '1a') return CATCHUP_MS;
        if (mode === '2a') return CATCHUP_MS;
        if (mode === '2b' || mode === '2c' || mode === '2d') return Math.floor(BOUNCE_TOTAL * 1000);
        return ENT1A_TOTAL;
      }

      // Allow test buttons to run even if simulation is OFF and no face is detected.
      // We temporarily treat the system as "seen" for a short window.
      function forceSeenForTest(durationMs){
        const now = performance.now();
        manualSeenUntil = Math.max(manualSeenUntil, now + Math.max(0, durationMs|0));
        // Prevent the normal "rising edge" handler from starting a random entrance on the next frame.
        seen = true;
        prevSeen = true;
      }

      function manualStart(mode){
        const dur = entranceDurationMsFor(mode) + 1200; // + a bit of display time
        forceSeenForTest(dur);
        startEntrance(mode, performance.now());
      }
      if (btnEnt1a) btnEnt1a.addEventListener('click', ()=>manualStart('1a'));
      if (btnEnt2a) btnEnt2a.addEventListener('click', ()=>manualStart('2a'));
      if (btnEnt2b) btnEnt2b.addEventListener('click', ()=>manualStart('2b'));
      if (btnEnt2c) btnEnt2c.addEventListener('click', ()=>manualStart('2c'));
      if (btnEnt2d) btnEnt2d.addEventListener('click', ()=>manualStart('2d'));
      if (btnEntAuto) btnEntAuto.addEventListener('click', ()=>{
        forceSeenForTest(Math.floor(BOUNCE_TOTAL * 1000) + 1200);
        startEntranceAuto(performance.now());
      });
      if (btnToSlack) btnToSlack.addEventListener('click', ()=>{
        manualSeenUntil = 0;
        setSlack(performance.now(), true);
      });

      function logDiag(text){
        try { console.log(text); } catch(e){}
      }

      // Canvas + slime buffer
      let gBlob = null, blobScale = 4;
      let layoutScale = 1;
      let DIGIT_SCALE = 1;

      // runtime slime params
      let DISC_RADIUS = DISC_RADIUS_BASE;
      let BLUR_AMOUNT = BLUR_BASE;
      let THRESH_LEVEL = THRESH_BASE;
      let GUIDE_RADIUS = Math.floor(DISC_RADIUS_BASE * 0.75);

      let guides = [];

      function updateSlimeParams(){
        // 数字の見た目サイズ（レイアウトスケール×重なり回避スケール）
        const s = Math.max(0.35, (layoutScale || 1) * (DIGIT_SCALE || 1));
        const bs = Math.max(1, blobScale || 2);

        // 基準(1080p付近 / blobScale≈2)での「画面上の半径」をベースに、数字サイズに比例させる
        // 画面上の半径 ≈ DISC_RADIUS(gBlob) * blobScale
        const baseVisR = DISC_RADIUS_BASE * 2;       // approx on-screen radius when blobScale=2

        const visMult = (SEEN_VIS_THICK_MULT * seenVis01) + (UNSEEN_VIS_THICK_MULT * (1.0 - seenVis01));
        const desiredVisR = baseVisR * s * visMult; // scale with digit size and state


        // gBlob上の半径に戻す（blobScaleが上がっても二重に太らないようにする）
        let r = desiredVisR / bs;
        r = Math.max(5.0, Math.min(18.0, r));        // 安定クランプ（極端な端末で破綻しにくく）
        DISC_RADIUS = r;

        // blur: 半径に比例（rが小さいときはぼかしも小さく）
        let blur = r * 0.22;
        blur = Math.max(1.2, Math.min(4.2, blur));
        BLUR_AMOUNT = blur;

        // threshold: 大きいほど細く/切れやすい。大画面では少し下げて繋がりを優先。
        let thr = THRESH_BASE - (s - 1) * 0.06;
        thr += UNSEEN_THR_BIAS * (1.0 - seenVis01);
        thr = Math.max(0.52, Math.min(0.76, thr));
        THRESH_LEVEL = thr;

        // guide
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
        const c = holder ? holder.querySelector('canvas') : null;
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
        if (holder) c.parent(holder);
        p.pixelDensity(DPR);
        p.frameRate(60);
        resize();
        applyFitScale();

        const waitFonts = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
        waitFonts.then(()=>{ rebuildTargets(); setTimeout(rebuildTargets, 0); });

        logDiag('診断: OK / entrance-only ' + VERSION);
      };

      function layoutInitial(){
        for (let i=0;i<N;i++){
          const g = (i<HN) ? 0 : (i<HN+MN ? 1 : 2); // 0: H, 1: M, 2: :
          pts[i].x = Math.random()*p.width;
          pts[i].y = Math.random()*p.height;
          pts[i].vx = 0; pts[i].vy = 0;
          pts[i].group = g;
          pts[i].sx = pts[i].x; pts[i].sy = pts[i].y;
        }
        phase = 'display';
      }

      function clockStringHM(){
        const d = new Date();
        const pad = (n)=>String(n).padStart(2,'0');
        return pad(d.getHours()) + pad(d.getMinutes());
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
        // fallback vector digits (not used by default)
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
          } g.pop();
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
        const d = g.pixelDensity();
        const W = g.width*d, H = g.height*d;
        let step = Math.max(2, Math.floor(Math.min(p.width,p.height)*0.0035)*d);
        const arr = [];
        for (let y=0;y<H;y+=step){
          for (let x=0;x<W;x+=step){
            const a = g.pixels[4*(y*W+x)+3];
            if (a>128){
              arr.push({x: x/d + (xCenter - g.width/2), y: y/d});
            }
          }
        }
        if (arr.length>maxCount){
          const stride = Math.max(1, Math.ceil(arr.length/maxCount));
          const thin = [];
          for (let i=0;i<arr.length;i+=stride) thin.push(arr[i]);
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

        const str = clockStringHM();
        lastHM = str;
        const HH = str.slice(0,2), MM = str.slice(2,4);

        let txH = [], txM = [], txColon = [];
                const WEIGHT_HM = 700, WEIGHT_COLON = 100;
        FONT_WEIGHT = WEIGHT_HM; fontSize = H_SIZE;  txH = buildTargetsFor(HH, HN, H_POS.x, H_POS.y);
        FONT_WEIGHT = WEIGHT_HM; fontSize = M_SIZE;  txM = buildTargetsFor(MM, MN, M_POS.x, M_POS.y);
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

      // ---------------- Face detection ----------------
      async function startCamera(){
        try{
          const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'}, audio:false});
          cam.stream = stream;
          if (cam.video){
            cam.video.srcObject = stream;
            await cam.video.play();
          }
          cam.enabled = true;
          if (cam.wrap){
            cam.wrap.style.display = (cam.preview || (togglePreview && togglePreview.checked)) ? 'block' : 'none';
          }

          if ('FaceDetector' in window){
            cam.detector = new window.FaceDetector({fastMode:true, maxDetectedFaces:1});
            cam.api = 'FaceDetector';
            logDiag('診断: FaceDetector');
          } else {
            cam.motion.tmp = document.createElement('canvas');
            cam.motion.tmp.width = cam.motion.w;
            cam.motion.tmp.height = cam.motion.h;
            cam.motion.tctx = cam.motion.tmp.getContext('2d',{willReadFrequently:true});
            cam.api = 'Motion';
            logDiag('診断: Motion Fallback');
          }
          if (fakeSeen) fakeSeen.checked = false;
          simSeen = false;
          manualSeenUntil = 0;
        }catch(e){
          console.error(e);
          logDiag('診断: カメラ不可（権限/環境）');
        }
      }

      function runDetection(nowMs){
        if (!cam.enabled) return;
        if (cam.api==='FaceDetector' && cam.detector && cam.video){
          cam.detector.detect(cam.video).then(faces=>{
            if (faces && faces.length>0) cam.lastSeenAt = nowMs;
          }).catch(()=>{});
        } else if (cam.api==='Motion'){
          const {w,h,tctx} = cam.motion;
          if (!tctx || !cam.video) return;
          tctx.drawImage(cam.video,0,0,w,h);
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
            if (avg>20) cam.lastSeenAt = nowMs;
            cam.motion.prev = frame;
          }
        }
      }

      // ---------------- Phase transitions ----------------
      function setSlack(nowMs, forced=false){
        phase = 'slack';
        ent.active = false;
        if (forced) lastLostAt = nowMs;
      }

      function startEntranceAuto(nowMs){
        const recent = (nowMs - lastLostAt) < RECENT_SEEN_MS;
        if (recent){
          startEntrance('1a', nowMs);
        } else {
          const choices = ['2a','2b','2c','2d'];
          const pick = choices[Math.floor(Math.random()*choices.length)];
          startEntrance(pick, nowMs);
        }
      }

      function startEntrance(mode, nowMs){
        if (!nowMs) nowMs = performance.now();

        // ensure digit targets are current
        const hm = clockStringHM();
        if (hm !== lastHM) rebuildTargets();

        // capture start positions
        for (let i=0;i<N;i++){
          pts[i].sx = pts[i].x;
          pts[i].sy = pts[i].y;
        }

        ent.active = true;
        ent.mode = mode;
        ent.startMs = nowMs;
        // reset m smoothing state
        ent._mInit = false;
        ent._mSmooth = 0;
        ent._mLastMs = nowMs;
        ent.mFrame = 0;
        ent._randWalls = null;
        ent.subsetMask = null;
        ent.offx = null;
        ent.offy = null;
        ent.mix01 = 0;
        ent.impact01 = 0;

        // init center
        ent.centerX = p.width*0.5;
        ent.centerY = p.height*0.5;
        ent.prevCX = ent.centerX;
        ent.prevCY = ent.centerY;
        ent.vX = 0; ent.vY = 0;

        if (mode === '1a' || mode === '2a'){
          // Legacy Tier3 catch-up (v0.0.0 "10秒以上") — EXACT duration
          ent.durationMs = CATCHUP_MS;
          ent.mode = mode;
        } else if (mode === '2b' || mode === '2c' || mode === '2d'){
          ent.durationMs = Math.floor(BOUNCE_TOTAL*1000);
          ent.offx = new Float32Array(N);
          ent.offy = new Float32Array(N);
          for (let i=0;i<N;i++){
            // small spread so the blob isn't a single pixel
            const a = Math.random()*Math.PI*2;
            const r = (Math.random()**0.6) * (Math.min(p.width,p.height)*0.035);
            ent.offx[i] = Math.cos(a)*r;
            ent.offy[i] = Math.sin(a)*r;
          }
        } else {
          ent.durationMs = CATCHUP_MS;
          ent.mode = '1a';
        }

        phase = 'entrance';
      }

      function buildDelayedSubsetMask(){
        // Team: 0=H,1=:,2=M (equal)
        const teamPick = Math.floor(Math.random()*3);
        let start = 0, count = 0;
        if (teamPick === 0){ start = 0; count = HN; }
        else if (teamPick === 1){ start = HN + MN; count = CN; }
        else { start = HN; count = MN; }

        // bbox in targets
        let minX= Infinity, minY= Infinity, maxX=-Infinity, maxY=-Infinity;
        for (let i=0;i<count;i++){
          const a = pts[start+i];
          if (a.tx<minX) minX=a.tx; if (a.ty<minY) minY=a.ty;
          if (a.tx>maxX) maxX=a.tx; if (a.ty>maxY) maxY=a.ty;
        }
        const midX = (minX+maxX)/2;
        const midY = (minY+maxY)/2;

        // quadrant: 0=RU,1=LU,2=LD,3=RD (equal)
        const q = Math.floor(Math.random()*4);

        const mask = new Uint8Array(N);
        for (let i=0;i<count;i++){
          const idx = start+i;
          const a = pts[idx];
          const right = a.tx >= midX;
          const up    = a.ty <= midY;
          const qq = (right?0:1) + (up?0:2); // 0..3 but mapping differs; we'll map to RU=0, LU=1, LD=3, RD=2? Let's do explicit.
          let quadrant = 0;
          if ( right &&  up) quadrant = 0; // RU
          if (!right &&  up) quadrant = 1; // LU
          if (!right && !up) quadrant = 2; // LD
          if ( right && !up) quadrant = 3; // RD
          if (quadrant === q) mask[idx] = 1;
        }
        return mask;
      }

      // ---------------- Entrance motion helpers ----------------
      function ent1aProgress01(tMs){
        // returns multiplier m (0..1.5..1) in "percent/100" (i.e., 1.0 means at target)
        // Spec v0.2.5:
        // 0→-50 : 0.1s (linear)
        // -50→150 : 0.1s (linear)
        // 150→100 : 0.8s (easeInExpo)
        if (tMs <= 0) return 0;
        if (tMs >= ENT1A_TOTAL) return 1;

        if (tMs < ENT1A_T1){
          const u = clamp01(tMs / ENT1A_T1);
          // linear (時間が短いのでイージングなし)
          return 0 + (-0.5 - 0) * u;
        }
        tMs -= ENT1A_T1;
        if (tMs < ENT1A_T2){
          const u = clamp01(tMs / ENT1A_T2);
          // linear (時間が短いのでイージングなし)
          return -0.5 + (1.5 - (-0.5)) * u;
        }
        tMs -= ENT1A_T2;
        const u = clamp01(tMs / ENT1A_T3);
        const e = easeInExpo(u);
        return 1.5 + (1.0 - 1.5) * e;
      }

      function getBounceCenter(mode, tSec){
        const W = p.width, H = p.height;
        const margin = Math.min(W,H) * 0.08;
        const topY = margin;
        const botY = H - margin;
        const leftX = margin;
        const rightX = W - margin;

        // build cumulative times
        let seg = 0;
        let acc = 0;
        while (seg < BOUNCE_DURS.length && tSec > acc + BOUNCE_DURS[seg]){
          acc += BOUNCE_DURS[seg];
          seg++;
        }
        const dur = (seg < BOUNCE_DURS.length) ? BOUNCE_DURS[seg] : 0.0001;
        const u = (dur>0) ? clamp01((tSec - acc)/dur) : 1;

        // "impact" (near end of segment)
        const impact = (u>0.82) ? (u-0.82)/0.18 : 0;
        ent.impact01 = clamp01(impact);

        // sequence of points
        const cx = W*0.5, cy = H*0.5;

        function lerp(a,b,t){ return a + (b-a)*t; }

        if (mode === '2b'){
          // vertical: top/bottom alternating, start moving immediately
          const points = [
            {x:cx,y:cy}, // start
            {x:cx,y:topY},
            {x:cx,y:botY},
            {x:cx,y:topY},
            {x:cx,y:botY},
            {x:cx,y:topY},
            {x:cx,y:botY},
            {x:cx,y:topY},
            {x:cx,y:botY},
            {x:cx,y:topY},
            {x:cx,y:botY},
            {x:cx,y:cy}
          ];
          const a = points[Math.min(seg, points.length-2)];
          const b = points[Math.min(seg+1, points.length-1)];
          const ee = easeInOutQuad(u);
          return {x:lerp(a.x,b.x,ee), y:lerp(a.y,b.y,ee), seg, segU:u, totalSeg:BOUNCE_DURS.length};
        }

        if (mode === '2c'){
          // horizontal: left/right alternating
          const points = [
            {x:cx,y:cy},
            {x:leftX,y:cy},
            {x:rightX,y:cy},
            {x:leftX,y:cy},
            {x:rightX,y:cy},
            {x:leftX,y:cy},
            {x:rightX,y:cy},
            {x:leftX,y:cy},
            {x:rightX,y:cy},
            {x:leftX,y:cy},
            {x:rightX,y:cy},
            {x:cx,y:cy}
          ];
          const a = points[Math.min(seg, points.length-2)];
          const b = points[Math.min(seg+1, points.length-1)];
          const ee = easeInOutQuad(u);
          return {x:lerp(a.x,b.x,ee), y:lerp(a.y,b.y,ee), seg, segU:u, totalSeg:BOUNCE_DURS.length};
        }

        // 2d: multi-direction random, deterministic per entrance start
        // We will precompute on first call per entrance.
        if (!ent._randWalls || ent._randWalls.length === 0){
          const dirs = [
            {name:'U',  dx:0,  dy:-1, x:cx,    y:topY},
            {name:'D',  dx:0,  dy: 1, x:cx,    y:botY},
            {name:'L',  dx:-1, dy: 0, x:leftX, y:cy},
            {name:'R',  dx: 1, dy: 0, x:rightX,y:cy},
            {name:'UR', dx: 1, dy:-1, x:rightX,y:topY},
            {name:'UL', dx:-1, dy:-1, x:leftX, y:topY},
            {name:'DR', dx: 1, dy: 1, x:rightX,y:botY},
            {name:'DL', dx:-1, dy: 1, x:leftX, y:botY},
          ];
          const rng = mulberry32(Math.floor(ent.startMs) ^ 0x9e3779b9);
          const seq = [{dx:0,dy:0,x:cx,y:cy}];
          let last = {dx:0,dy:0};
          for (let k=0;k<BOUNCE_DURS.length; k++){
            // pick a direction that's "opposite-ish" to previous
            const candidates = dirs.filter(d=>{
              const dot = d.dx*last.dx + d.dy*last.dy;
              return dot <= -0.2 || (last.dx===0 && last.dy===0);
            });
            const pick = candidates[Math.floor(rng()*candidates.length)];
            seq.push({dx:pick.dx, dy:pick.dy, x:pick.x, y:pick.y});
            last = {dx:pick.dx, dy:pick.dy};
          }
          // settle to center at the end
          seq.push({dx:0,dy:0,x:cx,y:cy});
          ent._randWalls = seq;
        }
        const points = ent._randWalls;
        const a = points[Math.min(seg, points.length-2)];
        const b = points[Math.min(seg+1, points.length-1)];
        const ee = easeInOutQuad(u);
        return {x:lerp(a.x,b.x,ee), y:lerp(a.y,b.y,ee), seg, segU:u, totalSeg:BOUNCE_DURS.length};
      }

      function mulberry32(a){
        return function(){
          a |= 0; a = a + 0x6D2B79F5 | 0;
          let t = Math.imul(a ^ a >>> 15, 1 | a);
          t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
          return ((t ^ t >>> 14) >>> 0) / 4294967296;
        }
      }

      // Update per-frame entrance parameters (avoid per-particle state updates)
      function updateEntranceFrame(nowMs){
        if (!ent.active) return;
        if (ent.mode !== '1a' && ent.mode !== '2a') return;

        const t = nowMs - ent.startMs;
        const dur = Math.max(1, ent.durationMs || CATCHUP_MS);

        // Legacy Tier3 (v0.0.0 "10秒以上") progress. No smoothing/filtering.
        if (t >= dur){
          ent.mFrame = 1;
          return;
        }
        const tn = clamp01(t / dur);
        ent.mFrame = expoOvershootBlendParam(
          tn,
          TIER3_BACK_OVERSHOOT,
          TIER3_PEAK_FRAC,
          TIER3_TIME_POWER,
          TIER3_OUT_EXPO_STEEPNESS,
          TIER3_IN_EXPO_STEEPNESS
        );
      }


      function computeEntranceDesired(i, nowMs){
        const t = nowMs - ent.startMs;

        if (ent.mode === '1a' || ent.mode === '2a'){
          // Legacy Tier3 catch-up (v0.0.0 "10秒以上")
          const m = (typeof ent.mFrame === 'number') ? ent.mFrame : 0;
          const a = pts[i];
          return {x: a.sx + (a.tx - a.sx) * m, y: a.sy + (a.ty - a.sy) * m};
        }

        // bounce family
        const tSec = Math.max(0, t*0.001);
        const bc = getBounceCenter(ent.mode, tSec);

        // mix into digits from "impact 9" onward
        // startMix near the 9th impact (roughly at 1.8s by spec)
        const startMixSec = 1.8;
        const endMixSec = BOUNCE_TOTAL;
        let mix = 0;
        if (tSec > startMixSec){
          mix = clamp01((tSec - startMixSec) / Math.max(0.001, (endMixSec - startMixSec)));
          // ease to feel more "cartoony"
          mix = easeInOutQuad(mix);
        }
        ent.mix01 = mix;

        const a = pts[i];
        const bx = bc.x + (ent.offx ? ent.offx[i] * (1 - mix) : 0);
        const by = bc.y + (ent.offy ? ent.offy[i] * (1 - mix) : 0);

        return {
          x: bx + (a.tx - bx) * mix,
          y: by + (a.ty - by) * mix
        };
      }
// ---------------- Rendering deformation ----------------
      // When bouncing: droplet while moving / squashed at impact
      function computeDeform(){
        // default: identity
        let angle = 0, sx = 1, sy = 1;

        if (phase !== 'entrance') return {angle,sx,sy};

        if (ent.mode === '2b' || ent.mode === '2c' || ent.mode === '2d'){
          const vx = ent.vX, vy = ent.vY;
          const speed = Math.sqrt(vx*vx + vy*vy);
          if (speed > 1e-3){
            angle = Math.atan2(vy, vx);
            const s = Math.min(1, speed / 1600); // normalize
            const moveStretch = 1 + 0.42*s;
            const moveSquash  = 1 - 0.28*s;

            const imp = ent.impact01 || 0;
            // impact: squash in moving direction, stretch perpendicular
            const along = (1-imp)*moveStretch + imp*moveSquash;
            const perp  = (1-imp)*moveSquash  + imp*moveStretch;

            sx = along;
            sy = perp;
          }
        } else {
          // 1a / 2a: legacy catch-up should have NO extra deformation (match v0.0.0)
          angle = 0;
          sx = 1;
          sy = 1;
        }
        return {angle,sx,sy};
      }

      function drawSlime(){
        if (!gBlob) return;

        // 画面サイズの変化に応じて、描画パラメータを常に最新にする
        updateSlimeParams();

        gBlob.push();
        gBlob.blendMode(gBlob.BLEND);
        gBlob.background(0);
        gBlob.blendMode(gBlob.ADD);
        gBlob.noStroke();
        // __DEFORM_APPLIED__
        const __def = (typeof computeDeform === 'function') ? computeDeform() : {angle:0,sx:1,sy:1};
        const __cx = (p.width || DESIGN_W) * 0.5;
        const __cy = (p.height || DESIGN_H) * 0.5370370; // digits baseline center (design-aligned)
        gBlob.push();
        gBlob.translate(__cx, __cy);
        gBlob.rotate(__def.angle || 0);
        gBlob.scale(__def.sx || 1, __def.sy || 1);
        gBlob.rotate(-(__def.angle || 0));
        gBlob.translate(-__cx, -__cy);


        const r = DISC_RADIUS;
        const BASE_ALPHA = (BASE_ALPHA_SEEN * seenVis01) + (BASE_ALPHA_UNSEEN * (1.0 - seenVis01));
        // Colon second-tick (":")
        const now = new Date();
        const sec = now.getSeconds();
        const ms = now.getMilliseconds();
        const u = ms / 1000; // 0..1 within this second

        // 細くなる最小スケール（かなり細め）
        const COLON_THIN_SCALE = 0.28;

        let colonScale;
        if (!seen){
          // 見られていないときはコロンの太さは一定（変化させない）
          colonScale = 1.0;
        } else {
          // 偶数秒: 細い→太い（イーズアウト）
          // 奇数秒: 太い→細い（イーズアウト）
          const easeOut = 1 - Math.pow(1 - u, 5); // easeOutQuint に変更（https://easings.net/ja より）
          if (sec % 2 === 0){
            // even second → 太い側へ寄る
            colonScale = COLON_THIN_SCALE + (1 - COLON_THIN_SCALE) * easeOut;
          } else {
            // odd second → 細い側へ寄る
            colonScale = 1 - (1 - COLON_THIN_SCALE) * easeOut;
          }
        }

        const colonR = r * colonScale;
        const colonAlpha = BASE_ALPHA;

        const OUTLINE_SCALE = 1.55;
        // 小さい画面ではアウトライン加算を少し弱めて「太り」を抑える
        const sEff = Math.max(0.35, (layoutScale || 1) * (DIGIT_SCALE || 1));
        const OUTLINE_ALPHA = BASE_ALPHA * 0.40 * Math.min(1.0, Math.max(0.65, sEff));

        // 画面サイズに応じて密度を調整（小さい画面ほど間引いて真っ白にならないようにする）
        const BASE_AREA = DESIGN_W * DESIGN_H;
        const area = Math.max(1, p.width * p.height);
        let densityScale = 1.0;
        if (area < BASE_AREA){
          const tArea = BASE_AREA / area;
          const AREA_DENSITY_POW = 0.7; // 調整用：0.5〜1.0くらいで好みを探る
          densityScale = Math.min(3.0, Math.pow(tArea, AREA_DENSITY_POW)); // 1〜約3倍まで
        }

        // サンプリングの目標数（B_*）に densityScale を掛けることで、小さい画面では粒を間引く
        const B_H_BASE = 1400, B_M_BASE = 1400, B_S_BASE = 120, B_C_BASE = 90;
        const B_H = B_H_BASE * densityScale;
        const B_M = B_M_BASE * densityScale;
        const B_S = B_S_BASE * densityScale;
        const B_C = B_C_BASE * densityScale;

        const sH = Math.max(1, Math.floor(HN / B_H));
        const sM = Math.max(1, Math.floor(MN / B_M));
        const sS = Math.max(1, Math.floor(Math.max(1,SN) / B_S));
        const sC = Math.max(1, Math.floor(CN / B_C));

        for (let i=0;i<HN;i+=sH){ const a=pts[i]; gBlob.fill(255, BASE_ALPHA); gBlob.circle(a.x/blobScale, a.y/blobScale, r*2); }
        for (let i=HN;i<HN+MN;i+=sM){ const a=pts[i]; gBlob.fill(255, BASE_ALPHA); gBlob.circle(a.x/blobScale, a.y/blobScale, r*2); }
        for (let i=HN+MN;i<HN+MN+SN;i+=sS){ const a=pts[i]; gBlob.fill(255, BASE_ALPHA); gBlob.circle(a.x/blobScale, a.y/blobScale, r*2); }
        for (let i=HN+MN+SN;i<N;i+=sC){ const a=pts[i]; gBlob.fill(255, colonAlpha); gBlob.circle(a.x/blobScale, a.y/blobScale, colonR*2); }
        
        // Extra wide, faint pass just for H & M to smooth their outlines
        for (let i=0;i<HN;i+=sH){
          const a = pts[i];
          gBlob.fill(255, OUTLINE_ALPHA);
          gBlob.circle(a.x/blobScale, a.y/blobScale, r*OUTLINE_SCALE*2);
        }
        for (let i=HN;i<HN+MN;i+=sM){
          const a = pts[i];
          gBlob.fill(255, OUTLINE_ALPHA);
          gBlob.circle(a.x/blobScale, a.y/blobScale, r*OUTLINE_SCALE*2);
        }

        const gr = Math.max(2, Math.floor(GUIDE_RADIUS));
        const GUIDE_STRIDE = 4, GUIDE_ALPHA = 8;
        gBlob.fill(255, GUIDE_ALPHA);
        for (let gi=0; gi<guides.length; gi+=GUIDE_STRIDE){ const t=guides[gi]; gBlob.circle(t.x/blobScale, t.y/blobScale, gr*2); }

        gBlob.pop();
        gBlob.pop(); // __DEFORM_APPLIED__ end

        try { gBlob.filter(p.BLUR, BLUR_AMOUNT); } catch(e){}
        try { gBlob.filter(p.THRESHOLD, THRESH_LEVEL); } catch(e){ gBlob.filter(p.THRESHOLD); }
        p.image(gBlob, 0, 0, p.width, p.height);
      }

      // ---------------- Main loop ----------------
      p.draw = function(){
        const nowMs = performance.now();

        // update detection
        if (cam.enabled && (p.frameCount % DETECT_EVERY_N_FRAMES === 0)) runDetection(nowMs);

        const camSeen = cam.enabled ? (nowMs - cam.lastSeenAt <= SEEN_DEBOUNCE_MS) : false;
        const manualSeen = (nowMs < manualSeenUntil);
        const effectiveSeen = (cam.enabled ? camSeen : !!simSeen) || manualSeen;
        seen = effectiveSeen;

        // smooth visuals
        {
          const target = seen ? 1.0 : 0.0;
          const k = (target > seenVis01) ? SEEN_VIS_LERP_IN : SEEN_VIS_LERP_OUT;
          seenVis01 += (target - seenVis01) * k;
          if (seenVis01 < 0) seenVis01 = 0;
          if (seenVis01 > 1) seenVis01 = 1;
        }

        // time update (HHMM only)
        const hm = clockStringHM();
        if (hm !== lastHM){
          rebuildTargets();
        }

        // edges
        if (!prevSeen && seen){
          // always (re)enter when face appears
          startEntranceAuto(nowMs);
        }
        if (prevSeen && !seen){
          // whatever we are doing -> slack
          lastLostAt = nowMs;
          setSlack(nowMs);
        }
        prevSeen = seen;

        // precompute entrance frame values (smooth m)
        if (phase === 'entrance' && ent.active){
          updateEntranceFrame(nowMs);
        }

        // advance entrance end
        if (phase === 'entrance' && ent.active){
          const t = nowMs - ent.startMs;
          if (t >= ent.durationMs){
            ent.active = false;
            phase = 'display';
            ent._randWalls = null;
          }
        }

        // compute bounce center velocity for deformation
        if (phase === 'entrance' && ent.active && (ent.mode==='2b' || ent.mode==='2c' || ent.mode==='2d')){
          ent.prevCX = ent.centerX;
          ent.prevCY = ent.centerY;
          const bc = getBounceCenter(ent.mode, Math.max(0,(nowMs-ent.startMs)*0.001));
          ent.centerX = bc.x;
          ent.centerY = bc.y;
          ent.vX = (ent.centerX - ent.prevCX) * 60; // px/s approx
          ent.vY = (ent.centerY - ent.prevCY) * 60;
        } else {
          ent.vX = ent.vY = 0;
          ent.impact01 = 0;
        }

        // particle update
        const tSec = nowMs * 0.001;
        for (let i=0;i<N;i++){
          const a = pts[i];

          if (!seen || phase === 'slack'){
            // slack: float
            a.vx = (a.vx + (Math.random()-0.5)*IDLE_JITTER) * 0.98;
            a.vy = (a.vy + (Math.random()-0.5)*IDLE_JITTER) * 0.98;
          } else {
            let targetX = a.tx;
            let targetY = a.ty;

            if (phase === 'entrance' && ent.active){
              const d = computeEntranceDesired(i, nowMs);
              targetX = d.x;
              targetY = d.y;
            }

            // wobble
            let wobbleGain = 1.0;
            if (phase === 'entrance' && ent.active){
              // Legacy Tier3 (v0.0.0) had wobble on from the start.
              if (ent.mode === '1a' || ent.mode === '2a'){
                wobbleGain = 1.0;
              } else {
                // other entrances: fade in wobble near the end
                const tt = clamp01((nowMs - ent.startMs) / Math.max(1, ent.durationMs));
                wobbleGain = Math.max(0, (tt - 0.65) / 0.35);
              }
            }

	            const baseHz = WOBBLE_BASE_HZ;
            const jitterAmp = WOBBLE_JITTER_HZ;
	            // NOTE: avoid shadowing the global state variable `phase`
	            const phi = i * 0.37;
            const h = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
            const frac = h - Math.floor(h);
            const j = (frac - 0.5) * 2.0;
            const freqX = baseHz + j * jitterAmp * 0.15;
            const freqY = baseHz * 1.3 + j * jitterAmp * 0.11;

	            const wobbleX = Math.sin(tSec * freqX + phi) * SEEN_WOBBLE * wobbleGain;
	            const wobbleY = Math.cos(tSec * freqY + phi * 1.7) * SEEN_WOBBLE * wobbleGain;

            const dx = (targetX + wobbleX) - a.x;
            const dy = (targetY + wobbleY) - a.y;

            let mult = (phase === 'entrance') ? ENTRANCE_SEEK_MULT : 1.0;
            if (phase === 'entrance' && ent.active && (ent.mode === '1a' || ent.mode === '2a')){
              mult = CATCHUP_GAIN * TIER3_GAIN; // legacy catch-up gain
            }
            a.vx = (a.vx + dx * SEEK_STRENGTH * mult) * DAMP;
            a.vy = (a.vy + dy * SEEK_STRENGTH * mult) * DAMP;
          }

          a.x += a.vx;
          a.y += a.vy;

          // bounds
          if (a.x < 0){ a.x = 0; a.vx *= -0.5; }
          if (a.x > p.width){ a.x = p.width; a.vx *= -0.5; }
          if (a.y < 0){ a.y = 0; a.vy *= -0.5; }
          if (a.y > p.height){ a.y = p.height; a.vy *= -0.5; }
        }

        drawSlime();
      };

      window.addEventListener('resize', ()=>{ resize(); applyFitScale(); });
    };

    new p5(sketch);
  }

  if (document.readyState==='loading'){
    window.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
