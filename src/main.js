
(function(){
  'use strict';
  function boot(){
    // ---------------- Config ----------------
    const UA = navigator.userAgent || '';
    const IS_IOS = /iPad|iPhone|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const IS_IPAD = /iPad/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    // iPadはGPU/CPU負荷が上がりやすいので、デフォルトは軽量モード（見た目はほぼ維持）
    const PERF_MODE = IS_IOS;
    const DPR = PERF_MODE ? 1 : Math.min(window.devicePixelRatio || 1, 2);

	    // ---- SLIME renderer params (guided) ----
	    // v0.0.0 の描写前提の定数を復活（未定義エラー回避 & 画質の基準）
	    const DISC_RADIUS = 14;      // smaller radius → sharper edge
	    const BLUR_AMOUNT = 3;       // less blur
	    const THRESH_LEVEL = 0.558;  // higher threshold → crisper

	    // Font
	    const USE_FONT = true;
	    const FONT_FAMILY_PRIMARY = 'InterLocal';
	    const FONT_FAMILY_LOCAL   = 'ClockFontLocal';
	    let FONT_WEIGHT = 700;
	    const LETTER_SPACING = 0.02;
	    let fontSize = 280;

    // Slime / blob buffer budget (pixels).
    // 1920x1080(=2,073,600px) で blobScale が基本 2 になるように設定。
    // resize() 内で blobScale = ceil(sqrt(area / MAX_BLOB_PIXELS)) を使う。
    const MAX_BLOB_PIXELS = PERF_MODE ? 220000 : 540000;
    // Particle allocation (seconds are removed (v0.5.6))
    // Render budgets (skip some particles when drawing the blob to keep it smooth on iPad)
    const RENDER_BUDGET_H = PERF_MODE ? 340 : 1400;
    const RENDER_BUDGET_M = PERF_MODE ? 340 : 1400;
    const RENDER_BUDGET_C = PERF_MODE ? 70  : 90;
    const ENABLE_OUTLINE_PASS = !PERF_MODE;
    const GUIDE_STRIDE_BASE = PERF_MODE ? 8 : 4;

    const HN = 770, MN = 770;
    const CN = 110;          // colon ":" allocation
    const N  = HN + MN + CN; // total
    const IDLE_JITTER = 0.35, SEEK_STRENGTH = 0.085, DAMP = 0.78;
    const DETECT_MIN_INTERVAL_MS = PERF_MODE ? 160 : 110, SEEN_DEBOUNCE_MS = 180;
    const LOST_CONFIRM_STREAK = 2; // 連続「未検知」回数で見失い確定（検出の瞬断を吸収）

    // 見失い時の「パキッ」を防ぐためのスムーズ切替（ms）
    // ②-a / ②-b の最中・後でも、未検知になった瞬間からじわっとサボり(IDLE)へ。
    const LOST_TO_IDLE_MS = 220;

    // ---- Linger-head gag ----
    const LAG_FRACTION_MIN = 0.15, LAG_FRACTION_MAX = 0.25;
    const LAG_LINGER_MIN_MS = 700, LAG_LINGER_MAX_MS = 1100;
    const LAG_WIGGLE = 0.12, CATCHUP_MS = 320, CATCHUP_GAIN = 1.85;
    
    // Subtle life wobble when the clock is being seen (digits displayed)
    const SEEN_WOBBLE = 8.32;       // px amplitude of wobble
    const WOBBLE_BASE_HZ = 0.10;     // base cycles per second
    const WOBBLE_JITTER_HZ = 16.24;   // per-particle frequency variation

    
// ---------------- ENTER (登場) ----------------
// 4秒ルール：最後に見失ってから 4.0s 未満 → ①-a、それ以上 → ②をランダム
const ENTER_RULE_SEC = 4.0;

// ---------------- EXIT (解散) ----------------
const EXIT_RULE_SHOW_MS = 4000;      // SHOW開始から何msで②を発動するか
const EXIT1A_TRIGGER_RATIO = 1.12;  


// v0.5.2: EXIT①-a（後ずさり）は「急速に近づいた」時だけ発火させる（1mm増で暴発しない）
// 近づき判定: 短時間で面積が増えた + ただの移動（中心だけ動く）と区別
const EXIT1A_APPROACH_WINDOW_MS = 100;       // 何msの変化を見るか
const EXIT1A_APPROACH_RATIO = 1.07;          // 最低でもこれだけ面積比が増えたら「近づき」候補
const EXIT1A_APPROACH_MIN_DSIZE = 0.008;     // 面積(正規化)の絶対増加量（ノイズ除去）
const EXIT1A_APPROACH_MIN_RATE = 0.040;      // 1秒あたりの増加量（急速さ）
const EXIT1A_APPROACH_MOVE_THRESH = 0.08;    // ただの移動（中心移動）が大きい時の判定
const EXIT1A_APPROACH_MOVE_EXTRA_RATIO = 0.02; // 大きく移動した場合は、さらに面積増加を要求
const EXIT1A_APPROACH_COOLDOWN_MS = 1200;    // 連続暴発を防ぐクールダウン

// v0.5.2: EXIT①-a中でも「見続けたら（②-a/②-b）」へ移行できるように、ホールド安定を判定（※サイズ変化は無視）
const EXIT1A_HOLD_STABLE_MS = 4000;          // 何ms安定していたら「見続けた」とみなすか
const EXIT1A_HOLD_POS_VEL = 0.10;            // 位置変化速度(正規化/秒)の閾値
const EXIT1A_HOLD_SIZE_VEL = 0.040;          // 大きさ変化速度(正規化/秒)の閾値
// v0.5.2: 「ちょっとの動き」は見逃すため、位置のドリフト(揺れ)で安定判定（速度ではなく範囲）
const EXIT1A_HOLD_DRIFT_WINDOW_MS = 350;    // 直近この時間の範囲で「ほぼ停止」を判定
const EXIT1A_HOLD_MAX_DRIFT_N = 0.030;      // 許容ドリフト半径（正規化）
const EXIT1A_HOLD_UNSTABLE_GRACE_MS = 300;  // 一瞬のブレは許す（この時間以上ズレ続けたらリセット）
// ①-a（後ずさり）: 発動した瞬間のベース縮小率（SHOW時=1.0 → EXIT1A_BASE_SCALE）
const EXIT1A_BASE_SCALE = 0.70;
// ①-a（後ずさり）: 小さくなるアニメ時間（ms）
const EXIT1A_SHRINK_MS = 280;
// ①-a（後ずさり）: スケール上限（大きさゲージの最大をもっと効かせる）
const EXIT1A_SCALE_MAX = 2.80;
// ①-a（後ずさり）: 壁ギリギリまで行かせる余白（px）
// ※「まだ壁との間に余裕がある」対策で極小化
const EXIT1A_WALL_PAD = 0;
// ①-a（後ずさり）: 壁に押し付ける強さ（>1で少しめり込み→グチャ）
const EXIT1A_OVERSHOOT = 1.18;
// ①-a（後ずさり）: 壁衝突のグチャ（押し潰し量）
const EXIT1A_SQUISH_COMPRESS = 0.55;   // 0..1
const EXIT1A_SQUISH_EXPAND   = 0.28;   // 0..1

// ①-a（後ずさり）: ぶつかった時に縦/横へ伸びすぎない上限（縦長化の抑制）
const EXIT1A_SQUISH_STRETCH_MAX = 1.10;
// 顔サイズがベースの何倍で①-aを発動するか

// ②-a（赤→爆発）
const EXIT2A_BUILDUP_MS = 2600;
const EXIT2A_SHRINK_MS = 200;       // ≒0.2s
const EXIT2A_TO_WHITE_MS = 3000;
// v0.9.2: もっと飛び散って壁まで届くように初速を強化
const EXIT2A_EXPLODE_SPEED = 125;

// ②-b（透明→消滅）
const EXIT2B_FADE_MS = 2600;
const EXIT2B_SPREAD_START_MS = 1800;
const EXIT2B_SPREAD_END_MS = 2400;
const EXIT2B_COLLAPSE_START_MS = 2400;
const EXIT2B_COLLAPSE_END_MS = 3000;
// ②-b Dust (さらさら塵)
const EXIT2B_DUST_MS = 1400;
const EXIT2B_DUST_GRAV = 0.22;
const EXIT2B_DUST_JITTER = 0.30;

// v0.8.1: EXIT②-b（透明→消滅）
// ①ゆらゆら停止 → 1.0s後に上からサラサラ崩壊 → 崩れた粒から0.3s後に徐々に透明化
const EXIT2B_CRUMBLE_DELAY_MS = 1000;
const EXIT2B_CRUMBLE_SWEEP_MS = 1400;
const EXIT2B_SAND_GRAV = 0.20;
const EXIT2B_SAND_JITTER = 0.32;
const EXIT2B_SAND_FADE_DELAY_MS = 300;
const EXIT2B_SAND_FADE_MS = 1200;



// ①-a（スクスト：v0.0.0 Tier3相当）のイージング（Expoオーバーシュート）
// ※値は v0.0.0 の Tier3 と同じ
const ENTER_OVERSHOOT_TIME_POWER = 1.0;
const ENTER_OVERSHOOT_BACK = 1.0;
const ENTER_OVERSHOOT_PEAK_FRAC = 0.4;
const ENTER_OVERSHOOT_OUT_EXPO_STEEPNESS = 40.0;
const ENTER_OVERSHOOT_IN_EXPO_STEEPNESS  = 40.0;

// ②-a：遅れてくるパートの開始遅延
const ENTER_DELAY_MS = 1200;   // 顔検知→0.5秒経過後

// ENTER バウンド共通（②-b/c/d）
const ENTER_BLOB_RADIUS = 175;
const ENTER_WALL_PAD_X = 270;
const ENTER_WALL_PAD_Y = 230;

// Easings (from easings.net)
function easeOutCirc(x){
  x = Math.max(0, Math.min(1, x));
  return Math.sqrt(1 - Math.pow(x - 1, 2));
}
function easeInOutQuad(x){
  x = Math.max(0, Math.min(1, x));
  return x < 0.5 ? 2*x*x : 1 - Math.pow(-2*x + 2, 2)/2;
}
function easeOutQuad(x){
  x = Math.max(0, Math.min(1, x));
  return 1 - (1 - x) * (1 - x);
}
function easeInQuad(x){
  x = Math.max(0, Math.min(1, x));
  return x * x;
}


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
      // 初回は「見られていない」状態から開始（展示/一般向け）
      let seen = false, prevSeen = false, lastTimeStr = "";
      let frames=0, lastFPS=0, lastFPSTime=performance.now();
      let unseenStart = null;  // 見られていない状態が始まった時刻

      // 見失い時のソフト遷移（0..1の係数で「見られている影響」を残しつつIDLEへ）
      let softLost = null;     // { start:number, dur:number }
      let seenFactor = 0.0;    // 1=見られている, 0=見られていない（ソフト遷移中は中間）

// Phase (4フェーズ)
let phase = 'IDLE';       // 'IDLE' | 'ENTER' | 'SHOW' | 'EXIT'
let enterName = '-';      // UI 表示用
let exitName = '-';       // UI 表示用
let enter = null;         // {type,start,end,...}
let exit = null;          // {type,start,...}
let manualEnterRequest = null; // {type, unseenSec?}
let manualExitRequest = null;  // {type}
let showStart = null;     // SHOWに入った時刻

// Face metrics (for EXIT①-a)
const simFace = {x:0.5, y:0.5, size:0.22};
const faceMem = {has:false, cx:0.5, cy:0.5, size:0.22, smooth:0.22, base:0.22};


// v0.5.0: 近づき/安定ホールド判定のためのバッファ
let _approachBuf = [];        // {t,size,cx,cy}（直近EXIT1A_APPROACH_WINDOW_MSだけ保持）
let _lastApproachAt = -1;
let _holdStableSince = null;
let _holdPrev = null;
let _holdBuf = [];            // 直近の顔位置サンプル（安定判定用）
let _holdUnstableSince = null;

function _resetApproachTracker(){
  _approachBuf.length = 0;
  _holdPrev = null;
  _holdStableSince = null;
}


      // Camera state
      const cam = { enabled:false, preview:false,
                    video: document.getElementById('cam'),
                    wrap: document.getElementById('camWrap'),
                    inner: document.getElementById('camInner'),
                    previewMirror:true,
                    faceBox: document.getElementById('faceBox'),
                    stream:null, detector:null, api:'none', lastSeenAt: 0, lastDetectAt: 0, noFaceStreak: 0,
                    face:{has:false,cx:0.5,cy:0.5,size:0.22,w:0,h:0}, faceAt:0 };

      function hideFaceBox(){
        if (cam.faceBox){ cam.faceBox.style.display = 'none'; }
      }

      // Update face tracking box on the camera preview using actual video DOM rect.
      // This avoids drift caused by layout/padding/aspect differences.
      function updateFaceBoxFromBB(bb, vw, vh){
        if (!cam.faceBox || !cam.video) return;
        const inner = cam.inner || cam.video.parentElement;
        if (!inner) return;

        const vr = cam.video.getBoundingClientRect();
        const ir = inner.getBoundingClientRect();
        if (!vr || vr.width < 2 || vr.height < 2) return;

        // Normalize bbox to [0,1] in source video pixels
        let x0 = (bb.originX) / vw;
        let y0 = (bb.originY) / vh;
        let x1 = (bb.originX + bb.width) / vw;
        let y1 = (bb.originY + bb.height) / vh;

        // Clamp
        x0 = Math.max(0, Math.min(1, x0));
        y0 = Math.max(0, Math.min(1, y0));
        x1 = Math.max(0, Math.min(1, x1));
        y1 = Math.max(0, Math.min(1, y1));

        // Mirror X if preview video is mirrored via CSS
        if (cam.previewMirror){
          const nx0 = 1.0 - x1;
          const nx1 = 1.0 - x0;
          x0 = nx0; x1 = nx1;
        }

        // Convert to pixels inside inner (relative coords)
        const baseL = (vr.left - ir.left);
        const baseT = (vr.top  - ir.top);
        const wDisp = vr.width;
        const hDisp = vr.height;

        const leftPx = baseL + x0 * wDisp;
        const topPx  = baseT + y0 * hDisp;
        const wPx    = (x1 - x0) * wDisp;
        const hPx    = (y1 - y0) * hDisp;

        // Square box (use max of w/h) + small margin
        let s = Math.max(wPx, hPx) * 1.08;
        if (!isFinite(s) || s <= 0){
          cam.faceBox.style.display = 'none';
          return;
        }
        s = Math.max(12, s); // minimum visible size

        const cx = leftPx + wPx * 0.5;
        const cy = topPx  + hPx * 0.5;
        let boxL = cx - s * 0.5;
        let boxT = cy - s * 0.5;

        // Clamp inside video rect
        const minL = baseL;
        const minT = baseT;
        const maxL = baseL + wDisp - s;
        const maxT = baseT + hDisp - s;
        boxL = Math.max(minL, Math.min(maxL, boxL));
        boxT = Math.max(minT, Math.min(maxT, boxT));

        // --- Jitter smoothing (low-pass) ---
        // Face detection bbox fluctuates frame-by-frame, especially on iPad Safari.
        // Smooth position/size in *display pixels* to reduce "piku-piku".
        const tNow = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        if (!cam._faceBoxSmooth){
          cam._faceBoxSmooth = { l: boxL, t: boxT, s: s, tPrev: tNow, init: true };
        } else {
          const sm = cam._faceBoxSmooth;
          const dt = Math.max(0, tNow - (sm.tPrev || tNow));
          sm.tPrev = tNow;

          const dist = Math.hypot(boxL - sm.l, boxT - sm.t);

          // Dynamic time constants (ms): steadier when still, quicker when moving
          let tauPos  = 120;
          let tauSize = 170;
          if (dist > 24){ tauPos = 80;  tauSize = 120; }
          if (dist > 90){ tauPos = 40;  tauSize = 60;  }

          // If it jumps a lot (re-detect / fast move), snap immediately
          if (dist > 180){
            sm.l = boxL; sm.t = boxT; sm.s = s;
          } else {
            const aPos  = Math.min(0.55, Math.max(0.06, 1 - Math.exp(-dt / tauPos )));
            const aSize = Math.min(0.50, Math.max(0.05, 1 - Math.exp(-dt / tauSize)));

            // Deadband: ignore tiny fluctuations
            const dx = boxL - sm.l;
            const dy = boxT - sm.t;
            const ds = s    - sm.s;
            const EPS = 0.35; // px
            const EPS_S = 0.50; // px
            const tx = (Math.abs(dx) < EPS) ? sm.l : boxL;
            const ty = (Math.abs(dy) < EPS) ? sm.t : boxT;
            const ts = (Math.abs(ds) < EPS_S) ? sm.s : s;

            sm.l += (tx - sm.l) * aPos;
            sm.t += (ty - sm.t) * aPos;
            sm.s += (ts - sm.s) * aSize;
          }

          // Re-clamp with smoothed size
          const s2 = Math.max(12, sm.s);
          const maxL2 = baseL + wDisp - s2;
          const maxT2 = baseT + hDisp - s2;
          sm.l = Math.max(minL, Math.min(maxL2, sm.l));
          sm.t = Math.max(minT, Math.min(maxT2, sm.t));
          sm.s = s2;

          boxL = sm.l;
          boxT = sm.t;
          s    = sm.s;
        }

        // Optional pixel snapping (half-pixel) to reduce shimmer
        const snap = (v)=> Math.round(v * 2) / 2;
        boxL = snap(boxL);
        boxT = snap(boxT);
        s    = snap(s);

        cam.faceBox.style.left = boxL.toFixed(1) + 'px';
        cam.faceBox.style.top  = boxT.toFixed(1) + 'px';
        cam.faceBox.style.width  = s.toFixed(1) + 'px';
        cam.faceBox.style.height = s.toFixed(1) + 'px';
        cam.faceBox.style.display = 'block';
      }

      function updateFaceBox(cx, cy, wNorm, hNorm){
        if (!cam.faceBox) return;
        // Square box for clarity
        let s = Math.max(wNorm || 0, hNorm || 0);
        // Slightly inflate for readability
        s *= 1.08;
        s = Math.max(0.02, Math.min(1.0, s));

        let left = (cx || 0.5) - s * 0.5;
        let top  = (cy || 0.5) - s * 0.5;

        // Clamp within [0,1]
        left = Math.max(0, Math.min(1 - s, left));
        top  = Math.max(0, Math.min(1 - s, top));

        cam.faceBox.style.left = (left * 100).toFixed(3) + '%';
        cam.faceBox.style.top  = (top  * 100).toFixed(3) + '%';
        cam.faceBox.style.width  = (s * 100).toFixed(3) + '%';
        cam.faceBox.style.height = (s * 100).toFixed(3) + '%';
        cam.faceBox.style.display = 'block';
      }

      // UI
      const holder = document.getElementById('canvas-holder');
      // UI (v0.2.0): 一般向けに最小UI
      const fakeSeen = document.getElementById('fakeSeen');     // 旧デバッグ用（存在しなくてもOK）
      const btnCam = document.getElementById('btnCam');
      const btnPreview = document.getElementById('btnPreview'); // 新: ボタンでトグル
      const togglePreview = document.getElementById('togglePreview'); // 旧: チェックボックス（存在しなくてもOK）
      const diag = document.getElementById('diag');             // 旧: 診断表示（存在しなくてもOK）

      // Fullscreen & UI visibility (for exhibition)
      const uiBox = document.getElementById('ui');
      const btnFS = document.getElementById('btnFS');
      const btnHideUI = document.getElementById('btnHideUI');
      const uiFab = document.getElementById('uiFab');
      const fsHelp = document.getElementById('fsHelp');
      const fsHelpClose = document.getElementById('fsHelpClose');

      function setUIVisible(v){
        if (!uiBox) return;
        uiBox.style.display = v ? 'block' : 'none';
        if (uiFab) uiFab.style.display = v ? 'none' : 'block';
      }
      function showFsHelp(v){
        if (!fsHelp) return;
        fsHelp.style.display = v ? 'block' : 'none';
      }
      async function requestFullscreenSmart(){
        // Try Fullscreen API first (works on some browsers)
        const el = document.documentElement;
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (!req){
          showFsHelp(true);
          return;
        }
        try{
          // Some browsers accept an options object, some don't.
          const maybe = req.length >= 1 ? req.call(el, { navigationUI: 'hide' }) : req.call(el);
          if (maybe && typeof maybe.then === 'function') await maybe;
        }catch(e){
          showFsHelp(true);
          return;
        }
      }

      if (btnHideUI){ btnHideUI.addEventListener('click', ()=> setUIVisible(false)); }
      if (uiFab){ uiFab.addEventListener('click', ()=> setUIVisible(true)); }
      if (btnFS){ btnFS.addEventListener('click', ()=>{ requestFullscreenSmart(); }); }
      if (fsHelpClose){ fsHelpClose.addEventListener('click', ()=> showFsHelp(false)); }
      if (fsHelp){ fsHelp.addEventListener('click', (e)=>{ if (e.target === fsHelp) showFsHelp(false); }); }


const phaseLabel = document.getElementById('phaseLabel');
const enterLabel = document.getElementById('enterLabel');
const exitLabel = document.getElementById('exitLabel');
const btnExit1a = document.getElementById('btnExit1a');
const btnExit2a = document.getElementById('btnExit2a');
const btnExit2b = document.getElementById('btnExit2b');
const simFaceX = document.getElementById('simFaceX');
const simFaceY = document.getElementById('simFaceY');
const simFaceSize = document.getElementById('simFaceSize');
const simFaceXVal = document.getElementById('simFaceXVal');
const simFaceYVal = document.getElementById('simFaceYVal');
const simFaceSizeVal = document.getElementById('simFaceSizeVal');

// ENTER②-a tuning controls
const enter2aDelay = document.getElementById('enter2aDelay');
const enter2aRatio = document.getElementById('enter2aRatio');
const enter2aCluster = document.getElementById('enter2aCluster');
const enter2aDelayVal = document.getElementById('enter2aDelayVal');
const enter2aRatioVal = document.getElementById('enter2aRatioVal');

const tuneEnter2a = {
  delayMs: ENTER_DELAY_MS,
  ratio: 1.0,
  cluster: true,
};

function updateEnter2aUI(){
  if (enter2aDelayVal) enter2aDelayVal.textContent = Math.round(tuneEnter2a.delayMs) + 'ms';
  if (enter2aRatioVal) enter2aRatioVal.textContent = Number(tuneEnter2a.ratio).toFixed(2);
}

// ---- Soft transition helpers ----
function startSoftLost(now){
  if (!softLost){
    softLost = { start: now, dur: LOST_TO_IDLE_MS };
  }
}

function updateSoftLost(now){
  if (seen){
    softLost = null;
    seenFactor = 1.0;
    return;
  }
  // not seen
  if (phase === 'IDLE'){
    softLost = null;
    seenFactor = 0.0;
    return;
  }
  if (!softLost) softLost = { start: now, dur: LOST_TO_IDLE_MS };
  const u = Math.max(0, Math.min(1, (now - softLost.start) / Math.max(1, softLost.dur)));
  const k = easeOutQuad(u);
  seenFactor = 1.0 - k;
  if (u >= 1){
    // transition finished → fully idle
    clearEnter();
    clearExit();
    _resetApproachTracker();
    showStart = null;
    setPhase('IDLE');
    softLost = null;
    seenFactor = 0.0;
  }
}


const btnEnter1a = document.getElementById('btnEnter1a');
const btnEnter2a = document.getElementById('btnEnter2a');
const btnEnter2b = document.getElementById('btnEnter2b');
const simUnseenSec = document.getElementById('simUnseenSec');
const simUnseenVal = document.getElementById('simUnseenVal');
const btnAutoEnter = document.getElementById('btnAutoEnter');

function uiSetEnter(type){
  // シミュレーションがOFFならONにして、強制的にENTERを叩けるようにする
  if (fakeSeen){ fakeSeen.checked = true; }
  seen = true;
  manualEnterRequest = { type };
  updateDiag('診断: 手動ENTER ' + type);
}

function uiSetExit(type){
  if (fakeSeen){ fakeSeen.checked = true; }
  seen = true;
  manualExitRequest = { type };
  updateDiag('診断: 手動EXIT ' + type);
}

if (btnEnter1a) btnEnter1a.addEventListener('click', ()=>uiSetEnter('1a'));
if (btnEnter2a) btnEnter2a.addEventListener('click', ()=>uiSetEnter('2a'));
if (btnEnter2b) btnEnter2b.addEventListener('click', ()=>uiSetEnter('2b'));

if (btnExit1a) btnExit1a.addEventListener('click', ()=>uiSetExit('1a'));
if (btnExit2a) btnExit2a.addEventListener('click', ()=>uiSetExit('2a'));
if (btnExit2b) btnExit2b.addEventListener('click', ()=>uiSetExit('2b'));


if (simUnseenSec && simUnseenVal){
  simUnseenSec.addEventListener('input', ()=>{
    simUnseenVal.textContent = Number(simUnseenSec.value).toFixed(1) + 's';
  });
}




// ENTER②-a tuning controls (v0.7.0)
  // ユーザー指定: delay=1200ms固定 / 量=1.0固定 / クラスターは軽め側で固定
  // NOTE: 量=1.0 のときは cluster の方が non-cluster(分散ピック)より軽いので cluster=true 固定。
  tuneEnter2a.delayMs = 1200;
  tuneEnter2a.ratio = 1.0;
  tuneEnter2a.cluster = true;

  if (enter2aDelay){
    enter2aDelay.value = String(tuneEnter2a.delayMs);
    enter2aDelay.disabled = true;
  }
  if (enter2aRatio){
    enter2aRatio.value = String(tuneEnter2a.ratio);
    enter2aRatio.disabled = true;
  }
  if (enter2aCluster){
    enter2aCluster.checked = !!tuneEnter2a.cluster;
    enter2aCluster.disabled = true;
  }
  updateEnter2aUI();
// Face simulation sliders (for EXIT①-a / デバッグ)
function updateSimFaceUI(){
  if (simFaceXVal) simFaceXVal.textContent = Number(simFace.x).toFixed(2);
  if (simFaceYVal) simFaceYVal.textContent = Number(simFace.y).toFixed(2);
  if (simFaceSizeVal) simFaceSizeVal.textContent = Number(simFace.size).toFixed(2);
}
function bindFaceSlider(slider, key){
  if (!slider) return;
  slider.addEventListener('input', ()=>{
    simFace[key] = Number(slider.value);
    updateSimFaceUI();
  });
  simFace[key] = Number(slider.value);
  updateSimFaceUI();
}
bindFaceSlider(simFaceX, 'x');
bindFaceSlider(simFaceY, 'y');
bindFaceSlider(simFaceSize, 'size');

if (btnAutoEnter){
  btnAutoEnter.addEventListener('click', ()=>{
    const sec = simUnseenSec ? Number(simUnseenSec.value) : 2.0;
    if (fakeSeen){ fakeSeen.checked = true; }
    seen = true;
    manualEnterRequest = { type: 'AUTO', unseenSec: sec };
    updateDiag('診断: 自動ENTER (unseen=' + sec.toFixed(1) + 's)');
  });
}

// init labels
if (phaseLabel) phaseLabel.textContent = 'Phase: ' + phase;
if (enterLabel) enterLabel.textContent = 'Enter: ' + enterName;


      // 旧デバッグUIが残っている場合だけ拾う（公開版では基本的にDOMに存在しない）
      if (fakeSeen){
        fakeSeen.addEventListener('change', ()=>{ seen = !!fakeSeen.checked; });
      }

      function applyPreviewState(on){
        cam.preview = !!on;
        if (cam.wrap){
          cam.wrap.style.display = (cam.preview && cam.enabled) ? 'block' : 'none';
        }
        if (togglePreview){
          togglePreview.checked = !!cam.preview;
        }
        if (btnPreview){
          btnPreview.textContent = cam.preview ? 'カメラプレビューを非表示' : 'カメラプレビューを表示';
          btnPreview.classList.toggle('primary', cam.preview);
        }
      }

      // 新UI: ボタンでプレビューをトグル
      if (btnPreview){
        btnPreview.addEventListener('click', ()=> applyPreviewState(!cam.preview));
      }

      // 旧UI: チェックボックスがある場合は連動
      if (togglePreview){
        togglePreview.addEventListener('change', ()=> applyPreviewState(!!togglePreview.checked));
      }

      // 初期はプレビューOFF（一般向け）
      applyPreviewState(false);
      if (btnCam){ btnCam.addEventListener('click', startCamera); }
      function updateDiag(text){ if (diag) diag.textContent = text; }

      // Canvas + slime buffer
      let gBlob = null, blobScale = 4;

// Rendering params (tint / size / colon speed) for EXIT animations
let renderTint = {r:255,g:255,b:255,a:255};
let renderRadiusScale = 1.0;
let renderColonSpeed = 1.0;

function updateRenderParams(now){
  // defaults
  renderTint = {r:255,g:255,b:255,a:255};
  renderRadiusScale = 1.0;
  renderColonSpeed = 1.0;

  if (phase === 'EXIT' && exit){
    if (exit.type === '2a'){
      // v0.9.0: ②-a の色を「赤寄り」に調整
      const hotRed = {r:255,g:30,b:60,a:255};
      if (!exit.exploded){
        const u = Math.max(0, Math.min(1, (now - exit.start) / EXIT2A_BUILDUP_MS));
        const k = easeOutQuad(u);
        renderTint = {
          r: Math.round(255 + (hotRed.r - 255) * k),
          g: Math.round(255 + (hotRed.g - 255) * k),
          b: Math.round(255 + (hotRed.b - 255) * k),
          a: 255
        };
        // v0.9.2: さらに控えめに（太さの膨張で画面外に出ないように）
        renderRadiusScale = 1.0 + 1.75 * k;
        // v0.9.0: コロン点滅は「最初は通常 → 徐々に加速」
        const HOLD_FRAC = 0.20;
        const v = Math.max(0, Math.min(1, (u - HOLD_FRAC) / (1 - HOLD_FRAC)));
        renderColonSpeed = 1.0 + 12.0 * easeInQuad(v);
      } else {
        const dt = Math.max(0, now - exit.explodedAt);
        const u = Math.max(0, Math.min(1, dt / EXIT2A_TO_WHITE_MS));
        renderTint = {
          r: 255,
          g: Math.round(hotRed.g + (255 - hotRed.g) * u),
          b: Math.round(hotRed.b + (255 - hotRed.b) * u),
          a: 255
        };
        renderRadiusScale = 1.15;
        // 爆発後は点滅させない（太さ一定）
        renderColonSpeed = 1.0;
      }
    } else if (exit.type === '2b'){
      // v0.8.0: 粒ごとに「崩壊→透明化」を行うので、全体tintのフェードはしない
      renderTint = {r:255,g:255,b:255,a:255};
      renderRadiusScale = 1.0;
      renderColonSpeed = 1.0;
    }
  }

  // v0.10.1: 見失い(=seen=false)の瞬間に、色/太さ/点滅が「パキッ」と戻らないように
  //          seenFactor(1→0) に合わせてデフォルト(白/等倍/等速)へ滑らかに補間する。
  const sf = (typeof seenFactor === 'number') ? seenFactor : (seen ? 1.0 : 0.0);
  const uf = 1.0 - Math.max(0, Math.min(1, sf));
  if (uf > 0.0001){
    renderTint = {
      r: Math.round(renderTint.r + (255 - renderTint.r) * uf),
      g: Math.round(renderTint.g + (255 - renderTint.g) * uf),
      b: Math.round(renderTint.b + (255 - renderTint.b) * uf),
      a: Math.round(renderTint.a + (255 - renderTint.a) * uf)
    };
    renderRadiusScale = renderRadiusScale + (1.0 - renderRadiusScale) * uf;
    renderColonSpeed  = renderColonSpeed  + (1.0 - renderColonSpeed)  * uf;
  }
}


      function resize(){
        p.resizeCanvas(1920, 1080);
        // Decide blob resolution
        const area = p.width * p.height;
        blobScale = Math.max(2, Math.ceil(Math.sqrt(area / MAX_BLOB_PIXELS)));
        const bw = Math.max(64, Math.floor(p.width / blobScale));
        const bh = Math.max(64, Math.floor(p.height / blobScale));
        gBlob = p.createGraphics(bw, bh);
        gBlob.pixelDensity(DPR);
        layoutInitial(); rebuildTargets();
      }

      let fitScale = 1.0;
// Visible screen rectangle in *canvas coordinates* (because canvas is CSS-scaled).
// We treat the device screen edges as the "walls".
let viewRect = { minX: 0, maxX: 1920, minY: 0, maxY: 1080 };

function updateViewRect(){
  const vv = window.visualViewport;
  const vw = vv ? vv.width : window.innerWidth;
  const vh = vv ? vv.height : window.innerHeight;
  // COVER: remove letterbox margins so the walls match the screen edges.
  fitScale = Math.max(vw / 1920, vh / 1080);

  const visW = vw / fitScale;
  const visH = vh / fitScale;

  const cx = 1920 * 0.5;
  const cy = 1080 * 0.5;

  viewRect = {
    minX: cx - visW * 0.5,
    maxX: cx + visW * 0.5,
    minY: cy - visH * 0.5,
    maxY: cy + visH * 0.5
  };

  // Clamp just in case (shouldn't exceed canvas when using COVER)
  viewRect.minX = Math.max(0, viewRect.minX);
  viewRect.maxX = Math.min(1920, viewRect.maxX);
  viewRect.minY = Math.max(0, viewRect.minY);
  viewRect.maxY = Math.min(1080, viewRect.maxY);
}

function applyFitScale(){
  updateViewRect();
  const c = holder.querySelector('canvas');
  if (c){
    c.style.position = 'absolute';
    c.style.left = '50%';
    c.style.top = '50%';
    c.style.transform = `translate(-50%, -50%) scale(${fitScale})`;
    c.style.transformOrigin = 'center center';
  }
}

      p.setup = function(){
        const c = p.createCanvas(1920, 1080); c.parent(holder); applyFitScale();
        window.addEventListener('resize', applyFitScale, {passive:true});
        if (window.visualViewport){ window.visualViewport.addEventListener('resize', applyFitScale, {passive:true}); }
        p.pixelDensity(DPR); p.frameRate(PERF_MODE ? 55 : 60);
        resize();
        const waitFonts = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
        waitFonts.then(()=>{ rebuildTargets(); setTimeout(rebuildTargets, 0); });
        updateDiag('診断: OK / slime-guided');
      };

      function layoutInitial(){
        for (let i=0;i<N;i++){
          const g = (i < HN) ? 0 : (i < HN + MN ? 1 : 2);
          pts[i].x = Math.random()*p.width; pts[i].y = Math.random()*p.height;
          pts[i].vx = pts[i].vy = 0; pts[i].group = g;
          pts[i].activeAt = 0; pts[i].ax = pts[i].x; pts[i].ay = pts[i].y; pts[i].catchUntil = 0;
        }
      }

      // HHMM only (seconds are not displayed)
      function clockString(){
        const d = new Date();
        const pad = n => String(n).padStart(2,'0');
        return pad(d.getHours()) + pad(d.getMinutes());
      }

      // ----- Font-based digits (fill) -----
      function drawFontDigits(g, text, size, cx, cy){
        const ctx = g.drawingContext;
        ctx.save();
        const fam = `'${FONT_FAMILY_LOCAL}', '${FONT_FAMILY_PRIMARY}', sans-serif`;
        ctx.font = `normal ${FONT_WEIGHT} ${size}px ${fam}`;
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
        // Explicit positions/sizes (center-anchored)
        const H_POS = {x:560, y:580}, H_SIZE = 480;
        const M_POS = {x:1360, y:580}, M_SIZE = 480;
        const COLON_POS = {x:960, y:530}, COLON_SIZE = 200;

        // Per-group font weights
        const WEIGHT_HM = 700, WEIGHT_COLON = 100;

        const str = clockString();
        lastTimeStr = str;
        const HH = str.slice(0,2);
        const MM = str.slice(2,4);

        let txH = [], txM = [], txColon = [];
        FONT_WEIGHT = WEIGHT_HM;    fontSize = H_SIZE;     txH = buildTargetsFor(HH, HN, H_POS.x, H_POS.y);
        FONT_WEIGHT = WEIGHT_HM;    fontSize = M_SIZE;     txM = buildTargetsFor(MM, MN, M_POS.x, M_POS.y);
        FONT_WEIGHT = WEIGHT_COLON; fontSize = COLON_SIZE; txColon = buildTargetsFor(':', CN, COLON_POS.x, COLON_POS.y);

        function assign(start, count, targets){
          const len = Math.max(1, targets.length);
          for (let i=0; i<count; i++){
            const idx = start + i;
            const t = targets[i % len];
            pts[idx].tx = t.x;
            pts[idx].ty = t.y;
          }
        }
        assign(0, HN, txH);
        assign(HN, MN, txM);
        assign(HN + MN, CN, txColon);

        guides = txH.concat(txM, txColon);

        // Update bounds for wall collision (EXIT ①-a)
        // 画面端(=壁)に対して「見た目の外形」に近い当たり判定にするため、
        // 文字の guide 点の実測 bounds から計算する。
        const cx0 = p.width * 0.5;
        const cy0 = p.height * 0.5;

        // NOTE:
        // Guide sampling can include a few outlier points (anti-alias / raster noise),
        // which makes the bounds too fat → the clock "hits" the wall early and leaves
        // an unwanted margin, and can squish even when it *looks* like it isn't touching.
        // So we trim a tiny percentile from both ends.
        const xs = [];
        const ys = [];
        for (let i=0; i<guides.length; i++){
          const t = guides[i];
          if (!t) continue;
          xs.push(t.x);
          ys.push(t.y);
        }

        if (xs.length < 8){
          clockBounds = { halfW: 720, halfH: 340 };
        } else {
          xs.sort((a,b)=>a-b);
          ys.sort((a,b)=>a-b);

          const trim = Math.max(0, Math.min(xs.length-1, Math.floor(xs.length * 0.002))); // 0.2%
          const minX = xs[trim];
          const maxX = xs[xs.length - 1 - trim];
          const minY = ys[trim];
          const maxY = ys[ys.length - 1 - trim];

          // ガイド点は中心点なので、描画半径 + blur + 輪郭パス分を少し足す
                    // EXTRA was a bit too conservative and caused early wall hits at large scale.
          const EXTRA = Math.ceil(DISC_RADIUS * 0.85 + BLUR_AMOUNT * 0.40 + 2);
          const halfW = Math.max(cx0 - minX, maxX - cx0) + EXTRA;
          const halfH = Math.max(cy0 - minY, maxY - cy0) + EXTRA;
          clockBounds = { halfW, halfH };
        }
      }

// cached guide points
      let guides = [];
// digit layout bounds (for EXIT1A wall collision)
let clockBounds = { halfW: 720, halfH: 340 };

      
function setPhase(nextPhase){
  phase = nextPhase;
  const phaseEl = document.getElementById('phaseLabel');
  if (phaseEl) phaseEl.textContent = 'Phase: ' + phase;
  const enterEl = document.getElementById('enterLabel');
  if (enterEl) enterEl.textContent = 'Enter: ' + (enterName || '-');
  const exitEl = document.getElementById('exitLabel');
  if (exitEl) exitEl.textContent = 'Exit: ' + (exitName || '-');
}

function clearEnter(){
  enter = null;
  enterName = '-';
  for (let i=0;i<N;i++){
    const a = pts[i];
    a.activeAt = 0;
    a.catchStart = 0;
    a.catchUntil = 0;
    a.catchEase = null;
    // ENTER②-a lag helpers
    a.lagArmed = false;
    a.lagJMul = 1.0;
    a.sx = a.x; a.sy = a.y;
    a.bx = 0; a.by = 0;
  }
}


function clearExit(){
  exit = null;
  exitName = '-';
}

function initExit2BDust(now){
  // さらさら塵：一度ばらけて、下方向へ落ちて消える
  if (!exit) return;
  const cx0 = p.width*0.5, cy0 = p.height*0.5;
  for (let i=0;i<N;i++){
    const a = pts[i];
    // ちょい外側へ + 下へ
    const dx = (a.x - cx0);
    const dy = (a.y - cy0);
    const d = Math.sqrt(dx*dx + dy*dy) + 0.001;
    const nx = dx / d;
    const ny = dy / d;
    const sp = 6 + Math.random()*10;
    a.vx += nx * sp + (Math.random()-0.5) * sp * 0.6;
    a.vy += (ny * sp)*0.3 + 3 + Math.random()*6;
    // 以後はターゲット追従を切るので catch を解除
    a.catchUntil = 0;
  }
  exit.dustStart = now;
}

function startExit(type, now){
  // EXIT開始時は一旦「時刻がある」前提へ寄せる
  rebuildTargets();
  clearEnter();
  clearExit();
  _resetApproachTracker();
  exit = { type, start: now, vanished:false, dust:false, dustStart:0, dustInited:false, exploded:false, explodeAtPlan:0, explodedAt:0, baseSize:(faceMem.base||0.22), tr:{scale:1, ox:0, oy:0, cx:0, cy:0} };
  exitName = type;
  setPhase('EXIT');

  // type-specific init
  if (type === '2a'){
    // schedule explode timing (buildup -> quick shrink -> explode)
    exit.explodeAtPlan = now + EXIT2A_BUILDUP_MS + EXIT2A_SHRINK_MS;
    // v0.9.0: コロンの加速点滅用
    exit.colonPhase = 0;
    exit.colonPhaseAt = now;
  }
  if (type === '2b'){
    exit.vanished = false;
    // v0.8.0: crumble init
    exit.dust = false;
    exit.dustInited = false;
    exit.crumbleInited = true;
    let minY = Infinity, maxY = -Infinity;
    for (let i=0; i<N; i++){
      const a = pts[i];
      a.exit2bBaseTx = (typeof a.tx === 'number') ? a.tx : a.x;
      a.exit2bBaseTy = (typeof a.ty === 'number') ? a.ty : a.y;
      a.exit2bCrumbled = false;
      a.exit2bCrumbledAt = 0;
      a.exit2bAlpha = 255;
      minY = Math.min(minY, a.exit2bBaseTy);
      maxY = Math.max(maxY, a.exit2bBaseTy);
    }
    if (!isFinite(minY) || !isFinite(maxY) || Math.abs(maxY-minY) < 1){
      minY = p.height*0.5 - 220;
      maxY = p.height*0.5 + 220;
    }
    exit.crumbleMinY = minY;
    exit.crumbleMaxY = maxY;
  }
  if (type === '1a'){
    // 発動した瞬間からなめらかに小さく（SHOW=1.0 → EXIT1A_BASE_SCALE へ）
    const cx0 = p.width * 0.5;
    const cy0 = p.height * 0.5;
    exit.tr = { scale: 1.0, ox: 0, oy: 0, sx: 1.0, sy: 1.0, cx: cx0, cy: cy0 };

    // baseline from current face size if available
    if (faceMem.has && faceMem.smooth > 0.0001) exit.baseSize = faceMem.smooth;
  }
}

function startEnterByRule(unseenSec, now){
  // 4秒ルール判定
  if (unseenSec < ENTER_RULE_SEC){
    startEnter('1a', now);
  } else {
    // ②-b/②-c（上下/左右）は削除し、②-b を「多方向ランダム」に統一
    const pool = ['2a','2b'];
    startEnter(pool[Math.floor(Math.random()*pool.length)], now);
  }
}

function startEnter(type, now){
  // いつでも顔検知 → 見失ったら即サボる（= IDLEへ）は draw 側で強制される
  rebuildTargets();
  clearEnter();
  _resetApproachTracker();

  // ENTER 初期化
  enter = { type, start: now, end: now };
  enterName = type;
  setPhase('ENTER');

  // ①-a / ②-a : スクスト（catch-up easing）
  if (type === '1a' || type === '2a'){
    // 全粒子を「スクスト（オーバーシュート）」で数字へ
    for (let i=0;i<N;i++){
      const a = pts[i];
      a.sx = a.x; a.sy = a.y;
      a.activeAt = now;
      a.catchStart = now;
      a.catchUntil = now + CATCHUP_MS;
      a.catchEase = 'overshoot';
      a.lagArmed = false;
      a.lagJMul = 1.0;
    }
    enter.end = now + CATCHUP_MS;

    if (type === '2a'){
      // チーム(H/:/M)を等確率 → 4分割(ru/lu/ld/rd)を等確率 → その領域だけ遅らせる
      // NOTE: ":" グループは遅れが分かりにくいので、遅れ対象チームから除外（H/Mのみ）
      const teams = ['H','M'];
      const team = teams[Math.floor(Math.random()*teams.length)];
      const quads = ['ru','lu','ld','rd'];
      const quad = quads[Math.floor(Math.random()*quads.length)];

      // 各チームの中心（rebuildTargets内の値と一致させる）
      const center = (team==='H') ? {x:560,y:580} :
                                    {x:1360,y:580};

      const start = (team==='H') ? 0 : HN;
      const count = (team==='H') ? HN : MN;

      // クラスターOFF時に、遅れ粒子を「散った」配置で選ぶ（クラスターとの差を見やすく）
      function pickDispersed(pool, n){
        if (n >= pool.length) return pool.slice();

        let minx=Infinity, miny=Infinity, maxx=-Infinity, maxy=-Infinity;
        for (let i=0;i<pool.length;i++){
          const a = pts[pool[i]];
          if (a.tx < minx) minx = a.tx;
          if (a.ty < miny) miny = a.ty;
          if (a.tx > maxx) maxx = a.tx;
          if (a.ty > maxy) maxy = a.ty;
        }
        const diag = Math.hypot(maxx-minx, maxy-miny) + 1e-6;

        const picked = [];
        let minD = diag * 0.35; // 最初は広めに散らす

        // 複数パスで minD を緩めながら埋める
        const cand = pool.slice();
        for (let pass=0; pass<5 && picked.length<n; pass++){
          // shuffle
          for (let i=cand.length-1;i>0;i--){
            const j = Math.floor(Math.random()*(i+1));
            const tmp = cand[i]; cand[i] = cand[j]; cand[j] = tmp;
          }
          const minD2 = minD*minD;
          for (let i=0;i<cand.length && picked.length<n;i++){
            const ii = cand[i];
            const a = pts[ii];
            let ok = true;
            for (let j=0;j<picked.length;j++){
              const b = pts[picked[j]];
              const dx = a.tx - b.tx;
              const dy = a.ty - b.ty;
              if (dx*dx + dy*dy < minD2){ ok = false; break; }
            }
            if (ok) picked.push(ii);
          }
          minD *= 0.65; // だんだん緩める
        }

        // 足りない分はランダムで補完（重複なし）
        if (picked.length < n){
          const set = new Set(picked);
          const rest = pool.filter(ii=>!set.has(ii));
          while (picked.length < n && rest.length > 0){
            const k = Math.floor(Math.random()*rest.length);
            picked.push(rest.splice(k,1)[0]);
          }
        }
        return picked;
      }

      // quadrant判定
      function inQuad(tx,ty){
        const right = tx >= center.x;
        const up    = ty <= center.y;
        if (quad==='ru') return right && up;
        if (quad==='lu') return (!right) && up;
        if (quad==='ld') return (!right) && (!up);
        return right && (!up); // rd
      }

      // 遅れ対象（象限内の“まとまり”だけ遅らせる）
      const cand = [];
      for (let k=0;k<count;k++){
        const ii = start + k;
        const a = pts[ii];
        if (!inQuad(a.tx, a.ty)) continue;
        cand.push(ii);
      }

      // fallback: 象限がスカスカならチーム全体から選ぶ
      let poolIdx = cand;
      if (poolIdx.length < 6){
        poolIdx = [];
        for (let k=0;k<count;k++) poolIdx.push(start+k);
      }

      let picked = poolIdx;

      // cluster: 読みやすい“かたまり”で遅らせる（デフォルトON）
      if (tuneEnter2a.cluster && poolIdx.length > 0){
        const want = Math.max(3, Math.round(poolIdx.length * tuneEnter2a.ratio));
        const lagN = Math.max(1, Math.min(want, poolIdx.length));

        // seed: centerから遠いトップ25%からランダムに選ぶ
        const scored = poolIdx.map(ii=>{
          const a = pts[ii];
          const dx = a.tx - center.x;
          const dy = a.ty - center.y;
          return {ii, d2: dx*dx + dy*dy};
        }).sort((u,v)=>v.d2 - u.d2);

        const top = Math.max(1, Math.round(scored.length * 0.25));
        const seed = scored[Math.floor(Math.random()*top)].ii;
        const s = pts[seed];
        const sx = s.tx, sy = s.ty;

        picked = poolIdx.slice().sort((i1,i2)=>{
          const a = pts[i1], b = pts[i2];
          const da = (a.tx - sx)*(a.tx - sx) + (a.ty - sy)*(a.ty - sy);
          const db = (b.tx - sx)*(b.tx - sx) + (b.ty - sy)*(b.ty - sy);
          return da - db;
        }).slice(0, lagN);
      } else {
        // non-cluster: 量スライダーを反映して、象限内で「散った」選び方にする
        if (poolIdx.length > 0){
          const want = Math.max(3, Math.round(poolIdx.length * tuneEnter2a.ratio));
          const lagN = Math.max(1, Math.min(want, poolIdx.length));
          picked = pickDispersed(poolIdx, lagN);
        }
      }

      for (let idx=0; idx<picked.length; idx++){
        const a = pts[picked[idx]];

        // delay中は液体のまま → その後 easeOutCirc で集合
        a.activeAt = now + tuneEnter2a.delayMs;
        // NOTE:
        // 遅れ粒子は delay 中に位置が動くので、
        // 「動いた後の位置」から集合が始まるように draw 側で sx/sy を再設定する。
        a.lagArmed = true;
        a.lagJMul = 2.2;

        // 少しだけ“置いていかれる”方向へ押し出して、遅れが視覚的に分かるようにする
        {
          const dx0 = a.tx - center.x;
          const dy0 = a.ty - center.y;
          const d0 = Math.sqrt(dx0*dx0 + dy0*dy0) + 1e-6;
          const nx0 = dx0 / d0;
          const ny0 = dy0 / d0;
          const sp = 7.0 + Math.random()*7.0;
          a.vx += nx0 * sp + (Math.random()-0.5) * sp * 0.25;
          a.vy += ny0 * sp + (Math.random()-0.5) * sp * 0.25;
        }

        a.catchStart = a.activeAt;
        a.catchUntil = a.catchStart + CATCHUP_MS;
        a.catchEase = 'outCirc';
      }
      enter.end = now + tuneEnter2a.delayMs + CATCHUP_MS;
    }
    return;
  }

  // ②-b/c/d : バウンド（blobを壁に当てて最後に数字へ）
  startEnterBounce(type, now);
}


function startEnterBounce(type, now){
  // ②-b: 多方向ランダム（壁にぶつかる演出を確実に見せる版）
  // v0.4.6: 先に「ビク！ビク！！ビク！！！」(0.6s)→中心へ戻る(0.1s) を挟んでからバウンド開始
  const cx = p.width*0.5, cy = p.height*0.5;
  const xL = ENTER_WALL_PAD_X, xR = p.width - ENTER_WALL_PAD_X;
  const yT = ENTER_WALL_PAD_Y, yB = p.height - ENTER_WALL_PAD_Y;

  // --- pre-jolt timings ---
  const PRE_SEG_MS = 0.20 * 1000; // 0.2s x 3 = 0.6s
  const PRE_RISE_END = PRE_SEG_MS * 3;
  const PRE_DROP_MS = 0.10 * 1000; // 0.1s (上から中心へ降りる)
  const PRE_TOTAL = PRE_RISE_END + PRE_DROP_MS; // 0.7s

  const yTopNear = yT + 2; // 「壁スレスレ」

  // pre-jolt start position = current centroid ("現在の位置")
  let sx = 0, sy = 0;
  for (let i=0;i<N;i++){
    sx += pts[i].x;
    sy += pts[i].y;
  }
  sx /= Math.max(1, N);
  sy /= Math.max(1, N);
  if (!isFinite(sx)) sx = cx;
  if (!isFinite(sy)) sy = cy;

  // pre-jolt key positions (move up while gathering toward center)
  const x1 = sx + (cx - sx) * 0.33;
  const x2 = sx + (cx - sx) * 0.66;
  // pre-jolt key Y positions: split the distance between center(cy) and top wall (yTopNear) into thirds
  const y1 = cy + (yTopNear - cy) * (1/3);
  const y2 = cy + (yTopNear - cy) * (2/3);

  // v0.4.4: 衝突回数=7回、すべて0.2s間隔で壁に当てる
  const N_HITS = 7;
  const HIT_MS = 0.20 * 1000;
  const MORPH_MS = 0.45 * 1000; // 最後の衝突後に数字へ吸着する時間（衝突回数とは別）

  const durs = Array(N_HITS).fill(HIT_MS);

  function posFor(hit){
    switch(hit){
      case 'T': return {x:cx,y:yT, wall:'T'};
      case 'B': return {x:cx,y:yB, wall:'B'};
      case 'L': return {x:xL,y:cy, wall:'L'};
      case 'R': return {x:xR,y:cy, wall:'R'};
      case 'TL': return {x:xL,y:yT, wall:'TL'};
      case 'TR': return {x:xR,y:yT, wall:'TR'};
      case 'BL': return {x:xL,y:yB, wall:'BL'};
      case 'BR': return {x:xR,y:yB, wall:'BR'};
      default: return {x:cx,y:cy, wall:null};
    }
  }

  // 多方向：反対方向のみへ遷移する制約（画面を横断させる）
  const all = ['T','B','L','R','TL','TR','BL','BR'];
  const opp = {
    'T': ['B','BL','BR'],
    'B': ['T','TL','TR'],
    'L': ['R','TR','BR'],
    'R': ['L','TL','BL'],
    'TL':['B','R','BR'],
    'TR':['B','L','BL'],
    'BL':['T','R','TR'],
    'BR':['T','L','TL'],
  };

  // v0.4.6: 最初の壁1は必ず 上 / 左上 / 右上
  const firstChoices = ['T','TL','TR'];
  let cur = firstChoices[Math.floor(Math.random()*firstChoices.length)];
  const hits = [cur];
  for (let i=1;i<N_HITS;i++){
    const cand = opp[cur] || all;
    cur = cand[Math.floor(Math.random()*cand.length)];
    hits.push(cur);
  }

  // keyframes:
  // pre-jolt: current centroid -> up (0.6s, 3 segments) -> drop to center (0.1s)
  // then: wall hits (N_HITS回) -> (最後の位置で数字へモーフする区間)
  const keys = [
    {t:0, x:sx, y:sy, wall:null},
    {t:PRE_SEG_MS, x:x1, y:y1, wall:null},
    {t:PRE_SEG_MS*2, x:x2, y:y2, wall:null},
    {t:PRE_RISE_END, x:cx, y:yTopNear, wall:null},
    {t:PRE_TOTAL, x:cx, y:cy, wall:null},
  ];

  let acc = PRE_TOTAL;
  for (let i=0;i<hits.length;i++){
    acc += durs[i];
    const pp = posFor(hits[i]);
    keys.push({t:acc, x:pp.x, y:pp.y, wall:pp.wall});
  }

  // ここまでが「衝突（壁ヒット）」
  const lastHitIndex = keys.length-1;
  const tHitEnd = keys[lastHitIndex].t;

  // 最後の衝突後、一定時間その場を基準にして数字へ吸着（centerは動かさない）
  keys.push({t:tHitEnd + MORPH_MS, x:keys[lastHitIndex].x, y:keys[lastHitIndex].y, wall:keys[lastHitIndex].wall});

  const tEnd = keys[keys.length-1].t;
  const tMorphStart = tHitEnd; // 「最後の衝突が終わってから」数字化を開始

  // particle blob offsets
  for (let i=0;i<N;i++){
    const a = pts[i];

    // v0.4.6: pre-jolt 用に「開始時の現在位置」を保存
    a.preOx = a.x;
    a.preOy = a.y;

    const ang = Math.random()*Math.PI*2;
    const rr = Math.sqrt(Math.random()) * ENTER_BLOB_RADIUS;
    a.bx = Math.cos(ang)*rr;
    a.by = Math.sin(ang)*rr;
    a.bseed = Math.random()*9999;

    // --- trailing droplets (v0.7.0) ---
    // ②-b/c/d の移動中、「おしりの後ろに追いついていない液体がちらほら」を作る。
    // 全粒子のうち少数だけ「遅れてついてくる滴」扱いにし、移動方向の逆へオフセット＋遅延追従。
    // morph が進むほど（数字化するほど）効果は自然に消える。
    const rPick = Math.random();
    a.trailType = 0; // 0: none, 1: droplet, 2: stray
    if (rPick < 0.04) a.trailType = 2;
    else if (rPick < 0.13) a.trailType = 1;
    a.trailLag  = (a.trailType === 1) ? (0.86 + Math.random()*0.08)
                 : (a.trailType === 2) ? (0.92 + Math.random()*0.06)
                 : 0;
    a.trailBackMul = (a.trailType === 1) ? (0.95 + Math.random()*0.75)
                    : (a.trailType === 2) ? (1.55 + Math.random()*0.95)
                    : 0;
    a.trailSideMul = (Math.random()-0.5) * ((a.trailType === 2) ? 2.2 : 1.2);
    a.trailSize = (a.trailType === 0) ? 1.0 : (0.50 + Math.random()*0.22);
    a.trailX = undefined;
    a.trailY = undefined;
  }

  // hit見落とし対策の状態（低fpsで壁ヒットが飛ぶのを防ぐ）
  enter = {
    type, start: now, end: now + tEnd, keys, tEnd, tMorphStart,
    xL,xR,yT,yB, cx,cy,
    lastHitIndex,
    _prevT: 0,
    _prevSeg: 0,
    _pendingHits: [],
    _holdUntil: 0,
    _holdKey: -1,

    // v0.4.6: pre-jolt phase markers
    preEnd: PRE_TOTAL,
    preRiseEnd: PRE_RISE_END,
  };
}



// per-frame cache: sampleEnterBounceTarget() は各粒子から呼ばれるので、同じframeでは1回だけ計算する
let _enterSampleCacheNow = -1;
let _enterSampleCacheRes = null;

function sampleEnterBounceTarget(a, nowMs){
  // returns {x,y, wall, vx, vy, morph, u}
  if (_enterSampleCacheNow === nowMs && _enterSampleCacheRes) return _enterSampleCacheRes;

  const t = Math.max(0, nowMs - enter.start);
  const keys = enter.keys;

  // v0.4.6: pre-jolt ("ビク！ビク！！ビク！！！") phase detection + gather factor
  const preEnd = (enter && typeof enter.preEnd === 'number') ? enter.preEnd : 0;
  const isPre = (preEnd > 0 && t < preEnd);

  function easeOutExpo01(x){
    return easeOutExpoParam(x, 10.0, 1.0);
  }

  function preGather(tt){
    if (!isPre) return 1.0;
    const seg = 200;
    const riseEnd = (enter && typeof enter.preRiseEnd === 'number') ? enter.preRiseEnd : 600;
    if (tt <= 0) return 0.0;
    if (tt < seg){
      return (1/3) * easeOutExpo01(tt / seg);
    } else if (tt < seg*2){
      return (1/3) + (1/3) * easeOutExpo01((tt - seg) / seg);
    } else if (tt < riseEnd){
      return (2/3) + (1/3) * easeOutExpo01((tt - seg*2) / seg);
    }
    // pre-rise is finished (including the 0.1s drop): fully gathered
    return 1.0;
  }

  const gather = isPre ? preGather(t) : 1.0;

  // --- 低fpsなどで「壁ヒット」を飛ばさないためのガード ---
  // 区間境界（=壁ヒット）を跨いだら、壁位置を短くホールドして必ず見せる
  function segIndexAt(tt){
    let i = 0;
    while (i < keys.length-1 && tt > keys[i+1].t) i++;
    return i;
  }

  const curSeg = segIndexAt(t);
  const prevSeg = (typeof enter._prevSeg === 'number') ? enter._prevSeg : curSeg;

  if (curSeg > prevSeg){
    if (!enter._pendingHits) enter._pendingHits = [];
    for (let k = prevSeg + 1; k <= curSeg; k++){
      const keyIdx = Math.min(keys.length-1, k); // boundary key index (= hit key)
      if (keyIdx >= 1 && keyIdx <= (enter.lastHitIndex || 0) && keys[keyIdx].wall){
        enter._pendingHits.push(keyIdx);
      }
    }
  }

  enter._prevSeg = curSeg;
  enter._prevT = t;

  const HIT_HOLD_MS = 55;

  // 既にホールド中、またはキューがあれば壁位置でホールド
  if ((enter._holdUntil && nowMs < enter._holdUntil) || (enter._pendingHits && enter._pendingHits.length)){
    if (!(enter._holdUntil && nowMs < enter._holdUntil)){
      const idx = enter._pendingHits.shift();
      if (typeof idx === 'number'){
        enter._holdKey = idx;
        enter._holdUntil = nowMs + HIT_HOLD_MS;
      }
    }

    const idx = enter._holdKey;
    if (typeof idx === 'number' && idx >= 0 && idx < keys.length){
      const k = keys[idx];
      const kPrev = keys[Math.max(0, idx-1)];
      const kNext = keys[Math.min(keys.length-1, idx+1)];
      const segDur = Math.max(1, (kNext.t - kPrev.t));
      const vx = (kNext.x - kPrev.x) / segDur;
      const vy = (kNext.y - kPrev.y) / segDur;

      const morph = (t < enter.tMorphStart) ? 0 : easeOutQuad(Math.min(1, (t - enter.tMorphStart) / Math.max(1, enter.tEnd - enter.tMorphStart)));

      const res = {x:k.x, y:k.y, wall:k.wall, vx, vy, morph, u:1, pre:isPre, gather};
      _enterSampleCacheNow = nowMs;
      _enterSampleCacheRes = res;
      return res;
    } else {
      // safety: cancel hold and continue normally
      enter._holdUntil = 0;
      enter._holdKey = -1;
    }
  }

  // --- normal interpolation ---
  const iSeg = curSeg;
  const k0 = keys[iSeg];
  const k1 = keys[Math.min(keys.length-1, iSeg+1)];
  const segDur = Math.max(1, (k1.t - k0.t));
  const u = Math.max(0, Math.min(1, (t - k0.t) / segDur));
  let eu;
  if (isPre){
    // v0.4.8: 「硬直(0.05s) → 上へビクッ(残り0.15s)」を各0.2s区間に入れる
    const riseEnd = (enter && typeof enter.preRiseEnd === 'number') ? enter.preRiseEnd : 600;
    const HOLD_MS = 50; // 0.05s
    if (t < riseEnd && segDur > (HOLD_MS + 1)){
      const holdU = HOLD_MS / segDur; // 0.25 when segDur=200ms
      if (u <= holdU){
        eu = 0;
      } else {
        const uu = (u - holdU) / Math.max(1e-6, (1 - holdU));
        eu = easeOutExpo01(Math.max(0, Math.min(1, uu)));
      }
    } else {
      // drop(0.1s) and later: plain easeOutExpo
      eu = easeOutExpo01(u);
    }
  } else {
    eu = easeInOutQuad(u);
  }

  const x = k0.x + (k1.x - k0.x) * eu;
  const y = k0.y + (k1.y - k0.y) * eu;

  const vx = (k1.x - k0.x) / segDur;
  const vy = (k1.y - k0.y) / segDur;

  const morph = (t < enter.tMorphStart) ? 0 : easeOutQuad(Math.min(1, (t - enter.tMorphStart) / Math.max(1, enter.tEnd - enter.tMorphStart)));

  const res = {x,y, wall:k1.wall, vx, vy, morph, u, pre:isPre, gather};
  _enterSampleCacheNow = nowMs;
  _enterSampleCacheRes = res;
  return res;
}





      // MediaPipe Face Detector (offline bundle)
      let mpFaceDetector = null;
      let mpInitPromise = null;

      async function initMediaPipeFaceDetector(){
        if (mpFaceDetector) return mpFaceDetector;
        if (mpInitPromise) return mpInitPromise;
        mpInitPromise = (async ()=>{
          updateDiag('診断: MediaPipe 初期化中…');
          // ESM bundle (offline)
          const base = new URL('.', window.location.href);
          const mpUrl = new URL('vendor/mediapipe/vision_bundle.mjs', base).toString();
          const wasmPath = new URL('vendor/mediapipe/wasm', base).toString();
          const modelPath = new URL('vendor/mediapipe/models/blaze_face_short_range.tflite', base).toString();

          const mp = await import(mpUrl);
          const vision = await mp.FilesetResolver.forVisionTasks(wasmPath);
          mpFaceDetector = await mp.FaceDetector.createFromOptions(vision, {
            baseOptions: { modelAssetPath: modelPath },
            runningMode: 'VIDEO',
            minDetectionConfidence: 0.5,
            minSuppressionThreshold: 0.3
          });
          updateDiag('診断: MediaPipe FaceDetector');
          return mpFaceDetector;
        })().catch(err=>{
          console.error(err);
          updateDiag('診断: MediaPipe初期化失敗（ファイル/サーバ/CSP）');
          mpInitPromise = null;
          mpFaceDetector = null;
          throw err;
        });
        return mpInitPromise;
      }

      async function startCamera(){
        try{
          const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:'user', width:{ideal:480}, height:{ideal:360}, frameRate:{ideal:30, max:30}}, audio:false});
          cam.stream=stream; cam.video.srcObject=stream; await cam.video.play();
          cam.enabled=true;
          // プレビュー表示はユーザー操作に従う（デフォルトOFF）
          try{ applyPreviewState(!!cam.preview); }catch(_e){
            if (cam.wrap) cam.wrap.style.display = (cam.preview ? 'block' : 'none');
          }

          cam.api='MediaPipe';
          cam.detector=null;
          cam.face = {has:false,cx:0.5,cy:0.5,size:0.22,w:0,h:0};
          cam.faceAt = 0;
          cam.lastSeenAt = 0;
          cam.noFaceStreak = 0;

          // Hide face box until a face is detected
          if (cam.faceBox) cam.faceBox.style.display = 'none';

          try{
            cam.detector = await initMediaPipeFaceDetector();
            cam.api='MediaPipe';
          }catch(_e){
            cam.detector = null;
            cam.api = 'none';
          }

          // fakeSeen / 旧デバッグUIが存在する場合だけオフにしておく（通常はDOMに無い）
          if (fakeSeen){
            fakeSeen.checked = false;
            try{ fakeSeen.dispatchEvent(new Event('change')); }catch(_e){}
          }
        }catch(e){ console.error(e); updateDiag('診断: カメラ不可（権限/環境）'); }
      }

      // Update face tracking box on the camera preview
      function updateFaceBox(cx, cy, wNorm, hNorm){
        if (!cam.faceBox) return;
        // Square box (use max of w/h) + small margin
        let s = Math.max(wNorm || 0, hNorm || 0) * 1.08;
        if (!isFinite(s) || s <= 0) {
          cam.faceBox.style.display = 'none';
          return;
        }
        s = Math.max(0.02, Math.min(1.0, s));
        let left = (cx - s * 0.5);
        let top  = (cy - s * 0.5);
        left = Math.max(0, Math.min(1 - s, left));
        top  = Math.max(0, Math.min(1 - s, top));
        cam.faceBox.style.left = (left * 100).toFixed(3) + '%';
        cam.faceBox.style.top  = (top  * 100).toFixed(3) + '%';
        cam.faceBox.style.width  = (s * 100).toFixed(3) + '%';
        cam.faceBox.style.height = (s * 100).toFixed(3) + '%';
        cam.faceBox.style.display = 'block';
      }

      function ensureProcCanvas(){
        if (!cam.procCanvas){
          cam.procCanvas = document.createElement('canvas');
          cam.procCtx = cam.procCanvas.getContext('2d', { alpha:false, desynchronized:true });
        }
      }

      // Detect on a processing canvas that matches the *displayed preview* aspect/size.
      // This avoids iOS Safari coordinate drift between detectForVideo() bbox and DOM preview.
      function detectOnPreviewCanvas(now){
        ensureProcCanvas();

        const vr = cam.video ? cam.video.getBoundingClientRect() : null;
        const dpr = window.devicePixelRatio || 1;
        const MAX_SIDE = 512;

        let cw = 0, ch = 0;

        const hasDisp = vr && isFinite(vr.width) && isFinite(vr.height) && vr.width >= 2 && vr.height >= 2;

        if (hasDisp){
          cw = Math.max(2, Math.round(vr.width  * dpr));
          ch = Math.max(2, Math.round(vr.height * dpr));
        } else {
          // Fallback when preview is hidden: use intrinsic video size
          const vw0 = (cam.video && cam.video.videoWidth)  ? cam.video.videoWidth  : 640;
          const vh0 = (cam.video && cam.video.videoHeight) ? cam.video.videoHeight : 480;
          cw = Math.max(2, Math.round(vw0));
          ch = Math.max(2, Math.round(vh0));
        }

        // Cap to keep it light
        const s = Math.min(1, MAX_SIDE / Math.max(cw, ch));
        cw = Math.max(2, Math.round(cw * s));
        ch = Math.max(2, Math.round(ch * s));

        if (cam.procCanvas.width !== cw || cam.procCanvas.height !== ch){
          cam.procCanvas.width = cw;
          cam.procCanvas.height = ch;
        }

        cam.procCtx.setTransform(1,0,0,1,0,0);
        cam.procCtx.drawImage(cam.video, 0, 0, cw, ch);

	        // NOTE:
	        // FaceDetector is initialized with runningMode:'VIDEO'.
	        // In that mode, using detector.detect() may return nothing or throw.
	        // To keep coordinates consistent with our processing canvas,
	        // call detectForVideo() with the *canvas* as the image source.
	        let res = null;
	        if (cam.detector && typeof cam.detector.detectForVideo === 'function'){
	          res = cam.detector.detectForVideo(cam.procCanvas, now);
	        } else if (cam.detector && typeof cam.detector.detect === 'function'){
	          // Fallback for IMAGE mode
	          res = cam.detector.detect(cam.procCanvas);
	        }
        return { res, vw: cw, vh: ch };
      }

      function runDetection(now){
        if (!cam.enabled) return;
        if (now - (cam.lastDetectAt||0) < DETECT_MIN_INTERVAL_MS) return;
        cam.lastDetectAt = now;

        if (cam.api==='MediaPipe' && cam.detector){
          try{
            const { res, vw, vh } = detectOnPreviewCanvas(now);
            const faces = (res && Array.isArray(res.detections)) ? res.detections : [];
            if (faces.length>0){
              cam.noFaceStreak = 0;
              cam.lastSeenAt = now;

              // pick largest face
              let best = faces[0];
              for (let i=1;i<faces.length;i++){
                const b = faces[i].boundingBox; const bb = best.boundingBox;
                if (b && bb && (b.width*b.height > bb.width*bb.height)) best = faces[i];
              }

              const bb = best.boundingBox;
              if (bb && vw>1 && vh>1){
                const cxRaw = (bb.originX + bb.width*0.5) / vw;
                const cyRaw = (bb.originY + bb.height*0.5) / vh;

                // previewは左右反転して表示しているので、操作感を合わせてXを反転
                const cx = 1.0 - cxRaw;
                const cy = cyRaw;

                const wNorm = Math.max(0.00001, bb.width / vw);
                const hNorm = Math.max(0.00001, bb.height / vh);
                const size = Math.max(0.00001, (bb.width * bb.height) / (vw * vh));
                cam.face = {has:true, cx, cy, size, w:wNorm, h:hNorm};
                cam.faceAt = now;

                // Update preview overlay (green square)
                updateFaceBoxFromBB(bb, vw, vh);
              } else {
                cam.noFaceStreak = (cam.noFaceStreak||0) + 1;
              cam.face.has = false;
                if (cam.faceBox) cam.faceBox.style.display = 'none';
                cam._faceBoxSmooth = null;
              }
            } else {
              cam.face.has = false;
              if (cam.faceBox) cam.faceBox.style.display = 'none';
                cam._faceBoxSmooth = null;
            }
          }catch(_e){
	            // If MediaPipe throws (often due to runningMode mismatch or source type), log it.
	            console.error('[FaceDetect]', _e);
            cam.noFaceStreak = (cam.noFaceStreak||0) + 1;
            cam.face.has = false;
            if (cam.faceBox) cam.faceBox.style.display = 'none';
                cam._faceBoxSmooth = null;
          }
        } else {
          cam.noFaceStreak = (cam.noFaceStreak||0) + 1;
          cam.face.has = false;
          if (cam.faceBox) cam.faceBox.style.display = 'none';
                cam._faceBoxSmooth = null;
        }
      }

// Face helpers (EXIT①-a)
function getFaceNow(now){
  // Camera face (MediaPipe) has priority
  if (cam.enabled && cam.face && cam.face.has && (now - (cam.faceAt||0) < 400)){
    return cam.face;
  }
  // Simulation sliders (when camera off)
  if (!cam.enabled){
    return {has:true, cx:simFace.x, cy:simFace.y, size:simFace.size};
  }
  return {has:false, cx:0.5, cy:0.5, size:0.22};
}

function updateFaceMemFrom(face){
  if (face && face.has){
    const s = Math.max(0.00001, face.size || 0.00001);
    if (!faceMem.has){
      faceMem.has = true;
      faceMem.cx = face.cx; faceMem.cy = face.cy;
      faceMem.size = s;
      faceMem.smooth = s;
      faceMem.base = s;
    } else {
      faceMem.cx = face.cx; faceMem.cy = face.cy;
      faceMem.size = s;
      faceMem.smooth = faceMem.smooth * 0.85 + s * 0.15;
      // baseline follows "smaller" slowly (so approach can be detected again)
      if (faceMem.smooth < faceMem.base) faceMem.base = faceMem.base * 0.98 + faceMem.smooth * 0.02;
    }
  } else {
    faceMem.has = false;
  }
}



// v0.5.0: helpers for rapid-approach trigger & stable-hold detection
function _distN(x1,y1,x2,y2){
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx*dx + dy*dy);
}

function _updateApproachTracker(now){
  if (!seen || !faceMem.has){
    _resetApproachTracker();
    return;
  }
  _approachBuf.push({t: now, size: faceMem.smooth, cx: faceMem.cx, cy: faceMem.cy});
  const cutoff = now - EXIT1A_APPROACH_WINDOW_MS;
  while (_approachBuf.length && _approachBuf[0].t < cutoff){
    _approachBuf.shift();
  }
}

function _shouldTriggerExit1aRapidApproach(now){
  // "急速に近づいた" 判定（誤爆対策強化）
  if (_lastApproachAt > 0 && (now - _lastApproachAt) < EXIT1A_APPROACH_COOLDOWN_MS) return false;
  if (_approachBuf.length < 5) return false; // 100ms窓で最低限のサンプルが欲しい（60fps想定）

  const n = _approachBuf.length;
  const k = Math.max(2, Math.min(6, Math.floor(n * 0.2))); // 先頭/末尾を2〜6点で平均

  // 平均（先頭k点 / 末尾k点）
  let fS=0, fX=0, fY=0, lS=0, lX=0, lY=0;
  for (let i=0;i<k;i++){
    const a=_approachBuf[i];
    const b=_approachBuf[n-1-i];
    fS += a.size; fX += a.cx; fY += a.cy;
    lS += b.size; lX += b.cx; lY += b.cy;
  }
  const firstSize = fS / k;
  const lastSize  = lS / k;
  const firstCx = fX / k, firstCy = fY / k;
  const lastCx  = lX / k, lastCy  = lY / k;

  const firstT = _approachBuf[0].t;
  const lastT  = _approachBuf[n-1].t;
  const dt = Math.max(0.001, (lastT - firstT) / 1000);

  const ratio = lastSize / Math.max(0.000001, firstSize);
  const dSize = lastSize - firstSize;
  const rate  = dSize / dt;

  const move = _distN(firstCx, firstCy, lastCx, lastCy);
  const movedALot = move > EXIT1A_APPROACH_MOVE_THRESH;

  // 増加が「優勢」か（小さな上下ノイズを弾く）
  const EPS = 0.0006;
  let pos=0, neg=0;
  for (let i=1;i<n;i++){
    const ds = _approachBuf[i].size - _approachBuf[i-1].size;
    if (ds > EPS) pos++;
    else if (ds < -EPS) neg++;
  }
  const strong = pos + neg;
  const dominance = strong > 0 ? (pos / strong) : 0;
  const domOK = (strong >= 2) && (dominance >= 0.65);

  const approachBasic = (ratio >= EXIT1A_APPROACH_RATIO) &&
                        (dSize >= EXIT1A_APPROACH_MIN_DSIZE || rate >= EXIT1A_APPROACH_MIN_RATE) &&
                        domOK;
  if (!approachBasic) return false;

  // 大きく移動しただけ（中心だけ動く）っぽいケースは、さらに面積増加を要求
  if (movedALot && ratio < (EXIT1A_APPROACH_RATIO + EXIT1A_APPROACH_MOVE_EXTRA_RATIO)) return false;

  _lastApproachAt = now;
  return true;
}

function _isHoldStableReady(now){
  // EXIT①-a（後ずさり）中：顔サイズは無視。位置が「だいたい止まってる」状態が4秒続いたらOK。
  if (!faceMem.has){
    _holdPrev = null;
    _holdStableSince = null;
    _holdBuf = [];
    _holdUnstableSince = null;
    return false;
  }

  const cur = {t: now, cx: faceMem.cx, cy: faceMem.cy, size: faceMem.smooth};

  // サンプルを溜める（直近 EXIT1A_HOLD_DRIFT_WINDOW_MS だけ保持）
  _holdBuf.push(cur);
  const cutoff = now - EXIT1A_HOLD_DRIFT_WINDOW_MS;
  while (_holdBuf.length && _holdBuf[0].t < cutoff){
    _holdBuf.shift();
  }

  // バッファの重心からの最大距離（= どれくらいブレたか）
  let sumx = 0, sumy = 0;
  for (let i=0;i<_holdBuf.length;i++){
    sumx += _holdBuf[i].cx;
    sumy += _holdBuf[i].cy;
  }
  const cx0 = sumx / Math.max(1, _holdBuf.length);
  const cy0 = sumy / Math.max(1, _holdBuf.length);

  let maxD = 0;
  for (let i=0;i<_holdBuf.length;i++){
    const d = _distN(_holdBuf[i].cx, _holdBuf[i].cy, cx0, cy0);
    if (d > maxD) maxD = d;
  }

  const stableNow = (maxD <= EXIT1A_HOLD_MAX_DRIFT_N);

  if (stableNow){
    _holdUnstableSince = null;
    if (_holdStableSince === null) _holdStableSince = now;
  } else {
    // 一瞬のブレは見逃す（grace）
    if (_holdUnstableSince === null) _holdUnstableSince = now;
    if ((now - _holdUnstableSince) >= EXIT1A_HOLD_UNSTABLE_GRACE_MS){
      _holdStableSince = null;
      // ここまでズレ続けたら、安定判定をやり直す（過去のズレを引きずらない）
      _holdBuf = [cur];
    }
  }

  _holdPrev = cur;
  return (_holdStableSince !== null) && ((now - _holdStableSince) >= EXIT1A_HOLD_STABLE_MS);
}
function updateExitBackoffTransform(){
  if (!(phase === 'EXIT' && exit && exit.type === '1a')) return;

  const cx0 = p.width * 0.5;
  const cy0 = p.height * 0.5;

  const now = performance.now();
  const tE = Math.max(0, now - exit.start);

  const ratio = (faceMem.has && exit.baseSize>0.00001) ? (faceMem.smooth / exit.baseSize) : 1.0;

  // depth: always move (even when ratio≈1), closer -> stronger
  let depth = 0.65 + (ratio - 1.0) * 0.85;
  depth = Math.max(0.35, Math.min(1.6, depth));

  // scale: closer -> smaller / farther -> larger
  let distScale = 1.0 / (1.0 + (ratio - 1.0) * 0.9);
  distScale = Math.max(0.20, Math.min(4.50, distScale));

  // base shrink: 1.0 -> EXIT1A_BASE_SCALE (eased)
  const u = Math.max(0, Math.min(1, tE / EXIT1A_SHRINK_MS));
  const easeOutCubic = 1 - Math.pow(1 - u, 3);
  const baseShrink = 1.0 + (EXIT1A_BASE_SCALE - 1.0) * easeOutCubic;

  let scale = distScale * baseShrink;
  scale = Math.max(0.18, Math.min(EXIT1A_SCALE_MAX, scale));

  
// position: opposite direction to face move
const nx = (faceMem.cx - 0.5) * 2.0; // -1..1
const ny = (faceMem.cy - 0.5) * 2.0;

// bounds (based on digit layout)
const b = clockBounds || {halfW:720, halfH:340};

// "Walls" are the device screen edges (visible screen rect in canvas coords).
const wall = viewRect || { minX: 0, maxX: p.width, minY: 0, maxY: p.height };
const pad = EXIT1A_WALL_PAD;

const wallMinX = wall.minX + pad, wallMaxX = wall.maxX - pad;
const wallMinY = wall.minY + pad, wallMaxY = wall.maxY - pad;
const wallW = Math.max(1e-6, wallMaxX - wallMinX);
const wallH = Math.max(1e-6, wallMaxY - wallMinY);

const maxShiftX = wallW * 0.5;
const maxShiftY = wallH * 0.5;

function clampCenterToWall(x, half, min, max){
  const W = max - min;
  if (half * 2 <= W){
    return Math.max(min + half, Math.min(max - half, x));
  }
  // too big to fit → press to the nearer wall (allow center to go outside)
  const mid = (min + max) * 0.5;
  return (x < mid) ? (min + half) : (max - half);
}

// desired move (allow a bit of overshoot for "押し付け" → squish)
const desiredX = cx0 + (-nx) * maxShiftX * depth * EXIT1A_OVERSHOOT;
const desiredY = cy0 + (-ny) * maxShiftY * depth * EXIT1A_OVERSHOOT;

// 1st pass: clamp with unsquished bounds
let halfW = b.halfW * scale;
let halfH = b.halfH * scale;

let clampedX = clampCenterToWall(desiredX, halfW, wallMinX, wallMaxX);
let clampedY = clampCenterToWall(desiredY, halfH, wallMinY, wallMaxY);

const penX = desiredX - clampedX;
const penY = desiredY - clampedY;

// hit test (using current extents)
const EPS = 0.75;
const left   = clampedX - halfW;
const right  = clampedX + halfW;
const top    = clampedY - halfH;
const bottom = clampedY + halfH;

const hitX = (left <= wallMinX + EPS) || (right >= wallMaxX - EPS) || (Math.abs(penX) > 0.0001);
const hitY = (top  <= wallMinY + EPS) || (bottom>= wallMaxY - EPS) || (Math.abs(penY) > 0.0001);

// squish strength
let kx = 0.0, ky = 0.0;
if (Math.abs(penX) > 0.0001){
  kx = Math.max(kx, Math.max(0, Math.min(1, Math.abs(penX) / (halfW * 0.40 + 1e-6))));
}
if (Math.abs(penY) > 0.0001){
  ky = Math.max(ky, Math.max(0, Math.min(1, Math.abs(penY) / (halfH * 0.40 + 1e-6))));
}
// “当たったら必ずグチャ”の最低保証
if (hitX) kx = Math.max(kx, 0.75);
if (hitY) ky = Math.max(ky, 0.75);

let sx = 1.0, sy = 1.0;
if (kx > 0.0001){
  sx *= (1.0 - EXIT1A_SQUISH_COMPRESS * kx);
  sy *= (1.0 + EXIT1A_SQUISH_EXPAND   * kx);
}
if (ky > 0.0001){
  sy *= (1.0 - EXIT1A_SQUISH_COMPRESS * ky);
  sx *= (1.0 + EXIT1A_SQUISH_EXPAND   * ky);
}
// 伸びすぎ抑制（特に大きい時に縦長化しやすいのを止める）
sx = Math.min(sx, EXIT1A_SQUISH_STRETCH_MAX);
sy = Math.min(sy, EXIT1A_SQUISH_STRETCH_MAX);

// 2nd pass: re-clamp using *squished* extents so it doesn't leave a gap to the wall
const halfW2 = b.halfW * scale * (sx || 1);
const halfH2 = b.halfH * scale * (sy || 1);
clampedX = clampCenterToWall(desiredX, halfW2, wallMinX, wallMaxX);
clampedY = clampCenterToWall(desiredY, halfH2, wallMinY, wallMaxY);

const oxT = clampedX - cx0;

  const oyT = clampedY - cy0;

  // smooth
  if (!exit.tr) exit.tr = {scale:1, ox:0, oy:0, sx:1, sy:1, cx:cx0, cy:cy0};
  exit.tr.scale = exit.tr.scale * 0.82 + scale * 0.18;
  exit.tr.ox = exit.tr.ox * 0.78 + oxT * 0.22;
  exit.tr.oy = exit.tr.oy * 0.78 + oyT * 0.22;
  exit.tr.sx = exit.tr.sx * 0.80 + sx * 0.20;
  exit.tr.sy = exit.tr.sy * 0.80 + sy * 0.20;
  exit.tr.cx = cx0;
  exit.tr.cy = cy0;
}


      
function drawSlime(){
        if (!gBlob) return;

        // EXIT②-b（透明→消滅）: 上からサラサラ崩壊した粒は液体レンダリングから除外し、別で点描画
        const isExit2b = (phase === 'EXIT' && exit && exit.type === '2b');
        const now = performance.now();
        const tE2b = (isExit2b && exit) ? Math.max(0, now - exit.start) : 0;
        const crumbleActive = isExit2b && (tE2b >= EXIT2B_CRUMBLE_DELAY_MS);

        gBlob.push();
        gBlob.blendMode(gBlob.BLEND);
        gBlob.background(0);
        gBlob.blendMode(gBlob.ADD);
        gBlob.noStroke();

        // EXIT①-a のスケールに合わせて、液体（DISC/BLUR）も比例スケールさせる
        let liquidScale = 1.0;
        if (phase === 'EXIT' && exit && exit.type === '1a' && exit.tr && typeof exit.tr.scale === 'number'){
          liquidScale = Math.max(0.10, Math.min(4.0, exit.tr.scale));
        }
        // ENTER②-b pre-jolt: 0.05sだけ「太さ一瞬UP」を各0.2s区間で同期
        let enterPulse = 1.0;
        if (phase === 'ENTER' && enter && enter.type === '2b'){
          const tt = Math.max(0, now - enter.start);
          const riseEnd = (enter && typeof enter.preRiseEnd === 'number') ? enter.preRiseEnd : 600;
          const SEG_MS = 200;
          const HOLD_MS = 50;
          if (tt < riseEnd){
            const inSeg = tt % SEG_MS;
            if (inSeg < HOLD_MS){
              const x = Math.max(0, Math.min(1, inSeg / HOLD_MS));
              // 0→1で急に戻る（硬直の間に“ビクッ”）
              const pulse01 = 1.0 - easeOutExpoParam(x, 10.0, 1.0);
              enterPulse = 1.0 + 0.22 * pulse01;
            }
          }
        }
        const r = DISC_RADIUS * renderRadiusScale * liquidScale * enterPulse;
        const BASE_ALPHA = 22;
        // Colon thickness modulation (":")
        // 細くなる最小スケール（かなり細め）
        const COLON_THIN_SCALE = 0.28;

        let colonScale = 1.0;
        const sfVis = (typeof seenFactor === 'number') ? Math.max(0, Math.min(1, seenFactor)) : (seen ? 1.0 : 0.0);
        const ufVis = 1.0 - sfVis;

        // v0.10.1: EXIT②-b中に見失ったら、砂点→液体がパキッと切り替わらないように
        //          crumbled粒を seenFactor(sfVis) でクロスフェードする。
        //          1.0=砂点, 0.0=液体へ復帰
        const crumbleBlend = isExit2b ? sfVis : 0.0;


        // v0.9.0: EXIT②-a は「元の偶奇点滅」を使わず、徐々に加速するチカチカへ。
        //         爆発後は点滅を完全に止める。
        const isExit2a = (phase === 'EXIT' && exit && exit.type === '2a');
        if (isExit2a){
          if (exit.exploded){
            colonScale = 1.0;
          } else {
            if (typeof exit.colonPhase !== 'number') exit.colonPhase = 0;
            const lastAt = (typeof exit.colonPhaseAt === 'number') ? exit.colonPhaseAt : now;
            const dtSec = Math.max(0, Math.min(0.05, (now - lastAt) / 1000));
            exit.colonPhaseAt = now;

            const spd = Math.max(0.01, renderColonSpeed || 1.0); // 1.0 → 徐々に加速
            exit.colonPhase += dtSec * p.TWO_PI * spd;

            // 0..1 のなめらかな点滅
            const wave = 0.5 - 0.5 * Math.cos(exit.colonPhase);
            colonScale = COLON_THIN_SCALE + (1 - COLON_THIN_SCALE) * wave;
          }
          // 見失い時は点滅をじわっと停止
          colonScale = colonScale * sfVis + 1.0 * ufVis;
        } else {
          // 通常のコロン点滅（偶数/奇数秒）
          if (sfVis > 0.0001){
            const nowD = new Date();
            const base = nowD.getSeconds() + nowD.getMilliseconds()/1000;
            const spd = Math.max(0.01, renderColonSpeed || 1.0);
            const tt = base * spd;
            const sec = Math.floor(tt);
            const u = tt - sec; // 0..1 within this cycle

            const easeOut = 1 - Math.pow(1 - u, 5); // easeOutQuint
            if (sec % 2 === 0){
              colonScale = COLON_THIN_SCALE + (1 - COLON_THIN_SCALE) * easeOut;
            } else {
              colonScale = 1 - (1 - COLON_THIN_SCALE) * easeOut;
            }
          }
          // 見失い時は点滅をじわっと停止
          colonScale = colonScale * sfVis + 1.0 * ufVis;
        }

        const colonR = r * colonScale;
        const colonAlpha = BASE_ALPHA;

        const OUTLINE_SCALE = 1.45;
        const OUTLINE_ALPHA = BASE_ALPHA * 0.35;

        const B_H = RENDER_BUDGET_H, B_M = RENDER_BUDGET_M, B_C = RENDER_BUDGET_C;
        const sH = Math.max(1, Math.floor(HN / B_H));
        const sM = Math.max(1, Math.floor(MN / B_M));
        const sC = Math.max(1, Math.floor(CN / B_C));

        for (let i=0;i<HN;i+=sH){
          const a = pts[i];
          let aAlpha = BASE_ALPHA;
          if (isExit2b && a.exit2bCrumbled){
            aAlpha = BASE_ALPHA * (1.0 - crumbleBlend);
            if (aAlpha <= 0.05) continue;
          }
          gBlob.fill(255, aAlpha);
          gBlob.circle(a.x/blobScale, a.y/blobScale, r*2);
        }
        for (let i=HN;i<HN+MN;i+=sM){
          const a = pts[i];
          let aAlpha = BASE_ALPHA;
          if (isExit2b && a.exit2bCrumbled){
            aAlpha = BASE_ALPHA * (1.0 - crumbleBlend);
            if (aAlpha <= 0.05) continue;
          }
          gBlob.fill(255, aAlpha);
          gBlob.circle(a.x/blobScale, a.y/blobScale, r*2);
        }
        for (let i=HN+MN;i<N;i+=sC){
          const a = pts[i];
          let aAlpha = colonAlpha;
          if (isExit2b && a.exit2bCrumbled){
            aAlpha = colonAlpha * (1.0 - crumbleBlend);
            if (aAlpha <= 0.05) continue;
          }
          gBlob.fill(255, aAlpha);
          gBlob.circle(a.x/blobScale, a.y/blobScale, colonR*2);
        }
        
        // Extra wide, faint pass just for H & M to smooth their outlines
        if (ENABLE_OUTLINE_PASS){
        for (let i=0;i<HN;i+=sH){
          const a = pts[i];
          let aAlpha = OUTLINE_ALPHA;
          if (isExit2b && a.exit2bCrumbled){
            aAlpha = OUTLINE_ALPHA * (1.0 - crumbleBlend);
            if (aAlpha <= 0.05) continue;
          }
          gBlob.fill(255, aAlpha);
          gBlob.circle(a.x/blobScale, a.y/blobScale, r*OUTLINE_SCALE*2);
        }
        for (let i=HN;i<HN+MN;i+=sM){
          const a = pts[i];
          let aAlpha = OUTLINE_ALPHA;
          if (isExit2b && a.exit2bCrumbled){
            aAlpha = OUTLINE_ALPHA * (1.0 - crumbleBlend);
            if (aAlpha <= 0.05) continue;
          }
          gBlob.fill(255, aAlpha);
          gBlob.circle(a.x/blobScale, a.y/blobScale, r*OUTLINE_SCALE*2);
        }
        }

        const gr = Math.max(1, Math.floor(DISC_RADIUS*0.5*liquidScale));
        const GUIDE_STRIDE = GUIDE_STRIDE_BASE, GUIDE_ALPHA = 8;
        // 崩壊が始まったらガイド点は消す（残ると輪郭が出続けてしまう）
        if (!crumbleActive){
          gBlob.fill(255, GUIDE_ALPHA);
          for (let gi=0; gi<guides.length; gi+=GUIDE_STRIDE){
            const t = guides[gi];
            gBlob.circle(t.x/blobScale, t.y/blobScale, gr*2);
          }
        }

        gBlob.pop();
        try { gBlob.filter(p.BLUR, Math.max(0.5, Math.min(8.0, BLUR_AMOUNT * liquidScale))); } catch(e){}
        try { gBlob.filter(p.THRESHOLD, THRESH_LEVEL); } catch(e){ gBlob.filter(p.THRESHOLD); }
        p.push();
        p.tint(renderTint.r, renderTint.g, renderTint.b, renderTint.a);
        p.image(gBlob, 0, 0, p.width, p.height);
        // EXIT②-b: 崩壊した粒を「サラサラ点」として別描画（液体から粒子へ）
        if (isExit2b){
          p.push();
          p.noStroke();
          if (crumbleBlend > 0.01){
          for (let i=0;i<N;i++){
            const a = pts[i];
            if (!a.exit2bCrumbled) continue;
            const alpha0 = Math.max(0, Math.min(255, (typeof a.exit2bAlpha === 'number') ? a.exit2bAlpha : 255));
            const alpha = alpha0 * crumbleBlend;
            if (alpha <= 0) continue;
            // ちょいランダムな点滅で「さらさら感」
            if ((i % 3) !== 0 && Math.random() < 0.55) continue;
            const k = alpha / 255;
            // v0.8.1: サラサラ粒を少し大きく
            const sz = 3.6 * (0.35 + 0.65 * k);
            p.fill(255, Math.round(alpha));
            p.circle(a.x, a.y, sz);
          }
          }
          p.pop();
        }
        p.pop();
      }


      p.draw = function(){
        frames++; const now=performance.now();
        if (now-lastFPSTime>=500){ lastFPS=Math.round(frames*1000/(now-lastFPSTime)); frames=0; lastFPSTime=now; }

        if (cam.enabled) runDetection(now);
        const camSeen = cam.enabled ? ((now-cam.lastSeenAt<=SEEN_DEBOUNCE_MS) && ((cam.noFaceStreak||0) < LOST_CONFIRM_STREAK)) : false;
        const effectiveSeen = cam.enabled ? camSeen : seen;
        seen = effectiveSeen;

// Update face metrics
const faceNow = getFaceNow(now);
updateFaceMemFrom(faceNow);
  _updateApproachTracker(now);

        
// Rising / Falling edge + manual test
if (manualExitRequest){
  const req = manualExitRequest;
  manualExitRequest = null;
  unseenStart = null;
  // 手動EXITは「一旦時刻表示がある」前提で開始
  showStart = now - EXIT_RULE_SHOW_MS;
  startExit(req.type, now);
  prevSeen = true;
} else if (manualEnterRequest){
  // 手動テスト：UIからENTERを直接叩く
  const req = manualEnterRequest;
  manualEnterRequest = null;

  // unseen 秒を擬似的に与える
  if (req.type === 'AUTO'){
    const sec = Math.max(0, Number(req.unseenSec || 0));
    unseenStart = now - sec*1000;
    startEnterByRule(sec, now);
  } else {
    unseenStart = null;
    startEnter(req.type, now);
  }
  prevSeen = true;
} else {
  if (!prevSeen && seen){
    // 見られるようになった瞬間：4秒ルールで ENTER を決める
    let unseenSec = 0;
    if (unseenStart !== null) unseenSec = (now - unseenStart) * 0.001;
    unseenStart = null;
    clearExit();
    showStart = null;
    startEnterByRule(unseenSec, now);
  }
  if (prevSeen && !seen){
    // 見られなくなった瞬間：パキッと切らず、じわっとサボりへ
    startSoftLost(now);
    if (unseenStart === null) unseenStart = now;
  }
  prevSeen = seen;
}

// Update soft transition / seenFactor (and finalize to IDLE when finished)
updateSoftLost(now);


        // 「見られていない時間」タイマー表示
        {
          const timerEl = document.getElementById('notSeenTimer');
          if (timerEl){
            if (!seen){
              if (unseenStart === null) unseenStart = now;
              const elapsedSec = (now - unseenStart) * 0.001;
              timerEl.textContent = '見られていない時間: ' + elapsedSec.toFixed(1) + 's';
            } else {
              timerEl.textContent = '見られていない時間: 0.0s';
            }
          }
        }

        p.background(0);
        const nowStr=clockString(); if (seen && nowStr!==lastTimeStr && (phase==='SHOW' || phase==='ENTER' || (phase==='EXIT' && exit && exit.type==='1a'))) rebuildTargets();
// ENTER 終了判定
if (seen && phase === 'ENTER' && enter && (now >= enter.end)){
  // 数字の安定状態へ
  enter = null;
  showStart = now;
  if (faceMem.has) faceMem.base = faceMem.smooth;
  setPhase('SHOW');
}
// NOTE: 見失い時の強制IDLEは updateSoftLost() が担当（スムーズに切り替えるため）



        
// EXIT triggers + per-frame updates
if (seen){
  const earlyWindow = (phase === 'ENTER') || (phase === 'SHOW' && showStart !== null && (now - showStart < EXIT_RULE_SHOW_MS));
  if (!exit && earlyWindow && faceMem.has && _shouldTriggerExit1aRapidApproach(now)){
    startExit('1a', now);
  }
  if (!exit && phase === 'SHOW' && showStart !== null && (now - showStart >= EXIT_RULE_SHOW_MS)){
    // ②-a / ②-b を等確率で
    startExit((Math.random() < 0.5) ? '2a' : '2b', now);
  }
}

// ②-a 爆発の瞬間を作る（1回だけ）
if (phase === 'EXIT' && exit && exit.type === '2a' && !exit.exploded && now >= (exit.explodeAtPlan||0)){
  exit.exploded = true;
  exit.explodedAt = now;

  const cx0 = p.width * 0.5;
  const cy0 = p.height * 0.5;

  for (let i=0;i<N;i++){
    const a = pts[i];
    const dx = ((typeof a.tx==='number')?a.tx:a.x) - cx0;
    const dy = ((typeof a.ty==='number')?a.ty:a.y) - cy0;
    const d = Math.sqrt(dx*dx + dy*dy) + 0.001;
    const nx = dx / d;
    const ny = dy / d;
    const sp = EXIT2A_EXPLODE_SPEED * (0.6 + Math.random()*0.8);
    a.vx += nx * sp + (Math.random()-0.5) * sp * 0.35;
    a.vy += ny * sp + (Math.random()-0.5) * sp * 0.35;
    a.catchUntil = 0;
  }
}

// EXIT①-a backoff transform update
updateExitBackoffTransform();

// v0.5.2: EXIT①-a（後ずさり）中でも、顔サイズに関係なく「ほぼ停止して4秒見続けたら」『見続けたら（②-a/②-b）』へ移行
if (seen && phase === 'EXIT' && exit && exit.type === '1a'){
  if (_isHoldStableReady(now)){
    const next = (Math.random() < 0.5) ? '2a' : '2b';
    startExit(next, now);
  }
} else {
  _holdPrev = null;
  _holdStableSince = null;
  _holdBuf = [];
  _holdUnstableSince = null;
}

// Rendering params update
updateRenderParams(now);

// v0.10.1: 物理も「見失い時にパキッと」切り替えず、seenFactor(1→0)で滑らかにIDLEへ。
const sfNow = (typeof seenFactor === 'number') ? Math.max(0, Math.min(1, seenFactor)) : (seen ? 1.0 : 0.0);
const ufNow = 1.0 - sfNow;

// Physics step
        for (let i=0;i<N;i++){
          const a=pts[i];
          
if (sfNow > 0.0001){
  // ENTER中はウォブルを抑えて、動きの読みやすさを優先
  if (now < a.activeAt){
    // 遅延中（②-a の遅れパートなど）：液体のままふわふわ
    const jm = (a.lagArmed && a.lagJMul) ? a.lagJMul : 1.0;
    // seenFactor が落ちるほど、通常のサボりジッタへ寄せる
    const jmul = jm * sfNow + ufNow;
    a.vx=(a.vx+(Math.random()-0.5)*IDLE_JITTER*jmul)*0.98;
    a.vy=(a.vy+(Math.random()-0.5)*IDLE_JITTER*jmul)*0.98;
  } else {
    // ②-a の遅れ粒子：delay中に動いた位置から集合を開始させる
    if (a.lagArmed){
      a.lagArmed = false;
      a.lagJMul = 1.0;
      a.sx = a.x;
      a.sy = a.y;
      a.catchStart = now;
      a.catchUntil = now + CATCHUP_MS;
      a.catchEase = (a.catchEase === 'outCirc') ? 'outCirc' : a.catchEase;
    }
    const tSec = now * 0.001;
    const baseHz = WOBBLE_BASE_HZ;
    const jitterAmp = WOBBLE_JITTER_HZ;
    const phaseOff = i * 0.37;
    const h = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    const frac = h - Math.floor(h);
    const j = (frac - 0.5) * 2.0;
    const freqX = baseHz + j * jitterAmp * 0.15;
    const freqY = baseHz * 1.3 + j * jitterAmp * 0.11;

    let targetX = a.tx;
    let targetY = a.ty;

    // ②-b：多方向ランダム バウンド中は blob ターゲットを追う
    const isBounceEnter = (phase === 'ENTER') && enter && (enter.type === '2b');
    if (isBounceEnter){
      const samp = sampleEnterBounceTarget(a, now);

      // direction basis (velocity)
      let ux = 1, uy = 0;
      const vmag = Math.hypot(samp.vx, samp.vy);
      if (vmag > 1e-6){ ux = samp.vx / vmag; uy = samp.vy / vmag; }
      const px = -uy, py = ux;

      // collision feel near the end of each segment
      let colAmt = 0;
      if (samp.u > 0.82) colAmt = easeOutQuad((samp.u - 0.82) / 0.18);

      // v0.4.6: pre-jolt は「徐々に集まる」を優先して gentler seek。
      // その後（壁ヒット区間）は v0.4.4 同様に SEEK を強めて『壁まで届く』を確保。
      if (samp.pre){
        const gpre = (typeof samp.gather === 'number') ? samp.gather : 0.0;
        a._seekMul = (2.0 + 2.2 * gpre) + 0.65 * colAmt;
        a._forceSeek = false;
      } else {
        // v0.4.4: 0.2s区間でも「ちゃんと壁まで届く」ように、②-b中だけSEEKを強める
        // （ターゲットは壁にあるが、粒子の追従が間に合わないと「壁に当たる前に反転」に見えるため）
        a._seekMul = 2.2 + 1.6 * colAmt; // 衝突直前ほど強める
        a._forceSeek = true;            // seenFactorの減衰を無視して吸着を確保
      }

      // --- v0.7.0: head is round / tail is fluffy / droplets lag behind ---
      // basis projection of the particle's blob offset
      const R = ENTER_BLOB_RADIUS;
      const ox = (a.bx || 0), oy = (a.by || 0);
      const q0 = ox * ux + oy * uy;      // along (move direction)
      const r0 = ox * px + oy * py;      // perpendicular

      // warp: head(+) stays round, tail(-) stretches & wobbles
      let q = q0, r = r0;
      const seed = (a.bseed || 0);
      const morphInv = 1.0 - (samp.morph || 0);

      if (q0 >= 0){
        // head: avoid oval → slightly compress along, keep perp
        q = q0 * 0.92;
        r = r0 * 1.00;
      } else {
        const tailN = Math.min(1, (-q0) / (R + 1e-6));
        // tail: longer + wider
        q = q0 * (1.18 + 0.60 * tailN);
        r = r0 * (1.10 + 0.30 * tailN);
        // pull the tail back a bit
        q -= tailN * R * 0.22;
        // fluffy wobble (mostly on tail)
        const flutter = (Math.sin(seed + tSec*7.8) + Math.sin(seed*0.77 + tSec*11.5) * 0.6);
        r += flutter * 10.0 * tailN * morphInv;
        q += Math.cos(seed*1.3 + tSec*6.9) * 6.0 * tailN * morphInv;
      }

      // back to world in movement basis
      let wx = ux * q + px * r;
      let wy = uy * q + py * r;

      // squash on hit (wall normal)
      let sxw = 1.0, syw = 1.0;
      if (samp.wall === 'T' || samp.wall === 'B'){
        sxw = 1.0 + 0.35 * colAmt;
        syw = 1.0 - 0.45 * colAmt;
      } else if (samp.wall === 'L' || samp.wall === 'R'){
        sxw = 1.0 - 0.45 * colAmt;
        syw = 1.0 + 0.35 * colAmt;
      } else if (samp.wall){
        sxw = 1.0 - 0.40 * colAmt;
        syw = 1.0 - 0.40 * colAmt;
      }
      wx *= sxw;
      wy *= syw;

      // head jitter is small / tail jitter is larger
      const headMask = (q0 > 0) ? Math.min(1, q0 / (R * 0.65 + 1e-6)) : 0;
      const jitterScale = (1.0 - 0.85 * headMask);
      let jx = Math.sin(seed + tSec*6.2) * 6.0 * jitterScale * morphInv;
      let jy = Math.cos(seed*0.7 + tSec*5.1) * 6.0 * jitterScale * morphInv;
      if (q0 < 0){
        const tailN = Math.min(1, (-q0) / (R + 1e-6));
        jx += Math.sin(seed*2.1 + tSec*10.7) * 8.0 * tailN * morphInv;
        jy += Math.cos(seed*1.8 + tSec*9.6) * 8.0 * tailN * morphInv;
      }


      // v0.4.6: pre-jolt は『集まった塊』を明確にするため、blobオフセットを小さめにする
      if (samp.pre){
        const gpre2 = (typeof samp.gather === 'number') ? samp.gather : 0.0;
        const preScale = Math.max(0.25, 0.55 - 0.30 * gpre2); // 0.55 → 0.25 (gather=>tight)
        wx *= preScale;
        wy *= preScale;
        jx *= preScale;
        jy *= preScale;
      }

      // optional: small lagging droplets behind the tail (pink)
      let baseX = samp.x, baseY = samp.y;
      if (a.trailType && a.trailType !== 0){
        const vps = Math.hypot(samp.vx, samp.vy) * 1000.0; // px/s
        const trailDist = Math.min(185, 55 + vps * 0.085);
        const backMul = a.trailBackMul || 1.0;
        const sideMul = a.trailSideMul || 0.0;
        const desiredX = samp.x - ux * trailDist * backMul + px * trailDist * 0.25 * sideMul;
        const desiredY = samp.y - uy * trailDist * backMul + py * trailDist * 0.25 * sideMul;
        if (typeof a.trailX !== 'number'){
          a.trailX = desiredX;
          a.trailY = desiredY;
        } else {
          const alpha = Math.max(0.03, Math.min(0.20, 1.0 - (a.trailLag || 0.9)));
          a.trailX += (desiredX - a.trailX) * alpha;
          a.trailY += (desiredY - a.trailY) * alpha;
        }
        baseX = a.trailX;
        baseY = a.trailY;

        // droplets are smaller and a bit more wiggly
        const s = (a.trailSize || 0.62);
        wx *= s;
        wy *= s;
        jx += Math.sin(seed*0.9 + tSec*8.6) * 7.0 * morphInv;
        jy += Math.cos(seed*1.1 + tSec*7.4) * 7.0 * morphInv;
      }

      const blobX = baseX + wx + jx;
      const blobY = baseY + wy + jy;

      targetX = blobX + (a.tx - blobX) * samp.morph;
      targetY = blobY + (a.ty - blobY) * samp.morph;
      // v0.4.8: pre-jolt（ビク！ビク！！ビク！！！）
      // ・塊の上昇（0.2s×3）を見た目として確実に0.2sにするため、
      //   まず全粒子を「現在位置の形のまま」pre-blob軌道へ平行移動させ、同時に gather で塊へ寄せる。
      if (samp.pre){
        const gpre = (typeof samp.gather === 'number') ? samp.gather : 0.0;
        const ox0 = (typeof a.preOx === 'number') ? a.preOx : a.x;
        const oy0 = (typeof a.preOy === 'number') ? a.preOy : a.y;

        const kStart = (enter && enter.keys && enter.keys.length) ? enter.keys[0] : {x:(enter?enter.cx:0), y:(enter?enter.cy:0)};
        const baseX2 = ox0 + (samp.x - (kStart.x || 0));
        const baseY2 = oy0 + (samp.y - (kStart.y || 0));

        targetX = baseX2 + (blobX - baseX2) * gpre;
        targetY = baseY2 + (blobY - baseY2) * gpre;

        if (enter && typeof enter.yT === 'number'){
          targetY = Math.max(enter.yT + 1, targetY);
        }
      }
    } else if (now < a.catchUntil && a.catchStart){
      // ①-a / ②-a：catch-up easing（スクスト）
      const catchDur = CATCHUP_MS;
      const tNorm = Math.max(0, Math.min(1, (now - a.catchStart) / catchDur));

      let prog = tNorm;
      if (a.catchEase === 'overshoot'){
        prog = expoOvershootBlendParam(
          tNorm,
          ENTER_OVERSHOOT_BACK,
          ENTER_OVERSHOOT_PEAK_FRAC,
          ENTER_OVERSHOOT_TIME_POWER,
          ENTER_OVERSHOOT_OUT_EXPO_STEEPNESS,
          ENTER_OVERSHOOT_IN_EXPO_STEEPNESS
        );
      } else if (a.catchEase === 'outCirc'){
        prog = easeOutCirc(tNorm);
      } else if (a.catchEase === 'outExpo'){
        prog = easeOutExpoParam(tNorm, 10.0, 1.0);
      }

      const sx0 = (typeof a.sx === 'number') ? a.sx : a.x;
      const sy0 = (typeof a.sy === 'number') ? a.sy : a.y;
      targetX = sx0 + (a.tx - sx0) * prog;
      targetY = sy0 + (a.ty - sy0) * prog;
    }

    
          // EXIT target overrides (解散アニメ)
          if (phase === 'EXIT' && exit){
            if (exit.type === '2a' && exit.exploded){
              // free flight (no target attraction)
              if (Math.random() < 0.14){
                a.vx += (Math.random()-0.5) * 0.45;
                a.vy += (Math.random()-0.5) * 0.45;
              }
              targetX = a.x;
              targetY = a.y;

            } else if (exit.type === '1a'){
              const tr = exit.tr || {scale:1, ox:0, oy:0, sx:1, sy:1, cx:p.width*0.5, cy:p.height*0.5};
              targetX = tr.cx + (targetX - tr.cx) * (tr.scale * (tr.sx || 1)) + tr.ox;
              targetY = tr.cy + (targetY - tr.cy) * (tr.scale * (tr.sy || 1)) + tr.oy;

            } else if (exit.type === '2a'){
              const tE = Math.max(0, now - exit.start);
              const cx0 = p.width*0.5, cy0 = p.height*0.5;

              // inflate -> quick shrink -> explode (爆発は別ブロックで1回だけ付与)
              if (tE < EXIT2A_BUILDUP_MS){
                const uE = Math.max(0, Math.min(1, tE / EXIT2A_BUILDUP_MS));
                const kE = easeOutQuad(uE);
                // v0.9.2: さらに控えめに（数字が画面外へ行きにくく）
                const s = 1.0 + 0.14 * kE;
                targetX = cx0 + (targetX - cx0) * s;
                targetY = cy0 + (targetY - cy0) * s;
              } else {
                const tS = Math.min(EXIT2A_SHRINK_MS, tE - EXIT2A_BUILDUP_MS);
                const uS = Math.max(0, Math.min(1, tS / EXIT2A_SHRINK_MS));
                const kS = 1 - Math.pow(1 - uS, 5); // easeOutQuint
                const s = 1.0 - 0.95 * kS;
                targetX = cx0 + (targetX - cx0) * s;
                targetY = cy0 + (targetY - cy0) * s;
              }

            } else if (exit.type === '2b'){
              const tE = Math.max(0, now - exit.start);
              // v0.8.1: ①ゆらゆら停止 → (1.0s) → 上からサラサラ崩壊 → (粒ごとに0.3s後) 透明化

              // lazy init (in case)
              if (!exit.crumbleInited){
                let minY = Infinity, maxY = -Infinity;
                for (let j=0; j<N; j++){
                  const pj = pts[j];
                  const ty = (typeof pj.ty === 'number') ? pj.ty : pj.y;
                  minY = Math.min(minY, ty);
                  maxY = Math.max(maxY, ty);
                  pj.exit2bBaseTx = (typeof pj.tx === 'number') ? pj.tx : pj.x;
                  pj.exit2bBaseTy = ty;
                  pj.exit2bCrumbled = false;
                  pj.exit2bCrumbledAt = 0;
                  pj.exit2bAlpha = 255;
                }
                if (!isFinite(minY) || !isFinite(maxY) || Math.abs(maxY-minY) < 1){
                  minY = p.height*0.5 - 220;
                  maxY = p.height*0.5 + 220;
                }
                exit.crumbleMinY = minY;
                exit.crumbleMaxY = maxY;
                exit.crumbleInited = true;
              }

              // Start crumbling after a short pause
              const sweepT = tE - EXIT2B_CRUMBLE_DELAY_MS;
              if (seen && sweepT >= 0){
                const u = Math.max(0, Math.min(1, sweepT / EXIT2B_CRUMBLE_SWEEP_MS));
                const minY = (typeof exit.crumbleMinY === 'number') ? exit.crumbleMinY : 0;
                const maxY = (typeof exit.crumbleMaxY === 'number') ? exit.crumbleMaxY : p.height;
                const thrY = minY + (maxY - minY) * u;

                const baseTy = (typeof a.exit2bBaseTy === 'number') ? a.exit2bBaseTy : a.ty;
                if (!a.exit2bCrumbled && typeof baseTy === 'number' && baseTy <= thrY){
                  a.exit2bCrumbled = true;
                  a.exit2bCrumbledAt = now;
                  // cut any catch-up attraction
                  a.catchUntil = 0;
                }
              }

              if (a.exit2bCrumbled){
                // free drift (no attraction) + slight gravity/jitter
                targetX = a.x;
                targetY = a.y;
                const seed = i * 0.19 + 0.37;
                const sandJ = EXIT2B_SAND_JITTER * sfNow;
                const sandG = EXIT2B_SAND_GRAV * sfNow;
                a.vx += (Math.random()-0.5) * sandJ + Math.sin(seed + tE*0.020) * 0.04 * sfNow;
                a.vy += sandG + (Math.random()-0.5) * sandJ;

                // fade each particle after it has been "sarasara" for a moment
                const dtC = Math.max(0, now - (a.exit2bCrumbledAt || now));
                let alpha = 255;
                if (dtC >= EXIT2B_SAND_FADE_DELAY_MS){
                  const uu = (dtC - EXIT2B_SAND_FADE_DELAY_MS) / EXIT2B_SAND_FADE_MS;
                  const kk = Math.max(0, Math.min(1, uu));
                  alpha = Math.round(255 * (1.0 - kk));
                }
                // v0.10.1: 見失い中(=sfNow↓)は砂のフェードを打ち消して、液体へ戻す
                alpha = Math.round(alpha * sfNow + 255 * ufNow);
                a.exit2bAlpha = alpha;
              } else {
                // not yet crumbled → keep digit target (no extra shake)
                a.exit2bAlpha = 255;
              }
            }
          }

const wobbleAmpBase = (phase === 'SHOW' || (phase === 'EXIT' && exit && exit.type === '1a')) ? SEEN_WOBBLE : 0.0;
const wobbleAmp = wobbleAmpBase * sfNow;
    const wobbleX = Math.sin(tSec * freqX + phaseOff) * wobbleAmp;
    const wobbleY = Math.cos(tSec * freqY + phaseOff * 1.7) * wobbleAmp;

    const dx = (targetX + wobbleX) - a.x;
    const dy = (targetY + wobbleY) - a.y;

    const gain = (now < a.catchUntil) ? CATCHUP_GAIN : 1.0;

    const seekMul = (typeof a._seekMul === 'number') ? a._seekMul : 1.0;
    a._seekMul = 1.0;
    const sfSeek = (a._forceSeek) ? 1.0 : sfNow;
    a._forceSeek = false;

    // stage-specific damping (爆発/塵は減衰を弱めて動きを残す)
    let damp = DAMP;
    if (phase === 'EXIT' && exit){
      // v0.9.2: 爆発後は減衰をさらに弱めて、壁に当たるまで飛び散る
      if (exit.type === '2a' && exit.exploded) damp = 0.975;
      if (exit.type === '2b' && a.exit2bCrumbled) damp = 0.92;
    }

    // seenFactor が落ちるほど、ターゲット吸着(SEEK)を弱め、IDLEジッタを強める
    const dampBlend = 0.98 + (damp - 0.98) * sfNow;
    const jx = (Math.random()-0.5) * IDLE_JITTER * ufNow;
    const jy = (Math.random()-0.5) * IDLE_JITTER * ufNow;
    a.vx = (a.vx + dx*SEEK_STRENGTH*gain*sfSeek*seekMul + jx) * dampBlend;
    a.vy = (a.vy + dy*SEEK_STRENGTH*gain*sfSeek*seekMul + jy) * dampBlend;
  }
} else {
            a.vx=(a.vx+(Math.random()-0.5)*IDLE_JITTER)*0.98;
            a.vy=(a.vy+(Math.random()-0.5)*IDLE_JITTER)*0.98;
          }
          a.x+=a.vx; a.y+=a.vy;

          // v0.9.1: 爆発後（EXIT②-a）などの飛散は「端末の画面縁」を壁として反射させる
          // ※COVER表示で画面比率が違う場合、canvas端ではなく可視領域(viewRect)端で跳ね返る
          let wallMinX = 0, wallMaxX = p.width, wallMinY = 0, wallMaxY = p.height;
          if (viewRect && phase === 'EXIT' && exit && (
              (exit.type === '2a' && exit.exploded) ||
              (exit.type === '2b')
          )){
            wallMinX = viewRect.minX; wallMaxX = viewRect.maxX;
            wallMinY = viewRect.minY; wallMaxY = viewRect.maxY;
          }

          // v0.9.2: 爆発後は反発を少し強めて「壁まで飛び散る」感じを維持
          let bounce = -0.5;
          if (phase === 'EXIT' && exit && exit.type === '2a' && exit.exploded) bounce = -0.62;

          if (a.x<wallMinX){a.x=wallMinX;a.vx*=bounce;} if (a.x>wallMaxX){a.x=wallMaxX;a.vx*=bounce;}
          if (a.y<wallMinY){a.y=wallMinY;a.vy*=bounce;} if (a.y>wallMaxY){a.y=wallMaxY;a.vy*=bounce;}
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