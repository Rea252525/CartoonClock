# Cartoon Clock / サボる時計 (v0.1.14)

p5.js で作った「見られていると数字に集まり、見られていないとサボって散る」液体時計です。

- **見られている**：HH:MM が液体で表示される（コロンは秒に合わせて太さが変化）
- **見られていない**：粒子が漂って“サボる”
- **カメラ**：ブラウザの `getUserMedia` を使って顔検出（使えない環境では動き検出にフォールバック）
- **シミュレーション**：カメラなしでも「見られている」を手動でON可能

---

## フォルダ構成

- `index.html`
- `src/main.js`

---

## ローカルでの起動

> **重要**：カメラを使う場合は **https** か **localhost** が必要です。

1. このフォルダを VS Code で開く
2. Live Server などの **静的サーバ**で `index.html` を開く
   - 例：VS Code 拡張「Live Server」
   - 例：`python3 -m http.server 8000`
3. 画面右上の **⚙︎** から設定を開く
   - 「視線をシミュレーション」：カメラなしで見られ状態
   - 「カメラを許可して開始」：カメラON（許可ダイアログが出ます）

---

## GitHub Pages で公開する

1. このフォルダ直下のファイルを **リポジトリのルート**にコミット & push
2. GitHub の `Settings` → `Pages`
3. `Build and deployment` で
   - **Source**：`Deploy from a branch`
   - **Branch**：`main` / `/(root)`
4. 表示された URL にアクセス
   - `https://<username>.github.io/<repo>/`

GitHub Pages は https なので、カメラも基本的に動きます（ブラウザの許可は必要）。

---

## メモ

- 描画は `gBlob`（オフスクリーン）に粒子をスタンプ → `BLUR` → `THRESHOLD` で液体化しています。
- v0.1.13 以降、画面サイズに応じて **太さ/ぼかし/しきい値を自動調整**し、
  小画面の「潰れ」と大画面の「途切れ」を抑えるようにしています。

---

## Credits

- p5.js
- Google Fonts: Inter / Noto Sans
