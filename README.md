# Credit Card Consolidation App

A web app for two users to assign credit card transactions and resolve conflicts in real-time.

## Features

- 📤 Upload CSV transactions daily
- 👥 Two users independently assign owners
- ⚠️ Auto-detect conflicts when assignments don't match
- 💾 Local caching - submissions saved to device
- ✏️ Edit submissions anytime
- 📊 Real-time stats dashboard

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Locally
```bash
npm run dev
```
Open http://localhost:3000

### 3. Test with Sample CSV
1. Upload `test-transactions.csv`
2. Switch between Tony/Nugs
3. Try assigning different values to see conflicts

### 4. Deploy to Vercel (Free)
```bash
# Push to GitHub first
git push

# Then go to https://vercel.com and import your repo
```

## Project Structure
```
├── components/
│   └── CreditCardApp.jsx     # Main app logic
├── pages/
│   ├── _app.js               # Next.js app wrapper
│   └── index.js              # Entry page
├── styles/
│   └── globals.css           # Global styles
├── package.json              # Dependencies
├── tailwind.config.js        # Tailwind config
└── test-transactions.csv     # Sample data
```

## How It Works

1. **Upload CSV** - Paste daily Westpac transactions
2. **Assign** - Tony and Nugs each assign owners
3. **Conflict Detection** - Mismatches show red ⚠️
4. **Local Storage** - All data cached on device
5. **Edit Anytime** - Change submissions before new CSV

## Data Storage

- Submissions stored in browser's localStorage
- Persists between sessions
- Shared between users on same device
- No server storage needed

## FAQ

**Q: Will my data be lost if I refresh?**  
A: No, it's saved locally in your browser.

**Q: Can I use this on mobile?**  
A: Yes, share the Vercel URL. Mobile-responsive design included.

**Q: How do I update the CSV?**  
A: Export new CSV from Westpac, upload to app. Old submissions remain in cache.

**Q: What if there's a conflict?**  
A: Transaction stays in backlog (yellow/red) until both users agree. Edit to change your assignment.

## Email Notifications

The admin upload page now includes an email notification step after an import succeeds.

To enable it, set these environment variables in Vercel or your local `.env.local`:

```bash
GMAIL_USER=westpactracker@gmail.com
GMAIL_APP_PASSWORD=your_gmail_app_password
EMAIL_FROM=Westpac CC Tracker <westpactracker@gmail.com>
EMAIL_FROM_NAME=Westpac CC Tracker
EMAIL_REPLY_TO=
EMAIL_TEST_RECIPIENT=spr.tony@gmail.com
EMAIL_RECIPIENT_TONY=spr.tony@gmail.com
EMAIL_RECIPIENT_NUGS=nguyet_anh_le@hotmail.com
AUTOMATED_EMAIL_TIME=23:00
AUTOMATED_EMAIL_TIME_ZONE=Australia/Melbourne
CRON_SECRET=choose_a_long_random_value
```

This setup uses Gmail SMTP, so you do not need a custom domain. Create a Gmail app password for `westpactracker@gmail.com` and store it in `GMAIL_APP_PASSWORD`. The app will send from `westpactracker@gmail.com`, which can be used for both Tony and Nugs recipients.

This email feature needs a standard Next.js/Vercel deployment. Avoid the static `next export` path for the live app, because API routes do not run in a pure static export.

Automatic emails are sent from `/api/cron/send-notification-email`. The default schedule is 11:00 PM Melbourne time and the app sends Tony and Nugs their own profile summaries once per local day. You can change the send time from the admin upload page; it is saved in Firebase under `notificationAutomation/settings`, so changing it does not require a redeploy. `AUTOMATED_EMAIL_TIME` is only the fallback default when no saved setting exists.

Vercel Hobby cron jobs can only run once per day, so `vercel.json` keeps a single daily fallback cron. For editable send times, `.github/workflows/email-scheduler.yml` wakes the endpoint every 15 minutes. The endpoint checks the saved `Australia/Melbourne` time before sending, so changing the saved time to `22:00` will move the daily send to the next scheduler wake-up after 10:00 PM Melbourne time.

If you set `CRON_SECRET` in Vercel, add the same value as a GitHub Actions repository secret named `CRON_SECRET`. If the production app URL changes, add a GitHub Actions repository secret named `APP_URL`; otherwise it defaults to `https://ccapp-nine.vercel.app`.

You can also update it from the backend with `POST /api/notification-automation-settings` and a JSON body such as:

```json
{
  "time": "22:00"
}
```

To test the full backend send path immediately, use the admin page's `Send now` button or call `POST /api/send-automated-notification-now`.

The admin page also shows the latest scheduler events from `notificationAutomation/events`, which helps confirm whether Vercel or GitHub Actions has actually invoked the cron endpoint.

Set `CRON_SECRET` in Vercel to protect the cron endpoint. Vercel will include it in the cron request automatically.

The email includes:

- Current pending count
- How many items were imported in the latest upload
- How many items were skipped as duplicates
- A link to the app: [https://ccapp-nine.vercel.app](https://ccapp-nine.vercel.app)

---

See SETUP_GUIDE.md for detailed instructions.
