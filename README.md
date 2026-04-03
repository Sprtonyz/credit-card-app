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

---

See SETUP_GUIDE.md for detailed instructions.
