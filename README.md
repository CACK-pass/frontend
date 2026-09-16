# CACK-pass 🎟️  
**web2/Web3 Event Ticketing Platform for all**

## 🚀 Quick Start

```bash
git clone https://github.com/CACK-pass/frontend
cd cack-pass
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| **Framework** | Next.js 16 (App Router) |
| **Language** | TypeScript |
| **Auth** | Privy.io (Embedded Wallets) |
| **Blockchain** | Lisk Sepolia (EVM) |
| **Smart Contracts** | Solidity 0.8.30 |
| **Gas Abstraction** | Biconomy |
| **Database** | MongoDB + Mongoose |
| **Storage** | IPFS (Pinata) |
| **Styling** | Tailwind CSS |
| **State** | TanStack Query |
| **UI** | Lucide React, Sonner |

## ✅ Core Features

- ✓ **Gasless** ticket minting & transfers
- ✓ **Anti-scalping** controls with price caps
- ✓ **Social login** (Email/Google/Twitter)
- ✓ **Digital collectible tickets** (NFTs on IPFS)
- ✓ **Secondary marketplace** with creator royalties
- ✓ **Mobile-first PWA** with QR verification
- ✓ **Multi-currency** (Crypto + Paystack)
- ✓ **Real-time analytics** for organizers

## 📜 Smart Contracts

```solidity
CackPassCore.sol     # Main ticketing logic
TicketMarket.sol     # Secondary market
RoyaltyEngine.sol    # Royalty distribution (0-50%)
```

**Deployed on Lisk Sepolia**  
Addresses in `/lib/contracts/client.ts`

## ⚙️ Environment variables Setup 

### 1. Copy environment file:
```bash
cp .env.example .env.local
```

### 2. Fill `.env.local`:
```env
# Required
NEXT_PUBLIC_PRIVY_APP_ID=your_app_id
PRIVY_APP_SECRET=your_secret
MONGODB_URI=mongodb://localhost:27017/cackpass
PINATA_JWT=your_pinata_jwt
NEXT_PUBLIC_RPC_URL=https://rpc.sepolia-api.lisk.com

# Optional (for payments)
MOONPAY_SECRET_KEY=your_moonpay_key
PAYSTACK_SECRET_KEY=your_paystack_key

# Smart contracts (get from deployment)
NEXT_PUBLIC_CACKPASS_CORE_ADDRESS=0x...
NEXT_PUBLIC_TICKET_MARKET_ADDRESS=0x...

NEXT_PUBLIC_APP_URL=http://localhost:3000

ONRAMP1_URL=

ONRAMP2_URL=
```

### 3. Get API keys:
- [Privy Dashboard](https://dashboard.privy.io)
- [Pinata API Keys](https://app.pinata.cloud/developers)
- [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) (or run local)

## 📦 Scripts

```bash
npm run dev          # Start dev server (localhost:3000)
npm run build        # Production build
npm run start        # Run production build
npm run seed         # Seed database with admin + sample data
npm run lint         # ESLint + TypeScript check
npm run type-check   # TypeScript only
```

## 📁 Project Structure

```
cack-pass/
├── app/                    # Next.js 14 App Router
│   ├── api/               # API routes (auth, events, tickets)
│   ├── (main)/           # Main layout group
│   ├── events/           # Events listing
│   ├── organizer/        # Organizer portal
│   └── profile/          # Profile completion
├── components/           # Reusable components
│   ├── events/          # EventCard, PurchaseModal
│   ├── layout/          # Header, Footer
│   ├── wallet/          # ConnectButton, FundWallet
│   └── providers/       # AppProviders (Privy, QueryClient)
├── lib/                 # Core utilities
│   ├── contracts/       # ABIs + client (ethers.js)
│   ├── database/        # MongoDB models + connection
│   └── services/        # Biconomy, IPFS services
├── types/               # TypeScript definitions
└── public/              # Static assets
```

## 🔌 API Routes

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/auth/user` | Get authenticated user |
| `POST` | `/api/events/create` | Create event (gasless) |
| `POST` | `/api/tickets/purchase` | Purchase ticket |
| `POST` | `/api/scanner/verify` | Verify ticket QR code |
| `GET/POST` | `/api/user/profile` | Get/update user profile |
| `GET` | `/api/ipfs/signed-url` | Get signed upload URL |
| `GET` | `/api/onramp/create-url` | Generate MoonPay URL |

### Example: Create Event
```typescript
POST /api/events/create
Body: {
  title: "TechFest 2024",
  description: "...",
  startDate: "2024-06-15T10:00:00Z",
  ticketTypes: [{ name: "VIP", price: 150, maxSupply: 100 }]
}
```

## 🧪 Development Details

### Database Models
- **User** - Auth data (Privy ID, wallet, login method)
- **UserProfile** - Personal data (bio, interests, profile pic)
- **Event** - Event details + on-chain ID
- **TicketType** - Ticket categories + pricing
- **Order** - Purchase records
- **CheckIn** - Ticket verification logs

### Adding a Feature
1. Create component in `/components/[category]/`
2. Add TypeScript interface in `/types/`
3. Create API route if needed in `/app/api/[endpoint]/`
4. Update environment variables if new service

### Testing
```bash
# Run in development mode
npm run dev

# Check types
npm run type-check

# Lint code
npm run lint
```

## 🤝 Contributing

1. **Fork** the repo
2. **Branch:** `git checkout -b feature/your-feature`
3. **Commit:** Use conventional commits
4. **Test:** Verify your changes work
5. **PR:** Submit pull request with description

### Guidelines
- TypeScript required for new code
- Follow existing code style
- Update documentation if needed
- Add tests for significant changes

## 🐛 Common Issues

### Privy auth not working?
- Check `NEXT_PUBLIC_PRIVY_APP_ID` is set
- Clear browser localStorage
- Verify app is configured in Privy dashboard

### MongoDB connection error?
- Ensure MongoDB is running: `mongod`
- Check `MONGODB_URI` format
- Try connecting via `mongosh`

### IPFS upload failing?
- Verify Pinata JWT is valid
- Check file size (<5MB)
- Test with small image first

### Gasless transactions failing?
- Verify contract addresses
- Check signer has test ETH
- Review Biconomy dashboard

## 📚 Resources

- [Next.js Docs](https://nextjs.org/docs)
- [Privy Docs](https://docs.privy.io/)
- [Solidity Docs](https://docs.soliditylang.org/)
- [Lisk Sepolia](https://lisk.com/documentation/)
- [Tailwind CSS](https://tailwindcss.com/docs)

## 📄 License

**MIT License** © 2026 CACK-pass  
See [LICENSE](LICENSE) for details.

---

**Need help?**  
- Open an issue on GitHub  
- Check the code comments  
- Review the detailed README.md

**Built for Event Creators  by CACK-pass Team.**  
*Zero gas, maximum memories.*

🚀 Starting SLOW deployment to lisk...
   Backend Signer: 0x2c3b2B2325610a6814f2f822D0bF4DAB8CF16e16
   Delay between deployments: 60 seconds


1️⃣  Deploying WhitelistManager...
   ✅ Deployed: 0xA2Aea35523a71EFf81283E32F52151F12D5CBB7F
   ⏳ Waiting 60s for confirmation...
2️⃣  Deploying VoucherVerifier...
   ✅ Deployed: 0xFB69D0fb9C892F3565D66bcA92360Ca19B8D9780
   ⏳ Waiting 60s for confirmation...
3️⃣  Deploying CackPassCore...
   ✅ Deployed: 0xcc68Ce1342B91cC9A1F97e8863c77465910f2e63
   ⏳ Waiting 60s for confirmation...
4️⃣  Deploying RoyaltyEngine...
   ✅ Deployed: 0x589C1494089889C077d7AbBA17B40575E961cC8c
   ⏳ Waiting 60s for confirmation...
5️⃣  Deploying TicketMarket...
   ✅ Deployed: 0x7b954082151F7a44B2E42Ef9225393ea4f16c482
   ⏳ Waiting 60s for confirmation...
6️⃣  Deploying TicketFactory...
   ✅ Deployed: 0x49e7127A28c153CC69e196344799E873303a8424
   ⏳ Waiting 60s for confirmation...

🎉 Deployment Complete!

https://blockscout.lisk.com/address/0xA2Aea35523a71EFf81283E32F52151F12D5CBB7F
https://blockscout.lisk.com/address/0xFB69D0fb9C892F3565D66bcA92360Ca19B8D9780
https://blockscout.lisk.com/address/0xcc68Ce1342B91cC9A1F97e8863c77465910f2e63
https://blockscout.lisk.com/address/0x589C1494089889C077d7AbBA17B40575E961cC8c
https://blockscout.lisk.com/address/0x7b954082151F7a44B2E42Ef9225393ea4f16c482
https://blockscout.lisk.com/address/0x49e7127A28c153CC69e196344799E873303a8424


http://localhost:3000/events/698f769cc31ef91a73dabec7