# Telegram Content Delivery Platform (V2)

A comprehensive, production-ready Telegram content delivery platform featuring a user-facing Telegram Bot and an authenticated, responsive Admin Panel.

---

## 1. What This Platform Does

This platform handles high-scale targeted content delivery (videos, photos, documents, texts, and links) to Telegram users, governed by a secure, real-time Admin Panel.

### Telegram User Flow (V1 Core)
- **Welcome Sequence**: Users sending `/start` receive a permanent, custom welcome message followed by a sequence of active start contents.
- **Deep Link Delivery**: Users navigating to `t.me/bot?start=f_CONTENT_ID` immediately receive that exact item.
- **Auto Deletion**: Temporary content messages are tracked and automatically deleted from the user's chat history after a configurable hours threshold (e.g., 24 hours) to preserve privacy and content storage.

### Admin Dashboard Flow (V2 Core)
- **Analytics Metrics**: Real-time statistics on total users, active engagement rate, media counts by category/type, pending deletions, and audit trails.
- **Dynamic Bot Token Connectivity**: Secure connect feature using encryption-at-rest. Admins can paste a new BotFather token which is dynamically tested, encrypted, saved, and hot-swapped in the active listeners.
- **Category Management**: Complete category CRUD with dependency checking to prevent deleting folders containing active files.
- **Content & S3 Upload Manager**: Dynamic media form. Video, photo, and document binaries are uploaded to Filebase S3 with path-traversal protections and mime validation, and saved to MongoDB as metadata. Includes S3 deletion cleanup on media deletion or database insert failures.
- **Start Content Sequences**: Visual reordering (`↑` and `↓` buttons) syncing sort order directly to MongoDB.
- **Auto-Delete & Message Settings**: Fine-grained controls for welcome text, auto-delete hours toggle, start content limit (1-100), and master kill switches.
- **Rate-Limited Broadcasts**: Queued dispatches sequentially sending texts, links, or media files to eligible users with inline buttons. Rate-limited to ~20 messages/sec to respect Telegram API limitations. Includes progress reporting, blocked user detection, and cancellation controls.
- **Audit Logs**: Traceable logging of administrative activities with status and safe metadata.

---

## 2. Platform Architecture

The system segregates responsibilities into distinct directories:

```text
admin/                # Static Admin Frontend Panel served at /admin
├── index.html        # Main admin shell with dynamic panel views
├── login.html        # Premium dark login portal
├── css/
│   ├── admin.css     # Global layout structure and mobile responsive variables
│   └── components.css# Reusable style elements (modals, forms, badges, loader progress)
└── js/
    ├── api.js        # API connector injecting token/HttpOnly cookies
    ├── auth.js       # Admin authentication state controller
    ├── dashboard.js  # Stats card and event rendering
    ├── bots.js       # Bot dynamic connection triggers
    ├── categories.js # Category CRUD controller
    ├── content.js    # Content library upload & paginated list manager
    ├── start-content.js # Sort ordering and start content reordering
    ├── settings.js   # Master toggle updates controller
    ├── users.js      # User directory block/unblock toggler
    ├── broadcasts.js # Broadcast multi-part media form and progress reporter
    └── logs.js       # Audit log grid controller

src/
├── config/
│   ├── env.js        # Environment validation & custom DNS (1.1.1.1) mapping
│   ├── database.js   # MongoDB Atlas connection lifecycle
│   ├── storage.js    # Filebase S3 client config
│   └── crypto.js     # Cryptography helpers (PBKDF2 passwords & AES tokens at rest)
│
├── bot/
│   ├── bot.js        # Telegraf setup, enable middleware, and token reinitialization
│   └── handlers/     # Start, message, and callback handlers
│
├── models/
│   ├── User.js, Bot.js, Category.js, Content.js, Delivery.js, Setting.js
│   ├── Admin.js      # Admin credentials schema
│   ├── Broadcast.js  # Dispatch queues and metrics tracking schema
│   └── ActivityLog.js# Audit tracking logs schema
│
├── services/         # Storage and telegram interface clients
├── scheduler/        # Deletion chron scheduler
├── middleware/
│   ├── error.middleware.js # Express exception filter
│   └── auth.middleware.js  # JWT validation protecting /api/admin/*
│
├── app.js            # Express app middleware and static path mapping
└── server.js         # Entry bootstrap & graceful shutdown hooks
```

---

## 3. Environment Variables

Create a `.env` file in the root directory:

```env
NODE_ENV=development
PORT=3000

# Telegram Bot configurations
BOT_TOKEN=your_fallback_bot_token
BOT_USERNAME=your_bot_username

# MongoDB Atlas
MONGODB_URI=your_mongodb_atlas_uri
MONGODB_DB_NAME=Linkadda-bot

# Filebase S3 configurations
FILEBASE_ENDPOINT=https://s3.filebase.io
FILEBASE_REGION=auto
FILEBASE_ACCESS_KEY=your_filebase_access_key
FILEBASE_SECRET_KEY=your_filebase_secret_key
FILEBASE_BUCKET=your_bucket_name

# Security
ADMIN_JWT_SECRET=your_jwt_secret_signing_key
```

*The `.env` file is protected by `.gitignore` to prevent credential leaks.*

---

## 4. Local Development

### 1. Install Dependencies
```bash
npm install
```

### 2. Seeding Administrator Credentials
On the first server boot, the database automatically seeds a default administrator account if the `admins` collection is empty:
- **Email/Username**: `admin@bot.com`
- **Password**: `adminpassword`

*We strongly recommend changing this password directly in the database or registering a custom administrator document.*

### 3. Start Server
To start the application locally:
```bash
npm start
```

### 4. Running Verification Checks
To verify that V1 regression components and V2 authenticated API modules function correctly in this environment, execute the test scripts:

- **Verify V1 Bot Flows (Mocked Telegram API):**
  ```bash
  node src/test-integration.js
  ```
- **Verify V2 Admin Auth & CRUD APIs:**
  ```bash
  node src/test-v2-flow.js
  ```

---

## 5. Security Architecture & Safeguards

- **HTTP Protection**: The Express application mounts `helmet` headers (excluding specific CSP blocks to enable inline frontend script bindings) and limits rate abuse to 200 requests/15 minutes.
- **API Guarding**: Every `/api/admin/*` route requires a valid JSON Web Token signed with `ADMIN_JWT_SECRET`.
- **HttpOnly Cookies**: On successful login, the server writes the JWT inside a secure `admin_token` cookie configured with `HttpOnly` and `SameSite=Strict` flags. This prevents Client XSS scripts from reading session tokens.
- **AES Encryption at Rest**: Paste-to-connect Telegram Bot tokens are validated against Telegram API endpoints, encrypted using AES-256-CBC, and saved securely. They are decrypted only in memory when spawning listeners.
- **Path Traversal Shield**: File uploads are processed using `multer` in-memory. Destination keys are generated programmatically using randomized UUIDs (`content/<contentId>/<uuid>.<ext>`) to avoid file system directory climbs or filename overwrites.
- **Safe error messages**: Production runs hide exception stack traces to avoid revealing backend structures.

---

## 6. S3 & Media Storage Details

- **File size limits**: File uploads through the dashboard are capped at **50 MB** (matching the Telegram Bot API limit).
- **Telegram file-id caching**: S3 URLs are sent to Telegram the first time a file is delivered. The bot intercepts the Telegram payload, extracts the `telegramFileId` cache, and saves it to MongoDB. Subsequent deliveries bypass S3 entirely, delivering files instantly.
- **Fail-safe cleanups**: If a media file successfully uploads to Filebase S3 but the MongoDB metadata fails to write, the backend deletes the orphan S3 object. Deleting content from the admin table also removes the media from S3.

---

## 7. Broadcast rate limits

Bots cannot send private broadcasts to users who have never interacted with them. The broadcast system:
- Dispatches messages to active user documents collected during `/start` interactions.
- Batches deliveries with a **50ms sleep interval** (~20 messages per second) to stay comfortably below the Telegram API threshold of 30 messages per second.
- Updates broadcast statistics (targeted, sent, failed, blocked) in real time. If a user blocks the bot, they are marked `blocked` in the database to exclude them from future queues.

---

## 8. V4 Advanced Bot Navigation & Discovery System

The V4 update upgrades the core Telegram Bot into a highly polished, interactive content system.

### Telegram Interactive UI Flow
- **Interactive Main Menu**: Fresh `/start` requests render the **Main welcome menu** with custom inline button grids built dynamically from the database.
- **Callback Navigation Router**: High-performance, compact callback syntax (`cats`, `cat:id:page`, `info:id`, `get:id`, `srch`, `help`, `feat:page`) stays within the **64-byte Telegram limit**.
- **Pagination & Views**: Browse category content and featured items with dynamic inline `◀️ Prev` and `Next ▶️` pagination without message spamming.
- **Content Preview & Get Content**: Clicking an item displays details (Title, Category, Caption/Description) with a `[ ▶️ Get Content ]` button. Clicking this triggers the actual file delivery.
- **Search System**: Trimmed and escaped keywords search on content titles, captions, and category names with RegExp ReDoS protection.
- **Deduplication Cooldown**: In-memory request caching blocks rapid duplicate clicks for 2 seconds to protect Telegram API rate limits.

### Admin Panel Controls
- **Bot Menu Management**: Complete CRUD panel to customize interactive button labels, icons, action types (CATEGORY, CONTENT, URL, SEARCH, FEATURED, HELP), targets, and sort order.
- **Analytics Dashboard**: Aggregated views tracking user starts, keyword searches, top contents, top categories, and campaign execution stats.
- **Scheduled Campaigns**: Support setting a future `scheduledAt` date/time for broadcast campaigns, picked up automatically by the worker scheduler every minute.
#   L i n k a d d a - T G - - B o t  
 