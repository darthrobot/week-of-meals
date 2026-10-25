# Week of Meals

Pick meals for each day of the week and get one shopping list, with amounts
added up and grouped by aisle. It runs as an Android app on your phone and as
a desktop app on your computer. Both stay in sync through your own free
Firebase account, and both keep working offline.

## How it fits together

- `web/` holds the app itself (screens, styles, sync code).
- GitHub builds it every time the code changes:
  - the **Android app** (`week-of-meals.apk`)
  - the **desktop app**, posted on GitHub Pages
- **Firebase** stores your meals and list so your phone and computer show
  the same thing. You sign in with the same email and password on both.

Until Firebase is set up, the app saves only on the device you're using.

**Discover** has a built-in library of 99 weeknight recipes (in
[`web/recipes.js`](web/recipes.js), which works offline), plus online search
and category browsing through [TheMealDB](https://www.themealdb.com). TheMealDB's free key is meant
for personal and development use. If you ever publish the app for other
people, their site explains how to get a supporter key.

---

## One-time setup

### 1. Firebase (syncing), about 10 minutes

1. Go to <https://console.firebase.google.com>, sign in with a Google
   account and click **Create a project**. Any name works, for example
   `week-of-meals`. You can turn Google Analytics off.
2. **Turn on email sign-in:** in the left menu choose **Build > Authentication**,
   click **Get started**, choose **Email/Password**, switch on the first
   toggle and click **Save**.
3. **Create the database:** choose **Build > Firestore Database**, then
   **Create database**. Pick a location near you and choose
   **Start in production mode**.
4. **Lock it to you:** on the Firestore **Rules** tab, replace everything
   with the contents of [`firestore.rules`](firestore.rules) and click **Publish**.
5. **Get the app config:** click the gear next to **Project Overview** and
   choose **Project settings**. Under **Your apps** click the web icon `</>`,
   give it a nickname and click **Register app**. Firebase shows a block
   that starts with `const firebaseConfig = {`.
6. Open [`web/firebase-config.js`](web/firebase-config.js) and replace
   `export const firebaseConfig = null;` with that block, changing
   `const` to `export const`. It should look like this:

   ```js
   export const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "week-of-meals-xxxx.firebaseapp.com",
     projectId: "week-of-meals-xxxx",
     storageBucket: "week-of-meals-xxxx.appspot.com",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abc123"
   };
   ```

   This config isn't a password. It only tells the app which Firebase
   project to use. The rules from step 4 are what keep your data private.

### 2. GitHub (builds the apps)

1. Make a free account at <https://github.com> if you don't have one.
2. Create a new repository named `week-of-meals` (**+** in the top right >
   **New repository**). Make it **Public**, because GitHub Pages is free only
   for public repositories. Your meal data is never in the repository; it
   lives in Firebase.
3. In the new repository go to **Settings > Pages**, and under
   **Build and deployment > Source** choose **GitHub Actions**.
4. Send the project to GitHub. In a terminal in this folder:

   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/week-of-meals.git
   ```

   ```bash
   git push -u origin main
   ```

   The first push opens a browser window so you can sign in to GitHub.
5. Open the repository's **Actions** tab and wait for **Build app** to
   finish (about 5 minutes). The first run also saves an Android signing key
   to the repository, so later versions install over the old one.

### 3. Install

- **Android phone:** open
  `https://YOUR-USERNAME.github.io/week-of-meals/week-of-meals.apk` in Chrome
  and open the file when it finishes downloading. Android will ask you to
  allow installs from Chrome; allow it, then tap **Install**. (It also says
  the app isn't from the Play Store. That's expected for an app you built
  yourself.)
- **Computer:** open `https://YOUR-USERNAME.github.io/week-of-meals/` in
  Chrome or Edge, then click the install icon in the address bar (or
  **Settings > Install** inside the app). It opens in its own window.

Create an account in the app on one device, then sign in with the same
email and password on the other.

---

## Making changes later

Edit files in `web/`, then commit and push. GitHub rebuilds both apps. The
desktop app updates the next time you open it. For the phone, download and
install the APK again from the same link; your data stays.

To try changes on this computer first:

```bash
python -m http.server 5173 --directory web
```

Then open <http://localhost:5173>.

## Files

| Path | What it is |
| --- | --- |
| `web/app.js` | Screens and shopping-list logic |
| `web/store.js` | Saving and syncing (Firebase, or this device only) |
| `web/firebase-config.js` | Your Firebase project config |
| `web/styles.css` | Look and feel, light and dark |
| `web/sw.js` | Lets the desktop app work offline |
| `firestore.rules` | Database rules: each account sees only its own data |
| `.github/workflows/build.yml` | Builds the APK and desktop app |
| `assets/`, `web/icons/` | App icons (`tools/make-icons.ps1` redraws them) |
