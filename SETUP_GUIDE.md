# Credit Card Consolidation Web App - Setup Guide

## What This App Does

✓ Upload CSV transactions daily  
✓ Two users (Tony & Nugs) assign transactions to owners  
✓ Auto-detects conflicts (when assignments don't match)  
✓ Keeps conflicting transactions in backlog until resolved  
✓ Local caching - submissions saved to your device  
✓ Edit submissions anytime before new CSV loads  
✓ Real-time stats dashboard  

---

## Setup Instructions

### 1. Create GitHub Repository

```bash
# Create a new folder
mkdir credit-card-app
cd credit-card-app

# Initialize git
git init

# Create .gitignore
echo "node_modules" > .gitignore
echo ".next" >> .gitignore
echo ".env.local" >> .gitignore
```

### 2. Add All Project Files

Copy these files into your `credit-card-app` folder:

```
credit-card-app/
├── package.json
├── next.config.js
├── tailwind.config.js
├── postcss.config.js
├── pages/
│   └── index.js
├── components/
│   └── CreditCardApp.jsx
├── styles/
│   └── globals.css
└── test-transactions.csv
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Run Locally (for testing)

```bash
npm run dev
# Open http://localhost:3000 in your browser
```

### 5. Deploy to Vercel

**Option A: Via GitHub (Recommended)**

```bash
# Commit and push to GitHub
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/credit-card-app.git
git push -u origin main
```

Then:
1. Go to https://vercel.com
2. Sign up (free)
3. Click "Import Project"
4. Select your GitHub repo
5. Click "Deploy"
6. Your app is live! (You'll get a URL like `your-app.vercel.app`)

**Option B: Direct Vercel CLI**

```bash
npm install -g vercel
vercel
# Follow prompts, choose to link to GitHub repo
```

---

## How to Use the App

### Daily Workflow

1. **Export Westpac CSV** (from your online banking)
   - Download as `transactions.csv`

2. **Upload CSV in App**
   - Click "Upload CSV"
   - Select your transaction file
   - App loads all transactions

3. **Assign Transactions**
   - Switch to your user (Tony or Nugs)
   - Click "➕ Assign" on each transaction
   - Choose owner: Tony, Nugs, Split, or Other
   - Your selection is auto-saved locally

4. **Other User Does Same**
   - They visit same URL
   - Switch to their username
   - Assign their view of transactions
   - Auto-saved locally

5. **Conflict Resolution**
   - Conflicting transactions show red ⚠️ CONFLICT badge
   - They stay in backlog until both users agree
   - Click "✏️ Edit" to change your mind
   - Changes sync instantly

### Local Data

- All submissions are cached on your device
- Data persists even if you close browser
- Lasts until browser cache is cleared
- Both users on same device share cache (as intended)

---

## Updating CSV Daily

### Manual Process (Simple)

1. Export new CSV from Westpac
2. Go to your Vercel URL
3. Upload new CSV
4. Assign transactions as usual

### Automated Process (Advanced)

To auto-upload CSV via GitHub commit:

```bash
# Create a script (update-csv.sh)
#!/bin/bash
cp ~/Downloads/transactions.csv ./transactions.csv
git add transactions.csv
git commit -m "Daily update: $(date)"
git push

# Run daily via cron (macOS/Linux):
# Edit: crontab -e
# Add: 0 8 * * * /path/to/update-csv.sh
# (runs at 8am daily)
```

---

## File Structure Explained

- **package.json** - Dependencies (Next.js, React, Tailwind, PapaParse)
- **pages/index.js** - Entry point for the app
- **components/CreditCardApp.jsx** - Main app logic
- **styles/globals.css** - Global Tailwind styles
- **tailwind.config.js** - Tailwind customization
- **test-transactions.csv** - Sample data for testing

---

## Testing

1. Download `test-transactions.csv` from the outputs
2. Upload it in the app
3. Switch between Tony/Nugs
4. Assign different transactions
5. Create conflicts on purpose to see how they work
6. Refresh page - data persists!

---

## Troubleshooting

**"Module not found" error**
```bash
npm install
```

**Port 3000 already in use**
```bash
npm run dev -- -p 3001
```

**Vercel deployment fails**
- Check that all files are committed to GitHub
- Run `npm run build` locally to test

**Data not saving**
- Check browser console (F12) for errors
- Ensure localStorage is enabled in browser
- Try a different browser

---

## Next Steps

1. Set up GitHub repo with these files
2. Deploy to Vercel
3. Share the URL with the other user
4. Start uploading CSVs and testing!

Questions? Check the GitHub repo or refer back to this guide.
