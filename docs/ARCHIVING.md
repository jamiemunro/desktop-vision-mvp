# Session Archiving

The desktop-vision-mvp automatically manages storage by compressing old sessions to preserve disk space while keeping data accessible.

## How It Works

- **Sessions older than 24 hours** are automatically compressed using gzip
- **Compression ratio**: ~70% space savings (6.4MB → 1.8MB typical)
- **Original sessions** are safely removed after successful compression
- **Archives stored** in `sessions/archived/` as `.tar.gz` files

## Automatic Archiving

The Electron app automatically runs archiving:
- **On startup**: 5 seconds after app launch
- **Periodically**: Every 6 hours while running

## Manual Archiving

### Via UI Button
- Click "Archive Old Sessions" button in the app
- Check console output for results

### Via Command Line
```bash
npm run archive
```

### Via Script
```bash
node scripts/archive-sessions.js
```

## Extracting Archives

To access archived session data:

```bash
# Extract to current directory
tar -xzf sessions/archived/2025-08-11T15-59-15-645Z.tar.gz

# Extract to specific directory
tar -xzf sessions/archived/SESSION_NAME.tar.gz -C /path/to/extract/
```

## Archive Structure

```
sessions/
├── archived/                          # Compressed archives
│   ├── 2025-08-10T10-30-15-123Z.tar.gz
│   └── 2025-08-10T14-22-08-456Z.tar.gz
├── 2025-08-11T15-59-15-645Z/          # Recent sessions (< 24h)
│   ├── frames/                        # Screenshot files
│   ├── audio/                         # Audio recordings
│   ├── events.ndjson                  # Event timeline
│   └── meta.json                      # Session metadata
```

## Storage Benefits

| Session Age | Status | Storage |
|-------------|--------|---------|
| < 24 hours | Uncompressed | ~45MB/minute |
| > 24 hours | Compressed | ~13MB/minute (70% savings) |

## Safety Features

- **Verification**: Archives are tested before removing originals
- **Non-blocking**: Archiving runs in background without affecting live recording
- **Error handling**: Failed compressions leave originals intact
- **Metadata preservation**: Session timing and details remain accessible

## Customization

To modify the 24-hour threshold, edit `ONE_DAY_MS` in `scripts/archive-sessions.js`:

```javascript
const ONE_DAY_MS = 24 * 60 * 60 * 1000; // Change 24 to desired hours
```