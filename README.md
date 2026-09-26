# Math Sprint League

Students use it two ways, with no account needed:
- **Live game:** the teacher runs a game on the projector, and students join from their phones with a 6-digit code.
- **Practice:** students play solo sprints anytime (at school or at home), climb the leaderboard and try to beat their own record.

- **Student page:** `https://YOUR-USERNAME.github.io/math-sprint-league/`
- **Teacher page:** `https://YOUR-USERNAME.github.io/math-sprint-league/host.html`

## Practice and leaderboard (student page)
The student page has three tabs: **Live game**, **Practice** and **Leaderboard**.
- **Practice:** pick an event, a level and a time (30 s, 60 s, 90 s or 2 min), then answer as many problems as possible. The results screen shows the score, accuracy and best streak, whether it's a new record ("New record! Up from 19"), the student's place on the board, and the problems they missed with the right answers.
- **Leaderboard:** each student's best score for every event, level and time. **Your records** lists the student's best in every event they've played. Scores from live sprint races count too and are marked **class**.
- Students are grouped by the name they type, so ask them to always use the same one, e.g. first name and last initial. The name is remembered on each phone.

On the teacher page, the **Leaderboard** tab shows the same boards and the latest practice activity (who practiced this week). You can **Remove** a wrong or joke entry (tap twice), and **download every sprint score as CSV**.

## Live game formats
- **Sprint race:** everyone gets the same problems in the same order for 30 s to 2 min. The projector shows a live race. The results also go on the leaderboard.
- **Rounds:** one problem at a time. Faster correct answers earn more points (1000 down to 500). After each round the projector shows the answer, the fastest students and the standings.

Events: addition, subtraction, multiplication, division, integers, order of operations, squares & roots, percentages, fractions, solve for x, and mixed. Each event has 3 levels: Warm-up, Contest and Olympiad.

Every finished live game is saved in **Live game history** on the teacher page. It includes a per-student summary (games played, wins, top-3 finishes, average place, accuracy) and a **Download CSV** button for your gradebook.

---

## One-time setup (about 20–30 minutes)

### 1. Firebase: register the web app
1. Go to https://console.firebase.google.com and open your project, or create a new one. You can turn off Google Analytics.
2. Click the gear icon → **Project settings** → **General** → **Your apps** → click the **Web** icon `</>`.
3. Give it a nickname (e.g. `math-sprint-league`) and click **Register app**. You don't need Firebase Hosting.
4. Keep the `firebaseConfig` values it shows. You'll paste them in step 4.

### 2. Firebase: sign-in methods
1. **Build → Authentication → Get started → Sign-in method**.
2. Enable **Anonymous**. Students use this, and it's invisible to them.
3. Enable **Google** (pick your email as the support email). This is for you, the teacher.
4. Open the **Settings** tab → **Authorized domains** → **Add domain** → type `YOUR-USERNAME.github.io`.

### 3. Firebase: database and rules
1. **Build → Realtime Database → Create database**. Pick the United States location and start in **locked mode**.
2. Open the **Rules** tab. Delete what's there and paste the whole content of `database.rules.json`.
3. Replace `TEACHER_EMAIL@gmail.com` with the Google email you'll sign in with. It appears **5 times**, so use find and replace.
   To let another teacher host too, change each check to allow both emails:
   `(auth.token.email == 'you@gmail.com' || auth.token.email == 'other@gmail.com')`
4. Click **Publish**.
5. Open the **Data** tab and copy the database link at the top (it ends in `firebaseio.com` or `firebasedatabase.app`).

### 4. Paste your settings into `js/config.js`
Replace the `PASTE_…` values with the ones from step 1.4. Make sure `databaseURL` is the link from step 3.5.

These values are not secret. Every web app shows them to the browser. The rules from step 3 are what protect your data: only your Google account can create games, read the history or delete scores. Students can only add their own new scores, can't change or delete anyone's, and a score has to be believable for its time limit.

### 5. GitHub Pages: publish the site
1. On GitHub, click **New repository**. Name it `math-sprint-league`, make it **Public**, and create it.
2. Click **uploading an existing file**. Drag in **everything inside this folder**, keeping the `css` and `js` folders. Click **Commit changes**.
3. Go to **Settings → Pages**. Under Source choose **Deploy from a branch**, then branch `main` and folder `/ (root)`. Click **Save**.
4. After 1–2 minutes, the page shows your site address.

To change a file later, open it on GitHub, click the pencil icon, edit it and commit. The site updates in about a minute.

### 6. Test it
1. On your laptop, open `…/host.html`, click **Sign in with Google**, and create a game.
2. On your phone, scan the QR code or open the main address and type the code.
3. Press **Start** on the laptop.

---

## Running a game in class
1. Put `host.html` on the projector. **Full screen** helps.
2. Choose the format, event and level, then click **Create game**.
3. Students scan the QR code or go to the address, type the code and their name.
   Tap the × next to a name twice to remove a student.
4. Press **Start** (or the Enter key).
5. In Rounds, press **Next round** (or Enter) after discussing each answer.
6. At the end, **Play again** keeps the same students and code with new problems. **New game** starts a fresh code.

If a student's phone locks or they close the page, they can reopen it and rejoin with the same name and code. Their score is kept.

## Limits and costs
The free Firebase plan (Spark) allows about 100 people connected at the same time, which is plenty for a class or a delegation. This app uses very little data. GitHub Pages is free for public repositories.

## Files
- `index.html`: student page
- `host.html`: teacher page
- `js/problems.js`: problem generators (add or adjust events here)
- `js/player.js`, `js/host.js`: student and teacher pages
- `js/board.js`: leaderboard and records
- `js/fb.js`, `js/config.js`: Firebase connection
- `database.rules.json`: security rules to paste into Firebase
