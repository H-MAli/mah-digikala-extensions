# Testing local changes

Tampermonkey can load the script straight from this folder, so a change shows up on the next page reload without reinstalling anything.

## One-time setup

1. Create the loader. Run this in the repository folder (Node.js is needed only for this step):

   ```sh
   node dev/make-loader.js
   ```

   This writes `dev/loader.user.js`. It contains the full path of your copy of the repository, so it isn't committed.
2. Let Tampermonkey read local files:
   - **Chrome / Edge:** open `chrome://extensions`, find Tampermonkey, open **Details**, and turn on **Allow access to file URLs**.
   - **Firefox:** not needed. Firefox can't read local files from add-ons, so there you have to reinstall the script after each change.
3. In the Tampermonkey dashboard, **disable** the regular MAH Digikala Extensions script if it's installed. Otherwise both copies run at once.
4. Open the dashboard's **Utilities** tab and use **Import from file**, or drag `dev/loader.user.js` onto the dashboard. Click **Install**.

## Day to day

- Edit `mah-digikala.extensions.user.js`, save, and reload the Digikala page.
- If a change doesn't show up, Tampermonkey is using a cached copy. Open its **Settings**, set **Config mode** to **Advanced**, and under **Externals** set **Update interval** to **Always**.
- If you change the script's header (`@grant`, `@connect`, `@match` and so on), run `node dev/make-loader.js` again and reinstall the loader. Tampermonkey takes those settings from the loader, not from the loaded file.
- The settings panel's About tab shows the version with `-dev` at the end, so you can tell the loader is the copy that's running.
