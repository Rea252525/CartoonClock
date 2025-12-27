
(function(){
  'use strict';
  function boot(){
    const VERSION = 'v0.2.0';
    console.log('[Saboclock]', VERSION);

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
    // それ以上は Tier3 (10分以上: かなり派手)

    // 各時間帯ごとの全体スピード倍率（大きくすると速く数字に集まる）

    // ---- Expo 系（Tier1）のカーブ形状 ----
    // Expo の「鋭さ」。大きいほど最初ドンッと動いて、終盤でよりゆっくりになる。
    // 時間の進み方を変えるための指数。>1で序盤ゆっくり / <1で序盤速く。

    // ---- オーバーシュート（Tier2 / Tier3）のカーブ形状 ----
    // 内部時間の進み方。>1で序盤ゆっくり / <1で序盤速く。

    // どのくらい通り過ぎるか
    //  0.5 → 100→150→100 / 1.0 → 100→200→100 くらいのイメージ

    // 波線が頂点に到達するタイミング（0〜1）。1に近いほど「最後の一瞬でビヨン」と通り過ぎる。

    // 100→頂点に行くときの easeOutExpo の鋭さ

    // 頂点→100 に戻るときの easeInExpo の鋭さ

    // ==== Cartoon Clock 誇張演出「数値いじれるゾーン」 ====
    // 卒制中に触りたくなるパラメータは全部ここに集約しています。
    // ※ここだけいじれば、赤さ・ピクピク度・爆発の速さなどが一括で調整できます。

    // 1) 赤くなり始めるタイミング（秒）

    // 2) 真っ赤になってから爆発するまで（秒）

    // 3) 赤さ＆チャージの「追従スピード」

    // 4) 数字がパンッパンに膨れ上がる量

    // 5) 真っ赤〜爆発待ち1秒の「ピクピク震え」

    // 6) 爆発直前に中心へギュウッと寄るタイミング

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

    // --- Appearance tuning (v0.2.0) ---
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
      // Visual smoothing: avoid "pakki" thickness jump when switching seen/unseen
      let seenVis01 = 1.0; // 1=seen look, 0=unseen look (smoothed)
      const SEEN_VIS_LERP_IN = 0.25;  // how fast visuals snap when becoming seen
      const SEEN_VIS_LERP_OUT = 0.07; // how slow visuals fade when becoming unseen
      let frames=0, lastFPS=0, lastFPSTime=performance.now();
      le// ---------------- Cartoon Clock v0.2.0 State Machine ----------------
// hasFace の喪失時刻（4秒ルール用）
let lastFaceLostAt = null;
// 状態開始時刻（3秒ルール・各アニメ進行用）
let stateStartedAt = performance.now();

// 状態
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
let stateData = {};

// ビジュアル制御（drawSlime で参照）
let slimeHeat01 = 0.0;      // 0=白, 1=赤
let slimeAlpha01 = 1.0;     // 0=透明, 1=表示
let colonBlinkSpeed = 1.0;  // 1=通常, >1 で高速化

// 追従ギャグ（遠のく時計）用
let clockScale = 1.0;
let clockOffX = 0.0;
let clockOffY = 0.0;

// CLOCK中心（rebuildTargets で更新）
let CLOCK_CX = 960, CLOCK_CY = 540;

// draw 用の dt
let prevNowMs = performance.now();
 Camera state
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
        updateDiag('診断: OK / slime-guided v0.2.0');
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
        const COLON_POS = { x: W * 0.5,      y: H * 0.4907407 };

        // 全体中心（ズーム/スク&スト用）
        CLOCK_CX = (H_POS.x + M_POS.x) * 0.5;
        CLOCK_CY = (H_POS.y + M_POS.y) * 0.5;  // (960,530)

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

      function scheduleLagCluster(now, delayMinMs, delayMaxMs, fraction){
  // ENTER_SQUASH_WITH_LAG 用：一部の粒子だけ、少し遅れて「よろよろ」合流する
  const count = Math.max(1, Math.floor((HN + MN) * (fraction || 0.04)));
  const delayMin = delayMinMs || 350;
  const delayMax = delayMaxMs || 800;

  // いったん全員クリア
  for (let i=0;i<N;i++){
    pts[i].activeAt = 0;
    pts[i].ax = pts[i].x;
    pts[i].ay = pts[i].y;
  }

  // 連続インデックスで局所っぽい塊を作る（軽量）
  const maxStart = Math.max(0, (HN + MN) - count - 1);
  const start = Math.floor(Math.random() * (maxStart + 1));

  for (let k=0;k<count;k++){
    const i = start + k;
    const a = pts[i];
    const d = delayMin + Math.random() * (delayMax - delayMin);
    a.activeAt = now + d;
    a.ax = a.x;
    a.ay = a.y;
  }
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
          cam.detector.detect(cam.video).then(faces=>{
            if (faces && faces.length>0){
              cam.lastSeenAt = now;
              try {
                const bb = faces[0].boundingBox;
                if (bb && cam.video && cam.video.videoWidth){
                  const vw = cam.video.videoWidth, vh = cam.video.videoHeight;
                  cam.face = { x: bb.x, y: bb.y, w: bb.width, h: bb.height, vw, vh };
                }
              } catch(e){}
            }
          }).catch(()=>{});
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
        const BASE_ALPHA = (BASE_ALPHA_SEEN * seenVis01) + (BASE_ALPHA_UNSEEN * (1.0 - seenVis01));
        const alphaEff = BASE_ALPHA * Math.max(0.0, Math.min(1.0, slimeAlpha01));
        const heat = Math.max(0.0, Math.min(1.0, slimeHeat01));
        const colR = 255;
        const colG = Math.round(255 * (1.0 - heat));
        const colB = Math.round(255 * (1.0 - heat));
        // Colon second-tick (":")
        const t = (performance.now() * 0.001) * Math.max(0.2, colonBlinkSpeed);
        const sec = Math.floor(t);
        const u = t - sec; // 0..1 within this blink second

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

        for (let i=0;i<HN;i+=sH){ const a=pts[i]; gBlob.fill(colR, colG, colB, alphaEff); gBlob.circle(a.x/blobScale, a.y/blobScale, r*2); }
        for (let i=HN;i<HN+MN;i+=sM){ const a=pts[i]; gBlob.fill(colR, colG, colB, alphaEff); gBlob.circle(a.x/blobScale, a.y/blobScale, r*2); }
        for (let i=HN+MN;i<HN+MN+SN;i+=sS){ const a=pts[i]; gBlob.fill(colR, colG, colB, alphaEff); gBlob.circle(a.x/blobScale, a.y/blobScale, r*2); }
        for (let i=HN+MN+SN;i<N;i+=sC){ const a=pts[i]; gBlob.fill(colR, colG, colB, colonAlpha * Math.max(0.0, Math.min(1.0, slimeAlpha01))); gBlob.circle(a.x/blobScale, a.y/blobScale, colonR*2); }
        
        // Extra wide, faint pass just for H & M to smooth their outlines
        for (let i=0;i<HN;i+=sH){
          const a = pts[i];
          gBlob.fill(colR, colG, colB, OUTLINE_ALPHA * Math.max(0.0, Math.min(1.0, slimeAlpha01)));
          gBlob.circle(a.x/blobScale, a.y/blobScale, r*OUTLINE_SCALE*2);
        }
        for (let i=HN;i<HN+MN;i+=sM){
          const a = pts[i];
          gBlob.fill(colR, colG, colB, OUTLINE_ALPHA * Math.max(0.0, Math.min(1.0, slimeAlpha01)));
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
  frames++;
  const now = performance.now();
  const dt = Math.min(50, now - prevNowMs); // clamp
  prevNowMs = now;

  // FPS
  if (now-lastFPSTime>=500){
    lastFPS=Math.round(frames*1000/(now-lastFPSTime));
    frames=0; lastFPSTime=now;
  }

  // ---- Camera detection ----
  if (cam.enabled && (p.frameCount%DETECT_EVERY_N_FRAMES===0)) runDetection(now);
  const camSeen = cam.enabled ? (now-cam.lastSeenAt<=SEEN_DEBOUNCE_MS) : false;

  // ---- Debug / Simulation inputs ----
  const useSimEl = document.getElementById('useSim');
  const useSim = useSimEl ? !!useSimEl.checked : true;

  const simHasFaceEl = document.getElementById('simHasFace');
  const simHasFace = simHasFaceEl ? !!simHasFaceEl.checked : true;

  const simFaceXEl = document.getElementById('simFaceX');
  const simFaceYEl = document.getElementById('simFaceY');
  const simFaceDistEl = document.getElementById('simFaceDist');

  let faceX01 = 0.5, faceY01 = 0.5, faceClose01 = 0.5; // 0=遠い, 1=近い

  if (useSim){
    faceX01 = simFaceXEl ? (Number(simFaceXEl.value)/100) : 0.5;
    faceY01 = simFaceYEl ? (Number(simFaceYEl.value)/100) : 0.5;
    faceClose01 = simFaceDistEl ? (Number(simFaceDistEl.value)/100) : 0.5;
  } else if (cam.enabled && cam.face && cam.face.vw && cam.face.vh){
    // FaceDetector: bbox -> 正規化（X はミラー補正）
    const bb = cam.face;
    const cx = bb.x + bb.w * 0.5;
    const cy = bb.y + bb.h * 0.5;
    const nx = cx / bb.vw;
    const ny = cy / bb.vh;

    faceX01 = 1.0 - nx; // mirror
    faceY01 = ny;

    const area01 = (bb.w * bb.h) / (bb.vw * bb.vh); // 0..1
    // ざっくり距離化（環境差ありなのでゆるく）
    const close = (area01 - 0.02) / 0.18; // 0.02〜0.20 を 0..1 に
    faceClose01 = Math.max(0, Math.min(1, close));
  }

  const hasFace = useSim ? simHasFace : camSeen;
        seen = hasFace; // keep legacy var for drawSlime


  // Smoothly blend visual parameters to prevent sudden thickness jump
  {
    const target = hasFace ? 1.0 : 0.0;
    const k = (target > seenVis01) ? SEEN_VIS_LERP_IN : SEEN_VIS_LERP_OUT;
    seenVis01 = seenVis01 + (target - seenVis01) * k;
    if (seenVis01 < 0) seenVis01 = 0;
    if (seenVis01 > 1) seenVis01 = 1;
  }

  // Face-lost timestamp (4秒ルール)
  if (prevSeen && !hasFace){
    lastFaceLostAt = now;
  }
  prevSeen = hasFace;

  // ---- State helpers ----
  function setState(next, data){
    state = next;
    stateStartedAt = now;
    stateData = data || {};
  }

  function gatherToCenter(spread){
    const cx = CLOCK_CX, cy = CLOCK_CY;
    const s = spread || 22;
    for (let i=0;i<N;i++){
      const a = pts[i];
      a.x = cx + (Math.random()-0.5)*s*2;
      a.y = cy + (Math.random()-0.5)*s*2;
      a.vx = (Math.random()-0.5)*0.6;
      a.vy = (Math.random()-0.5)*0.6;
      a.ax = a.x; a.ay = a.y;
      a.activeAt = 0;
      a.catchUntil = 0;
    }
  }

  function applyExplosionImpulse(){
    const cx = CLOCK_CX, cy = CLOCK_CY;
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
    }
  }

  function pickEnter(){
    const r = Math.floor(Math.random() * 5);
    if (r===0) return STATE.ENTER_VERTICAL_BOUNCE;
    if (r===1) return STATE.ENTER_HORIZONTAL_BOUNCE;
    if (r===2) return STATE.ENTER_RANDOM_BOUNCE;
    if (r===3) return STATE.ENTER_EDGE_SQUASH;
    return STATE.ENTER_SQUASH_WITH_LAG;
  }
  function pickExit(){
    const r = Math.floor(Math.random() * 3);
    if (r===0) return STATE.EXIT_RED_EXPLOSION;
    if (r===1) return STATE.EXIT_FADE_OUT;
    return STATE.EXIT_ZOOM_OUT_TRACKING;
  }

  function startIdle(){
    // サボり状態：白・表示
    slimeHeat01 = 0.0;
    slimeAlpha01 = 1.0;
    colonBlinkSpeed = 1.0;
    clockScale = 1.0;
    clockOffX = 0.0;
    clockOffY = 0.0;
    setState(STATE.IDLE_SABORU);
  }

  function startShow(){
    slimeHeat01 = 0.0;
    slimeAlpha01 = 1.0;
    colonBlinkSpeed = 1.0;
    clockScale = 1.0;
    clockOffX = 0.0;
    clockOffY = 0.0;
    setState(STATE.SHOW_TIME);
  }

  function startEnter(type){
    // ターゲットを最新の時刻に
    const nowStr = clockString();
    if (nowStr !== lastTimeStr) rebuildTargets();

    if (type === STATE.ENTER_EDGE_SQUASH){
      const side = Math.floor(Math.random()*4); // 0:top 1:bottom 2:left 3:right
      const pad = 30;
      for (let i=0;i<N;i++){
        const a = pts[i];
        if (side===0){ a.x = Math.random()*p.width; a.y = -pad; }
        else if (side===1){ a.x = Math.random()*p.width; a.y = p.height + pad; }
        else if (side===2){ a.x = -pad; a.y = Math.random()*p.height; }
        else { a.x = p.width + pad; a.y = Math.random()*p.height; }
        const dx = CLOCK_CX - a.x, dy = CLOCK_CY - a.y;
        a.vx = dx * 0.002 + (Math.random()-0.5)*0.6;
        a.vy = dy * 0.002 + (Math.random()-0.5)*0.6;
        a.ax = a.x; a.ay = a.y;
        a.activeAt = 0;
        a.catchUntil = 0;
      }
      setState(STATE.ENTER_EDGE_SQUASH, { side });
      return;
    }

    // それ以外は「一瞬で集まる」
    gatherToCenter(24);

    if (type === STATE.ENTER_VERTICAL_BOUNCE){
      for (let i=0;i<N;i++){
        const a = pts[i];
        a.vx = (Math.random()-0.5) * 2.2;
        a.vy = (Math.random()*2-1) * 16.0;
      }
    } else if (type === STATE.ENTER_HORIZONTAL_BOUNCE){
      for (let i=0;i<N;i++){
        const a = pts[i];
        a.vx = (Math.random()*2-1) * 16.0;
        a.vy = (Math.random()-0.5) * 2.2;
      }
    } else if (type === STATE.ENTER_RANDOM_BOUNCE){
      for (let i=0;i<N;i++){
        const a = pts[i];
        const ang = Math.random()*Math.PI*2;
        const sp = 10 + Math.random()*10;
        a.vx = Math.cos(ang)*sp;
        a.vy = Math.sin(ang)*sp;
      }
    } else if (type === STATE.ENTER_SQUASH_WITH_LAG){
      // 少し遅れる粒をセット
      scheduleLagCluster(now, 350, 850, 0.045);
    }

    setState(type, {});
  }

  function startQuickReturn(){
    // 4秒未満復帰：スク&スト → SHOW
    const nowStr = clockString();
    if (nowStr !== lastTimeStr) rebuildTargets();
    gatherToCenter(18);
    setState(STATE.ENTER_QUICK_SQUASH, {});
  }

  function startExit(type){
    if (type === STATE.EXIT_RED_EXPLOSION){
      slimeAlpha01 = 1.0;
      slimeHeat01 = 0.0;
      colonBlinkSpeed = 1.0;
      setState(STATE.EXIT_RED_EXPLOSION, {});
      return;
    }
    if (type === STATE.EXIT_FADE_OUT){
      slimeAlpha01 = 1.0;
      slimeHeat01 = 0.0;
      colonBlinkSpeed = 1.0;
      setState(STATE.EXIT_FADE_OUT, {});
      return;
    }
    if (type === STATE.EXIT_ZOOM_OUT_TRACKING){
      slimeAlpha01 = 1.0;
      slimeHeat01 = 0.0;
      colonBlinkSpeed = 1.0;
      setState(STATE.EXIT_ZOOM_OUT_TRACKING, { baseScale: clockScale });
      return;
    }
  }

  function startRecoverFromPost(){
    if (state === STATE.POST_RED_EXPLOSION || state === STATE.EXIT_RED_EXPLOSION){
      setState(STATE.RECOVER_RED, {});
      return;
    }
    if (state === STATE.POST_FADE_OUT_INVISIBLE || state === STATE.EXIT_FADE_OUT){
      setState(STATE.RECOVER_FADE, {});
      return;
    }
    if (state === STATE.POST_ZOOM_OUT_TRACKING || state === STATE.EXIT_ZOOM_OUT_TRACKING){
      // 現在の追従値を保持
      setState(STATE.RECOVER_ZOOM, { holdScale: clockScale, holdX: clockOffX, holdY: clockOffY });
      return;
    }
    // default
    startIdle();
  }

  // ---- Debug buttons wiring (once) ----
  if (!window.__cc_v020_dbgWired){
    window.__cc_v020_dbgWired = true;

    const el = (id)=>document.getElementById(id);

    const goIdle = el('dbgGoIdle');
    if (goIdle) goIdle.onclick = ()=>{ startIdle(); };

    const goShow = el('dbgGoShow');
    if (goShow) goShow.onclick = ()=>{ startShow(); };

    const cont = el('dbgContinue');
    if (cont) cont.onclick = ()=>{
      // 続き復帰ルートを強制
      lastFaceLostAt = performance.now() - 1000;
      startQuickReturn();
    };

    const newSess = el('dbgNewSession');
    if (newSess) newSess.onclick = ()=>{
      lastFaceLostAt = performance.now() - 5000;
      startEnter(pickEnter());
    };

    const enterGo = el('dbgEnterGo');
    if (enterGo) enterGo.onclick = ()=>{
      const sel = el('dbgEnterSel');
      const v = sel ? sel.value : 'RANDOM';
      lastFaceLostAt = performance.now() - 5000;
      startEnter(v==='RANDOM' ? pickEnter() : v);
    };

    const exitGo = el('dbgExitGo');
    if (exitGo) exitGo.onclick = ()=>{
      const sel = el('dbgExitSel');
      const v = sel ? sel.value : 'RANDOM';
      startExit(v==='RANDOM' ? pickExit() : v);
    };
  }

  // ---- State transitions (time rules) ----
  if (state === STATE.IDLE_SABORU){
    if (hasFace){
      const dtLost = (lastFaceLostAt === null) ? 999999 : (now - lastFaceLostAt);
      if (dtLost < 4000){
        startQuickReturn();
      } else {
        startEnter(pickEnter());
      }
    }
  } else if (state.startsWith('ENTER')){
    if (!hasFace){
      startIdle();
    }
  } else if (state === STATE.SHOW_TIME){
    if (!hasFace){
      startIdle();
    } else {
      // 3秒ルール（見続けられたらEXIT）
      if ((now - stateStartedAt) >= 3000){
        startExit(pickExit());
      }
    }
  } else if (state.startsWith('EXIT')){
    if (!hasFace){
      startRecoverFromPost();
    }
  } else if (state.startsWith('POST')){
    if (!hasFace){
      startRecoverFromPost();
    }
  } else if (state.startsWith('RECOVER')){
    // 戻り中に見られたら、4秒ルールで復帰判定
    if (hasFace){
      const dtLost = (lastFaceLostAt === null) ? 999999 : (now - lastFaceLostAt);
      if (dtLost < 4000){
        startQuickReturn();
      } else {
        startEnter(pickEnter());
      }
    }
  }

  // ---- Time target refresh (when digits may be shown) ----
  const digitsVisible =
    (state !== STATE.IDLE_SABORU) &&
    (state !== STATE.POST_RED_EXPLOSION) &&
    (state !== STATE.POST_FADE_OUT_INVISIBLE);

  if (digitsVisible){
    const nowStr = clockString();
    if (nowStr !== lastTimeStr) rebuildTargets();
  }

  // ---- Per-state parameters (visual + transform) ----
  let squashX = 1.0, squashY = 1.0;
  let seekK = SEEK_STRENGTH;
  let damp = DAMP;

  // defaults
  clockScale = 1.0;
  clockOffX = 0.0;
  clockOffY = 0.0;

  // helper easing
  const easeOutQuint = (t)=>1 - Math.pow(1 - t, 5);
  const easeInOut = (t)=> (t<0.5) ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2;

  if (state === STATE.ENTER_QUICK_SQUASH){
    const t = Math.max(0, Math.min(1, (now - stateStartedAt) / 420));
    const e = easeOutQuint(t);
    // いったん縦につぶれて横に伸びる → 戻る
    const s = Math.sin(Math.PI * e);
    squashX = 1.0 + 0.35 * s;
    squashY = 1.0 - 0.28 * s;
    seekK = SEEK_STRENGTH * (0.10 + 0.90 * e);
    if (t >= 1){
      startShow();
    }
  }

  if (state === STATE.ENTER_VERTICAL_BOUNCE ||
      state === STATE.ENTER_HORIZONTAL_BOUNCE ||
      state === STATE.ENTER_RANDOM_BOUNCE){
    const total = 2200;
    const t = Math.max(0, Math.min(1, (now - stateStartedAt) / total));
    seekK = SEEK_STRENGTH * (0.05 + 0.95 * t);
    damp = 0.86;

    if (t >= 1){
      startShow();
    }
  }

  if (state === STATE.ENTER_EDGE_SQUASH){
    const tAll = now - stateStartedAt;
    // 0..900ms: 端→中心 / 900..1400ms: squash / 1400..2200ms: settle
    if (tAll < 900){
      seekK = SEEK_STRENGTH * 0.06;
      damp = 0.88;
    } else if (tAll < 1400){
      const t = (tAll - 900) / 500;
      const e = easeOutQuint(Math.max(0, Math.min(1, t)));
      const s = Math.sin(Math.PI * e);
      squashX = 1.0 + 0.45 * s;
      squashY = 1.0 - 0.34 * s;
      seekK = SEEK_STRENGTH * (0.15 + 0.85 * e);
      damp = 0.84;
    } else {
      const t = Math.max(0, Math.min(1, (tAll - 1400) / 800));
      seekK = SEEK_STRENGTH * (0.20 + 0.80 * t);
      damp = 0.83;
      if (tAll >= 2200){
        startShow();
      }
    }
  }

  if (state === STATE.ENTER_SQUASH_WITH_LAG){
    const tAll = now - stateStartedAt;
    if (tAll < 520){
      const t = tAll / 520;
      const e = easeOutQuint(Math.max(0, Math.min(1, t)));
      const s = Math.sin(Math.PI * e);
      squashX = 1.0 + 0.55 * s;
      squashY = 1.0 - 0.40 * s;
      seekK = SEEK_STRENGTH * (0.12 + 0.88 * e);
      damp = 0.84;
    } else {
      const t = Math.max(0, Math.min(1, (tAll - 520) / 900));
      seekK = SEEK_STRENGTH * (0.18 + 0.82 * t);
      damp = 0.83;
      if (tAll >= 2000){
        startShow();
      }
    }
  }

  if (state === STATE.SHOW_TIME){
    slimeHeat01 = 0.0;
    slimeAlpha01 = 1.0;
    colonBlinkSpeed = 1.0;
    seekK = SEEK_STRENGTH;
    damp = DAMP;
  }

  if (state === STATE.EXIT_RED_EXPLOSION){
    const t = Math.max(0, Math.min(1, (now - stateStartedAt) / 1600));
    slimeHeat01 = easeInOut(t);
    colonBlinkSpeed = 1.0 + 4.0 * t;
    slimeAlpha01 = 1.0;
    seekK = SEEK_STRENGTH * 0.7;
    damp = DAMP;

    if (t >= 1){
      applyExplosionImpulse();
      setState(STATE.POST_RED_EXPLOSION, {});
    }
  }

  if (state === STATE.POST_RED_EXPLOSION){
    slimeHeat01 = 1.0;
    slimeAlpha01 = 1.0;
    colonBlinkSpeed = 6.0;
  }

  if (state === STATE.RECOVER_RED){
    const t = Math.max(0, Math.min(1, (now - stateStartedAt) / 1400));
    slimeHeat01 = 1.0 - t;
    slimeAlpha01 = 1.0;
    colonBlinkSpeed = 1.0;
    if (t >= 1){
      startIdle();
    }
  }

  if (state === STATE.EXIT_FADE_OUT){
    const t = Math.max(0, Math.min(1, (now - stateStartedAt) / 1300));
    slimeAlpha01 = 1.0 - easeOutQuint(t);
    slimeHeat01 = 0.0;
    colonBlinkSpeed = 1.0;
    seekK = SEEK_STRENGTH * 0.8;
    damp = DAMP;
    if (t >= 1){
      slimeAlpha01 = 0.0;
      setState(STATE.POST_FADE_OUT_INVISIBLE, {});
    }
  }

  if (state === STATE.POST_FADE_OUT_INVISIBLE){
    slimeAlpha01 = 0.0;
    slimeHeat01 = 0.0;
    colonBlinkSpeed = 1.0;
  }

  if (state === STATE.RECOVER_FADE){
    const t = Math.max(0, Math.min(1, (now - stateStartedAt) / 1400));
    // 背景からじわ〜っと出る：alpha 0→1
    slimeAlpha01 = easeOutQuint(t);
    slimeHeat01 = 0.0;
    colonBlinkSpeed = 1.0;
    if (t >= 1){
      startIdle();
    }
  }

  if (state === STATE.EXIT_ZOOM_OUT_TRACKING){
    const t = Math.max(0, Math.min(1, (now - stateStartedAt) / 520));
    const e = easeOutQuint(t);
    clockScale = 1.0 + (0.42 - 1.0) * e; // ぎゅん
    clockOffX = 0.0;
    clockOffY = 0.0;
    slimeAlpha01 = 1.0;
    slimeHeat01 = 0.0;
    colonBlinkSpeed = 1.0;

    seekK = SEEK_STRENGTH * 0.9;
    damp = DAMP;

    if (t >= 1){
      setState(STATE.POST_ZOOM_OUT_TRACKING, { scale: clockScale, offX: 0, offY: 0 });
    }
  }

  if (state === STATE.POST_ZOOM_OUT_TRACKING){
    // 追従：顔の位置に対して「反対」へ逃げる
    // 距離：近いほど小さく（遠のく）、遠いほど大きく（近づく）
    const close = Math.max(0, Math.min(1, faceClose01));
    const fx = Math.max(0, Math.min(1, faceX01));
    const fy = Math.max(0, Math.min(1, faceY01));

    const targetScale = (0.95 * (1.0 - close)) + (0.26 * close); // far->0.95, close->0.26

    const dx = (fx - 0.5);
    const dy = (fy - 0.5);

    const targetOffX = -dx * p.width * 0.18;
    const targetOffY = -dy * p.height * 0.14;

    // smoothing
    clockScale = clockScale + (targetScale - clockScale) * 0.08;
    clockOffX  = clockOffX  + (targetOffX  - clockOffX)  * 0.10;
    clockOffY  = clockOffY  + (targetOffY  - clockOffY)  * 0.10;

    slimeAlpha01 = 1.0;
    slimeHeat01 = 0.0;
    colonBlinkSpeed = 1.0;

    seekK = SEEK_STRENGTH * 0.9;
    damp = DAMP;
  }

  if (state === STATE.RECOVER_ZOOM){
    const t = Math.max(0, Math.min(1, (now - stateStartedAt) / 900));
    // ふわっと消える
    slimeAlpha01 = 1.0 - easeOutQuint(t);
    slimeHeat01 = 0.0;
    colonBlinkSpeed = 1.0;

    // 消える間は、その場（縮小＋オフセット）を保つ
    clockScale = stateData.holdScale || clockScale;
    clockOffX  = stateData.holdX || clockOffX;
    clockOffY  = stateData.holdY || clockOffY;

    if (t >= 1){
      // そのあとサボり液体が戻る
      slimeAlpha01 = 1.0;
      startIdle();
    }
  }

  // ---- Background ----
  p.background(0);

  // ---- Physics step ----
  const tSec = now * 0.001;

  for (let i=0;i<N;i++){
    const a = pts[i];

    // common transform target
    const baseTx = a.tx, baseTy = a.ty;

    const tx = CLOCK_CX + (baseTx - CLOCK_CX) * (clockScale * squashX) + clockOffX;
    const ty = CLOCK_CY + (baseTy - CLOCK_CY) * (clockScale * squashY) + clockOffY;

    if (state === STATE.IDLE_SABORU){
      a.vx = (a.vx + (Math.random()-0.5)*IDLE_JITTER) * 0.98;
      a.vy = (a.vy + (Math.random()-0.5)*IDLE_JITTER) * 0.98;

    } else if (state === STATE.POST_RED_EXPLOSION){
      // 爆発後：飛び散ったままをゆるく減速
      a.vx = a.vx * EXPLOSION_DAMP + (Math.random()-0.5)*IDLE_JITTER*EXPLOSION_JITTER_GAIN;
      a.vy = a.vy * EXPLOSION_DAMP + (Math.random()-0.5)*IDLE_JITTER*EXPLOSION_JITTER_GAIN;

    } else if (state === STATE.RECOVER_RED){
      // 溶けていく：爆発の勢いを落としてサボりへ寄せる
      a.vx = a.vx * 0.93 + (Math.random()-0.5)*IDLE_JITTER*0.4;
      a.vy = a.vy * 0.93 + (Math.random()-0.5)*IDLE_JITTER*0.4;

    } else {
      // digits-seeking modes
      // Lag particles (ENTER_SQUASH_WITH_LAG)
      if (state === STATE.ENTER_SQUASH_WITH_LAG && now < a.activeAt){
        a.vx = a.vx*0.90 + (Math.random()-0.5)*0.55;
        a.vy = a.vy*0.90 + (Math.random()-0.5)*0.55;
      } else {
        // wobble (SHOW_TIME)
        let wox = 0, woy = 0;
        if (state === STATE.SHOW_TIME){
          const phase = i * 0.37;
          wox = Math.sin(tSec*(WOBBLE_BASE_HZ + 0.07) + phase) * SEEN_WOBBLE;
          woy = Math.cos(tSec*(WOBBLE_BASE_HZ + 0.05) + phase) * SEEN_WOBBLE;
        }

        const dx = (tx + wox) - a.x;
        const dy = (ty + woy) - a.y;
        a.vx = a.vx * damp + dx * seekK;
        a.vy = a.vy * damp + dy * seekK;
      }

      // Bounce behavior during ENTER bounce states
      if (state === STATE.ENTER_VERTICAL_BOUNCE){
        // gravity-ish
        a.vy += 0.18;
        // reflect top/bottom
        if (a.y < 0){ a.y = 0; a.vy *= -0.90; }
        if (a.y > p.height){ a.y = p.height; a.vy *= -0.90; }
        // mild x boundary
        if (a.x < 0){ a.x = 0; a.vx *= -0.6; }
        if (a.x > p.width){ a.x = p.width; a.vx *= -0.6; }
      } else if (state === STATE.ENTER_HORIZONTAL_BOUNCE){
        a.vx += 0.18;
        if (a.x < 0){ a.x = 0; a.vx *= -0.90; }
        if (a.x > p.width){ a.x = p.width; a.vx *= -0.90; }
        if (a.y < 0){ a.y = 0; a.vy *= -0.6; }
        if (a.y > p.height){ a.y = p.height; a.vy *= -0.6; }
      } else if (state === STATE.ENTER_RANDOM_BOUNCE){
        if (a.x < 0){ a.x = 0; a.vx *= -0.90; }
        if (a.x > p.width){ a.x = p.width; a.vx *= -0.90; }
        if (a.y < 0){ a.y = 0; a.vy *= -0.90; }
        if (a.y > p.height){ a.y = p.height; a.vy *= -0.90; }
      } else if (state === STATE.ENTER_EDGE_SQUASH){
        // Keep within bounds once inside
        if (a.x < 0){ a.x = 0; a.vx *= -0.6; }
        if (a.x > p.width){ a.x = p.width; a.vx *= -0.6; }
        if (a.y < 0){ a.y = 0; a.vy *= -0.6; }
        if (a.y > p.height){ a.y = p.height; a.vy *= -0.6; }
      }
    }

    // integrate
    a.x += a.vx;
    a.y += a.vy;

    // hard bounds in general
    if (a.x < 0){ a.x = 0; a.vx *= -0.5; }
    if (a.x > p.width){ a.x = p.width; a.vx *= -0.5; }
    if (a.y < 0){ a.y = 0; a.vy *= -0.5; }
    if (a.y > p.height){ a.y = p.height; a.vy *= -0.5; }
  }

  // ---- Readout ----
  const ro = document.getElementById('dbgReadout');
  if (ro){
    ro.textContent =
      'STATE: ' + state +
      ' | hasFace: ' + (hasFace ? 'true' : 'false') +
      ' | lastLost: ' + (lastFaceLostAt ? ((now-lastFaceLostAt)/1000).toFixed(2)+'s' : '-') +
      ' | faceX/Y: ' + faceX01.toFixed(2) + ',' + faceY01.toFixed(2) +
      ' | close: ' + faceClose01.toFixed(2);
  }

  // ---- SLIME rendering ----
  drawSlime();
};

window.addEventListener('resize', ()=>{ resize(); applyFitScale(); });
    };
    new p5(sketch);
  }
  if (document.readyState==='loading'){ window.addEventListener('DOMContentLoaded', boot); } else { boot(); }
})();