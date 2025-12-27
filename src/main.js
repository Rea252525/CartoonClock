
(function(){
  'use strict';
  function boot(){
    // ---------------- Config ----------------
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const DESIGN_W = 1920;
    const DESIGN_H = 1080;
    const DESIGN_ASPECT = DESIGN_W / DESIGN_H;
    const N = 1650;
    const HN = 770, MN = 770, SN = 0;
    const CN = 110;          // H/M/S allocation
    const IDLE_JITTER = 0.35, SEEK_STRENGTH = 0.085, DAMP = 0.78;
    const DETECT_EVERY_N_FRAMES = 6, SEEN_DEBOUNCE_MS = 1200;

    // ---- Linger-head gag ----
    const LAG_FRACTION_MIN = 0.15, LAG_FRACTION_MAX = 0.25;
    const LAG_LINGER_MIN_MS = 700, LAG_LINGER_MAX_MS = 1100;
    const LAG_WIGGLE = 0.12, CATCHUP_MS = 320, CATCHUP_GAIN = 1.85;
    
    // Subtle life wobble when the clock is being seen (digits displayed)
    const SEEN_WOBBLE = 8.32;       // px amplitude of wobble
    const WOBBLE_BASE_HZ = 0.10;     // base cycles per second
    const WOBBLE_JITTER_HZ = 16.24;   // per-particle frequency variation

    // ---- 見られた瞬間のイージング用パラメータ（全部ここで調整できます） ----
    // 時間帯の境界（秒）
    const EASING_TIER1_MAX_SEC = 60 * 5;   // 0〜5分: Tier1 (通常モード)
    const EASING_TIER2_MAX_SEC = 60 * 10;  // 5〜10分: Tier2 (ちょい派手)
    // それ以上は Tier3 (10分以上: かなり派手)

    // 各時間帯ごとの全体スピード倍率（大きくすると速く数字に集まる）
    const TIER1_GAIN = 1.0;   // 〜5分: easeOutExpo
    const TIER2_GAIN = 1.0;   // 5〜10分: Expoオーバーシュート（Out→In）
    const TIER3_GAIN = 1.0;   // 10分以上: Expoオーバーシュート（Out→In）

    // ---- Expo 系（Tier1）のカーブ形状 ----
    // Expo の「鋭さ」。大きいほど最初ドンッと動いて、終盤でよりゆっくりになる。
    const TIER1_EXPO_STEEPNESS = 10.0;   // 10〜14くらいが「それっぽい」ゾーン
    // 時間の進み方を変えるための指数。>1で序盤ゆっくり / <1で序盤速く。
    const TIER1_TIME_POWER = 1.0;

    // ---- オーバーシュート（Tier2 / Tier3）のカーブ形状 ----
    // 内部時間の進み方。>1で序盤ゆっくり / <1で序盤速く。
    const TIER2_TIME_POWER = 1.0;
    const TIER3_TIME_POWER = 1.0;

    // どのくらい通り過ぎるか
    //  0.5 → 100→150→100 / 1.0 → 100→200→100 くらいのイメージ
    const TIER2_BACK_OVERSHOOT = 0.5;  // Tier2: 100→(1+0.5)*100=150
    const TIER3_BACK_OVERSHOOT = 1.0;  // Tier3: 100→(1+1.0)*100=200

    // 波線が頂点に到達するタイミング（0〜1）。1に近いほど「最後の一瞬でビヨン」と通り過ぎる。
    const TIER2_PEAK_FRAC = 0.7;
    const TIER3_PEAK_FRAC = 0.4;

    // 100→頂点に行くときの easeOutExpo の鋭さ
    const TIER2_OUT_EXPO_STEEPNESS = 10.0;
    const TIER3_OUT_EXPO_STEEPNESS = 40.0;

    // 頂点→100 に戻るときの easeInExpo の鋭さ
    const TIER2_IN_EXPO_STEEPNESS = 10.0;
    const TIER3_IN_EXPO_STEEPNESS = 40.0;

    // ==== Cartoon Clock 誇張演出「数値いじれるゾーン」 ====
    // 卒制中に触りたくなるパラメータは全部ここに集約しています。
    // ※ここだけいじれば、赤さ・ピクピク度・爆発の速さなどが一括で調整できます。

    // 1) 赤くなり始めるタイミング（秒）
    const WATCH_RED_START_SEC = 5.0;          // 5秒までは白のまま
    const WATCH_RED_FULL_SEC = 10.0;          // 10秒で真っ赤

    // 2) 真っ赤になってから爆発するまで（秒）
    const WATCH_EXPLOSION_DELAY_SEC = 1.0;    // 真っ赤になってから爆発までの待ち時間
    const WATCH_EXPLOSION_DURATION_SEC = 4.0; // 爆発〜液体状態の長さ

    // 3) 赤さ＆チャージの「追従スピード」
    const WATCH_HEAT_EASE = 0.15;             // 大きいほどサクサク色と震えが変化

    // 4) 数字がパンッパンに膨れ上がる量
    const WATCH_SCALE_EXTRA = 0.35;           // 最大で何倍まで膨らむか（1.0 + これ）

    // 5) 真っ赤〜爆発待ち1秒の「ピクピク震え」
    const WATCH_PULSE_HZ = 8.0;               // ピクピクの速さ（Hz）
    const WATCH_PULSE_AMP = 0.18;             // ピクピクの大きさ（0〜だいたい0.3くらいまでがおすすめ）

    // 6) 爆発直前に中心へギュウッと寄るタイミング
    const WATCH_SQUEEZE_START = 0.6;          // どのくらいチャージされたら寄り始めるか（0〜1）

    // 7) 爆発したあとの「液体の飛び散り方」
    const EXPLOSION_SPEED_MIN = 20.0;         // 爆発直後の最小スピード
    const EXPLOSION_SPEED_MAX = 40.0;         // 爆発直後の最大スピード
    const EXPLOSION_DAMP = 0.992;             // 爆発中の減速率（1.0に近いほど長く飛ぶ）
    const EXPLOSION_JITTER_GAIN = 0.35;       // 爆発中のランダム揺れの強さ

    // スクアッシュ＆ストレッチは現在未使用（必要になったらここで復活させる）

    // ---- ここまでをいじると、波線（イージング）のキャラクターをかなり細かく変えられます ----

    // ---- SLIME renderer params (guided) ----
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

    // --- Appearance tuning (v0.1.15) ---
    // Make GitHub Pages and local rendering closer.
    const SEEN_VIS_THICK_MULT = 1.18;      // thickness multiplier when seen
    const UNSEEN_VIS_THICK_MULT = 1.35;    // thickness multiplier when unseen
    const UNSEEN_THR_BIAS = -0.09;         // lower threshold when unseen

    const BASE_ALPHA_SEEN = 26;            // ink amount when seen
    const BASE_ALPHA_UNSEEN = 34;          // ink amount when unseen

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

    // ---- Easing functions for 見られた瞬間の変形（すべて定数経由） ----
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
      // 0→1 に向かってだんだん加速する Expo
      return Math.pow(2, steep * (u - 1));
    }

    // 0→100→頂点→100 のうち、「0→頂点」と「頂点→100」を
    // それぞれ easeOutExpo / easeInExpo でつないだオーバーシュート用イージング。
    function expoOvershootBlendParam(t, overshootAmount, peakFrac, timePower, outSteep, inSteep){
      if (t <= 0) return 0;
      if (t >= 1) return 1;

      // 時間の進み方を少し曲げる
      const tt = Math.pow(t, timePower);
      const peak = 1 + overshootAmount; // 1.0=100 に対して overshootAmount=0.5 なら 150 まで行く

      if (tt <= peakFrac){
        // 0→頂点 までを easeOutExpo で
        const u = tt / peakFrac; // 0〜1
        const e = easeOutExpoParam(u, outSteep, 1.0); // timePower は外側でかけたので 1.0 固定
        return peak * e; // 0→peak
      } else {
        // 頂点→100 までを easeInExpo で
        const u = (tt - peakFrac) / (1 - peakFrac); // 0〜1
        const e = easeInExpoParam(u, inSteep, 1.0);
        // peak から 1.0 へ戻る
        return peak + (1 - peak) * e;
      }
    }

    let sketch = (p)=>{
      // --------------- State ---------------
      let pts = new Array(N).fill(0).map(()=>({x:0,y:0,vx:0,vy:0,tx:0,ty:0, group:0, activeAt:0, ax:0, ay:0, catchUntil:0, sx:0, sy:0, catchStart:0, catchTier:0}));
      let seen = true, prevSeen = true, lastTimeStr = "";
      let frames=0, lastFPS=0, lastFPSTime=performance.now();
      let unseenStart = null;  // 見られていない状態が始まった時刻
      // Cartoon Clock: 「見つづけた」時の状態
      let watchSeenStart = null;   // 連続で見られ始めた時刻
      let watchHeat01 = 0;         // 0〜1 白→赤
      let watchCharge01 = 0;       // 0〜1 真っ赤になってから爆発までのチャージ進行度
      let explosionState = 'idle'; // 'idle' or 'exploding'
      let explosionStart = 0;      // 爆発が始まった時刻（ms）
      let lastNow = 0;             // 直近の now（ms）を drawSlime でも使う用


      // Camera state
      const cam = { enabled:false, preview:false, video: document.getElementById('cam'), wrap: document.getElementById('camWrap'),
                    stream:null, detector:null, api:'none', lastSeenAt: 0,
                    motion: {prev:null, w:160, h:90, tmp:null, tctx:null} };

      // UI
      const holder = document.getElementById('canvas-holder');
      const fakeSeen = document.getElementById('fakeSeen');
      const btnCam = document.getElementById('btnCam');
      const btnSim = document.getElementById('btnSim');
      const togglePreview = document.getElementById('togglePreview');
      const btnSettings = document.getElementById('btnSettings');
      const settingsPanel = document.getElementById('settings-panel');

      // 設定パネルの開閉（左上の小さい⚙ボタン）
      if (btnSettings && settingsPanel){
        btnSettings.addEventListener('click', ()=>{
          const visible = settingsPanel.style.display === 'block';
          settingsPanel.style.display = visible ? 'none' : 'block';
        });
      }

      if (fakeSeen){
        fakeSeen.addEventListener('change', ()=>{ seen = fakeSeen.checked; });
        seen = fakeSeen.checked;
      }

      if (btnSim){
        btnSim.addEventListener('click', ()=>{
          cam.enabled = false;
          if (cam.wrap) cam.wrap.style.display = 'none';
          seen = true;
          if (fakeSeen) fakeSeen.checked = true;
          updateDiag('診断: シミュレーション ON');
        });
      }

      if (togglePreview){
        // 初期状態は OFF
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

      // 画面表示には出さず、デバッグログだけに出す
      function updateDiag(text){
        try { console.log(text); } catch(e){}
      }

      // Canvas + slime buffer
      let gBlob = null, blobScale = 4;
      // layoutScale: 最短辺(≈1080px)に対するスケール。数字や液体の「大きさ」用
      let layoutScale = 1;
      // DIGIT_SCALE: 画面が極端に縦長などの場合に、数字とコロンが重ならないようにするための追加スケール
      let DIGIT_SCALE = 1;

      // --- Responsive slime params ---
      // DISC_RADIUS / BLUR / THRESH を「数字スケール」と「gBlob解像度」に合わせて自動調整
      // 目的:
      //  - 小さい画面: 太りすぎて潰れるのを防ぐ（細く・シャープに）
      //  - 大きい画面: 途切れ途切れを防ぐ（繋がりを戻す）
      function updateSlimeParams(){
        // 数字の見た目サイズ（レイアウトスケール×重なり回避スケール）
        const s = Math.max(0.35, (layoutScale || 1) * (DIGIT_SCALE || 1));
        const bs = Math.max(1, blobScale || 2);

        // 基準(1080p付近 / blobScale≈2)での「画面上の半径」をベースに、数字サイズに比例させる
        // 画面上の半径 ≈ DISC_RADIUS(gBlob) * blobScale
        const baseVisR = DISC_RADIUS_BASE * 2;       // approx on-screen radius when blobScale=2

        const visMult = seen ? SEEN_VIS_THICK_MULT : UNSEEN_VIS_THICK_MULT;
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
        if (!seen) thr += UNSEEN_THR_BIAS;
        thr = Math.max(0.52, Math.min(0.76, thr));
        THRESH_LEVEL = thr;

        // guide
        GUIDE_RADIUS = Math.max(2, Math.floor(r * 0.55));
      }

      function resize(){
        const vw = window.innerWidth || DESIGN_W;
        const vh = window.innerHeight || DESIGN_H;

        // キャンバスサイズ = 端末の画面サイズ（ウィンドウサイズ）
        p.resizeCanvas(vw, vh);

        // 最短辺を基準にしたスケール（どの比率でも形がほぼ一定になるように）
        const base = Math.min(vw, vh);
        layoutScale = base / DESIGN_H;  // DESIGN_H(1080) を基準スケールとして扱う

        // slime バッファ解像度をキャンバスサイズベースで決定（縦横比は画面と同じ）
        const area = vw * vh;
        blobScale = Math.max(2, Math.ceil(Math.sqrt(area / MAX_BLOB_PIXELS)));
        const bw = Math.max(64, Math.floor(vw / blobScale));
        const bh = Math.max(64, Math.floor(vh / blobScale));
        gBlob = p.createGraphics(bw, bh);
        gBlob.pixelDensity(DPR);
        layoutInitial(); rebuildTargets();
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
        const c = p.createCanvas(16, 9); c.parent(holder);
        p.pixelDensity(DPR); p.frameRate(60);
        resize();
        applyFitScale();
        const waitFonts = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
        waitFonts.then(()=>{ rebuildTargets(); setTimeout(rebuildTargets, 0); });
        updateDiag('診断: OK / slime-guided v0.1.15');
      };

      function layoutInitial(){

        for (let i=0;i<N;i++){
          const g = (i<HN)?0:(i<HN+MN?1:2); // 0: H, 1: M, 2: コロン
          pts[i].x = Math.random()*p.width; pts[i].y = Math.random()*p.height;
          pts[i].vx = pts[i].vy = 0; pts[i].group = g;
          pts[i].activeAt = 0; pts[i].ax = pts[i].x; pts[i].ay = pts[i].y; pts[i].catchUntil = 0;
        }
      }

      function clockString(){ const d=new Date(); const pad=n=>String(n).padStart(2,'0'); return pad(d.getHours())+pad(d.getMinutes())+pad(d.getSeconds()); }

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
          } g.pop();
        }
        const digW=size*0.62; const totalW = text.length*(digW+gap)-gap;
        let x=-totalW/2+digW*0.5;
        for (const ch of text){ digitPath(ch,x); x+=digW+gap; }
        g.pop();
      }

      function buildTargetsFor(text, maxCount, xCenter, yCenter){
        const g = p.createGraphics(Math.max(10, Math.floor(p.width*0.32)), p.height);
        g.pixelDensity(1); g.clear(); g.background(0,0);
        (USE_FONT ? drawFontDigits : drawVectorDigits)(g, text, fontSize, g.width/2, yCenter);
        g.loadPixels();
        const d=g.pixelDensity(), W=g.width*d, H=g.height*d;
        let step=Math.max(2, Math.floor(Math.min(p.width,p.height)*0.0035)*d); // denser than v0.8.0
        const arr=[];
        for (let y=0;y<H;y+=step){
          for (let x=0;x<W;x+=step){
            const a=g.pixels[4*(y*W+x)+3];
            if (a>128){ arr.push({x: x/d + (xCenter - g.width/2), y: y/d}); }
          }
        }
        if (arr.length>maxCount){
          const stride=Math.max(1, Math.ceil(arr.length/maxCount));
          const thin=[]; for (let i=0;i<arr.length;i+=stride) thin.push(arr[i]); return thin;
        }
        return arr;
      }

      
function rebuildTargets(){
        // 画面サイズに追従するレイアウト（比率ベース）
        const W = p.width || DESIGN_W;
        const H = p.height || DESIGN_H;

        // 最短辺ベースのスケール（数字や液体の大きさをそろえる）
        const base = Math.min(W, H);
        layoutScale = base / DESIGN_H; // DESIGN_H(1080) を基準長さとして扱う

        // 元となるサイズ（1920x1080 デザイン基準）
        const H_SIZE_BASE = 480 * layoutScale;
        const M_SIZE_BASE = 480 * layoutScale;
        const COLON_SIZE_BASE = 200 * layoutScale;

        // 位置：元の 1920x1080 上の比率をそのまま画面比率にマッピング
        const H_POS = { x: W * 0.2916667, y: H * 0.5370370 };  // (560,580) / (1920,1080)
        const M_POS = { x: W * 0.7083333, y: H * 0.5370370 };  // (1360,580)
        const COLON_POS = { x: W * 0.5,      y: H * 0.4907407 };  // (960,530)

        // --- 横方向の余裕に応じて DIGIT_SCALE を計算（重ならない程度に縮小） ---
        // H(2桁)・コロン・M(2桁) のざっくりした幅を想定して、重なりそうなら縮小する
        const dHC = Math.abs(COLON_POS.x - H_POS.x); // H中心〜コロン中心
        const dCM = Math.abs(M_POS.x - COLON_POS.x); // コロン中心〜M中心

        const DIGIT_ASPECT = 0.62;  // 1桁の横幅 ≒ 0.62 * fontSize（ざっくり）
        const COLON_ASPECT = 0.50;  // コロンの横幅 ≒ 0.5 * fontSize（ざっくり）

        const H_total_half = DIGIT_ASPECT * H_SIZE_BASE;     // H(2桁)の半分の幅 ≒ 2*0.62/2 * size
        const M_total_half = DIGIT_ASPECT * M_SIZE_BASE;
        const C_total_half = 0.5 * (COLON_ASPECT * COLON_SIZE_BASE);

        const needHC = H_total_half + C_total_half; // H右端＋コロン左端がぶつからないために必要な半距離
        const needCM = M_total_half + C_total_half; // コロン右端＋M左端

        let scaleHC = dHC / needHC;
        let scaleCM = dCM / needCM;

        if (!isFinite(scaleHC) || scaleHC <= 0) scaleHC = 1;
        if (!isFinite(scaleCM) || scaleCM <= 0) scaleCM = 1;

        // 1 を超える場合はそのまま、1 未満なら縮小に使う
        DIGIT_SCALE = Math.min(1, scaleHC, scaleCM);

        // 最終的なサイズ
        const H_SIZE = H_SIZE_BASE * DIGIT_SCALE;
        const M_SIZE = M_SIZE_BASE * DIGIT_SCALE;
        const COLON_SIZE = COLON_SIZE_BASE * DIGIT_SCALE;

        // Per-group font weights（H/M と : のみ）
        const WEIGHT_HM = 700, WEIGHT_COLON = 100;

        const str = clockString(); lastTimeStr = str;
        const HH = str.slice(0,2), MM = str.slice(2,4);

        let txH = [], txM = [], txColon = [];
        FONT_WEIGHT = WEIGHT_HM; fontSize = H_SIZE;  txH = buildTargetsFor(HH, HN, H_POS.x, H_POS.y);
        FONT_WEIGHT = WEIGHT_HM; fontSize = M_SIZE;  txM = buildTargetsFor(MM, MN, M_POS.x, M_POS.y);
        FONT_WEIGHT = WEIGHT_COLON; fontSize = COLON_SIZE; txColon = buildTargetsFor(':', CN, COLON_POS.x, COLON_POS.y);

        function assign(start, count, targets){
          for (let i = 0; i < count; i++){
            const idx = start + i; const t = targets[i % targets.length];
            pts[idx].tx = t.x; pts[idx].ty = t.y;
          }
        }
        assign(0, HN, txH);
        assign(HN, MN, txM);
        assign(HN + MN, CN, txColon);

        guides = txH.concat(txM, txColon);

        // 数字サイズが確定したので、slime側の太さも追従させる
        updateSlimeParams();
      }





      // cached guide points
      let guides = [];

      function scheduleLagCluster(){
        // 見られた瞬間の「ブルルン」演出を、3つの時間帯に分けてイージング制御する。
        // 「一部の液体が遅れてくる」要素はオフにしつつ、
        // 0〜4.9秒 : Tier1（通常モード）
        // 5〜9.9秒 : Tier2（ちょい派手 / Expoオーバーシュート）
        // 10秒以上: Tier3（かなり派手 / Expoオーバーシュート強め）
        const now = performance.now();

        // 見られていない時間（秒）
        let elapsedSec = 0;
        if (unseenStart !== null){
          elapsedSec = (now - unseenStart) * 0.001;
        }

        // 経過時間から tier を決定
        let tier = 1;
        if (elapsedSec > EASING_TIER2_MAX_SEC){
          tier = 3;
        } else if (elapsedSec > EASING_TIER1_MAX_SEC){
          tier = 2;
        }

        for (let i=0;i<N;i++){
          const a = pts[i];
          a.activeAt   = 0;                  // 遅延集合は使わない
          a.catchStart = now;                // この時点からイージングを開始
          a.catchUntil = now + CATCHUP_MS;   // イージングが完了する時刻
          a.catchTier  = tier;               // どのイージングを使うか
          a.sx = a.x;                        // 液体状態の開始位置
          a.sy = a.y;
          a.catchBoost = undefined;          // 旧ロジック用の値はクリア（互換のため残しておく）
        }
      }


      async function startCamera(){
        try{
          const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'user'}, audio:false});
          cam.stream=stream; cam.video.srcObject=stream; await cam.video.play();
          cam.enabled=true; cam.wrap.style.display=(cam.preview || (togglePreview && togglePreview.checked))?'block':'none';
          if ('FaceDetector' in window){ cam.detector=new window.FaceDetector({fastMode:true, maxDetectedFaces:1}); cam.api='FaceDetector'; updateDiag('診断: FaceDetector'); }
          else { cam.motion.tmp=document.createElement('canvas'); cam.motion.tmp.width=cam.motion.w; cam.motion.tmp.height=cam.motion.h; cam.motion.tctx=cam.motion.tmp.getContext('2d',{willReadFrequently:true}); cam.api='Motion'; updateDiag('診断: Motion Fallback'); }
          if (fakeSeen) fakeSeen.checked=false;
        }catch(e){ console.error(e); updateDiag('診断: カメラ不可（権限/環境）'); }
      }

      function runDetection(now){
        if (!cam.enabled) return;
        if (cam.api==='FaceDetector' && cam.detector){
          cam.detector.detect(cam.video).then(faces=>{ if (faces && faces.length>0) cam.lastSeenAt=now; }).catch(()=>{});
        } else if (cam.api==='Motion'){
          const {w,h,tctx}=cam.motion; if (!tctx) return;
          tctx.drawImage(cam.video,0,0,w,h);
          const frame=tctx.getImageData(0,0,w,h);
          if (!cam.motion.prev){ cam.motion.prev=frame; }
          else {
            const prev=cam.motion.prev; let sum=0; const n=frame.data.length;
            for (let i=0;i<n;i+=4){
              sum += Math.abs(frame.data[i]-prev.data[i]) + Math.abs(frame.data[i+1]-prev.data[i+1]) + Math.abs(frame.data[i+2]-prev.data[i+2]);
            }
            const avg = sum/(w*h)/3;
            if (avg>20) cam.lastSeenAt=now;
            cam.motion.prev=frame;
          }
        }
      }

      
function triggerExplosion(){
        const cx = p.width * 0.5;
        const cy = p.height * 0.5;
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
          a.activeAt = 0;
          a.catchUntil = 0;
          a.sx = a.x;
          a.sy = a.y;
        }
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

        const r = DISC_RADIUS;
        const BASE_ALPHA = (seen ? BASE_ALPHA_SEEN : BASE_ALPHA_UNSEEN);
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
        try { gBlob.filter(p.BLUR, BLUR_AMOUNT); } catch(e){}
        try { gBlob.filter(p.THRESHOLD, THRESH_LEVEL); } catch(e){ gBlob.filter(p.THRESHOLD); }
        p.image(gBlob, 0, 0, p.width, p.height);
      }


      p.draw = function(){
        frames++; const now=performance.now();
        lastNow = now;

        if (now-lastFPSTime>=500){ lastFPS=Math.round(frames*1000/(now-lastFPSTime)); frames=0; lastFPSTime=now; }

        if (cam.enabled && (p.frameCount%DETECT_EVERY_N_FRAMES===0)) runDetection(now);
        const camSeen = cam.enabled ? (now-cam.lastSeenAt<=SEEN_DEBOUNCE_MS) : false;
        const effectiveSeen = cam.enabled ? camSeen : seen;
        seen = effectiveSeen;

        // Rising / Falling edge
        if (!prevSeen && seen){
          // 見られるようになった瞬間：ターゲットを組み直してブルルン
          rebuildTargets();
          scheduleLagCluster();
        }
        if (prevSeen && !seen){
          // 見られなくなった瞬間：ラグ状態をクリアしてカウント開始
          for (let i=0;i<N;i++){ pts[i].activeAt = 0; pts[i].catchUntil=0; }
          if (unseenStart === null) unseenStart = performance.now();
        }
        prevSeen = seen;

        // Cartoon Clock: 「見つづけた」赤化＆爆発ロジック
        let heatTarget = 0.0;
        let chargeTarget = 0.0;

        if (explosionState === 'exploding'){
          const sinceExplosion = (now - explosionStart) * 0.001;
          heatTarget = 1.0; // 爆発中は真っ赤のまま
          chargeTarget = 0.0;
          if (sinceExplosion >= WATCH_EXPLOSION_DURATION_SEC){
            // 爆発フェーズ終了
            explosionState = 'idle';
            if (seen){
              // まだ見られている → 数字に戻ってカウントをリセット
              rebuildTargets();
              scheduleLagCluster();
              for (let i=0;i<N;i++){
                pts[i].activeAt = 0;
                pts[i].catchUntil = 0;
              }
              watchSeenStart = now;
            } else {
              // 見られていない → サボ状態に戻る
              if (unseenStart === null) unseenStart = now;
              watchSeenStart = null;
            }
          }
        }

        if (explosionState === 'idle'){
          if (seen){
            if (watchSeenStart === null) watchSeenStart = now;
            const seenSec = (now - watchSeenStart) * 0.001;
            if (seenSec <= WATCH_RED_START_SEC){
              heatTarget = 0.0;
              chargeTarget = 0.0;
            } else if (seenSec < WATCH_RED_FULL_SEC){
              const t = (seenSec - WATCH_RED_START_SEC) / (WATCH_RED_FULL_SEC - WATCH_RED_START_SEC);
              heatTarget = Math.max(0, Math.min(1, t));
              chargeTarget = 0.0;
            } else {
              heatTarget = 1.0;
              const sinceFull = seenSec - WATCH_RED_FULL_SEC;
              const total = Math.max(0.001, WATCH_EXPLOSION_DELAY_SEC);
              const c = Math.max(0, Math.min(1, sinceFull / total));
              chargeTarget = c;
              if (sinceFull >= WATCH_EXPLOSION_DELAY_SEC){
                explosionState = 'exploding';
                explosionStart = now;
                triggerExplosion();
              }
            }
          } else {
            watchSeenStart = null;
            heatTarget = 0.0;
            chargeTarget = 0.0;
          }
        }

        // 色（heat）とチャージをなめらかに追従させる
        watchHeat01 += (heatTarget - watchHeat01) * WATCH_HEAT_EASE;
        if (watchHeat01 < 0) watchHeat01 = 0;
        if (watchHeat01 > 1) watchHeat01 = 1;

        watchCharge01 += (chargeTarget - watchCharge01) * WATCH_HEAT_EASE;
        if (watchCharge01 < 0) watchCharge01 = 0;
        if (watchCharge01 > 1) watchCharge01 = 1;

        // 「見られていない時間」タイマー表示
        {
          const timerEl = document.getElementById('notSeenTimer');
          if (timerEl){
            if (!seen){
              if (unseenStart === null) unseenStart = performance.now();
              const elapsedSec = (performance.now() - unseenStart) * 0.001;
              timerEl.textContent = '見られていない時間: ' + elapsedSec.toFixed(1) + 's';
            } else {
              unseenStart = null;
              timerEl.textContent = '見られていない時間: 0.0s';
            }
          }
        }

        p.background(0);
        const nowStr=clockString(); if (seen && nowStr!==lastTimeStr) rebuildTargets();

        // Physics step
        for (let i=0;i<N;i++){
          const a=pts[i];
          if (explosionState === 'exploding'){
            // 爆発中：ターゲットには向かわず、飛び散ったまま高速で飛び出し、ゆるやかに減速
            a.vx = a.vx * EXPLOSION_DAMP + (Math.random()-0.5)*IDLE_JITTER*EXPLOSION_JITTER_GAIN;
            a.vy = a.vy * EXPLOSION_DAMP + (Math.random()-0.5)*IDLE_JITTER*EXPLOSION_JITTER_GAIN;
          } else if (seen){
            if (now < a.activeAt){
              const toAx = a.ax - a.x, toAy = a.ay - a.y;
              a.vx = a.vx*0.88 + toAx*0.10 + (Math.random()-0.5)*LAG_WIGGLE;
              a.vy = a.vy*0.88 + toAy*0.10 + (Math.random()-0.5)*LAG_WIGGLE;
            } else {
              const tSec = now * 0.001;
              const baseHz = WOBBLE_BASE_HZ;
              const jitterAmp = WOBBLE_JITTER_HZ;
              const phase = i * 0.37;
              const h = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
              const frac = h - Math.floor(h);
              const j = (frac - 0.5) * 2.0;
              const freqX = baseHz + j * jitterAmp * 0.15;
              const freqY = baseHz * 1.3 + j * jitterAmp * 0.11;
              // イージングに基づいて液体→数字への変形を制御する。
              let targetX = a.tx;
              let targetY = a.ty;
              let gainScale = 1.0;

              if (now < a.catchUntil && a.catchStart){
                const catchDur = CATCHUP_MS;
                const tNorm = Math.max(0, Math.min(1, (now - a.catchStart) / catchDur)); // 0〜1
                let tier = a.catchTier || 1;

                let easeVal = tNorm;

                if (tier === 1){
                  // 0〜4.9秒: easeOutExpoParam（通常モード）
                  easeVal = easeOutExpoParam(tNorm, TIER1_EXPO_STEEPNESS, TIER1_TIME_POWER);
                  gainScale = TIER1_GAIN;
                } else if (tier === 2){
                  // 5〜9.9秒: Expoオーバーシュート（100→頂点を OutExpo / 頂点→100 を InExpo）
                  easeVal = expoOvershootBlendParam(
                    tNorm,
                    TIER2_BACK_OVERSHOOT,
                    TIER2_PEAK_FRAC,
                    TIER2_TIME_POWER,
                    TIER2_OUT_EXPO_STEEPNESS,
                    TIER2_IN_EXPO_STEEPNESS
                  );
                  gainScale = TIER2_GAIN;
                } else {
                  // 10秒以上: Tier2 より大きめの Expoオーバーシュート
                  easeVal = expoOvershootBlendParam(
                    tNorm,
                    TIER3_BACK_OVERSHOOT,
                    TIER3_PEAK_FRAC,
                    TIER3_TIME_POWER,
                    TIER3_OUT_EXPO_STEEPNESS,
                    TIER3_IN_EXPO_STEEPNESS
                  );
                  gainScale = TIER3_GAIN;
                }

                const prog = easeVal; // 0〜1 付近だが、オーバーシュート時は 1 を超える
                const sx = (typeof a.sx === 'number') ? a.sx : a.x;
                const sy = (typeof a.sy === 'number') ? a.sy : a.y;

                targetX = sx + (a.tx - sx) * prog;
                targetY = sy + (a.ty - sy) * prog;
              }

              const wobbleX = Math.sin(tSec * freqX + phase) * SEEN_WOBBLE;
              const wobbleY = Math.cos(tSec * freqY + phase * 1.7) * SEEN_WOBBLE;

              // Cartoon Clock: 爆発直前に中心へギュッと寄る演出
              const charge = watchCharge01 || 0;
              if (charge > 0){
                const cx = p.width * 0.5;
                const cy = p.height * 0.5;
                const start = WATCH_SQUEEZE_START;
                if (charge > start){
                  const sq = Math.min(0.9, (charge - start) / (1 - start));
                  targetX = targetX * (1 - sq) + cx * sq;
                  targetY = targetY * (1 - sq) + cy * sq;
                }
              }

              const dx = (targetX + wobbleX) - a.x;
              const dy = (targetY + wobbleY) - a.y;

              const baseGain = (now < a.catchUntil) ? CATCHUP_GAIN : 1.0;
              const gain = baseGain * gainScale;

              a.vx = (a.vx + dx*SEEK_STRENGTH*gain) * DAMP;
              a.vy = (a.vy + dy*SEEK_STRENGTH*gain) * DAMP;
            }
          } else {
            a.vx=(a.vx+(Math.random()-0.5)*IDLE_JITTER)*0.98;
            a.vy=(a.vy+(Math.random()-0.5)*IDLE_JITTER)*0.98;
          }
          a.x+=a.vx; a.y+=a.vy;
          if (a.x<0){a.x=0;a.vx*=-0.5;} if (a.x>p.width){a.x=p.width;a.vx*=-0.5;}
          if (a.y<0){a.y=0;a.vy*=-0.5;} if (a.y>p.height){a.y=p.height;a.vy*=-0.5;}
        }

        // SLIME rendering
        drawSlime();


      };

      window.addEventListener('resize', ()=>{ resize(); applyFitScale(); });
    };
    new p5(sketch);
  }
  if (document.readyState==='loading'){ window.addEventListener('DOMContentLoaded', boot); } else { boot(); }
})();