# 共有用_サボる時計 v0.2.0（GitHub Pages 公開用）

このフォルダ一式を GitHub リポジトリの **root（直下）** に置くと、GitHub Pages でそのまま動きます。

## 公開手順（いちばん簡単：GitHub の画面からアップロード）
1. GitHubで新規リポジトリを作る（Public推奨）
2. **Add file → Upload files** から、このフォルダ内のファイル/フォルダを **全部** アップロード  
   - `index.html` がリポジトリ直下にある状態にしてください
3. **Settings → Pages**
   - Source: **Deploy from a branch**
   - Branch: **main / (root)**
4. 表示されたURL（`https://<user>.github.io/<repo>/`）を開く

## 使い方
- ページを開くと、最初は「見られていない」状態で待機します。
- **「カメラを許可して開始」** を押して、ブラウザのカメラ許可をONにしてください。
- UIを隠したいときは **「→」** を押すと右上の **⚙** に収納されます。
- カメラ映像の表示は **「カメラプレビューを表示」** で切り替えできます（通常はOFF推奨）。

## よくある注意
- **ローカルのファイル（file://）で開くとカメラが動きません**。  
  GitHub Pages（HTTPS）か、ローカルサーバ（Live Server 等）で開いてください。
- iPad でフルスクリーン寄りにしたい場合は Safari で **「ホーム画面に追加」** が安定です。

---
---
generated package: v0.2.0
