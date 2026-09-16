# 部署到 Render(免費方案,電腦關機也能玩)

程式碼已經準備好、也已經建立好本機 git 版本控制(`git log` 可以看到第一筆 commit)。
剩下的步驟需要你自己的帳號(GitHub、Render),沒辦法由我代為完成,但每一步都很簡單。

## 為什麼要這樣做
- 免費方案「休眠喚醒」資料庫檔案不會不見,只有在**重新部署**(推送新程式碼)時才會重置存檔。
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
只要把新程式碼 `git push` 上去,Render 會自動重新部署——但**這會重置存檔資料庫**(免費方案沒有永久磁碟),
所以之後如果我幫你改功能,建議約好時間讓大家的角色進度不會突然消失,或者告訴我,我可以在推送前後幫你寫一個簡單的匯出/匯入角色資料的小工具。

## 目前暫時的替代方案
在你完成上面步驟之前,遊戲仍然可以透過本機的 Cloudflare Tunnel 使用(電腦要開著):
目前網址記錄在 `tunnel-url.txt`,有自動監控程式會盡量保持在線。
