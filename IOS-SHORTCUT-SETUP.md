# iOS Shortcut: "Log to Fuel Log"

**Three actions. About 5 minutes.** If you've already started a Shortcut from the old instructions, delete it and start fresh.

---

## Step 0 — Open Shortcuts and create a new one

1. Open the **Shortcuts** app (it's preinstalled, white icon with overlapping squares)
2. Tap **All Shortcuts** at the top left if you're not on that screen
3. Tap the **+** at the top right
4. You'll see a blank shortcut editor with a title bar at top
5. Tap the title and type: **Log to Fuel Log**

---

## Step 1 — Enable Share Sheet (do this BEFORE adding actions)

This is what makes the Shortcut appear when you tap "Share" on text.

1. At the bottom of the blank shortcut, tap the **(i)** info button (or it may look like a small sliders icon — bottom row, middle area)
2. Toggle **Show in Share Sheet** to ON (green)
3. Below it, tap **Share Sheet Types**
4. Tap **Clear** if there's a button, otherwise tap each toggle to turn them all OFF except **Text**
5. Tap **Done** to come back

The shortcut now accepts text from the share sheet. You'll use "Shortcut Input" as the variable in the next steps.

---

## Action 1 — Get Dictionary from Input

This parses Claude's JSON into a dictionary.

1. In the search bar at the bottom, type: **Get Dictionary**
2. Tap **Get Dictionary from Input**
3. The action appears: `Get dictionary from [Input]`
4. The word **Input** is already correct — leave it. (It refers to "Shortcut Input" — the text from the share sheet.)

---

## Action 2 — Get Contents of URL

This posts the data to your server.

1. In the search bar, type: **Get Contents**
2. Tap **Get Contents of URL**
3. The action shows a URL field with `URL` placeholder text. **Tap it**, then paste:

   ```
   https://joes-mac-mini.tail4df224.ts.net/api/entries
   ```

4. **Tap the small arrow ▼** below the URL (says "Show More" or just an expand arrow) to reveal options
5. Configure:
   - **Method:** tap and change from `GET` to **POST**
   - **Headers:** tap **Add new header**, then:
     - Key: `X-Auth-Token`
     - Text (Value): `<YOUR_API_TOKEN_HERE>`
   - Tap **Add new header** again:
     - Key: `Content-Type`
     - Text (Value): `application/json`
   - **Request Body:** tap and change from `JSON` (or whatever default) to **JSON**
   - Below "Request Body" you'll see an empty JSON area. Tap into it.
   - You'll see a variable picker at the bottom. Tap **Select Variable**.
   - In the list that pops up, find and tap **Dictionary** (it's the output of Action 1, has a small dictionary icon next to it)

The action should now read:
`Get contents of https://joes-mac-mini.tail4df224.ts.net/api/entries`
with Method: POST, two headers, and Request Body containing the **Dictionary** chip.

---

## Action 3 — Show Notification (so you know it worked)

1. Search: **Show Notification**
2. Tap it
3. The action shows `Show Hello World` (or similar default text)
4. Tap "Hello World" and replace with: **Logged ✓**

Done.

---

## Save and test

1. Tap **Done** (top right) to save
2. Back in the Shortcuts list, tap-and-hold "Log to Fuel Log" → **Run**
3. It'll ask for input — paste this test JSON:

   ```
   {"name":"shortcut test","calories":100,"protein":10,"carbs":10,"fat":5}
   ```

4. Tap **Done**
5. You should see the "Logged ✓" notification at the top

Open your Fuel Log dashboard. Within 10 seconds you should see "shortcut test" appear in today's entries.

---

## How to use it day-to-day

1. Have a Claude chat extract macros from a photo or description
2. Claude's last reply ends with a JSON line in a code block
3. **Tap-and-hold** the JSON line → **Select All** → **Share**
4. In the share sheet, scroll until you see **Log to Fuel Log** → tap it
5. Notification appears → dashboard updates

If the share sheet doesn't show it, scroll right in the row of Shortcuts icons or tap "More" to find it. You can also pin it.

---

## If something fails

- **No notification or "shortcut test" doesn't appear in dashboard:**
  In the Shortcuts editor, tap the play button at the bottom while testing. Look at the output area. A 200 response = good. 404 = token wrong (re-check Action 2 headers). Anything else, paste the output to me.

- **"Get Dictionary from Input" errors:**
  The text you're sharing isn't valid JSON. Make sure you're sharing only the JSON line, not surrounding text.

- **Share sheet doesn't show the Shortcut:**
  Re-check Step 1 — Share Sheet enabled, Text type allowed.
