# 部署到 Render(免費方案,電腦關機也能玩)

程式碼已經準備好、也已經建立好本機 git 版本控制(`git log` 可以看到第一筆 commit)。
剩下的步驟需要你自己的帳號(GitHub、Render),沒辦法由我代為完成,但每一步都很簡單。

## 為什麼要這樣做
- 資料庫已改用 Turso(外部持久化雲端資料庫,libSQL/SQLite 相容),不論重新部署或休眠喚醒,
  玩家帳號與存檔都會保留(已實測驗證:完整重啟伺服器行程後,資料確實還在)。
- 平常沒人連線時服務會睡著,有人打開網頁時會自動醒來(可能要等 30~60 秒喚醒)。

## 步驟

### 1. 建立 GitHub 帳號(如果還沒有)
前往 https://github.com/signup 免費註冊。

### 2. 在 GitHub 上建立一個新的空白 repository
- 前往 https://github.com/new
- Repository name 填 `jianghu-rpg`(或你喜歡的名字)
- 選 **Private**(不公開也可以,不影響部署)
- **不要**勾選「Add a README file」「Add .gitignore」「Choose a license」(我們本機已經有了,勾選會造成衝突)
- 按「Create repository」

### 3. 把本機程式碼推上去
建立完 repository 後,GitHub 會顯示一段指令,類似:
```
git remote add origin https://github.com/你的帳號/jianghu-rpg.git
git branch -M main
git push -u origin main
```
把這三行貼給我,或是你自己在專案資料夾(`C:\Users\v-tslee\Desktop\jianghu-rpg`)開終端機執行。
第一次 push 時瀏覽器可能會跳出來要你登入 GitHub 授權,登入你剛剛註冊的帳號即可。

### 4. 建立 Render 帳號並部署
- 前往 https://dashboard.render.com/register,可以直接選「Sign up with GitHub」(最快)
- 登入後點 **New +** → **Blueprint**
- 選擇剛剛推上去的 `jianghu-rpg` repository
- Render 會自動讀到專案裡的 `render.yaml`,顯示要建立的服務內容,確認後按 **Apply**
- 等待幾分鐘建置完成,Render 會給你一個網址,例如 `https://jianghu-rpg-xxxx.onrender.com`

### 5. 之後要更新程式碼時
只要把新程式碼 `git push` 上去,Render 會自動重新部署,玩家帳號與存檔資料不受影響
(資料庫是獨立的 Turso 服務,不會隨著程式碼重新部署一起被重置)。

## 資料庫:Turso(持久化雲端資料庫)
遊戲存檔(帳號、角色、交易所、遺物等)存放在 Turso,獨立於 Render 容器的生命週期之外。

**這個 GitHub repository 目前是 Public(公開)的**,所以連線密鑰絕對不能明文寫進 `render.yaml`
(那等於公開給所有人看)。`render.yaml` 裡這幾個環境變數標示 `sync: false`,代表 Render 只
知道「這個變數存在」,實際的值必須自己到 Render 後台手動輸入,不會存進這份公開檔案裡:

1. 前往 Render Dashboard → 你的 `jianghu-rpg` 服務 → 左側 **Environment**
2. 新增以下三個環境變數(名稱要完全一致):
   - `ADMIN_BACKUP_TOKEN`:自己隨便設一組夠長的亂數字串即可(用來保護 `/api/admin/export` 備份端點)
   - `TURSO_DATABASE_URL`:到 [Turso 後台](https://app.turso.tech) 你的資料庫頁面的 Connect 分頁複製
   - `TURSO_AUTH_TOKEN`:同一頁面按「Create Token」產生(只會顯示一次,要當場複製)
3. 存檔後 Render 會自動用新的環境變數重新部署一次

若三個變數沒有設定,遊戲仍能運作,只是會退回本機檔案模式存檔(不會撐過重新部署/休眠喚醒),
`/api/admin/export` 備份端點則會直接關閉(回傳 404)。

## 目前暫時的替代方案
在你完成上面步驟之前,遊戲仍然可以透過本機的 Cloudflare Tunnel 使用(電腦要開著):
目前網址記錄在 `tunnel-url.txt`,有自動監控程式會盡量保持在線。

## 已設定:開機/登入自動啟動(不用手動重開)
已註冊 Windows 排程工作 `JianghuRpgWatchdog`,設定為「使用者登入時自動執行」。
這代表:電腦重開機、或睡眠喚醒後重新登入,後端伺服器與 Cloudflare 通道監控程式都會自動啟動,
不需要手動下指令。已實際測試驗證(完全清空所有相關行程後,由排程工作獨立將服務拉起,
並確認新網址可正常連線)。

若想查看或調整這個排程工作:
- 開始選單搜尋「工作排程器」(Task Scheduler)
- 工作排程器程式庫底下可以找到 `JianghuRpgWatchdog`
